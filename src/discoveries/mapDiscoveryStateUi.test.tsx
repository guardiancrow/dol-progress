// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryTable } from "../components/discoveries/DiscoveryTable";
import { ReportHoldDialogs, ReportHoldFeedback } from "../components/discoveries/ReportHoldControls";
import { useReportHold, type ReportHoldDependencies } from "./useReportHold";
import type { DiscoveryStateSummary } from "./stateReader";
import type { DiscoveryState } from "./stateService";
import type { DiscoveryRowViewModel } from "./types";

afterEach(cleanup);
function summary(overrides:Partial<DiscoveryStateSummary>={}):DiscoveryStateSummary {
  return {id:1,active:1,categoryName:"史跡",experience:100,masterUpdatedAt:"m",discovered:1,reported:0,reportHold:0,progressUpdatedAt:"p",firstReportStatus:"unknown",legacyMeritCredit:0,historyUpdatedAt:null,automaticReporting:0,mapRelated:1,...overrides};
}
function snapshot(s:DiscoveryStateSummary,profileId=1):DiscoveryState {
  return {profileId,discoveryId:s.id,active:!!s.active,categoryName:s.categoryName,masterUpdatedAt:s.masterUpdatedAt,automaticReporting:!!s.automaticReporting,
    progress:s.discovered?{reported:!!s.reported,reportHold:!!s.reportHold,cardOwned:true,memo:"keep",updatedAt:s.progressUpdatedAt!}:null,
    history:s.historyUpdatedAt?{status:s.firstReportStatus,legacyMeritCredit:!!s.legacyMeritCredit,updatedAt:s.historyUpdatedAt}:null,
    relatedQuests:s.mapRelated?[{id:10,offerMethod:"地理学",active:true,updatedAt:"q",discoveryCount:2},{id:11,offerMethod:"考古学",active:true,updatedAt:"q",discoveryCount:1}]:[]};
}
function row(s:DiscoveryStateSummary,profile:number):DiscoveryRowViewModel {
  const p=snapshot(s,profile).progress;
  return {firstReportStatus:s.firstReportStatus,historyPresent:s.historyUpdatedAt!==null,legacyMeritCredit:!!s.legacyMeritCredit,id:s.id,name:s.id===1?"共有発見物":"通常発見物",description:null,notes:null,category:s.categoryName?{id:1,name:s.categoryName,sortOrder:1}:null,rank:null,era:null,points:1,difficulty:1,experience:s.experience,
    relatedQuests:[{id:10,title:"地図A",notes:null,offerCity:null},{id:11,title:"地図B",notes:null,offerCity:null}],mapRelated:!!s.mapRelated,mapNeedsReview:!!s.mapNeedsReview,canReport:s.categoryName!=="レリック",hasCard:s.categoryName!=="レリック",
    progress:p?{...p,profileId:profile,discoveryId:s.id}:null,automaticReporting:!!s.automaticReporting,effectiveReported:!!s.discovered && !!(s.reported||s.automaticReporting),
    status:!s.discovered?"undiscovered":s.reported||s.automaticReporting?"reported":"unreported",updating:false};
}
function setup(initial=summary()) {
  const profiles:Record<number,DiscoveryStateSummary[]>={1:[initial,summary({id:2,mapRelated:0})],2:[summary({reported:1}),summary({id:2,mapRelated:0})]};
  const dependencies:ReportHoldDependencies={reader:{list:vi.fn(async p=>profiles[p]!)},service:{get:vi.fn(async(p,id)=>snapshot(profiles[p]!.find(s=>s.id===id)!,p)),update:vi.fn(async s=>s)}};
  const handlers={onToggleDiscovered:vi.fn(async()=>undefined),onSetReported:vi.fn(async()=>undefined),onSetCardOwned:vi.fn(async()=>undefined)};
  function Harness({profile}:{profile:number}) {
    const c=useReportHold(profile,()=>undefined,dependencies);
    return <><ReportHoldFeedback controller={c}/><ReportHoldDialogs controller={c}/><DiscoveryTable reportHold={c} rows={Array.from(c.summaries.values()).map(s=>({...row(s,profile),updating:c.busy || c.dialog!==null}))} paginationResetKey={profile} {...handlers}/></>;
  }
  const view=render(<Harness profile={1}/>);
  return {dependencies,handlers,view,Harness,profiles,prepare(next:DiscoveryStateSummary) {
    vi.mocked(dependencies.service.update).mockImplementationOnce(async(s)=>{profiles[s.profileId]=profiles[s.profileId]!.map(r=>r.id===s.discoveryId?next:r);return snapshot(next,s.profileId);});
  }};
}
const select=()=>screen.getByRole("combobox",{name:"共有発見物の地図の状態"});

it.each([
  [summary({discovered:0,progressUpdatedAt:null}),"undiscovered"],
  [summary(),"unreported"], [summary({reported:1}),"reported"], [summary({reportHold:1}),"unreported"],
])("uses compact shared options only for map discoveries: %s",async(s,value)=>{
  const t=setup(s);
  const control=await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  expect(control).toHaveValue(value);
  expect(within(control).getAllByRole("option").map(o=>[o.getAttribute("value"),o.textContent])).toEqual([["undiscovered","未発見"],["unreported","未報告"],["reported","報告済み"]]);
  expect(control).toHaveClass("map-state-select");
  expect(control).toHaveAttribute("title",expect.stringContaining("状態を共有"));
  expect(screen.getAllByRole("columnheader")).toHaveLength(12);
  const header=screen.getByRole("columnheader",{name:"初回報告"});
  expect(header).toHaveAttribute("title","過去に一度でも報告したかを示します。現在の報告状態とは別の履歴です。レリックと特殊自動報告対象の履歴は訂正できません。");
  expect(header).toHaveAccessibleDescription("過去に一度でも報告したかを示します。現在の報告状態とは別の履歴です。レリックと特殊自動報告対象の履歴は訂正できません。");
  expect(screen.queryByRole("columnheader",{name:"初回報告済み"})).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox",{name:"通常発見物の報告状態"})).toBeInTheDocument();
  expect(screen.queryByRole("combobox",{name:"通常発見物の地図の状態"})).not.toBeInTheDocument();
  expect(t.dependencies.service.get).not.toHaveBeenCalled();
});

it.each(["unreported","reported"] as const)("registers %s once by discovery ID without selecting or updating multiple quests",async target=>{
  const t=setup(summary({discovered:0,progressUpdatedAt:null,mapNeedsReview:1}));
  const user=userEvent.setup();
  await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  t.prepare(summary({reported:target==="reported"?1:0}));
  await user.selectOptions(select(),target);
  if(target==="reported") await user.click(await screen.findByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(select()).toHaveValue(target));
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({discoveryId:1,progress:null}),{kind:"register",state:target,selectedQuestId:null},null);
  expect(t.handlers.onToggleDiscovered).not.toHaveBeenCalled();
  expect(t.handlers.onSetReported).not.toHaveBeenCalled();
});

it("confirms rediscovery, preserves the snapshot history/card/memo, and cancels without a write",async()=>{
  const initial=summary({reported:1,firstReportStatus:"confirmed",historyUpdatedAt:"h"});
  const t=setup(initial); const user=userEvent.setup();
  await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  await user.selectOptions(select(),"unreported");
  expect(await screen.findByRole("dialog")).toHaveTextContent("過去の報告実績は保持");
  expect(select()).toHaveValue("reported");
  await user.click(screen.getByRole("button",{name:"キャンセル"}));
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
  t.prepare({...initial,reported:0});
  await user.selectOptions(select(),"unreported");
  await user.click(await screen.findByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(select()).toHaveValue("unreported"));
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(snapshot(initial),{kind:"rediscover",hold:false},null);
});

it("reports a held discovery using the common API and refreshes existing acquisition filters",async()=>{
  const t=setup(summary({reportHold:1,legacyMeritCredit:1,historyUpdatedAt:"h"}));const user=userEvent.setup();
  await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  await user.selectOptions(select(),"unreported");
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText("地図"),"suppressed");
  t.prepare(summary({reported:1,firstReportStatus:"confirmed",historyUpdatedAt:"saved"}));
  await user.selectOptions(select(),"reported");
  await user.click(await screen.findByRole("button",{name:"記録を保存"}));
  await screen.findByText("条件に一致する発見物がありません");
  await user.selectOptions(screen.getByLabelText("地図"),"candidate");
  expect(select()).toHaveValue("reported");
  expect(within(screen.getByText("共有発見物").closest("tr")!).getByText("地図・再入手候補")).toBeInTheDocument();
  await user.selectOptions(select(),"reported");
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({discoveryId:1}),{kind:"report"},null);
});

it("confirms removal of current progress while retaining past report history",async()=>{
  const initial=summary({firstReportStatus:"confirmed",historyUpdatedAt:"h"});
  const t=setup(initial);const user=userEvent.setup();
  await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  t.prepare({...initial,discovered:0,progressUpdatedAt:null});
  await user.selectOptions(select(),"undiscovered");
  expect(await screen.findByRole("dialog")).toHaveTextContent("カード所有、発見物メモ");
  expect(screen.getByRole("dialog")).toHaveTextContent("クエスト達成と過去の報告履歴は保持");
  await user.click(screen.getByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(select()).toHaveValue("undiscovered"));
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(snapshot(initial),{kind:"removeCurrent"},null);
});

it("rejects an obsolete map relation and requests one reload instead of updating a non-map discovery",async()=>{
  const t=setup();const user=userEvent.setup();
  await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  vi.mocked(t.dependencies.service.get).mockResolvedValue({...snapshot(summary()),relatedQuests:[]});
  t.profiles[1]=[summary({mapRelated:0})];
  await user.selectOptions(select(),"reported");
  expect(await screen.findByRole("alert")).toHaveTextContent("地図との関連が変更");
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
  expect(t.dependencies.reader.list).toHaveBeenCalledTimes(2);
});

it("discards a pending old-profile snapshot without opening a confirmation in the new profile",async()=>{
  const t=setup();const user=userEvent.setup();
  await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  let resolveGet:((s:DiscoveryState)=>void)|undefined;
  vi.mocked(t.dependencies.service.get).mockImplementationOnce(()=>new Promise(resolve=>{resolveGet=resolve;}));
  await user.selectOptions(select(),"reported");
  t.view.rerender(<t.Harness profile={2}/>);
  await waitFor(()=>expect(select()).toHaveValue("reported"));
  resolveGet?.(snapshot(summary(),1));
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it.each(["DiscoveryStateConflict","DatabaseError"])("reloads once after %s without duplicating the update",async kind=>{
  const t=setup();const user=userEvent.setup();
  await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  vi.mocked(t.dependencies.service.update).mockImplementationOnce(async()=>{t.profiles[1]=[summary({reported:1})];throw {kind};});
  await user.selectOptions(select(),"reported");
  await user.click(await screen.findByRole("button",{name:"記録を保存"}));
  expect(await screen.findByRole("alert")).toHaveTextContent(kind==="DiscoveryStateConflict"?"状態が変更されています":"保存を確認できませんでした");
  await waitFor(()=>expect(select()).toHaveValue("reported"));
  expect(t.dependencies.service.update).toHaveBeenCalledTimes(1);
  expect(t.dependencies.reader.list).toHaveBeenCalledTimes(2);
});

it.each([summary({automaticReporting:1}),summary({categoryName:"レリック"})])("does not offer manual map changes for a protected discovery: %s",async initial=>{
  const t=setup(initial);
  await screen.findByText("共有発見物");
  expect(screen.queryByRole("combobox",{name:"共有発見物の地図の状態"})).not.toBeInTheDocument();
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it.each([
  ["confirmed", "✓"],
  ["not_reported", "—"],
  ["unknown", "不明"],
] as const)("displays editable history %s for map and ordinary discoveries",async(status,text)=>{
  setup(summary({discovered:0,progressUpdatedAt:null,firstReportStatus:status,historyUpdatedAt:"h"}));
  const cell=await screen.findByRole(status==="unknown"?"button":"checkbox",{name:status==="unknown"?"共有発見物の初回報告を確認":"共有発見物の初回報告"});
  if(status==="unknown") expect(cell).toHaveTextContent(text);
  else expect(cell).toHaveProperty("checked",status==="confirmed");
  expect(cell).toHaveAttribute("title",expect.stringContaining(status==="unknown"?"未確認":status==="confirmed"?"確認済み":"未完了"));
  expect(screen.getByRole("button",{name:"通常発見物の初回報告を確認"})).toBeEnabled();
});
it("refreshes confirmed history after reporting and retains it after progress removal",async()=>{
  const t=setup();
  await screen.findByRole("combobox",{name:"共有発見物の地図の状態"});
  t.prepare(summary({reported:1,firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  await userEvent.selectOptions(select(),"reported");
  await userEvent.click(await screen.findByRole("button",{name:"記録を保存"}));
  expect(await screen.findByRole("checkbox",{name:"共有発見物の初回報告"})).toBeChecked();
  t.prepare(summary({discovered:0,progressUpdatedAt:null,firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  await userEvent.selectOptions(select(),"undiscovered");
  await userEvent.click(await screen.findByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(select()).toHaveValue("undiscovered"));
  expect(screen.getByRole("checkbox",{name:"共有発見物の初回報告"})).toBeChecked();
});

it("does not retain confirmed history when switching profiles",async()=>{
  const t=setup(summary({firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  await screen.findByRole("checkbox",{name:"共有発見物の初回報告"});
  t.profiles[2]=[summary({reported:0})];
  t.view.rerender(<t.Harness profile={2}/>);
  expect(screen.queryByRole("checkbox",{name:"共有発見物の初回報告"})).not.toBeInTheDocument();
  expect(await screen.findByRole("button",{name:"共有発見物の初回報告を確認"})).toHaveTextContent("不明");
});

it.each([0,1])("uses the same current-report fallback for mapRelated=%i",async(mapRelated)=>{
  setup(summary({mapRelated,reported:1}));
  await screen.findByText("共有発見物");
  const cell=screen.queryByRole("checkbox",{name:"共有発見物の初回報告"});
  expect(cell).toBeChecked();
  expect(cell).toHaveAttribute("title",expect.stringContaining("保存値は変更していません"));
});
it("places the map filter last without reordering the others",async()=>{
  setup();
  await screen.findByText("共有発見物");
  const filters=document.querySelector(".discovery-filters")!;
  expect(Array.from(filters.children).map(e=>e.firstChild?.textContent)).toEqual(["発見物名を検索","分類","状態","未報告の内訳","カード所有","地図"]);
  expect(within(screen.getByRole("combobox",{name:"地図"})).getAllByRole("option").map(o=>o.getAttribute("value"))).toEqual(["all","related","unrelated","suppressed","candidate","review"]);
});

it.each([0,1])("exposes contradictory history for mapRelated=%i without writes",async mapRelated=>{
  const t=setup(summary({mapRelated,reported:1,firstReportStatus:"not_reported",historyUpdatedAt:"h"}));
  await screen.findByText("共有発見物");
  expect(screen.getByRole("button",{name:"共有発見物の初回報告を確認"})).toHaveTextContent("要確認");
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

const historyCheckbox=()=>screen.getByRole("checkbox",{name:"共有発見物の初回報告"});

it("confirms cancellation of a past-report retraction without changing the checkbox or data",async()=>{
  const t=setup(summary({firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  await userEvent.click(await screen.findByRole("checkbox",{name:"共有発見物の初回報告"}));
  const form=await screen.findByRole("dialog",{name:"共有発見物の初回報告履歴の訂正"});
  expect(form).toHaveTextContent("初回報告を「報告前」へ訂正");
  expect(historyCheckbox()).toBeChecked();
  expect(form).toHaveTextContent("再発見後も初回報告済みなら、チェックは外さず現在状態だけ未報告");
  expect(form).toHaveTextContent("−100");
  expect(await screen.findByRole("dialog")).toHaveTextContent("初回報告を「報告前」へ訂正");
  await userEvent.click(screen.getByRole("button",{name:"キャンセル"}));
  expect(historyCheckbox()).toBeChecked();
  expect(historyCheckbox()).toHaveFocus();
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it.each([
  ["confirmed","not_reported",false],
  ["not_reported","confirmed",true],
] as const)("saves explicit %s to %s correction through the shared API",async(before,after,checked)=>{
  const t=setup(summary({firstReportStatus:before,historyUpdatedAt:"h"}));
  await userEvent.click(await screen.findByRole("checkbox",{name:"共有発見物の初回報告"}));
  await screen.findByRole("dialog");
  t.prepare(summary({firstReportStatus:after,historyUpdatedAt:"new"}));
  await userEvent.click(screen.getByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(historyCheckbox()).toHaveProperty("checked",checked));
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({profileId:1,discoveryId:1}),
    {kind:"correctHistory",status:after,removeLegacyCredit:false,currentState:null},null);
  expect(t.handlers.onSetReported).not.toHaveBeenCalled();
  expect(select()).toHaveValue("unreported");
});

it.each(["confirmed","not_reported"] as const)("allows explicit unknown to %s without inferring missing history",async status=>{
  const t=setup(summary({discovered:0,progressUpdatedAt:null}));
  await userEvent.click(await screen.findByRole("button",{name:"共有発見物の初回報告を確認"}));
  expect(await screen.findByLabelText("初回報告履歴")).toHaveValue("");
  expect(screen.getByRole("button",{name:"記録を保存"})).toBeDisabled();
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText("初回報告履歴"),status);
  t.prepare(summary({discovered:0,progressUpdatedAt:null,firstReportStatus:status,historyUpdatedAt:"h"}));
  await userEvent.click(screen.getByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(historyCheckbox()).toHaveProperty("checked",status==="confirmed"));
  expect(select()).toHaveValue("undiscovered");
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({progress:null}),{kind:"correctHistory",status,removeLegacyCredit:false,currentState:null},null);
});

it("requires a combined correction when current reported state contradicts not_reported",async()=>{
  const t=setup(summary({reported:1,firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  await userEvent.click(await screen.findByRole("checkbox",{name:"共有発見物の初回報告"}));
  await screen.findByRole("dialog");
  expect(screen.getByRole("button",{name:"記録を保存"})).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("現在報告済みのまま初回報告前にはできません");
  await userEvent.selectOptions(screen.getByLabelText("現在進捗の同時訂正"),"unreported");
  t.prepare(summary({reported:0,firstReportStatus:"not_reported",historyUpdatedAt:"new"}));
  expect(screen.getByRole("dialog")).toHaveTextContent("カード所有・メモ・クエスト達成は保持");
  await userEvent.click(screen.getByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(historyCheckbox()).not.toBeChecked());
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(expect.anything(),
    {kind:"correctHistory",status:"not_reported",removeLegacyCredit:false,currentState:"unreported"},null);
  expect(select()).toHaveValue("unreported");
});

it.each(["DatabaseError","DiscoveryStateConflict"])("recovers an explicit history correction after %s without retrying",async kind=>{
  const t=setup(summary({firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  vi.mocked(t.dependencies.service.update).mockRejectedValueOnce({kind});
  await userEvent.click(await screen.findByRole("checkbox",{name:"共有発見物の初回報告"}));
  await screen.findByRole("dialog");
  await userEvent.click(screen.getByRole("button",{name:"記録を保存"}));
  await screen.findByRole("alert");
  await waitFor(()=>expect(historyCheckbox()).toBeEnabled());
  expect(historyCheckbox()).toBeChecked();
  expect(t.dependencies.reader.list).toHaveBeenCalledTimes(2);
  expect(t.dependencies.service.update).toHaveBeenCalledTimes(1);
});

it("closes a history edit on profile change and does not apply it to the new profile",async()=>{
  const t=setup(summary({firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  await userEvent.click(await screen.findByRole("checkbox",{name:"共有発見物の初回報告"}));
  await screen.findByRole("dialog");
  t.profiles[2]=[summary({reported:0})];
  t.view.rerender(<t.Harness profile={2}/>);
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByRole("button",{name:"共有発見物の初回報告を確認"})).toHaveTextContent("不明");
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it("keeps automatic report history independent and relic history inapplicable",async()=>{
  setup(summary({automaticReporting:1}));
  await screen.findByText("共有発見物");
  expect(screen.queryByRole("img",{name:"共有発見物：初回報告履歴は不明"})).not.toBeInTheDocument();
  expect(screen.getAllByLabelText("初回報告履歴の訂正対象外")[0]).toHaveTextContent("—");
  expect(screen.queryByRole("button",{name:"共有発見物の初回報告を確認"})).not.toBeInTheDocument();
  cleanup();
  setup(summary({categoryName:"レリック"}));
  await screen.findByText("共有発見物");
  expect(screen.getAllByLabelText("初回報告履歴の訂正対象外")[0]).toHaveTextContent("—");
  expect(screen.queryByRole("checkbox",{name:"共有発見物の初回報告"})).not.toBeInTheDocument();
});

it.each([
  summary({mapRelated:0,automaticReporting:1}),
  summary({categoryName:"レリック"}),
])("offers no first-report controls for protected discoveries: %s",async initial=>{
  const t=setup(initial);
  await screen.findByText("共有発見物");
  const tableRow=screen.getByText("共有発見物").closest("tr")!;
  expect(tableRow.querySelector('[data-column="firstReport"]')).toHaveTextContent("—");
  expect(within(tableRow).queryByRole("checkbox",{name:"共有発見物の初回報告"})).not.toBeInTheDocument();
  expect(within(tableRow).queryByRole("button",{name:"共有発見物の初回報告を確認"})).not.toBeInTheDocument();
  expect(t.dependencies.service.get).not.toHaveBeenCalled();
});

it("rejects a stale map relationship before opening the history confirmation",async()=>{
  const t=setup(summary({firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  vi.mocked(t.dependencies.service.get).mockImplementationOnce(async(p)=>{
    t.profiles[p]=[summary({mapRelated:0,firstReportStatus:"confirmed",historyUpdatedAt:"h"})];
    return {...snapshot(t.profiles[p]![0]!,p),relatedQuests:[]};
  });
  await userEvent.click(await screen.findByRole("checkbox",{name:"共有発見物の初回報告"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("地図との関連が変更");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it("keeps current unreported hold state while correcting only first-report history",async()=>{
  const t=setup(summary({reportHold:1,firstReportStatus:"confirmed",historyUpdatedAt:"h"}));
  await userEvent.click(await screen.findByRole("checkbox",{name:"共有発見物の初回報告"}));
  await screen.findByRole("dialog");
  t.prepare(summary({reportHold:1,firstReportStatus:"not_reported",historyUpdatedAt:"new"}));
  await userEvent.click(screen.getByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(historyCheckbox()).not.toBeChecked());
  expect(select()).toHaveValue("unreported");
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({progress:expect.objectContaining({reported:false,reportHold:true})}),
    {kind:"correctHistory",status:"not_reported",removeLegacyCredit:false,currentState:null},null);
});

it.each(["not_reported", "confirmed"] as const)("saves unconfirmed non-map weather history as %s only after explicit selection", async status => {
  const t = setup(summary({mapRelated:0,categoryName:"気象・現象"}));
  const user = userEvent.setup();
  await screen.findByText("共有発見物");
  await user.type(screen.getByLabelText("発見物名を検索"), "共有発見物");
  await user.selectOptions(screen.getByLabelText("地図"), "unrelated");
  await user.selectOptions(screen.getByLabelText("未報告の内訳"), "unknown");
  const button = screen.getByRole("button", {name:"共有発見物の初回報告を確認"});
  button.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByLabelText("初回報告履歴")).toHaveValue("");
  expect(screen.getByRole("button", {name:"記録を保存"})).toBeDisabled();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(button).toHaveFocus());
  await user.keyboard(" ");
  await user.selectOptions(await screen.findByLabelText("初回報告履歴"), status);
  if (status === "not_reported") {
    expect(screen.getByRole("dialog")).toHaveTextContent("初回報告をまだ行っていないことを記録します。");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("過去の報告実績を取り消す");
  }
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
  t.prepare(summary({mapRelated:0,categoryName:"気象・現象",firstReportStatus:status,historyUpdatedAt:"new"}));
  await user.click(screen.getByRole("button", {name:"記録を保存"}));
  await screen.findByText("条件に一致する発見物がありません");
  await user.selectOptions(screen.getByLabelText("未報告の内訳"), status);
  expect(await screen.findByRole("checkbox", {name:"共有発見物の初回報告"})).toHaveProperty("checked", status === "confirmed");
  expect(screen.getByRole("checkbox", {name:"共有発見物の報告状態"})).not.toBeChecked();
  expect(screen.getByRole("checkbox", {name:"共有発見物のカード所有状態"})).toBeChecked();
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({relatedQuests:[],progress:expect.objectContaining({reported:false,memo:"keep"})}),
    {kind:"correctHistory",status,removeLegacyCredit:false,currentState:null},null);
  for (const handler of Object.values(t.handlers)) expect(handler).not.toHaveBeenCalled();
});

it.each([0,1])("requires an unselected choice for unknown history even with the current-report fallback (map=%i)", async mapRelated => {
  const t = setup(summary({mapRelated,reported:1}));
  const user = userEvent.setup();
  const checkbox = await screen.findByRole("checkbox", {name:"共有発見物の初回報告"});
  expect(checkbox).toBeChecked();
  await user.click(checkbox);
  expect(await screen.findByLabelText("初回報告履歴")).toHaveValue("");
  expect(screen.getByRole("button", {name:"記録を保存"})).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("初回報告履歴"), "not_reported");
  expect(screen.getByRole("button", {name:"記録を保存"})).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("現在進捗の同時訂正"), "unreported");
  t.prepare(summary({mapRelated,reported:0,firstReportStatus:"not_reported",historyUpdatedAt:"new"}));
  await user.click(screen.getByRole("button", {name:"記録を保存"}));
  await waitFor(() => expect(historyCheckbox()).not.toBeChecked());
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(expect.anything(),
    {kind:"correctHistory",status:"not_reported",removeLegacyCredit:false,currentState:"unreported"},null);
  await waitFor(() => expect(historyCheckbox()).toHaveFocus());
});

it.each([
  {active:false}, {automaticReporting:true}, {categoryName:"レリック"},
  {profileId:2}, {discoveryId:2}, {masterUpdatedAt:"changed"},
] as const)("rejects an ineligible or mismatched non-map snapshot before showing a form: %j", async change => {
  const t = setup(summary({mapRelated:0}));
  vi.mocked(t.dependencies.service.get).mockResolvedValueOnce({...snapshot(summary({mapRelated:0})),...change});
  await userEvent.click(await screen.findByRole("button", {name:"共有発見物の初回報告を確認"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("一覧の状態が変更");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(t.dependencies.reader.list).toHaveBeenCalledTimes(2);
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it("rejects a newly added map relation until the non-map summary is refreshed", async () => {
  const t = setup(summary({mapRelated:0}));
  vi.mocked(t.dependencies.service.get).mockResolvedValueOnce(snapshot(summary()));
  await userEvent.click(await screen.findByRole("button", {name:"共有発見物の初回報告を確認"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("地図との関連が変更");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it("disables history editing for inactive discoveries", async () => {
  const t = setup(summary({mapRelated:0,active:0}));
  const button = await screen.findByRole("button", {name:"共有発見物の初回報告を確認"});
  expect(button).toBeDisabled();
  await userEvent.click(button);
  expect(t.dependencies.service.get).not.toHaveBeenCalled();
});

it.each(["not_reported","confirmed"] as const)("restores focus when a non-map confirmation button becomes a %s checkbox", async status => {
  const t = setup(summary({mapRelated:0}));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", {name:"共有発見物の初回報告を確認"}));
  await user.selectOptions(await screen.findByLabelText("初回報告履歴"), status);
  t.prepare(summary({mapRelated:0,firstReportStatus:status,historyUpdatedAt:"saved"}));
  await user.click(screen.getByRole("button", {name:"記録を保存"}));
  await waitFor(() => expect(historyCheckbox()).toHaveFocus());
  await user.keyboard(" ");
  expect(await screen.findByRole("dialog")).toHaveTextContent(status === "confirmed" ? "過去の報告実績を取り消す訂正" : "初回報告を「報告済み」へ訂正");
  expect(historyCheckbox()).toHaveProperty("checked",status === "confirmed");
  await user.click(screen.getByRole("button", {name:"キャンセル"}));
  await waitFor(() => expect(historyCheckbox()).toHaveFocus());
  expect(t.dependencies.service.update).toHaveBeenCalledTimes(1);
});

const resetCases = [0,1].flatMap(mapRelated => [0,1].flatMap(discovered =>
  (["not_reported","confirmed"] as const).flatMap(firstReportStatus => [100,null].map(experience =>
    ({mapRelated,discovered,firstReportStatus,experience})))));

it.each(resetCases)("explicitly resets safe map/non-map history without changing current progress: %j", async initial => {
  const s = summary({...initial,progressUpdatedAt:initial.discovered ? "p" : null,historyUpdatedAt:"h",categoryName:"気象・現象"});
  const before = snapshot(s).progress;
  const t = setup(s);
  const user = userEvent.setup();
  const checkbox = await screen.findByRole("checkbox", {name:"共有発見物の初回報告"});
  checkbox.focus();
  await user.keyboard(" ");
  const choice = await screen.findByLabelText("初回報告履歴");
  expect(choice).toHaveValue(initial.firstReportStatus === "confirmed" ? "not_reported" : "confirmed");
  expect(within(choice).getAllByRole("option").map(o=>o.getAttribute("value"))).toEqual(["","unknown","not_reported","confirmed"]);
  await user.selectOptions(choice, initial.firstReportStatus);
  expect(screen.getByRole("button", {name:"記録を保存"})).toBeDisabled();
  await user.selectOptions(choice, "unknown");
  expect(screen.getByRole("dialog")).toHaveTextContent("確認結果を撤回し、不明に戻します");
  expect(screen.getByRole("dialog")).toHaveTextContent("現在の発見進捗・カード所有・メモ・クエスト達成は変更しません");
  const impact = screen.getByRole("status");
  if (initial.firstReportStatus === "not_reported") expect(impact).toHaveTextContent("算入資格は変わりません");
  else expect(impact).toHaveTextContent(initial.experience === null ? "経験値不明の算入対象が1件減り" : "−100");
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
  t.prepare({...s,firstReportStatus:"unknown",historyUpdatedAt:"reset"});
  await user.click(screen.getByRole("button", {name:"記録を保存"}));
  const button = await screen.findByRole("button", {name:"共有発見物の初回報告を確認"});
  expect(button).toHaveTextContent("不明");
  await waitFor(()=>expect(button).toHaveFocus());
  expect(snapshot(t.profiles[1]![0]!).progress).toEqual(before);
  expect(t.profiles[1]![0]).toMatchObject({historyUpdatedAt:"reset",legacyMeritCredit:0});
  expect(t.dependencies.service.get).toHaveBeenCalledTimes(2);
  expect(t.dependencies.service.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({history:expect.objectContaining({status:initial.firstReportStatus})}),
    {kind:"correctHistory",status:"unknown",removeLegacyCredit:false,currentState:null},null);
  for (const handler of Object.values(t.handlers)) expect(handler).not.toHaveBeenCalled();
});

it.each(["confirmed","not_reported","unknown"] as const)("blocks unknown while currently reported, including saved %s", async firstReportStatus => {
  const t = setup(summary({mapRelated:0,reported:1,firstReportStatus,historyUpdatedAt:"h"}));
  const user = userEvent.setup();
  await screen.findByText("共有発見物");
  const trigger = screen.getByRole(firstReportStatus === "not_reported" ? "button" : "checkbox",
    {name:firstReportStatus === "not_reported" ? "共有発見物の初回報告を確認" : "共有発見物の初回報告"});
  await user.click(trigger);
  await user.selectOptions(await screen.findByLabelText("初回報告履歴"), "not_reported");
  await user.selectOptions(screen.getByLabelText("現在進捗の同時訂正"), "unreported");
  await user.selectOptions(screen.getByLabelText("初回報告履歴"), "unknown");
  expect(screen.getByRole("alert")).toHaveTextContent("現在報告済みのまま履歴を不明には戻せません");
  expect(screen.queryByLabelText("現在進捗の同時訂正")).not.toBeInTheDocument();
  expect(screen.getByRole("button", {name:"記録を保存"})).toBeDisabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it.each([null,"explicit"])("treats absent and explicit unknown history as the same selection: %s", async historyUpdatedAt => {
  const t = setup(summary({mapRelated:0,historyUpdatedAt}));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", {name:"共有発見物の初回報告を確認"}));
  await user.selectOptions(await screen.findByLabelText("初回報告履歴"), "unknown");
  expect(screen.getByRole("button", {name:"記録を保存"})).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
});

it.each([
  {active:false}, {automaticReporting:true}, {categoryName:"レリック"}, {profileId:2},
  {progress:{reported:true,reportHold:false,cardOwned:true,memo:"keep",updatedAt:"p"}},
  {progress:{reported:false,reportHold:false,cardOwned:false,memo:"changed",updatedAt:"p"}},
  {history:{status:"confirmed" as const,legacyMeritCredit:false,updatedAt:"h"}},
  {relatedQuests:[{id:20,active:true,offerMethod:"地理学",updatedAt:"q",discoveryCount:1}]},
])("rejects a changed snapshot immediately before saving unknown: %j", async change => {
  const initial=summary({mapRelated:0,firstReportStatus:"not_reported",historyUpdatedAt:"h"});
  const t=setup(initial);
  const user=userEvent.setup();
  await user.click(await screen.findByRole("checkbox", {name:"共有発見物の初回報告"}));
  await user.selectOptions(await screen.findByLabelText("初回報告履歴"), "unknown");
  vi.mocked(t.dependencies.service.get).mockResolvedValueOnce({...snapshot(initial),...change});
  await user.click(screen.getByRole("button", {name:"記録を保存"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("状態が変更されています");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(t.dependencies.service.update).not.toHaveBeenCalled();
  expect(t.dependencies.reader.list).toHaveBeenCalledTimes(2);
});
