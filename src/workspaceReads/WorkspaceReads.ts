export type WorkspaceReadKind = "questMaster" | "discoveryMaster" | "questProgress" | "discoveryProgress" | "report";
export type ProgressReadKind = Exclude<WorkspaceReadKind, "questMaster" | "discoveryMaster">;

export interface WorkspaceRead<T> {
  promise: Promise<T>;
  isCurrent(): boolean;
}

interface CacheEntry {
  kind: WorkspaceReadKind;
  sourceId: number;
  profileId: number | null;
  promise: Promise<unknown>;
  current: boolean;
  status: "pending" | "ready" | "error";
}

interface ProgressChange {
  profileId: number;
  kinds: readonly ProgressReadKind[];
  owner: object;
}

interface PendingWrite extends ProgressChange {
  done: Promise<void>;
}

const MAX_READY_PER_KIND = 4;

export class SupersededWorkspaceRead extends Error {}

/** The lifetime belongs to the app, independently of the open search tabs. */
export class WorkspaceReads {
  private readonly sources = new WeakMap<object, number>();
  private nextSource = 0;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly writes = new Set<PendingWrite>();
  private readonly listeners = new Set<(change: ProgressChange) => void>();

  subscribe(listener: (change: ProgressChange) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  read<T>(kind: WorkspaceReadKind, source: object, profileId: number | null, load: () => Promise<T>,
    { fresh = false, active = () => true, masterRevision = 0 }: { fresh?: boolean; active?: () => boolean; masterRevision?: number } = {},
  ): WorkspaceRead<T> {
    const barriers = [...this.writes].filter(write => write.profileId === profileId && write.kinds.some(value => value === kind));
    if (barriers.length) {
      let next: WorkspaceRead<T> | undefined;
      const promise = Promise.all(barriers.map(write => write.done)).then(() => {
        if (!active()) throw new SupersededWorkspaceRead();
        next = this.read(kind, source, profileId, load, { fresh, active, masterRevision });
        return next.promise;
      });
      return { promise, isCurrent: () => next?.isCurrent() === true };
    }

    const sourceId = this.sources.get(source) ?? ++this.nextSource;
    this.sources.set(source, sourceId);
    const key = `${kind}:${sourceId}:${profileId ?? "master"}:${masterRevision}`;
    const cached = this.entries.get(key);
    if (!fresh && cached && cached.status !== "error") {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { promise: cached.promise as Promise<T>, isCurrent: () => cached.current };
    }
    if (cached) cached.current = false;

    let promise: Promise<T>;
    try {
      promise = load();
    } catch (error) {
      promise = Promise.reject(error);
    }
    const entry: CacheEntry = { kind, sourceId, profileId, promise, current: true, status: "pending" };
    this.entries.set(key, entry);
    const settle = (status: "ready" | "error") => {
      if (this.entries.get(key) !== entry) return;
      entry.status = status;
      const settled = [...this.entries].filter(([, value]) => value.kind === kind && value.status !== "pending");
      for (const [oldKey, old] of settled.slice(0, Math.max(0, settled.length - MAX_READY_PER_KIND))) {
        old.current = false;
        this.entries.delete(oldKey);
      }
    };
    void promise.then(() => settle("ready"), () => settle("error"));
    return { promise, isCurrent: () => entry.current };
  }

  invalidateMaster() {
    this.invalidate(entry => entry.kind === "questMaster" || entry.kind === "discoveryMaster" || entry.kind === "report");
  }

  invalidateProfile(profileId: number) {
    this.invalidate(entry => entry.profileId === profileId);
  }

  invalidateRead(kind: WorkspaceReadKind, source: object, profileId: number | null) {
    const sourceId = this.sources.get(source);
    this.invalidate(entry => entry.kind === kind && entry.sourceId === sourceId && entry.profileId === profileId);
  }

  async write<T>(owner: object, profileId: number, kinds: readonly ProgressReadKind[], operation: () => Promise<T>): Promise<T> {
    const matches = (entry: CacheEntry) => entry.profileId === profileId && kinds.some(kind => kind === entry.kind);
    let release!: () => void;
    const done = new Promise<void>(resolve => { release = resolve; });
    const write = { owner, profileId, kinds, done };
    this.writes.add(write);
    this.invalidate(matches);
    try {
      return await operation();
    } finally {
      this.invalidate(matches);
      this.writes.delete(write);
      release();
      for (const listener of this.listeners) listener(write);
    }
  }

  private invalidate(matches: (entry: CacheEntry) => boolean) {
    for (const [key, entry] of this.entries) {
      if (!matches(entry)) continue;
      entry.current = false;
      this.entries.delete(key);
    }
  }
}

export interface WorkspaceReadScope {
  reads: WorkspaceReads;
  owner: { active: boolean };
}
