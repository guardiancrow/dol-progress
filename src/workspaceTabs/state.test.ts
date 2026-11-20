import { describe, expect, it } from "vitest";
import { applySearchCondition } from "../searchConditions/application";
import type { QuestSearchCondition } from "../searchConditions/definition";
import { captureSearchCondition, questSearchOptions } from "../searchConditions/tableState";
import { WorkspaceTabs } from "./state";

describe("workspace tab state", () => {
  it("moves published IDs in both directions without changing their views or the staged slot", () => {
    const tabs = new WorkspaceTabs();
    const first = tabs.open("quests", "比較A")!;
    const second = tabs.open("quests", "比較B")!;
    const overview = tabs.openOverview();
    const staged = tabs.open("discoveries", "未公開", true)!;
    const order = () => tabs.getOpenTabs().map(tab => tab.id);
    tabs.updateView(first, view => ({ ...view, columnFilters: [{ id: "title", value: "合成" }],
      sorting: [{ id: "difficulty", desc: true }], pagination: { pageIndex: 2, pageSize: 100 } }));
    const firstView = tabs.getSearchView(first);
    const secondInfo = tabs.get(second);
    const original = tabs.getOpenTabs();
    let notifications = 0;
    tabs.subscribe(() => notifications++);
    expect(tabs.move(first, second, "before")).toBeUndefined();
    expect(tabs.move(first, first, "after")).toBeUndefined();
    expect(tabs.move(staged, first, "before")).toBeUndefined();
    expect(tabs.move(first, staged, "after")).toBeUndefined();
    expect(tabs.getOpenTabs()).toBe(original);
    expect(notifications).toBe(0);
    expect(tabs.move(first, second, "after")).toEqual({ position: 2, total: 3 });
    expect(tabs.move(overview, second, "before")).toEqual({ position: 1, total: 3 });
    expect(order()).toEqual([overview, second, first]);
    expect(tabs.getSearchView(first)).toBe(firstView);
    expect(tabs.get(second)).toBe(secondInfo);
    expect(notifications).toBe(2);
    tabs.publishTab(staged);
    expect(order()).toEqual([overview, second, first, staged]);

    expect(tabs.close(first)).toBe(staged);
    const restored = tabs.restore()!;
    expect(restored).not.toBe(first);
    expect(order()).toEqual([overview, second, restored, staged]);
    expect(tabs.getSearchView(restored)).toBe(firstView);
    expect(tabs.close(staged)).toBe(restored);
  });

  it("restores the most recently closed view in order with a fresh ID", () => {
    const tabs = new WorkspaceTabs();
    const first = tabs.open("quests")!;
    const middle = tabs.open("discoveries")!;
    const last = tabs.open("quests")!;
    tabs.rename(middle, "  復元対象  ");
    tabs.updateView(middle, view => ({ ...view, columnFilters: [{ id: "status", value: "unreported" }],
      sorting: [{ id: "name", desc: true }], pagination: { pageIndex: 2, pageSize: 100 } }));
    const before = tabs.get(middle);
    const beforeView = tabs.getSearchView(middle);
    expect(tabs.close(middle)).toBe(last);
    const restored = tabs.restore()!;
    expect(restored).not.toBe(middle);
    expect(tabs.get(restored)).toEqual({ ...before, id: restored, name: "復元対象" });
    expect(tabs.getOpenTabs().map(tab => tab.id)).toEqual([first, restored, last]);
    tabs.updateView(middle, () => tabs.getSearchView(first)!);
    expect(tabs.getSearchView(restored)).toEqual(beforeView);
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
    expect(tabs.getSearchView(second)?.columnFilters).toEqual([]);
    expect(captureSearchCondition({ page: "quests", options: questSearchOptions([]) }, tabs.getSearchView(first)!).status).toBe("blocked");
    expect(tabs.getSearchView(first)?.columnFilters).toEqual(draft);
    tabs.close(first);
    const replacement = tabs.open("quests", "新規")!;
    expect(replacement).not.toBe(first);
    tabs.updateView(first, view => ({ ...view, columnFilters: draft }));
    expect(tabs.get(first)).toBeUndefined();
    expect(tabs.getSearchView(second)?.columnFilters).toEqual([]);
    expect(tabs.getSearchView(replacement)?.columnFilters).toEqual([]);
  });

  it("publishes one replacement for a validated condition and preserves page size", () => {
    const tabs = new WorkspaceTabs();
    const id = tabs.open("quests", "クエスト")!;
    const definition: QuestSearchCondition = { schemaVersion: 1, page: "quests", search: "合成",
      filters: { completed: true }, sorting: [{ key: "difficulty", direction: "desc" }] };
    tabs.updateView(id, view => ({ ...view, columnFilters: [{ id: "offerCity", value: "city:旧" }],
      sorting: [{ id: "title", desc: false }], pagination: { pageIndex: 4, pageSize: 100 } }));
    const published: unknown[] = [];
    const unsubscribe = tabs.subscribe(() => published.push(tabs.getSearchView(id)));
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
    const before = tabs.getSearchView(discovery)!;

    tabs.resetPagination();
    expect(tabs.getSearchView(quest)?.pagination).toEqual({ pageIndex: 0, pageSize: 100 });
    expect(tabs.getSearchView(discovery)).toEqual({ ...before, pagination: { pageIndex: 0, pageSize: 50 } });
  });

  it("allows one fixed overview independently of six search slots including a staged one", () => {
    const tabs = new WorkspaceTabs();
    for (let i = 0; i < 5; i++) tabs.open("quests");
    const staged = tabs.open("discoveries", "検証中", true)!;
    const overview = tabs.openOverview();
    expect(tabs.openOverview()).toBe(overview);
    expect(tabs.open("quests")).toBeUndefined();
    expect(tabs.getOpenTabs()).toHaveLength(6);
    tabs.publishTab(staged);
    expect(tabs.getOpenTabs()).toHaveLength(7);
    tabs.rename(overview, "変更なし");
    tabs.updateView(overview, () => { throw new Error("overview has no search view"); });
    expect(tabs.get(overview)).toEqual({ id: overview, page: "overview", name: "概要" });
    expect(tabs.getSearchView(overview)).toBeUndefined();
    tabs.close(overview);
    const restored = tabs.restore();
    expect(restored).toBeDefined();
    expect(restored).not.toBe(overview);
    expect(tabs.getOpenTabs()).toHaveLength(7);
  });

  it("restores an overview to its existing tab when reopened before undo", () => {
    const tabs = new WorkspaceTabs();
    const first = tabs.openOverview();
    tabs.close(first);
    expect(tabs.getOpenTabs()).toHaveLength(0);
    const next = tabs.openOverview();
    expect(next).not.toBe(first);
    expect(tabs.restore()).toBe(next);
    expect(tabs.getOpenTabs()).toEqual([{ id: next, page: "overview", name: "概要" }]);
    expect(tabs.closedName).toBeUndefined();
  });
});
