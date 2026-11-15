// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestsPage } from "../pages/QuestsPage";
import { AppShell } from "../components/layout/AppShell";
import { ProfileProvider } from "../profiles/ProfileContext";
import { mockWorkspaceMedia } from "../components/layout/responsiveTestMedia";
import type { QuestWithDiscoveries } from "../domain/models";

const hold = vi.hoisted(() => ({ changed: (() => undefined) as () => void,
  state: "ready" as "ready" | "loading" | "error", reload: vi.fn(async () => undefined) }));
vi.mock("../discoveries/useReportHold", () => ({ useReportHold: (_profile: number, changed: () => void) => {
  hold.changed = changed;
  return { summaries: new Map(), summaryReadState: hold.state, loading: false, busy: false, dialog: null, selection: null, error: null, notice: null, reload: hold.reload };
} }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.5.0") }));
beforeEach(() => { hold.state = "ready"; hold.reload.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(count = 6) {
  const dependencies = [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6]].map(([from, to]) => ({ prerequisiteQuestId: from!, questId: to! }));
  const masters: QuestWithDiscoveries[] = Array.from({ length: count }, (_, i) => ({ quest: {
    id: i + 1, gvdbId: 1001 + i, title: `依頼${i + 1}`, offerMethod: "冒険クエスト", isActive: true,
    notes: "未開示の備考と説明", difficulty: 1, chronoQuest: null, offerCity: "ロンドン", requiredSkills: null, discoveryTypeText: null, rewardItems: null,
    chainName: null, chainOrder: null, sourceUpdatedAt: null, createdAt: "synthetic", updatedAt: "synthetic", rawRowJson: "{}",
  }, discoveries: [], requiredSkillsNormalized: [], offerCities: [] }));
  const syncRaw = () => { for (const { quest } of masters) quest.rawRowJson = JSON.stringify({
    前提クエスト: dependencies.filter(d => d.questId === quest.id).map(d => `${1000 + d.prerequisiteQuestId}:合成`).join(","),
    後続クエスト: dependencies.filter(d => d.prerequisiteQuestId === quest.id).map(d => `${1000 + d.questId}:合成`).join(","),
  }); }; syncRaw();
  const stored = new Map([[1, new Set([5])], [2, new Set([1, 2, 3, 4, 5, 6])]]);
  const progress = { listCompletedQuestIds: vi.fn(async (profileId: number) => [...stored.get(profileId)!]), markCompleted: vi.fn(async () => undefined),
    markIncomplete: vi.fn(async (profileId: number, questId: number) => { stored.get(profileId)!.delete(questId); }) };
  const quests = { listWithDiscoveries: vi.fn(async () => masters), listDependencies: vi.fn(async () => dependencies) };
  const profiles = { list: vi.fn(async () => [1, 2].map(id => ({ id, name: `合成プロフィール${id}`, memo: null, createdAt: "synthetic", updatedAt: "synthetic" }))), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const link = { completeQuestWithLinkedDiscoveries: vi.fn(async (profileId: number, questId: number) => {
    stored.get(profileId)!.add(questId); return { questChanged: true, discoveriesCreated: 1, discoveriesAlreadyPresent: 0 };
  }), discoverWithLinkedQuest: vi.fn() };
  return { dependencies, masters, syncRaw, stored, progress, quests, profiles, link };
}
async function mount(f = fixture()) {
  const resize = mockWorkspaceMedia(800, 600);
  const view = render(<ProfileProvider repository={f.profiles}><AppShell currentPage="quests" onNavigate={() => undefined}>
    <QuestsPage onOpenMasterData={() => undefined} questRepository={f.quests} questProgressRepository={f.progress} progressLinkService={f.link} />
  </AppShell></ProfileProvider>);
  await screen.findByRole("table"); return { ...view, f, resize, user: userEvent.setup() };
}
const panel = () => screen.getByRole("region", { name: "前提クエストの記録確認" });
const entry = (id = 5) => screen.getByRole("button", { name: new RegExp(`（依頼${id}の前提クエストを確認）$`) });
const start = (id = 4) => within(panel()).getByRole("button", { name: `前提「依頼${id}」を達成済みにする…` });
const submit = () => screen.getByRole("button", { name: "達成済みにする" });
async function open(f = fixture(), id = 5) { const result = await mount(f); await result.user.click(entry(id)); return result; }

describe("prerequisite record review from canonical name cells", () => {
  it("retains nine columns, one unchanged name string per cell, and no action for canonical blanks including raw-only references", async () => {
    const f = fixture(); f.masters[0]!.quest.rawRowJson = JSON.stringify({ 前提クエスト: "1002:原文だけの前提", 後続クエスト: "1002:依頼2" });
    const { user } = await mount(f);
    expect(screen.getAllByRole("columnheader")).toHaveLength(9);
    expect(screen.queryByRole("columnheader", { name: "関係" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /（依頼1の前提クエストを確認）$/ })).not.toBeInTheDocument();
    expect(entry()).toHaveTextContent(/^依頼4$/); expect(entry()).not.toHaveAttribute("title");
    expect(entry()).toHaveAttribute("aria-expanded", "false");
    const text = entry().outerHTML;
    await user.click(entry()); expect(panel()).toHaveTextContent("依頼5の前提を確認");
    expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
    expect(text).not.toMatch(/候補|未達成|1004|内部ID|件/);
  });
  it("renders only explicitly opened direct prerequisites, never notes, subsequent data or hidden ancestor details, and removes detail content on close", async () => {
    const f = fixture(); f.masters[5]!.quest.title = "未知の後継名"; f.syncRaw();
    const { user } = await mount(f); await user.type(screen.getByRole("searchbox"), "依頼5");
    expect(document.body.textContent).not.toMatch(/未開示|未知の後継名|依頼3|1004/);
    await user.click(entry()); expect(panel()).toHaveTextContent("GVDB ID: 1004");
    expect(document.body.textContent).not.toMatch(/未開示|未知の後継名|依頼3|1006/);
    expect(panel().innerHTML).not.toMatch(/後継|後続|目標|経路|title=/);
    await user.click(within(panel()).getByRole("button", { name: "依頼4の前提を確認" }));
    expect(panel()).toHaveTextContent("GVDB ID: 1003"); expect(panel()).not.toHaveTextContent("依頼2");
    expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "前の確認に戻る" }));
    await user.click(within(panel()).getByRole("button", { name: "前提の記録確認を閉じる" }));
    expect(entry()).toHaveFocus(); expect(document.body.innerHTML).not.toMatch(/1003|1004|未知の後継名|未開示の備考/);
    expect(document.querySelector(".prerequisite-review")!.textContent).toBe("");
    expect(f.quests.listDependencies).toHaveBeenCalledTimes(1); expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(1);
  });
  it("keeps (i) disclosure separate and renders its notes only on the existing explicit action", async () => {
    const { user } = await mount();
    expect(document.body.textContent).not.toContain("未開示の備考");
    await user.click(screen.getByRole("button", { name: "依頼5の備考を表示" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("未開示の備考と説明");
    await user.keyboard("{Escape}"); await user.click(entry());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(panel()).not.toHaveTextContent("未開示の備考");
  });
  it("does not disclose a deeper level's multiple-prerequisite diagnostic before that level is explicitly opened", async () => {
    const f = fixture(); f.dependencies.push({ questId: 4, prerequisiteQuestId: 2 }); f.syncRaw();
    const { user } = await open(f);
    expect(start()).toBeInTheDocument(); expect(panel()).not.toHaveTextContent("AND/OR");
    expect(panel()).not.toHaveTextContent("依頼2"); expect(panel()).not.toHaveTextContent("依頼3");
    await user.click(within(panel()).getByRole("button", { name: "依頼4の前提を確認" }));
    expect(panel()).toHaveTextContent("AND/OR"); expect(panel()).toHaveTextContent("依頼2");
  });
  it("uses the unchanged candidate pair and shared confirmation to save one quest and re-read progress", async () => {
    const { f, user } = await open(); await user.click(start());
    expect(screen.getByRole("group", { name: "前提クエストの達成登録" })).toHaveTextContent("合成プロフィール1");
    await user.click(submit());
    await waitFor(() => expect(panel()).toHaveTextContent("前提「依頼4」を達成済みにしました。"));
    expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 4);
    expect(f.progress.markCompleted).not.toHaveBeenCalled(); expect(f.stored.get(1)).toEqual(new Set([4, 5]));
    expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(2); expect(panel()).toHaveTextContent("発見物 1件も発見済み");
    expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "依頼4の前提を確認" })); expect(start(3)).toBeInTheDocument();
  });
  it("does not infer A-to-C or grant B-to-C after B changes until the user explicitly rechecks B", async () => {
    const { f, user } = await open(); await user.click(within(panel()).getByRole("button", { name: "依頼4の前提を確認" }));
    expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "依頼4の達成状態" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "依頼4の達成状態" })).toBeChecked());
    expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "前提を再確認" })); expect(start(3)).toBeInTheDocument();
    expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 4);
  });
  it("requires a new explicit check after the current quest loses and regains its completed record", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("checkbox", { name: "依頼5の達成状態" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "依頼5の達成状態" })).not.toBeChecked());
    await user.click(screen.getByRole("checkbox", { name: "依頼5の達成状態" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "依頼5の達成状態" })).toBeChecked());
    expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "前提を再確認" })); expect(start()).toBeInTheDocument();
  });
  it("paginates broad direct prerequisites without adding empty further-prerequisite actions", async () => {
    const f = fixture(36); f.dependencies.splice(0, f.dependencies.length, ...Array.from({ length: 35 }, (_, i) => ({ questId: 1, prerequisiteQuestId: i + 2 }))); f.syncRaw();
    const { user } = await open(f, 1);
    expect(within(panel()).getAllByRole("listitem").filter(item => item.textContent?.includes("GVDB ID"))).toHaveLength(20);
    expect(within(panel()).queryByRole("button", { name: /^依頼\d+の前提を確認$/ })).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "前提の次ページ" }));
    expect(panel()).toHaveTextContent("GVDB ID: 1022"); expect(panel()).not.toHaveTextContent("GVDB ID: 1002");
  });
  it("detects a repeated local ID during explicitly opened multi-step cyclic review", async () => {
    const f = fixture(); f.dependencies.push({ questId: 1, prerequisiteQuestId: 5 }); f.syncRaw();
    const { user } = await open(f);
    for (const id of [4, 3, 2, 1]) await user.click(within(panel()).getByRole("button", { name: `依頼${id}の前提を確認` }));
    await user.click(within(panel()).getByRole("button", { name: "依頼5の前提を確認" }));
    expect(within(panel()).getByRole("heading", { name: "依頼1の前提を確認" })).toBeInTheDocument();
    expect(panel()).toHaveTextContent("既に確認したクエスト");
  });
  it.each(["multiple", "mismatch", "missing", "inactive", "map", "special", "self", "cycle"])("keeps known names readable and registration absent for %s", async kind => {
    const f = fixture();
    if (kind === "multiple") f.dependencies.push({ questId: 5, prerequisiteQuestId: 2 });
    if (kind === "missing") f.dependencies.push({ questId: 5, prerequisiteQuestId: 99 });
    if (kind === "inactive") f.masters[3]!.quest.isActive = false;
    if (kind === "map") f.masters[3]!.quest.offerMethod = "地理学";
    if (kind === "special") f.masters[3]!.quest.offerMethod = "追究クエスト";
    if (kind === "self") f.dependencies.push({ questId: 5, prerequisiteQuestId: 5 });
    if (kind === "cycle") f.dependencies.push({ questId: 1, prerequisiteQuestId: 5 });
    f.syncRaw(); if (kind === "mismatch") f.masters[4]!.quest.rawRowJson = "{}";
    const { user } = await open(f); expect(panel()).toHaveTextContent("依頼4"); expect(panel()).toHaveTextContent("要確認");
    expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
    if (kind === "self") { await user.click(within(panel()).getByRole("button", { name: "依頼5の前提を確認" })); expect(panel()).toHaveTextContent("既に確認した"); }
    expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
  });
  it("uses local IDs for identical names and keeps one name-list action for multiple prerequisites", async () => {
    const f = fixture(); f.masters[2]!.quest.title = f.masters[3]!.quest.title = "同名";
    f.dependencies.push({ questId: 5, prerequisiteQuestId: 3 }); f.syncRaw();
    const { user } = await mount(f); expect(entry()).toHaveTextContent(/^同名、同名$/); await user.click(entry());
    expect(panel()).toHaveTextContent("GVDB ID: 1003"); expect(panel()).toHaveTextContent("GVDB ID: 1004");
    expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
  });
  it.each(["loading", "error"] as const)("never displays unconfirmed records as incomplete while %s", async state => {
    hold.state = state; const { user } = await mount(); await user.click(entry());
    expect(panel()).toHaveTextContent("達成記録は未確認"); expect(panel()).not.toHaveTextContent("未達成として記録");
    expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
  });
  it("does not fabricate progress when no profile is selected", async () => {
    const f = fixture(); f.profiles.list.mockResolvedValueOnce([]); await mountWithoutTable(f);
    expect(await screen.findByText("クエスト進捗を表示するプロフィールを選択してください")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument(); expect(f.progress.listCompletedQuestIds).not.toHaveBeenCalled();
  });
  it("shares one panel with candidates and prevents view switches while confirming and saving", async () => {
    const { f, user } = await open(); const reviewEntry = screen.getByRole("button", { name: "進捗の確認候補 1件" });
    await user.click(start()); expect(reviewEntry).toBeDisabled(); expect(entry(4)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "キャンセル" })); await user.click(reviewEntry);
    expect(screen.queryByRole("region", { name: "前提クエストの記録確認" })).not.toBeInTheDocument();
    const candidatePanel = screen.getByRole("region", { name: "前提クエストの進捗確認候補" });
    await user.click(within(candidatePanel).getByRole("button", { name: "前提「依頼4」を達成済みにする…" }));
    expect(entry()).toBeDisabled(); await user.click(screen.getByRole("button", { name: "キャンセル" })); await user.click(entry());
    const saving = deferred<Awaited<ReturnType<typeof f.link.completeQuestWithLinkedDiscoveries>>>();
    f.link.completeQuestWithLinkedDiscoveries.mockImplementationOnce(() => saving.promise);
    await user.click(start()); const button = submit(); fireEvent.click(button); fireEvent.click(button);
    expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox", { name: "依頼3の達成状態" })).toBeDisabled();
    await user.keyboard("{Escape}"); expect(screen.getByRole("group", { name: "前提クエストの達成登録" })).toBeInTheDocument();
    await act(async () => { f.stored.get(1)!.add(4); saving.resolve({ questChanged: true, discoveriesCreated: 0, discoveriesAlreadyPresent: 0 }); });
    await waitFor(() => expect(panel()).toHaveTextContent("前提「依頼4」を達成済みにしました。"));
  });
  it.each([false, true])("does not equate a rejected save with success (committed=%s)", async committed => {
    const f = fixture(); f.link.completeQuestWithLinkedDiscoveries.mockImplementationOnce(async () => { if (committed) f.stored.get(1)!.add(4); throw Error("synthetic uncertain save"); });
    const { user } = await open(f); await user.click(start()); await user.click(submit());
    await waitFor(() => expect(panel()).toHaveTextContent("保存完了を確認できませんでした。"));
    expect(panel()).not.toHaveTextContent("前提「依頼4」を達成済みにしました。");
    expect(screen.getByRole("checkbox", { name: "依頼4の達成状態" })).toHaveProperty("checked", committed);
  });
  it.each(["saved", "uncertain"])("keeps failed re-reads unconfirmed after %s save and focuses recovery", async kind => {
    const { f, user } = await open(); f.progress.listCompletedQuestIds.mockRejectedValueOnce(Error("synthetic read failure"));
    if (kind === "uncertain") f.link.completeQuestWithLinkedDiscoveries.mockRejectedValueOnce(Error("synthetic save failure"));
    await user.click(start()); await user.click(submit());
    await screen.findByText(kind === "saved" ? "達成の保存は完了しましたが、進捗の再取得に失敗しました。再読み込みしてください。" : "進捗の再取得に失敗しました。再読み込みしてください。");
    expect(screen.queryByText("前提「依頼4」を達成済みにしました。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "再読み込み" })); await screen.findByRole("table");
  });
  it("discards history and stale confirmation on profile or master switch", async () => {
    const { f, user } = await open(); await user.click(start()); const stale = submit();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2"); await screen.findByRole("table"); fireEvent.click(stale);
    expect(screen.queryByRole("region", { name: "前提クエストの記録確認" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "1"); await screen.findByRole("table"); await user.click(entry());
    await user.click(start()); const staleMaster = submit(); f.masters[3]!.quest.isActive = false;
    act(() => { hold.changed(); fireEvent.click(staleMaster); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "前提クエストの記録確認" })).not.toBeInTheDocument());
    await user.click(entry()); expect(panel()).toHaveTextContent("inactive"); expect(within(panel()).queryByRole("button", { name: /達成済みにする/ })).not.toBeInTheDocument();
    expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
  });
  it("does not apply a delayed re-read to a later A/B/A generation", async () => {
    const { f, user } = await open(); const read = deferred<number[]>(); f.progress.listCompletedQuestIds.mockImplementationOnce(() => read.promise);
    await user.click(start()); await user.click(submit()); await waitFor(() => expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(2));
    for (const id of ["2", "1"]) { await user.selectOptions(screen.getByLabelText("現在のプロフィール"), id); await screen.findByRole("table"); }
    await act(async () => read.resolve([3]));
    expect(screen.getByRole("checkbox", { name: "依頼3の達成状態" })).not.toBeChecked();
    expect(screen.queryByText(/前提「依頼4」を達成済みにしました/)).not.toBeInTheDocument();
  });
  it("supports keyboard open/cancel/back/close and preserves table, filters, sort, page and size in priority mode", async () => {
    const f = fixture(120); f.dependencies.push({ questId: 105, prerequisiteQuestId: 104 }); f.syncRaw();
    const { user, resize } = await mount(f);
    await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
    await user.click(screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" })); await user.click(screen.getByRole("button", { name: "次ページ" }));
    const secondPageTable = screen.getByRole("table"), secondPageFirst = secondPageTable.querySelector("tbody tr");
    await user.click(entry(105));
    await user.click(within(panel()).getByRole("button", { name: "前提の記録確認を閉じる" }));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    expect(secondPageTable.querySelector("tbody tr")).toBe(secondPageFirst);
    await user.click(screen.getByRole("button", { name: "前ページ" }));
    const table = screen.getByRole("table");
    await user.type(screen.getByRole("searchbox"), "依頼5");
    const first = table.querySelector("tbody tr");
    await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    const origin = entry(); origin.focus(); await user.keyboard("{Enter}");
    expect(within(panel()).getByRole("heading", { name: "依頼5の前提を確認" })).toHaveFocus();
    start().focus(); await user.keyboard(" "); await user.tab(); expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus();
    await user.keyboard("{Escape}"); expect(start()).toHaveFocus(); await user.keyboard("{Escape}"); expect(origin).toHaveFocus();
    act(() => resize(1920, 1080)); expect(screen.getByRole("table")).toBe(table); expect(first).toBeInTheDocument();
    expect(screen.getByLabelText("1ページの件数")).toHaveValue("100");
    await user.click(screen.getByRole("button", { name: "検索・フィルターを表示" })); expect(screen.getByRole("searchbox")).toHaveValue("依頼5");
  });
  it("focuses a surviving list control if the origin disappears while details are open", async () => {
    const { user } = await open(); await user.type(screen.getByRole("searchbox"), "依頼1");
    await user.click(within(panel()).getByRole("button", { name: "前提の記録確認を閉じる" }));
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
  it.each([false, true])("keeps a focus destination after saving removes the only filtered origin (priority=%s)", async priority => {
    const f = fixture(); f.dependencies.splice(f.dependencies.findIndex(edge => edge.questId === 4), 1); f.syncRaw();
    const { user } = await mount(f);
    if (priority) await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    await user.click(screen.getByRole("button", { name: "進捗の確認候補 1件" }));
    await user.click(screen.getByRole("checkbox", { name: "候補のある後続だけを表示" }));
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" }));
    await user.click(entry()); await user.click(start()); await user.click(submit());
    await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());
    await user.click(within(panel()).getByRole("button", { name: "前提の記録確認を閉じる" }));
    expect(priority ? screen.getByLabelText("1ページの件数") : screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("button", { name: "候補フィルターを解除" })).toBeInTheDocument();
  });
});
async function mountWithoutTable(f: ReturnType<typeof fixture>) {
  mockWorkspaceMedia(800, 600);
  render(<ProfileProvider repository={f.profiles}><QuestsPage onOpenMasterData={() => undefined} questRepository={f.quests} questProgressRepository={f.progress} progressLinkService={f.link} /></ProfileProvider>);
}
