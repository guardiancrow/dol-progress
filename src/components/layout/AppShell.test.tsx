// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { StrictMode, useState } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as appApi from "@tauri-apps/api/app";
import { ProfileProvider, type ProfileRepositoryPort } from "../../profiles/ProfileContext";
import { AppShell } from "./AppShell";
import type { AppPage } from "./Sidebar";

vi.mock("@tauri-apps/api/app", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tauri-apps/api/app")>(),
  getVersion: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(appApi.getVersion).mockReset();
});

const repository: ProfileRepositoryPort = {
  list: async () => [],
  create: async () => { throw new Error("unused"); },
  update: async () => { throw new Error("unused"); },
  delete: async () => undefined,
};

function Harness() {
  const [page, setPage] = useState<AppPage>("profiles");
  return <ProfileProvider repository={repository}>
    <AppShell currentPage={page} onNavigate={setPage}><h2>通常画面 {page}</h2></AppShell>
  </ProfileProvider>;
}

function deferredVersion() {
  let resolve!: (version: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it.each(["0.3.0", "7.8.9-beta.1"])("displays the runtime version %s and preserves the footer and navigation", async (version) => {
  const getVersion = vi.mocked(appApi.getVersion).mockResolvedValue(version);
  const user = userEvent.setup();
  render(<Harness />);
  expect(await screen.findByLabelText("アプリケーションのバージョン")).toHaveTextContent(`v${version}`);
  expect(within(screen.getByRole("contentinfo")).getByText("データはこのPCのSQLiteに保存されます")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "通常画面 profiles" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "発見物" }));
  expect(screen.getByRole("heading", { name: "通常画面 discoveries" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "発見物" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("main")).toHaveClass("main-content--workspace");
  expect(screen.getByLabelText("アプリケーションのバージョン")).toHaveTextContent(`v${version}`);
  expect(getVersion).toHaveBeenCalledTimes(1);
});

it("keeps the footer and screens usable while the version promise is pending", async () => {
  const request = deferredVersion();
  const getVersion = vi.mocked(appApi.getVersion).mockReturnValue(request.promise);
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.getByText("データはこのPCのSQLiteに保存されます")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "通常画面 profiles" })).toBeInTheDocument();
  expect(screen.queryByLabelText("アプリケーションのバージョン")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "概要" }));
  expect(screen.getByRole("heading", { name: "通常画面 overview" })).toBeInTheDocument();
  await act(async () => request.resolve("0.3.0"));
  expect(screen.getByLabelText("アプリケーションのバージョン")).toHaveTextContent("v0.3.0");
  expect(getVersion).toHaveBeenCalledTimes(1);
});

it("omits the version after rejection without displaying an application error or retrying", async () => {
  const request = deferredVersion();
  const getVersion = vi.mocked(appApi.getVersion).mockReturnValue(request.promise);
  const user = userEvent.setup();
  render(<Harness />);
  await act(async () => request.reject(new Error("synthetic version failure")));
  expect(screen.queryByLabelText("アプリケーションのバージョン")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("データはこのPCのSQLiteに保存されます")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "保存場所" }));
  expect(screen.getByRole("heading", { name: "通常画面 data-root" })).toBeInTheDocument();
  expect(getVersion).toHaveBeenCalledTimes(1);
});

it("safely renders with the real API when the browser has no Tauri bridge", async () => {
  expect(window).not.toHaveProperty("__TAURI_INTERNALS__");
  const original = await vi.importActual<typeof import("@tauri-apps/api/app")>("@tauri-apps/api/app");
  const getVersion = vi.mocked(appApi.getVersion).mockImplementation(original.getVersion);
  await act(async () => { render(<Harness />); });
  expect(getVersion).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("アプリケーションのバージョン")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "通常画面 profiles" })).toBeInTheDocument();
  expect(screen.getByText("データはこのPCのSQLiteに保存されます")).toBeInTheDocument();
});

it.each(["success", "failure"])("reuses one request in StrictMode and handles %s", async (outcome) => {
  const request = deferredVersion();
  const getVersion = vi.mocked(appApi.getVersion).mockReturnValue(request.promise);
  render(<StrictMode><Harness /></StrictMode>);
  expect(getVersion).toHaveBeenCalledTimes(1);
  await act(async () => {
    if (outcome === "success") request.resolve("0.3.0");
    else request.reject(new Error("synthetic failure in StrictMode"));
  });
  expect(screen.getByText("データはこのPCのSQLiteに保存されます")).toBeInTheDocument();
  if (outcome === "success") expect(screen.getByLabelText("アプリケーションのバージョン")).toHaveTextContent("v0.3.0");
  else expect(screen.queryByLabelText("アプリケーションのバージョン")).not.toBeInTheDocument();
  expect(getVersion).toHaveBeenCalledTimes(1);
});

it.each(["success", "failure"])("ignores the old request after unmount on %s", async (outcome) => {
  const old = deferredVersion();
  const current = deferredVersion();
  const getVersion = vi.mocked(appApi.getVersion).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const first = render(<Harness />);
  first.unmount();
  render(<Harness />);
  await act(async () => current.resolve("0.3.0"));
  await act(async () => {
    if (outcome === "success") old.resolve("7.8.9");
    else old.reject(new Error("synthetic failure after unmount"));
  });
  expect(screen.getByLabelText("アプリケーションのバージョン")).toHaveTextContent("v0.3.0");
  expect(screen.queryByText("v7.8.9")).not.toBeInTheDocument();
  expect(getVersion).toHaveBeenCalledTimes(2);
});
