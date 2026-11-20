import { useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { WorkspaceTabId, WorkspaceTabPlacement } from "../../workspaceTabs/state";

interface Insertion {
  targetId: WorkspaceTabId;
  placement: WorkspaceTabPlacement;
  marker: number;
}

const DRAG_THRESHOLD = 6;

function locateInsertion(rail: HTMLDivElement, tab: HTMLElement, x: number, y: number, scroll: boolean): Insertion | undefined {
  const left = rail.getBoundingClientRect().left + rail.clientLeft;
  const width = rail.clientWidth;
  const right = left + width;
  const row = tab.getBoundingClientRect();
  if (!width || !rail.contains(tab) || x < left || x >= right || y < row.top || y >= row.bottom) return;

  if (scroll) {
    const edge = Math.min(32, width / 4);
    const leftPressure = Math.max(0, edge - (x - left));
    const rightPressure = Math.max(0, edge - (right - x));
    if (leftPressure || rightPressure) rail.scrollLeft += 12 * (rightPressure - leftPressure) / edge;
  }

  const candidates = Array.from(rail.children).filter((item): item is HTMLElement => item instanceof HTMLElement && item !== tab);
  const next = candidates.find(item => {
    const bounds = item.getBoundingClientRect();
    return x < bounds.left + bounds.width / 2;
  });
  const target = next ?? candidates[candidates.length - 1];
  if (!target) return;
  const bounds = target.getBoundingClientRect();
  const edge = (next ? bounds.left : bounds.right) - left;
  return { targetId: Number(target.dataset.workspaceTabId), placement: next ? "before" : "after",
    marker: Math.min(width - 2, Math.max(2, edge)) + rail.clientLeft };
}

export function useWorkspaceTabDrag(
  tabList: RefObject<HTMLDivElement | null>,
  onDrop: (id: WorkspaceTabId, targetId: WorkspaceTabId, placement: WorkspaceTabPlacement) => void,
) {
  const [preview, setPreview] = useState<{ id: WorkspaceTabId; marker?: number }>();
  const suppressClick = useRef(false);
  const dispose = useRef<() => void>(undefined);
  const drop = useRef(onDrop);
  useLayoutEffect(() => { drop.current = onDrop; }, [onDrop]);
  useLayoutEffect(() => () => dispose.current?.(), []);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: WorkspaceTabId) {
    const list = tabList.current;
    const source = event.currentTarget.parentElement;
    if (!list || !source || list.childElementCount < 2 || event.button !== 0 || event.pointerType !== "mouse") return;
    dispose.current?.();

    const { pointerId, clientX: startX, clientY: startY } = event;
    let x = startX, y = startY;
    let dragging = false;
    let frame = 0;
    let previewMarker: number | undefined | null = null;
    const listeners = new window.AbortController();
    const options = { signal: listeners.signal };

    const refresh = (scroll = false) => {
      const marker = locateInsertion(list, source, x, y, scroll)?.marker;
      if (marker === previewMarker) return;
      previewMarker = marker;
      setPreview({ id, marker });
    };

    function animate() {
      refresh(true);
      frame = window.requestAnimationFrame(animate);
    }

    const cleanUp = () => {
      listeners.abort();
      window.cancelAnimationFrame(frame);
      if (list.hasPointerCapture?.(pointerId)) list.releasePointerCapture(pointerId);
      dispose.current = undefined;
    };

    function finish() {
      cleanUp();
      if (dragging) setPreview(undefined);
    }

    window.addEventListener("pointermove", move => {
      if (move.pointerId !== pointerId) return;
      ({ clientX: x, clientY: y } = move);
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        suppressClick.current = true;
        list.setPointerCapture?.(pointerId);
        frame = window.requestAnimationFrame(animate);
      }
      move.preventDefault();
      refresh();
    }, options);
    window.addEventListener("pointerup", up => {
      if (up.pointerId !== pointerId) return;
      ({ clientX: x, clientY: y } = up);
      const insertion = dragging ? locateInsertion(list, source, x, y, false) : undefined;
      finish();
      if (insertion) drop.current(id, insertion.targetId, insertion.placement);
    }, options);
    window.addEventListener("pointercancel", cancel => { if (cancel.pointerId === pointerId) finish(); }, options);
    list.addEventListener("lostpointercapture", lost => { if (lost.pointerId === pointerId) finish(); }, options);
    window.addEventListener("blur", finish, options);
    window.addEventListener("keydown", key => {
      if (key.key !== "Escape" || !dragging) return;
      key.preventDefault();
      key.stopPropagation();
      finish();
    }, { ...options, capture: true });
    dispose.current = cleanUp;
  }

  function preventDragClick(event: MouseEvent) {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return { preview, startDrag, preventDragClick, clearDragClick: () => { suppressClick.current = false; } };
}
