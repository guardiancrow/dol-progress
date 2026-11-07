// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportHoldDialogs } from "../components/discoveries/ReportHoldControls";
import { QuestTable } from "../components/quests/QuestTable";
import type { QuestRowViewModel } from "./types";
import { useReportHold } from "../discoveries/useReportHold";
import type { DiscoveryStateSummary } from "../discoveries/stateReader";
import type { DiscoveryState } from "../discoveries/stateService";

afterEach(cleanup);
const states:DiscoveryStateSummary[] = [1,2].map(id=>({id,active:1,categoryName:"史跡",experience:100,masterUpdatedAt:"m",discovered:1,reported:0,reportHold:id===2?1:0,progressUpdatedAt:"p",firstReportStatus:"unknown",legacyMeritCredit:0,historyUpdatedAt:null,automaticReporting:0}));
function row(id:number,title:string,related:number[],method="地理学"):QuestRowViewModel {
  return {id,title,offerMethod:method,offerCity:null,offerCities:[],notes:null,difficulty:1,requiredSkills:null,requiredSkillNames:[],requiredSkillsNormalized:[],
    discoveries:related.map(id=>({id,name:`発見${id}`,description:null,notes:null,categoryId:1,categoryName:"史跡",categorySortOrder:1})),completed:id===2,updating:false,prerequisiteStatus:"NONE",directPrerequisites:[]};
}
it("filters map states alongside existing filters and keeps multi-related maps as individual controls",async()=>{
  const reader={list:vi.fn(async()=>states)};
  const service={get:vi.fn<()=>Promise<DiscoveryState>>(),update:vi.fn<()=>Promise<DiscoveryState>>()};
  const deps={reader,service};
  const update=vi.fn(async()=>undefined);
  function Harness(){const controller=useReportHold(1,()=>undefined,deps);return <QuestTable reportHold={controller} rows={[row(1,"通常未報告地図",[1]),row(2,"維持中地図",[2]),row(3,"通常依頼",[1],"冒険クエスト"),row(4,"関連なし地図",[]),row(5,"混在地図",[1,2])]} paginationResetKey={1} onToggleCompletion={update} />;}
  const user=userEvent.setup();render(<Harness/>);
  expect(await screen.findByRole("combobox",{name:"維持中地図の発見・報告状態"})).toHaveValue("unreported");
  expect(screen.getByRole("columnheader",{name:"地図の状態"})).toBeInTheDocument();
  const normal=screen.getByText("通常依頼").closest("tr")!;
  expect(normal.querySelector('[data-column="mapState"]')).toHaveTextContent(/^—$/);
  expect(within(normal).getByLabelText("地図の状態の操作はありません")).toHaveTextContent("—");
  expect(normal.querySelector('[data-column="mapState"] select, [data-column="mapState"] button')).toBeNull();
  expect(screen.getByText("関連なし地図").closest("tr")!.querySelector('[data-column="mapState"]')).toHaveTextContent("要確認");
  expect(document.querySelector('th[data-column="completed"]')).toHaveTextContent(/^達成(?:\s|$)/);
  expect(Array.from(screen.getByLabelText("地図の入手").querySelectorAll("option")).map(o=>[o.value,o.textContent])).toEqual([
    ["all","すべて"],["candidate","入手候補"],["suppressed","入手抑止"],
  ]);
  const menus=Array.from(document.querySelectorAll('.quest-filters select'));
  expect(menus[menus.length-1]).toBe(screen.getByLabelText("地図の入手"));
  expect(menus[menus.length-2]).toBe(screen.getByLabelText("発見物"));
  expect(screen.queryByRole("combobox",{name:"関連なし地図の発見・報告状態"})).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox",{name:"通常依頼の発見・報告状態"})).not.toBeInTheDocument();
  const mixed=screen.getByRole("button",{name:"混在地図の関連発見物を確認"});
  expect(within(mixed.closest("tr")!).queryByRole("combobox",{name:"混在地図の発見・報告状態"})).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("地図の入手"),"suppressed");
  expect(screen.getByText("通常未報告地図")).toBeInTheDocument();
  expect(screen.getByText("維持中地図")).toBeInTheDocument();
  await user.type(screen.getByLabelText("クエスト名／地図名を検索"),"維持中");
  await user.selectOptions(screen.getByLabelText("達成状態"),"incomplete");
  expect(screen.getByText("条件に一致するクエストがありません")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("クエスト名／地図名を検索"));
  await user.selectOptions(screen.getByLabelText("達成状態"),"all");
  await user.selectOptions(screen.getByLabelText("地図の入手"),"all");
  expect(screen.getByText("関連なし地図")).toBeInTheDocument();
  expect(screen.getByText("通常依頼")).toBeInTheDocument();
  expect(reader.list).toHaveBeenCalledTimes(1);
  expect(service.get).not.toHaveBeenCalled();
});

it("opens mixed relationships outside table rows instead of expanding stacked controls",async()=>{
  const dependencies={reader:{list:vi.fn(async()=>[states[0]!,{...states[1]!,reported:1,reportHold:0}])},service:{get:vi.fn<()=>Promise<DiscoveryState>>(),update:vi.fn<()=>Promise<DiscoveryState>>()}};
  function Harness(){const c=useReportHold(1,()=>undefined,dependencies);return <><ReportHoldDialogs controller={c}/><QuestTable reportHold={c} rows={[row(5,"複数関連地図",[1,2])]} paginationResetKey={1} onToggleCompletion={vi.fn(async()=>undefined)}/></>;}
  const user=userEvent.setup();render(<Harness/>);
  const button=await screen.findByRole("button",{name:"複数関連地図の関連発見物を確認"});
  expect(button).toHaveTextContent("状態混在");
  expect(within(button.closest("tr")!).queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:/報告履歴/})).not.toBeInTheDocument();
  await user.click(button);
  const dialog=await screen.findByRole("dialog");
  expect(dialog.closest("tr")).toBeNull();
  expect(within(dialog).getAllByRole("combobox")).toHaveLength(2);
  await user.click(within(dialog).getByRole("button",{name:"閉じる"}));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(dependencies.service.update).not.toHaveBeenCalled();
});

it("combines acquisition with city and discovery filters and refreshes after profile and report changes",async()=>{
  const user=userEvent.setup();
  const profiles:Record<number,DiscoveryStateSummary[]>={
    1:[{...states[0]!,discovered:0,progressUpdatedAt:null},states[1]!,{...states[0]!,id:3,reported:1}],
    2:[states[0]!,states[1]!,{...states[0]!,id:3}],
  };
  const snapshot=(profileId:number,id:number):DiscoveryState=>{
    const s=profiles[profileId]!.find(s=>s.id===id)!;
    return {profileId,discoveryId:id,active:true,categoryName:s.categoryName,masterUpdatedAt:s.masterUpdatedAt,automaticReporting:false,relatedQuests:[],
      progress:s.discovered?{reported:!!s.reported,reportHold:!!s.reportHold,cardOwned:true,memo:null,updatedAt:s.progressUpdatedAt!}:null,
      history:s.historyUpdatedAt?{status:s.firstReportStatus,legacyMeritCredit:!!s.legacyMeritCredit,updatedAt:s.historyUpdatedAt}:null};
  };
  const deps={reader:{list:vi.fn(async(profile:number)=>profiles[profile]!)},service:{
    get:vi.fn(async(profile:number,id:number)=>snapshot(profile,id)),
    update:vi.fn(async(s:DiscoveryState)=>{
      profiles[s.profileId]=profiles[s.profileId]!.map(r=>r.id===s.discoveryId?{...r,reported:1,reportHold:0,firstReportStatus:"confirmed",historyUpdatedAt:"saved",progressUpdatedAt:"saved"}:r);
      return snapshot(s.profileId,s.discoveryId);
    }),
  }};
  const base=[row(1,"地図A",[1]),row(2,"地図B",[2]),row(3,"地図C",[3]),row(4,"関連なし",[]),row(5,"複数関連",[1,2]),row(6,"通常",[1],"冒険クエスト")];
  function Harness({profile}:{profile:number}) {
    const c=useReportHold(profile,()=>undefined,deps);
    return <><ReportHoldDialogs controller={c}/><QuestTable reportHold={c} rows={base.map(r=>({...r,offerCities:[r.id===2?"セビリア":"ロンドン"]}))} paginationResetKey={profile} onToggleCompletion={vi.fn(async()=>undefined)}/></>;
  }
  const view=render(<Harness profile={1}/>);
  await screen.findByRole("combobox",{name:"地図Aの発見・報告状態"});
  const titles=()=>Array.from(document.querySelectorAll('tbody tr td[data-column="title"] .quest-title')).map(e=>e.textContent);
  await user.selectOptions(screen.getByLabelText("地図の入手"),"candidate");
  expect(titles()).toEqual(["地図A","地図C"]);
  await user.selectOptions(screen.getByLabelText("オファー都市"),"ロンドン");
  await user.selectOptions(screen.getByLabelText("発見物"),"has-any");
  await user.selectOptions(screen.getByLabelText("地図の入手"),"all");
  expect(screen.getByLabelText("オファー都市")).toHaveValue("ロンドン");
  expect(screen.getByLabelText("発見物")).toHaveValue("has-any");
  expect(titles()).toEqual(["地図A","地図C","複数関連","通常"]);
  await user.selectOptions(screen.getByLabelText("地図の入手"),"suppressed");
  expect(screen.getByText("条件に一致するクエストがありません")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("オファー都市"),"");
  expect(titles()).toEqual(["地図B"]);
  await user.selectOptions(screen.getByLabelText("地図の入手"),"candidate");
  view.rerender(<Harness profile={2}/>);
  await waitFor(()=>expect(deps.reader.list).toHaveBeenCalledWith(2));
  await waitFor(()=>expect(screen.getByText("条件に一致するクエストがありません")).toBeInTheDocument());
  await user.selectOptions(screen.getByLabelText("地図の入手"),"suppressed");
  expect(titles()).toEqual(["地図A","地図B","地図C"]);
  await user.selectOptions(screen.getByRole("combobox",{name:"地図Aの発見・報告状態"}),"reported");
  await user.click(await screen.findByRole("button",{name:"記録を保存"}));
  await waitFor(()=>expect(titles()).toEqual(["地図B","地図C"]));
  await user.selectOptions(screen.getByLabelText("地図の入手"),"candidate");
  expect(titles()).toEqual(["地図A"]);
  expect(deps.service.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({profileId:2,discoveryId:1}),{kind:"report"},1);
});
