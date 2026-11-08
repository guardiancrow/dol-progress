import { useEffect, useRef, useState } from "react";
import { checkRelease, UpdateCheckError, UPDATE_INTERVAL_MS, type ReleaseCheckResult } from "./checkRelease";

export type UpdateState = { kind: "unchecked" } | { kind: "checking" } | ReleaseCheckResult | { kind: "failed"; error: UpdateCheckError };

export function useUpdateCheck(version: string, check = checkRelease, now: () => number = Date.now) {
  const [state, setState] = useState<UpdateState>({ kind: "unchecked" });
  const [waiting, setWaiting] = useState(false);
  const inFlight = useRef(false);
  const nextAllowed = useRef(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); inFlight.current = false; }, []);

  async function start() {
    if (inFlight.current) return;
    if (now() < nextAllowed.current) { setWaiting(true); return; }
    inFlight.current = true;
    nextAllowed.current = now() + UPDATE_INTERVAL_MS;
    const token = ++generation.current;
    const active = new AbortController();
    controller.current = active;
    setWaiting(false);
    setState({ kind: "checking" });
    try {
      const result = await check(version, active.signal);
      if (generation.current === token && !active.signal.aborted) setState(result);
    } catch (error: unknown) {
      if (generation.current !== token || active.signal.aborted) return;
      const failure = error instanceof UpdateCheckError ? error : new UpdateCheckError("network");
      nextAllowed.current = Math.max(nextAllowed.current, failure.retryAt ?? 0);
      setState({ kind: "failed", error: failure });
    } finally {
      if (generation.current === token) { inFlight.current = false; controller.current = null; }
    }
  }
  return { state, waiting, start, updateAvailable: state.kind === "checked" && state.comparison === "newer" && state.portableAvailable };
}
