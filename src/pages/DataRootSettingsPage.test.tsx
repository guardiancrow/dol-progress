// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chooseCustom: vi.fn(), migrateSelected: vi.fn() }));

vi.mock("../dataRoot/service", () => ({
  dataRootService: { chooseCustom: mocks.chooseCustom, migrateSelected: mocks.migrateSelected, migrateToDefault: vi.fn() },
}));

import { DataRootSettingsPage } from "./DataRootSettingsPage";

const info = { mode: "default" as const, dataRoot: "C:\\active", databasePath: "C:\\active\\dol-progress.db", defaultDatabasePath: "C:\\active\\dol-progress.db", defaultDatabaseExists: true };

describe("DataRootSettingsPage", () => {
  it("keeps a selected folder separate from the active location and invokes migration only after confirmation", async () => {
    mocks.chooseCustom.mockResolvedValueOnce("D:\\data\\dol-progress");
    const user = userEvent.setup();
    render(<DataRootSettingsPage info={info} />);
    await user.click(screen.getByRole("button", { name: "保存場所を変更..." }));
    expect(await screen.findByText("選択した移行先: D:\\data\\dol-progress")).toBeInTheDocument();
    expect(screen.getByText("C:\\active")).toBeInTheDocument();
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
});
