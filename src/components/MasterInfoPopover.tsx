import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface MasterInfoItem {
  id: number;
  title: string;
  description?: string | null;
  notes: string | null;
}

interface Selection {
  rowId: number;
  anchor: HTMLButtonElement;
  resetKey: string;
}

interface MasterInfoContextValue {
  items: Map<number, MasterInfoItem>;
  activeRowId: number | null;
  dialogId: string;
  hint: string;
  toggle(rowId: number, anchor: HTMLButtonElement): void;
}

const MasterInfoContext = createContext<MasterInfoContextValue | null>(null);

function hasText(text: string | null | undefined): text is string {
  return text !== null && text !== undefined && text.trim().length > 0;
}

function hasContent(item: MasterInfoItem): boolean {
  return hasText(item.description) || hasText(item.notes);
}

export function MasterInfoProvider({
  items,
  resetKey,
  hint,
  children,
}: {
  items: MasterInfoItem[];
  resetKey: string;
  hint: string;
  children: ReactNode;
}) {
  const dialogId = useId();
  const [selection, setSelection] = useState<Selection | null>(null);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selectedItem = selection?.resetKey === resetKey
    ? itemMap.get(selection.rowId)
    : undefined;
  const activeItem = selectedItem && hasContent(selectedItem) ? selectedItem : null;

  useEffect(() => {
    if (selection && !activeItem) setSelection(null);
  }, [activeItem, selection]);

  const toggle = useCallback((rowId: number, anchor: HTMLButtonElement) => {
    setSelection((current) => current?.rowId === rowId && current.resetKey === resetKey
      ? null
      : { rowId, anchor, resetKey });
  }, [resetKey]);

  const close = useCallback((restoreFocus: boolean) => {
    if (restoreFocus && selection?.anchor.isConnected) {
      selection.anchor.focus({ preventScroll: true });
    }
    setSelection(null);
  }, [selection]);

  return (
    <MasterInfoContext.Provider value={{
      items: itemMap,
      activeRowId: activeItem?.id ?? null,
      dialogId,
      hint,
      toggle,
    }}>
      {children}
      {activeItem && selection && createPortal(
        <MasterInfoPanel
          key={activeItem.id}
          item={activeItem}
          anchor={selection.anchor}
          dialogId={dialogId}
          onClose={close}
        />,
        document.body,
      )}
    </MasterInfoContext.Provider>
  );
}

export function MasterInfoButton({ rowId }: { rowId: number }) {
  const context = useContext(MasterInfoContext);
  if (!context) throw new Error("MasterInfoButton requires MasterInfoProvider");
  const item = context.items.get(rowId);
  if (!item || !hasContent(item)) return null;
  const open = context.activeRowId === rowId;
  return (
    <button
      type="button"
      className="master-info-button"
      title={context.hint}
      aria-label={`${item.title}の${context.hint}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? context.dialogId : undefined}
      data-master-info-owner={context.dialogId}
      onClick={(event) => {
        event.stopPropagation();
        context.toggle(rowId, event.currentTarget);
      }}
    >
      <span aria-hidden="true">i</span>
    </button>
  );
}

function MasterInfoPanel({ item, anchor, dialogId, onClose }: {
  item: MasterInfoItem;
  anchor: HTMLButtonElement;
  dialogId: string;
  onClose(restoreFocus: boolean): void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    function reposition() {
      if (!panel || !anchor.isConnected) {
        onClose(false);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      // An anchor outside a scrolling ancestor should not leave detached information onscreen.
      let ancestor = anchor.parentElement;
      while (ancestor) {
        const style = window.getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        const clipsX = /auto|scroll|hidden|clip/.test(style.overflowX || style.overflow);
        const clipsY = /auto|scroll|hidden|clip/.test(style.overflowY || style.overflow);
        if ((clipsX && bounds.width > 0 && (rect.right <= bounds.left || rect.left >= bounds.right)) ||
          (clipsY && bounds.height > 0 && (rect.bottom <= bounds.top || rect.top >= bounds.bottom))) {
          onClose(false);
          return;
        }
        ancestor = ancestor.parentElement;
      }
      if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) {
        onClose(false);
        return;
      }
      const margin = 12;
      const gap = 8;
      const size = panel.getBoundingClientRect();
      const below = viewportHeight - rect.bottom - margin - gap;
      const above = rect.top - margin - gap;
      const top = size.height <= below || below >= above
        ? rect.bottom + gap
        : rect.top - gap - size.height;
      setPosition({
        left: Math.max(margin, Math.min(rect.left, viewportWidth - size.width - margin)),
        top: Math.max(margin, Math.min(top, viewportHeight - size.height - margin)),
      });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(reposition) : null;
    observer?.observe(panel);
    observer?.observe(anchor);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      observer?.disconnect();
    };
  }, [anchor, item, onClose]);

  useLayoutEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function outsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element) || panelRef.current?.contains(target)) return;
      // Let another button in this table switch the selection in its own click handler.
      if (target.closest("[data-master-info-owner]")?.getAttribute("data-master-info-owner") === dialogId) return;
      onClose(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    }
    document.addEventListener("click", outsideClick, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outsideClick, true);
      document.removeEventListener("keydown", escape);
    };
  }, [dialogId, onClose]);

  return (
    <div
      ref={panelRef}
      id={dialogId}
      className="master-info-popover"
      role="dialog"
      aria-labelledby={`${dialogId}-title`}
      style={{ left: position?.left, top: position?.top, visibility: position ? undefined : "hidden" }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="master-info-header">
        <h2 id={`${dialogId}-title`}>{item.title}</h2>
        <button ref={closeButtonRef} type="button" className="button secondary" onClick={() => onClose(true)}>
          閉じる
        </button>
      </div>
      <div className="master-info-body">
        {hasText(item.description) && <section><h3>説明</h3><p>{item.description}</p></section>}
        {hasText(item.notes) && <section><h3>備考</h3><p>{item.notes}</p></section>}
      </div>
    </div>
  );
}
