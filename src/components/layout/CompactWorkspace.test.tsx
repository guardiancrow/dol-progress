// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import { AppShell } from "./AppShell";
import type { AppPage } from "./Sidebar";
import { ProfileProvider, type ProfileRepositoryPort } from "../../profiles/ProfileContext";
import { QuestTable } from "../quests/QuestTable";
import { DiscoveryTable } from "../discoveries/DiscoveryTable";
import type { QuestRowViewModel } from "../../quests/types";
import type { DiscoveryRowViewModel } from "../../discoveries/types";
import { mockWorkspaceMedia } from "./responsiveTestMedia";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
beforeEach(() => { vi.mocked(getVersion).mockResolvedValue("0.4.0"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const write = vi.fn(async () => undefined);
const profiles = {
  list: async () => [1, 2].map(id => ({ id, name: `合成プロフィール${id}`, memo: null, createdAt: "synthetic", updatedAt: "synthetic" })),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
};
const quests: QuestRowViewModel[] = Array.from({ length: 205 }, (_, i) => ({
  id: i + 1, title: `合成クエスト${i + 1}`, notes: "合成の備考", difficulty: 1, offerMethod: "冒険クエスト",
  offerCity: "合成都市", offerCities: ["合成都市"], requiredSkills: "探索", requiredSkillNames: ["探索"],
  requiredSkillsNormalized: [{ skillName: "探索", requiredRank: i + 1 }], discoveries: [],
  completed: false, updating: false, prerequisiteStatus: "NONE", directPrerequisites: [],
}));
const discoveries: DiscoveryRowViewModel[] = Array.from({ length: 205 }, (_, i) => ({
  id: i + 1, name: `合成発見物${i + 1}`, description: "合成の説明", notes: null,
  category: { id: 1, name: "気象・現象", sortOrder: 1 }, rank: 1, era: null, points: 1, difficulty: 1, experience: 100,
  relatedQuests: [], canReport: true, hasCard: true, status: "undiscovered", progress: null, updating: false,
  automaticReporting: false, effectiveReported: false,
}));

function Harness({ initialPage = "quests", initialFilter = false, repository = profiles }: { initialPage?: AppPage; initialFilter?: boolean; repository?: ProfileRepositoryPort }) {
  const [page, setPage] = useState(initialPage);
  return <ProfileProvider repository={repository}><AppShell currentPage={page} onNavigate={setPage}>
    <section className="workspace-page"><h2>{page}</h2>
      {page === "quests" ? <QuestTable rows={quests} paginationResetKey={1} onToggleCompletion={write} />
        : page === "discoveries" ? <DiscoveryTable rows={discoveries} paginationResetKey={1}
          initialFilter={initialFilter ? { kind: "category", categoryId: 1 } : undefined}
          onToggleDiscovered={write} onSetReported={write} onSetCardOwned={write} /> : null}
    </section>
  </AppShell></ProfileProvider>;
}

it.each([
  [800, 600, false, false], [1024, 768, false, true],
  [1280, 720, false, true], [1920, 1080, true, true], [600, 480, false, false],
  [896, 801, false, false], [897, 801, true, true], [897, 800, false, true],
])("uses CSS media state at %dx%d and keeps all manual choices on resize", async (width, height, expanded, menuOpen) => {
  const resize = mockWorkspaceMedia(width as number, height as number);
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("1"));
  const menu = screen.getByRole("button", { name: /^メニューを/ });
  const header = screen.getByRole("button", { name: /^ヘッダーを/ });
  const filters = screen.getByRole("button", { name: /^詳細フィルターを/ });
  expect(menu).toHaveAttribute("aria-expanded", String(menuOpen));
  expect(header).toHaveAttribute("aria-expanded", String(expanded));
  expect(filters).toHaveAttribute("aria-expanded", String(expanded));
  for (const button of [menu, header, filters]) {
    for (const id of button.getAttribute("aria-controls")!.split(" ")) expect(document.getElementById(id)).not.toBeNull();
    await user.click(button);
  }
  act(() => resize(width === 1920 ? 800 : 1920, width === 1920 ? 600 : 1080));
  expect(menu).toHaveAttribute("aria-expanded", String(!menuOpen));
  expect(header).toHaveAttribute("aria-expanded", String(!expanded));
  expect(filters).toHaveAttribute("aria-expanded", String(!expanded));
  expect(screen.getByRole("heading", { name: "DOL Progress Manager" })).toBeInTheDocument();
  expect(await screen.findByLabelText("アプリケーションのバージョン")).toHaveTextContent("0.4.0");
});

it("returns focus before automatic hiding, restores automatic panels on enlargement, and skips hidden controls", async () => {
  const resize = mockWorkspaceMedia(1920, 1080);
  const user = userEvent.setup();
  render(<Harness />);
  const profile = await screen.findByRole("combobox", { name: "現在のプロフィール" });
  profile.focus();
  act(() => resize(800, 600));
  const menu = screen.getByRole("button", { name: "メニューを開く" });
  expect(profile).toHaveFocus();
  expect(screen.getByRole("combobox", { name: "現在のプロフィール" })).toBe(profile);
  await user.tab();
  expect(screen.getByRole("searchbox")).toHaveFocus();
  act(() => resize(1920, 1080));
  screen.getByRole("button", { name: "概要" }).focus();
  act(() => resize(800, 600));
  expect(menu).toHaveFocus();
  expect(screen.queryByRole("button", { name: "概要" })).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole("button", { name: "ヘッダーを展開" })).toHaveFocus();
  act(() => resize(1920, 1080));
  expect(menu).toHaveAttribute("aria-expanded", "true");
  screen.getByLabelText("達成状態").focus();
  act(() => resize(1024, 768));
  expect(screen.getByRole("button", { name: "詳細フィルターを開く" })).toHaveFocus();
  await user.tab();
  expect(screen.queryByRole("combobox", { name: "達成状態" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "達成で並べ替え" })).toHaveFocus();
});

it.each(["quests", "discoveries"] as const)("preserves %s search, filters, sorting, page size, page and DOM without writes", async page => {
  mockWorkspaceMedia(1920, 1080);
  write.mockClear(); profiles.create.mockClear(); profiles.update.mockClear(); profiles.delete.mockClear();
  const user = userEvent.setup();
  render(<Harness initialPage={page} />);
  await user.type(screen.getByRole("searchbox"), "合成");
  if (page === "quests") {
    await user.selectOptions(screen.getByLabelText("達成状態"), "incomplete");
    await user.selectOptions(screen.getByLabelText("必要スキル"), "探索");
    await user.selectOptions(screen.getByLabelText("要求Rank"), "desc");
  } else {
    await user.selectOptions(screen.getByLabelText("状態"), "undiscovered");
    await user.selectOptions(screen.getByLabelText("分類"), "1");
    await user.click(screen.getByRole("button", { name: "発見物名で並べ替え" }));
  }
  await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
  await user.click(screen.getByRole("button", { name: "次ページ" }));
  const table = screen.getByRole("table");
  const firstRow = within(table).getAllByRole("row")[1];
  const firstText = firstRow!.textContent;
  expect(screen.getByLabelText("適用中の条件")).toHaveTextContent("検索中・絞り込み2件・並べ替えあり");
  await user.click(screen.getByRole("button", { name: "詳細フィルターを閉じる" }));
  await user.click(screen.getByRole("button", { name: "ヘッダーを縮める" }));
  await user.click(screen.getByRole("button", { name: "メニューを閉じる" }));
  expect(screen.getByRole("table")).toBe(table);
  expect(within(table).getAllByRole("row")[1]).toBe(firstRow);
  expect(firstRow).toHaveTextContent(firstText!);
  expect(screen.getByText("2 / 3ページ")).toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue("合成");
  expect(screen.getByLabelText("1ページの件数")).toHaveValue("100");
  await user.click(screen.getByRole("button", { name: "詳細フィルターを開く" }));
  expect(screen.getByLabelText(page === "quests" ? "達成状態" : "状態")).toHaveValue(page === "quests" ? "incomplete" : "undiscovered");
  expect(screen.getByText("2 / 3ページ")).toBeInTheDocument();
  expect(write).not.toHaveBeenCalled();
  for (const method of [profiles.create, profiles.update, profiles.delete]) expect(method).not.toHaveBeenCalled();
});

it("keeps the overview category intent applied while closed and opens it for editing", async () => {
  mockWorkspaceMedia(800, 600);
  const user = userEvent.setup();
  render(<Harness initialPage="discoveries" initialFilter />);
  expect(screen.getByLabelText("適用中の条件")).toHaveTextContent("絞り込み1件");
  expect(screen.queryByRole("combobox", { name: "分類" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "詳細フィルターを開く" }));
  expect(screen.getByLabelText("分類")).toHaveValue("1");
});

it("operates disclosures with Enter and Space without clearing the current table", async () => {
  mockWorkspaceMedia(800, 600);
  const user = userEvent.setup();
  render(<Harness />);
  const table = screen.getByRole("table");
  const menu = screen.getByRole("button", { name: "メニューを開く" });
  menu.focus();
  await user.keyboard(" ");
  expect(menu).toHaveAttribute("aria-expanded", "true");
  const header = screen.getByRole("button", { name: "ヘッダーを展開" });
  header.focus();
  await user.keyboard("{Enter}");
  expect(header).toHaveAttribute("aria-expanded", "true");
  const filters = screen.getByRole("button", { name: "詳細フィルターを開く" });
  filters.focus();
  await user.keyboard("{Enter}");
  expect(filters).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("table")).toBe(table);
});

it.each([
  ["メニューを開く", "メニューを閉じる"],
  ["ヘッダーを展開", "ヘッダーを縮める"],
  ["詳細フィルターを開く", "詳細フィルターを閉じる"],
])("keeps %s SVG decoration, hover text and keyboard state in sync", async (closedName, openName) => {
  mockWorkspaceMedia(800, 600);
  const user = userEvent.setup();
  write.mockClear();
  render(<Harness />);
  const button = screen.getByRole("button", { name: closedName });
  const svgBefore = Array.from(button.querySelectorAll("svg")).map(svg => svg.outerHTML).join("");
  expect(svgBefore).not.toBe("");
  for (const svg of button.querySelectorAll("svg")) {
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("stroke", "currentColor");
  }
  expect(within(button).queryByRole("img")).not.toBeInTheDocument();
  expect(button).toHaveAttribute("title", closedName);
  if (closedName.startsWith("詳細")) expect(button).toHaveTextContent("絞り込み");
  else expect(button).toHaveTextContent(/^$/);
  button.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: openName })).toBe(button);
  expect(button).toHaveAttribute("title", openName);
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(Array.from(button.querySelectorAll("svg")).map(svg => svg.outerHTML).join("")).not.toBe(svgBefore);
  await user.keyboard(" ");
  expect(screen.getByRole("button", { name: closedName })).toHaveAttribute("aria-expanded", "false");
  expect(write).not.toHaveBeenCalled();
});

it("keeps header/menu choices across navigation and allows profile switching and all six pages", async () => {
  mockWorkspaceMedia(800, 600);
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "ヘッダーを展開" }));
  await user.click(screen.getByRole("button", { name: "メニューを開く" }));
  await user.selectOptions(await screen.findByLabelText("現在のプロフィール"), "2");
  expect(screen.getByLabelText("現在のプロフィール")).toHaveDisplayValue("合成プロフィール2");
  for (const name of ["概要", "クエスト", "発見物", "プロフィール", "マスターデータ", "保存場所"]) {
    await user.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "ヘッダーを縮める" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "メニューを閉じる" })).toHaveAttribute("aria-expanded", "true");
  }
});

it("keeps one header selector mounted and keyboard reachable with the menu and header closed", async () => {
  const resize = mockWorkspaceMedia(800, 600);
  const user = userEvent.setup();
  write.mockClear(); profiles.create.mockClear(); profiles.update.mockClear(); profiles.delete.mockClear();
  render(<Harness />);
  const selector = screen.getByRole("combobox", { name: "現在のプロフィール" });
  await waitFor(() => expect(selector).toHaveValue("1"));
  expect(document.querySelectorAll(".profile-selector")).toHaveLength(1);
  expect(screen.getByRole("banner")).toContainElement(selector);
  expect(document.querySelector(".sidebar")).not.toContainElement(selector);
  const header = screen.getByRole("button", { name: "ヘッダーを展開" });
  header.focus();
  await user.tab();
  expect(selector).toHaveFocus();
  await user.selectOptions(selector, "2");
  expect(selector).toHaveDisplayValue("合成プロフィール2");
  expect(screen.getByRole("heading", { name: "quests" })).toBeInTheDocument();
  await user.click(header);
  expect(header).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById(header.getAttribute("aria-controls")!)).not.toContainElement(selector);
  expect(header.compareDocumentPosition(selector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await user.selectOptions(selector, "1");
  await user.click(screen.getByRole("button", { name: "メニューを開く" }));
  await user.click(screen.getByRole("button", { name: "メニューを閉じる" }));
  act(() => resize(1920, 1080));
  await user.click(screen.getByRole("button", { name: "ヘッダーを縮める" }));
  act(() => resize(600, 480));
  expect(screen.getByRole("combobox", { name: "現在のプロフィール" })).toBe(selector);
  expect(selector).toHaveValue("1");
  expect(document.querySelectorAll(".profile-selector")).toHaveLength(1);
  expect(write).not.toHaveBeenCalled();
  for (const method of [profiles.create, profiles.update, profiles.delete]) expect(method).not.toHaveBeenCalled();
});

it("keeps the selector disabled during loading and after an empty result without replacing it", async () => {
  mockWorkspaceMedia(800, 600);
  let finish!: (value: Awaited<ReturnType<typeof profiles.list>>) => void;
  const repository = { ...profiles, list: () => new Promise<Awaited<ReturnType<typeof profiles.list>>>(resolve => { finish = resolve; }) };
  render(<Harness repository={repository} />);
  const selector = screen.getByRole("combobox", { name: "現在のプロフィール" });
  expect(selector).toBeDisabled();
  await act(async () => finish([]));
  expect(selector).toBeDisabled();
  expect(selector).toHaveDisplayValue("プロフィールなし");
  expect(screen.getByRole("combobox", { name: "現在のプロフィール" })).toBe(selector);
  expect(document.querySelectorAll(".profile-selector")).toHaveLength(1);
});

it("keeps long names intact in the option and hover text instead of duplicating the profile name", async () => {
  mockWorkspaceMedia(800, 600);
  const name = "合成の長いプロフィール名".repeat(12);
  const repository = { ...profiles, list: async () => [{ ...(await profiles.list())[0]!, name }] };
  render(<Harness repository={repository} />);
  const selector = screen.getByRole("combobox", { name: "現在のプロフィール" });
  await waitFor(() => expect(selector).toHaveDisplayValue(name));
  expect(selector).toHaveAttribute("title", name);
  expect(within(selector).getByRole("option", { name })).toHaveTextContent(name);
  expect(document.querySelector("header strong")).toBeNull();
});
