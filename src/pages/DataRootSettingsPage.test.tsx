// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chooseCustom: vi.fn(), migrateSelected: vi.fn(), migrateToDefault: vi.fn() }));

vi.mock("../dataRoot/service", () => ({
  dataRootService: mocks,
}));

import { DataRootSettingsPage } from "./DataRootSettingsPage";

const info = { mode: "default" as const, dataRoot: "C:\\Apps\\DOL 日本語\\data", databasePath: "C:\\Apps\\DOL 日本語\\data\\dol-progress.db", defaultDatabasePath: "C:\\Apps\\DOL 日本語\\data\\dol-progress.db", defaultDatabaseExists: true };

describe("DataRootSettingsPage", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("keeps a selected folder separate from the active location and invokes migration only after confirmation", async () => {
    mocks.chooseCustom.mockResolvedValueOnce("D:\\data\\dol-progress");
    const user = userEvent.setup();
    render(<DataRootSettingsPage info={info} />);
    await user.click(screen.getByRole("button", { name: "保存場所を変更..." }));
    expect(await screen.findByText("選択した移行先: D:\\data\\dol-progress")).toBeInTheDocument();
    expect(screen.getByText(info.dataRoot)).toBeInTheDocument();
    expect(screen.getByText(info.databasePath)).toBeInTheDocument();
    expect(mocks.migrateSelected).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "この保存場所へ移行する" }));
    expect(mocks.migrateSelected).toHaveBeenCalledOnce();
  });

  it("shows destination validation failures instead of dropping the picker result", async () => {
    mocks.chooseCustom.mockRejectedValueOnce("新しい保存場所には空のディレクトリを選択してください。");
    const user = userEvent.setup();
    render(<DataRootSettingsPage info={info} />);
    await user.click(screen.getByRole("button", { name: "保存場所を変更..." }));
    expect(await screen.findByText(/選択したフォルダーは使用できません/)).toHaveTextContent("空のディレクトリ");
  });

  it("returns from an external Custom root through the backend without building a Default path", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DataRootSettingsPage info={{ ...info, mode: "custom", dataRoot: "D:\\External Data", databasePath: "D:\\External Data\\dol-progress.db" }} />);
    expect(screen.getByText("D:\\External Data")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "標準保存場所へ戻す" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.migrateToDefault).toHaveBeenCalledWith();
    expect(mocks.migrateToDefault).toHaveBeenCalledOnce();
  });

  it("leaves Custom active when returning to an existing Default database is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DataRootSettingsPage info={{ ...info, mode: "custom", dataRoot: "D:\\External Data", databasePath: "D:\\External Data\\dol-progress.db" }} />);
    await user.click(screen.getByRole("button", { name: "標準保存場所へ戻す" }));
    expect(mocks.migrateToDefault).not.toHaveBeenCalled();
    expect(screen.getByText("D:\\External Data")).toBeInTheDocument();
  });
});
