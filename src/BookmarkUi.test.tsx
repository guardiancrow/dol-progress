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
import type { DiscoveryWithRelations, QuestWithDiscoveries } from "./domain/models";
import { SearchBookmarkRepository } from "./repositories/searchBookmarkRepository";
import type { QuestSearchCondition, DiscoverySearchCondition } from "./searchConditions/definition";
import type { QuestDependency } from "./quests/prerequisites";

vi.mock("./discoveries/stateReader", async (original) => ({
  ...await original<typeof import("./discoveries/stateReader")>(),
  discoveryStateReader: { list: async () => [] },
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
    expect(screen.getByRole("table")).not.toHaveTextContent("別の史跡");
    expect(bookmarkButton()).toHaveFocus();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await open(user);
    await allPages(user);
    await user.click(await panel().findByRole("button", { name: "クエストの条件" }));
    expect(await screen.findByRole("table")).toHaveTextContent("対象A");
    expect(screen.getByRole("table")).not.toHaveTextContent("対象B");
    expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("2");
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

  it.each(["newer", "profile", "navigation"] as const)("discards a delayed cross-page application after %s", async reason => {
    const waiting = await repository.create("待機中の条件", { ...questCondition, filters: { successorStatus: "present" } });
    await repository.create("別の条件", { ...discoveryCondition, search: "合成遺跡" });
    const { props } = fixtures(repository);
    let resolve!: (rows: QuestDependency[]) => void;
    props.questRepository.listDependencies.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { user, navigate } = await show(props, "発見物");
    await open(user);
    await allPages(user);
    await user.click(await panel().findByRole("button", { name: "待機中の条件" }));
    expect(screen.getByText("適用先の一覧を読み込んでいます…")).toBeInTheDocument();
    if (reason === "newer") await user.click(panel().getByRole("button", { name: "別の条件" }));
    if (reason === "profile") await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    if (reason === "navigation") await navigate("プロフィール");
    await act(async () => resolve([]));
    expect(screen.queryByRole("heading", { name: "クエスト" })).not.toBeInTheDocument();
    expect((await repository.getById(waiting.id))?.lastUsedAt).toBeNull();
    if (reason === "newer") expect(search("発見物名を検索")).toHaveValue("合成遺跡");
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
