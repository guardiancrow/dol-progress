// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
        onRetry={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "最後に正常だった保存場所を使用する" }));
    expect(mocks.activateLastGood).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "進行中の変更前の保存場所へ戻す" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /標準保存場所を使用する/ })).not.toBeInTheDocument();
  });
});
