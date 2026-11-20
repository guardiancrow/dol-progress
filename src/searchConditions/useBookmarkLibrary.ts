import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchBookmark, SearchBookmarkRepository } from "../repositories/searchBookmarkRepository";

export type BookmarkRepository = Pick<SearchBookmarkRepository, "list" | "create" | "rename" | "updateCondition" | "setFavorite" | "delete" | "markUsed">;

export function useBookmarkLibrary(repository: BookmarkRepository) {
  const [rows, setRows] = useState<SearchBookmark[]>();
  const [readFailed, setReadFailed] = useState(false);
  const readVersion = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => () => { readVersion.current++; }, [repository]);

  const refresh = useCallback(async () => {
    const version = ++readVersion.current;
    setReadFailed(false);
    try {
      const items = await repository.list();
      if (version === readVersion.current) setRows(items);
    } catch {
      if (version === readVersion.current) {
        setRows(undefined);
        setReadFailed(true);
      }
    }
  }, [repository]);

  const mutate = useCallback((write: (repo: BookmarkRepository) => Promise<unknown>) => {
    const operation = writes.current.then(() => write(repository));
    // A stale list read or a rejected write must not block subsequent writes.
    writes.current = operation.then(() => undefined, () => undefined);
    return operation.then(refresh);
  }, [repository, refresh]);

  return { rows, readFailed, refresh, mutate };
}

export type BookmarkLibrary = ReturnType<typeof useBookmarkLibrary>;
