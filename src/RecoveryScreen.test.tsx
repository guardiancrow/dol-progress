// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chooseExisting: vi.fn(),
  activateExisting: vi.fn(),
  activateLastGood: vi.fn(),
  rollbackPrevious: vi.fn(),
}));

vi.mock("./dataRoot/service", () => ({
  dataRootService: {
    chooseExisting: mocks.chooseExisting,
    activateExisting: mocks.activateExisting,
    activateLastGood: mocks.activateLastGood,
    rollbackPrevious: mocks.rollbackPrevious,
  },
}));

import { RecoveryScreen } from "./RecoveryScreen";

describe("RecoveryScreen", () => {
  beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("offers last-good and pending rollback independently without a Default activation action", async () => {
    const user = userEvent.setup();
    render(
      <RecoveryScreen
        info={{
          message: "configured root is unavailable",
          configuredRoot: "D:\\data\\broken",
          lastGoodAvailable: true,
          pendingPreviousAvailable: true,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "最後に正常だった保存場所を使用する" }));
    expect(mocks.activateLastGood).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "進行中の変更前の保存場所へ戻す" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /標準保存場所を使用する/ })).not.toBeInTheDocument();
  });

  it("shows the backend's portable Default path when its database is missing without offering an empty database", () => {
    const configuredRoot = "C:\\Moved Folder\\DOL 日本語\\data";
    render(<RecoveryScreen info={{ message: "標準データベースが見つかりません。", configuredRoot, lastGoodAvailable: false, pendingPreviousAvailable: false }} />);
    expect(screen.getByText(configuredRoot)).toBeInTheDocument();
    expect(screen.getByText("データベースは別の場所へ自動作成されていません。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /標準保存場所を使用する|最後に正常だった|変更前の保存場所/ })).not.toBeInTheDocument();
    expect(mocks.activateExisting).not.toHaveBeenCalled();
  });

  it("guides a real exit and relaunch instead of a misleading reload retry", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<RecoveryScreen info={{ message: "保存場所を確認してください。", lastGoodAvailable: false, pendingPreviousAvailable: false }} />);
    expect(screen.queryByRole("button", { name: "再試行" })).not.toBeInTheDocument();
    expect(screen.getByText(/保存場所を修正した後は/)).toHaveTextContent("一度終了して起動し直してください");
    await user.click(screen.getByRole("button", { name: "アプリを終了" }));
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.activateExisting).not.toHaveBeenCalled();
  });

  it("still selects and activates a validated existing Custom root", async () => {
    mocks.chooseExisting.mockResolvedValueOnce("D:\\Existing Custom");
    const user = userEvent.setup();
    render(<RecoveryScreen info={{ message: "configured root unavailable", lastGoodAvailable: false, pendingPreviousAvailable: false }} />);
    await user.click(screen.getByRole("button", { name: "保存場所を指定し直す" }));
    expect(await screen.findByText("選択した保存場所: D:\\Existing Custom")).toBeInTheDocument();
    expect(mocks.activateExisting).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "検証済みの保存場所を使用する" }));
    expect(mocks.activateExisting).toHaveBeenCalledOnce();
  });
});
