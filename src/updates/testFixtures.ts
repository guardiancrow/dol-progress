import { RELEASE_API_URL } from "./checkRelease";

export function release(tag = "v0.3.1") {
  const name = `DOL-Progress-Manager_${tag.replace(/^v/, "")}_windows-x64_portable.zip`;
  return { tag_name: tag, draft: false, prerelease: false, published_at: "2026-01-01T00:00:00Z", assets: [
    { name, state: "uploaded", size: 1024 }, { name: `${name}.sha256`, state: "uploaded", size: 140 },
  ] };
}

export function response(body: string, status = 200, headers: HeadersInit = {}, url = RELEASE_API_URL) {
  const result = new Response(body, { status, headers: { "Content-Type": "application/json", ...headers } });
  Object.defineProperty(result, "url", { value: url, configurable: true });
  return result;
}
