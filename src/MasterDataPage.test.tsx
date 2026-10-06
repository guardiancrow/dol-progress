// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { Profile } from "./domain/models";
import { ImportError, type ImportDataset, type ImportResult, type PreparedImport } from "./importer";
import { openGvdbSite } from "./masterData/openGvdbSite";
import type { MasterDataStatus, MasterDataStatusRepositoryPort, MasterImportServicePort } from "./masterData/types";
import type { ProfileRepositoryPort } from "./profiles/ProfileContext";
import type { UpdateProfileInput } from "./repositories/profileRepository";

vi.mock("./masterData/openGvdbSite", () => ({ openGvdbSite: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Master Data UI", () => {
  it("shows acknowledgement after backup controls and opens the fixed external site", async () => {
    vi.mocked(openGvdbSite).mockResolvedValue();
    const user = await open(setup(fullStatus()));
    const heading = screen.getByRole("heading", { name: "データ提供元・謝辞" });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("section")).toHaveTextContent("コミュニティの皆さまに感謝します");
    const button = screen.getByRole("button", { name: "大航海時代データベースを開く（外部サイト）" });
    button.focus();
    expect(button).toHaveFocus();
    await user.click(button);
    expect(openGvdbSite).toHaveBeenCalledOnce();
  });

  it("reports browser-open failure without navigating the app", async () => {
    vi.mocked(openGvdbSite).mockRejectedValue(new Error("browser unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = await open(setup(fullStatus()));
    await user.click(screen.getByRole("button", { name: "大航海時代データベースを開く（外部サイト）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("既定ブラウザーでサイトを開けませんでした");
    expect(screen.getByRole("heading", { name: "マスターデータ" })).toBeInTheDocument();
  });

  it("shows zero master counts", async () => {
    await open(setup(emptyStatus()));
    expect(screen.getAllByText("0件")).toHaveLength(2);
    expect(screen.getByText("インポート履歴はありません。")).toBeInTheDocument();
  });

  it("shows existing active master counts", async () => {
    await open(setup(fullStatus()));
    expect(screen.getByText("1,200件")).toBeInTheDocument();
    expect(screen.getByText("800件")).toBeInTheDocument();
  });

  it("shows latest file, source date, and import history", async () => {
    await open(setup(fullStatus()));
    expect(screen.getAllByText("quests.csv").length).toBeGreaterThan(0);
    expect(screen.getAllByText("discovery_items.csv").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-01-02", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近のインポート履歴" })).toBeInTheDocument();
  });

  it("selects a Quest file for the Quest dataset", async () => {
    const repositories = setup(fullStatus());
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "quests.csv を選択" }));
    expect(repositories.importer.selectFile).toHaveBeenCalledWith("quests");
    expect(await screen.findByLabelText("クエストインポート確認")).toHaveTextContent("クエスト");
  });

  it("selects a Discovery file for the Discovery dataset", async () => {
    const repositories = setup(fullStatus());
    repositories.importer.selected.discoveries = prepared("discoveries");
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "discovery_items.csv を選択" }));
    expect(repositories.importer.selectFile).toHaveBeenCalledWith("discoveries");
    expect(await screen.findByLabelText("発見物インポート確認")).toHaveTextContent("発見物");
  });

  it("shows file name, dataset, SHA-256, and parsed rows before import", async () => {
    const repositories = setup(fullStatus());
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "quests.csv を選択" }));
    const confirmation = await screen.findByLabelText("クエストインポート確認");
    expect(confirmation).toHaveTextContent("new-quests.csv");
    expect(confirmation).toHaveTextContent("a".repeat(64));
    expect(confirmation).toHaveTextContent("1,200件");
  });

  it("does not import merely by selecting a file", async () => {
    const repositories = setup(fullStatus());
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "quests.csv を選択" }));
    await screen.findByLabelText("クエストインポート確認");
    expect(repositories.importer.importPrepared).not.toHaveBeenCalled();
  });

  it("imports only after the explicit dataset update action", async () => {
    const repositories = setup(fullStatus());
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    await waitFor(() => expect(repositories.importer.importPrepared).toHaveBeenCalledWith(repositories.importer.selected.quests));
  });

  it("prevents duplicate execution while an import is pending", async () => {
    let resolveImport: ((result: ImportResult) => void) | undefined;
    const repositories = setup(fullStatus());
    repositories.importer.importPrepared = vi.fn(() => new Promise((resolve) => { resolveImport = resolve; }));
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    const pending = screen.getByRole("button", { name: "クエストをインポート中…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(repositories.importer.importPrepared).toHaveBeenCalledTimes(1);
    resolveImport?.(result("quests"));
    expect(await screen.findByText("クエストマスターを更新しました。")).toBeInTheDocument();
  });

  it("shows an accessible import success message", async () => {
    const repositories = setup(fullStatus());
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("クエストマスターを更新しました");
  });

  it("shows all ImportResult counters", async () => {
    const repositories = setup(fullStatus());
    repositories.importer.nextResult = result("quests", { insertedCount: 2, updatedCount: 1198, inactiveCount: 3, relationCount: 1300 });
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    const success = await screen.findByText("クエストマスターを更新しました。");
    const panel = success.closest("div") as HTMLElement;
    expect(panel).toHaveTextContent("読み込み1,200件");
    expect(panel).toHaveTextContent("新規2件");
    expect(panel).toHaveTextContent("更新1,198件");
    expect(panel).toHaveTextContent("非アクティブ3件");
    expect(panel).toHaveTextContent("関連1,300件");
  });

  it("shows warning zero explicitly", async () => {
    const repositories = setup(fullStatus());
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    expect((await screen.findByText("クエストマスターを更新しました。")).closest("div")).toHaveTextContent("警告0件");
  });

  it("shows warning count and expandable bounded details", async () => {
    const repositories = setup(fullStatus());
    repositories.importer.nextResult = result("quests", { warningCount: 1, warnings: [{ code: "MissingTarget", message: "関連先がありません", rowNumber: 12 }] });
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    expect(await screen.findByText("警告の詳細を確認")).toBeInTheDocument();
    expect(screen.getByText("MissingTarget").closest("li")).toHaveTextContent("行 12");
  });

  it("shows DuplicateImport as a specific user message", async () => {
    await expectImportError("DuplicateImport", "このファイルは既にインポートされています。");
  });

  it("shows DecodeError safely", async () => {
    await expectSelectionError("DecodeError", "文字コードを解釈できません。", "CP932の不正なバイトです");
  });

  it("shows HeaderValidationError safely", async () => {
    await expectSelectionError("HeaderValidationError", "ファイルのヘッダーが正しくありません。", "必須列 ID がありません");
  });

  it("shows RowValidationError with row detail", async () => {
    await expectSelectionError("RowValidationError", "ファイルの行データが正しくありません。", "行 1234: ID が整数ではありません");
  });

  it("hides SQL detail for DatabaseImportError", async () => {
    const repositories = setup(fullStatus());
    repositories.importer.importPrepared = vi.fn().mockRejectedValue(new ImportError("DatabaseImportError", "データベースへの取り込みに失敗しました。", "SELECT secret FROM internal"));
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("データベースへの取り込みに失敗しました。");
    expect(screen.getByRole("alert")).not.toHaveTextContent("SELECT secret");
  });

  it("refreshes active counts and history after success", async () => {
    const repositories = setup(emptyStatus());
    const user = await selectQuest(repositories);
    repositories.status.value = fullStatus();
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    await waitFor(() => expect(repositories.status.getStatus).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText("1,200件")).length).toBeGreaterThan(0);
  });

  it("does not invoke profile mutations during master import", async () => {
    const repositories = setup(fullStatus(), [profile(1)]);
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    await screen.findByText("クエストマスターを更新しました。");
    expect(repositories.profiles.create).not.toHaveBeenCalled();
    expect(repositories.profiles.update).not.toHaveBeenCalled();
    expect(repositories.profiles.delete).not.toHaveBeenCalled();
  });

  it("connects only to the prepared master import API and no progress write API", async () => {
    const repositories = setup(fullStatus(), [profile(1)]);
    const user = await selectQuest(repositories);
    await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
    expect(repositories.importer.importPrepared).toHaveBeenCalledTimes(1);
    expect(Object.keys(repositories.importer)).not.toContain("markCompleted");
    expect(Object.keys(repositories.importer)).not.toContain("markDiscovered");
  });
});

async function expectImportError(kind: ConstructorParameters<typeof ImportError>[0], message: string) {
  const repositories = setup(fullStatus());
  repositories.importer.importPrepared = vi.fn().mockRejectedValue(new ImportError(kind, message));
  const user = await selectQuest(repositories);
  await user.click(screen.getByRole("button", { name: "クエスト情報を更新" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
}

async function expectSelectionError(kind: ConstructorParameters<typeof ImportError>[0], message: string, detail: string) {
  const repositories = setup(fullStatus());
  repositories.importer.selectFile = vi.fn().mockRejectedValue(new ImportError(kind, message, detail));
  const user = await open(repositories);
  await user.click(screen.getByRole("button", { name: "quests.csv を選択" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(message);
  expect(alert).toHaveTextContent(detail);
}

interface Repositories { profiles: MockProfiles; status: MockStatus; importer: MockImporter }

function setup(status: MasterDataStatus, profiles: Profile[] = []): Repositories {
  return { profiles: new MockProfiles(profiles), status: new MockStatus(status), importer: new MockImporter() };
}

async function open(repositories: Repositories) {
  const user = userEvent.setup();
  render(<App profileRepository={repositories.profiles} masterDataStatusRepository={repositories.status} masterImportService={repositories.importer} />);
  await screen.findByRole("heading", { name: "プロフィール" });
  await user.click(screen.getByRole("button", { name: "マスターデータ" }));
  expect(await screen.findByRole("heading", { name: "マスターデータ" })).toBeInTheDocument();
  return user;
}

async function selectQuest(repositories: Repositories) {
  const user = await open(repositories);
  await user.click(screen.getByRole("button", { name: "quests.csv を選択" }));
  await screen.findByLabelText("クエストインポート確認");
  return user;
}

class MockProfiles implements ProfileRepositoryPort {
  constructor(private readonly profiles: Profile[]) {}
  list = vi.fn(async () => [...this.profiles]);
  create = vi.fn(async () => { throw new Error("unused"); });
  update = vi.fn(async (_id: number, _input: UpdateProfileInput) => { throw new Error("unused"); });
  delete = vi.fn(async () => undefined);
}

class MockStatus implements MasterDataStatusRepositoryPort {
  constructor(public value: MasterDataStatus) {}
  getStatus = vi.fn(async () => this.value);
}

class MockImporter implements MasterImportServicePort {
  selected: Record<ImportDataset, PreparedImport> = { quests: prepared("quests"), discoveries: prepared("discoveries") };
  nextResult: ImportResult = result("quests");
  selectFile = vi.fn(async (dataset: ImportDataset) => this.selected[dataset]);
  importPrepared = vi.fn(async (selection: PreparedImport) => this.nextResult.dataset === selection.dataset ? this.nextResult : result(selection.dataset));
}

function prepared(dataset: ImportDataset): PreparedImport {
  const rowCount = dataset === "quests" ? 1200 : 800;
  return {
    dataset,
    fileName: dataset === "quests" ? "new-quests.csv" : "new-discovery_items.csv",
    sha256: "a".repeat(64),
    rowCount,
    warningCount: 0,
    request: { dataset, fileName: dataset === "quests" ? "new-quests.csv" : "new-discovery_items.csv", sha256: "a".repeat(64), quests: [], discoveries: [], warnings: [] },
  };
}

function result(dataset: ImportDataset, overrides: Partial<ImportResult> = {}): ImportResult {
  return { dataset, fileName: dataset === "quests" ? "new-quests.csv" : "new-discovery_items.csv", sha256: "a".repeat(64), importedRowCount: dataset === "quests" ? 1200 : 800, insertedCount: 0, updatedCount: dataset === "quests" ? 1200 : 800, inactiveCount: 0, relationCount: dataset === "quests" ? 1300 : 900, warningCount: 0, warnings: [], ...overrides };
}

function emptyStatus(): MasterDataStatus {
  return { datasets: { quests: { dataset: "quests", activeCount: 0, latestImport: null }, discoveries: { dataset: "discoveries", activeCount: 0, latestImport: null } }, recentHistory: [] };
}

// Synthetic totals exercise thousands separators without depending on a GVDB snapshot.
function fullStatus(): MasterDataStatus {
  const quests = { id: 1, dataset: "quests" as const, fileName: "quests.csv", rowCount: 1200, sourceMaxUpdatedAt: "2026-01-01", importedAt: "2026-01-03T00:00:00.000Z" };
  const discoveries = { id: 2, dataset: "discoveries" as const, fileName: "discovery_items.csv", rowCount: 800, sourceMaxUpdatedAt: "2026-01-02", importedAt: "2026-01-04T00:00:00.000Z" };
  return { datasets: { quests: { dataset: "quests", activeCount: 1200, latestImport: quests }, discoveries: { dataset: "discoveries", activeCount: 800, latestImport: discoveries } }, recentHistory: [discoveries, quests] };
}

function profile(id: number): Profile { return { id, name: "航海者", memo: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }; }
