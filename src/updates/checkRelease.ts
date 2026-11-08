import { compareStableVersions, parseStableVersion, type VersionComparison } from "./version";

export const RELEASE_API_URL = "https://api.github.com/repos/guardiancrow/dol-progress/releases/latest";
export const MAX_BODY_BYTES = 1024 * 1024;
export const UPDATE_TIMEOUT_MS = 10_000;
export const UPDATE_INTERVAL_MS = 60_000;

export type ReleaseCheckResult =
  | { kind: "checked"; version: string; comparison: VersionComparison; portableAvailable: boolean }
  | { kind: "uncomparable"; reason: "version" | "release" };

export class UpdateCheckError extends Error {
  constructor(
    readonly code: "network" | "timeout" | "http" | "response" | "too-large",
    readonly status?: number,
    readonly retryAt?: number,
  ) { super(code); }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publishedDate(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function validateRelease(value: unknown, currentVersion: string): ReleaseCheckResult {
  if (!object(value) || typeof value.tag_name !== "string" || value.tag_name.length > 128
    || typeof value.draft !== "boolean" || typeof value.prerelease !== "boolean"
    || !publishedDate(value.published_at)
    || !Array.isArray(value.assets) || value.assets.length > 256) throw new UpdateCheckError("response");
  if (value.draft || value.prerelease) return { kind: "uncomparable", reason: "release" };
  const current = parseStableVersion(currentVersion);
  const published = parseStableVersion(value.tag_name, true);
  if (!current || !published) return { kind: "uncomparable", reason: "version" };
  const assets: Array<{name: string; state: string; size: number}> = [];
  for (const asset of value.assets as unknown[]) {
    if (!object(asset) || typeof asset.name !== "string" || typeof asset.state !== "string"
      || typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size < 0) throw new UpdateCheckError("response");
    assets.push({ name: asset.name, state: asset.state, size: asset.size });
  }
  const zipName = `DOL-Progress-Manager_${published}_windows-x64_portable.zip`;
  function available(name: string, limit: number): boolean {
    const matches = assets.filter(asset => asset.name === name);
    return matches.length === 1 && matches[0].state === "uploaded" && matches[0].size > 0 && matches[0].size <= limit;
  }
  return {
    kind: "checked", version: published, comparison: compareStableVersions(current, published),
    portableAvailable: available(zipName, 96 * 1024 * 1024) && available(`${zipName}.sha256`, 1024),
  };
}

function retryTime(response: Response, now: number): number | undefined {
  if (response.status !== 403 && response.status !== 429) return undefined;
  let retryAt = now + UPDATE_INTERVAL_MS;
  const after = response.headers.get("retry-after");
  if (after !== null && /^\d{1,10}$/.test(after)) retryAt = Math.max(retryAt, now + Number(after) * 1000);
  else if (after !== null && /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(after)) {
    const date = Date.parse(after);
    if (Number.isFinite(date)) retryAt = Math.max(retryAt, date);
  }
  const reset = response.headers.get("x-ratelimit-reset");
  if (response.headers.get("x-ratelimit-remaining") === "0" && reset !== null && /^\d{1,12}$/.test(reset)) {
    retryAt = Math.max(retryAt, Number(reset) * 1000);
  }
  return retryAt;
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!type || !/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(type) || !response.body) throw new UpdateCheckError("response");
  const length = response.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) throw new UpdateCheckError("too-large");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const chunk = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) throw new UpdateCheckError("too-large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    cancel();
    if (error instanceof UpdateCheckError || signal.aborted) throw error;
    throw new UpdateCheckError("response");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function checkRelease(
  currentVersion: string,
  signal: AbortSignal,
  request: typeof fetch = globalThis.fetch,
  now: () => number = Date.now,
): Promise<ReleaseCheckResult> {
  if (!parseStableVersion(currentVersion)) return { kind: "uncomparable", reason: "version" };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, UPDATE_TIMEOUT_MS);
  let rejectAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    if (signal.aborted) controller.abort();
    const perform = async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await request(RELEASE_API_URL, {
        method: "GET", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store",
        referrerPolicy: "no-referrer", keepalive: false, signal: controller.signal,
        headers: { Accept: "application/vnd.github+json" },
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      if (response.redirected || response.url !== RELEASE_API_URL || response.type === "opaque" || response.type === "opaqueredirect") throw new UpdateCheckError("response");
      if (response.status !== 200) throw new UpdateCheckError("http", response.status, retryTime(response, now()));
      return validateRelease(await readJson(response, controller.signal), currentVersion);
    };
    return await Promise.race([perform(), aborted]);
  } catch (error: unknown) {
    controller.abort();
    if (timedOut) throw new UpdateCheckError("timeout");
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (error instanceof UpdateCheckError) throw error;
    throw new UpdateCheckError("network");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
  }
}
