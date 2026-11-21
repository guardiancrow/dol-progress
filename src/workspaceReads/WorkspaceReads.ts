export type ProgressReadKind = "questProgress" | "discoveryProgress" | "report";
export type WorkspaceReadKind = "questMaster" | "discoveryMaster" | "overview" | ProgressReadKind;

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

function affectedByWrite(kind: WorkspaceReadKind, kinds: readonly ProgressReadKind[]) {
  return kind === "overview" || kinds.some(value => value === kind);
}

/** The lifetime belongs to the app, independently of the open search tabs. */
export class WorkspaceReads {
  private readonly sources = new WeakMap<object, number>();
  private nextSource = 0;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly writes = new Set<PendingWrite>();
  private readonly listeners = new Set<(change: ProgressChange) => void>();
  private readonly retryListeners = new Map<string, Set<(read: WorkspaceRead<unknown> | undefined) => void>>();

  subscribe(listener: (change: ProgressChange) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // An undefined handle clears readiness immediately. The replacement handle is published when the next read starts.
  subscribeRetry<T>(kind: WorkspaceReadKind, source: object, profileId: number | null,
    listener: (read: WorkspaceRead<T> | undefined) => void, masterRevision = 0,
  ) {
    const key = this.readKey(kind, this.sourceId(source), profileId, masterRevision);
    const listeners = this.retryListeners.get(key) ?? new Set();
    const receive = (read: WorkspaceRead<unknown> | undefined) => listener(read as WorkspaceRead<T> | undefined);
    listeners.add(receive);
    this.retryListeners.set(key, listeners);
    return () => {
      if (!listeners.delete(receive) || listeners.size) return;
      this.retryListeners.delete(key);
      if (this.entries.get(key)?.current === false) this.entries.delete(key);
    };
  }

  read<T>(kind: WorkspaceReadKind, source: object, profileId: number | null, load: () => Promise<T>,
    { fresh = false, active = () => true, masterRevision = 0 }: { fresh?: boolean; active?: () => boolean; masterRevision?: number } = {},
  ): WorkspaceRead<T> {
    const barriers = [...this.writes].filter(write => write.profileId === profileId && affectedByWrite(kind, write.kinds));
    if (barriers.length) {
      let next: WorkspaceRead<T> | undefined;
      const promise = Promise.all(barriers.map(write => write.done)).then(() => {
        if (!active()) throw new SupersededWorkspaceRead();
        next = this.read(kind, source, profileId, load, { fresh, active, masterRevision });
        return next.promise;
      });
      return { promise, isCurrent: () => next?.isCurrent() === true };
    }

    const sourceId = this.sourceId(source);
    const key = this.readKey(kind, sourceId, profileId, masterRevision);
    const cached = this.entries.get(key);
    if (!fresh && cached?.current && cached.status !== "error") {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { promise: cached.promise as Promise<T>, isCurrent: () => cached.current };
    }
    const replacesRetry = fresh || cached?.current === false;
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
      if (!entry.current || this.entries.get(key) !== entry) return;
      entry.status = status;
      const settled = [...this.entries].filter(([, value]) => value.kind === kind && value.current && value.status !== "pending");
      for (const [oldKey, old] of settled.slice(0, Math.max(0, settled.length - MAX_READY_PER_KIND))) {
        old.current = false;
        this.entries.delete(oldKey);
      }
    };
    void promise.then(() => settle("ready"), () => settle("error"));
    const read = { promise, isCurrent: () => entry.current };
    if (replacesRetry) for (const listener of this.retryListeners.get(key) ?? []) listener(read);
    return read;
  }

  invalidateMaster() {
    this.invalidate(entry => entry.kind === "questMaster" || entry.kind === "discoveryMaster" || entry.kind === "report" || entry.kind === "overview");
  }

  invalidateProfile(profileId: number) {
    this.invalidate(entry => entry.profileId === profileId);
  }

  invalidateRead(kind: WorkspaceReadKind, source: object, profileId: number | null) {
    const sourceId = this.sources.get(source);
    for (const [key, entry] of this.entries) {
      if (entry.kind !== kind || entry.sourceId !== sourceId || entry.profileId !== profileId) continue;
      entry.current = false;
      // A retry listener needs the replacement handle, including its failure. The old result is already invalid.
      const listeners = this.retryListeners.get(key);
      if (listeners) listeners.forEach(receive => receive(undefined));
      else this.entries.delete(key);
    }
  }

  async write<T>(owner: object, profileId: number, kinds: readonly ProgressReadKind[], operation: () => Promise<T>): Promise<T> {
    const matches = (entry: CacheEntry) => entry.profileId === profileId && affectedByWrite(entry.kind, kinds);
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

  private sourceId(source: object) {
    const existing = this.sources.get(source);
    if (existing !== undefined) return existing;
    const id = ++this.nextSource;
    this.sources.set(source, id);
    return id;
  }

  private readKey(kind: WorkspaceReadKind, sourceId: number, profileId: number | null, masterRevision: number) {
    return `${kind}:${sourceId}:${profileId ?? "master"}:${masterRevision}`;
  }
}

export interface WorkspaceReadScope {
  reads: WorkspaceReads;
  owner: { active: boolean };
}
