import { describe, expect, it, vi } from "vitest";
import { SupersededWorkspaceRead, WorkspaceReads } from "./WorkspaceReads";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("workspace shared reads", () => {
  it("shares in-flight and ready reads for the same source, profile and generation", async () => {
    const reads = new WorkspaceReads();
    const source = {}, other = {};
    const pending = deferred<number[]>();
    const load = vi.fn(() => pending.promise);
    const first = reads.read("report", source, 1, load, { masterRevision: 1 });
    const joined = reads.read("report", source, 1, load, { masterRevision: 1 });
    expect(joined.promise).toBe(first.promise);
    expect(load).toHaveBeenCalledTimes(1);
    const otherScope = vi.fn(async () => [2]);
    for (const [reader, profileId, masterRevision] of [[source, 2, 1], [other, 1, 1], [source, 1, 2]] as const) {
      expect(await reads.read("report", reader, profileId, otherScope, { masterRevision }).promise).toEqual([2]);
    }
    expect(otherScope).toHaveBeenCalledTimes(3);
    pending.resolve([1]);
    expect(await joined.promise).toEqual([1]);
    expect(reads.read("report", source, 1, load, { masterRevision: 1 }).promise).toBe(first.promise);
  });

  it.each(["saved", "uncertain"] as const)("discards an earlier result and reloads after a %s write", async outcome => {
    const reads = new WorkspaceReads();
    const source = {}, owner = {};
    const delayed = deferred<number[]>(), finish = deferred<void>();
    let persisted: number[] = [];
    const old = reads.read("discoveryProgress", source, 1, () => delayed.promise);
    const otherProfile = reads.read("discoveryProgress", source, 2, async () => [2]);
    const master = reads.read("discoveryMaster", source, null, async () => [5]);
    const changes = vi.fn();
    reads.subscribe(changes);
    const failedOrSaved = reads.write(owner, 1, ["discoveryProgress", "report"], async () => {
      await finish.promise;
      persisted = [9];
      if (outcome === "uncertain") throw new Error("synthetic uncertain response");
    }).catch(() => undefined);
    expect(old.isCurrent()).toBe(false);
    const reopen = vi.fn(async () => persisted);
    const waiting = reads.read("discoveryProgress", source, 1, reopen);
    const second = reads.read("discoveryProgress", source, 1, reopen);
    expect(reopen).not.toHaveBeenCalled();
    finish.resolve();
    await failedOrSaved;
    expect(await waiting.promise).toEqual([9]);
    expect(await second.promise).toEqual([9]);
    expect(reopen).toHaveBeenCalledTimes(1);
    delayed.resolve([]);
    expect(await old.promise).toEqual([]);
    expect(old.isCurrent()).toBe(false);
    expect(waiting.isCurrent()).toBe(true);
    expect(await otherProfile.promise).toEqual([2]);
    expect(otherProfile.isCurrent()).toBe(true);
    expect(master.isCurrent()).toBe(true);
    expect(changes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ owner, profileId: 1, kinds: ["discoveryProgress", "report"] }));
  });

  it("does not start a queued read once its owner has left the view", async () => {
    const reads = new WorkspaceReads();
    const pending = deferred<void>();
    const saving = reads.write({}, 3, ["questProgress"], () => pending.promise);
    const load = vi.fn(async () => [3]);
    let active = true;
    const read = reads.read("questProgress", {}, 3, load, { active: () => active });
    const result = expect(read.promise).rejects.toBeInstanceOf(SupersededWorkspaceRead);
    active = false;
    pending.resolve();
    await saving;
    await result;
    expect(load).not.toHaveBeenCalled();
    expect(read.isCurrent()).toBe(false);
  });

  it("invalidates masters and report summaries together without refreshing raw progress", async () => {
    const reads = new WorkspaceReads();
    const source = {};
    const pending = deferred<number[]>();
    const old = reads.read("questMaster", source, null, () => pending.promise);
    const report = reads.read("report", source, 1, async () => [1]);
    const progress = reads.read("questProgress", source, 1, async () => [2]);
    reads.invalidateMaster();
    const current = reads.read("questMaster", source, null, async () => [3], { masterRevision: 1 });
    expect(await current.promise).toEqual([3]);
    pending.resolve([0]);
    await old.promise;
    expect(old.isCurrent()).toBe(false);
    expect(report.isCurrent()).toBe(false);
    expect(progress.isCurrent()).toBe(true);
  });

  it("gives an explicit retry a new read generation even if the old request has not completed", async () => {
    const reads = new WorkspaceReads();
    const source = {};
    const pending = deferred<number[]>();
    const old = reads.read("questMaster", source, null, () => pending.promise);
    const replacement = reads.read("questMaster", source, null, async () => [2], { fresh: true });
    expect(replacement.promise).not.toBe(old.promise);
    expect(await replacement.promise).toEqual([2]);
    pending.resolve([1]);
    await old.promise;
    expect(old.isCurrent()).toBe(false);
    expect(replacement.isCurrent()).toBe(true);
  });

  it("allows retries after failure and bounds retained profile results to four for each kind", async () => {
    const reads = new WorkspaceReads();
    const source = {};
    const broken = reads.read("questProgress", source, 1, async () => { throw new Error("synthetic read failure"); });
    await expect(broken.promise).rejects.toThrow("synthetic read failure");
    const load = vi.fn(async () => []);
    expect(await reads.read("questProgress", source, 1, load).promise).toEqual([]);
    for (const id of [2, 3, 4, 5]) await reads.read("questProgress", source, id, load).promise;
    await reads.read("questProgress", source, 2, load).promise;
    expect(load).toHaveBeenCalledTimes(5);
    await reads.read("questProgress", source, 1, load).promise;
    expect(load).toHaveBeenCalledTimes(6);
  });
});
