// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chooseCustom: vi.fn(), migrateSelected: vi.fn(), migrateToDefault: vi.fn() }));

vi.mock("../dataRoot/service", () => ({
  dataRootService: mocks,
}));

import { DataRootSettingsPage } from "./DataRootSettingsPage";

const info = { mode: "default" as const, dataRoot: "C:\\Apps\\DOL 日本語\\data", databasePath: "C:\\Apps\\DOL 日本語\\data\\dol-progress.db", portableRoot: "C:\\Apps\\DOL 日本語", defaultDataRoot: "C:\\Apps\\DOL 日本語\\data", configRoot: "C:\\Apps\\DOL 日本語\\config", defaultDatabasePath: "C:\\Apps\\DOL 日本語\\data\\dol-progress.db", defaultDatabaseExists: true };

describe("DataRootSettingsPage", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("keeps a selected folder separate from the active location and invokes migration only after confirmation", async () => {
    mocks.chooseCustom.mockResolvedValueOnce("D:\\data\\dol-progress");
    const user = userEvent.setup();
    render(<DataRootSettingsPage info={info} />);
    await user.click(screen.getByRole("button", { name: "データベースの保存場所を変更" }));
    expect(await screen.findByText("選択したデータベースの移行先: D:\\data\\dol-progress")).toBeInTheDocument();
    expect(screen.getByText(info.configRoot)).toBeInTheDocument();
    expect(screen.getByText(info.dataRoot)).toBeInTheDocument();
    expect(mocks.migrateSelected).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "このフォルダーへデータベースを移行する" }));
    expect(mocks.migrateSelected).toHaveBeenCalledOnce();
  });

  it("shows destination validation failures instead of dropping the picker result", async () => {
    mocks.chooseCustom.mockRejectedValueOnce("新しい保存場所には空のディレクトリを選択してください。");
    const user = userEvent.setup();
    render(<DataRootSettingsPage info={info} />);
    await user.click(screen.getByRole("button", { name: "データベースの保存場所を変更" }));
    expect(await screen.findByText(/選択したフォルダーは使用できません/)).toHaveTextContent("空のディレクトリ");
  });

  it("returns from an external Custom root through the backend without building a Default path", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DataRootSettingsPage info={{ ...info, mode: "custom", dataRoot: "D:\\External Data", databasePath: "D:\\External Data\\dol-progress.db" }} />);
    expect(screen.getByText("D:\\External Data")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "データベースを標準保存場所へ戻す" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.migrateToDefault).toHaveBeenCalledWith();
    expect(mocks.migrateToDefault).toHaveBeenCalledOnce();
  });

  it("leaves Custom active when returning to an existing Default database is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DataRootSettingsPage info={{ ...info, mode: "custom", dataRoot: "D:\\External Data", databasePath: "D:\\External Data\\dol-progress.db" }} />);
    await user.click(screen.getByRole("button", { name: "データベースを標準保存場所へ戻す" }));
    expect(mocks.migrateToDefault).not.toHaveBeenCalled();
    expect(screen.getByText("D:\\External Data")).toBeInTheDocument();
  });

  it.each(["default", "custom"] as const)("displays full backend paths in %s mode without deriving them from the database", (mode) => {
    const longDataRoot = `D:\\${"長いフォルダー名 ".repeat(30)}\\Backend Data`;
    const paths = { ...info, mode, dataRoot: longDataRoot, databasePath: "H:\\Different Parent\\dol-progress.db", portableRoot: "E:\\Backend App", defaultDataRoot: "F:\\Backend Standard", configRoot: `G:\\${"長い設定フォルダー ".repeat(30)}\\Backend Config` };
    render(<DataRootSettingsPage info={paths} />);
    for (const [label, value] of [
      ["データベースのフォルダー", paths.dataRoot],
      ["設定フォルダー", paths.configRoot],
    ]) {
      expect(screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent).toBe(value);
    }
    for (const label of ["現在の保存方式", "現在のデータフォルダー", "標準データフォルダー", "現在のデータベース", "アプリのフォルダー"]) {
      expect(screen.queryByText(label, { selector: "dt" })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(paths.defaultDataRoot)).not.toBeInTheDocument();
    expect(screen.queryByText(paths.databasePath)).not.toBeInTheDocument();
    expect(screen.queryByText(paths.portableRoot)).not.toBeInTheDocument();
    const database = screen.getByRole("article", { name: "データベース" });
    const settings = screen.getByRole("article", { name: "アプリの設定" });
    expect(within(database).getByText(paths.dataRoot)).toBeInTheDocument();
    expect(within(database).queryByText(paths.configRoot)).not.toBeInTheDocument();
    expect(within(database).getByRole("heading", { name: "データベースの保存場所を変更" })).toBeInTheDocument();
    expect(within(database).getByRole("button", { name: "データベースの保存場所を変更" })).toBeInTheDocument();
    expect(within(settings).getByText(paths.configRoot)).toBeInTheDocument();
    expect(within(settings).queryByText(paths.dataRoot)).not.toBeInTheDocument();
    expect(within(settings).queryByRole("button")).not.toBeInTheDocument();
    expect(within(settings).getByText("設定フォルダーにはアプリの設定が保存されます。")).toBeInTheDocument();
    expect(within(settings).queryByText("カスタム保存先を使用しています。")).not.toBeInTheDocument();
    if (mode === "custom") {
      expect(within(database).getByText("カスタム保存先を使用しています。")).toBeInTheDocument();
    } else {
      expect(screen.queryByText("カスタム保存先を使用しています。")).not.toBeInTheDocument();
      expect(screen.queryByText("標準", { selector: "dd" })).not.toBeInTheDocument();
    }
    expect(mocks.chooseCustom).not.toHaveBeenCalled();
    expect(mocks.migrateSelected).not.toHaveBeenCalled();
  });

  it("lists the existing fixed NTFS destination constraints without changing migration behavior", () => {
    render(<DataRootSettingsPage info={info} />);
    const database = within(screen.getByRole("article", { name: "データベース" }));
    expect(database.getByText("データベースの保存先には、次の条件を満たすフォルダーを選んでください。")).toBeInTheDocument();
    expect(database.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Windowsのローカル固定ドライブ上にあるNTFSフォルダー",
      "書き込み可能",
      "空のフォルダー",
      "アプリのフォルダー、その親フォルダー、配下のフォルダーではない",
      "現在のデータベースのフォルダーや、その親・配下のフォルダーではない",
      "ドライブのルートやProgram Files配下ではない",
      "保存先までのパスにジャンクションやシンボリックリンクを含まない",
    ]);
    expect(database.getByText("移行後も元のデータベースは削除されません。")).toBeInTheDocument();
    expect(mocks.chooseCustom).not.toHaveBeenCalled();
    expect(mocks.migrateSelected).not.toHaveBeenCalled();
  });

  it.each(["default", "custom"] as const)("keeps backup, file handling, removal, and WebView2 guidance concise in %s mode", (mode) => {
    render(<DataRootSettingsPage info={{ ...info, mode }} />);
    const managementCard = screen.getByRole("article", { name: "データとアプリの管理" });
    const management = within(managementCard);
    const windowsCard = screen.getByRole("article", { name: "Windows側に残るデータ" });
    const windows = within(windowsCard);
    expect(screen.getAllByRole("article").map((card) => within(card).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "データベース", "アプリの設定", "データとアプリの管理", "Windows側に残るデータ",
    ]);
    expect(management.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual([
      "データベースのバックアップ", "ファイルの移動と編集", "アプリを削除するとき",
    ]);
    expect(screen.queryByRole("heading", { name: "バックアップ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "移動と更新" })).not.toBeInTheDocument();
    const backup = management.getByRole("heading", { name: "データベースのバックアップ" }).nextElementSibling;
    expect(backup?.tagName).toBe("P");
    expect(backup).toHaveTextContent("バックアップを作成するときは「マスターデータ」のページから行ってください。");
    expect(management.getByText(/アプリの起動中に/)).toHaveTextContent("手動で移動しない");
    expect(management.getByText(/アプリの起動中に/)).toHaveTextContent("設定ファイルは手動で編集しない");
    expect(management.getByText(/アプリを終了してから、実行ファイルを削除/)).toHaveTextContent("アンインストーラーはありません");
    expect(management.getByText(/データベースや設定も削除する場合は/)).toHaveTextContent("必要なバックアップを確認してからそれぞれの保存先を削除");
    expect(management.queryByRole("heading", { name: "Windows側に残るデータ" })).not.toBeInTheDocument();
    expect(management.queryByText(/WebView2/)).not.toBeInTheDocument();
    expect(windows.queryByRole("heading", { name: "データベースのバックアップ" })).not.toBeInTheDocument();
    expect(windows.getByText("このアプリケーションはMicrosoft Edge WebView2 Runtimeを使用しています。")).toBeInTheDocument();
    expect(windows.getByText(/WebView2のキャッシュ等は/)).toHaveTextContent("LocalAppData");
    expect(screen.queryByText(/自動でダウンロード・インストール/)).not.toBeInTheDocument();
    expect(screen.queryByText(/フォルダー全体をコピー|設定フォルダーは含まれません/)).not.toBeInTheDocument();
  });
});
