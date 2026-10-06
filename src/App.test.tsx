// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { Profile } from "./domain/models";
import type { ProfileRepositoryPort } from "./profiles/ProfileContext";
import type { UpdateProfileInput } from "./repositories/profileRepository";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Profile UI", () => {
  it("shows loading before the empty state", async () => {
    let resolveList: ((profiles: Profile[]) => void) | undefined;
    const repository = new MockProfileRepository();
    repository.list = vi.fn(
      () =>
        new Promise<Profile[]>((resolve) => {
          resolveList = resolve;
        }),
    );
    render(<App profileRepository={repository} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "プロフィールを読み込んでいます",
    );
    resolveList?.([]);
    expect(
      await screen.findByText("プロフィールがまだありません"),
    ).toBeInTheDocument();
  });

  it("shows the profile list and initially selects the first profile", async () => {
    const repository = new MockProfileRepository([profile(1, "航海者", "メモ")]);
    render(<App profileRepository={repository} />);

    expect(await screen.findByText("メモ")).toBeInTheDocument();
    expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("1");
    expect(screen.getByText("選択中プロフィール").parentElement).toHaveTextContent(
      "航海者",
    );
  });

  it("creates a trimmed profile and selects it", async () => {
    const user = userEvent.setup();
    const repository = new MockProfileRepository();
    render(<App profileRepository={repository} />);
    await screen.findByText("プロフィールがまだありません");

    await user.click(screen.getAllByRole("button", { name: "プロフィールを作成" })[0]);
    await user.type(screen.getByLabelText("プロフィール名"), "  新しい航海者  ");
    await user.type(screen.getByLabelText("メモ（任意）"), "  メモ  ");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(repository.create).toHaveBeenCalledWith("新しい航海者", "メモ");
    await waitFor(() =>
      expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("1"),
    );
    expect(
      within(screen.getByRole("list", { name: "プロフィール一覧" })).getByText(
        "新しい航海者",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("1");
  });

  it("rejects an empty profile name without calling the repository", async () => {
    const user = userEvent.setup();
    const repository = new MockProfileRepository();
    render(<App profileRepository={repository} />);
    await screen.findByText("プロフィールがまだありません");

    await user.click(screen.getAllByRole("button", { name: "プロフィールを作成" })[0]);
    await user.type(screen.getByLabelText("プロフィール名"), "   ");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "プロフィール名を入力してください",
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("edits a profile with its current values", async () => {
    const user = userEvent.setup();
    const repository = new MockProfileRepository([profile(1, "航海者", "旧メモ")]);
    render(<App profileRepository={repository} />);
    await screen.findByText("旧メモ");

    await user.click(screen.getByRole("button", { name: "編集" }));
    expect(screen.getByLabelText("プロフィール名")).toHaveValue("航海者");
    await user.clear(screen.getByLabelText("プロフィール名"));
    await user.type(screen.getByLabelText("プロフィール名"), "熟練航海者");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(repository.update).toHaveBeenCalledWith(1, {
      name: "熟練航海者",
      memo: "旧メモ",
    });
    expect(
      within(await screen.findByRole("list", { name: "プロフィール一覧" })).getByText(
        "熟練航海者",
      ),
    ).toBeInTheDocument();
  });

  it("requires confirmation before deleting", async () => {
    const user = userEvent.setup();
    const repository = new MockProfileRepository([profile(1, "航海者")]);
    render(<App profileRepository={repository} />);
    await screen.findByRole("list", { name: "プロフィール一覧" });

    await user.click(screen.getByRole("button", { name: "削除" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("クエスト・発見物進捗も削除されます");
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("cancels deletion", async () => {
    const user = userEvent.setup();
    const repository = new MockProfileRepository([profile(1, "航海者")]);
    render(<App profileRepository={repository} />);
    await screen.findByRole("list", { name: "プロフィール一覧" });
    await user.click(screen.getByRole("button", { name: "削除" }));

    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("deletes a profile after confirmation", async () => {
    const user = userEvent.setup();
    const repository = new MockProfileRepository([profile(1, "航海者")]);
    render(<App profileRepository={repository} />);
    await screen.findByRole("list", { name: "プロフィール一覧" });
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(repository.delete).toHaveBeenCalledWith(1));
    expect(
      await screen.findByText("プロフィールがまだありません"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("");
    expect(
      screen.getAllByRole("button", { name: "プロフィールを作成" })[0],
    ).toHaveFocus();
  });

  it("changes the selected profile", async () => {
    const user = userEvent.setup();
    const repository = new MockProfileRepository([
      profile(1, "航海者A"),
      profile(2, "航海者B"),
    ]);
    render(<App profileRepository={repository} />);
    await screen.findByRole("list", { name: "プロフィール一覧" });

    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    expect(screen.getByText("選択中プロフィール").parentElement).toHaveTextContent(
      "航海者B",
    );
  });

  it("falls back to the first remaining profile when the selected one is deleted", async () => {
    const user = userEvent.setup();
    const repository = new MockProfileRepository([
      profile(1, "航海者A"),
      profile(2, "航海者B"),
    ]);
    render(<App profileRepository={repository} />);
    await screen.findByRole("list", { name: "プロフィール一覧" });
    const list = screen.getByRole("list", { name: "プロフィール一覧" });
    const firstCard = within(list).getByText("航海者A").closest("li");
    expect(firstCard).not.toBeNull();

    await user.click(within(firstCard as HTMLElement).getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() =>
      expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("2"),
    );
    expect(screen.getByText("選択中プロフィール").parentElement).toHaveTextContent(
      "航海者B",
    );
  });

  it("shows a repository error in the UI", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = new MockProfileRepository();
    repository.list = vi.fn().mockRejectedValue(new Error("SQLite unavailable"));
    render(<App profileRepository={repository} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "プロフィールを読み込めませんでした",
    );
  });

  it("switches to the Overview profile-selection state from navigation", async () => {
    const user = userEvent.setup();
    render(<App profileRepository={new MockProfileRepository()} />);
    await screen.findByText("プロフィールがまだありません");

    await user.click(screen.getByRole("button", { name: "概要" }));

    expect(
      screen.getByRole("heading", { name: "進捗を表示するプロフィールを選択してください" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveClass("main-content--workspace");
  });
});

class MockProfileRepository implements ProfileRepositoryPort {
  private profiles: Profile[];

  constructor(initialProfiles: Profile[] = []) {
    this.profiles = [...initialProfiles];
  }

  list = vi.fn(async () => [...this.profiles]);

  create = vi.fn(async (name: string, memo?: string | null) => {
    const created = profile(this.profiles.length + 1, name, memo ?? null);
    this.profiles.push(created);
    return created;
  });

  update = vi.fn(async (profileId: number, input: UpdateProfileInput) => {
    const current = this.profiles.find((item) => item.id === profileId);
    if (!current) {
      throw new Error("Profile not found");
    }
    const updated = { ...current, ...input, updatedAt: "2026-02-01T00:00:00.000Z" };
    this.profiles = this.profiles.map((item) =>
      item.id === profileId ? updated : item,
    );
    return updated;
  });

  delete = vi.fn(async (profileId: number) => {
    this.profiles = this.profiles.filter((item) => item.id !== profileId);
  });
}

function profile(id: number, name: string, memo: string | null = null): Profile {
  return {
    id,
    name,
    memo,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
