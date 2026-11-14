// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestsPage } from "../pages/QuestsPage";
import { AppShell } from "../components/layout/AppShell";
import { ProfileProvider } from "../profiles/ProfileContext";
import type { QuestWithDiscoveries } from "../domain/models";
import { mockWorkspaceMedia } from "../components/layout/responsiveTestMedia";

const hold = vi.hoisted(() => ({ changed: (() => undefined) as () => void, state: "ready" as "ready" | "loading" | "error",
  busy: false, reload: vi.fn(async () => undefined) }));
vi.mock("../discoveries/useReportHold", () => ({ useReportHold: (_id: number, changed: () => void) => {
  hold.changed = changed;
  return { summaries: new Map(), summaryReadState: hold.state, loading: false, busy: hold.busy, dialog: null, selection: null, error: null, notice: null, reload: hold.reload };
} }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.4.0") }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => { hold.state = "ready"; hold.busy = false; hold.reload.mockClear(); });

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixtures(count = 1) {
  const dependencies = Array.from({ length: count }, (_, i) => ({ questId: 2 * i + 2, prerequisiteQuestId: 2 * i + 1 }));
  const masters: QuestWithDiscoveries[] = Array.from({ length: count * 2 }, (_, i) => {
    const id = i + 1;
    return { quest: { id, gvdbId: id + 1000, title: `${id % 2 ? "前提" : "後続"}${Math.ceil(id / 2)}`, offerMethod: "冒険クエスト", isActive: true,
      notes: null, difficulty: 1, chronoQuest: null, offerCity: id === 4 ? "セビリア" : "ロンドン", requiredSkills: null, discoveryTypeText: null, rewardItems: null, chainName: null, chainOrder: null,
      sourceUpdatedAt: null, createdAt: "synthetic", updatedAt: "synthetic",
      rawRowJson: JSON.stringify({ 前提クエスト: id % 2 ? "" : `${id + 999}:合成`, 後続クエスト: id % 2 ? `${id + 1001}:合成` : "" }) },
      discoveries: [], requiredSkillsNormalized: [], offerCities: [{ position: 0, cityName: id === 4 ? "セビリア" : "ロンドン" }] };
  });
  const stored = new Map([[1, new Set(dependencies.map(d => d.questId))], [2, new Set(masters.map(m => m.quest.id))]]);
  const progress = {
    listCompletedQuestIds: vi.fn(async (id: number) => [...stored.get(id)!]),
    markCompleted: vi.fn(async (id: number, q: number) => { stored.get(id)!.add(q); }),
    markIncomplete: vi.fn(async (id: number, q: number) => { stored.get(id)!.delete(q); }),
  };
  const quests = { listWithDiscoveries: vi.fn(async () => masters), listDependencies: vi.fn(async () => dependencies) };
  const profiles = { list: vi.fn(async () => [1, 2].map(id => ({ id, name: `合成プロフィール${id}`, memo: null, createdAt: "synthetic", updatedAt: "synthetic" }))), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const link = { completeQuestWithLinkedDiscoveries: vi.fn(async (id: number, q: number) => {
    await progress.markCompleted(id, q); return { questChanged: true, discoveriesCreated: 0, discoveriesAlreadyPresent: 0 };
  }), discoverWithLinkedQuest: vi.fn() };
  return { masters, dependencies, stored, progress, quests, profiles, link };
}
type Fixture = ReturnType<typeof fixtures>;
const panel = () => screen.getByRole("region", { name: "前提クエストの進捗確認候補" });
const entry = (count: number) => screen.getByRole("button", { name: `進捗の確認候補 ${count}件` });
const numericEntry = () => screen.queryByRole("button", { name: /^進捗の確認候補 \d+件$/ });
function mount(f: Fixture, onCommit: () => void = () => undefined) {
  const resize = mockWorkspaceMedia(1920, 1080);
  const view = render(<Profiler id="review" onRender={onCommit}><ProfileProvider repository={f.profiles}>
    <AppShell currentPage="quests" onNavigate={() => undefined}><QuestsPage onOpenMasterData={() => undefined} questRepository={f.quests} questProgressRepository={f.progress} progressLinkService={f.link} /></AppShell>
  </ProfileProvider></Profiler>);
  return { ...view, resize, user: userEvent.setup() };
}
async function ready(f: Fixture, onCommit?: () => void) {
  const view = mount(f, onCommit);
  await screen.findByRole("table");
  return view;
}

describe("prerequisite progress review UI and snapshot safety", () => {
  it("shows identities and reasons read-only, without additional reads or writes on disclosure and filtering", async () => {
    const f = fixtures(2), { user } = await ready(f);
    const reads = [f.quests.listWithDiscoveries.mock.calls.length, f.quests.listDependencies.mock.calls.length, f.progress.listCompletedQuestIds.mock.calls.length];
    await user.click(entry(2));
    expect(panel()).toHaveTextContent("GVDB ID: 1002"); expect(panel()).toHaveTextContent("GVDB ID: 1001");
    expect(panel()).toHaveTextContent("達成済み"); expect(panel()).toHaveTextContent("未達成"); expect(panel()).toHaveTextContent("確認理由");
    expect(within(panel()).queryByRole("button", { name: /保存|修正|自動/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "候補のある後続だけを表示" }));
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" }));
    expect(entry(2)).toHaveFocus(); expect(entry(2)).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "候補フィルターを解除" }));
    expect(screen.getByText("4件中 4件表示")).toBeInTheDocument();
    expect([f.quests.listWithDiscoveries.mock.calls.length, f.quests.listDependencies.mock.calls.length, f.progress.listCompletedQuestIds.mock.calls.length]).toEqual(reads);
    expect(f.progress.markCompleted).not.toHaveBeenCalled(); expect(f.progress.markIncomplete).not.toHaveBeenCalled();
    expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled(); expect(f.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
  });
  it("keeps N global and M independent of the candidate filter while combining search and other filters", async () => {
    const f = fixtures(3), { user } = await ready(f);
    await user.type(screen.getByRole("searchbox"), "後続");
    await user.selectOptions(screen.getByLabelText("オファー都市"), "city:ロンドン");
    await user.selectOptions(screen.getByLabelText("達成状態"), "completed");
    await user.click(entry(3));
    expect(panel()).toHaveTextContent("プロフィール全体 3件／現在の一覧条件 2件");
    const checkbox = screen.getByRole("checkbox", { name: "候補のある後続だけを表示" });
    await user.click(checkbox); expect(panel()).toHaveTextContent("プロフィール全体 3件／現在の一覧条件 2件");
    expect(screen.getByText("6件中 2件表示")).toBeInTheDocument();
    await user.click(checkbox); expect(panel()).toHaveTextContent("プロフィール全体 3件／現在の一覧条件 2件");
    await user.clear(screen.getByRole("searchbox")); await user.selectOptions(screen.getByLabelText("オファー都市"), "");
    await user.selectOptions(screen.getByLabelText("達成状態"), "all");
    expect(screen.getByText("6件中 6件表示")).toBeInTheDocument();
  });
  it("preserves sorting, page, page size and table DOM on disclosure; only the candidate filter resets paging", async () => {
    const f = fixtures(58), { user } = await ready(f);
    await user.click(screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" }));
    await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    const table = screen.getByRole("table"), firstName = table.querySelector(".quest-title")!.textContent;
    await user.click(entry(58)); await user.click(screen.getByRole("button", { name: "候補の次ページ" }));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument(); expect(screen.getByRole("table")).toBe(table);
    expect(table.querySelector(".quest-title")).toHaveTextContent(firstName!);
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" })); await user.click(entry(58));
    expect(screen.getByLabelText("1ページの件数")).toHaveValue("100");
    await user.click(screen.getByRole("checkbox", { name: "候補のある後続だけを表示" }));
    expect(screen.getByText("1 / 1ページ")).toBeInTheDocument(); expect(screen.getByRole("table")).toBe(table);
    expect(screen.getByRole("columnheader", { name: /クエスト名／地図名/ })).toHaveAttribute("aria-sort", "ascending");
  });
  it("keeps a release path when updates reduce candidates to zero and restores focus from a removed row", async () => {
    const f = fixtures(), { user } = await ready(f);
    await user.click(entry(1)); await user.click(screen.getByRole("checkbox", { name: "候補のある後続だけを表示" }));
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" }));
    await user.click(screen.getByRole("checkbox", { name: "後続1の達成状態" }));
    await waitFor(() => expect(entry(0)).toBeInTheDocument());
    expect(entry(0)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "候補フィルターを解除" }));
    expect(screen.getByRole("table")).toBeInTheDocument(); expect(numericEntry()).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(f.progress.markIncomplete).toHaveBeenCalledExactlyOnceWith(1, 2);
  });
  it("does not show a confirmed count during a pending save and updates only after success", async () => {
    const f = fixtures(), save = deferred<Awaited<ReturnType<Fixture["link"]["completeQuestWithLinkedDiscoveries"]>>>();
    f.link.completeQuestWithLinkedDiscoveries.mockImplementationOnce(() => save.promise);
    const { user } = await ready(f); await user.click(entry(1));
    await user.click(screen.getByRole("checkbox", { name: "前提1の達成状態" }));
    expect(numericEntry()).not.toBeInTheDocument(); expect(panel()).not.toHaveTextContent("後続「");
    await act(async () => { f.stored.get(1)!.add(1); save.resolve({ questChanged: true, discoveriesCreated: 0, discoveriesAlreadyPresent: 0 }); });
    await waitFor(() => expect(entry(0)).toBeInTheDocument());
  });
  it.each([false, true])("uses reloaded truth after a failed save (server committed=%s)", async committed => {
    const f = fixtures();
    f.link.completeQuestWithLinkedDiscoveries.mockImplementationOnce(async () => { if (committed) f.stored.get(1)!.add(1); throw new Error("synthetic save failure"); });
    const { user } = await ready(f); await user.click(entry(1));
    await user.click(screen.getByRole("checkbox", { name: "前提1の達成状態" }));
    await screen.findByText(/達成状態を更新できませんでした/);
    await waitFor(() => expect(entry(committed ? 0 : 1)).toBeInTheDocument());
    expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(2);
  });
  it("leaves diagnosis unconfirmed after save and recovery failure, then supports retry", async () => {
    const f = fixtures(), { user } = await ready(f);
    await user.click(entry(1));
    f.link.completeQuestWithLinkedDiscoveries.mockRejectedValueOnce(new Error("synthetic save failure"));
    f.progress.listCompletedQuestIds.mockRejectedValueOnce(new Error("synthetic recovery failure"));
    await user.click(screen.getByRole("checkbox", { name: "前提1の達成状態" }));
    await screen.findByText("進捗の再取得に失敗しました。再読み込みしてください。");
    expect(numericEntry()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(entry(1)).toBeInTheDocument());
  });
  it("never commits old profile counts under the newly selected profile and ignores a late response", async () => {
    const f = fixtures(), commits: Array<{ profile: string; label: string | null }> = [];
    const record = () => { commits.push({ profile: document.querySelector<HTMLSelectElement>('header select')?.value ?? "", label: [...document.querySelectorAll('button')].find(b => /^進捗の確認候補 \d+件$/.test(b.textContent ?? ""))?.textContent ?? null }); };
    const { user } = await ready(f, record); expect(entry(1)).toBeInTheDocument();
    const b = deferred<number[]>(), a = deferred<number[]>();
    f.progress.listCompletedQuestIds.mockImplementationOnce(() => b.promise).mockImplementationOnce(() => a.promise);
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    expect(numericEntry()).not.toBeInTheDocument();
    expect(commits.filter(c => c.profile === "2").every(c => c.label === null)).toBe(true);
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "1");
    await act(async () => b.resolve([2])); expect(numericEntry()).not.toBeInTheDocument();
    await act(async () => a.resolve([1, 2])); await screen.findByRole("table");
    expect(numericEntry()).not.toBeInTheDocument();
  });
  it("does not turn a failed initial progress read into zero candidates", async () => {
    const f = fixtures(); f.progress.listCompletedQuestIds.mockRejectedValueOnce(new Error("synthetic read failure"));
    const { user } = mount(f); await screen.findByText("クエスト進捗を読み込めませんでした。");
    expect(numericEntry()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(entry(1)).toBeInTheDocument());
  });
  it("waits for both master and dependency results, and ignores an old master after retry", async () => {
    const f = fixtures(), old = deferred<QuestWithDiscoveries[]>();
    f.quests.listWithDiscoveries.mockImplementationOnce(() => old.promise);
    f.quests.listDependencies.mockRejectedValueOnce(new Error("synthetic dependency failure"));
    const { user } = mount(f); await screen.findByText("クエストを読み込めませんでした。");
    expect(numericEntry()).not.toBeInTheDocument();
    const next = fixtures(2); f.quests.listWithDiscoveries.mockResolvedValue(next.masters); f.quests.listDependencies.mockResolvedValue(next.dependencies);
    f.stored.set(1, new Set([2, 4]));
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(entry(2)).toBeInTheDocument());
    await act(async () => old.resolve([])); expect(screen.getByRole("table")).toBeInTheDocument(); expect(entry(2)).toBeInTheDocument();
  });
  it("refreshes dependencies alongside map-triggered masters and never publishes a mixed generation", async () => {
    const f = fixtures(), { user } = await ready(f); await user.click(entry(1));
    const next = fixtures(2), dep = deferred<Fixture["dependencies"]>();
    f.quests.listWithDiscoveries.mockResolvedValueOnce(next.masters); f.quests.listDependencies.mockImplementationOnce(() => dep.promise);
    f.progress.listCompletedQuestIds.mockResolvedValueOnce([2, 4]);
    const table = screen.getByRole("table"); act(() => hold.changed());
    await waitFor(() => expect(f.quests.listDependencies).toHaveBeenCalledTimes(2));
    expect(numericEntry()).not.toBeInTheDocument(); expect(screen.getByRole("table")).toBe(table);
    expect(panel()).not.toHaveTextContent("後続「");
    await act(async () => dep.resolve(next.dependencies));
    await waitFor(() => expect(entry(2)).toBeInTheDocument());
    expect(f.quests.listWithDiscoveries).toHaveBeenCalledTimes(2); expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(2);
  });
  it("keeps map refresh failures unconfirmed and retries the complete read set", async () => {
    const f = fixtures(), { user } = await ready(f); await user.click(entry(1));
    f.quests.listDependencies.mockRejectedValueOnce(new Error("synthetic refresh failure")); act(() => hold.changed());
    await screen.findByText("確認候補を確認できません。再読み込みしてください。"); expect(numericEntry()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確認候補を再読み込み" }));
    await waitFor(() => expect(entry(1)).toBeInTheDocument()); expect(f.quests.listDependencies).toHaveBeenCalledTimes(3);
  });
  it("offers a retry when a failed map refresh supersedes an unfinished initial progress read", async () => {
    const f = fixtures(), initial = deferred<number[]>();
    f.progress.listCompletedQuestIds.mockImplementationOnce(() => initial.promise);
    const { user } = mount(f);
    await waitFor(() => expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(1));
    f.quests.listDependencies.mockRejectedValueOnce(new Error("synthetic early refresh failure"));
    act(() => hold.changed());
    await screen.findByText("進捗の再取得に失敗しました。再読み込みしてください。");
    expect(numericEntry()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(entry(1)).toBeInTheDocument());
    await act(async () => initial.resolve([])); expect(entry(1)).toBeInTheDocument();
  });
  it("rejects a map progress snapshot older than a confirmed ordinary save", async () => {
    const f = fixtures(), { user } = await ready(f), old = deferred<number[]>();
    f.progress.listCompletedQuestIds.mockImplementationOnce(() => old.promise); act(() => hold.changed());
    await user.click(screen.getByRole("checkbox", { name: "前提1の達成状態" }));
    await act(async () => old.resolve([2]));
    await waitFor(() => expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "前提1の達成状態" })).toBeChecked());
    expect(numericEntry()).not.toBeInTheDocument();
  });
  it("keeps the entry, conditions, table DOM and keyboard focus usable in narrow table priority mode", async () => {
    const f = fixtures(2), { user, resize } = await ready(f);
    act(() => resize(800, 600));
    const table = screen.getByRole("table");
    entry(2).focus(); await user.keyboard("{Enter}");
    expect(panel()).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "確認候補の詳細を閉じる" })).toHaveFocus();
    await user.tab(); expect(screen.getByRole("checkbox", { name: "候補のある後続だけを表示" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByText("4件中 2件表示")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    expect(entry(2)).toBeInTheDocument(); expect(screen.getByRole("table")).toBe(table);
    expect(screen.getByRole("group", { name: "非表示の検索・フィルター条件" })).toHaveTextContent("絞り込み1件");
    act(() => resize(1920, 1080));
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" }));
    expect(entry(2)).toHaveFocus(); expect(entry(2)).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(entry(2).getAttribute("aria-controls")!)).not.toBeVisible();
    await user.keyboard(" "); expect(panel()).toBeVisible();
    expect(f.progress.markCompleted).not.toHaveBeenCalled(); expect(f.progress.markIncomplete).not.toHaveBeenCalled();
  });
  it("restores focus outside a zero-candidate detail when closing would hide its entry", async () => {
    const f = fixtures(), { user } = await ready(f);
    await user.click(entry(1)); await user.click(screen.getByRole("checkbox", { name: "前提1の達成状態" }));
    await waitFor(() => expect(entry(0)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" }));
    expect(numericEntry()).not.toBeInTheDocument(); expect(screen.getByRole("searchbox")).toHaveFocus();
  });
  it("keeps a focus destination when zero candidates and other conditions leave a priority table empty", async () => {
    const f = fixtures(), { user } = await ready(f);
    await user.type(screen.getByRole("searchbox"), "該当なし");
    await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    await user.click(entry(1)); f.stored.set(1, new Set([1, 2])); act(() => hold.changed());
    await waitFor(() => expect(entry(0)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" }));
    expect(numericEntry()).not.toBeInTheDocument(); expect(screen.getByLabelText("1ページの件数")).toHaveFocus();
  });
  it("does not flash stale results when a superseded map refresh completes last", async () => {
    const f = fixtures(), { user } = await ready(f), older = deferred<QuestWithDiscoveries[]>();
    f.quests.listWithDiscoveries.mockImplementationOnce(() => older.promise); act(() => hold.changed());
    const next = fixtures(2); f.quests.listWithDiscoveries.mockResolvedValueOnce(next.masters);
    f.quests.listDependencies.mockResolvedValueOnce(next.dependencies); f.progress.listCompletedQuestIds.mockResolvedValueOnce([2, 4]);
    act(() => hold.changed()); await waitFor(() => expect(entry(2)).toBeInTheDocument());
    await act(async () => older.resolve([]));
    expect(entry(2)).toBeInTheDocument(); expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("table")).toBeInTheDocument();
    await user.click(entry(2)); expect(panel()).toHaveTextContent("プロフィール全体 2件");
  });
  it("does not retain old details during failed map-state reads and permits filter release while unconfirmed", async () => {
    const f = fixtures(), view = await ready(f); await view.user.click(entry(1));
    await view.user.click(screen.getByRole("checkbox", { name: "候補のある後続だけを表示" }));
    hold.state = "error";
    // Trigger a normal layout render so the new read state reaches the page.
    await view.user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await screen.findByRole("table");
    expect(numericEntry()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "進捗の確認候補（未確認）" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "候補のある後続だけを表示" })).not.toBeInTheDocument();
    hold.state = "ready";
    await view.user.selectOptions(screen.getByLabelText("現在のプロフィール"), "1"); await waitFor(() => expect(entry(1)).toBeInTheDocument());
    await view.user.click(entry(1)); await view.user.click(screen.getByRole("checkbox", { name: "候補のある後続だけを表示" }));
    const pending = deferred<Fixture["dependencies"]>(); f.quests.listDependencies.mockImplementationOnce(() => pending.promise);
    act(() => hold.changed()); expect(numericEntry()).not.toBeInTheDocument(); expect(panel()).not.toHaveTextContent("後続「");
    fireEvent.click(screen.getByRole("button", { name: "候補フィルターを解除" }));
    expect(screen.getByText("2件中 2件表示")).toBeInTheDocument();
    await act(async () => pending.resolve(f.dependencies)); await waitFor(() => expect(entry(1)).toBeInTheDocument());
  });
});

describe("explicit prerequisite completion from review candidates", () => {
  const start = () => screen.getByRole("button", { name: "前提「前提1」を達成済みにする…" });
  const confirmation = () => screen.getByRole("group", { name: "前提クエストの達成登録" });
  const submit = () => within(confirmation()).getByRole("button", { name: "達成済みにする" });
  async function open(f = fixtures()) {
    const view = await ready(f); await view.user.click(entry(f.dependencies.length)); await view.user.click(start());
    return { f, ...view };
  }
  it("opens an inline confirmation with identities and forward-link warning, without saving", async () => {
    const { f, user } = await open();
    expect(confirmation()).toHaveFocus(); expect(confirmation()).toHaveTextContent("合成プロフィール1");
    expect(confirmation()).toHaveTextContent("GVDB ID: 1001"); expect(confirmation()).toHaveTextContent("現在は未達成");
    expect(confirmation()).toHaveTextContent("未発見の発見物"); expect(confirmation()).toHaveTextContent("通常一覧と同じ達成処理");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
    await user.click(within(confirmation()).getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("group", { name: "前提クエストの達成登録" })).not.toBeInTheDocument(); expect(start()).toHaveFocus();
    expect(f.progress.markCompleted).not.toHaveBeenCalled(); expect(f.progress.markIncomplete).not.toHaveBeenCalled();
  });
  it("uses Enter, Tab, Space and Escape and preserves the table, main sorting and page on cancellation", async () => {
    const f = fixtures(58), { user } = await ready(f);
    await user.click(screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" }));
    await user.selectOptions(screen.getByLabelText("1ページの件数"), "100"); await user.click(screen.getByRole("button", { name: "次ページ" }));
    const table = screen.getByRole("table"), name = table.querySelector(".quest-title")!.textContent;
    await user.click(entry(58)); start().focus(); await user.keyboard("{Enter}"); expect(confirmation()).toHaveFocus();
    await user.tab(); expect(within(confirmation()).getByRole("button", { name: "キャンセル" })).toHaveFocus();
    await user.keyboard("{Escape}"); expect(start()).toHaveFocus(); expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.keyboard(" "); expect(confirmation()).toHaveFocus();
    await user.click(within(confirmation()).getByRole("button", { name: "キャンセル" }));
    expect(screen.getByRole("table")).toBe(table); expect(table.querySelector(".quest-title")).toHaveTextContent(name!);
    expect(screen.getByLabelText("1ページの件数")).toHaveValue("100"); expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
  });
  it("only confirms the local predecessor ID, keeps forward linking, updates its checkbox and resolves candidates", async () => {
    const f = fixtures(); f.link.completeQuestWithLinkedDiscoveries.mockImplementationOnce(async (profileId, questId) => {
      f.stored.get(profileId)!.add(questId); return { questChanged: true, discoveriesCreated: 2, discoveriesAlreadyPresent: 1 };
    });
    const { user } = await open(f); await user.click(submit());
    await waitFor(() => expect(entry(0)).toBeInTheDocument());
    expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(screen.getByRole("checkbox", { name: "前提1の達成状態" })).toBeChecked();
    expect(panel()).toHaveTextContent("前提「前提1」を達成済みにしました。"); expect(panel()).toHaveTextContent("発見物 2件も発見済み");
    expect(screen.getByRole("button", { name: "確認候補の詳細を閉じる" })).toHaveFocus();
    expect(hold.reload).toHaveBeenCalled(); expect(f.progress.markIncomplete).not.toHaveBeenCalled(); expect(f.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
  });
  it("distinguishes same-name quests by local ID rather than GVDB ID or title", async () => {
    const f = fixtures(2); f.masters[0]!.quest.title = "同名"; f.masters[2]!.quest.title = "同名";
    const { user } = await ready(f); await user.click(entry(2));
    await user.click(screen.getAllByRole("button", { name: "前提「同名」を達成済みにする…" })[1]!);
    expect(confirmation()).toHaveTextContent("GVDB ID: 1003"); await user.click(submit());
    await waitFor(() => expect(entry(1)).toBeInTheDocument()); expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 3);
    expect(f.stored.get(1)!.has(1)).toBe(false);
  });
  it("does not recursively complete another predecessor", async () => {
    const f = fixtures();
    f.masters.push({ ...f.masters[0]!, quest: { ...f.masters[0]!.quest, id: 3, gvdbId: 1003, title: "祖先", rawRowJson: JSON.stringify({ 前提クエスト: "", 後続クエスト: "1001:前提" }) } });
    f.masters[0]!.quest.rawRowJson = JSON.stringify({ 前提クエスト: "1003:祖先", 後続クエスト: "1002:後続" });
    f.dependencies.push({ questId: 1, prerequisiteQuestId: 3 });
    const { user } = await ready(f); await user.click(entry(1)); await user.click(start()); await user.click(submit());
    await waitFor(() => expect(f.stored.get(1)!.has(1)).toBe(true)); expect(f.stored.get(1)!.has(3)).toBe(false);
    expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 1);
  });
  it.each([false, true])("does not equate a resolved handler with successful save after rejection (committed=%s)", async committed => {
    const f = fixtures(); f.link.completeQuestWithLinkedDiscoveries.mockImplementationOnce(async () => {
      if (committed) f.stored.get(1)!.add(1); throw new Error("synthetic uncertain save");
    });
    const { user } = await open(f); await user.click(submit());
    await waitFor(() => expect(panel()).toHaveTextContent("保存完了を確認できませんでした。"));
    expect(panel()).not.toHaveTextContent("前提「前提1」を達成済みにしました。"); expect(entry(committed ? 0 : 1)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "前提1の達成状態" })).toHaveProperty("checked", committed);
    expect(f.progress.listCompletedQuestIds).toHaveBeenCalledTimes(2);
  });
  it("leaves a failed recovery unconfirmed and permits retry", async () => {
    const { f, user } = await open(); f.link.completeQuestWithLinkedDiscoveries.mockRejectedValueOnce(new Error("synthetic failure"));
    f.progress.listCompletedQuestIds.mockRejectedValueOnce(new Error("synthetic recovery failure")); await user.click(submit());
    await screen.findByText("進捗の再取得に失敗しました。再読み込みしてください。"); expect(numericEntry()).not.toBeInTheDocument();
    expect(screen.queryByText(/前提「前提1」を達成済みにしました/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "再読み込み" })); await waitFor(() => expect(entry(1)).toBeInTheDocument());
  });
  it("prevents double submission and shares the target pending state with the normal checkbox", async () => {
    const { f, user } = await open(), save = deferred<Awaited<ReturnType<Fixture["link"]["completeQuestWithLinkedDiscoveries"]>>>();
    f.link.completeQuestWithLinkedDiscoveries.mockImplementationOnce(() => save.promise);
    const button = submit(); fireEvent.click(button); fireEvent.click(button); fireEvent.click(button);
    expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "前提1の達成状態" })).toBeDisabled();
    await user.keyboard("{Escape}"); expect(confirmation()).toBeInTheDocument();
    await act(async () => { f.stored.get(1)!.add(1); save.resolve({ questChanged: true, discoveriesCreated: 0, discoveriesAlreadyPresent: 0 }); });
    await waitFor(() => expect(entry(0)).toBeInTheDocument());
  });
  it("discards confirmation on profile change without saving", async () => {
    const { f, user } = await open(); const stale = submit();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    fireEvent.click(stale); await screen.findByRole("table");
    expect(screen.queryByRole("group", { name: "前提クエストの達成登録" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "1"); await waitFor(() => expect(entry(1)).toBeInTheDocument());
    expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
  });
  it("does not show an old save result after a profile A/B/A switch", async () => {
    const { f, user } = await open(), save = deferred<Awaited<ReturnType<Fixture["link"]["completeQuestWithLinkedDiscoveries"]>>>();
    f.link.completeQuestWithLinkedDiscoveries.mockImplementationOnce(() => save.promise); await user.click(submit());
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2"); await screen.findByRole("table");
    expect(screen.queryByText(/前提「前提1」を達成済みにしました/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "1");
    await act(async () => { f.stored.get(1)!.add(1); save.resolve({ questChanged: true, discoveriesCreated: 2, discoveriesAlreadyPresent: 0 }); });
    await waitFor(() => expect(f.progress.listCompletedQuestIds.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(screen.queryByText(/前提「前提1」を達成済みにしました/)).not.toBeInTheDocument(); expect(f.stored.get(2)).toEqual(new Set([1, 2]));
  });
  it.each(["progress", "relation"])("refuses a stale confirmation after a %s refresh", async kind => {
    const { f, user } = await open(); const stale = submit();
    if (kind === "progress") f.stored.set(1, new Set());
    else f.dependencies.splice(0);
    act(() => { hold.changed(); fireEvent.click(stale); });
    await waitFor(() => expect(screen.queryByRole("group", { name: "前提クエストの達成登録" })).not.toBeInTheDocument());
    expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
    await waitFor(() => expect(entry(0)).toBeInTheDocument());
    expect(panel()).toHaveTextContent(/再確認|再読み込み/);
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" }));
  });
  it("invalidates confirmation when the normal checkbox starts saving the same predecessor", async () => {
    const { f, user } = await open(); const stale = submit();
    await user.click(screen.getByRole("checkbox", { name: "前提1の達成状態" })); fireEvent.click(stale);
    await waitFor(() => expect(entry(0)).toBeInTheDocument()); expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(screen.queryByText(/前提「前提1」を達成済みにしました/)).not.toBeInTheDocument();
  });
  it("keeps confirmation usable in narrow table priority mode", async () => {
    const f = fixtures(), { user, resize } = await ready(f); act(() => resize(800, 600));
    await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" })); const table = screen.getByRole("table");
    await user.click(entry(1)); await user.click(start()); act(() => resize(1920, 1080));
    expect(confirmation()).toBeVisible(); await user.click(submit()); await waitFor(() => expect(entry(0)).toBeInTheDocument());
    expect(screen.getByRole("table")).toBe(table); expect(screen.getByRole("button", { name: "検索・フィルターを表示" })).toBeInTheDocument();
  });
  it("keeps a confirmed save distinct from a failed map-state reload", async () => {
    const { f, user } = await open(); hold.reload.mockRejectedValueOnce(new Error("synthetic map read failure"));
    await user.click(submit()); await screen.findByText("地図状態の再取得に失敗しました。");
    expect(f.stored.get(1)!.has(1)).toBe(true); expect(panel()).toHaveTextContent("前提「前提1」を達成済みにしました。");
  });
  it("revalidates endpoint eligibility on a new master generation even if a repository reuses its arrays", async () => {
    const { f, user } = await open();
    f.masters[1]!.quest.offerMethod = "地理学"; act(() => hold.changed());
    await waitFor(() => expect(entry(0)).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "前提クエストの達成登録" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "前提「前提1」を達成済みにする…" })).not.toBeInTheDocument();
    expect(f.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "確認候補の詳細を閉じる" }));
  });
  it("resolves every direct candidate sharing the same predecessor with one confirmed save", async () => {
    const f = fixtures(2); f.dependencies[1]!.prerequisiteQuestId = 1;
    f.masters[0]!.quest.rawRowJson = JSON.stringify({ 前提クエスト: "", 後続クエスト: "1002:後続1,1004:後続2" });
    f.masters[2]!.quest.rawRowJson = "{}";
    f.masters[3]!.quest.rawRowJson = JSON.stringify({ 前提クエスト: "1001:前提1", 後続クエスト: "" });
    const { user } = await ready(f); await user.click(entry(2));
    await user.click(screen.getAllByRole("button", { name: "前提「前提1」を達成済みにする…" })[0]!); await user.click(submit());
    await waitFor(() => expect(entry(0)).toBeInTheDocument()); expect(f.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 1);
  });
});
