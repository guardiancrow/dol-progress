// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { WorkspaceTabs, type WorkspaceTabInfo } from "../../workspaceTabs/state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])("reveals the selected or focused tab without scrolling the surrounding page (overview=%s)", async withOverview => {
  const user = userEvent.setup();
  const tabs: WorkspaceTabInfo[] = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    page: index % 2 === 0 ? "quests" : "discoveries",
    name: `検索条件を識別できる長いタブ名 ${index + 1}`,
  }));
  if (withOverview) tabs.unshift({ id: 7, page: "overview", name: "概要" });
  const actions = { onCreate: vi.fn(), onSelect: vi.fn(), onRename: vi.fn(), onClose: vi.fn(), onRestore: vi.fn(), onMove: vi.fn() };
  let onResize: (() => void) | undefined;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { onResize = callback; }
    observe() {}
    disconnect() {}
  });
  const workspace = (activeId: number) => <div data-testid="workspace-scroll">
    <WorkspaceTabBar {...actions} tabs={tabs} activeId={activeId} />
  </div>;
  const view = render(workspace(tabs[0]!.id));
  const outer = screen.getByTestId("workspace-scroll");
  const list = screen.getByRole("tablist");
  const buttons = screen.getAllByRole("tab");
  const listLeft = 100;
  let listWidth = 340;
  Object.defineProperty(list, "clientWidth", { get: () => listWidth });
  vi.spyOn(list, "getBoundingClientRect").mockImplementation(() => new DOMRect(listLeft, 20, listWidth, 34));
  buttons.forEach((button, index) => {
    vi.spyOn(button.parentElement!, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(listLeft + index * 150 - list.scrollLeft, 20, 145, 34),
    );
  });
  outer.scrollTop = 73;

  const last = buttons[buttons.length - 1]!;
  const lastTab = tabs[tabs.length - 1]!;
  view.rerender(workspace(lastTab.id));
  expect(last).toHaveAttribute("aria-selected", "true");
  expect(last).toHaveAttribute("title", `${lastTab.name}（発見物）`);
  expect(last.parentElement!.getBoundingClientRect().right).toBe(listLeft + listWidth);

  listWidth = 200;
  onResize?.();
  expect(last.parentElement!.getBoundingClientRect().right).toBe(listLeft + listWidth);

  act(() => { last.focus(); });
  await user.keyboard("{Home}");
  expect(buttons[0]).toHaveFocus();
  expect(list.scrollLeft).toBe(0);
  expect(last).toHaveAttribute("aria-selected", "true");
  expect(actions.onSelect).not.toHaveBeenCalled();
  expect(outer.scrollTop).toBe(73);

  const plus = screen.getByRole("button", { name: "新しいタブ" });
  await user.click(plus);
  const choice = screen.getByRole("button", { name: "クエストを開く" });
  expect(list).not.toContainElement(choice);
  expect(choice).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(plus).toHaveFocus();
});

function renderMovableTabs(count = 3, railWidth = 330) {
  const store = new WorkspaceTabs();
  const first = store.open("quests", "クエストA")!;
  const selected = store.open("quests", "クエストB")!;
  const overview = store.openOverview();
  for (let index = 3; index < count; index++) store.open("discoveries", `発見物${index}`);
  const onSelect = vi.fn(), onClose = vi.fn(), onRename = vi.fn();
  function Bar() {
    const tabs = useSyncExternalStore(store.subscribe, store.getOpenTabs);
    return <WorkspaceTabBar tabs={tabs} activeId={selected} onMove={store.move} onClose={onClose} onSelect={onSelect}
      onCreate={vi.fn()} onRename={onRename} onRestore={vi.fn()} />;
  }
  const { container } = render(<Bar />);
  const rail = screen.getByRole("tablist");
  let offset = 0;
  const tabWidth = 100;
  Object.defineProperties(rail, {
    clientWidth: { value: railWidth },
    scrollLeft: { get: () => offset, set: (value: number) => { offset = Math.max(0, Math.min(count * tabWidth - railWidth, value)); } },
  });
  vi.spyOn(rail, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 15, railWidth, 34));
  for (const group of Array.from(rail.children)) {
    vi.spyOn(group, "getBoundingClientRect").mockImplementation(() => {
      const index = Array.from(rail.children).indexOf(group);
      return new DOMRect(20 + index * tabWidth - offset, 15, tabWidth, 34);
    });
  }
  const tab = (name: string) => within(rail).getByRole("tab", { name });
  const order = () => within(rail).getAllByRole("tab").map(button => button.textContent);
  const insertion = () => container.querySelector<HTMLElement>(".workspace-tab-insertion");
  return { user: userEvent.setup(), store, rail, first, selected, overview, tab, order, insertion, onSelect, onClose, onRename };
}

const pointerAt = (clientX: number, clientY = 30) => ({ pointerType: "mouse", pointerId: 8, isPrimary: true, button: 0, clientX, clientY });

it("drags same-kind and overview tabs in both directions without selecting or closing a tab", () => {
  const { rail, order, tab, insertion, onSelect, onClose } = renderMovableTabs();
  const first = tab("クエストA"), overview = tab("概要");
  const close = within(rail).getByRole("button", { name: "クエストBを閉じる" });
  fireEvent.pointerDown(first, pointerAt(60));
  fireEvent.pointerMove(window, pointerAt(195));
  expect(insertion()).toBeInTheDocument();
  expect(order()).toEqual(["クエストA", "クエストB", "概要"]);
  fireEvent.pointerUp(close, pointerAt(195));
  fireEvent.click(close, { detail: 1 });
  expect(order()).toEqual(["クエストB", "クエストA", "概要"]);
  expect(onClose).not.toHaveBeenCalled();
  expect(first).toHaveFocus();
  expect(tab("クエストB")).toHaveAttribute("aria-selected", "true");

  fireEvent.pointerDown(overview, pointerAt(270));
  fireEvent.pointerMove(window, pointerAt(30));
  fireEvent.pointerUp(window, pointerAt(30));
  fireEvent.click(overview, { detail: 1 });
  expect(order()).toEqual(["概要", "クエストB", "クエストA"]);
  expect(overview).toHaveFocus();
  expect(onSelect).not.toHaveBeenCalled();
  expect(insertion()).not.toBeInTheDocument();

  fireEvent.pointerDown(overview, pointerAt(30));
  fireEvent.pointerUp(overview, pointerAt(30));
  fireEvent.click(overview, { detail: 1 });
  expect(onSelect).toHaveBeenCalledOnce();
});

it.each(["original position", "Escape", "outside", "pointer cancel"])("keeps the order on %s and suppresses a drag click", reason => {
  const { order, tab, insertion, onSelect } = renderMovableTabs();
  const source = tab("クエストA");
  fireEvent.pointerDown(source, pointerAt(60));
  fireEvent.pointerMove(window, pointerAt(295));
  if (reason === "Escape") fireEvent.keyDown(source, { key: "Escape" });
  if (reason === "pointer cancel") fireEvent.pointerCancel(window, pointerAt(295));
  const end = reason === "original position" ? pointerAt(60) : reason === "outside" ? pointerAt(295, 200) : pointerAt(295);
  fireEvent.pointerMove(window, end);
  fireEvent.pointerUp(window, end);
  fireEvent.click(source, { detail: 1 });
  expect(order()).toEqual(["クエストA", "クエストB", "概要"]);
  expect(insertion()).not.toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();
});

it("keeps a click with slight movement and leaves close, create and rename controls local", async () => {
  const { user, rail, order, insertion, tab, onSelect, onClose, onRename } = renderMovableTabs();
  const source = tab("クエストA");
  fireEvent.pointerDown(source, pointerAt(60));
  fireEvent.pointerMove(window, pointerAt(63, 32));
  fireEvent.pointerUp(source, pointerAt(63, 32));
  fireEvent.click(source, { detail: 1 });
  expect(onSelect).toHaveBeenCalledOnce();

  const close = within(rail).getByRole("button", { name: "クエストBを閉じる" });
  fireEvent.pointerDown(close, pointerAt(190));
  fireEvent.pointerMove(window, pointerAt(270));
  fireEvent.pointerUp(window, pointerAt(270));
  expect(insertion()).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  await user.click(close);
  expect(onClose).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "タブ名を変更" }));
  const editor = screen.getByRole("textbox", { name: "タブ名" });
  fireEvent.pointerDown(editor, pointerAt(60));
  fireEvent.pointerMove(window, pointerAt(295));
  fireEvent.pointerUp(window, pointerAt(295));
  expect(editor).toHaveFocus();
  await user.clear(editor);
  await user.type(editor, "編集後{Enter}");
  expect(onRename).toHaveBeenCalledWith(2, "編集後");
  await user.click(screen.getByRole("button", { name: "新しいタブ" }));
  const create = screen.getByRole("button", { name: "クエストを開く" });
  fireEvent.pointerDown(create, pointerAt(60));
  fireEvent.pointerMove(window, pointerAt(295));
  fireEvent.pointerUp(window, pointerAt(295));
  expect(order()).toEqual(["クエストA", "クエストB", "概要"]);
  expect(insertion()).not.toBeInTheDocument();
});

it("moves the focused or selected tab through keyboard commands and announces its position", async () => {
  const { user, order, tab, onSelect } = renderMovableTabs();
  act(() => tab("クエストB").focus());
  await user.keyboard("{ArrowLeft}");
  expect(tab("クエストA")).toHaveFocus();
  expect(order()).toEqual(["クエストA", "クエストB", "概要"]);
  await user.keyboard("{Shift>}{F10}{/Shift}");
  expect(screen.getByRole("button", { name: "左へ移動" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "右へ移動" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(order()).toEqual(["クエストB", "クエストA", "概要"]);
  expect(tab("クエストA")).toHaveFocus();
  expect(screen.getByText("「クエストA」を3件中2番目に移動しました。").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  await user.keyboard("{End}{Shift>}{F10}{/Shift}");
  expect(screen.getByRole("button", { name: "右へ移動" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(tab("概要")).toHaveFocus();
  await user.keyboard("{Shift>}{F10}{/Shift}{Enter}");
  expect(order()).toEqual(["クエストB", "概要", "クエストA"]);
  await user.click(screen.getByRole("button", { name: "タブを並べ替え" }));
  await user.keyboard("{Enter}");
  expect(order()).toEqual(["概要", "クエストB", "クエストA"]);
  expect(tab("クエストB")).toHaveFocus();
  expect(tab("クエストB")).toHaveAttribute("aria-selected", "true");
  expect(onSelect).not.toHaveBeenCalled();
});

it.each([6, 7])("scrolls the tab rail during a drag to an initially hidden tab (%i tabs)", count => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(handle => { frames.delete(handle); });
  const { order, tab, rail, insertion } = renderMovableTabs(count, 220);
  rail.scrollLeft = 100;
  const source = tab("クエストB");
  fireEvent.pointerDown(source, pointerAt(70));
  fireEvent.pointerMove(window, pointerAt(237));
  const advance = () => act(() => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach(callback => callback(0));
  });
  for (let frame = 0; frame < 60; frame++) advance();
  expect(rail.scrollLeft).toBe(count * 100 - 220);
  expect(insertion()).toBeInTheDocument();
  fireEvent.pointerUp(window, pointerAt(237));
  expect(order()[count - 1]).toBe("クエストB");
  expect(source).toHaveFocus();
  expect(source).toHaveAttribute("aria-selected", "true");
  expect(frames.size).toBe(0);
});
