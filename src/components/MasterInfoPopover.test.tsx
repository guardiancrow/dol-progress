// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuestTable } from "./quests/QuestTable";
import { DiscoveryTable } from "./discoveries/DiscoveryTable";
import { MasterInfoButton, MasterInfoProvider } from "./MasterInfoPopover";
import type { QuestRowViewModel } from "../quests/types";
import type { DiscoveryRowViewModel } from "../discoveries/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function quest(id: number, notes: string | null): QuestRowViewModel {
  return {
    id, title: `合成依頼${id}`, notes, difficulty: null, offerMethod: null,
    offerCity: null, offerCities: [], requiredSkills: null, requiredSkillNames: [],
    requiredSkillsNormalized: [], discoveries: [], completed: false, updating: false,
    prerequisiteStatus: "NONE", directPrerequisites: [],
  };
}

function discovery(id: number, description: string | null, notes: string | null): DiscoveryRowViewModel {
  return {
    automaticReporting: false, effectiveReported: false,
    id, name: `合成発見物${id}`, description, notes, category: null, rank: null,
    era: null, points: null, difficulty: null, experience: null, relatedQuests: [],
    canReport: true, hasCard: true, status: "undiscovered", progress: null, updating: false,
  };
}

function discoveryTable(rows: DiscoveryRowViewModel[], resetKey = 1) {
  return <DiscoveryTable rows={rows} paginationResetKey={resetKey}
    onToggleDiscovered={vi.fn()} onSetReported={vi.fn()} onSetCardOwned={vi.fn()} />;
}

describe("Master information in tables", () => {
  it("shows each linked discovery independently from quest notes, including matching and shared IDs", async () => {
    const first = quest(1, "クエスト固有の備考");
    const second = quest(2, null);
    const shared = {
      id: 1, name: "共有発見物", description: "発見物の説明\n次の行", notes: "発見物の備考",
      categoryId: null, categoryName: null, categorySortOrder: null,
    };
    first.discoveries = [shared, { ...shared, id: 2, name: "別の発見物", description: null, notes: "別の備考" }];
    second.discoveries = [shared];
    const update = vi.fn();
    render(<QuestTable rows={[first, second]} paginationResetKey={1} onToggleCompletion={update} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "合成依頼1の備考を表示" }));
    expect(screen.getByRole("dialog", { name: "合成依頼1" })).toHaveTextContent("クエスト固有の備考");
    const sharedButtons = screen.getAllByRole("button", { name: "共有発見物の説明・備考を表示" });
    await user.click(sharedButtons[0]!);
    let popup = screen.getByRole("dialog", { name: "共有発見物" });
    expect(within(popup).getByRole("heading", { name: "説明" }).nextElementSibling?.textContent).toBe(shared.description);
    expect(popup).toHaveTextContent("発見物の備考");
    expect(popup).not.toHaveTextContent("クエスト固有の備考");
    await user.click(sharedButtons[1]!);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(sharedButtons[0]).toHaveAttribute("aria-expanded", "false");
    expect(sharedButtons[1]).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(sharedButtons[1]).toHaveFocus();
    const other = screen.getByRole("button", { name: "別の発見物の説明・備考を表示" });
    other.focus();
    await user.keyboard(" ");
    popup = screen.getByRole("dialog", { name: "別の発見物" });
    expect(popup).toHaveTextContent("別の備考");
    expect(within(popup).queryByRole("heading", { name: "説明" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(other).toHaveFocus();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([[null, null], ["", ""], [" \n　", "\t "]])("omits empty linked discovery details (%j / %j)", (description, notes) => {
    const row = quest(1, "クエスト備考");
    row.discoveries = [{ id: 1, name: "空の発見物", description, notes, categoryId: null, categoryName: null, categorySortOrder: null }];
    render(<QuestTable rows={[row]} paginationResetKey={1} onToggleCompletion={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "空の発見物の説明・備考を表示" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合成依頼1の備考を表示" })).toBeInTheDocument();
  });
  it("keeps discovery and each related quest separate even with matching IDs, and reuses focus and close behavior", async () => {
    const row = discovery(1, "発見物の説明", "発見物の備考");
    row.relatedQuests = [
      { id: 1, title: "関連依頼A", notes: "依頼Aの備考\n次の行", offerCity: null },
      { id: 2, title: "関連依頼B", notes: "依頼Bの備考", offerCity: null },
      { id: 3, title: "備考なし", notes: null, offerCity: null },
      { id: 4, title: "空白のみ", notes: " \n　", offerCity: null },
    ];
    render(discoveryTable([row]));
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "備考なしの備考を表示" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "空白のみの備考を表示" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成発見物1の説明・備考を表示" }));
    expect(screen.getByRole("dialog", { name: "合成発見物1" })).toHaveTextContent("発見物の説明");
    const first = screen.getByRole("button", { name: "関連依頼Aの備考を表示" });
    await user.click(first);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "関連依頼A" }).querySelector("p")?.textContent).toBe("依頼Aの備考\n次の行");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("発見物の備考");
    await user.keyboard("{Escape}");
    expect(first).toHaveFocus();
    const second = screen.getByRole("button", { name: "関連依頼Bの備考を表示" });
    second.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "関連依頼B" })).toHaveTextContent("依頼Bの備考");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(second).toHaveFocus();
    await user.click(second);
    fireEvent.change(screen.getByLabelText("発見物名を検索"), { target: { value: "不存在" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each([
    ["リスボン", null, "リスボン"],
    ["リスボン,セビリア,ロンドン", null, "リスボン、セビリア、ロンドン"],
    ["　リスボン , セビリア\t, ,リスボン,,ロンドン,", "依頼の備考\n次の行", "リスボン、セビリア、ロンドン"],
    [null, "依頼の備考\n次の行", null],
    ["", "依頼の備考\n次の行", null],
    [" \n　\t", "依頼の備考\n次の行", null],
  ])("shows related quest cities and notes independently (%j / %j)", async (offerCity, notes, expectedCities) => {
    const row = discovery(1, null, null);
    row.relatedQuests = [{ id: 1, title: "関連依頼", notes, offerCity }];
    render(discoveryTable([row]));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /関連依頼の.*を表示/ }));
    const popup = screen.getByRole("dialog", { name: "関連依頼" });
    const cities = within(popup).queryByRole("heading", { name: "オファー都市" });
    if (expectedCities) expect(cities?.nextElementSibling?.textContent).toBe(expectedCities);
    else expect(cities).not.toBeInTheDocument();
    const remarks = within(popup).queryByRole("heading", { name: "備考" });
    if (notes) expect(remarks?.nextElementSibling?.textContent).toBe(notes);
    else expect(remarks).not.toBeInTheDocument();
    expect(row.relatedQuests[0]?.offerCity).toBe(offerCity);
  });

  it.each([null, "", " \n\t　", " ,　,,"])("omits related quest i when both cities and notes are empty (%j)", (offerCity) => {
    const row = discovery(1, null, null);
    row.relatedQuests = [{ id: 1, title: "空の関連依頼", notes: " \n　", offerCity }];
    render(discoveryTable([row]));
    expect(screen.queryByRole("button", { name: /空の関連依頼の.*を表示/ })).not.toBeInTheDocument();
  });

  it("opens city-only related quest information with Enter and Space and restores focus", async () => {
    const row = discovery(1, null, null);
    row.relatedQuests = [{ id: 1, title: "都市だけの依頼", notes: "　", offerCity: "ロンドン,セビリア" }];
    render(discoveryTable([row]));
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "都市だけの依頼のオファー都市を表示" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toHaveTextContent("ロンドン、セビリア");
    expect(screen.getByRole("button", { name: "閉じる" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(button).toHaveFocus();
  });

  it("only shows quest triggers for nonblank notes and preserves the complete multiline text", async () => {
    const text = `  合成の日本語長文\n${"攻略ABC123".repeat(500)}\nhttps://example.invalid/${"x".repeat(500)}  `;
    const onUpdate = vi.fn();
    render(<QuestTable rows={[quest(1, null), quest(2, ""), quest(3, " \n\t　"), quest(4, text)]}
      paginationResetKey={1} onToggleCompletion={onUpdate} />);
    expect(screen.getAllByRole("button", { name: /の備考を表示/ })).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "合成依頼4の備考を表示" }));
    const popup = screen.getByRole("dialog", { name: "合成依頼4" });
    expect(within(popup).getByRole("heading", { name: "備考" })).toBeInTheDocument();
    expect(popup.querySelector("p")?.textContent).toBe(text);
    expect(popup.parentElement).toBe(document.body);
    expect(screen.getByRole("table").parentElement).not.toContainElement(popup);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["両方", "合成説明", "合成備考"],
    ["説明のみ", "合成説明", null],
    ["備考のみ", " \n　", "合成備考"],
  ])("shows separate nonblank discovery sections: %s", async (_case, description, notes) => {
    render(discoveryTable([discovery(1, description, notes)]));
    await userEvent.setup().click(screen.getByRole("button", { name: "合成発見物1の説明・備考を表示" }));
    const popup = screen.getByRole("dialog", { name: "合成発見物1" });
    for (const [label, text] of [["説明", description], ["備考", notes]]) {
      const heading = within(popup).queryByRole("heading", { name: label ?? "" });
      if (text?.trim()) {
        expect(heading?.nextElementSibling?.textContent).toBe(text);
      } else {
        expect(heading).not.toBeInTheDocument();
      }
    }
  });

  it.each([
    [null, null], ["", ""], [" \n\t　", "　\r\n "], [null, " "], ["", null],
  ])("omits discovery triggers for empty fields (%j / %j)", (description, notes) => {
    render(discoveryTable([discovery(1, description, notes)]));
    expect(screen.queryByRole("button", { name: /説明・備考を表示/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders HTML-like content and URLs literally, and allows text selection inside", async () => {
    const text = '<script>window.alert("合成")</script>\n<img src="https://example.invalid/a" onerror="alert(1)"><b>備考</b>';
    render(discoveryTable([discovery(1, text, "https://example.invalid/合成備考\n次の行")]));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /の説明・備考を表示/ }));
    const popup = screen.getByRole("dialog");
    const paragraphs = popup.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe(text);
    expect(paragraphs[1]?.textContent).toBe("https://example.invalid/合成備考\n次の行");
    expect(popup.querySelector("script, img, b, a")).toBeNull();
    await user.click(paragraphs[0]!);
    const range = document.createRange();
    range.selectNodeContents(paragraphs[0]!);
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toBe(text);
    expect(popup).toBeInTheDocument();
    window.getSelection()?.removeAllRanges();
  });

  it("toggles, switches to another row without accumulating dialogs, and restores focus on Escape and close", async () => {
    render(<QuestTable rows={[quest(1, "一番目の備考"), quest(2, "二番目の備考")]}
      paginationResetKey={1} onToggleCompletion={vi.fn()} />);
    const user = userEvent.setup();
    const first = screen.getByRole("button", { name: "合成依頼1の備考を表示" });
    const second = screen.getByRole("button", { name: "合成依頼2の備考を表示" });
    first.focus();
    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-controls", screen.getByRole("dialog").id);
    expect(screen.getByRole("button", { name: "閉じる" })).toHaveFocus();
    await user.click(first);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    first.focus();
    await user.keyboard(" ");
    expect(screen.getByRole("dialog")).toHaveTextContent("一番目の備考");
    await user.click(second);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "合成依頼2" })).toHaveTextContent("二番目の備考");
    expect(screen.queryByText("一番目の備考")).not.toBeInTheDocument();
    expect(first).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(second).toHaveFocus();
    await user.click(first);
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(first).toHaveFocus();
    await user.click(first);
    const search = screen.getByLabelText("クエスト名／地図名を検索");
    await user.click(search);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(search).toHaveFocus();
  });

  it("closes on pagination and filter changes, including a filter that retains the selected row", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => quest(index + 1, `備考${index + 1}`));
    render(<QuestTable rows={rows} paginationResetKey={1} onToggleCompletion={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "合成依頼1の備考を表示" }));
    // A change event without a click exercises filter invalidation independently.
    fireEvent.change(screen.getByLabelText("クエスト名／地図名を検索"), { target: { value: "合成" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成依頼1の備考を表示" }));
    fireEvent.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合成依頼51の備考を表示" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成依頼51の備考を表示" }));
    fireEvent.change(screen.getByLabelText("1ページの件数"), { target: { value: "100" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on row removal, blanked content, profile reset, sorting, and unmount", async () => {
    const onUpdate = vi.fn();
    const rows = [quest(1, "一番目の備考"), quest(2, "二番目の備考")];
    const view = (data: QuestRowViewModel[], key: number) =>
      <QuestTable rows={data} paginationResetKey={key} onToggleCompletion={onUpdate} />;
    const { rerender, unmount } = render(view(rows, 1));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "合成依頼1の備考を表示" }));
    rerender(view([rows[1]!], 1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(view(rows, 1));
    await user.click(screen.getByRole("button", { name: "合成依頼1の備考を表示" }));
    rerender(view([quest(1, " "), rows[1]!], 1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(view(rows, 1));
    await user.click(screen.getByRole("button", { name: "合成依頼1の備考を表示" }));
    rerender(view(rows, 2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成依頼1の備考を表示" }));
    fireEvent.click(screen.getByRole("button", { name: "クエスト名／地図名で並べ替え" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成依頼1の備考を表示" }));
    unmount();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes discovery content on search, pagination, and a profile reset", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => discovery(index + 1, `説明${index + 1}`, null));
    const { rerender } = render(discoveryTable(rows));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "合成発見物1の説明・備考を表示" }));
    fireEvent.change(screen.getByLabelText("発見物名を検索"), { target: { value: "合成" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成発見物1の説明・備考を表示" }));
    fireEvent.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成発見物51の説明・備考を表示" }));
    rerender(discoveryTable(rows, 2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stops trigger clicks from reaching an ancestor progress interaction", async () => {
    const onRowClick = vi.fn();
    render(<MasterInfoProvider items={[{ id: 1, title: "合成", notes: "備考" }]} resetKey="1" hint="備考を表示">
      <div onClick={onRowClick}><MasterInfoButton rowId={1} /></div>
    </MasterInfoProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "合成の備考を表示" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("moves above and left at viewport edges, then repositions after resizing", async () => {
    let anchor = new DOMRect(970, 716, 24, 24);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("master-info-button")) return anchor;
      if (this.classList.contains("master-info-popover")) return new DOMRect(0, 0, 300, 280);
      return new DOMRect();
    });
    render(<MasterInfoProvider items={[{ id: 1, title: "端の行", notes: "合成備考" }]} resetKey="1" hint="備考を表示">
      <MasterInfoButton rowId={1} />
    </MasterInfoProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "端の行の備考を表示" }));
    const popup = screen.getByRole("dialog");
    expect(popup.style.left).toBe(`${window.innerWidth - 300 - 12}px`);
    expect(popup.style.top).toBe("428px");
    anchor = new DOMRect(4, 12, 24, 24);
    fireEvent.resize(window);
    expect(popup.style.left).toBe("12px");
    expect(popup.style.top).toBe("44px");
  });

  it("closes when the anchor scrolls out of its clipping container", async () => {
    let anchor = new DOMRect(120, 120, 24, 24);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("master-info-button")) return anchor;
      if (this.classList.contains("master-info-popover")) return new DOMRect(0, 0, 300, 200);
      if (this.dataset.testid === "scroll") return new DOMRect(100, 100, 600, 300);
      return new DOMRect();
    });
    render(<MasterInfoProvider items={[{ id: 1, title: "スクロール行", notes: "備考" }]} resetKey="1" hint="備考を表示">
      <div data-testid="scroll" style={{ overflowX: "auto", overflowY: "auto" }}><MasterInfoButton rowId={1} /></div>
    </MasterInfoProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "スクロール行の備考を表示" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    anchor = new DOMRect(120, 200, 24, 24);
    fireEvent.scroll(screen.getByTestId("scroll"));
    expect(screen.getByRole("dialog").style.top).toBe("232px");
    anchor = new DOMRect(120, 410, 24, 24);
    fireEvent.scroll(screen.getByTestId("scroll"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
