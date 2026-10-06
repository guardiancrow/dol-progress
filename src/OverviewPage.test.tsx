// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { Profile } from "./domain/models";
import type { ProgressStats, ProgressStatsRepositoryPort } from "./overview/types";
import type { ProfileRepositoryPort } from "./profiles/ProfileContext";
import type { UpdateProfileInput } from "./repositories/profileRepository";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Overview UI", () => {
  it("asks for a profile when selectedProfileId is null", async () => {
    const repositories = setup([], zeroStats());
    await openOverview(repositories);
    expect(screen.getByRole("heading", { name: "進捗を表示するプロフィールを選択してください" })).toBeInTheDocument();
    expect(repositories.stats.getForProfile).not.toHaveBeenCalled();
  });

  it("shows a loading state while SQLite aggregation is pending", async () => {
    const repositories = setup([profile(1)], zeroStats());
    repositories.stats.getForProfile = vi.fn(() => new Promise(() => undefined));
    await openOverviewWithoutContent(repositories);
    expect(screen.getByRole("status")).toHaveTextContent("進捗を集計しています");
  });

  it("handles a zero Quest master safely", async () => {
    const repositories = setup([profile(1)], zeroStats());
    await openOverview(repositories);
    expect(screen.getByText("達成 0 / 0")).toBeInTheDocument();
    expect(screen.getAllByText("0.0%").length).toBeGreaterThan(0);
  });

  it("handles a zero Discovery master and empty categories safely", async () => {
    const repositories = setup([profile(1)], zeroStats());
    await openOverview(repositories);
    expect(screen.getByText("発見 0 / 0")).toBeInTheDocument();
    expect(card("冒険勲功値（判明分）")).toHaveTextContent("経験値不明 0件");
    expect(screen.getByText("集計対象の発見物分類がありません。")).toBeInTheDocument();
  });

  it("shows zero progress for non-empty masters", async () => {
    const repositories = setup([profile(1)], stats({ questTotal: 8, discoveryTotal: 10 }));
    await openOverview(repositories);
    expect(screen.getByText("達成 0 / 8")).toBeInTheDocument();
    expect(screen.getByText("発見 0 / 10")).toBeInTheDocument();
  });

  it("shows Quest completed, incomplete, and completion rate", async () => {
    const repositories = setup([profile(1)], stats({ questTotal: 8, questCompleted: 2 }));
    await openOverview(repositories);
    expect(screen.getByText("達成 2 / 8")).toBeInTheDocument();
    expect(screen.getByText("未達成 6件")).toBeInTheDocument();
    expect(screen.getByText("25.0%")).toBeInTheDocument();
  });

  it("shows Discovery discovered and undiscovered totals", async () => {
    const repositories = setup([profile(1)], stats({ discoveryTotal: 10, discovered: 6 }));
    await openOverview(repositories);
    expect(screen.getByText("発見 6 / 10")).toBeInTheDocument();
    expect(screen.getByText(/未発見 4件/)).toBeInTheDocument();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
  });

  it("shows unreported count", async () => {
    const repositories = setup([profile(1)], stats({ discoveryTotal: 10, discovered: 6, unreported: 2, reported: 4 }));
    await openOverview(repositories);
    expect(within(card("未報告")).getByText("2件")).toBeInTheDocument();
  });

  it("shows reported count", async () => {
    const repositories = setup([profile(1)], stats({ discoveryTotal: 10, discovered: 6, unreported: 2, reported: 4 }));
    await openOverview(repositories);
    expect(screen.getByText(/報告済み 4件/)).toBeInTheDocument();
  });

  it("shows the known adventure merit summary and reported experience counts", async () => {
    const repositories = setup([profile(1)], stats({ knownMerit: 116359, meritReportedCount: 221, knownExperienceCount: 211, unknownExperienceCount: 10 }));
    await openOverview(repositories);
    const merit = card("冒険勲功値（判明分）");
    expect(within(merit).getByText("116,359")).toBeInTheDocument();
    expect(merit).toHaveTextContent("報告済み発見物 221件");
    expect(merit).toHaveTextContent("経験値判明 211件");
    expect(merit).toHaveTextContent("経験値不明 10件");
    expect(merit).toHaveTextContent("GVDB経験値から算出した参考値");
  });

  it("groups primary and secondary Overview summaries separately", async () => {
    const repositories = setup([profile(1)], stats({ knownMerit: 350 }));
    await openOverview(repositories);

    const primary = screen.getByRole("group", { name: "主要な進捗" });
    const secondary = screen.getByRole("group", { name: "補助的な進捗" });
    expect(within(primary).getByRole("heading", { name: "Quest" })).toBeInTheDocument();
    expect(within(primary).getByRole("heading", { name: "Discovery" })).toBeInTheDocument();
    expect(within(primary).getByRole("heading", { name: "冒険勲功値（判明分）" })).toBeInTheDocument();
    expect(within(secondary).getByRole("heading", { name: "未報告" })).toBeInTheDocument();
    expect(within(secondary).getByRole("heading", { name: "カード所有" })).toBeInTheDocument();
  });

  it("explains that unregistered experience is excluded only when unknown rows exist", async () => {
    const withUnknown = setup([profile(1)], stats({ unknownExperienceCount: 1 }));
    await openOverview(withUnknown);
    expect(card("冒険勲功値（判明分）")).toHaveTextContent("経験値未登録の発見物は合計に含まれていません");

    cleanup();
    const withoutUnknown = setup([profile(1)], stats({ unknownExperienceCount: 0 }));
    await openOverview(withoutUnknown);
    expect(card("冒険勲功値（判明分）")).not.toHaveTextContent("経験値未登録の発見物は合計に含まれていません");
  });

  it("shows card-owned count", async () => {
    const repositories = setup([profile(1)], stats({ discoveryTotal: 10, discovered: 6, cardOwned: 5 }));
    await openOverview(repositories);
    expect(screen.getByText("所有 5 / 6")).toBeInTheDocument();
  });

  it("uses discovered count as the card ownership denominator", async () => {
    const repositories = setup([profile(1)], stats({ discoveryTotal: 100, discovered: 4, cardOwned: 3 }));
    await openOverview(repositories);
    expect(screen.getByText("所有 3 / 4")).toBeInTheDocument();
    expect(screen.getByText("75.0%")).toBeInTheDocument();
  });

  it("uses card-capable discovered count as the card ownership denominator", async () => {
    const repositories = setup([profile(1)], stats({ discoveryTotal: 5, discovered: 4, cardOwned: 2, cardCapableDiscovered: 3 }));
    await openOverview(repositories);
    expect(screen.getByText("所有 2 / 3")).toBeInTheDocument();
  });

  it("renders relic category report and card metrics as not applicable", async () => {
    const relicStats: ProgressStats = {
      ...stats({ discoveryTotal: 2, discovered: 1, cardCapableDiscovered: 0 }),
      categories: [{ categoryId: 20, categoryName: "レリック", sortOrder: 20, total: 2, discovered: 1, undiscovered: 1, unreported: 0, cardOwned: 0, canReport: false, hasCard: false }],
    };
    const repositories = setup([profile(1)], relicStats);
    await openOverview(repositories);
    expect(card("レリック")).toHaveTextContent("報告: 対象外");
    expect(card("レリック")).toHaveTextContent("カード: 対象外");
  });

  it("shows category total and discovered count", async () => {
    const repositories = setup([profile(1)], statsWithCategory());
    await openOverview(repositories);
    const category = card("地理");
    expect(within(category).getByText("3 / 5")).toBeInTheDocument();
    expect(within(category).getByText("60.0%")).toBeInTheDocument();
  });

  it("shows category undiscovered count", async () => {
    const repositories = setup([profile(1)], statsWithCategory());
    await openOverview(repositories);
    expect(card("地理")).toHaveTextContent("未発見 2件");
  });

  it("shows category unreported count", async () => {
    const repositories = setup([profile(1)], statsWithCategory());
    await openOverview(repositories);
    expect(card("地理")).toHaveTextContent("未報告 1件");
  });

  it("shows category card-owned count", async () => {
    const repositories = setup([profile(1)], statsWithCategory());
    await openOverview(repositories);
    expect(card("地理")).toHaveTextContent("カード所有 2件");
  });

  it("renders accessible progress values and percentages", async () => {
    const repositories = setup([profile(1)], stats({ questTotal: 8, questCompleted: 2, discoveryTotal: 10, discovered: 6 }));
    await openOverview(repositories);
    expect(screen.getByRole("progressbar", { name: "Quest: 達成 2 / 8、25.0%" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Discovery: 発見 6 / 10、60.0%" })).toBeInTheDocument();
  });

  it("never renders NaN or Infinity when denominators are zero", async () => {
    const repositories = setup([profile(1)], zeroStats());
    await openOverview(repositories);
    expect(document.body).not.toHaveTextContent("NaN");
    expect(document.body).not.toHaveTextContent("Infinity");
    expect(within(card("カード所有")).getByText("—")).toBeInTheDocument();
  });

  it("keeps profile A and B aggregates independent", async () => {
    const byProfile = new Map([
      [1, stats({ questTotal: 10, questCompleted: 3 })],
      [2, stats({ questTotal: 10, questCompleted: 7 })],
    ]);
    const repositories = setup([profile(1, "A"), profile(2, "B")], zeroStats(), byProfile);
    const user = await openOverview(repositories);
    expect(screen.getByText("達成 3 / 10")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    expect(await screen.findByText("達成 7 / 10")).toBeInTheDocument();
  });

  it("reloads current SQLite aggregation whenever Overview is revisited", async () => {
    const repositories = setup([profile(1)], stats({ questTotal: 10, questCompleted: 1 }));
    const user = await openOverview(repositories);
    repositories.stats.fallback = stats({ questTotal: 10, questCompleted: 2 });
    await user.click(screen.getByRole("button", { name: "プロフィール" }));
    await user.click(screen.getByRole("button", { name: "概要" }));
    expect(await screen.findByText("達成 2 / 10")).toBeInTheDocument();
    expect(repositories.stats.getForProfile).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale async result after rapid profile switching", async () => {
    let resolveA: ((value: ProgressStats) => void) | undefined;
    let resolveB: ((value: ProgressStats) => void) | undefined;
    const repositories = setup([profile(1, "A"), profile(2, "B")], zeroStats());
    repositories.stats.getForProfile = vi.fn((id) => new Promise((resolve) => { if (id === 1) resolveA = resolve; else resolveB = resolve; }));
    const user = await openOverviewWithoutContent(repositories);
    await waitFor(() => expect(repositories.stats.getForProfile).toHaveBeenCalledWith(1));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    resolveB?.(stats({ questTotal: 10, questCompleted: 7 }));
    expect(await screen.findByText("達成 7 / 10")).toBeInTheDocument();
    resolveA?.(stats({ questTotal: 10, questCompleted: 1 }));
    await waitFor(() => expect(screen.queryByText("達成 1 / 10")).not.toBeInTheDocument());
  });

  it("shows a safe repository error with retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repositories = setup([profile(1)], zeroStats());
    repositories.stats.getForProfile = vi.fn().mockRejectedValue(new Error("SELECT failed"));
    await openOverviewWithoutContent(repositories);
    expect(await screen.findByRole("alert")).toHaveTextContent("進捗集計を読み込めませんでした");
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();
  });

  it("uses one repository aggregation call per Overview display", async () => {
    const repositories = setup([profile(1)], statsWithCategory());
    await openOverview(repositories);
    expect(repositories.stats.getForProfile).toHaveBeenCalledTimes(1);
    expect(repositories.stats.getForProfile).toHaveBeenCalledWith(1);
  });
});

interface Repositories { profiles: MockProfiles; stats: MockStats }

function setup(profiles: Profile[], fallback: ProgressStats, byProfile = new Map<number, ProgressStats>()): Repositories {
  return { profiles: new MockProfiles(profiles), stats: new MockStats(fallback, byProfile) };
}

async function openOverview(repositories: Repositories) {
  const user = await openOverviewWithoutContent(repositories);
  if (repositories.profiles.items.length) expect(await screen.findByRole("heading", { name: "概要" })).toBeInTheDocument();
  return user;
}

async function openOverviewWithoutContent(repositories: Repositories) {
  const user = userEvent.setup();
  render(<App profileRepository={repositories.profiles} progressStatsRepository={repositories.stats} />);
  await screen.findByRole("heading", { name: "プロフィール" });
  await user.click(screen.getByRole("button", { name: "概要" }));
  return user;
}

function card(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const element = heading.closest("article");
  if (!element) throw new Error(`Card not found: ${title}`);
  return element;
}

class MockProfiles implements ProfileRepositoryPort {
  constructor(readonly items: Profile[]) {}
  list = vi.fn(async () => [...this.items]);
  create = vi.fn(async () => { throw new Error("unused"); });
  update = vi.fn(async (_id: number, _input: UpdateProfileInput) => { throw new Error("unused"); });
  delete = vi.fn(async () => undefined);
}

class MockStats implements ProgressStatsRepositoryPort {
  constructor(public fallback: ProgressStats, private readonly byProfile: Map<number, ProgressStats>) {}
  getForProfile = vi.fn(async (profileId: number) => this.byProfile.get(profileId) ?? this.fallback);
}

function profile(id: number, name = "航海者"): Profile {
  return { id, name, memo: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function zeroStats(): ProgressStats { return stats({}); }

function stats(values: { questTotal?: number; questCompleted?: number; discoveryTotal?: number; discovered?: number; unreported?: number; reported?: number; cardOwned?: number; cardCapableDiscovered?: number; knownMerit?: number; meritReportedCount?: number; knownExperienceCount?: number; unknownExperienceCount?: number }): ProgressStats {
  const questTotal = values.questTotal ?? 0;
  const questCompleted = values.questCompleted ?? 0;
  const discoveryTotal = values.discoveryTotal ?? 0;
  const discovered = values.discovered ?? 0;
  return {
    quests: { total: questTotal, completed: questCompleted, incomplete: questTotal - questCompleted },
    discoveries: { total: discoveryTotal, discovered, undiscovered: discoveryTotal - discovered, unreported: values.unreported ?? 0, reported: values.reported ?? 0, cardOwned: values.cardOwned ?? 0, cardCapableDiscovered: values.cardCapableDiscovered ?? discovered },
    adventureMerit: { knownMerit: values.knownMerit ?? 0, reportedCount: values.meritReportedCount ?? 0, knownExperienceCount: values.knownExperienceCount ?? 0, unknownExperienceCount: values.unknownExperienceCount ?? 0 },
    categories: [],
  };
}

function statsWithCategory(): ProgressStats {
  return {
    ...stats({ discoveryTotal: 5, discovered: 3, unreported: 1, reported: 2, cardOwned: 2 }),
    categories: [{ categoryId: 1, categoryName: "地理", sortOrder: 1, total: 5, discovered: 3, undiscovered: 2, unreported: 1, cardOwned: 2, canReport: true, hasCard: true }],
  };
}
