// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdateCheck } from "./useUpdateCheck";
import { UpdateCheckError, type ReleaseCheckResult } from "./checkRelease";

afterEach(cleanup);
const newer: ReleaseCheckResult = {kind:"checked",version:"0.3.1",comparison:"newer",portableAvailable:true};

it("makes no automatic request in StrictMode and synchronously excludes duplicate starts",async()=>{
  let resolve!: (result:ReleaseCheckResult)=>void;
  const check=vi.fn(()=>new Promise<ReleaseCheckResult>(yes=>{resolve=yes;}));
  const hook=renderHook(()=>useUpdateCheck("0.3.0",check,()=>1000),{wrapper:StrictMode});
  expect(check).not.toHaveBeenCalled();
  act(()=>{ void hook.result.current.start(); void hook.result.current.start(); });
  expect(check).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state).toEqual({kind:"checking"});
  await act(async()=>resolve(newer));
  expect(hook.result.current.updateAvailable).toBe(true);
});

it("keeps results in memory, enforces 60 seconds and replaces a previous update after failure",async()=>{
  let time=1000;
  const check=vi.fn().mockResolvedValueOnce(newer).mockRejectedValueOnce(new UpdateCheckError("network"));
  const hook=renderHook(()=>useUpdateCheck("0.3.0",check,()=>time));
  await act(()=>hook.result.current.start());
  expect(hook.result.current.updateAvailable).toBe(true);
  time=60999;
  await act(()=>hook.result.current.start());
  expect(check).toHaveBeenCalledTimes(1);
  expect(hook.result.current.waiting).toBe(true);
  time=61000;
  await act(()=>hook.result.current.start());
  expect(check).toHaveBeenCalledTimes(2);
  expect(hook.result.current.state.kind).toBe("failed");
  expect(hook.result.current.updateAvailable).toBe(false);
});

it("respects the longer server rate limit without scheduling automatic retries",async()=>{
  let time=1000;
  const check=vi.fn().mockRejectedValue(new UpdateCheckError("http",429,500000));
  const hook=renderHook(()=>useUpdateCheck("0.3.0",check,()=>time));
  await act(()=>hook.result.current.start());
  time=61000; await act(()=>hook.result.current.start());
  expect(check).toHaveBeenCalledTimes(1);
  time=500000; await act(()=>hook.result.current.start());
  expect(check).toHaveBeenCalledTimes(2);
});

it.each(["resolve","reject"])("aborts on unmount and excludes a stale %s from the next mount",async outcome=>{
  let resolve!: (value:ReleaseCheckResult)=>void;
  let reject!: (error:Error)=>void;
  const check=vi.fn((_version:string,_signal:AbortSignal)=>new Promise<ReleaseCheckResult>((yes,no)=>{resolve=yes;reject=no;}));
  const old=renderHook(()=>useUpdateCheck("0.3.0",check));
  act(()=>{void old.result.current.start();});
  const signal=check.mock.calls[0][1];
  old.unmount();
  expect(signal.aborted).toBe(true);
  const current=renderHook(()=>useUpdateCheck("0.3.0",check));
  await act(async()=>{if(outcome==="resolve") resolve(newer);else reject(new Error("synthetic stale failure"));});
  expect(current.result.current.state).toEqual({kind:"unchecked"});
  expect(current.result.current.updateAvailable).toBe(false);
});
