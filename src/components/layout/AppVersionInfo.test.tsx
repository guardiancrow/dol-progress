// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AppVersionInfo } from "./AppVersionInfo";
import { release, response } from "../../updates/testFixtures";
import { openReleasesPage } from "../../updates/openReleasesPage";

vi.mock("../../updates/openReleasesPage",()=>({openReleasesPage:vi.fn().mockResolvedValue(undefined)}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();vi.mocked(openReleasesPage).mockReset().mockResolvedValue(undefined);});

function setup(body:unknown = release()) {
  const request=vi.fn<typeof fetch>().mockResolvedValue(response(JSON.stringify(body)));
  vi.stubGlobal("fetch",request);
  render(<StrictMode><button>通常画面の操作</button><AppVersionInfo version="0.3.0"/></StrictMode>);
  return {user:userEvent.setup(),request};
}
async function open(user:ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button",{name:"アプリケーションのバージョン"}));
  return screen.getByRole("dialog",{name:"アプリケーション情報"});
}

it("does not fetch on mount/open and supports non-modal keyboard dismissal and focus return",async()=>{
  const {user,request}=setup();
  const trigger=screen.getByRole("button",{name:"アプリケーションのバージョン"});
  expect(trigger).toHaveAccessibleDescription("現在のバージョン v0.3.0。アプリケーション情報を開きます。");
  trigger.focus(); await user.keyboard("{Enter}");
  expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-modal","true");
  expect(screen.getByText("未確認")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"閉じる"})).toHaveFocus();
  expect(trigger).toHaveTextContent("v0.3.0");
  expect(request).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.keyboard(" ");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"閉じる"}));
  expect(trigger).toHaveFocus();
});

it("keeps the page usable during a pending check and reuses it after closing/reopening the panel",async()=>{
  const {user,request}=setup();
  let resolve!: (value:Response)=>void;
  request.mockImplementation(()=>new Promise(yes=>{resolve=yes;}));
  await open(user);
  await user.click(screen.getByRole("button",{name:"更新を確認"}));
  expect(screen.getByRole("button",{name:"確認中…"})).toBeDisabled();
  await user.click(screen.getByRole("button",{name:"通常画面の操作"}));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"通常画面の操作"})).toHaveFocus();
  await open(user);
  expect(request).toHaveBeenCalledTimes(1);
  await act(async()=>resolve(response(JSON.stringify(release()))));
  expect(screen.getByText("更新あり")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"閉じる"})).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("新しい公開版v0.3.1");
});

it.each([
  ["newer",release(),"新しい公開版v0.3.1があります。",true],
  ["same",release("v0.3.0"),"GitHubのLatest指定通常版と同じ版です。",false],
  ["older",release("v0.2.9"),"現在版の方がGitHubのLatest指定通常版より新しいです。",false],
  ["missing",{...release(),assets:[]},"対象配布物（Windows x64 ZIP・SHA-256）が未確認",false],
  ["unsupported",release("v0.3.1-rc.1"),"バージョン比較不能",false],
  ["draft",{...release(),draft:true},"通常の公開Releaseを確認できません",false],
] as const)("distinguishes %s without misleading notifications",async(_label,value,message,notified)=>{
  const {user}=setup(value);
  await open(user); await user.click(screen.getByRole("button",{name:"更新を確認"}));
  await screen.findByText(message,{exact:false});
  expect(!!screen.queryByText("更新あり")).toBe(notified);
  expect(screen.getByRole("status")).toHaveAttribute("aria-live","polite");
});

it("treats offline failure as failure, maintains normal UI and never interprets untrusted HTML or URLs",async()=>{
  const {user,request}=setup({...release(),body:'<img src="https://example.invalid/a" onerror="alert(1)">',html_url:"javascript:alert(1)"});
  request.mockRejectedValue(new TypeError("synthetic network error"));
  await open(user); await user.click(screen.getByRole("button",{name:"更新を確認"}));
  expect(await screen.findByText(/通信失敗：GitHubへ接続できません/)).toBeInTheDocument();
  expect(screen.queryByText("更新あり")).not.toBeInTheDocument();
  expect(document.querySelector("img,script")).toBeNull();
  await user.click(screen.getByRole("button",{name:"GitHub Releasesを開く"}));
  expect(openReleasesPage).toHaveBeenCalledExactlyOnceWith();
  await user.click(screen.getByRole("button",{name:"通常画面の操作"}));
  expect(screen.getByRole("button",{name:"通常画面の操作"})).toHaveFocus();
});

it("opens only the fixed command even when API metadata contains malicious links",async()=>{
  const {user}=setup({...release(),html_url:"file:///synthetic",body:"<script>alert(1)</script>",assets_url:"https://example.invalid"});
  const dialog=await open(user);
  await user.click(within(dialog).getByRole("button",{name:"更新を確認"}));
  await screen.findByText("更新あり");
  expect(document.querySelector("img,script,a")).toBeNull();
  vi.mocked(openReleasesPage).mockRejectedValue(new Error("synthetic browser error"));
  await user.click(screen.getByRole("button",{name:"GitHub Releasesを開く"}));
  expect(openReleasesPage).toHaveBeenCalledExactlyOnceWith();
  expect(await screen.findByText("既定ブラウザーを開けませんでした。")).toBeInTheDocument();
});

it("closes on focus leaving the panel without trapping Tab or stealing focus",async()=>{
  const {user}=setup(); await open(user);
  const external=screen.getByRole("button",{name:"通常画面の操作"});
  act(()=>external.focus());
  expect(external).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await open(user);
  fireEvent.keyDown(document,{key:"Tab"});
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
