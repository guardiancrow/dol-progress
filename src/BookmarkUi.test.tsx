// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../src-tauri/migrations/005_search_bookmarks.sql?raw";
import App from "./App";
import { mockWorkspaceMedia } from "./components/layout/responsiveTestMedia";
import type { DatabaseClient } from "./db/client";
import type { DiscoveryProgress, DiscoveryWithRelations, QuestWithDiscoveries } from "./domain/models";
import { discoveryStateReader } from "./discoveries/stateReader";
import { SearchBookmarkRepository } from "./repositories/searchBookmarkRepository";
import type { QuestSearchCondition, DiscoverySearchCondition } from "./searchConditions/definition";
import type { QuestDependency } from "./quests/prerequisites";
import type { ImportResult } from "./importer";

vi.mock("./discoveries/stateReader", async (original) => ({
  ...await original<typeof import("./discoveries/stateReader")>(),
  discoveryStateReader: { list: vi.fn(async () => []) },
}));

interface MemorySqlite {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
    run(...parameters: unknown[]): { changes: number };
  };
  close(): void;
}
const sqliteModule = "node:sqlite";
const sqlite = await import(/* @vite-ignore */ sqliteModule).catch(() => null) as
  { DatabaseSync: new (path: string) => MemorySqlite } | null;

const questCondition: QuestSearchCondition = { schemaVersion: 1, page: "quests", search: "", filters: {}, sorting: [] };
const discoveryCondition: DiscoverySearchCondition = { schemaVersion: 1, page: "discoveries", search: "", filters: {}, sorting: [] };
const times = { createdAt: "synthetic", updatedAt: "synthetic" };
const category = { id: 3, name: "史跡", sortOrder: 1 };
const profiles = [1, 2].map(id => ({ id, name: `合成プロフィール${id}`, memo: null, ...times }));

function quest(id: number, title: string): QuestWithDiscoveries {
  return {
    quest: { id, gvdbId: 100 + id, title, offerMethod: "冒険クエスト", offerCity: "合成都市", difficulty: id,
      chronoQuest: null, requiredSkills: null, discoveryTypeText: null, rewardItems: null, notes: null, chainName: null,
      chainOrder: null, sourceUpdatedAt: null, isActive: true, rawRowJson: "{}", ...times },
    discoveries: [], requiredSkillsNormalized: [], offerCities: [{ position: 0, cityName: "合成都市" }],
  };
}

function discovery(id: number, name: string): DiscoveryWithRelations {
  return { automaticReporting: false, mapTarget: false, relatedQuests: [], category,
    discovery: { id, gvdbId: 200 + id, categoryId: category.id, name, rank: id, description: null, era: null, points: null,
      difficulty: null, experience: null, notes: null, sourceUpdatedAt: null, isActive: true, rawRowJson: "{}", ...times } };
}

function fixtures(repo: SearchBookmarkRepository) {
  const mutateProgress = vi.fn(async () => { throw new Error("Unexpected progress write"); });
  const mutateProfile = vi.fn(async () => { throw new Error("Unexpected profile write"); });
  const props = {
    bookmarkRepository: repo,
    profileRepository: { list: async () => profiles, create: mutateProfile, update: mutateProfile, delete: mutateProfile },
    questRepository: { listWithDiscoveries: vi.fn(async () => [quest(1, "対象A"), quest(2, "対象B"), quest(3, "別のクエスト")]),
      listDependencies: vi.fn(async (): Promise<QuestDependency[]> => []) },
    questProgressRepository: { listCompletedQuestIds: async (id: number) => [id], markCompleted: mutateProgress, markIncomplete: mutateProgress },
    discoveryRepository: { listWithRelations: vi.fn(async () => [discovery(1, "合成遺跡"), discovery(2, "別の史跡")]) },
    discoveryProgressRepository: { listByProfile: async () => [], markDiscovered: mutateProgress,
      markUndiscovered: mutateProgress, setReported: mutateProgress, setCardOwned: mutateProgress },
  } satisfies ComponentProps<typeof App>;
  return { props, mutateProgress, mutateProfile };
}

async function show(props: ComponentProps<typeof App>, page = "クエスト") {
  const user = userEvent.setup();
  const view = render(<App {...props} />);
  await screen.findByRole("list", { name: "プロフィール一覧" });
  const navigate = (name: string) => user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name }));
  await navigate(page);
  return { user, view, navigate };
}

const panel = () => within(screen.getByRole("region", { name: "ブックマーク管理" }));
const bookmarkButton = () => screen.getByRole("button", { name: "ブックマーク" });
const rows = () => within(panel().getByRole("list", { name: "保存済みブックマーク" })).getAllByRole("listitem");
const search = (label = "クエスト名／地図名を検索") => screen.getByRole("searchbox", { name: label });
const open = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(bookmarkButton()); };
const allPages = async (user: ReturnType<typeof userEvent.setup>) => { await user.selectOptions(panel().getByLabelText("対象ページ"), "all"); };
const item = (name: string) => rows().find(row => within(row).queryByRole("button", { name }))!;
const tabList = () => within(screen.getByRole("tablist", { name: "一覧タブ" }));
const activeTab = () => tabList().getByRole("tab", { selected: true });
const addTab = async (user: ReturnType<typeof userEvent.setup>, page: string) => {
  await user.click(screen.getByRole("button", { name: "新しいタブ" }));
  await user.click(screen.getByRole("button", { name: `${page}を開く` }));
};
const overviewStats = { getForProfile: async () => ({
  quests: { total: 3, completed: 1, incomplete: 2 },
  discoveries: { total: 2, discovered: 1, undiscovered: 1, unreported: 1, reported: 0, cardOwned: 0, cardCapableDiscovered: 1 },
  adventureMerit: { knownMerit: 0, reportedCount: 0, knownExperienceCount: 0, unknownExperienceCount: 0 },
  categories: [{ categoryId: category.id, categoryName: category.name, sortOrder: 1, total: 2, discovered: 1,
    undiscovered: 1, unreported: 1, cardOwned: 0, canReport: true, hasCard: true, mapDiscoveries: { total: 0, undiscovered: 0 } }],
}) };

async function actions(user: ReturnType<typeof userEvent.setup>, name: string) {
  const row = item(name);
  const details = row.querySelector("details")!;
  if (!details.open) await user.click(within(row).getByLabelText(`${name}の操作`));
  return within(row);
}

describe.skipIf(sqlite === null)("bookmark management through App and synthetic SQLite", () => {
  let database: MemorySqlite;
  let repository: SearchBookmarkRepository;

  beforeEach(() => {
    vi.mocked(discoveryStateReader.list).mockClear();
    database = new sqlite!.DatabaseSync(":memory:");
    database.exec(schema);
    const bind = (values: unknown[]) => Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
    const client: DatabaseClient = {
      async select<T>(sql: string, values: unknown[] = []) {
        const statement = database.prepare(sql);
        return (values.length ? statement.all(bind(values)) : statement.all()) as T;
      },
      async execute(sql, values = []) { return { rowsAffected: database.prepare(sql).run(bind(values)).changes }; },
    };
    repository = new SearchBookmarkRepository(async () => client);
  });

  afterEach(() => { cleanup(); database.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("saves filters with sorting, applies them, explicitly updates or renames, reloads favorites, and deletes the confirmed item", async () => {
    const { props, mutateProgress, mutateProfile } = fixtures(repository);
    const { user, view } = await show(props);
    await screen.findByRole("table");
    await user.type(search(), "対象");
    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");
    await user.click(screen.getByRole("button", { name: "難易度で並べ替え" }));
    await open(user);
    await user.click(await panel().findByRole("button", { name: "現在の条件を保存" }));
    await user.type(panel().getByLabelText("ブックマーク名"), "  対象の検索  ");
    await user.click(panel().getByRole("button", { name: "保存する" }));
    const saved = await panel().findByRole("button", { name: "対象の検索" });
    expect((await repository.list())[0]?.definition).toMatchObject({ status: "ready", value: { search: "対象", filters: { completed: false }, sorting: [{ key: "difficulty" }] } });

    await user.clear(search());
    await user.type(search(), "存在しない");
    await user.click(saved);
    expect(search()).toHaveValue("対象");
    expect(screen.getByRole("table")).toHaveTextContent("対象B");
    expect(screen.getByRole("table")).not.toHaveTextContent("対象A");
    expect(screen.getByRole("columnheader", { name: /難易度/ })).toHaveAttribute("aria-sort");
    await waitFor(async () => expect((await repository.list())[0]?.lastUsedAt).not.toBeNull());

    await user.click((await actions(user, "対象の検索")).getByRole("button", { name: "名前を変更" }));
    await user.clear(panel().getByLabelText("ブックマーク名"));
    await user.type(panel().getByLabelText("ブックマーク名"), "編集後");
    await user.click(panel().getByRole("button", { name: "保存する" }));
    await panel().findByRole("button", { name: "編集後" });
    expect((await repository.list())[0]?.definition).toMatchObject({ value: { search: "対象" } });

    await user.clear(search());
    await user.type(search(), "別の");
    await user.click((await actions(user, "編集後")).getByRole("button", { name: "現在の条件で更新" }));
    expect(panel().getByText("「編集後」を現在の条件で上書きしますか？")).toBeInTheDocument();
    expect((await repository.list())[0]?.definition).toMatchObject({ value: { search: "対象" } });
    await user.click(panel().getByRole("button", { name: "更新する" }));
    await waitFor(async () => expect((await repository.list())[0]?.definition).toMatchObject({ value: { search: "別の" } }));
    await waitFor(() => expect(panel().getByRole("button", { name: "編集後のお気に入り" })).toBeEnabled());
    await user.click(panel().getByRole("button", { name: "編集後のお気に入り" }));
    await waitFor(() => expect(panel().getByRole("button", { name: "編集後のお気に入り" })).toHaveAttribute("aria-pressed", "true"));

    view.unmount();
    const reloaded = await show(props);
    await open(reloaded.user);
    expect(await panel().findByRole("button", { name: "編集後のお気に入り" })).toHaveAttribute("aria-pressed", "true");
    await reloaded.user.click((await actions(reloaded.user, "編集後")).getByRole("button", { name: "削除" }));
    expect(panel().getByText("「編集後」を削除しますか？")).toBeInTheDocument();
    await reloaded.user.click(panel().getByRole("button", { name: "削除する" }));
    expect(await panel().findByText("保存済みのブックマークがありません。")).toBeInTheDocument();
    expect(mutateProgress).not.toHaveBeenCalled();
    expect(mutateProfile).not.toHaveBeenCalled();
  });

  it("applies across pages in both directions and evaluates the selected profile without changing it", async () => {
    await repository.create("クエストの条件", { ...questCondition, search: "対象", filters: { completed: false } });
    await repository.create("発見物の条件", { ...discoveryCondition, search: "合成遺跡", filters: { category: { kind: "named", name: "史跡" } } });
    const { props } = fixtures(repository);
    const { user } = await show(props);
    await open(user);
    await allPages(user);
    await user.click(await panel().findByRole("button", { name: "発見物の条件" }));
    expect(await screen.findByRole("searchbox", { name: "発見物名を検索" })).toHaveValue("合成遺跡");
    expect(activeTab()).toHaveAccessibleName("発見物の条件");
    expect(tabList().getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("table")).not.toHaveTextContent("別の史跡");
    expect(bookmarkButton()).toHaveFocus();
    expect(discoveryStateReader.list).toHaveBeenCalledTimes(1);
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await open(user);
    await allPages(user);
    await user.click(await panel().findByRole("button", { name: "クエストの条件" }));
    expect(await screen.findByRole("table")).toHaveTextContent("対象A");
    expect(screen.getByRole("table")).not.toHaveTextContent("対象B");
    expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("2");
    expect(activeTab()).toHaveAccessibleName("クエストの条件");
    expect(tabList().getAllByRole("tab")).toHaveLength(3);
    expect(discoveryStateReader.list).toHaveBeenCalledTimes(2);
  });

  it("holds independent filters, sort, page and size on same-kind tabs and returns to the most recent one from the sidebar", async () => {
    const { props } = fixtures(repository);
    const listCompletedQuestIds = vi.fn(props.questProgressRepository.listCompletedQuestIds);
    props.questRepository.listWithDiscoveries.mockResolvedValue(Array.from({ length: 103 }, (_, index) => quest(index + 1, `合成${index + 1}`)));
    const { user, navigate } = await show({ ...props, questProgressRepository: { ...props.questProgressRepository, listCompletedQuestIds } });
    await screen.findByRole("table");
    const first = activeTab();
    await user.type(search(), "合成");
    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");
    await user.click(screen.getByRole("button", { name: "難易度で並べ替え" }));
    const initialSort = screen.getByRole("columnheader", { name: /難易度/ }).getAttribute("aria-sort");
    await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();

    await addTab(user, "クエスト");
    await screen.findByRole("table");
    const second = activeTab();
    expect(second.id).not.toBe(first.id);
    expect(document.getElementById(first.getAttribute("aria-controls")!)).toBeEmptyDOMElement();
    expect(search()).toHaveValue("");
    expect(screen.getByLabelText("1ページの件数")).toHaveValue("50");
    await user.type(search(), "合成3");
    await addTab(user, "発見物");
    expect(activeTab()).toHaveAccessibleName("発見物");
    await navigate("クエスト");
    await screen.findByRole("table");
    expect(activeTab()).toBe(second);
    expect(search()).toHaveValue("合成3");

    await user.click(first);
    const existingTable = await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "タブを並べ替え" }));
    await user.click(screen.getByRole("button", { name: "右へ移動" }));
    expect(tabList().getAllByRole("tab").slice(0, 2)).toEqual([second, first]);
    expect(activeTab()).toBe(first);
    expect(screen.getByRole("table")).toBe(existingTable);
    expect(search()).toHaveValue("合成");
    expect(screen.getByLabelText("達成状態")).toHaveValue("incomplete");
    expect(screen.getByRole("columnheader", { name: /難易度/ })).toHaveAttribute("aria-sort", initialSort);
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    expect(screen.getByLabelText("1ページの件数")).toHaveValue("100");
    expect(props.questRepository.listWithDiscoveries).toHaveBeenCalledTimes(1);
    expect(props.questRepository.listDependencies).toHaveBeenCalledTimes(1);
    expect(listCompletedQuestIds).toHaveBeenCalledExactlyOnceWith(1);
    expect(discoveryStateReader.list).toHaveBeenCalledTimes(1);

    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await screen.findByRole("table");
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(screen.getByLabelText("1ページの件数")).toHaveValue("100");
    expect(search()).toHaveValue("合成");
    expect(listCompletedQuestIds).toHaveBeenLastCalledWith(2);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it.each([[800, 600], [600, 480]])("uses reordered neighbors and preserves the last used search tab at %dx%d", async (width, height) => {
    const resize = mockWorkspaceMedia(1280, 800);
    const { props } = fixtures(repository);
    const { user, navigate } = await show({ ...props, progressStatsRepository: overviewStats });
    const first = activeTab();
    await addTab(user, "クエスト");
    const second = activeTab();
    await user.type(await screen.findByRole("searchbox"), "対象B");
    await navigate("概要");
    const overview = activeTab();
    act(() => resize(width, height));
    act(() => first.focus());
    await user.keyboard("{Shift>}{F10}{/Shift}{Enter}");
    act(() => first.focus());
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.click(screen.getByRole("button", { name: "右へ移動" }));
    expect(tabList().getAllByRole("tab")).toEqual([second, overview, first]);
    expect(activeTab()).toBe(overview);
    await user.click(screen.getByRole("button", { name: "メニューを開く" }));
    await navigate("クエスト");
    expect(activeTab()).toBe(second);
    const close = within(second.parentElement!).getByRole("button", { name: "クエストを閉じる" });
    await user.click(close);
    expect(activeTab()).toBe(overview);
    expect(overview).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    const restored = activeTab();
    expect(restored.id).not.toBe(second.id);
    expect(tabList().getAllByRole("tab")).toEqual([restored, overview, first]);
    expect(await screen.findByRole("searchbox")).toHaveValue("対象B");
    expect(props.questRepository.listWithDiscoveries).toHaveBeenCalledTimes(1);
  });

  it("opens overview links in a fresh discovery tab and preserves the earlier tab", async () => {
    const { props } = fixtures(repository);
    const { user, navigate } = await show({ ...props, progressStatsRepository: overviewStats }, "発見物");
    const firstId = activeTab().id;
    await user.type(await screen.findByRole("searchbox", { name: "発見物名を検索" }), "合成遺跡");
    await navigate("概要");
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    expect(await screen.findByLabelText("分類")).toHaveValue("3");
    expect(search("発見物名を検索")).toHaveValue("");
    expect(activeTab().id).not.toBe(firstId);
    expect(tabList().getAllByRole("tab")).toHaveLength(3);
    await user.click(tabList().getAllByRole("tab").find(tab => tab.id === firstId)!);
    expect(await screen.findByRole("searchbox", { name: "発見物名を検索" })).toHaveValue("合成遺跡");
    expect(screen.getByLabelText("分類")).toHaveValue("all");
  });

  it("keeps overview and existing search state when a drill-down category is unavailable", async () => {
    const { props } = fixtures(repository);
    const { user, navigate } = await show({ ...props, progressStatsRepository: overviewStats });
    await user.type(await screen.findByRole("searchbox"), "対象A");
    await navigate("概要");
    const overview = activeTab();
    props.discoveryRepository.listWithRelations.mockResolvedValue([{
      ...discovery(1, "別分類の発見物"), category: { id: 4, name: "地理", sortOrder: 2 },
    }]);
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("史跡");
    expect(activeTab()).toBe(overview);
    expect(tabList().getAllByRole("tab")).toHaveLength(2);
    await user.click(tabList().getByRole("tab", { name: "クエスト" }));
    expect(await screen.findByRole("searchbox")).toHaveValue("対象A");
  });

  it.each([[800, 600], [600, 480]])("supports keyboard selection, IME-safe rename and undo at %dx%d", async (width, height) => {
    const resize = mockWorkspaceMedia(1280, 800);
    const { user } = await show({ ...fixtures(repository).props, progressStatsRepository: overviewStats });
    await screen.findByRole("table");
    act(() => resize(width, height));
    await addTab(user, "発見物");
    const discoveryTab = activeTab();
    expect(discoveryTab).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    const questTab = tabList().getByRole("tab", { name: "クエスト" });
    expect(questTab).toHaveFocus();
    expect(discoveryTab).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(activeTab()).toBe(questTab);
    await user.keyboard("{F2}");
    const input = screen.getByLabelText("タブ名");
    expect(input).toHaveFocus();
    const title = `合成の長いタブ名${"比較".repeat(25)}`;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: ` ${title} ` } });
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
    expect(questTab).toHaveAccessibleName("クエスト");
    fireEvent.compositionEnd(input);
    await user.keyboard("{Enter}");
    expect(questTab).toHaveAccessibleName(title);
    expect(questTab).toHaveAttribute("title", expect.stringContaining(title));
    expect(questTab).toHaveFocus();
    await user.tab();
    expect(tabList().getByRole("button", { name: `${title}を閉じる` })).toHaveFocus();
    await user.type(await screen.findByRole("searchbox"), "対象");
    act(() => questTab.focus());
    await user.keyboard("{ArrowRight} ");
    expect(activeTab()).toBe(discoveryTab);
    await user.keyboard("{Delete}");
    expect(questTab).toHaveFocus();
    await user.keyboard("{Delete}");
    expect(activeTab()).toHaveAccessibleName("概要");
    expect(activeTab()).toHaveFocus();
    const restore = screen.getByRole("button", { name: "元に戻す" });
    await screen.findByRole("heading", { name: "概要" });
    await user.click(restore);
    expect(activeTab()).toHaveAccessibleName(title);
    expect(activeTab()).toHaveFocus();
    expect(activeTab().id).not.toBe(questTab.id);
    expect(await screen.findByRole("searchbox")).toHaveValue("対象");
    expect(tabList().getAllByRole("tab")).toHaveLength(2);
  });

  it.each([[800, 600], [600, 480]])("restores an overview from zero tabs and avoids duplicates at %dx%d", async (width, height) => {
    const resize = mockWorkspaceMedia(1280, 800);
    const { user, navigate } = await show({ ...fixtures(repository).props, progressStatsRepository: overviewStats }, "概要");
    const first = activeTab();
    await navigate("概要");
    expect(activeTab()).toBe(first);
    expect(tabList().getAllByRole("tab")).toHaveLength(1);
    act(() => resize(width, height));
    expect(screen.getByRole("tabpanel", { name: "概要" }).id).toBe(first.getAttribute("aria-controls"));
    expect(screen.queryByRole("button", { name: /検索・フィルター/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ブックマーク" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "タブ名を変更" })).not.toBeInTheDocument();
    act(() => first.focus());
    await user.keyboard("{F2}");
    expect(screen.queryByRole("textbox", { name: "タブ名" })).not.toBeInTheDocument();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "プロフィール" })).toBeInTheDocument();
    const undo = screen.getByRole("button", { name: "元に戻す" });
    expect(undo).toHaveFocus();
    await user.keyboard("{Enter}");
    const restored = activeTab();
    expect(restored.id).not.toBe(first.id);
    expect(restored).toHaveFocus();
    await user.keyboard("{Delete}");
    act(() => resize(1280, 800));
    await navigate("概要");
    const reopened = activeTab();
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(activeTab()).toBe(reopened);
    expect(tabList().getAllByRole("tab")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
  });

  it("allows an overview alongside six search tabs and blocks a seventh search tab through every entry point", async () => {
    await repository.create("同種の保存条件", { ...questCondition, search: "対象" });
    await repository.create("別種の保存条件", discoveryCondition);
    const { user, navigate } = await show({ ...fixtures(repository).props, progressStatsRepository: overviewStats });
    for (let count = 2; count <= 6; count++) {
      await addTab(user, "クエスト");
      expect(tabList().getAllByRole("tab")).toHaveLength(count);
    }
    const ids = () => tabList().getAllByRole("tab").map(tab => tab.id);
    const six = ids();
    const current = activeTab().id;
    const limit = () => expect(screen.getByRole("alert")).toHaveTextContent("6件まで");
    await addTab(user, "発見物");
    limit();
    expect(ids()).toEqual(six);
    await navigate("発見物");
    limit();
    expect(activeTab().id).toBe(current);
    await navigate("概要");
    const overview = activeTab();
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    limit();
    expect(activeTab()).toBe(overview);
    expect(ids()).toEqual([...six, overview.id]);
    await user.click(tabList().getByRole("button", { name: "概要を閉じる" }));
    expect(ids()).toEqual(six);
    await navigate("クエスト");
    expect(ids()).toEqual(six);
    await open(user);
    await allPages(user);
    await user.click(await panel().findByRole("button", { name: "別種の保存条件" }));
    limit();
    await user.click((await actions(user, "同種の保存条件")).getByRole("button", { name: "新しいタブで開く" }));
    limit();
    expect((await repository.list()).every(bookmark => bookmark.lastUsedAt === null)).toBe(true);
    await user.click(panel().getByRole("button", { name: "同種の保存条件" }));
    expect(search()).toHaveValue("対象");
    expect(activeTab().id).toBe(current);
    expect(ids()).toEqual(six);
    await user.click(tabList().getAllByRole("button", { name: "クエストを閉じる" })[0]!);
    expect(ids()).toHaveLength(5);
    await addTab(user, "クエスト");
    const replaced = ids();
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    limit();
    expect(ids()).toEqual(replaced);
  });

  it("opens a same-kind bookmark in a separate tab and keeps edits local to that tab", async () => {
    await repository.create("比較用", { ...questCondition, search: "対象" });
    const { user } = await show(fixtures(repository).props);
    const first = activeTab();
    await user.type(await screen.findByRole("searchbox"), "別の");
    await open(user);
    await panel().findByRole("button", { name: "比較用" });
    await user.click((await actions(user, "比較用")).getByRole("button", { name: "新しいタブで開く" }));
    expect(activeTab()).toHaveAccessibleName("比較用");
    expect(search()).toHaveValue("対象");
    await user.clear(search());
    expect((await repository.list())[0]?.definition).toMatchObject({ value: { search: "対象" } });
    await user.click(first);
    expect(await screen.findByRole("searchbox")).toHaveValue("別の");
    expect(tabList().getAllByRole("tab")).toHaveLength(2);
  });

  it.each(["saved", "uncertain"] as const)("refreshes linked discoveries after a %s quest write outlives its page", async outcome => {
    const { props } = fixtures(repository);
    let finishOldRead!: (rows: DiscoveryProgress[]) => void;
    let finishWrite!: () => void;
    let saved: DiscoveryProgress[] = [];
    const listByProfile = vi.fn(async () => saved)
      .mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve; }));
    const completeQuestWithLinkedDiscoveries = vi.fn(async (profileId: number, _questId: number) => {
      await new Promise<void>(resolve => { finishWrite = resolve; });
      saved = [{ profileId, discoveryId: 1, reported: false, cardOwned: true, memo: null, updatedAt: "saved" }];
      if (outcome === "uncertain") throw new Error("synthetic uncertain response");
      return { questChanged: true, discoveriesCreated: 1, discoveriesAlreadyPresent: 0 };
    });
    const { user, navigate } = await show({ ...props, discoveryProgressRepository: { ...props.discoveryProgressRepository, listByProfile },
      progressLinkService: { completeQuestWithLinkedDiscoveries, discoverWithLinkedQuest: vi.fn() } }, "発見物");
    await waitFor(() => expect(listByProfile).toHaveBeenCalledExactlyOnceWith(1));
    await navigate("クエスト");
    await user.click(await screen.findByRole("checkbox", { name: "対象Bの達成状態" }));
    expect(completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 2);
    const questTab = activeTab();
    await user.click(screen.getByRole("button", { name: "タブを並べ替え" }));
    await user.click(screen.getByRole("button", { name: "左へ移動" }));
    expect(activeTab()).toBe(questTab);
    await user.click(tabList().getByRole("button", { name: "クエストを閉じる" }));
    expect(tabList().queryByRole("tab", { name: "クエスト" })).not.toBeInTheDocument();
    expect(screen.getByText("発見物を読み込んでいます…")).toBeInTheDocument();
    expect(listByProfile).toHaveBeenCalledTimes(1);
    await act(async () => finishWrite());
    expect(await screen.findByRole("checkbox", { name: "合成遺跡の発見状態" })).toBeChecked();
    await act(async () => finishOldRead([]));
    expect(screen.getByRole("checkbox", { name: "合成遺跡の発見状態" })).toBeChecked();
    expect(listByProfile.mock.calls).toHaveLength(2);
    expect(props.discoveryRepository.listWithRelations).toHaveBeenCalledTimes(1);
  });

  it.each(["saved", "uncertain"] as const)("waits for a %s quest write after its source tab closes and discards a late overview read", async outcome => {
    const { props } = fixtures(repository);
    const before = await overviewStats.getForProfile();
    const after = { ...before, quests: { total: 3, completed: 2, incomplete: 1 },
      discoveries: { ...before.discoveries, discovered: 2, undiscovered: 0 } };
    let finishOldRead!: (stats: typeof before) => void;
    let finishWrite!: () => void;
    const getForProfile = vi.fn(async (_id: number) => after)
      .mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve; }));
    const completeQuestWithLinkedDiscoveries = vi.fn(async (_profileId: number, _questId: number) => {
      await new Promise<void>(resolve => { finishWrite = resolve; });
      if (outcome === "uncertain") throw new Error("synthetic uncertain response");
      return { questChanged: true, discoveriesCreated: 1, discoveriesAlreadyPresent: 0 };
    });
    const { user, navigate } = await show({ ...props, progressStatsRepository: { getForProfile },
      progressLinkService: { completeQuestWithLinkedDiscoveries, discoverWithLinkedQuest: vi.fn() } }, "概要");
    expect(getForProfile).toHaveBeenCalledExactlyOnceWith(1);
    await navigate("クエスト");
    await user.click(await screen.findByRole("checkbox", { name: "対象Bの達成状態" }));
    expect(completeQuestWithLinkedDiscoveries).toHaveBeenCalledExactlyOnceWith(1, 2);
    await user.click(tabList().getByRole("button", { name: "クエストを閉じる" }));
    expect(activeTab()).toHaveAccessibleName("概要");
    expect(screen.getByText("進捗を集計しています…")).toBeInTheDocument();
    expect(getForProfile).toHaveBeenCalledTimes(1);
    await act(async () => finishWrite());
    expect(await screen.findByText("達成 2 / 3")).toBeInTheDocument();
    expect(screen.getByText("発見済み 2 / 2")).toBeInTheDocument();
    await act(async () => finishOldRead(before));
    expect(screen.queryByText("達成 1 / 3")).not.toBeInTheDocument();
    expect(getForProfile).toHaveBeenCalledTimes(2);
  });

  it("reloads linked quest progress after discovery and retains the quest master", async () => {
    const { props } = fixtures(repository);
    const items = [discovery(1, "合成遺跡")];
    items[0]!.relatedQuests = [{ id: 2, title: "対象B", notes: null, offerCity: null }];
    props.discoveryRepository.listWithRelations.mockResolvedValue(items);
    let completed: number[] = [];
    let saved: DiscoveryProgress[] = [];
    const listCompletedQuestIds = vi.fn(async () => completed);
    const discoverWithLinkedQuest = vi.fn(async (profileId: number, discoveryId: number, _questId: number | null) => {
      completed = [2];
      saved = [{ profileId, discoveryId, reported: false, cardOwned: true, memo: null, updatedAt: "saved" }];
      return { discoveryCreated: true, questCompleted: true, questAlreadyCompleted: false, selectedQuestId: 2 };
    });
    const { user, navigate } = await show({ ...props, questProgressRepository: { ...props.questProgressRepository, listCompletedQuestIds },
      discoveryProgressRepository: { ...props.discoveryProgressRepository, listByProfile: async () => saved },
      progressLinkService: { completeQuestWithLinkedDiscoveries: vi.fn(), discoverWithLinkedQuest } });
    expect(await screen.findByRole("checkbox", { name: "対象Bの達成状態" })).not.toBeChecked();
    await navigate("発見物");
    await user.click(await screen.findByRole("checkbox", { name: "合成遺跡の発見状態" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "合成遺跡の発見状態" })).toBeChecked());
    expect(discoverWithLinkedQuest).toHaveBeenCalledExactlyOnceWith(1, 1, null);
    await navigate("クエスト");
    expect(await screen.findByRole("checkbox", { name: "対象Bの達成状態" })).toBeChecked();
    expect(listCompletedQuestIds).toHaveBeenCalledTimes(2);
    expect(props.questRepository.listWithDiscoveries).toHaveBeenCalledTimes(1);
  });

  it("preserves the current page and conditions when a staged bookmark is unavailable or unknown", async () => {
    await repository.create("欠落都市", { ...questCondition, filters: { offerCity: { kind: "named", name: "存在しない都市" } } });
    database.prepare("INSERT INTO search_bookmarks (page,name,definition_json) VALUES ('discoveries', '将来形式', ?)").run(JSON.stringify({ ...discoveryCondition, schemaVersion: 2 }));
    const { user } = await show(fixtures(repository).props, "発見物");
    await screen.findByRole("table");
    await user.type(search("発見物名を検索"), "別の");
    await open(user);
    await allPages(user);
    await user.click(await panel().findByRole("button", { name: "欠落都市" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("存在しない都市");
    expect(search("発見物名を検索")).toHaveValue("別の");
    expect(screen.queryByRole("heading", { name: "クエスト" })).not.toBeInTheDocument();
    await user.click(panel().getByRole("button", { name: "将来形式" }));
    expect(screen.getByRole("alert")).toHaveTextContent("バージョン 2");
    expect(search("発見物名を検索")).toHaveValue("別の");
    expect((await repository.list()).every(row => row.lastUsedAt === null)).toBe(true);
  });

  it("reorders published tabs while a staged bookmark validates, then appends the same pending tab once", async () => {
    const bookmark = await repository.create("検証待ちの発見物", { ...discoveryCondition, search: "合成遺跡" });
    const { props } = fixtures(repository);
    let finishMaster!: (rows: DiscoveryWithRelations[]) => void;
    props.discoveryRepository.listWithRelations.mockImplementationOnce(() => new Promise(resolve => { finishMaster = resolve; }));
    const { user } = await show(props);
    const first = activeTab();
    await addTab(user, "クエスト");
    const second = activeTab();
    const table = await screen.findByRole("table");
    await open(user);
    await allPages(user);
    await user.click(await panel().findByRole("button", { name: bookmark.name }));
    expect(screen.getByText("適用先の一覧を読み込んでいます…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "タブを並べ替え" }));
    await user.click(screen.getByRole("button", { name: "左へ移動" }));
    expect(tabList().getAllByRole("tab")).toEqual([second, first]);
    expect(activeTab()).toBe(second);
    expect(screen.getByRole("table")).toBe(table);
    expect((await repository.getById(bookmark.id))?.lastUsedAt).toBeNull();
    await act(async () => finishMaster([discovery(1, "合成遺跡")]));
    expect(await screen.findByRole("searchbox", { name: "発見物名を検索" })).toHaveValue("合成遺跡");
    expect(activeTab()).toHaveAccessibleName(bookmark.name);
    expect(tabList().getAllByRole("tab")).toEqual([second, first, activeTab()]);
    expect(props.discoveryRepository.listWithRelations).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect((await repository.getById(bookmark.id))?.lastUsedAt).not.toBeNull());
  });

  async function startMasterRetry(page: "クエスト" | "発見物") {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const isQuest = page === "クエスト";
    const searchText = isQuest ? "対象B" : "合成遺跡";
    const bookmark = await repository.create("再取得する条件", { ...(isQuest ? questCondition : discoveryCondition), search: searchText });
    const { props, mutateProgress, mutateProfile } = fixtures(repository);
    let finishOldRead!: () => void;
    let finishRetry!: (error?: Error) => void;
    const prepare = <T,>(read: ReturnType<typeof vi.fn<() => Promise<T[]>>>, old: T[], latest: T[]) => {
      read.mockRejectedValueOnce(new Error("synthetic initial master failure"))
        .mockImplementationOnce(() => new Promise(resolve => { finishOldRead = () => resolve(old); }))
        .mockImplementationOnce(() => new Promise((resolve, reject) => {
          finishRetry = error => error ? reject(error) : resolve(latest);
        }));
      return read;
    };
    const master = isQuest
      ? prepare(props.questRepository.listWithDiscoveries, [quest(1, "旧クエスト")], [quest(2, searchText)])
      : prepare(props.discoveryRepository.listWithRelations, [discovery(1, "旧発見物")], [discovery(2, searchText)]);

    const { user } = await show({ ...props, progressStatsRepository: overviewStats }, page);
    const original = activeTab();
    const error = await screen.findByText(`${page}を読み込めませんでした。`);
    await open(user);
    await panel().findByRole("button", { name: bookmark.name });
    await user.click((await actions(user, bookmark.name)).getByRole("button", { name: "新しいタブで開く" }));
    expect(master).toHaveBeenCalledTimes(2);
    expect(screen.getByText("適用先の一覧を読み込んでいます…")).toBeInTheDocument();

    await user.click(within(error.closest(".error-banner")!).getByRole("button", { name: "再読み込み" }));
    expect(master).toHaveBeenCalledTimes(3);
    return { user, original, bookmark, master, finishOldRead, finishRetry, searchText, mutateProgress, mutateProfile };
  }

  it.each([
    ["クエスト", "success"], ["発見物", "success"],
    ["クエスト", "failure"], ["発見物", "failure"],
  ] as const)("settles the staged %s bookmark after a shared master retry (%s)", async (page, outcome) => {
    const { user, original, bookmark, master, finishOldRead, finishRetry, searchText, mutateProgress, mutateProfile } = await startMasterRetry(page);
    const searchLabel = page === "クエスト" ? undefined : "発見物名を検索";
    await act(async () => finishOldRead());
    expect(activeTab()).toBe(original);
    expect(screen.getByText("適用先の一覧を読み込んでいます…")).toBeInTheDocument();
    expect((await repository.getById(bookmark.id))?.lastUsedAt).toBeNull();
    await act(async () => finishRetry(outcome === "failure" ? new Error("synthetic retry failure") : undefined));

    if (outcome === "success") {
      expect(activeTab()).toHaveAccessibleName(bookmark.name);
      expect(tabList().getAllByRole("tab")).toHaveLength(2);
      expect(search(searchLabel)).toHaveValue(searchText);
      expect(screen.getByRole("table")).toHaveTextContent(searchText);
      await waitFor(async () => expect((await repository.getById(bookmark.id))?.lastUsedAt).not.toBeNull());
      await user.click(original);
      expect(search(searchLabel)).toHaveValue("");
    } else {
      expect(await screen.findByText("検索条件の適用に必要なマスターデータを取得できませんでした。")).toBeInTheDocument();
      expect(activeTab()).toBe(original);
      expect(tabList().getAllByRole("tab")).toHaveLength(1);
      expect((await repository.getById(bookmark.id))?.lastUsedAt).toBeNull();
    }
    expect(screen.queryByText("適用先の一覧を読み込んでいます…")).not.toBeInTheDocument();
    expect(master).toHaveBeenCalledTimes(3);
    expect(mutateProgress).not.toHaveBeenCalled();
    expect(mutateProfile).not.toHaveBeenCalled();
  });

  it.each(["クエスト", "発見物"] as const)("opens the staged %s tab even while its invalidated read is still pending", async page => {
    const { bookmark, master, finishOldRead, finishRetry, searchText } = await startMasterRetry(page);
    await act(async () => finishRetry());
    expect(activeTab()).toHaveAccessibleName(bookmark.name);
    expect(screen.queryByText("適用先の一覧を読み込んでいます…")).not.toBeInTheDocument();
    await act(async () => finishOldRead());
    expect(screen.getByRole("table")).toHaveTextContent(searchText);
    expect(master).toHaveBeenCalledTimes(3);
    await waitFor(async () => expect((await repository.getById(bookmark.id))?.lastUsedAt).not.toBeNull());
  });

  it.each([
    ["クエスト", "profile"], ["発見物", "profile"],
    ["クエスト", "replacement"], ["発見物", "replacement"],
    ["クエスト", "close"], ["発見物", "close"],
  ] as const)("does not resume a cancelled %s bookmark during a shared retry (%s)", async (page, reason) => {
    const isQuest = page === "クエスト";
    const next = await repository.create("別の条件", { ...(isQuest ? questCondition : discoveryCondition), search: "別の" });
    const { user, original, bookmark, master, finishOldRead, finishRetry } = await startMasterRetry(page);
    if (reason === "profile") await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    if (reason === "replacement") await user.click(panel().getByRole("button", { name: next.name }));
    if (reason === "close") await user.click(tabList().getByRole("button", { name: `${page}を閉じる` }));

    await act(async () => finishRetry());
    await act(async () => finishOldRead());
    expect(tabList().getAllByRole("tab")).toHaveLength(1);
    expect(tabList().queryByRole("tab", { name: bookmark.name })).not.toBeInTheDocument();
    expect(screen.queryByText("適用先の一覧を読み込んでいます…")).not.toBeInTheDocument();
    expect((await repository.getById(bookmark.id))?.lastUsedAt).toBeNull();
    expect(master).toHaveBeenCalledTimes(3);
    if (reason === "close") {
      expect(activeTab()).toHaveAccessibleName("概要");
    } else {
      expect(activeTab()).toBe(original);
      expect(search(isQuest ? undefined : "発見物名を検索")).toHaveValue(reason === "replacement" ? "別の" : "");
    }
    if (reason === "profile") expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("2");
    if (reason === "replacement") await waitFor(async () => expect((await repository.getById(next.id))?.lastUsedAt).not.toBeNull());
  });

  it.each(["クエスト", "発見物"] as const)("ends a staged %s application if the shared progress retry fails", async (page) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const isQuest = page === "クエスト";
    const bookmark = await repository.create("進捗を再取得する条件", isQuest ? questCondition : discoveryCondition);
    const { props } = fixtures(repository);
    let rejectStaged!: () => void;
    const prepare = <T,>(read: (profileId: number) => Promise<T[]>) => vi.fn(read)
      .mockImplementationOnce(read)
      .mockRejectedValueOnce(new Error("synthetic initial progress failure"))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectStaged = () => reject(new Error("synthetic superseded progress failure"));
      }))
      .mockRejectedValueOnce(new Error("synthetic current progress failure"));
    const questProgress = prepare(props.questProgressRepository.listCompletedQuestIds);
    const discoveryProgress = prepare(props.discoveryProgressRepository.listByProfile);
    const { user } = await show({ ...props,
      questProgressRepository: { ...props.questProgressRepository, listCompletedQuestIds: questProgress },
      discoveryProgressRepository: { ...props.discoveryProgressRepository, listByProfile: discoveryProgress },
    }, page);
    const original = activeTab(), progress = isQuest ? questProgress : discoveryProgress;
    const searchLabel = isQuest ? "クエスト名／地図名を検索" : "発見物名を検索";
    const draft = isQuest ? "対象" : "合成";
    await user.type(await screen.findByRole("searchbox", { name: searchLabel }), draft);
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    const error = await screen.findByText(`${page}進捗を読み込めませんでした。`);
    await open(user);
    await panel().findByRole("button", { name: bookmark.name });
    await user.click((await actions(user, bookmark.name)).getByRole("button", { name: "新しいタブで開く" }));
    expect(progress).toHaveBeenCalledTimes(3);
    await user.click(within(error.closest(".error-banner")!).getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText("検索条件の適用に必要なプロフィールの進捗を取得できませんでした。")).toBeInTheDocument();
    await act(async () => rejectStaged());
    expect(activeTab()).toBe(original);
    expect(tabList().getAllByRole("tab")).toHaveLength(1);
    expect(screen.queryByText("適用先の一覧を読み込んでいます…")).not.toBeInTheDocument();
    expect((await repository.getById(bookmark.id))?.lastUsedAt).toBeNull();
    expect(progress.mock.calls.map(([id]) => id)).toEqual([1, 2, 2, 2]);
    const currentError = screen.getByText(`${page}進捗を読み込めませんでした。`);
    await user.click(within(currentError.closest(".error-banner")!).getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByRole("searchbox", { name: searchLabel })).toHaveValue(draft);
    expect(progress.mock.calls.map(([id]) => id)).toEqual([1, 2, 2, 2, 2]);
  });

  it("waits for the committed master revision when a retry overlaps a master import", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bookmark = await repository.create("取込後の都市", { ...questCondition, filters: { offerCity: { kind: "named", name: "新都市" } } });
    const { props } = fixtures(repository);
    const old = [quest(1, "旧世代")];
    const latest = { ...quest(2, "新世代"), offerCities: [{ position: 0, cityName: "新都市" }] };
    let finishStaged!: (value: QuestWithDiscoveries[]) => void;
    let finishRetry!: (value: QuestWithDiscoveries[]) => void;
    let finishNewRevision!: (value: QuestWithDiscoveries[]) => void;
    props.questRepository.listWithDiscoveries
      .mockRejectedValueOnce(new Error("synthetic master failure"))
      .mockImplementationOnce(() => new Promise(resolve => { finishStaged = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishRetry = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNewRevision = resolve; }));
    const dataset = "quests" as const;
    const fileName = "synthetic-quests.csv", sha256 = "a".repeat(64);
    const selection = { dataset, fileName, sha256, rowCount: 0, warningCount: 0,
      request: { dataset, fileName, sha256, quests: [], discoveries: [], warnings: [] } };
    let finishImport!: (value: ImportResult) => void;
    const importPrepared = vi.fn(() => new Promise<ImportResult>(resolve => { finishImport = resolve; }));
    const { user, navigate } = await show({ ...props, masterImportService: { selectFile: async () => selection, importPrepared },
      masterDataStatusRepository: { getStatus: async () => ({ datasets: {
        quests: { dataset: "quests", activeCount: 1, latestImport: null },
        discoveries: { dataset: "discoveries", activeCount: 0, latestImport: null },
      }, recentHistory: [] }) },
    }, "マスターデータ");
    await user.click(await screen.findByRole("button", { name: "quests.csv を選択" }));
    await user.click(await screen.findByRole("button", { name: "クエスト情報を更新" }));
    expect(importPrepared).toHaveBeenCalledOnce();
    await navigate("クエスト");
    const error = await screen.findByText("クエストを読み込めませんでした。");
    await open(user);
    await panel().findByRole("button", { name: bookmark.name });
    await user.click((await actions(user, bookmark.name)).getByRole("button", { name: "新しいタブで開く" }));
    await user.click(within(error.closest(".error-banner")!).getByRole("button", { name: "再読み込み" }));
    expect(props.questRepository.listWithDiscoveries).toHaveBeenCalledTimes(3);
    await act(async () => finishImport({ dataset, fileName, sha256, importedRowCount: 1, insertedCount: 1,
      updatedCount: 0, inactiveCount: 0, relationCount: 0, warningCount: 0, warnings: [] }));
    expect(props.questRepository.listWithDiscoveries).toHaveBeenCalledTimes(4);
    await act(async () => { finishStaged(old); finishRetry(old); });
    expect(screen.getByText("適用先の一覧を読み込んでいます…")).toBeInTheDocument();
    expect((await repository.getById(bookmark.id))?.lastUsedAt).toBeNull();
    await act(async () => finishNewRevision([latest]));
    expect(activeTab()).toHaveAccessibleName(bookmark.name);
    expect(screen.getByRole("table")).toHaveTextContent("新世代");
    expect(screen.getByRole("table")).not.toHaveTextContent("旧世代");
    expect(props.questRepository.listWithDiscoveries).toHaveBeenCalledTimes(4);
  });

  it.each(["newer", "profile", "navigation", "close"] as const)("discards a delayed cross-page application after %s", async reason => {
    const waiting = await repository.create("待機中の条件", { ...questCondition, filters: { successorStatus: "present" } });
    await repository.create("別の条件", { ...discoveryCondition, search: "合成遺跡" });
    const { props } = fixtures(repository);
    let resolve!: (rows: QuestDependency[]) => void;
    props.questRepository.listDependencies.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { user, navigate } = await show({ ...props, progressStatsRepository: overviewStats }, "発見物");
    await open(user);
    await allPages(user);
    await user.click(await panel().findByRole("button", { name: "待機中の条件" }));
    expect(screen.getByText("適用先の一覧を読み込んでいます…")).toBeInTheDocument();
    if (reason === "newer") await user.click(panel().getByRole("button", { name: "別の条件" }));
    if (reason === "profile") await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    if (reason === "navigation") await navigate("プロフィール");
    if (reason === "close") {
      await user.click(tabList().getByRole("button", { name: "発見物を閉じる" }));
      await user.click(screen.getByRole("button", { name: "元に戻す" }));
    }
    await act(async () => resolve([]));
    expect(screen.queryByRole("heading", { name: "クエスト" })).not.toBeInTheDocument();
    expect((await repository.getById(waiting.id))?.lastUsedAt).toBeNull();
    if (reason === "newer") expect(search("発見物名を検索")).toHaveValue("合成遺跡");
    if (reason === "close") expect(tabList().getAllByRole("tab")).toHaveLength(2);
  });

  it("reports a failed usage write while retaining a successful zero-result application", async () => {
    await repository.create("0件の条件", { ...questCondition, search: "一致なし" });
    vi.spyOn(repository, "markUsed").mockRejectedValueOnce(new Error("synthetic"));
    const { user } = await show(fixtures(repository).props);
    await open(user);
    await user.click(await panel().findByRole("button", { name: "0件の条件" }));
    expect(await screen.findByText("検索条件は適用されましたが、最終使用日時を保存できませんでした。")).toBeInTheDocument();
    expect(screen.getByText("「0件の条件」を適用しました。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "条件に一致するクエストがありません" })).toBeInTheDocument();
    expect(search()).toHaveValue("一致なし");
  });

  it.each(["empty", "error"] as const)("keeps management available on a master %s and handles list retry", async status => {
    await repository.create("管理対象", questCondition);
    vi.spyOn(repository, "list").mockRejectedValueOnce(new Error("synthetic"));
    const { props } = fixtures(repository);
    if (status === "empty") props.questRepository.listWithDiscoveries.mockResolvedValue([]);
    else props.questRepository.listWithDiscoveries.mockRejectedValue(new Error("synthetic"));
    const { user } = await show(props);
    await open(user);
    expect(await panel().findByText("ブックマークを読み込めませんでした。")).toBeInTheDocument();
    await user.click(panel().getByRole("button", { name: "再読み込み" }));
    await panel().findByRole("button", { name: "管理対象" });
    expect(panel().getByRole("button", { name: "現在の条件を保存" })).toBeDisabled();
    await user.click(panel().getByRole("button", { name: "管理対象" }));
    expect(await screen.findByText(/検索条件の適用に必要なマスターデータ|現在のマスターでは検索条件を適用できません/)).toBeInTheDocument();
    expect((await repository.list())[0]?.lastUsedAt).toBeNull();
    await user.click((await actions(user, "管理対象")).getByRole("button", { name: "削除" }));
    await user.click(panel().getByRole("button", { name: "削除する" }));
    expect(await panel().findByText("保存済みのブックマークがありません。")).toBeInTheDocument();
  });

  it("shows combined limits, rejects duplicates, and allows unfavoriting when full", async () => {
    for (let i = 0; i < 50; i++) await repository.create(`合成${i}`, i < 25 ? questCondition : discoveryCondition, i < 5);
    const { user } = await show(fixtures(repository).props);
    await open(user);
    expect(await panel().findByText("保存済み 50 / 50件・お気に入り 5 / 5件")).toBeInTheDocument();
    await user.click(panel().getByRole("button", { name: "合成5のお気に入り" }));
    expect(await screen.findByText("お気に入りの上限は両ページ合計5件です。")).toBeInTheDocument();
    await user.click(panel().getByRole("button", { name: "合成0のお気に入り" }));
    expect(await panel().findByText("保存済み 50 / 50件・お気に入り 4 / 5件")).toBeInTheDocument();
    await user.click(panel().getByRole("button", { name: "現在の条件を保存" }));
    await user.type(panel().getByLabelText("ブックマーク名"), "新規上限");
    await user.click(panel().getByRole("button", { name: "保存する" }));
    expect(await screen.findByText("ブックマークの上限は両ページ合計50件です。")).toBeInTheDocument();
    await user.click(panel().getByRole("button", { name: "キャンセル" }));
    await user.click((await actions(user, "合成1")).getByRole("button", { name: "名前を変更" }));
    await user.clear(panel().getByLabelText("ブックマーク名"));
    await user.type(panel().getByLabelText("ブックマーク名"), "合成2");
    await user.click(panel().getByRole("button", { name: "保存する" }));
    expect(await screen.findByText("このページには同じ名前のブックマークがあります。")).toBeInTheDocument();
    expect(await repository.list()).toHaveLength(50);
  });

  it("shows favorites, recent use and unused creation order while filtering by page or name", async () => {
    const older = await repository.create("未使用・古い", questCondition);
    await repository.create("未使用・新しい", questCondition);
    await repository.create("別ページ", discoveryCondition);
    await repository.create("未使用・古い", discoveryCondition);
    await repository.markUsed((await repository.create("使用済み", questCondition)).id);
    await repository.create("お気に入り", questCondition, true);
    database.prepare("UPDATE search_bookmarks SET created_at = '2000-01-01' WHERE id = ?").run(older.id);
    const { user } = await show(fixtures(repository).props);
    await open(user);
    await panel().findByRole("list", { name: "保存済みブックマーク" });
    expect(rows().map(row => within(row).getAllByRole("button")[0]?.textContent)).toEqual(["お気に入り", "使用済み", "未使用・新しい", "未使用・古い"]);
    await allPages(user);
    await user.type(panel().getByRole("searchbox", { name: "ブックマーク名を検索" }), "未使用・古い");
    expect(rows()).toHaveLength(2);
  });

  it("keeps compact navigation keyboard-accessible, ignores IME Enter, and restores focus on Escape", async () => {
    mockWorkspaceMedia(600, 480);
    const user = userEvent.setup();
    render(<App {...fixtures(repository).props} />);
    await screen.findByRole("list", { name: "プロフィール一覧" });
    await user.click(screen.getByRole("button", { name: "メニューを開く" }));
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "クエスト" }));
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    bookmarkButton().focus();
    await user.keyboard("{Enter}");
    expect(panel().getByRole("searchbox", { name: "ブックマーク名を検索" })).toHaveFocus();
    await user.click(await panel().findByRole("button", { name: "現在の条件を保存" }));
    const input = panel().getByLabelText("ブックマーク名");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "合成名" } });
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
    fireEvent.submit(input.closest("form")!);
    expect(await repository.list()).toHaveLength(0);
    fireEvent.compositionEnd(input);
    await user.keyboard("{Enter}");
    expect(await panel().findByRole("button", { name: "合成名" })).toBeInTheDocument();
    await user.type(panel().getByRole("searchbox", { name: "ブックマーク名を検索" }), "見つからない");
    expect(panel().getByText("一致するブックマークがありません。")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(bookmarkButton()).toHaveFocus();
    expect(bookmarkButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "ブックマーク管理" })).not.toBeInTheDocument();
  });
});
