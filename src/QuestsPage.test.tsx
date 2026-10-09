// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { QuestTable } from "./components/quests/QuestTable";
import type { Profile, QuestDiscoverySummary, QuestWithDiscoveries } from "./domain/models";
import type { ProfileRepositoryPort } from "./profiles/ProfileContext";
import type {
  QuestProgressRepositoryPort,
  QuestRepositoryPort,
  QuestRowViewModel,
} from "./quests/types";
import type { QuestDependency } from "./quests/prerequisites";
import type { UpdateProfileInput } from "./repositories/profileRepository";
import type { ProgressLinkServicePort } from "./progressLink";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Quest UI", () => {
  it("passes master notes to the popup without changing completion, and closes on profile or page changes", async () => {
    const repositories = createRepositories([profile(1, "A"), profile(2, "B")], [
      quest(1, "合成依頼", { notes: "GVDB由来の合成備考\n二行目" }),
    ]);
    const user = await openQuests(repositories);
    await user.click(screen.getByRole("button", { name: "合成依頼の備考を表示" }));
    expect(screen.getByRole("dialog", { name: "合成依頼" })).toHaveTextContent("GVDB由来の合成備考");
    expect(repositories.progress.markCompleted).not.toHaveBeenCalled();
    expect(repositories.progress.markIncomplete).not.toHaveBeenCalled();
    expect(repositories.link.completeQuestWithLinkedDiscoveries).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await screen.findByRole("table");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成依頼の備考を表示" }));
    await user.click(screen.getByRole("button", { name: "プロフィール" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for a profile when selectedProfileId is null", async () => {
    const repositories = createRepositories([], [quest(1, "テスト依頼A")]);
    await openQuests(repositories);

    expect(
      screen.getByRole("heading", {
        name: "クエスト進捗を表示するプロフィールを選択してください",
      }),
    ).toBeInTheDocument();
    expect(repositories.progress.listCompletedQuestIds).not.toHaveBeenCalled();
  });

  it("distinguishes an empty master from an empty filter result", async () => {
    const repositories = createRepositories([profile(1, "航海者")], []);
    await openQuests(repositories);

    expect(
      await screen.findByText("クエストのマスターデータがありません"),
    ).toBeInTheDocument();
  });

  it("shows quest master fields", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A", { difficulty: 10, requiredSkills: "視認、地理学", requiredSkillNames: ["視認", "地理学"] })],
    );
    await openQuests(repositories);

    expect(await screen.findByText("テスト依頼A")).toBeInTheDocument();
    expect(screen.getByText("視認、地理学")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /難易度/ })).toBeInTheDocument();
  });

  it("keeps pagination outside the workspace table scroll area", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A")],
    );
    await openQuests(repositories);

    const table = screen.getByRole("table");
    const scrollArea = table.parentElement as HTMLElement;
    const workspace = scrollArea.closest(".workspace-table") as HTMLElement;
    const page = table.closest(".workspace-page") as HTMLElement;
    const pagination = screen.getByLabelText("クエスト一覧ページ操作");

    expect(scrollArea).toHaveClass("quest-table-scroll");
    expect(workspace).toContainElement(scrollArea);
    expect(workspace).toContainElement(pagination);
    expect(scrollArea).not.toContainElement(pagination);
    expect(page).toHaveClass("workspace-page");
    expect(page.closest("main")).toHaveClass("main-content--workspace");
  });

  it("keeps prerequisite help collapsed beside its label and focusable for keyboard use", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [quest(1, "テスト依頼A")]);
    const user = await openQuests(repositories);

    const filter = screen.getByLabelText("前提クエスト");
    const summary = screen.getByText("説明", { selector: "summary" });
    const disclosure = summary.closest("details") as HTMLDetailsElement;
    const field = filter.closest(".quest-filter-field") as HTMLElement;
    expect(field).toContainElement(disclosure);
    expect(disclosure).not.toHaveAttribute("open");
    expect(field.querySelector("label")).toHaveAttribute("for", "prerequisite-filter");

    expect(summary.tabIndex).toBe(0);
    summary.focus();
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("「要確認」は複数前提や地図など、充足を確定できない関係です。"))
      .toBeVisible();
    await user.click(summary);
    expect(disclosure).not.toHaveAttribute("open");
    expect(filter).toHaveValue("all");
  });

  it("filters Japanese quest titles by partial match", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A"), quest(2, "近海の調査")],
    );
    await openQuests(repositories);

    await user.type(screen.getByLabelText("クエスト名／地図名を検索"), "依頼A");

    expect(screen.getByText("テスト依頼A")).toBeInTheDocument();
    expect(screen.queryByText("近海の調査")).not.toBeInTheDocument();
    expect(screen.getByText("2件中 1件表示")).toBeInTheDocument();
  });

  it("filters completed quests", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "達成済みクエスト"), quest(2, "未達成クエスト")],
      new Map([[1, [1]]]),
    );
    await openQuests(repositories);

    await user.selectOptions(screen.getByLabelText("達成状態"), "completed");

    expect(screen.getByText("達成済みクエスト")).toBeInTheDocument();
    expect(screen.queryByText("未達成クエスト")).not.toBeInTheDocument();
  });

  it("filters incomplete quests", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "達成済みクエスト"), quest(2, "未達成クエスト")],
      new Map([[1, [1]]]),
    );
    await openQuests(repositories);

    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");

    expect(screen.queryByText("達成済みクエスト")).not.toBeInTheDocument();
    expect(screen.getByText("未達成クエスト")).toBeInTheDocument();
  });

  it("keeps the completion control synchronized through filter changes and rerenders", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "達成済みクエスト"), quest(2, "未達成クエスト")],
      new Map([[1, [1]]]),
    );
    await openQuests(repositories);

    const completion = screen.getByLabelText("達成状態");
    await user.selectOptions(completion, "completed");
    expect(completion).toHaveValue("completed");
    expect(screen.queryByText("未達成クエスト")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "達成済みクエストの達成状態" }));
    await waitFor(() => expect(completion).toHaveValue("completed"));

    await user.selectOptions(completion, "incomplete");
    expect(completion).toHaveValue("incomplete");
    expect(screen.getByText("未達成クエスト")).toBeInTheDocument();
    await user.selectOptions(completion, "all");
    expect(completion).toHaveValue("all");
    expect(screen.getByText("達成済みクエスト")).toBeInTheDocument();
    expect(screen.getByText("未達成クエスト")).toBeInTheDocument();
  });

  it("builds offer method filters from master data", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [
        quest(1, "仲介人クエスト", { offerMethod: "冒険者依頼仲介人" }),
        quest(2, "書庫地図", { offerMethod: "書庫" }),
      ],
    );
    await openQuests(repositories);

    const filter = screen.getByLabelText("オファー方法");
    expect(within(filter).getByRole("option", { name: "書庫" })).toBeInTheDocument();
    await user.selectOptions(filter, "method:書庫");

    expect(screen.getByText("書庫地図")).toBeInTheDocument();
    expect(screen.queryByText("仲介人クエスト")).not.toBeInTheDocument();
  });

  it("shows one grouped offer select while preserving every master-derived individual method", async () => {
    const methods = [
      "冒険クエスト", "交易クエスト", "海事クエスト",
      "地理学", "考古学", "宗教学", "生物学", "美術", "財宝鑑定", "天文学",
      "トレジャーハント", "レガシー", "伝承クエスト", "勅命クエスト",
      "収奪・陸戦地図", "地図を伴わない天体発見物", "気象・現象（発見物）",
      "沈没船（発見物）", "港・集落（発見物）", "移民誘致クエスト",
      "追究クエスト", "遺跡ダンジョン", "釣り（発見物）", "陸地再調査時の報酬",
    ];
    const repositories = createRepositories([profile(1, "航海者")],
      methods.map((method, index) => quest(index + 1, `候補${index + 1}`, { offerMethod: method })));
    const user = await openQuests(repositories);
    const filter = screen.getByLabelText("オファー方法");
    expect(screen.getAllByLabelText("オファー方法")).toHaveLength(1);
    expect([...filter.querySelectorAll("optgroup")].map((group) => group.label))
      .toEqual(["大分類", "クエスト（個別）", "地図（個別）", "その他"]);
    expect([...filter.querySelectorAll('option[value^="method:"]')]).toHaveLength(24);
    expect(within(filter).getByRole("option", { name: "クエスト" })).toHaveValue("group:quest");
    expect(within(filter).getByRole("option", { name: "地図" })).toHaveValue("group:map");

    await user.selectOptions(filter, "group:quest");
    expect(questTitles()).toEqual(["候補1", "候補2", "候補3"]);
    await user.type(screen.getByLabelText("クエスト名／地図名を検索"), "一致しない");
    expect(filter).toHaveValue("group:quest");
    expect([...filter.querySelectorAll('option[value^="method:"]')]).toHaveLength(24);
    await user.clear(screen.getByLabelText("クエスト名／地図名を検索"));
    await user.selectOptions(filter, "group:map");
    expect(questTitles()).toEqual(["候補4", "候補5", "候補6", "候補7", "候補8", "候補9", "候補10"]);
    await user.selectOptions(filter, "method:冒険クエスト");
    expect(questTitles()).toEqual(["候補1"]);
    await user.selectOptions(filter, "method:考古学");
    expect(questTitles()).toEqual(["候補5"]);
    await user.selectOptions(filter, "method:伝承クエスト");
    expect(questTitles()).toEqual(["候補13"]);
  });

  it("resets only offer selections absent from the new master options", async () => {
    const user = userEvent.setup();
    const onToggleCompletion = vi.fn(async () => undefined);
    const both = [offerTableRow(1, "冒険クエスト"), offerTableRow(2, "考古学")];
    const { rerender } = render(<QuestTable rows={both} paginationResetKey={0} onToggleCompletion={onToggleCompletion} />);
    const filter = screen.getByLabelText("オファー方法");
    await user.selectOptions(filter, "method:冒険クエスト");
    rerender(<QuestTable rows={[both[1]!]} paginationResetKey={0} onToggleCompletion={onToggleCompletion} />);
    await waitFor(() => expect(filter).toHaveValue("all"));
    expect(within(filter).queryByRole("option", { name: "冒険クエスト" })).not.toBeInTheDocument();

    await user.selectOptions(filter, "group:map");
    rerender(<QuestTable rows={[offerTableRow(3, "伝承クエスト")]} paginationResetKey={0} onToggleCompletion={onToggleCompletion} />);
    await waitFor(() => expect(filter).toHaveValue("all"));
    expect(filter.querySelector('optgroup[label="大分類"]')).toBeNull();

    rerender(<QuestTable rows={both} paginationResetKey={0} onToggleCompletion={onToggleCompletion} />);
    await user.selectOptions(filter, "group:quest");
    rerender(<QuestTable rows={[both[1]!]} paginationResetKey={0} onToggleCompletion={onToggleCompletion} />);
    await waitFor(() => expect(filter).toHaveValue("all"));
  });

  it("filters offer groups before sorting and pagination and keeps Rank sorting independent", async () => {
    const grouped = Array.from({ length: 52 }, (_, index) => quest(index + 1, `Quest ${index + 1}`, {
      offerMethod: index % 2 === 0 ? "冒険クエスト" : "交易クエスト",
    }));
    const repositories = createRepositories([profile(1, "航海者")], [
      ...grouped, quest(53, "地図候補", { offerMethod: "考古学" }),
    ]);
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("オファー方法"), "group:quest");
    expect(screen.getByText("53件中 52件表示")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" }));
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("オファー方法"), "group:map");
    expect(screen.getByText("1 / 1ページ")).toBeInTheDocument();
    expect(questTitles()).toEqual(["地図候補"]);
  });

  it("combines map offer methods with skill Rank sorting", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      quest(1, "地図R2", { offerMethod: "考古学", requiredSkillsNormalized: [{ skillName: "考古学", requiredRank: 2 }] }),
      quest(2, "地図R8", { offerMethod: "地理学", requiredSkillsNormalized: [{ skillName: "考古学", requiredRank: 8 }] }),
      quest(3, "QuestR12", { offerMethod: "冒険クエスト", requiredSkillsNormalized: [{ skillName: "考古学", requiredRank: 12 }] }),
    ]);
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("必要スキル"), "考古学");
    await user.selectOptions(screen.getByLabelText("要求Rank"), "desc");
    await user.selectOptions(screen.getByLabelText("オファー方法"), "group:map");
    expect(questTitles()).toEqual(["地図R8", "地図R2"]);
    expect(screen.getByLabelText("要求Rank")).toHaveValue("desc");
  });

  it("combines Quest offer group with city, skill, Discovery, and prerequisite filters", async () => {
    const art = linkedDiscovery(10, "美術品A", 1, "美術品", 1);
    const repositories = createRepositories([profile(1, "航海者")], [
      quest(1, "前提A", { offerMethod: "冒険クエスト" }),
      quest(2, "対象", { offerMethod: "冒険クエスト", offerCity: "ロンドン",
        requiredSkillsNormalized: [{ skillName: "美術", requiredRank: 5 }], discoveries: [art] }),
      quest(3, "地図側", { offerMethod: "美術", offerCity: "ロンドン",
        requiredSkillsNormalized: [{ skillName: "美術", requiredRank: 5 }], discoveries: [art] }),
      quest(4, "別都市", { offerMethod: "交易クエスト", offerCity: "セビリア",
        requiredSkillsNormalized: [{ skillName: "美術", requiredRank: 5 }], discoveries: [art] }),
    ], new Map([[1, [1]]]), [edge(2, 1)]);
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("オファー方法"), "group:quest");
    await user.selectOptions(screen.getByLabelText("オファー都市"), "ロンドン");
    await user.selectOptions(screen.getByLabelText("必要スキル"), "美術");
    await user.selectOptions(screen.getByLabelText("発見物"), "category:1");
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "satisfied");
    expect(questTitles()).toEqual(["対象"]);
    expect(prerequisiteCell("対象")).toHaveTextContent("前提A");
  });

  it("builds offer city filters from master data", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [
        quest(1, "セビリアの依頼", { offerCity: "セビリア" }),
        quest(2, "ロンドンの依頼", { offerCity: "ロンドン" }),
      ],
    );
    await openQuests(repositories);

    await user.selectOptions(screen.getByLabelText("オファー都市"), "ロンドン");

    expect(screen.getByText("ロンドンの依頼")).toBeInTheDocument();
    expect(screen.queryByText("セビリアの依頼")).not.toBeInTheDocument();
  });

  it("uses individual normalized offer cities instead of the combined source string", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [
        quest(100, "テスト依頼B", {
          offerCity: "アテネ,アレクサンドリア,イスタンブール,チュニス",
          offerCities: ["アテネ", "アレクサンドリア", "イスタンブール", "チュニス"],
        }),
        quest(101, "別の依頼", { offerCity: "リスボン" }),
      ],
    );
    await openQuests(repositories);

    const filter = screen.getByLabelText("オファー都市");
    expect(within(filter).queryByRole("option", { name: "アテネ,アレクサンドリア,イスタンブール,チュニス" })).not.toBeInTheDocument();
    for (const city of ["アテネ", "アレクサンドリア", "イスタンブール", "チュニス"]) {
      await user.selectOptions(filter, city);
      expect(screen.getByText("テスト依頼B")).toBeInTheDocument();
      expect(screen.queryByText("別の依頼")).not.toBeInTheDocument();
    }
  });

  it("filters normalized skill names independently of rank and language suffix anomalies", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [
        quest(1, "探索1", { requiredSkills: "探索(1)", requiredSkillNames: ["探索"] }),
        quest(2, "探索100", { requiredSkills: "探索(100)", requiredSkillNames: ["探索"] }),
        quest(3, "日本語由来", { requiredSkills: "日本語(5)", requiredSkillNames: ["日本語"] }),
        quest(4, "ランクなし", { requiredSkills: "サルベージ", requiredSkillNames: ["サルベージ"] }),
      ],
    );
    await openQuests(repositories);

    const filter = screen.getByLabelText("必要スキル");
    expect(within(filter).getByRole("option", { name: "探索" })).toBeInTheDocument();
    expect(within(filter).getByRole("option", { name: "日本語" })).toBeInTheDocument();
    expect(within(filter).getByRole("option", { name: "サルベージ" })).toBeInTheDocument();
    await user.selectOptions(filter, "探索");
    expect(screen.getByText("探索1")).toBeInTheDocument();
    expect(screen.getByText("探索100")).toBeInTheDocument();
    expect(screen.queryByText("日本語由来")).not.toBeInTheDocument();
    await user.selectOptions(filter, "日本語");
    expect(screen.getByText("日本語由来")).toBeInTheDocument();
    await user.selectOptions(filter, "サルベージ");
    expect(screen.getByText("ランクなし")).toBeInTheDocument();
  });

  it("sorts a supported column", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "ベータ"), quest(2, "アルファ")],
    );
    await openQuests(repositories);

    await user.click(screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" }));

    const bodyRows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(bodyRows[0]).toHaveTextContent("アルファ");
    expect(bodyRows[1]).toHaveTextContent("ベータ");
  });

  it("returns to repository source order when name sort is cleared", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "ベータ"), quest(2, "アルファ"), quest(3, "ガンマ")],
    );
    await openQuests(repositories);
    const sort = screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" });
    const rowTitles = () =>
      within(screen.getByRole("table"))
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent ?? "");

    expect(rowTitles()[0]).toContain("ベータ");
    await user.click(sort);
    expect(rowTitles()[0]).toContain("アルファ");
    await user.click(sort);
    expect(rowTitles()[0]).toContain("ベータ");
    expect(rowTitles()[1]).toContain("ガンマ");
    await user.click(sort);
    expect(rowTitles()[0]).toContain("ベータ");
    expect(rowTitles()[1]).toContain("アルファ");
  });

  it("paginates without rendering all master rows", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      Array.from({ length: 51 }, (_, index) => quest(index + 1, `クエスト${index + 1}`)),
    );
    await openQuests(repositories);

    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(screen.queryByText("クエスト51")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("クエスト51")).toBeInTheDocument();
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
  });

  it("keeps page two during consecutive quest progress updates", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      Array.from({ length: 52 }, (_, index) => quest(index + 1, `クエスト${index + 1}`)),
    );
    const user = await openQuests(repositories);
    await user.click(screen.getByRole("button", { name: "次ページ" }));

    await user.click(screen.getByRole("checkbox", { name: "クエスト51の達成状態" }));
    await waitFor(() => expect(repositories.progress.markCompleted).toHaveBeenCalledWith(1, 51));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "クエスト52の達成状態" }));
    await waitFor(() => expect(repositories.progress.markCompleted).toHaveBeenCalledWith(1, 52));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
  });

  it("keeps a valid filtered page and clamps only after that page disappears", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      Array.from({ length: 101 }, (_, index) => quest(index + 1, `クエスト${index + 1}`)),
    );
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    await user.click(screen.getByRole("checkbox", { name: "クエスト51の達成状態" }));
    await waitFor(() => expect(repositories.progress.markCompleted).toHaveBeenCalledWith(1, 51));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
  });

  it("clamps a filtered last page after its final row disappears", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      Array.from({ length: 51 }, (_, index) => quest(index + 1, `クエスト${index + 1}`)),
    );
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    await user.click(screen.getByRole("checkbox", { name: "クエスト51の達成状態" }));
    await waitFor(() => expect(repositories.progress.markCompleted).toHaveBeenCalledWith(1, 51));
    expect(screen.getByText("1 / 1ページ")).toBeInTheDocument();
  });

  it("marks an incomplete quest as completed after persistence succeeds", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A")],
    );
    await openQuests(repositories);
    const checkbox = screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" });

    await user.click(checkbox);

    await waitFor(() => expect(repositories.progress.markCompleted).toHaveBeenCalledWith(1, 1));
    expect(checkbox).toBeChecked();
    expect(screen.queryByText("クエストを達成済みにしました。")).not.toBeInTheDocument();
  });

  it("shows how many related discoveries were auto-created", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A")],
    );
    repositories.link.completeQuestWithLinkedDiscoveries.mockResolvedValue({
      questChanged: true,
      discoveriesCreated: 2,
      discoveriesAlreadyPresent: 1,
    });
    const user = await openQuests(repositories);

    await user.click(screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" }));

    const feedback = await screen.findByRole("status");
    expect(feedback).toHaveTextContent("関連する発見物 2件");
    expect(feedback).toHaveClass("progress-feedback");
    expect(repositories.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledWith(1, 1);
  });

  it("marks a completed quest as incomplete by deleting progress", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A")],
      new Map([[1, [1]]]),
    );
    await openQuests(repositories);
    const checkbox = screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" });

    await user.click(checkbox);

    await waitFor(() => expect(repositories.progress.markIncomplete).toHaveBeenCalledWith(1, 1));
    expect(checkbox).not.toBeChecked();
  });

  it("keeps the displayed state unchanged when a progress update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A")],
    );
    repositories.progress.markCompleted = vi.fn().mockRejectedValue(new Error("DB error"));
    await openQuests(repositories);
    const checkbox = screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" });

    await user.click(checkbox);

    expect(await screen.findByRole("alert")).toHaveTextContent("達成状態を更新できませんでした");
    expect(checkbox).not.toBeChecked();
  });

  it("prevents duplicate updates while a quest write is pending", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (() => void) | undefined;
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A")],
    );
    repositories.progress.markCompleted = vi.fn(
      () => new Promise<void>((resolve) => { resolveUpdate = resolve; }),
    );
    await openQuests(repositories);
    const checkbox = screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" });

    await user.click(checkbox);
    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
    expect(repositories.progress.markCompleted).toHaveBeenCalledTimes(1);
    resolveUpdate?.();
    await waitFor(() => expect(checkbox).toBeChecked());
  });

  it("does not show an old profile operation result after profile switch", async () => {
    let resolveUpdate: ((result: { questChanged: boolean; discoveriesCreated: number; discoveriesAlreadyPresent: number }) => void) | undefined;
    const repositories = createRepositories(
      [profile(1, "航海者A"), profile(2, "航海者B")],
      [quest(1, "テスト依頼A")],
    );
    repositories.link.completeQuestWithLinkedDiscoveries = vi.fn(
      () => new Promise((resolve) => { resolveUpdate = resolve; }),
    );
    const user = await openQuests(repositories);
    await user.click(screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" }));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");

    resolveUpdate?.({ questChanged: true, discoveriesCreated: 1, discoveriesAlreadyPresent: 0 });

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" })).not.toBeChecked());
    expect(screen.queryByText(/関連する発見物 1件/)).not.toBeInTheDocument();
    expect(repositories.link.completeQuestWithLinkedDiscoveries).toHaveBeenCalledWith(1, 1);
  });

  it("loads completion state independently when the selected profile changes", async () => {
    const user = userEvent.setup();
    const repositories = createRepositories(
      [profile(1, "航海者A"), profile(2, "航海者B")],
      [quest(1, "テスト依頼A")],
      new Map([[1, [1]], [2, []]]),
    );
    await openQuests(repositories);
    expect(screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" })).toBeChecked();

    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" })).not.toBeChecked(),
    );
    expect(repositories.progress.listCompletedQuestIds).toHaveBeenLastCalledWith(2);
  });

  it("ignores a stale async completion result after a rapid profile change", async () => {
    const user = userEvent.setup();
    let resolveProfileA: ((ids: number[]) => void) | undefined;
    let resolveProfileB: ((ids: number[]) => void) | undefined;
    const repositories = createRepositories(
      [profile(1, "航海者A"), profile(2, "航海者B")],
      [quest(1, "テスト依頼A")],
    );
    repositories.progress.listCompletedQuestIds = vi.fn((profileId: number) =>
      new Promise<number[]>((resolve) => {
        if (profileId === 1) resolveProfileA = resolve;
        else resolveProfileB = resolve;
      }),
    );
    await openQuestsWithoutTable(repositories);
    await waitFor(() => expect(repositories.progress.listCompletedQuestIds).toHaveBeenCalledWith(1));

    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await waitFor(() => expect(repositories.progress.listCompletedQuestIds).toHaveBeenCalledWith(2));
    resolveProfileB?.([]);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    resolveProfileA?.([1]);

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "テスト依頼Aの達成状態" })).not.toBeChecked(),
    );
  });

  it("shows related discoveries delivered by the batch repository API", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "テスト依頼A", { discoveries: [linkedDiscovery(20, "テスト発見物B", 1, "地理", 1)] })],
    );
    await openQuests(repositories);

    expect(screen.getByText("テスト発見物B")).toBeInTheDocument();
  });

  it("uses one master query and one batched progress query instead of N+1 calls", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "クエストA"), quest(2, "クエストB"), quest(3, "クエストC")],
    );
    await openQuests(repositories);

    expect(repositories.quests.listWithDiscoveries).toHaveBeenCalledTimes(1);
    expect(repositories.quests.listDependencies).toHaveBeenCalledTimes(1);
    expect(repositories.progress.listCompletedQuestIds).toHaveBeenCalledTimes(1);
  });

  it("shows only canonical direct predecessor names, leaving a Quest without one blank", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      quest(1, "起点", { offerMethod: "冒険クエスト" }),
      quest(2, "中間", { offerMethod: "冒険クエスト" }),
      quest(3, "終点", { offerMethod: "冒険クエスト" }),
    ], new Map(), [edge(2, 1), edge(3, 2)]);
    repositories.quests.items[2]!.quest.rawRowJson = '{"前提クエスト":"999:raw側のみ"}';
    const user = await openQuests(repositories);
    expect(screen.getByRole("columnheader", { name: "前提クエスト" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "前提クエストで並べ替え" })).not.toBeInTheDocument();
    expect(prerequisiteCell("起点")).toBeEmptyDOMElement();
    expect(prerequisiteCell("中間")).toHaveTextContent("起点");
    expect(prerequisiteCell("終点")).toHaveTextContent("中間");
    expect(prerequisiteCell("終点")).not.toHaveTextContent("起点");
    await user.type(screen.getByLabelText("クエスト名／地図名を検索"), "起点");
    expect(questTitles()).toEqual(["起点"]);
  });

  it("shows every direct predecessor in source order, including inactive maps, without completion styling", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      quest(30, "地図の前提", { offerMethod: "書庫", isActive: false }),
      quest(10, "第一の前提", { offerMethod: "冒険クエスト" }),
      quest(20, "第二の前提", { offerMethod: "冒険クエスト" }),
      quest(40, "対象Quest", { offerMethod: "冒険クエスト" }),
    ], new Map([[1, [30]]]), [edge(40, 20), edge(40, 30), edge(40, 10)]);
    const user = await openQuests(repositories);
    const cell = prerequisiteCell("対象Quest");
    expect(cell).toHaveTextContent("地図の前提、第一の前提、第二の前提");
    expect(cell.querySelector(".quest-prerequisites")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "第一の前提の達成状態" }));
    expect(prerequisiteCell("対象Quest")).toHaveTextContent("地図の前提、第一の前提、第二の前提");
  });

  it("combines direct-name display with prerequisite, Discovery, and skill filters", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      quest(1, "前提A", { offerMethod: "冒険クエスト" }),
      quest(2, "美術の対象", { offerMethod: "冒険クエスト", requiredSkillsNormalized: [{ skillName: "美術", requiredRank: 5 }],
        discoveries: [linkedDiscovery(10, "美術品A", 1, "美術品", 1)] }),
      quest(3, "別分類", { offerMethod: "冒険クエスト", discoveries: [linkedDiscovery(11, "天文A", 2, "天文", 2)] }),
    ], new Map([[1, [1]]]), [edge(2, 1)]);
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "satisfied");
    await user.selectOptions(screen.getByLabelText("発見物"), "category:1");
    await user.selectOptions(screen.getByLabelText("必要スキル"), "美術");
    expect(questTitles()).toEqual(["美術の対象"]);
    expect(prerequisiteCell("美術の対象")).toHaveTextContent("前提A");
  });

  it("filters all four prerequisite states and combines with completion and search", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "前提なしA", { offerMethod: "冒険クエスト" }),
        quest(2, "前提なしB", { offerMethod: "冒険クエスト" }),
        quest(3, "単一充足", { offerMethod: "冒険クエスト" }),
        quest(4, "単一未達成", { offerMethod: "冒険クエスト" }),
        quest(5, "複数要確認", { offerMethod: "冒険クエスト" })],
      new Map([[1, [1, 4]]]),
      [edge(3, 1), edge(4, 2), edge(5, 1), edge(5, 2)],
    );
    const user = await openQuests(repositories);
    const filter = screen.getByLabelText("前提クエスト");
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);

    await user.selectOptions(filter, "satisfied");
    expect(screen.getByText("5件中 3件表示")).toBeInTheDocument();
    expect(screen.getByText("単一充足")).toBeInTheDocument();
    expect(screen.queryByText("単一未達成")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");
    expect(screen.getByText("5件中 2件表示")).toBeInTheDocument();
    expect(questTitles()).not.toContain("前提なしA");
    await user.type(screen.getByLabelText("クエスト名／地図名を検索"), "単一");
    expect(screen.getByText("5件中 1件表示")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("クエスト名／地図名を検索"));

    await user.selectOptions(screen.getByLabelText("達成状態"), "all");
    await user.selectOptions(filter, "unsatisfied");
    expect(screen.getByText("単一未達成")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("達成状態"), "completed");
    expect(screen.getByText("5件中 1件表示")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("達成状態"), "all");
    await user.selectOptions(filter, "unknown");
    expect(screen.getByText("複数要確認")).toBeInTheDocument();
    await user.selectOptions(filter, "none");
    expect(screen.getByText("5件中 2件表示")).toBeInTheDocument();
    await user.selectOptions(filter, "all");
    expect(screen.getByText("5件中 5件表示")).toBeInTheDocument();
  });

  it("filters before pagination and resets to page one when prerequisite filter changes", async () => {
    const quests = Array.from({ length: 52 }, (_, index) => quest(index + 1, `Quest ${index + 1}`, { offerMethod: "冒険クエスト" }));
    const repositories = createRepositories([profile(1, "航海者")], quests, new Map(), [edge(52, 1)]);
    const user = await openQuests(repositories);
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "unsatisfied");
    expect(screen.getByText("1 / 1ページ")).toBeInTheDocument();
    expect(screen.getByText("Quest 52")).toBeInTheDocument();
    expect(screen.getByText("52件中 1件表示")).toBeInTheDocument();
  });

  it("re-evaluates a dependent after prerequisite completion without resetting its filter", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "前提A", { offerMethod: "冒険クエスト" }), quest(2, "後続B", { offerMethod: "冒険クエスト" })],
      new Map(), [edge(2, 1)],
    );
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "satisfied");
    expect(screen.queryByText("後続B")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "前提Aの達成状態" }));
    expect(await screen.findByText("後続B")).toBeInTheDocument();
    expect(screen.getByLabelText("前提クエスト")).toHaveValue("satisfied");
  });

  it("keeps prerequisite status isolated after a profile switch", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者A"), profile(2, "航海者B")],
      [quest(1, "前提A", { offerMethod: "冒険クエスト" }), quest(2, "後続B", { offerMethod: "冒険クエスト" })],
      new Map([[1, [1]], [2, []]]), [edge(2, 1)],
    );
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "satisfied");
    expect(screen.getByText("後続B")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await waitFor(() => expect(repositories.progress.listCompletedQuestIds).toHaveBeenLastCalledWith(2));
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "satisfied");
    expect(screen.queryByText("後続B")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "unsatisfied");
    expect(screen.getByText("後続B")).toBeInTheDocument();
  });

  it("sorts the selected skill numerically in both directions and restores source order", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      rankedQuest(1, "考古学R10", "考古学", 10),
      rankedQuest(2, "考古学R1", "考古学", 1),
      rankedQuest(3, "考古学R17", "考古学", 17, [{ skillName: "探索", requiredRank: 15 }]),
      rankedQuest(4, "考古学R2", "考古学", 2),
      rankedQuest(5, "宗教学R3", "宗教学", 3),
    ]);
    const user = await openQuests(repositories);
    const rank = screen.getByLabelText("要求Rank");
    expect(rank).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("必要スキル"), "考古学");
    expect(rank).toBeEnabled();
    expect(questTitles()).toEqual(["考古学R10", "考古学R1", "考古学R17", "考古学R2"]);

    await user.selectOptions(rank, "asc");
    expect(questTitles()).toEqual(["考古学R1", "考古学R2", "考古学R10", "考古学R17"]);
    await user.selectOptions(rank, "desc");
    expect(questTitles()).toEqual(["考古学R17", "考古学R10", "考古学R2", "考古学R1"]);
    await user.selectOptions(rank, "none");
    expect(questTitles()).toEqual(["考古学R10", "考古学R1", "考古学R17", "考古学R2"]);
  });

  it("keeps NULL last in both directions and disables rank sort for rankless skills", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      rankedQuest(1, "視認NULL", "視認", null),
      rankedQuest(2, "視認R5", "視認", 5),
      rankedQuest(3, "視認R10", "視認", 10),
      rankedQuest(4, "ポルトガル語", "ポルトガル語", null),
      rankedQuest(5, "サルベージ", "サルベージ", null),
    ]);
    const user = await openQuests(repositories);
    const skill = screen.getByLabelText("必要スキル");
    const rank = screen.getByLabelText("要求Rank");
    await user.selectOptions(skill, "視認");
    expect(rank).toBeEnabled();
    await user.selectOptions(rank, "asc");
    expect(questTitles()).toEqual(["視認R5", "視認R10", "視認NULL"]);
    await user.selectOptions(rank, "desc");
    expect(questTitles()).toEqual(["視認R10", "視認R5", "視認NULL"]);
    await user.selectOptions(skill, "ポルトガル語");
    expect(rank).toBeDisabled();
    expect(rank).toHaveValue("none");
    expect(questTitles()).toEqual(["ポルトガル語"]);
    await user.selectOptions(skill, "サルベージ");
    expect(rank).toBeDisabled();
    expect(questTitles()).toEqual(["サルベージ"]);
  });

  it("keeps duplicate same-skill ranks ambiguous and ties in source order", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      rankedQuest(1, "同Rank先", "考古学", 8),
      rankedQuest(2, "重複", "考古学", 5, [{ skillName: "考古学", requiredRank: 17 }]),
      rankedQuest(3, "同Rank後", "考古学", 8),
    ]);
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("必要スキル"), "考古学");
    await user.selectOptions(screen.getByLabelText("要求Rank"), "asc");
    expect(questTitles()).toEqual(["同Rank先", "同Rank後", "重複"]);
    await user.selectOptions(screen.getByLabelText("要求Rank"), "desc");
    expect(questTitles()).toEqual(["同Rank先", "同Rank後", "重複"]);
  });

  it("clears only rank sorting when the skill changes or is cleared", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      rankedQuest(1, "ベータ", "考古学", 1, [{ skillName: "宗教学", requiredRank: 8 }]),
      rankedQuest(2, "アルファ", "考古学", 10, [{ skillName: "宗教学", requiredRank: 2 }]),
    ]);
    const user = await openQuests(repositories);
    const skill = screen.getByLabelText("必要スキル");
    const rank = screen.getByLabelText("要求Rank");
    await user.selectOptions(skill, "考古学");
    await user.selectOptions(rank, "desc");
    expect(questTitles()).toEqual(["アルファ", "ベータ"]);
    await user.selectOptions(skill, "宗教学");
    expect(rank).toHaveValue("none");
    expect(questTitles()).toEqual(["ベータ", "アルファ"]);
    await user.selectOptions(rank, "desc");
    await user.selectOptions(skill, "");
    expect(rank).toBeDisabled();
    expect(rank).toHaveValue("none");
    expect(questTitles()).toEqual(["ベータ", "アルファ"]);

    await user.click(screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" }));
    expect(questTitles()).toEqual(["アルファ", "ベータ"]);
    await user.selectOptions(skill, "考古学");
    expect(rank).toHaveValue("none");
    expect(questTitles()).toEqual(["アルファ", "ベータ"]);
  });

  it("makes rank sort and column sort mutually exclusive without breaking Shift multi-sort", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      rankedQuest(1, "ベータ", "考古学", 1),
      rankedQuest(2, "アルファ", "考古学", 10),
    ]);
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("必要スキル"), "考古学");
    const rank = screen.getByLabelText("要求Rank");
    const titleSort = screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" });
    await user.selectOptions(rank, "desc");
    await user.keyboard("{Shift>}");
    await user.click(titleSort);
    await user.keyboard("{/Shift}");
    expect(rank).toHaveValue("none");
    expect(questTitles()).toEqual(["アルファ", "ベータ"]);
    await user.selectOptions(rank, "asc");
    expect(questTitles()).toEqual(["ベータ", "アルファ"]);
    expect(titleSort.closest("th")).not.toHaveAttribute("aria-sort");

    await user.selectOptions(rank, "none");
    await user.click(titleSort);
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "達成状態で並べ替え" }));
    await user.keyboard("{/Shift}");
    expect(titleSort.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("button", { name: "達成状態で並べ替え" }).closest("th"))
      .toHaveAttribute("aria-sort", "descending");
    expect(rank).toHaveValue("none");
  });

  it("sorts the filtered result before pagination", async () => {
    const quests = Array.from({ length: 52 }, (_, index) =>
      rankedQuest(index + 1, `R${52 - index}`, "考古学", 52 - index));
    const repositories = createRepositories([profile(1, "航海者")], [
      ...quests, rankedQuest(53, "他スキル", "宗教学", 1),
    ]);
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("必要スキル"), "考古学");
    await user.selectOptions(screen.getByLabelText("要求Rank"), "asc");
    expect(screen.getByText("53件中 52件表示")).toBeInTheDocument();
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(questTitles()[0]).toBe("R1");
    expect(questTitles()[49]).toBe("R50");
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(questTitles()).toEqual(["R51", "R52"]);
    await user.click(screen.getByRole("checkbox", { name: "R51の達成状態" }));
    await waitFor(() => expect(repositories.progress.markCompleted).toHaveBeenCalledWith(1, 2));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("要求Rank"), "desc");
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(questTitles()[0]).toBe("R52");
  });

  it("combines rank order with completion and prerequisite filters", async () => {
    const repositories = createRepositories(
      [profile(1, "航海者")],
      [quest(1, "前提A", { offerMethod: "冒険クエスト" }),
        rankedQuest(2, "候補R5", "考古学", 5),
        rankedQuest(3, "候補R17", "考古学", 17),
        rankedQuest(4, "前提未達成R10", "考古学", 10),
        rankedQuest(5, "達成済みR21", "考古学", 21),
        quest(6, "前提B", { offerMethod: "冒険クエスト" })],
      new Map([[1, [1, 5]]]),
      [edge(2, 1), edge(3, 1), edge(4, 6)],
    );
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "satisfied");
    await user.selectOptions(screen.getByLabelText("必要スキル"), "考古学");
    await user.selectOptions(screen.getByLabelText("要求Rank"), "desc");
    await user.selectOptions(screen.getByLabelText("オファー方法"), "method:冒険クエスト");
    await user.selectOptions(screen.getByLabelText("オファー都市"), "セビリア");
    await user.type(screen.getByLabelText("クエスト名／地図名を検索"), "候補");
    expect(questTitles()).toEqual(["候補R17", "候補R5"]);
  });

  it("filters canonical discovery relations independently of Quest raw fields and includes maps", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      quest(1, "地図A", { offerMethod: "港・集落（発見物）", rawRowJson: "{}",
        discoveries: [linkedDiscovery(10, "港A", 1, "港・集落", 1)] }),
      quest(2, "クエストB", { rawRowJson: '{"発見物":"生データのみ"}' }),
    ]);
    const user = await openQuests(repositories);
    const filter = screen.getByLabelText("発見物");
    await user.selectOptions(filter, "has-any");
    expect(questTitles()).toEqual(["地図A"]);
    await user.selectOptions(filter, "has-none");
    expect(questTitles()).toEqual(["クエストB"]);
    await user.selectOptions(filter, "category:1");
    expect(questTitles()).toEqual(["地図A"]);
  });

  it("matches any linked category and keeps master options ordered, unique and independent of other filters", async () => {
    const repositories = createRepositories([profile(1, "航海者")], [
      quest(1, "複数", { discoveries: [linkedDiscovery(10, "地理A", 2, "地理", 20),
        linkedDiscovery(11, "天文A", 1, "天文", 10)] }),
      quest(2, "天文のみ", { discoveries: [linkedDiscovery(12, "天文B", 1, "天文", 10)] }),
      quest(3, "分類なし", { discoveries: [linkedDiscovery(13, "未分類", null, null, null)] }),
    ]);
    const user = await openQuests(repositories);
    const filter = screen.getByLabelText("発見物");
    expect(within(filter).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["すべて", "発見物あり", "発見物なし", "天文", "地理"]);
    await user.selectOptions(filter, "category:2");
    expect(questTitles()).toEqual(["複数"]);
    await user.selectOptions(filter, "category:1");
    expect(questTitles()).toEqual(["複数", "天文のみ"]);
    await user.type(screen.getByLabelText("クエスト名／地図名を検索"), "一致しない");
    expect(screen.getByText("条件に一致するクエストがありません")).toBeInTheDocument();
    expect(filter).toHaveValue("category:1");
    expect(within(filter).getAllByRole("option")).toHaveLength(5);
  });

  it("resets a selected category only when it disappears from master-linked rows", async () => {
    const first = quest(1, "天文Quest", { discoveries: [linkedDiscovery(10, "天文A", 1, "天文", 1)] });
    const second = quest(2, "地理Quest", { discoveries: [linkedDiscovery(11, "地理A", 2, "地理", 2)] });
    const toRow = (item: QuestWithDiscoveries): QuestRowViewModel => ({
      id: item.quest.id, title: item.quest.title, notes: item.quest.notes, difficulty: null, offerMethod: null,
      offerCity: null, offerCities: [], requiredSkills: null, requiredSkillNames: [],
      requiredSkillsNormalized: [], discoveries: item.discoveries, completed: false,
      updating: false, prerequisiteStatus: "NONE", directPrerequisites: [],
    });
    const user = userEvent.setup();
    const { rerender } = render(<QuestTable rows={[toRow(first), toRow(second)]} paginationResetKey={0} onToggleCompletion={vi.fn()} />);
    const filter = screen.getByLabelText("発見物");
    await user.selectOptions(filter, "category:1");
    const renamed = quest(1, "天文Quest", { discoveries: [linkedDiscovery(10, "天文A", 1, "天文・更新名", 1)] });
    rerender(<QuestTable rows={[toRow(renamed), toRow(second)]} paginationResetKey={0} onToggleCompletion={vi.fn()} />);
    expect(filter).toHaveValue("category:1");
    expect(within(filter).getByRole("option", { name: "天文・更新名" })).toBeInTheDocument();
    rerender(<QuestTable rows={[toRow(second)]} paginationResetKey={0} onToggleCompletion={vi.fn()} />);
    await waitFor(() => expect(filter).toHaveValue("all"));
    expect(questTitles()).toEqual(["地理Quest"]);
  });

  it("filters before rank sorting and pagination, and combines completion and prerequisites", async () => {
    const archaeology = linkedDiscovery(10, "歴史遺物A", 1, "歴史遺物", 1);
    const rows = Array.from({ length: 52 }, (_, index) => quest(index + 2, `候補R${52 - index}`, {
      offerMethod: "冒険クエスト", requiredSkillsNormalized: [{ skillName: "考古学", requiredRank: 52 - index }],
      discoveries: [archaeology],
    }));
    const repositories = createRepositories([profile(1, "航海者")], [
      quest(1, "前提A", { offerMethod: "冒険クエスト" }), ...rows,
      quest(54, "別分類", { offerMethod: "冒険クエスト", discoveries: [linkedDiscovery(11, "天文A", 2, "天文", 2)] }),
    ], new Map([[1, [1]]]), [edge(2, 1), ...rows.slice(1).map((row) => edge(row.quest.id, 54))]);
    const user = await openQuests(repositories);
    await user.selectOptions(screen.getByLabelText("発見物"), "category:1");
    await user.selectOptions(screen.getByLabelText("必要スキル"), "考古学");
    await user.selectOptions(screen.getByLabelText("要求Rank"), "desc");
    expect(screen.getByText("54件中 52件表示")).toBeInTheDocument();
    expect(questTitles()[0]).toBe("候補R52");
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(questTitles()).toEqual(["候補R2", "候補R1"]);
    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");
    await user.selectOptions(screen.getByLabelText("前提クエスト"), "satisfied");
    expect(screen.getByText("1 / 1ページ")).toBeInTheDocument();
    expect(questTitles()).toEqual(["候補R52"]);
    expect(screen.getByLabelText("要求Rank")).toHaveValue("desc");
  });
});

function linkedDiscovery(
  id: number, name: string, categoryId: number | null,
  categoryName: string | null, categorySortOrder: number | null,
): QuestDiscoverySummary {
  return { id, name, categoryId, categoryName, categorySortOrder };
}

function rankedQuest(
  id: number,
  title: string,
  skillName: string,
  requiredRank: number | null,
  otherSkills: Array<{ skillName: string; requiredRank: number | null }> = [],
): QuestWithDiscoveries {
  const skills = [{ skillName, requiredRank }, ...otherSkills];
  return quest(id, title, {
    offerMethod: "冒険クエスト",
    requiredSkills: skills.map((skill) => skill.requiredRank === null
      ? skill.skillName : `${skill.skillName}(${skill.requiredRank})`).join(","),
    requiredSkillsNormalized: skills,
  });
}

function questTitles(): string[] {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1)
    .map((row) => row.querySelector(".quest-title")?.textContent ?? "");
}

function prerequisiteCell(title: string): HTMLElement {
  const table = screen.getByRole("table");
  const columnIndex = within(table).getAllByRole("columnheader")
    .findIndex((header) => header.textContent === "前提クエスト");
  const row = within(table).getAllByRole("row")
    .find((item) => item.querySelector(".quest-title")?.textContent === title);
  const cell = row?.querySelectorAll("td")[columnIndex];
  if (!cell) throw new Error(`前提クエストcellが見つかりません: ${title}`);
  return cell;
}

function edge(questId: number, prerequisiteQuestId: number): QuestDependency {
  return { questId, prerequisiteQuestId };
}

interface Repositories {
  profiles: MockProfileRepository;
  quests: MockQuestRepository;
  progress: MockQuestProgressRepository;
  link: MockProgressLinkService;
}

function createRepositories(
  profiles: Profile[],
  quests: QuestWithDiscoveries[],
  completedByProfile: Map<number, number[]> = new Map(),
  dependencies: QuestDependency[] = [],
): Repositories {
  const progress = new MockQuestProgressRepository(completedByProfile);
  const questsWithRelations = dependencies.length === 0 ? quests : quests.map((item) => {
    const name = (id: number) => {
      const related = quests.find(({ quest }) => quest.id === id)?.quest;
      return related ? `${related.gvdbId}:${related.title}` : `${id + 1000}:Unknown`;
    };
    return {
      ...item,
      quest: {
        ...item.quest,
        rawRowJson: JSON.stringify({
          前提クエスト: dependencies.filter((edge) => edge.questId === item.quest.id)
            .map((edge) => name(edge.prerequisiteQuestId)).join(","),
          後続クエスト: dependencies.filter((edge) => edge.prerequisiteQuestId === item.quest.id)
            .map((edge) => name(edge.questId)).join(","),
        }),
      },
    };
  });
  return {
    profiles: new MockProfileRepository(profiles),
    quests: new MockQuestRepository(questsWithRelations, dependencies),
    progress,
    link: new MockProgressLinkService(progress),
  };
}

async function openQuests(repositories: Repositories) {
  const user = await openQuestsWithoutTable(repositories);
  if (repositories.profiles.items.length > 0 && repositories.quests.items.length > 0) {
    expect(await screen.findByRole("table")).toBeInTheDocument();
  }
  return user;
}

async function openQuestsWithoutTable(repositories: Repositories) {
  const user = userEvent.setup();
  render(
    <App
      profileRepository={repositories.profiles}
      questRepository={repositories.quests}
      questProgressRepository={repositories.progress}
      progressLinkService={repositories.link}
    />,
  );
  await screen.findByRole("heading", { name: "プロフィール" });
  await user.click(screen.getByRole("button", { name: "クエスト" }));
  return user;
}

class MockProfileRepository implements ProfileRepositoryPort {
  constructor(readonly items: Profile[]) {}
  list = vi.fn(async () => [...this.items]);
  create = vi.fn(async () => { throw new Error("not used"); });
  update = vi.fn(async (_id: number, _input: UpdateProfileInput) => { throw new Error("not used"); });
  delete = vi.fn(async () => undefined);
}

class MockQuestRepository implements QuestRepositoryPort {
  constructor(readonly items: QuestWithDiscoveries[], readonly dependencies: QuestDependency[]) {}
  listWithDiscoveries = vi.fn(async () => [...this.items]);
  listDependencies = vi.fn(async () => [...this.dependencies]);
}

class MockQuestProgressRepository implements QuestProgressRepositoryPort {
  constructor(private readonly completedByProfile: Map<number, number[]>) {}
  listCompletedQuestIds = vi.fn(async (profileId: number) => [
    ...(this.completedByProfile.get(profileId) ?? []),
  ]);
  markCompleted = vi.fn(async (profileId: number, questId: number) => {
    const ids = new Set(this.completedByProfile.get(profileId) ?? []);
    ids.add(questId);
    this.completedByProfile.set(profileId, [...ids]);
  });
  markIncomplete = vi.fn(async (profileId: number, questId: number) => {
    this.completedByProfile.set(
      profileId,
      (this.completedByProfile.get(profileId) ?? []).filter((id) => id !== questId),
    );
  });
}

class MockProgressLinkService implements ProgressLinkServicePort {
  constructor(private readonly progress: MockQuestProgressRepository) {}
  completeQuestWithLinkedDiscoveries = vi.fn(async (profileId: number, questId: number) => {
    await this.progress.markCompleted(profileId, questId);
    return { questChanged: true, discoveriesCreated: 0, discoveriesAlreadyPresent: 0 };
  });
  discoverWithLinkedQuest = vi.fn(async () => ({
    discoveryCreated: true,
    questCompleted: false,
    questAlreadyCompleted: false,
    selectedQuestId: null,
  }));
}

function profile(id: number, name: string): Profile {
  return {
    id,
    name,
    memo: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function offerTableRow(id: number, offerMethod: string | null): QuestRowViewModel {
  return {
    id,
    title: `Quest ${id}`,
    notes: null,
    difficulty: null,
    offerMethod,
    offerCity: null,
    offerCities: [],
    requiredSkills: null,
    requiredSkillNames: [],
    requiredSkillsNormalized: [],
    discoveries: [],
    completed: false,
    updating: false,
    prerequisiteStatus: "NONE",
    directPrerequisites: [],
  };
}

function quest(
  id: number,
  title: string,
  overrides: {
    notes?: string | null;
    difficulty?: number | null;
    offerMethod?: string | null;
    offerCity?: string | null;
    offerCities?: string[];
    requiredSkills?: string | null;
    requiredSkillNames?: string[];
    requiredSkillsNormalized?: Array<{ skillName: string; requiredRank: number | null }>;
    discoveries?: QuestDiscoverySummary[];
    rawRowJson?: string;
    isActive?: boolean;
  } = {},
): QuestWithDiscoveries {
  const offerCity = overrides.offerCity ?? "セビリア";
  const requiredSkills = overrides.requiredSkills ?? null;
  return {
    quest: {
      id,
      gvdbId: id + 1000,
      title,
      difficulty: overrides.difficulty ?? null,
      chronoQuest: null,
      offerMethod: overrides.offerMethod ?? "冒険者依頼仲介人",
      offerCity,
      requiredSkills,
      discoveryTypeText: null,
      rewardItems: null,
      notes: overrides.notes ?? null,
      chainName: null,
      chainOrder: null,
      sourceUpdatedAt: null,
      isActive: overrides.isActive ?? true,
      rawRowJson: overrides.rawRowJson ?? "{}",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    discoveries: overrides.discoveries ?? [],
    offerCities: (overrides.offerCities ?? offerCity?.split(",") ?? []).map((item, position) => ({
      position,
      cityName: item,
    })),
    requiredSkillsNormalized: (overrides.requiredSkillsNormalized ??
      (overrides.requiredSkillNames ?? requiredSkills?.split(",").map((item) => item.replace(/\([1-9]\d*\)$/, "")) ?? [])
        .map((skillName) => ({ skillName, requiredRank: null })))
      .map(({ skillName, requiredRank }, position) => ({
        position,
        skillName,
        requiredRank,
        isLanguage: skillName.endsWith("語"),
      })),
  };
}
