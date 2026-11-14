// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestTable } from "./QuestTable";
import type { QuestRowViewModel } from "../../quests/types";
import { AppShell } from "../layout/AppShell";
import { ProfileProvider } from "../../profiles/ProfileContext";
import { mockWorkspaceMedia } from "../layout/responsiveTestMedia";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.4.0") }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

function chooseCity(value: string) {
  fireEvent.change(screen.getByLabelText("オファー都市"), { target: { value } });
}

describe("offer city display and unset filter", () => {
  it.each([
    [null, [], "—"], ["", [], "—"], ["　\t", ["", "　", "\t"], "—"],
    [" ,　,", ["", " "], "—"], [null, ["ロンドン"], "ロンドン"],
    ["", ["", " リスボン ", "　"], "リスボン"], ["ロンドン", [], "—"],
    ["ロンドン,セビリア", ["ロンドン", "セビリア"], "ロンドン,セビリア"],
    [" ロンドン , セビリア, ", ["ロンドン", "セビリア"], " ロンドン , セビリア, "],
    ["ロンドン", ["セビリア"], "セビリア"],
    [" ,　,", ["ロンドン", "セビリア"], "ロンドン、セビリア"],
  ] satisfies [string | null, string[], string][])("displays normalized availability without mutating the source (%j, %j)", (offerCity, offerCities, expected) => {
    const row = map({ offerMethod: null, offerCity, offerCities });
    const original = structuredClone(row);
    show([row]);
    expect(document.querySelector('td[data-column="offerCity"]')?.textContent).toBe(expected);
    expect(document.querySelector('td[data-column="offerMethod"]')).toHaveTextContent("未設定");
    if (offerCity === "ロンドン" && expected !== "ロンドン") {
      expect(document.querySelector('td[data-column="offerCity"] span')).toHaveAttribute("title", expect.stringContaining("元の表記：ロンドン"));
    }
    chooseCity("unset");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(expected === "—" ? 1 : 0);
    expect(row).toEqual(original);
  });

  it("keeps all, unset, individual and multi-city selections distinct even for sentinel-like city names", () => {
    const rows = [
      map({ id: 1, title: "都市なし" }),
      map({ id: 2, title: "元表記のみ", offerCity: "ロンドン" }),
      map({ id: 3, title: "登録済みのみ", offerCities: ["ロンドン"] }),
      map({ id: 4, title: "複数都市", offerCity: "ロンドン,セビリア", offerCities: ["ロンドン", "", " セビリア "] }),
      ...["unset", "all", "city:ロンドン", "未設定"].map((city, i) => map({ id: i + 5, title: `衝突確認${i}`, offerCity: city, offerCities: [city] })),
    ];
    const update = show(rows);
    const options = within(screen.getByLabelText("オファー都市")).getAllByRole("option");
    expect(new Set(options.map(option => option.getAttribute("value"))).size).toBe(options.length);
    expect(options.filter(option => option.textContent?.trim() === "")).toHaveLength(0);
    chooseCity("unset");
    expect(screen.getByText("都市なし")).toBeInTheDocument();
    expect(screen.getByText("元表記のみ")).toBeInTheDocument();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
    chooseCity("city:ロンドン");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("登録済みのみ")).toBeInTheDocument();
    expect(screen.getByText("複数都市")).toBeInTheDocument();
    chooseCity("city:セビリア");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(screen.getByText("複数都市")).toBeInTheDocument();
    for (const [index, city] of ["unset", "all", "city:ロンドン", "未設定"].entries()) {
      chooseCity(`city:${city}`);
      expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
      expect(screen.getByText(`衝突確認${index}`)).toBeInTheDocument();
    }
    chooseCity("");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(rows.length);
    expect(update).not.toHaveBeenCalled();
  });

  it("combines unset with completion and search, resets paging on changes, and preserves page size", async () => {
    const update = show(Array.from({ length: 101 }, (_, i) => map({ id: i + 1, title: `合成依頼${i + 1}`, completed: i % 2 === 0,
      offerCity: i < 70 ? null : "ロンドン", offerCities: i < 70 ? [] : ["ロンドン"] })));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("2 / 3ページ")).toBeInTheDocument();
    chooseCity("unset");
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(screen.getByText("101件中 70件表示")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("達成状態"), "completed");
    expect(screen.getByText("101件中 35件表示")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "合成依頼1");
    expect(screen.getByText("101件中 6件表示")).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));
    await user.selectOptions(screen.getByLabelText("達成状態"), "all");
    await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
    chooseCity("");
    expect(screen.getByText("101件中 101件表示")).toBeInTheDocument();
    expect(screen.getByLabelText("1ページの件数")).toHaveValue("100");
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves sorting by the source string when the displayed cities differ", async () => {
    const update = show([
      map({ id: 1, title: "表記不一致", offerCity: "ロンドン", offerCities: ["アテネ"] }),
      map({ id: 2, title: "表記一致", offerCity: "セビリア", offerCities: ["セビリア"] }),
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "オファー都市で並べ替え" }));
    expect([...document.querySelectorAll('tbody td[data-column="offerCity"]')].map(cell => cell.textContent)).toEqual(["セビリア", "アテネ"]);
    await user.click(screen.getByRole("button", { name: "オファー都市で並べ替え" }));
    expect([...document.querySelectorAll('tbody td[data-column="offerCity"]')].map(cell => cell.textContent)).toEqual(["アテネ", "セビリア"]);
    expect(update).not.toHaveBeenCalled();
  });

  it("clears an unavailable city on data refresh but retains the unset selection with no matching records", async () => {
    const update = vi.fn();
    const renderTable = (rows: QuestRowViewModel[]) => <QuestTable rows={rows} paginationResetKey={1} onToggleCompletion={update} />;
    const view = render(renderTable([map({ offerCity: "ロンドン", offerCities: ["ロンドン"] })]));
    chooseCity("city:ロンドン");
    view.rerender(renderTable([map({ offerCity: "セビリア", offerCities: ["セビリア"] })]));
    await waitFor(() => expect(screen.getByLabelText("オファー都市")).toHaveValue(""));
    expect(screen.getByText("1件中 1件表示")).toBeInTheDocument();
    chooseCity("unset");
    view.rerender(renderTable([map({ offerCity: "ロンドン", offerCities: ["ロンドン"] })]));
    expect(screen.getByLabelText("オファー都市")).toHaveValue("unset");
    expect(screen.getByText("1件中 0件表示")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves the unset condition and focus through detailed filters and table priority mode", async () => {
    const resize = mockWorkspaceMedia(800, 600);
    const update = vi.fn();
    const repository = { list: async () => [{ id: 1, name: "合成プロフィール", memo: null, createdAt: "synthetic", updatedAt: "synthetic" }], create: vi.fn(), update: vi.fn(), delete: vi.fn() };
    render(<ProfileProvider repository={repository}><AppShell currentPage="quests" onNavigate={() => undefined}>
      <section className="workspace-page"><div className="page-heading"><h2>クエスト</h2></div>
        <QuestTable rows={[map(), map({ id: 2, title: "都市あり", offerCity: "ロンドン", offerCities: ["ロンドン"] })]} paginationResetKey={1} onToggleCompletion={update} />
      </section>
    </AppShell></ProfileProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "詳細フィルターを開く" }));
    const city = screen.getByLabelText("オファー都市");
    await user.selectOptions(city, "unset");
    const table = screen.getByRole("table");
    city.focus();
    fireEvent.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    expect(screen.getByRole("button", { name: "検索・フィルターを表示" })).toHaveFocus();
    expect(screen.getByRole("group", { name: "非表示の検索・フィルター条件" })).toHaveTextContent("絞り込み1件");
    expect(screen.queryByRole("combobox", { name: "オファー都市" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "検索・フィルターを表示" }));
    expect(screen.getByLabelText("オファー都市")).toBe(city);
    expect(city).toHaveValue("unset");
    await user.click(screen.getByRole("button", { name: "詳細フィルターを閉じる" }));
    await user.click(screen.getByRole("button", { name: "詳細フィルターを開く" }));
    act(() => resize(1920, 1080));
    expect(city).toHaveValue("unset");
    expect(screen.getByRole("table")).toBe(table);
    expect(screen.getByText("2件中 1件表示")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  });
});

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
    fireEvent.change(screen.getByLabelText("オファー都市"), { target: { value: "city:長い合成都市名0" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("合成地図")).toBeInTheDocument();
    expect(screen.queryByText("別の合成地図")).not.toBeInTheDocument();
    expect(row).toEqual(before);
  });
});
