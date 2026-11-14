import { vi } from "vitest";
import { COMPACT_WORKSPACE_QUERY } from "./useResponsiveDisclosure";

// jsdomでは寸法を測れないため、media queryの通知契約だけを再現する。
export function mockWorkspaceMedia(width: number, height: number) {
  const queries = new Map<string, { media: MediaQueryList; listeners: Set<() => void> }>();
  const matches = (query: string) => width <= 896 || query === COMPACT_WORKSPACE_QUERY && height <= 800;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    if (!queries.has(query)) {
      const listeners = new Set<() => void>();
      const media = {
        media: query, matches: matches(query), onchange: null,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
      queries.set(query, { media, listeners });
    }
    return queries.get(query)!.media;
  }));
  return (nextWidth: number, nextHeight: number) => {
    width = nextWidth; height = nextHeight;
    for (const [query, { media, listeners }] of queries) {
      Object.defineProperty(media, "matches", { value: matches(query), configurable: true });
      listeners.forEach(listener => listener());
    }
  };
}
