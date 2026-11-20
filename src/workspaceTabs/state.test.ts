import { describe, expect, it } from "vitest";
import { applySearchCondition } from "../searchConditions/application";
import type { QuestSearchCondition } from "../searchConditions/definition";
import { captureSearchCondition, questSearchOptions } from "../searchConditions/tableState";
import { WorkspaceTabs } from "./state";

describe("workspace tab state", () => {
  it("restores the most recently closed view in order with a fresh ID", () => {
    const tabs = new WorkspaceTabs();
    const first = tabs.open("quests")!;
    const middle = tabs.open("discoveries")!;
    const last = tabs.open("quests")!;
    tabs.rename(middle, "  復元対象  ");
    tabs.updateView(middle, view => ({ ...view, columnFilters: [{ id: "status", value: "unreported" }],
      sorting: [{ id: "name", desc: true }], pagination: { pageIndex: 2, pageSize: 100 } }));
    const before = tabs.get(middle);
    expect(tabs.close(middle)).toBe(last);
    const restored = tabs.restore()!;
    expect(restored).not.toBe(middle);
    expect(tabs.get(restored)).toEqual({ ...before, id: restored, name: "復元対象" });
    expect(tabs.getOpenTabs().map(tab => tab.id)).toEqual([first, restored, last]);
    tabs.updateView(middle, () => tabs.get(first)!.view);
    expect(tabs.get(restored)?.view).toEqual(before?.view);
    expect(tabs.restore()).toBeUndefined();
  });

  it("reserves a slot for a staged tab and keeps it off the tab bar until publication", () => {
    const tabs = new WorkspaceTabs();
    for (let count = 0; count < 5; count++) tabs.open("quests");
    const staged = tabs.open("discoveries", "準備中", true)!;
    expect(tabs.getOpenTabs()).toHaveLength(5);
    expect(tabs.open("quests")).toBeUndefined();
    tabs.discardStaged(staged);
    const replacement = tabs.open("discoveries", "承認済み", true)!;
    tabs.publishTab(replacement);
    expect(tabs.getOpenTabs()).toHaveLength(6);
    expect(tabs.getOpenTabs()[5]).toMatchObject({ id: replacement, name: "承認済み" });
  });

  it("isolates same-page IDs and retains a draft independently of bookmark validation", () => {
    const tabs = new WorkspaceTabs();
    const first = tabs.open("quests", "初期タブ")!;
    const second = tabs.open("quests", "比較用")!;
    const draft = [{ id: "title", value: "編集中" }, { id: "discoveries", value: "category:123" }];
    tabs.updateView(first, view => ({ ...view, columnFilters: draft }));

    expect(first).not.toBe(second);
    expect(tabs.get(first)).toMatchObject({ id: first, page: "quests", name: "初期タブ", view: { columnFilters: draft } });
    expect(tabs.get(second)?.view.columnFilters).toEqual([]);
    expect(captureSearchCondition({ page: "quests", options: questSearchOptions([]) }, tabs.get(first)!.view).status).toBe("blocked");
    expect(tabs.get(first)?.view.columnFilters).toEqual(draft);
    tabs.close(first);
    const replacement = tabs.open("quests", "新規")!;
    expect(replacement).not.toBe(first);
    tabs.updateView(first, view => ({ ...view, columnFilters: draft }));
    expect(tabs.get(first)).toBeUndefined();
    expect(tabs.get(second)?.view.columnFilters).toEqual([]);
    expect(tabs.get(replacement)?.view.columnFilters).toEqual([]);
  });

  it("publishes one replacement for a validated condition and preserves page size", () => {
    const tabs = new WorkspaceTabs();
    const id = tabs.open("quests", "クエスト")!;
    const definition: QuestSearchCondition = { schemaVersion: 1, page: "quests", search: "合成",
      filters: { completed: true }, sorting: [{ key: "difficulty", direction: "desc" }] };
    tabs.updateView(id, view => ({ ...view, columnFilters: [{ id: "offerCity", value: "city:旧" }],
      sorting: [{ id: "title", desc: false }], pagination: { pageIndex: 4, pageSize: 100 } }));
    const published: unknown[] = [];
    const unsubscribe = tabs.subscribe(() => published.push(tabs.get(id)?.view));
    const resolved = { columnFilters: [{ id: "title", value: "合成" }, { id: "completed", value: true }],
      sorting: [{ id: "difficulty", desc: true }] };

    tabs.updateView(id, view => applySearchCondition(view, definition, resolved));
    unsubscribe();
    expect(published).toEqual([{ ...resolved, appliedDefinition: definition, pagination: { pageIndex: 0, pageSize: 100 } }]);
  });

  it("returns every open view to the first page without changing its conditions or page size", () => {
    const tabs = new WorkspaceTabs();
    const quest = tabs.open("quests", "クエスト")!;
    const discovery = tabs.open("discoveries", "発見物")!;
    tabs.updateView(quest, view => ({ ...view, pagination: { pageIndex: 3, pageSize: 100 } }));
    tabs.updateView(discovery, view => ({ ...view, columnFilters: [{ id: "status", value: "unreported" }],
      sorting: [{ id: "name", desc: true }], pagination: { pageIndex: 5, pageSize: 50 } }));
    const before = tabs.get(discovery)!.view;

    tabs.resetPagination();
    expect(tabs.get(quest)?.view.pagination).toEqual({ pageIndex: 0, pageSize: 100 });
    expect(tabs.get(discovery)?.view).toEqual({ ...before, pagination: { pageIndex: 0, pageSize: 50 } });
  });
});
