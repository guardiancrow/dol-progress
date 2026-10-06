// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  DiscoveryProgress,
  DiscoveryWithRelations,
  Profile,
} from "./domain/models";
import type {
  DiscoveryProgressRepositoryPort,
  DiscoveryRepositoryPort,
} from "./discoveries/types";
import type { ProfileRepositoryPort } from "./profiles/ProfileContext";
import type { UpdateProfileInput } from "./repositories/profileRepository";
import type { ProgressLinkServicePort } from "./progressLink";
import type { ProgressStats, DiscoveryCategoryProgressStats } from "./overview/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Discovery UI", () => {
  it("opens every Overview category by ID, supports keyboard activation, and preserves the selected profile", async () => {
    const categories = [
      { id: 1, name: "史跡", sortOrder: 1 },
      { id: 2, name: "天文", sortOrder: 2 },
      { id: 3, name: "伝承", sortOrder: 3 },
      { id: 20, name: "レリック", sortOrder: 20 },
    ];
    const repositories = setup([profile(1, "A"), profile(2, "B")],
      categories.map((category) => discovery(category.id, `発見物${category.id}`, { category })));
    const user = await openDrilldown(repositories, categoryStats(categories));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    for (const category of categories) {
      const button = await screen.findByRole("button", { name: `${category.name}の発見物一覧を開く` });
      expect(button).toHaveAttribute("type", "button");
      expect(button.tabIndex).toBe(0);
      if (category.id === 1) {
        button.focus();
        await user.keyboard("{Enter}");
      } else {
        await user.click(button);
      }
      expect(await screen.findByLabelText("分類")).toHaveValue(String(category.id));
      expect(bodyRows()).toHaveLength(1);
      expect(bodyRows()[0]).toHaveTextContent(`発見物${category.id}`);
      expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("2");
      expect(repositories.progress.listByProfile).toHaveBeenLastCalledWith(2);
      if (category.id === 20) {
        expect(screen.queryByRole("checkbox", { name: "発見物20の報告状態" })).not.toBeInTheDocument();
        expect(screen.queryByRole("checkbox", { name: "発見物20のカード所有状態" })).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("checkbox", { name: `発見物${category.id}の報告状態` })).toBeInTheDocument();
      }
      await user.click(screen.getByRole("button", { name: "概要" }));
    }
    for (const label of ["主要な進捗", "補助的な進捗"]) {
      expect(within(screen.getByRole("group", { name: label })).queryByRole("button")).not.toBeInTheDocument();
    }
    expect(repositories.progress.markDiscovered).not.toHaveBeenCalled();
  });

  it("clears stale search, status, ownership, sorting and pagination on category drill-down", async () => {
    const category = { id: 1, name: "史跡", sortOrder: 1 };
    const items = Array.from({ length: 52 }, (_, index) => discovery(index + 1, `発見${52 - index}`, { category }));
    const repositories = setup([profile(1)], [
      ...items,
      discovery(53, "未発見の対象", { category }),
      discovery(54, "未報告の対象", { category }),
      discovery(55, "別分類", { category: { id: 2, name: "天文", sortOrder: 2 } }),
    ], new Map([[1, [...items.map((item) => progress(1, item.discovery.id, true, true)), progress(1, 54, false, false)]]]));
    const user = await openDrilldown(repositories, categoryStats([category]));
    await user.click(screen.getByRole("button", { name: "発見物" }));
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("発見物名を検索"), "発見");
    await user.selectOptions(screen.getByLabelText("状態"), "reported");
    await user.selectOptions(screen.getByLabelText("カード所有"), "owned");
    await user.click(screen.getByRole("button", { name: "発見物名で並べ替え" }));
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "概要" }));
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    await screen.findByRole("table");
    expect(screen.getByLabelText("分類")).toHaveValue("1");
    expect(screen.getByLabelText("発見物名を検索")).toHaveValue("");
    expect(screen.getByLabelText("状態")).toHaveValue("all");
    expect(screen.getByLabelText("カード所有")).toHaveValue("all");
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(screen.getByText("55件中 54件表示")).toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent("発見52");
    expect(screen.getByRole("columnheader", { name: /発見物名/ })).not.toHaveAttribute("aria-sort");
  });

  it("consumes drill-down once, allows manual category changes, and does not replay on ordinary navigation", async () => {
    const categories = [{ id: 1, name: "史跡", sortOrder: 1 }, { id: 2, name: "天文", sortOrder: 2 }];
    const repositories = setup([profile(1)], categories.map((category) => discovery(category.id, `発見物${category.id}`, { category })));
    const user = await openDrilldown(repositories, categoryStats(categories));
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("分類"), "2");
    expect(bodyRows()[0]).toHaveTextContent("発見物2");
    await user.click(screen.getByRole("button", { name: "クエスト" }));
    await user.click(screen.getByRole("button", { name: "発見物" }));
    await screen.findByRole("table");
    expect(screen.getByLabelText("分類")).toHaveValue("all");
    expect(bodyRows()).toHaveLength(2);
  });

  it("falls back to all when an Overview category no longer exists in the loaded master", async () => {
    const repositories = setup([profile(1)], [discovery(2, "天体", { category: { id: 2, name: "天文", sortOrder: 2 } })]);
    const user = await openDrilldown(repositories, categoryStats([{ id: 1, name: "史跡", sortOrder: 1 }]));
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    await screen.findByRole("table");
    expect(screen.getByLabelText("分類")).toHaveValue("all");
    expect(screen.getByText("天体")).toBeInTheDocument();
    expect(repositories.master.listWithRelations).toHaveBeenCalledTimes(1);
  });

  it("uses category IDs even when synthetic categories share a display name", async () => {
    const categories = [{ id: 1, name: "同名", sortOrder: 1 }, { id: 2, name: "同名", sortOrder: 2 }];
    const repositories = setup([profile(1)], categories.map((category) => discovery(category.id, `発見物${category.id}`, { category })));
    const user = await openDrilldown(repositories, categoryStats(categories));
    const buttons = await screen.findAllByRole("button", { name: "同名の発見物一覧を開く" });
    await user.click(buttons[1]!);
    await screen.findByRole("table");
    expect(screen.getByLabelText("分類")).toHaveValue("2");
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("発見物2");
  });

  it("asks for a profile before loading progress", async () => {
    const repositories = setup([], [discovery(1, "テスト発見物A")]);
    await open(repositories);
    expect(screen.getByRole("heading", { name: "発見物進捗を表示するプロフィールを選択してください" })).toBeInTheDocument();
    expect(repositories.progress.listByProfile).not.toHaveBeenCalled();
  });

  it("shows all required master and relation fields", async () => {
    const repositories = setup([profile(1)], [discovery(1, "テスト発見物A", { rank: 5, era: "15世紀", points: 80, difficulty: 7, experience: 900, relatedQuests: [{ id: 9, title: "天体観測" }] })]);
    await open(repositories);
    const row = screen.getByText("テスト発見物A").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("地理");
    expect(row).toHaveTextContent("5");
    expect(row).toHaveTextContent("15世紀");
    expect(row).toHaveTextContent("80");
    expect(row).toHaveTextContent("7");
    expect(row).toHaveTextContent("900");
    expect(row).toHaveTextContent("天体観測");
  });

  it("keeps pagination outside the workspace table scroll area", async () => {
    const repositories = setup([profile(1)], [discovery(1, "テスト発見物A")]);
    await open(repositories);

    const table = screen.getByRole("table");
    const scrollArea = table.parentElement as HTMLElement;
    const workspace = scrollArea.closest(".workspace-table") as HTMLElement;
    const page = table.closest(".workspace-page") as HTMLElement;
    const pagination = screen.getByLabelText("発見物一覧ページ操作");

    expect(scrollArea).toHaveClass("quest-table-scroll", "discovery-table-scroll");
    expect(workspace).toContainElement(scrollArea);
    expect(workspace).toContainElement(pagination);
    expect(scrollArea).not.toContainElement(pagination);
    expect(page).toHaveClass("workspace-page");
    expect(page.closest("main")).toHaveClass("main-content--workspace");
  });

  it("searches Japanese names by partial match", async () => {
    const repositories = setup([profile(1)], [discovery(1, "テスト発見物A"), discovery(2, "テスト発見物B")]);
    const user = await open(repositories);
    await user.type(screen.getByLabelText("発見物名を検索"), "発見物B");
    expect(screen.getByText("テスト発見物B")).toBeInTheDocument();
    expect(screen.queryByText("テスト発見物A")).not.toBeInTheDocument();
  });

  it("builds category options in sortOrder and filters them", async () => {
    const repositories = setup([profile(1)], [discovery(1, "遺跡", { category: { id: 2, name: "史跡", sortOrder: 20 } }), discovery(2, "魚", { category: { id: 1, name: "海洋生物", sortOrder: 10 } })]);
    const user = await open(repositories);
    const filter = screen.getByLabelText("分類");
    expect(within(filter).getAllByRole("option").map((item) => item.textContent)).toEqual(["すべて", "海洋生物", "史跡"]);
    await user.selectOptions(filter, "2");
    expect(screen.getByText("遺跡")).toBeInTheDocument();
    expect(screen.queryByText("魚")).not.toBeInTheDocument();
  });

  it.each([
    ["undiscovered", "未発見物"],
    ["unreported", "未報告物"],
    ["reported", "報告済み物"],
  ])("filters status %s", async (value, expected) => {
    const repositories = setup([profile(1)], masterThree(), new Map([[1, [progress(1, 2), progress(1, 3, true)]]]));
    const user = await open(repositories);
    await user.selectOptions(screen.getByLabelText("状態"), value);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByText("3件中 1件表示")).toBeInTheDocument();
  });

  it.each([
    ["owned", "所有物"],
    ["not-owned", "非所有物"],
  ])("filters card state %s without treating undiscovered as not-owned", async (value, expected) => {
    const repositories = setup([profile(1)], [discovery(1, "未発見物"), discovery(2, "所有物"), discovery(3, "非所有物")], new Map([[1, [progress(1, 2), progress(1, 3, false, false)]]]));
    const user = await open(repositories);
    const cardFilter = screen.getByLabelText("カード所有");
    await user.selectOptions(cardFilter, value);
    expect(cardFilter).toHaveValue(value);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText("未発見物")).not.toBeInTheDocument();
  });

  it.each([
    ["発見物名", [discovery(1, "ベータ"), discovery(2, "アルファ")], "アルファ"],
    ["分類", [discovery(1, "後", { category: { id: 1, name: "A", sortOrder: 20 } }), discovery(2, "先", { category: { id: 2, name: "Z", sortOrder: 10 } })], "先"],
    ["ランク", [discovery(1, "大", { rank: 9 }), discovery(2, "小", { rank: 1 })], "小"],
    ["ポイント", [discovery(1, "大", { points: 9 }), discovery(2, "小", { points: 1 })], "小"],
    ["難易度", [discovery(1, "大", { difficulty: 9 }), discovery(2, "小", { difficulty: 1 })], "小"],
    ["経験", [discovery(1, "大", { experience: 9 }), discovery(2, "小", { experience: 1 })], "小"],
  ])("sorts by %s", async (header, data, expectedFirst) => {
    const repositories = setup([profile(1)], data as DiscoveryWithRelations[]);
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: `${header}で並べ替え` }));
    expect(bodyRows()[0]).toHaveTextContent(String(expectedFirst));
  });

  it("returns to repository source order when name sort is cleared", async () => {
    const repositories = setup(
      [profile(1)],
      [discovery(1, "ベータ"), discovery(2, "アルファ"), discovery(3, "ガンマ")],
    );
    const user = await open(repositories);
    const sort = screen.getByRole("button", { name: "発見物名で並べ替え" });

    expect(bodyRows()[0]).toHaveTextContent("ベータ");
    await user.click(sort);
    expect(bodyRows()[0]).toHaveTextContent("アルファ");
    await user.click(sort);
    expect(bodyRows()[0]).toHaveTextContent("ベータ");
    expect(bodyRows()[1]).toHaveTextContent("ガンマ");
    await user.click(sort);
    expect(bodyRows()[0]).toHaveTextContent("ベータ");
    expect(bodyRows()[1]).toHaveTextContent("アルファ");
  });

  it("sorts status with undiscovered first", async () => {
    const repositories = setup([profile(1)], masterThree(), new Map([[1, [progress(1, 2), progress(1, 3, true)]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "発見状態で並べ替え" }));
    expect(bodyRows()[0]).toHaveTextContent("未発見物");
  });

  it("sorts card state consistently with undiscovered last", async () => {
    const repositories = setup([profile(1)], [discovery(1, "未発見"), discovery(2, "所有"), discovery(3, "非所有")], new Map([[1, [progress(1, 2), progress(1, 3, false, false)]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "カード所有で並べ替え" }));
    expect(bodyRows().map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("非所有"), expect.stringContaining("所有"), expect.stringContaining("未発見")]));
    expect(bodyRows()[2]).toHaveTextContent("未発見");
  });

  it("uses 50-row pagination by default", async () => {
    const repositories = setup([profile(1)], Array.from({ length: 51 }, (_, index) => discovery(index + 1, `発見物${index + 1}`)));
    const user = await open(repositories);
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("発見物51")).toBeInTheDocument();
  });

  it("supports a 100-row page size", async () => {
    const repositories = setup([profile(1)], Array.from({ length: 101 }, (_, index) => discovery(index + 1, `発見物${index + 1}`)));
    const user = await open(repositories);
    await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(screen.getByText("発見物100")).toBeInTheDocument();
  });

  it("keeps page two during discovery, report, and card updates", async () => {
    const repositories = setup(
      [profile(1)],
      Array.from({ length: 52 }, (_, index) => discovery(index + 1, `発見物${index + 1}`)),
    );
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "次ページ" }));

    await user.click(screen.getByRole("checkbox", { name: "発見物51の発見状態" }));
    await waitFor(() => expect(repositories.progress.markDiscovered).toHaveBeenCalledWith(1, 51));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "発見物51の報告状態" }));
    await waitFor(() => expect(repositories.progress.setReported).toHaveBeenCalledWith(1, 51, true));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "発見物51のカード所有状態" }));
    await waitFor(() => expect(repositories.progress.setCardOwned).toHaveBeenCalledWith(1, 51, false));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
  });

  it("marks discovered with unreported and card-owned defaults", async () => {
    const repositories = setup([profile(1)], [discovery(1, "新発見")]);
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "新発見の発見状態" }));
    await waitFor(() => expect(repositories.progress.markDiscovered).toHaveBeenCalledWith(1, 1));
    expect(screen.getByRole("checkbox", { name: "新発見の報告状態" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "新発見のカード所有状態" })).toBeChecked();
    expect(screen.queryByText("発見物を発見済みにしました。")).not.toBeInTheDocument();
  });

  it("renders relic report and card values as not applicable before and after discovery", async () => {
    const repositories = setup([profile(1)], [discovery(1, "レリック", { category: { id: 20, name: "レリック", sortOrder: 20 } })]);
    const user = await open(repositories);

    expect(screen.getAllByText("対象外")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: "レリックの報告状態" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "レリックのカード所有状態" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "レリックの発見状態" }));
    expect(screen.getByRole("checkbox", { name: "レリックの発見状態" })).toBeChecked();
    expect(screen.getAllByText("対象外")).toHaveLength(2);
  });

  it("treats legacy relic report and card values as not applicable", async () => {
    const repositories = setup(
      [profile(1)],
      [discovery(1, "既存レリック", { category: { id: 20, name: "レリック", sortOrder: 20 } })],
      new Map([[1, [progress(1, 1, true, true)]]]),
    );
    await open(repositories);
    expect(screen.getAllByText("対象外")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: "既存レリックの報告状態" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "既存レリックのカード所有状態" })).not.toBeInTheDocument();
  });

  it("excludes discovered relics from report and card filters", async () => {
    const relic = discovery(1, "レリック発見物", { category: { id: 20, name: "レリック", sortOrder: 20 } });
    const normalUnreported = discovery(2, "通常未報告");
    const normalReported = discovery(3, "通常報告済み");
    const normalOwned = discovery(4, "通常カード所有");
    const normalNotOwned = discovery(5, "通常カード非所有");
    const repositories = setup(
      [profile(1)],
      [relic, normalUnreported, normalReported, normalOwned, normalNotOwned],
      new Map([[1, [progress(1, 1, true, true), progress(1, 2), progress(1, 3, true), progress(1, 4), progress(1, 5, false, false)]]]),
    );
    const user = await open(repositories);

    await user.selectOptions(screen.getByLabelText("状態"), "unreported");
    expect(screen.getByText("通常未報告")).toBeInTheDocument();
    expect(screen.queryByText("レリック発見物")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("状態"), "reported");
    expect(screen.getByText("通常報告済み")).toBeInTheDocument();
    expect(screen.queryByText("レリック発見物")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("状態"), "all");
    await user.selectOptions(screen.getByLabelText("カード所有"), "owned");
    expect(screen.getByText("通常カード所有")).toBeInTheDocument();
    expect(screen.queryByText("レリック発見物")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("カード所有"), "not-owned");
    expect(screen.getByText("通常カード非所有")).toBeInTheDocument();
    expect(screen.queryByText("レリック発見物")).not.toBeInTheDocument();
  });

  it("keeps an undiscovered relic in the undiscovered filter", async () => {
    const repositories = setup([profile(1)], [discovery(1, "未発見レリック", { category: { id: 20, name: "レリック", sortOrder: 20 } })]);
    const user = await open(repositories);
    await user.selectOptions(screen.getByLabelText("状態"), "undiscovered");
    expect(screen.getByText("未発見レリック")).toBeInTheDocument();
  });

  it("asks before writing when a discovery has multiple active related quests", async () => {
    const repositories = setup([profile(1)], [discovery(1, "聖母のステンドグラス", {
      relatedQuests: [{ id: 10, title: "クエストA" }, { id: 20, title: "クエストB" }],
    })]);
    const user = await open(repositories);

    await user.click(screen.getByRole("checkbox", { name: "聖母のステンドグラスの発見状態" }));

    expect(screen.getByRole("dialog", { name: "関連クエストを選択" })).toBeInTheDocument();
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "クエストB" }));
    await user.click(screen.getByRole("button", { name: "発見済みにする" }));
    await waitFor(() => expect(repositories.link.discoverWithLinkedQuest).toHaveBeenCalledWith(1, 1, 20));
    expect(screen.getByRole("checkbox", { name: "聖母のステンドグラスの発見状態" })).toBeChecked();
  });

  it("allows multiple-relation discovery without changing quest progress", async () => {
    const repositories = setup([profile(1)], [discovery(1, "複数関連", {
      relatedQuests: [{ id: 10, title: "クエストA" }, { id: 20, title: "クエストB" }],
    })]);
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "複数関連の発見状態" }));
    await user.click(screen.getByRole("radio", { name: "クエスト進捗は変更しない" }));
    await user.click(screen.getByRole("button", { name: "発見済みにする" }));
    await waitFor(() => expect(repositories.link.discoverWithLinkedQuest).toHaveBeenCalledWith(1, 1, null));
  });

  it("cancels a multiple-relation dialog without writing", async () => {
    const repositories = setup([profile(1)], [discovery(1, "複数関連", {
      relatedQuests: [{ id: 10, title: "クエストA" }, { id: 20, title: "クエストB" }],
    })]);
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "複数関連の発見状態" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
  });

  it("closes an outstanding quest selection when the profile changes", async () => {
    const repositories = setup([profile(1, "A"), profile(2, "B")], [discovery(1, "複数関連", {
      relatedQuests: [{ id: 10, title: "クエストA" }, { id: 20, title: "クエストB" }],
    })]);
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "複数関連の発見状態" }));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
  });

  it("shows feedback when a related quest was auto-completed", async () => {
    const repositories = setup([profile(1)], [discovery(1, "単一関連", {
      relatedQuests: [{ id: 10, title: "クエストA" }],
    })]);
    repositories.link.discoverWithLinkedQuest.mockResolvedValue({
      discoveryCreated: true,
      questCompleted: true,
      questAlreadyCompleted: false,
      selectedQuestId: 10,
    });
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "単一関連の発見状態" }));
    const feedback = await screen.findByRole("status");
    expect(feedback).toHaveTextContent("関連クエストを達成済み");
    expect(feedback).toHaveClass("progress-feedback");
  });

  it.each([[true], [false]])("updates reported=%s independently", async (initial) => {
    const repositories = setup([profile(1)], [discovery(1, "発見")], new Map([[1, [progress(1, 1, initial)]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "発見の報告状態" }));
    await waitFor(() => expect(repositories.progress.setReported).toHaveBeenCalledWith(1, 1, !initial));
    expect(screen.getByRole("checkbox", { name: "発見のカード所有状態" })).toBeChecked();
  });

  it.each([[true], [false]])("updates cardOwned=%s independently", async (initial) => {
    const repositories = setup([profile(1)], [discovery(1, "発見")], new Map([[1, [progress(1, 1, true, initial)]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "発見のカード所有状態" }));
    await waitFor(() => expect(repositories.progress.setCardOwned).toHaveBeenCalledWith(1, 1, !initial));
    expect(screen.getByRole("checkbox", { name: "発見の報告状態" })).toBeChecked();
  });

  it("returns to undiscovered through row deletion after warning", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const repositories = setup([profile(1)], [discovery(1, "既発見")], new Map([[1, [progress(1, 1, true, false, "重要メモ")]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "既発見の発見状態" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("メモも削除"));
    await waitFor(() => expect(repositories.progress.markUndiscovered).toHaveBeenCalledWith(1, 1));
    expect(screen.getByRole("checkbox", { name: "既発見の報告状態" })).toBeDisabled();
  });

  it("does not offer report or card actions while undiscovered", async () => {
    const repositories = setup([profile(1)], [discovery(1, "未発見")]);
    await open(repositories);
    expect(screen.getByRole("checkbox", { name: "未発見の報告状態" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "未発見のカード所有状態" })).toBeDisabled();
  });

  it("prevents a duplicate row update while persistence is pending", async () => {
    let resolveWrite: (() => void) | undefined;
    const repositories = setup([profile(1)], [discovery(1, "発見")]);
    repositories.progress.markDiscovered = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const user = await open(repositories);
    const checkbox = screen.getByRole("checkbox", { name: "発見の発見状態" });
    await user.click(checkbox);
    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
    expect(repositories.progress.markDiscovered).toHaveBeenCalledTimes(1);
    resolveWrite?.();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "発見の発見状態" })).toBeChecked());
  });

  it("keeps the previous state and displays an error when persistence fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repositories = setup([profile(1)], [discovery(1, "発見")]);
    repositories.progress.markDiscovered = vi.fn().mockRejectedValue(new Error("DB"));
    const user = await open(repositories);
    const checkbox = screen.getByRole("checkbox", { name: "発見の発見状態" });
    await user.click(checkbox);
    expect(await screen.findByRole("alert")).toHaveTextContent("発見物進捗を更新できませんでした");
    expect(checkbox).not.toBeChecked();
  });

  it("loads profile progress independently on profile switch", async () => {
    const repositories = setup([profile(1, "A"), profile(2, "B")], [discovery(1, "発見")], new Map([[1, [progress(1, 1)]], [2, []]]));
    const user = await open(repositories);
    expect(screen.getByRole("checkbox", { name: "発見の発見状態" })).toBeChecked();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "発見の発見状態" })).not.toBeChecked());
    expect(repositories.progress.listByProfile).toHaveBeenLastCalledWith(2);
  });

  it("ignores stale progress from a rapidly replaced profile request", async () => {
    let resolveA: ((items: DiscoveryProgress[]) => void) | undefined;
    let resolveB: ((items: DiscoveryProgress[]) => void) | undefined;
    const repositories = setup([profile(1, "A"), profile(2, "B")], [discovery(1, "発見")]);
    repositories.progress.listByProfile = vi.fn((id) => new Promise((resolve) => { if (id === 1) resolveA = resolve; else resolveB = resolve; }));
    const user = await openWithoutTable(repositories);
    await waitFor(() => expect(repositories.progress.listByProfile).toHaveBeenCalledWith(1));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await waitFor(() => expect(repositories.progress.listByProfile).toHaveBeenCalledWith(2));
    resolveB?.([]);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    resolveA?.([progress(1, 1)]);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "発見の発見状態" })).not.toBeChecked());
  });

  it("shows the master-empty state separately", async () => {
    const repositories = setup([profile(1)], []);
    await open(repositories);
    expect(await screen.findByText("発見物のマスターデータがありません")).toBeInTheDocument();
  });

  it("shows a filtered-empty state separately", async () => {
    const repositories = setup([profile(1)], [discovery(1, "発見")]);
    const user = await open(repositories);
    await user.type(screen.getByLabelText("発見物名を検索"), "不存在");
    expect(screen.getByText("条件に一致する発見物がありません")).toBeInTheDocument();
  });

  it("uses one batch master query and one batch progress query", async () => {
    const repositories = setup([profile(1)], [discovery(1, "A"), discovery(2, "B")]);
    await open(repositories);
    expect(repositories.master.listWithRelations).toHaveBeenCalledTimes(1);
    expect(repositories.progress.listByProfile).toHaveBeenCalledTimes(1);
  });
});

interface Repositories { profiles: MockProfiles; master: MockMaster; progress: MockProgress; link: MockProgressLink }

function categoryStats(categories: Array<{ id: number; name: string; sortOrder: number }>): ProgressStats {
  return {
    quests: { total: 0, completed: 0, incomplete: 0 },
    discoveries: { total: categories.length, discovered: 0, undiscovered: categories.length, unreported: 0, reported: 0, cardOwned: 0, cardCapableDiscovered: 0 },
    adventureMerit: { knownMerit: 0, reportedCount: 0, knownExperienceCount: 0, unknownExperienceCount: 0 },
    categories: categories.map((category): DiscoveryCategoryProgressStats => ({
      categoryId: category.id, categoryName: category.name, sortOrder: category.sortOrder,
      total: 1, discovered: 0, undiscovered: 1, unreported: 0, cardOwned: 0,
      canReport: category.name !== "レリック", hasCard: category.name !== "レリック",
    })),
  };
}

async function openDrilldown(repositories: Repositories, stats: ProgressStats) {
  const user = userEvent.setup();
  render(<App
    profileRepository={repositories.profiles}
    discoveryRepository={repositories.master}
    discoveryProgressRepository={repositories.progress}
    progressLinkService={repositories.link}
    progressStatsRepository={{ getForProfile: vi.fn(async () => stats) }}
    questRepository={{ listWithDiscoveries: vi.fn(async () => []), listDependencies: vi.fn(async () => []) }}
    questProgressRepository={{ listCompletedQuestIds: vi.fn(async () => []), markCompleted: vi.fn(async () => undefined), markIncomplete: vi.fn(async () => undefined) }}
  />);
  await screen.findByRole("heading", { name: "プロフィール" });
  await user.click(screen.getByRole("button", { name: "概要" }));
  await screen.findByRole("list");
  return user;
}

function setup(profiles: Profile[], master: DiscoveryWithRelations[], byProfile = new Map<number, DiscoveryProgress[]>()) {
  const progress = new MockProgress(byProfile);
  return { profiles: new MockProfiles(profiles), master: new MockMaster(master), progress, link: new MockProgressLink(progress) };
}

async function open(repositories: Repositories) {
  const user = await openWithoutTable(repositories);
  if (repositories.profiles.items.length && repositories.master.items.length) expect(await screen.findByRole("table")).toBeInTheDocument();
  return user;
}

async function openWithoutTable(repositories: Repositories) {
  const user = userEvent.setup();
  render(<App profileRepository={repositories.profiles} discoveryRepository={repositories.master} discoveryProgressRepository={repositories.progress} progressLinkService={repositories.link} />);
  await screen.findByRole("heading", { name: "プロフィール" });
  await user.click(screen.getByRole("button", { name: "発見物" }));
  return user;
}

function bodyRows(): HTMLElement[] { return within(screen.getByRole("table")).getAllByRole("row").slice(1); }

class MockProfiles implements ProfileRepositoryPort {
  constructor(readonly items: Profile[]) {}
  list = vi.fn(async () => [...this.items]);
  create = vi.fn(async () => { throw new Error("unused"); });
  update = vi.fn(async (_id: number, _input: UpdateProfileInput) => { throw new Error("unused"); });
  delete = vi.fn(async () => undefined);
}

class MockMaster implements DiscoveryRepositoryPort {
  constructor(readonly items: DiscoveryWithRelations[]) {}
  listWithRelations = vi.fn(async () => [...this.items]);
}

class MockProgress implements DiscoveryProgressRepositoryPort {
  constructor(private readonly values: Map<number, DiscoveryProgress[]>) {}
  listByProfile = vi.fn(async (profileId: number) => [...(this.values.get(profileId) ?? [])]);
  markDiscovered = vi.fn(async (profileId: number, discoveryId: number) => { this.set(profileId, progress(profileId, discoveryId)); });
  markUndiscovered = vi.fn(async (profileId: number, discoveryId: number) => { this.values.set(profileId, (this.values.get(profileId) ?? []).filter((item) => item.discoveryId !== discoveryId)); });
  setReported = vi.fn(async (profileId: number, discoveryId: number, reported: boolean) => { this.change(profileId, discoveryId, (item) => ({ ...item, reported })); });
  setCardOwned = vi.fn(async (profileId: number, discoveryId: number, cardOwned: boolean) => { this.change(profileId, discoveryId, (item) => ({ ...item, cardOwned })); });
  private set(profileId: number, item: DiscoveryProgress) { this.values.set(profileId, [...(this.values.get(profileId) ?? []).filter((value) => value.discoveryId !== item.discoveryId), item]); }
  private change(profileId: number, discoveryId: number, change: (item: DiscoveryProgress) => DiscoveryProgress) { const item = (this.values.get(profileId) ?? []).find((value) => value.discoveryId === discoveryId); if (item) this.set(profileId, change(item)); }
}

class MockProgressLink implements ProgressLinkServicePort {
  constructor(private readonly progress: MockProgress) {}
  completeQuestWithLinkedDiscoveries = vi.fn(async () => ({
    questChanged: true,
    discoveriesCreated: 0,
    discoveriesAlreadyPresent: 0,
  }));
  discoverWithLinkedQuest = vi.fn(async (profileId: number, discoveryId: number, selectedQuestId: number | null) => {
    await this.progress.markDiscovered(profileId, discoveryId);
    return {
      discoveryCreated: true,
      questCompleted: selectedQuestId !== null,
      questAlreadyCompleted: false,
      selectedQuestId,
    };
  });
}

function profile(id: number, name = "航海者"): Profile { return { id, name, memo: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }; }

function progress(profileId: number, discoveryId: number, reported = false, cardOwned = true, memo: string | null = null): DiscoveryProgress { return { profileId, discoveryId, reported, cardOwned, memo, updatedAt: "2026-01-01T00:00:00.000Z" }; }

function masterThree() { return [discovery(1, "未発見物"), discovery(2, "未報告物"), discovery(3, "報告済み物")]; }

function discovery(id: number, name: string, overrides: { category?: { id: number; name: string; sortOrder: number } | null; rank?: number | null; era?: string | null; points?: number | null; difficulty?: number | null; experience?: number | null; relatedQuests?: Array<{ id: number; title: string }> } = {}): DiscoveryWithRelations {
  return {
    discovery: { id, gvdbId: id + 1000, categoryId: overrides.category === null ? null : (overrides.category?.id ?? 1), name, rank: overrides.rank ?? null, description: null, era: overrides.era ?? null, points: overrides.points ?? null, difficulty: overrides.difficulty ?? null, experience: overrides.experience ?? null, notes: null, sourceUpdatedAt: null, isActive: true, rawRowJson: "{}", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    category: overrides.category === null ? null : (overrides.category ?? { id: 1, name: "地理", sortOrder: 10 }),
    relatedQuests: overrides.relatedQuests ?? [],
  };
}
