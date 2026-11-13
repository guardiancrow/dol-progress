// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryStateControl, ReportHoldDialogs, ReportHoldFeedback } from "../components/discoveries/ReportHoldControls";
import { useReportHold, type ReportHoldDependencies } from "./useReportHold";
import type { DiscoveryState } from "./stateService";
import type { DiscoveryStateSummary } from "./stateReader";

afterEach(cleanup);

function summary(overrides: Partial<DiscoveryStateSummary> = {}): DiscoveryStateSummary {
  return {id:1,active:1,categoryName:"史跡",experience:100,masterUpdatedAt:"m",discovered:1,reported:0,reportHold:0,progressUpdatedAt:"p",firstReportStatus:"unknown",legacyMeritCredit:0,historyUpdatedAt:null,automaticReporting:0,mapRelated:1,...overrides};
}
function snapshot(s: DiscoveryStateSummary, profileId = 1): DiscoveryState {
  return {profileId,discoveryId:s.id,progress:s.discovered ? {reported:!!s.reported,reportHold:!!s.reportHold,cardOwned:true,memo:"keep",updatedAt:s.progressUpdatedAt!} : null,
    history:s.historyUpdatedAt ? {status:s.firstReportStatus,legacyMeritCredit:!!s.legacyMeritCredit,updatedAt:s.historyUpdatedAt}:null,
    active:!!s.active,categoryName:s.categoryName,masterUpdatedAt:"m",automaticReporting:!!s.automaticReporting,
    relatedQuests:s.mapRelated?[{id:10,offerMethod:"地理学",active:true,updatedAt:"q",discoveryCount:1}]:[]};
}
function setup(initial: DiscoveryStateSummary, mode = false) {
  let rows = [initial];
  const reader = {list:vi.fn(async (_profileId:number)=>rows)};
  const service = {get:vi.fn(async (p:number,_id:number)=>snapshot(rows[0]!,p)),update:vi.fn<ReportHoldDependencies["service"]["update"]>(async s=>s)};
  const changed=vi.fn();
  const dependencies={reader,service};
  function Harness() {
    const [profile,setProfile]=useState(1);
    const controller=useReportHold(profile,changed,dependencies);
    return <><button onClick={()=>setProfile(p=>p===1?2:1)}>プロフィール切替</button>
      <ReportHoldFeedback controller={controller} /><ReportHoldDialogs controller={controller} />
      {mode && <button onClick={e=>void controller.open(1,"テスト地図","history",null,e.currentTarget)}>テスト地図の報告履歴</button>}
      <DiscoveryStateControl id={1} name="テスト地図" mapId={mode?null:10} controller={controller} />
    </>;
  }
  render(<Harness />);
  return {reader,service,changed,setRows:(next:DiscoveryStateSummary[])=>{rows=next;}};
}

describe("report hold controls and snapshot workflow",()=>{
  it.each([
    [summary({discovered:0,progressUpdatedAt:null}),"undiscovered"],
    [summary(),"unreported"],
    [summary({reported:1}),"reported"],
    [summary({reportHold:1}),"unreported"],
  ])("displays the saved state and ordered standard options: %s",async(s,value)=>{
    const {reader,service}=setup(s);
    const select=await screen.findByRole("combobox",{name:"テスト地図の発見・報告状態"});
    expect(select).toHaveValue(value);
    expect(Array.from(select.querySelectorAll("option")).map(o=>[o.value,o.textContent])).toEqual([
      ["undiscovered","未発見"],["unreported","未報告"],["reported","報告済み"],
    ]);
    expect(reader.list).toHaveBeenCalledTimes(1);
    expect(service.get).not.toHaveBeenCalled();
  });

  it.each(["unreported","reported"] as const)("registers %s without overwriting an existing row",async target=>{
    const user=userEvent.setup();
    const {service}=setup(summary({discovered:0,progressUpdatedAt:null}));
    const select=await screen.findByRole("combobox");
    await user.selectOptions(select,target);
    if(target==="reported") await user.click(await screen.findByRole("button",{name:"記録を保存"}));
    await waitFor(()=>expect(service.update).toHaveBeenCalledTimes(1));
    expect(service.update).toHaveBeenCalledWith(expect.objectContaining({progress:null}),{kind:"register",state:target,selectedQuestId:10},10);
  });

  it("keeps reported selected until rediscovery is confirmed, cancels without writes and restores focus",async()=>{
    const user=userEvent.setup();const {service}=setup(summary({reported:1,firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
    const select=await screen.findByRole("combobox");
    await user.selectOptions(select,"unreported");
    expect(await screen.findByRole("dialog")).toHaveTextContent("再発見");
    expect(select).toHaveValue("reported");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(service.update).not.toHaveBeenCalled();
    await waitFor(()=>expect(select).toHaveFocus());
    await user.selectOptions(select,"unreported");
    await user.click(await screen.findByRole("button",{name:"記録を保存"}));
    await waitFor(()=>expect(service.update).toHaveBeenCalledWith(expect.anything(),{kind:"rediscover",hold:false},10));
  });

  it.each([0,1])("does not rewrite an already unreported discovery with report_hold=%s",async reportHold=>{
    const user=userEvent.setup();const t=setup(summary({reportHold}));
    await user.selectOptions(await screen.findByRole("combobox"),"unreported");
    expect(t.service.update).not.toHaveBeenCalled();expect(t.service.get).not.toHaveBeenCalled();
  });
  it("waits for persistence before displaying a report",async()=>{
    const user=userEvent.setup();const t=setup(summary({reportHold:1}));
    let finish!: (s:DiscoveryState)=>void;
    t.service.update.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const select=await screen.findByRole("combobox");
    await user.selectOptions(select,"reported");
    await user.click(await screen.findByRole("button",{name:"記録を保存"}));
    await waitFor(()=>expect(select).toBeDisabled());expect(select).toHaveValue("unreported");
    expect(t.service.update).toHaveBeenCalledWith(expect.anything(),{kind:"report"},10);
    t.setRows([summary({reported:1,progressUpdatedAt:"saved"})]);finish(snapshot(summary({reported:1})));
    await waitFor(()=>expect(select).toHaveValue("reported"));
  });

  it("explains current-data deletion and retains history unless explicitly corrected",async()=>{
    const user=userEvent.setup();const t=setup(summary({reportHold:1}));
    await user.selectOptions(await screen.findByRole("combobox"),"undiscovered");
    const dialog=await screen.findByRole("dialog");
    for(const word of ["カード所有","発見物メモ","クエスト達成","過去の報告履歴"]) expect(dialog).toHaveTextContent(word);
    await user.click(screen.getByRole("button",{name:"キャンセル"}));
    expect(t.service.update).not.toHaveBeenCalled();
  });

  it.each([0,1])("previews legacy qualification loss in the same history confirmation (map=%i)",async mapRelated=>{
    const user=userEvent.setup();const t=setup(summary({mapRelated,legacyMeritCredit:1,historyUpdatedAt:"h"}),true);
    await user.click(await screen.findByRole("button",{name:"テスト地図の報告履歴"}));
    expect(await screen.findByLabelText("初回報告履歴")).toHaveValue("");
    expect(screen.getByRole("button",{name:"記録を保存"})).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("初回報告履歴"),"not_reported");
    expect(screen.getByRole("dialog")).toHaveTextContent("旧データから引き継いだ冒険勲功値の算入資格を解除");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("過去の報告実績を取り消す");
    expect(screen.getByRole("status")).toHaveTextContent("−100");
    await user.click(screen.getByRole("button",{name:"記録を保存"}));
    await waitFor(()=>expect(t.service.update).toHaveBeenCalledWith(expect.anything(),{kind:"correctHistory",status:"not_reported",removeLegacyCredit:false,currentState:null},null));
  });

  it.each(["DiscoveryStateConflict","DatabaseError"])("reloads after %s without retrying a stale write",async kind=>{
    const user=userEvent.setup();const t=setup(summary());
    t.service.update.mockImplementation(async()=>{t.setRows([summary({reported:1})]);throw {kind};});
    await user.selectOptions(await screen.findByRole("combobox"),"reported");
    await user.click(await screen.findByRole("button",{name:"記録を保存"}));
    await waitFor(()=>expect(screen.getByRole("combobox")).toHaveValue("reported"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(t.service.update).toHaveBeenCalledTimes(1);
    expect(t.reader.list).toHaveBeenCalledTimes(2);
  });

  it("closes old-profile confirmation and ignores late old-profile snapshots",async()=>{
    const user=userEvent.setup();const t=setup(summary({reported:1}));
    const select=await screen.findByRole("combobox");
    await user.selectOptions(select,"unreported");await screen.findByRole("dialog");
    await user.click(screen.getByRole("button",{name:"プロフィール切替"}));
    await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(t.service.update).not.toHaveBeenCalled();
    let finish!: (s:DiscoveryState)=>void;
    t.service.get.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    await user.selectOptions(await screen.findByRole("combobox"),"unreported");
    await user.click(screen.getByRole("button",{name:"プロフィール切替"}));
    finish(snapshot(summary({reported:1}),2));
    await waitFor(()=>expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(t.service.update).not.toHaveBeenCalled();
  });

  it("respects automatic reporting and relic restrictions",async()=>{
    const t=setup(summary({automaticReporting:1}));
    expect(await screen.findByText("報告済み（自動）")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(t.service.update).not.toHaveBeenCalled();
    cleanup();setup(summary({categoryName:"レリック"}));
    expect(await screen.findByText("対象外")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("rejects a stale displayed summary before sending any write",async()=>{
    const user=userEvent.setup();const t=setup(summary());
    t.service.get.mockImplementation(async()=>{const latest=summary({reported:1,progressUpdatedAt:"latest"});t.setRows([latest]);return snapshot(latest);});
    await user.selectOptions(await screen.findByRole("combobox"),"reported");
    await waitFor(()=>expect(screen.getByRole("combobox")).toHaveValue("reported"));
    expect(screen.getByRole("alert")).toHaveTextContent("操作し直して");
    expect(t.service.update).not.toHaveBeenCalled();
  });

  it("ignores a late save response after a profile switch",async()=>{
    const user=userEvent.setup();const t=setup(summary());
    let finish!: (s:DiscoveryState)=>void;
    t.service.update.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    await user.selectOptions(await screen.findByRole("combobox"),"reported");
    await user.click(await screen.findByRole("button",{name:"記録を保存"}));
    await waitFor(()=>expect(t.service.update).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button",{name:"プロフィール切替"}));
    await waitFor(()=>expect(screen.getByRole("combobox")).toBeEnabled());
    finish(snapshot(summary({reportHold:1}),1));
    await waitFor(()=>expect(screen.getByRole("combobox")).toHaveValue("unreported"));
    expect(t.changed).not.toHaveBeenCalled();
    expect(screen.queryByText("状態を保存しました。")).not.toBeInTheDocument();
  });

  it.each([0,1])("requires combined correction and previews deletion (map=%i)",async mapRelated=>{
    const user=userEvent.setup();const t=setup(summary({mapRelated,reported:1,firstReportStatus:"confirmed",historyUpdatedAt:"h"}),true);
    await user.click(await screen.findByRole("button",{name:"テスト地図の報告履歴"}));
    await user.selectOptions(await screen.findByLabelText("初回報告履歴"),"not_reported");
    expect(screen.getByRole("button",{name:"記録を保存"})).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("現在進捗の同時訂正"),"undiscovered");
    expect(screen.getByRole("status")).toHaveTextContent("−100");
    expect(await screen.findByRole("dialog")).toHaveTextContent("現在進捗・カード所有・発見物メモ・維持設定を削除");
    await user.click(screen.getByRole("button",{name:"記録を保存"}));
    await waitFor(()=>expect(t.service.update).toHaveBeenCalledWith(expect.anything(),{kind:"correctHistory",status:"not_reported",removeLegacyCredit:false,currentState:"undiscovered"},null));
  });

  it.each(["not_reported","confirmed"] as const)("previews unknown experience when selecting %s for a non-map discovery", async status => {
    const t = setup(summary({mapRelated:0,experience:null,legacyMeritCredit:status === "not_reported" ? 1 : 0,historyUpdatedAt:"h"}),true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", {name:"テスト地図の報告履歴"}));
    await user.selectOptions(await screen.findByLabelText("初回報告履歴"), status);
    expect(screen.getByRole("status")).toHaveTextContent(`経験値不明の算入対象が1件${status === "confirmed" ? "増え" : "減り"}ます`);
    expect(screen.getByRole("status")).toHaveTextContent("判明分の合計は変わりません");
    expect(t.service.update).not.toHaveBeenCalled();
  });

  it.each([[0,"confirmed"],[1,"confirmed"],[0,"unknown"],[1,"unknown"]] as const)("ignores delayed history reads and writes across profile switches (map=%i, target=%s)", async (mapRelated,status) => {
    const initial=summary({mapRelated,firstReportStatus:status === "unknown" ? "not_reported" : "unknown",historyUpdatedAt:"h"});
    const t = setup(initial,true);
    const user = userEvent.setup();
    let finishRead!: (s:DiscoveryState) => void;
    t.service.get.mockImplementationOnce(() => new Promise(resolve => {finishRead=resolve;}));
    await user.dblClick(await screen.findByRole("button", {name:"テスト地図の報告履歴"}));
    expect(t.service.get).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", {name:"プロフィール切替"}));
    finishRead(snapshot(summary({mapRelated}),1));
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", {name:"テスト地図の報告履歴"}));
    await user.selectOptions(await screen.findByLabelText("初回報告履歴"), status);
    let finishSave!: (s:DiscoveryState) => void;
    t.service.update.mockImplementationOnce(() => new Promise(resolve => {finishSave=resolve;}));
    await user.dblClick(screen.getByRole("button", {name:"記録を保存"}));
    expect(t.service.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({profileId:2}),
      {kind:"correctHistory",status,removeLegacyCredit:false,currentState:null},null);
    await user.click(screen.getByRole("button", {name:"プロフィール切替"}));
    finishSave(snapshot(summary({mapRelated,firstReportStatus:status,historyUpdatedAt:"late"}),2));
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("状態を保存しました。")).not.toBeInTheDocument();
    expect(t.changed).not.toHaveBeenCalled();
  });

  it.each([["DatabaseError","confirmed"],["DiscoveryStateConflict","confirmed"],["DatabaseError","unknown"],["DiscoveryStateConflict","unknown"]] as const)("reloads a failed non-map save once and suppresses editing when reload fails: %s / %s", async (kind,status) => {
    const t = setup(summary({mapRelated:0,firstReportStatus:status === "unknown" ? "not_reported" : "unknown",historyUpdatedAt:"h"}),true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", {name:"テスト地図の報告履歴"}));
    await user.selectOptions(await screen.findByLabelText("初回報告履歴"), status);
    t.service.update.mockRejectedValueOnce({kind});
    t.reader.list.mockRejectedValueOnce(new Error("synthetic read failure"));
    await user.click(screen.getByRole("button", {name:"記録を保存"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("再取得に失敗");
    await user.click(screen.getByRole("button", {name:"テスト地図の報告履歴"}));
    expect(t.service.get).toHaveBeenCalledTimes(2);
    expect(t.reader.list).toHaveBeenCalledTimes(2);
    expect(t.service.update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    summary({mapRelated:0,active:0}), summary({mapRelated:0,automaticReporting:1}), summary({mapRelated:0,categoryName:"レリック"}),
  ])("rejects protected summary history even when called without a table control: %j", async initial => {
    const t = setup(initial,true);
    await userEvent.click(await screen.findByRole("button", {name:"テスト地図の報告履歴"}));
    expect(t.service.get).not.toHaveBeenCalled();
    expect(t.service.update).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a late pre-save snapshot after switching profiles", async () => {
    const initial=summary({mapRelated:0,firstReportStatus:"not_reported",historyUpdatedAt:"h"});
    const t=setup(initial,true);
    const user=userEvent.setup();
    await user.click(await screen.findByRole("button", {name:"テスト地図の報告履歴"}));
    await user.selectOptions(await screen.findByLabelText("初回報告履歴"), "unknown");
    let finish!: (s:DiscoveryState) => void;
    t.service.get.mockImplementationOnce(() => new Promise(resolve=>{finish=resolve;}));
    await user.dblClick(screen.getByRole("button", {name:"記録を保存"}));
    expect(t.service.get).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", {name:"プロフィール切替"}));
    finish(snapshot(initial));
    await waitFor(()=>expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(t.service.update).not.toHaveBeenCalled();
    expect(t.changed).not.toHaveBeenCalled();
  });

  it("does not send a write when the pre-save snapshot cannot be read", async () => {
    const t=setup(summary({mapRelated:0,firstReportStatus:"not_reported",historyUpdatedAt:"h"}),true);
    const user=userEvent.setup();
    await user.click(await screen.findByRole("button", {name:"テスト地図の報告履歴"}));
    await user.selectOptions(await screen.findByLabelText("初回報告履歴"), "unknown");
    t.service.get.mockRejectedValueOnce(new Error("synthetic read failure"));
    await user.click(screen.getByRole("button", {name:"記録を保存"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存を確認できませんでした");
    expect(t.reader.list).toHaveBeenCalledTimes(2);
    expect(t.service.update).not.toHaveBeenCalled();
  });

  it("preserves existing legacy credit in an unknown preview without allowing a redundant save", async () => {
    const t=setup(summary({mapRelated:0,legacyMeritCredit:1,historyUpdatedAt:"h"}),true);
    const user=userEvent.setup();
    await user.click(await screen.findByRole("button", {name:"テスト地図の報告履歴"}));
    await user.selectOptions(await screen.findByLabelText("初回報告履歴"), "unknown");
    expect(screen.getByRole("status")).toHaveTextContent("算入資格は変わりません");
    expect(screen.getByRole("button", {name:"記録を保存"})).toBeDisabled();
    expect(t.service.update).not.toHaveBeenCalled();
  });
});
