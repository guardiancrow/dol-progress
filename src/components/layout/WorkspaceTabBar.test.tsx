// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import type { WorkspaceTabInfo } from "../../workspaceTabs/state";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("reveals the complete selected or focused tab without scrolling the surrounding page", async () => {
  const user = userEvent.setup();
  const tabs: WorkspaceTabInfo[] = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    page: index % 2 === 0 ? "quests" : "discoveries",
    name: `検索条件を識別できる長いタブ名 ${index + 1}`,
  }));
  const actions = { onCreate: vi.fn(), onSelect: vi.fn(), onRename: vi.fn(), onClose: vi.fn(), onRestore: vi.fn() };
  let onResize: (() => void) | undefined;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { onResize = callback; }
    observe() {}
    disconnect() {}
  });
  const workspace = (activeId: number) => <div data-testid="workspace-scroll">
    <WorkspaceTabBar {...actions} tabs={tabs} activeId={activeId} />
  </div>;
  const view = render(workspace(1));
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

  const last = buttons[5]!;
  view.rerender(workspace(6));
  expect(last).toHaveAttribute("aria-selected", "true");
  expect(last).toHaveAttribute("title", `${tabs[5]!.name}（発見物）`);
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
