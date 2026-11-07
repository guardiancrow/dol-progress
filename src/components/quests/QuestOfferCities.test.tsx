// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestTable } from "./QuestTable";
import type { QuestRowViewModel } from "../../quests/types";

afterEach(cleanup);

function map(overrides: Partial<QuestRowViewModel> = {}): QuestRowViewModel {
  return {
    id: 1, title: "合成地図", notes: null, difficulty: null, offerMethod: "地理学",
    offerCity: null, offerCities: [], requiredSkills: null, requiredSkillNames: [],
    requiredSkillsNormalized: [], discoveries: [], completed: false, updating: false,
    prerequisiteStatus: "NONE", directPrerequisites: [], ...overrides,
  };
}

function show(rows: QuestRowViewModel[]) {
  const update = vi.fn();
  render(<QuestTable rows={rows} paginationResetKey={1} onToggleCompletion={update} />);
  return update;
}

describe("map offer cities in the existing information popover", () => {
  it.each([
    ["リスボン", null, "リスボン"],
    ["リスボン,セビリア,ロンドン", null, "リスボン、セビリア、ロンドン"],
    ["　リスボン , セビリア\t, ,リスボン,,ロンドン,", "合成備考", "リスボン、セビリア、ロンドン"],
    ["ロンドン", "合成備考", "ロンドン"],
    [null, "合成備考", null],
    [" ,　,", "合成備考", null],
  ])("shows only available details (%j, %j)", async (offerCity, notes, expected) => {
    const update = show([map({ offerCity, notes })]);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: /合成地図の.*を表示/ });
    await user.click(button);
    const popup = screen.getByRole("dialog", { name: "合成地図" });
    const cityHeading = within(popup).queryByRole("heading", { name: "オファー都市" });
    if (expected) expect(cityHeading?.nextElementSibling).toHaveTextContent(expected);
    else expect(cityHeading).not.toBeInTheDocument();
    if (notes) expect(popup).toHaveTextContent(notes);
    else expect(within(popup).queryByRole("heading", { name: "備考" })).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", popup.id);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([null, "", "　, \t,,"])("omits i when both notes and cities are empty (%j)", (offerCity) => {
    show([map({ offerCity, notes: " \n　" })]);
    expect(screen.queryByRole("button", { name: /合成地図の.*を表示/ })).not.toBeInTheDocument();
  });

  it("opens city-only information using the keyboard and restores focus on close", async () => {
    show([map({ offerCities: ["ロンドン", "セビリア"] })]);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "合成地図のオファー都市を表示" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toHaveTextContent("ロンドン、セビリア");
    expect(screen.getByRole("button", { name: "閉じる" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(button).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps ordinary quest and linked discovery information unchanged", async () => {
    const cityOnlyQuest = map({ id: 2, title: "通常依頼2", offerMethod: "冒険クエスト", offerCity: "ロンドン" });
    const ordinary = map({ id: 3, title: "通常依頼3", offerMethod: "冒険クエスト", offerCity: "ロンドン", notes: "通常備考" });
    const chart = map({ offerCity: "セビリア", discoveries: [{
      id: 1, name: "関連発見物", description: "発見物の説明", notes: "発見物の備考",
      categoryId: null, categoryName: null, categorySortOrder: null,
    }] });
    show([chart, cityOnlyQuest, ordinary]);
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: /通常依頼2の.*を表示/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "通常依頼3の備考を表示" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("通常備考");
    expect(within(screen.getByRole("dialog")).queryByRole("heading", { name: "オファー都市" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成地図のオファー都市を表示" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("セビリア");
    await user.click(screen.getByRole("button", { name: "関連発見物の説明・備考を表示" }));
    const popup = screen.getByRole("dialog", { name: "関連発見物" });
    expect(popup).toHaveTextContent("発見物の説明");
    expect(popup).toHaveTextContent("発見物の備考");
    expect(within(popup).queryByRole("heading", { name: "オファー都市" })).not.toBeInTheDocument();
  });

  it("does not alter city filters or the complete long list of cities", async () => {
    const cities = Array.from({ length: 60 }, (_, i) => `長い合成都市名${i}`);
    const row = map({ offerCity: cities.join(","), offerCities: cities, notes: "備考も保持" });
    const before = structuredClone(row);
    show([row, map({ id: 2, title: "別の合成地図", offerCity: "合成別都市", offerCities: ["合成別都市"] })]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "合成地図のオファー都市・備考を表示" }));
    const popup = screen.getByRole("dialog");
    expect(within(popup).getByRole("heading", { name: "オファー都市" }).nextElementSibling?.textContent).toBe(cities.join("、"));
    expect(popup).toHaveTextContent("備考も保持");
    fireEvent.change(screen.getByLabelText("オファー都市"), { target: { value: "長い合成都市名0" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("合成地図")).toBeInTheDocument();
    expect(screen.queryByText("別の合成地図")).not.toBeInTheDocument();
    expect(row).toEqual(before);
  });
});
