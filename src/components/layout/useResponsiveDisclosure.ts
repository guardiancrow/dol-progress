import { useId, useLayoutEffect, useRef, useState } from "react";

export const NARROW_WORKSPACE_QUERY = "(max-width: 56rem)";
export const COMPACT_WORKSPACE_QUERY = "(max-width: 56rem), (max-height: 50rem)";

// nullは自動。手動選択は、このHookを持つコンポーネントの生存中だけ保持する。
export function useResponsiveDisclosure<T extends HTMLElement = HTMLDivElement>(query: string) {
  const id = useId();
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && (window.matchMedia?.(query).matches ?? false));
  const [manual, setManual] = useState<boolean | null>(null);
  const manualRef = useRef(manual);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<T>(null);
  const expanded = manual ?? !matches;

  function restoreFocus() {
    if (panelRef.current?.contains(document.activeElement)) {
      buttonRef.current?.focus({ preventScroll: true });
    }
  }

  useLayoutEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => {
      if (!(manualRef.current ?? !media.matches)) restoreFocus();
      setMatches(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  function toggle() {
    if (expanded) restoreFocus();
    manualRef.current = !expanded;
    setManual(!expanded);
  }

  return { id, expanded, toggle, buttonRef, panelRef };
}
