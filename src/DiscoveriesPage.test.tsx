// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  DiscoveryProgress,
  DiscoveryWithRelations,
  Profile,
} from "./domain/models";
import type {
  DiscoveryProgressRepositoryPort,
  DiscoveryRepositoryPort,
} from "./discoveries/types";
import type { ProfileRepositoryPort } from "./profiles/ProfileContext";
import type { MasterDataStatusRepositoryPort } from "./masterData/types";
import type { UpdateProfileInput } from "./repositories/profileRepository";
import type { ProgressLinkServicePort } from "./progressLink";
import type { ProgressStats, DiscoveryCategoryProgressStats } from "./overview/types";
import { DiscoveryStateService, type DiscoveryState } from "./discoveries/stateService";
import { discoveryStateReader, type DiscoveryStateSummary } from "./discoveries/stateReader";
import { mockWorkspaceMedia } from "./components/layout/responsiveTestMedia";

vi.mock("./discoveries/stateReader", async (importOriginal) => ({...await importOriginal<typeof import("./discoveries/stateReader")>(),discoveryStateReader: {list: vi.fn().mockResolvedValue([])}}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(discoveryStateReader.list).mockReset().mockResolvedValue([]);
});

describe("Discovery UI", () => {
  it.each(["not_reported", "confirmed"] as const)("registers weather, confirms %s, removes progress and withdraws history with overview updates", async status => {
    const resize = mockWorkspaceMedia(1920, 1080);
    const category = {id:1,name:"気象・現象",sortOrder:10};
    const storage = new Map<number,DiscoveryProgress[]>();
    const repositories = setup([profile(1)], [discovery(1,"合成の気象",{category,experience:100})],storage);
    const saved = progress(1,1);
    let current = historySummary(1,"unknown",{categoryName:category.name,experience:100,discovered:0,progressUpdatedAt:null,historyUpdatedAt:null});
    vi.mocked(discoveryStateReader.list).mockImplementation(async()=>[current]);
    const stats = categoryStats([category]);
    stats.discoveries={total:1,discovered:0,undiscovered:1,unreported:0,reported:0,cardOwned:0,cardCapableDiscovered:0,
      unreportedBreakdown:{notReported:0,confirmed:0,unknown:0}};
    stats.adventureMerit={knownMerit:0,reportedCount:0,knownExperienceCount:0,unknownExperienceCount:0};
    repositories.link.discoverWithLinkedQuest.mockImplementation(async(p,id,selectedQuestId)=>{
      await repositories.progress.markDiscovered(p,id);
      current={...current,discovered:1,progressUpdatedAt:saved.updatedAt};
      return {discoveryCreated:true,questCompleted:false,questAlreadyCompleted:false,selectedQuestId};
    });
    repositories.progress.markUndiscovered.mockImplementation(async(p)=>{
      storage.set(p,[]);
      current={...current,discovered:0,progressUpdatedAt:null};
    });
    vi.spyOn(DiscoveryStateService.prototype,"get").mockImplementation(async()=>({
      profileId:1,discoveryId:1,active:true,categoryName:category.name,masterUpdatedAt:current.masterUpdatedAt,automaticReporting:false,
      progress:current.discovered ? {reported:false,reportHold:false,cardOwned:true,memo:null,updatedAt:saved.updatedAt} : null,
      history:current.historyUpdatedAt ? {status:current.firstReportStatus,legacyMeritCredit:false,updatedAt:current.historyUpdatedAt} : null,relatedQuests:[],
    }));
    const update = vi.spyOn(DiscoveryStateService.prototype,"update").mockImplementation(async (snapshot,operation)=>{
      if(operation.kind !== "correctHistory") throw new Error("Unexpected operation");
      const status=operation.status;
      current={...current,firstReportStatus:status,historyUpdatedAt:`saved-${status}`};
      const count=current.discovered;
      const breakdown={notReported:count && status === "not_reported"?1:0,confirmed:count && status === "confirmed"?1:0,unknown:count && status === "unknown"?1:0};
      stats.discoveries={...stats.discoveries,discovered:count,undiscovered:1-count,unreported:count,cardOwned:count,cardCapableDiscovered:count,unreportedBreakdown:breakdown};
      stats.categories[0]={...stats.categories[0]!,total:1,discovered:count,undiscovered:1-count,unreported:count,cardOwned:count,unreportedBreakdown:breakdown};
      const credit=status === "confirmed"?1:0;
      stats.adventureMerit={knownMerit:credit*100,reportedCount:credit,knownExperienceCount:credit,unknownExperienceCount:0};
      return {...snapshot,history:{status,legacyMeritCredit:false,updatedAt:current.historyUpdatedAt!}};
    });
    const user = await openDrilldown(repositories,stats);
    await user.click(screen.getByRole("button", {name:"発見物"}));
    await user.click(await screen.findByRole("checkbox", {name:"合成の気象の発見状態"}));
    await waitFor(()=>expect(screen.getByRole("checkbox", {name:"合成の気象の発見状態"})).toBeChecked());
    await user.selectOptions(screen.getByLabelText("地図"), "unrelated");
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "unknown");
    const button = await screen.findByRole("button", {name:"合成の気象の初回報告を確認"});
    expect(button).toHaveTextContent("不明");
    expect(current.historyUpdatedAt).toBeNull();
    expect(update).not.toHaveBeenCalled();
    await user.click(button);
    expect(await screen.findByLabelText("初回報告履歴")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("初回報告履歴"), status);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", {name:"検索・フィルターを隠す"}));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByLabelText("初回報告履歴")).toHaveValue(status);
    fireEvent.click(screen.getByRole("button", {name:"検索・フィルターを表示"}));
    act(() => resize(800, 600));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByLabelText("初回報告履歴")).toHaveValue(status);
    expect(update).not.toHaveBeenCalled();
    act(() => resize(1920, 1080));
    await user.click(screen.getByRole("button", {name:"記録を保存"}));
    await screen.findByText("条件に一致する発見物がありません");
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), status);
    expect(await screen.findByRole("checkbox", {name:"合成の気象の初回報告"})).toHaveProperty("checked",status === "confirmed");
    expect(screen.getByRole("checkbox", {name:"合成の気象の報告状態"})).not.toBeChecked();
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({history:null,relatedQuests:[]}),
      {kind:"correctHistory",status,removeLegacyCredit:false,currentState:null},null);
    expect(repositories.progress.setReported).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", {name:"概要"}));
    const total=(await screen.findByRole("heading", {name:"現在未報告"})).closest("article")!;
    expect(within(total).getByText("1件",{selector:".overview-value"})).toBeInTheDocument();
    expect(total).toHaveTextContent(status === "not_reported" ? "初回未報告1件再報告待ち0件" : "初回未報告0件再報告待ち1件");
    expect(screen.getByRole("heading", {name:"冒険勲功値"}).closest("article")).toHaveTextContent(`算入対象発見物 ${status === "confirmed" ? 1 : 0}件`);
    expect(screen.getByRole("heading", {name:"気象・現象"}).closest("article")).toHaveTextContent(status === "not_reported" ? "初回未報告1件再報告待ち0件" : "初回未報告0件再報告待ち1件");
    await user.click(screen.getByRole("button", {name:"発見物"}));
    vi.spyOn(window,"confirm").mockReturnValue(true);
    await user.click(await screen.findByRole("checkbox", {name:"合成の気象の発見状態"}));
    await waitFor(()=>expect(screen.getByRole("checkbox", {name:"合成の気象の発見状態"})).not.toBeChecked());
    expect(screen.getByRole("checkbox", {name:"合成の気象の初回報告"})).toHaveProperty("checked",status === "confirmed");
    expect(current.firstReportStatus).toBe(status);
    await user.click(screen.getByRole("checkbox", {name:"合成の気象の初回報告"}));
    await user.selectOptions(await screen.findByLabelText("初回報告履歴"), "unknown");
    await user.click(screen.getByRole("button", {name:"記録を保存"}));
    const reset=await screen.findByRole("button", {name:"合成の気象の初回報告を確認"});
    expect(reset).toHaveTextContent("不明");
    await waitFor(()=>expect(reset).toHaveFocus());
    expect(screen.getByRole("checkbox", {name:"合成の気象の発見状態"})).not.toBeChecked();
    expect(storage.get(1)).toEqual([]);
    expect(current).toMatchObject({discovered:0,firstReportStatus:"unknown",historyUpdatedAt:"saved-unknown"});
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({progress:null,history:expect.objectContaining({status})}),
      {kind:"correctHistory",status:"unknown",removeLegacyCredit:false,currentState:null},null);
    expect(repositories.progress.markDiscovered).toHaveBeenCalledTimes(1);
    expect(repositories.progress.markUndiscovered).toHaveBeenCalledTimes(1);
    expect(repositories.progress.setCardOwned).not.toHaveBeenCalled();
    expect(repositories.progress.setReported).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "unknown");
    expect(screen.getByText("条件に一致する発見物がありません")).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name:"概要"}));
    const after=(await screen.findByRole("heading", {name:"現在未報告"})).closest("article")!;
    expect(within(after).getByText("0件",{selector:".overview-value"})).toBeInTheDocument();
    expect(screen.getByRole("heading", {name:"冒険勲功値"}).closest("article")).toHaveTextContent("算入対象発見物 0件");
  });

  it("waits for batch history, distinguishes absent history from failure and retries without writing progress", async () => {
    const repositories = setup([profile(1)], [discovery(1,"非地図の発見物")], new Map([[1,[progress(1,1)]]]));
    let rejectRead!: (error: Error) => void;
    vi.mocked(discoveryStateReader.list).mockImplementationOnce(() => new Promise((_resolve,reject)=>{rejectRead=reject;}));
    const user = await open(repositories);
    await user.selectOptions(screen.getByLabelText("状態"), "unreported");
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "unknown");
    expect(screen.getByText("未報告の内訳を読み込んでいます…")).toBeInTheDocument();
    expect(screen.queryByText(/件中.*件表示/)).not.toBeInTheDocument();
    expect(screen.queryByText("条件に一致する発見物がありません")).not.toBeInTheDocument();
    await act(async()=>rejectRead(new Error("synthetic failure")));
    expect(screen.getByText("未報告の内訳を確認できません。地図・報告履歴を再読み込みしてください。")).toBeInTheDocument();
    const retry = screen.getByRole("button",{name:"再読み込み"});
    expect(retry).toBeEnabled();
    vi.mocked(discoveryStateReader.list).mockResolvedValueOnce([historySummary(1,"unknown",{historyUpdatedAt:null})]);
    await user.click(retry);
    expect(await screen.findByText("1件中 1件表示")).toBeInTheDocument();
    expect(screen.getByText("非地図の発見物")).toBeInTheDocument();
    expect(discoveryStateReader.list).toHaveBeenCalledTimes(2);
    expect(repositories.progress.setReported).not.toHaveBeenCalled();
    expect(repositories.progress.markDiscovered).not.toHaveBeenCalled();
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
  });

  it("isolates delayed history across profile switches and includes non-map history groups", async () => {
    const repositories = setup([profile(1,"A"),profile(2,"B")], [discovery(1,"非地図")],
      new Map([[1,[progress(1,1)]],[2,[progress(2,1)]]]));
    let resolveA!: (rows:DiscoveryStateSummary[]) => void;
    let resolveB!: (rows:DiscoveryStateSummary[]) => void;
    vi.mocked(discoveryStateReader.list).mockImplementation(id=>new Promise(resolve=>{if(id===1) resolveA=resolve; else resolveB=resolve;}));
    const user = await open(repositories);
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "confirmed");
    expect(screen.getByText("未報告の内訳を読み込んでいます…")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await waitFor(()=>expect(discoveryStateReader.list).toHaveBeenCalledWith(2));
    await user.selectOptions(await screen.findByLabelText("未報告の内訳"), "unknown");
    await act(async()=>resolveB([historySummary(1,"unknown",{legacyMeritCredit:1})]));
    expect(await screen.findByText("1件中 1件表示")).toBeInTheDocument();
    await act(async()=>resolveA([historySummary(1,"confirmed")]));
    expect(screen.getByText("1件中 1件表示")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "confirmed");
    expect(screen.getByText("条件に一致する発見物がありません")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "not_reported");
    expect(screen.getByText("条件に一致する発見物がありません")).toBeInTheDocument();
    expect(discoveryStateReader.list).toHaveBeenCalledTimes(2);
  });

  it("invalidates saved history while reloading after a current-state update, including reload failure", async () => {
    const repositories = setup([profile(1)], [discovery(1,"非地図")], new Map([[1,[progress(1,1)]]]));
    vi.mocked(discoveryStateReader.list).mockResolvedValueOnce([historySummary(1,"not_reported")]);
    const user = await open(repositories);
    let rejectRead!: (error:Error)=>void;
    vi.mocked(discoveryStateReader.list).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectRead=reject;}));
    await user.click(screen.getByRole("checkbox",{name:"非地図のカード所有状態"}));
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "not_reported");
    expect(screen.getByText("未報告の内訳を読み込んでいます…")).toBeInTheDocument();
    await act(async()=>rejectRead(new Error("synthetic reload failure")));
    expect(screen.getByText("未報告の内訳を確認できません。地図・報告履歴を再読み込みしてください。")).toBeInTheDocument();
    expect(screen.queryByText(/件中.*件表示/)).not.toBeInTheDocument();
    vi.mocked(discoveryStateReader.list).mockResolvedValueOnce([historySummary(1,"confirmed")]);
    await user.click(screen.getByRole("button",{name:"再読み込み"}));
    expect(await screen.findByText("条件に一致する発見物がありません")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "confirmed");
    expect(screen.getByText("非地図")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), "all");
    expect(screen.getByText("非地図")).toBeInTheDocument();
    expect(repositories.progress.setReported).not.toHaveBeenCalled();
  });

  it("reloads map status, filters and existing card/memo after the common state command succeeds", async () => {
    const saved=progress(1,1,false,true,"keep");
    const storage=new Map([[1,[saved]]]);
    const repositories=setup([profile(1)],[discovery(1,"地図の発見物",{relatedQuests:[{id:10,title:"対象地図"}]})],storage);
    const before:DiscoveryStateSummary={id:1,active:1,categoryName:"地理",experience:100,masterUpdatedAt:saved.updatedAt,discovered:1,reported:0,reportHold:1,progressUpdatedAt:saved.updatedAt,firstReportStatus:"unknown",legacyMeritCredit:0,historyUpdatedAt:null,automaticReporting:0,mapRelated:1};
    const after:DiscoveryStateSummary={...before,reported:1,reportHold:0,firstReportStatus:"confirmed",historyUpdatedAt:"saved",progressUpdatedAt:"saved"};
    vi.mocked(discoveryStateReader.list).mockResolvedValueOnce([before]).mockResolvedValueOnce([after]);
    const snapshot:DiscoveryState={profileId:1,discoveryId:1,active:true,categoryName:"地理",masterUpdatedAt:saved.updatedAt,automaticReporting:false,
      progress:{reported:false,reportHold:true,cardOwned:true,memo:"keep",updatedAt:saved.updatedAt},history:null,
      relatedQuests:[{id:10,active:true,offerMethod:"地理学",updatedAt:"q",discoveryCount:1}]};
    vi.spyOn(DiscoveryStateService.prototype,"get").mockResolvedValue(snapshot);
    const update=vi.spyOn(DiscoveryStateService.prototype,"update").mockImplementation(async()=>{
      storage.set(1,[{...saved,reported:true,updatedAt:"saved"}]);
      return {...snapshot,progress:{...snapshot.progress!,reported:true,reportHold:false,updatedAt:"saved"},history:{status:"confirmed",legacyMeritCredit:false,updatedAt:"saved"}};
    });
    const user=await open(repositories);
    await user.selectOptions(screen.getByLabelText("地図"),"suppressed");
    await user.selectOptions(await screen.findByRole("combobox",{name:"地図の発見物の地図の状態"}),"reported");
    await user.click(await screen.findByRole("button",{name:"記録を保存"}));
    await screen.findByText("条件に一致する発見物がありません");
    await user.selectOptions(screen.getByLabelText("地図"),"candidate");
    expect(await screen.findByRole("combobox",{name:"地図の発見物の地図の状態"})).toHaveValue("reported");
    expect(screen.getByRole("checkbox",{name:"地図の発見物のカード所有状態"})).toBeChecked();
    expect(storage.get(1)?.[0]?.memo).toBe("keep");
    expect(update).toHaveBeenCalledExactlyOnceWith(snapshot,{kind:"report"},null);
    expect(repositories.progress.setReported).not.toHaveBeenCalled();
  });

  it("reloads overview total, history breakdown and merit after a map history correction",async()=>{
    const saved=progress(1,1,false,true,"keep");
    const repositories=setup([profile(1)],[discovery(1,"履歴対象",{experience:100,relatedQuests:[{id:10,title:"地図"}]})],new Map([[1,[saved]]]));
    let current:DiscoveryStateSummary={id:1,active:1,categoryName:"地理",experience:100,masterUpdatedAt:saved.updatedAt,
      discovered:1,reported:0,reportHold:0,progressUpdatedAt:saved.updatedAt,firstReportStatus:"confirmed",
      legacyMeritCredit:0,historyUpdatedAt:"h",automaticReporting:0,mapRelated:1};
    vi.mocked(discoveryStateReader.list).mockImplementation(async()=>[current]);
    const snapshot:DiscoveryState={profileId:1,discoveryId:1,active:true,categoryName:"地理",masterUpdatedAt:saved.updatedAt,automaticReporting:false,
      progress:{reported:false,reportHold:false,cardOwned:true,memo:"keep",updatedAt:saved.updatedAt},
      history:{status:"confirmed",legacyMeritCredit:false,updatedAt:"h"},relatedQuests:[{id:10,offerMethod:"地理学",active:true,updatedAt:"q",discoveryCount:1}]};
    vi.spyOn(DiscoveryStateService.prototype,"get").mockResolvedValue(snapshot);
    const stats=categoryStats([{id:1,name:"地理",sortOrder:10}]);
    stats.discoveries={total:1,discovered:1,undiscovered:0,unreported:1,reported:0,cardOwned:1,cardCapableDiscovered:1,
      unreportedBreakdown:{notReported:0,confirmed:1,unknown:0}};
    stats.adventureMerit={knownMerit:100,reportedCount:1,knownExperienceCount:1,unknownExperienceCount:0};
    const update=vi.spyOn(DiscoveryStateService.prototype,"update").mockImplementation(async()=>{
      current={...current,firstReportStatus:"not_reported",historyUpdatedAt:"new"};
      stats.discoveries={...stats.discoveries,unreportedBreakdown:{notReported:1,confirmed:0,unknown:0}};
      stats.adventureMerit={knownMerit:0,reportedCount:0,knownExperienceCount:0,unknownExperienceCount:0};
      return {...snapshot,history:{status:"not_reported",legacyMeritCredit:false,updatedAt:"new"}};
    });
    const user=await openDrilldown(repositories,stats);
    expect(screen.getByRole("heading",{name:"現在未報告"}).closest("article")).toHaveTextContent("初回未報告0件再報告待ち1件");
    await user.click(screen.getByRole("button",{name:"発見物"}));
    await user.click(await screen.findByRole("checkbox",{name:"履歴対象の初回報告"}));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button",{name:"記録を保存"}));
    await waitFor(()=>expect(screen.getByRole("checkbox",{name:"履歴対象の初回報告"})).not.toBeChecked());
    expect(screen.getByRole("checkbox",{name:"履歴対象のカード所有状態"})).toBeChecked();
    expect(update).toHaveBeenCalledExactlyOnceWith(snapshot,{kind:"correctHistory",status:"not_reported",removeLegacyCredit:false,currentState:null},null);
    await user.click(screen.getByRole("button",{name:"概要"}));
    await screen.findByRole("heading",{name:"現在未報告"});
    expect(screen.getByRole("heading",{name:"現在未報告"}).closest("article")).toHaveTextContent("初回未報告1件再報告待ち0件");
    const card=screen.getByRole("heading",{name:"現在未報告"}).closest("article")!;
    expect(within(card).getByText("1件",{selector:".overview-value"})).toBeInTheDocument();
    expect(screen.getByRole("heading",{name:"冒険勲功値"}).closest("article")).toHaveTextContent("算入対象発見物 0件");
  });

  it.each([
    ["未報告の発見物一覧を開く", "unreported", "all", "{Enter}"],
    ["カード未所有の発見物一覧を開く", "all", "not-owned", " "],
  ])("opens %s with exclusive initial filters, preserves profile and allows later navigation", async (label, status, card, key) => {
    const repositories = setup([profile(1, "A"), profile(2, "B")], [
      discovery(1, "未報告未所有"), discovery(2, "報告済み所有"),
      discovery(3, "自動報告", { automaticReporting: true }),
      discovery(4, "レリック", { category: { id: 20, name: "レリック", sortOrder: 20 } }),
      discovery(5, "未発見"), discovery(6, "非active", { isActive: false }),
    ], new Map([[1, [progress(1, 1, false, false), progress(1, 2, true), progress(1, 3), progress(1, 4, false, false), progress(1, 6, false, false)]]]));
    const stats = categoryStats([{ id: 1, name: "地理", sortOrder: 1 }]);
    stats.discoveries = { total: 5, discovered: 4, undiscovered: 1, unreported: 1, reported: 2, cardOwned: 2, cardCapableDiscovered: 3 };
    const user = await openDrilldown(repositories, stats);
    expect(screen.getByText("所有 2 / 3")).toBeInTheDocument();
    expect(screen.queryByText("未報告一覧を表示")).not.toBeInTheDocument();
    expect(screen.queryByText("未所有一覧を表示")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: label });
    button.focus();
    await user.keyboard(key);
    await screen.findByRole("table");
    expect(screen.getByRole("option", { name: "未所有（発見済みのみ）" })).toHaveValue("not-owned");
    expect(screen.getByLabelText("状態")).toHaveValue(status);
    expect(screen.getByLabelText("カード所有")).toHaveValue(card);
    expect(screen.getByLabelText("分類")).toHaveValue("all");
    expect(screen.getByLabelText("未報告の内訳")).toHaveValue("all");
    expect(screen.getByText("1 / 1ページ")).toBeInTheDocument();
    const expectedCount = status === "unreported" ? stats.discoveries.unreported : stats.discoveries.cardCapableDiscovered - stats.discoveries.cardOwned;
    expect(bodyRows()).toHaveLength(expectedCount);
    expect(bodyRows()[0]).toHaveTextContent("未報告未所有");
    await user.selectOptions(screen.getByLabelText("状態"), "all");
    await user.selectOptions(screen.getByLabelText("カード所有"), "all");
    expect(bodyRows()).toHaveLength(5);
    await user.type(screen.getByLabelText("発見物名を検索"), "未報告");
    await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
    expect(bodyRows()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "概要" }));
    const otherLabel = status === "unreported" ? "カード未所有の発見物一覧を開く" : "未報告の発見物一覧を開く";
    await user.click(await screen.findByRole("button", { name: otherLabel }));
    await screen.findByRole("table");
    expect(screen.getByLabelText("発見物名を検索")).toHaveValue("");
    expect(screen.getByLabelText("状態")).toHaveValue(status === "unreported" ? "all" : "unreported");
    expect(screen.getByLabelText("カード所有")).toHaveValue(status === "unreported" ? "not-owned" : "all");
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await screen.findByRole("table");
    expect(screen.getByLabelText("状態")).toHaveValue("all");
    expect(screen.getByLabelText("カード所有")).toHaveValue("all");
    expect(screen.getByRole("checkbox", { name: "未報告未所有の発見状態" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "プロフィール" }));
    await user.click(screen.getByRole("button", { name: "発見物" }));
    await screen.findByRole("table");
    expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("2");
    expect(screen.getByLabelText("状態")).toHaveValue("all");
    expect(screen.getByLabelText("カード所有")).toHaveValue("all");
    expect(bodyRows()).toHaveLength(5);
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
    expect(repositories.progress.setReported).not.toHaveBeenCalled();
    expect(repositories.progress.setCardOwned).not.toHaveBeenCalled();
  });

  it.each(["未報告の発見物一覧を開く", "カード未所有の発見物一覧を開く"])("opens zero matches and missing masters safely from %s", async (label) => {
    const repositories = setup([profile(1)], [discovery(1, "既所有")], new Map([[1, [progress(1, 1, true, true)]]]));
    const user = await openDrilldown(repositories, categoryStats([]));
    await user.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByText("条件に一致する発見物がありません")).toBeInTheDocument();
    expect(screen.getByText("0 / 0ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "概要" }));
    repositories.master.items.splice(0);
    await user.click(await screen.findByRole("button", { name: label }));
    expect(await screen.findByText("発見物のマスターデータがありません")).toBeInTheDocument();
  });
  it("shows legacy stored unreported progress as automatic, filters by effective state and isolates profiles", async () => {
    const stored = progress(1, 1, false, false, "keep");
    const repositories = setup([profile(1, "A"), profile(2, "B")], [
      discovery(1, "特殊発見", { automaticReporting: true }), discovery(2, "通常発見"),
      discovery(3, "レリック発見", { category: { id: 2, name: "レリック", sortOrder: 2 } }),
    ], new Map([[1, [stored, progress(1, 2), progress(1, 3)]]]));
    const user = await open(repositories);
    expect(screen.getByText("報告済み（自動）")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "特殊発見の報告状態" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "特殊発見のカード所有状態" })).not.toBeChecked();
    expect(screen.getByText("未報告 1件")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("状態"), "reported");
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("特殊発見");
    await user.selectOptions(screen.getByLabelText("状態"), "unreported");
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("通常発見");
    expect(stored).toMatchObject({ reported: false, cardOwned: false, memo: "keep" });
    expect(repositories.progress.setReported).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await user.selectOptions(await screen.findByLabelText("状態"), "all");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "特殊発見の発見状態" })).not.toBeChecked());
    expect(screen.queryByText("報告済み（自動）")).not.toBeInTheDocument();
  });

  it("uses persisted reported state immediately after selecting a special route among multiple quests", async () => {
    const repositories = setup([profile(1)], [discovery(1, "複数経路", {
      relatedQuests: [{ id: 10, title: "特殊Quest" }, { id: 20, title: "通常Quest" }],
    })]);
    repositories.link.discoverWithLinkedQuest.mockImplementation(async (profileId, discoveryId, selectedQuestId) => {
      await repositories.progress.markDiscovered(profileId, discoveryId);
      await repositories.progress.setReported(profileId, discoveryId, true);
      return { discoveryCreated: true, questCompleted: true, questAlreadyCompleted: false, selectedQuestId };
    });
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "複数経路の発見状態" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText("特殊Quest"));
    await user.click(within(dialog).getByRole("button", { name: "発見済みにする" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "複数経路の報告状態" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "複数経路の報告状態" })).toBeEnabled();
    expect(screen.queryByText("報告済み（自動）")).not.toBeInTheDocument();
  });
  it("passes master description and notes separately and excludes profile memo without changing progress", async () => {
    const repositories = setup([profile(1, "A"), profile(2, "B")], [
      discovery(1, "合成発見物", { description: "合成の説明", notes: "合成の攻略備考" }),
    ], new Map([[1, [progress(1, 1, false, true, "ユーザーの個人メモ")]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "合成発見物の説明・備考を表示" }));
    const popup = screen.getByRole("dialog", { name: "合成発見物" });
    expect(within(popup).getByRole("heading", { name: "説明" })).toBeInTheDocument();
    expect(within(popup).getByRole("heading", { name: "備考" })).toBeInTheDocument();
    expect(popup).toHaveTextContent("合成の説明");
    expect(popup).toHaveTextContent("合成の攻略備考");
    expect(popup).not.toHaveTextContent("ユーザーの個人メモ");
    expect(repositories.progress.markDiscovered).not.toHaveBeenCalled();
    expect(repositories.progress.markUndiscovered).not.toHaveBeenCalled();
    expect(repositories.progress.setReported).not.toHaveBeenCalled();
    expect(repositories.progress.setCardOwned).not.toHaveBeenCalled();
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await screen.findByRole("table");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成発見物の説明・備考を表示" }));
    await user.click(screen.getByRole("button", { name: "プロフィール" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens every Overview category by ID, supports keyboard activation, and preserves the selected profile", async () => {
    const categories = [
      { id: 1, name: "史跡", sortOrder: 1 },
      { id: 2, name: "天文", sortOrder: 2 },
      { id: 3, name: "伝承", sortOrder: 3 },
      { id: 20, name: "レリック", sortOrder: 20 },
    ];
    const repositories = setup([profile(1, "A"), profile(2, "B")],
      categories.map((category) => discovery(category.id, `発見物${category.id}`, { category })));
    const user = await openDrilldown(repositories, categoryStats(categories));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    for (const category of categories) {
      const button = await screen.findByRole("button", { name: `${category.name}の発見物一覧を開く` });
      expect(button).toHaveAttribute("type", "button");
      expect(button.tabIndex).toBe(0);
      if (category.id === 1) {
        button.focus();
        await user.keyboard("{Enter}");
      } else {
        await user.click(button);
      }
      expect(await screen.findByLabelText("分類")).toHaveValue(String(category.id));
      expect(bodyRows()).toHaveLength(1);
      expect(bodyRows()[0]).toHaveTextContent(`発見物${category.id}`);
      expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("2");
      expect(repositories.progress.listByProfile).toHaveBeenLastCalledWith(2);
      if (category.id === 20) {
        expect(screen.queryByRole("checkbox", { name: "発見物20の報告状態" })).not.toBeInTheDocument();
        expect(screen.queryByRole("checkbox", { name: "発見物20のカード所有状態" })).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("checkbox", { name: `発見物${category.id}の報告状態` })).toBeInTheDocument();
      }
      await user.click(screen.getByRole("button", { name: "概要" }));
    }
    expect(within(screen.getByRole("group", { name: "主要な進捗" })).queryByRole("button")).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "補助的な進捗" })).getAllByRole("button")).toHaveLength(2);
    expect(repositories.progress.markDiscovered).not.toHaveBeenCalled();
  });

  it("clears stale search, status, ownership, sorting and pagination on category drill-down", async () => {
    const category = { id: 1, name: "史跡", sortOrder: 1 };
    const items = Array.from({ length: 52 }, (_, index) => discovery(index + 1, `発見${52 - index}`, { category }));
    const repositories = setup([profile(1)], [
      ...items,
      discovery(53, "未発見の対象", { category }),
      discovery(54, "未報告の対象", { category }),
      discovery(55, "別分類", { category: { id: 2, name: "天文", sortOrder: 2 } }),
    ], new Map([[1, [...items.map((item) => progress(1, item.discovery.id, true, true)), progress(1, 54, false, false)]]]));
    const user = await openDrilldown(repositories, categoryStats([category]));
    await user.click(screen.getByRole("button", { name: "発見物" }));
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("発見物名を検索"), "発見");
    await user.selectOptions(screen.getByLabelText("状態"), "reported");
    await user.selectOptions(screen.getByLabelText("カード所有"), "owned");
    await user.click(screen.getByRole("button", { name: "発見物名で並べ替え" }));
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "概要" }));
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    await screen.findByRole("table");
    expect(screen.getByLabelText("分類")).toHaveValue("1");
    expect(screen.getByLabelText("発見物名を検索")).toHaveValue("");
    expect(screen.getByLabelText("状態")).toHaveValue("all");
    expect(screen.getByLabelText("カード所有")).toHaveValue("all");
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(screen.getByText("55件中 54件表示")).toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent("発見52");
    expect(screen.getByRole("columnheader", { name: /発見物名/ })).not.toHaveAttribute("aria-sort");
  });

  it("consumes drill-down once, allows manual category changes, and does not replay on ordinary navigation", async () => {
    const categories = [{ id: 1, name: "史跡", sortOrder: 1 }, { id: 2, name: "天文", sortOrder: 2 }];
    const repositories = setup([profile(1)], categories.map((category) => discovery(category.id, `発見物${category.id}`, { category })));
    const user = await openDrilldown(repositories, categoryStats(categories));
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("分類"), "2");
    expect(bodyRows()[0]).toHaveTextContent("発見物2");
    await user.click(screen.getByRole("button", { name: "クエスト" }));
    await user.click(screen.getByRole("button", { name: "発見物" }));
    await screen.findByRole("table");
    expect(screen.getByLabelText("分類")).toHaveValue("all");
    expect(bodyRows()).toHaveLength(2);
  });

  it("falls back to all when an Overview category no longer exists in the loaded master", async () => {
    const repositories = setup([profile(1)], [discovery(2, "天体", { category: { id: 2, name: "天文", sortOrder: 2 } })]);
    const user = await openDrilldown(repositories, categoryStats([{ id: 1, name: "史跡", sortOrder: 1 }]));
    await user.click(await screen.findByRole("button", { name: "史跡の発見物一覧を開く" }));
    await screen.findByRole("table");
    expect(screen.getByLabelText("分類")).toHaveValue("all");
    expect(screen.getByText("天体")).toBeInTheDocument();
    expect(repositories.master.listWithRelations).toHaveBeenCalledTimes(1);
  });

  it("uses category IDs even when synthetic categories share a display name", async () => {
    const categories = [{ id: 1, name: "同名", sortOrder: 1 }, { id: 2, name: "同名", sortOrder: 2 }];
    const repositories = setup([profile(1)], categories.map((category) => discovery(category.id, `発見物${category.id}`, { category })));
    const user = await openDrilldown(repositories, categoryStats(categories));
    const buttons = await screen.findAllByRole("button", { name: "同名の発見物一覧を開く" });
    await user.click(buttons[1]!);
    await screen.findByRole("table");
    expect(screen.getByLabelText("分類")).toHaveValue("2");
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("発見物2");
  });

  it("asks for a profile before loading progress", async () => {
    const repositories = setup([], [discovery(1, "テスト発見物A")]);
    await open(repositories);
    expect(screen.getByRole("heading", { name: "発見物進捗を表示するプロフィールを選択してください" })).toBeInTheDocument();
    expect(repositories.progress.listByProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "マスターデータを開く" })).not.toBeInTheDocument();
  });

  it("shows all required master and relation fields", async () => {
    const repositories = setup([profile(1)], [discovery(1, "テスト発見物A", { rank: 5, era: "15世紀", points: 80, difficulty: 7, experience: 900, relatedQuests: [{ id: 9, title: "天体観測" }] })]);
    await open(repositories);
    const row = screen.getByText("テスト発見物A").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("地理");
    expect(row).toHaveTextContent("5");
    expect(row).toHaveTextContent("15世紀");
    expect(row).toHaveTextContent("80");
    expect(row).toHaveTextContent("7");
    expect(row).toHaveTextContent("900");
    expect(row).toHaveTextContent("天体観測");
  });

  it("keeps pagination outside the workspace table scroll area", async () => {
    const repositories = setup([profile(1)], [discovery(1, "テスト発見物A")]);
    await open(repositories);

    const table = screen.getByRole("table");
    const scrollArea = table.parentElement as HTMLElement;
    const workspace = scrollArea.closest(".workspace-table") as HTMLElement;
    const page = table.closest(".workspace-page") as HTMLElement;
    const pagination = screen.getByLabelText("発見物一覧ページ操作");

    expect(scrollArea).toHaveClass("quest-table-scroll", "discovery-table-scroll");
    expect(workspace).toContainElement(scrollArea);
    expect(workspace).toContainElement(pagination);
    expect(scrollArea).not.toContainElement(pagination);
    expect(page).toHaveClass("workspace-page");
    expect(page.closest("main")).toHaveClass("main-content--workspace");
  });

  it("searches Japanese names by partial match", async () => {
    const repositories = setup([profile(1)], [discovery(1, "テスト発見物A"), discovery(2, "テスト発見物B")]);
    const user = await open(repositories);
    await user.type(screen.getByLabelText("発見物名を検索"), "発見物B");
    expect(screen.getByText("テスト発見物B")).toBeInTheDocument();
    expect(screen.queryByText("テスト発見物A")).not.toBeInTheDocument();
  });

  it("builds category options in sortOrder and filters them", async () => {
    const repositories = setup([profile(1)], [discovery(1, "遺跡", { category: { id: 2, name: "史跡", sortOrder: 20 } }), discovery(2, "魚", { category: { id: 1, name: "海洋生物", sortOrder: 10 } })]);
    const user = await open(repositories);
    const filter = screen.getByLabelText("分類");
    expect(within(filter).getAllByRole("option").map((item) => item.textContent)).toEqual(["すべて", "海洋生物", "史跡"]);
    await user.selectOptions(filter, "2");
    expect(screen.getByText("遺跡")).toBeInTheDocument();
    expect(screen.queryByText("魚")).not.toBeInTheDocument();
  });

  it.each([
    ["undiscovered", "未発見物"],
    ["unreported", "未報告物"],
    ["reported", "報告済み物"],
  ])("filters status %s", async (value, expected) => {
    const repositories = setup([profile(1)], masterThree(), new Map([[1, [progress(1, 2), progress(1, 3, true)]]]));
    const user = await open(repositories);
    await user.selectOptions(screen.getByLabelText("状態"), value);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByText("3件中 1件表示")).toBeInTheDocument();
  });

  it.each([
    ["owned", "所有物"],
    ["not-owned", "非所有物"],
  ])("filters card state %s without treating undiscovered as not-owned", async (value, expected) => {
    const repositories = setup([profile(1)], [discovery(1, "未発見物"), discovery(2, "所有物"), discovery(3, "非所有物")], new Map([[1, [progress(1, 2), progress(1, 3, false, false)]]]));
    const user = await open(repositories);
    const cardFilter = screen.getByLabelText("カード所有");
    await user.selectOptions(cardFilter, value);
    expect(cardFilter).toHaveValue(value);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText("未発見物")).not.toBeInTheDocument();
  });

  it.each([
    ["発見物名", [discovery(1, "ベータ"), discovery(2, "アルファ")], "アルファ"],
    ["分類", [discovery(1, "後", { category: { id: 1, name: "A", sortOrder: 20 } }), discovery(2, "先", { category: { id: 2, name: "Z", sortOrder: 10 } })], "先"],
    ["ランク", [discovery(1, "大", { rank: 9 }), discovery(2, "小", { rank: 1 })], "小"],
    ["ポイント", [discovery(1, "大", { points: 9 }), discovery(2, "小", { points: 1 })], "小"],
    ["難易度", [discovery(1, "大", { difficulty: 9 }), discovery(2, "小", { difficulty: 1 })], "小"],
    ["経験", [discovery(1, "大", { experience: 9 }), discovery(2, "小", { experience: 1 })], "小"],
  ])("sorts by %s", async (header, data, expectedFirst) => {
    const repositories = setup([profile(1)], data as DiscoveryWithRelations[]);
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: `${header}で並べ替え` }));
    expect(bodyRows()[0]).toHaveTextContent(String(expectedFirst));
  });

  it("returns to repository source order when name sort is cleared", async () => {
    const repositories = setup(
      [profile(1)],
      [discovery(1, "ベータ"), discovery(2, "アルファ"), discovery(3, "ガンマ")],
    );
    const user = await open(repositories);
    const sort = screen.getByRole("button", { name: "発見物名で並べ替え" });

    expect(bodyRows()[0]).toHaveTextContent("ベータ");
    await user.click(sort);
    expect(bodyRows()[0]).toHaveTextContent("アルファ");
    await user.click(sort);
    expect(bodyRows()[0]).toHaveTextContent("ベータ");
    expect(bodyRows()[1]).toHaveTextContent("ガンマ");
    await user.click(sort);
    expect(bodyRows()[0]).toHaveTextContent("ベータ");
    expect(bodyRows()[1]).toHaveTextContent("アルファ");
  });

  it("sorts status with undiscovered first", async () => {
    const repositories = setup([profile(1)], masterThree(), new Map([[1, [progress(1, 2), progress(1, 3, true)]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "発見状態で並べ替え" }));
    expect(bodyRows()[0]).toHaveTextContent("未発見物");
  });

  it("sorts card state consistently with undiscovered last", async () => {
    const repositories = setup([profile(1)], [discovery(1, "未発見"), discovery(2, "所有"), discovery(3, "非所有")], new Map([[1, [progress(1, 2), progress(1, 3, false, false)]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "カード所有で並べ替え" }));
    expect(bodyRows().map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("非所有"), expect.stringContaining("所有"), expect.stringContaining("未発見")]));
    expect(bodyRows()[2]).toHaveTextContent("未発見");
  });

  it("uses 50-row pagination by default", async () => {
    const repositories = setup([profile(1)], Array.from({ length: 51 }, (_, index) => discovery(index + 1, `発見物${index + 1}`)));
    const user = await open(repositories);
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "次ページ" }));
    expect(screen.getByText("発見物51")).toBeInTheDocument();
  });

  it("supports a 100-row page size", async () => {
    const repositories = setup([profile(1)], Array.from({ length: 101 }, (_, index) => discovery(index + 1, `発見物${index + 1}`)));
    const user = await open(repositories);
    await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
    expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
    expect(screen.getByText("発見物100")).toBeInTheDocument();
  });

  it("keeps page two during discovery, report, and card updates", async () => {
    const repositories = setup(
      [profile(1)],
      Array.from({ length: 52 }, (_, index) => discovery(index + 1, `発見物${index + 1}`)),
    );
    const user = await open(repositories);
    await user.click(screen.getByRole("button", { name: "次ページ" }));

    await user.click(screen.getByRole("checkbox", { name: "発見物51の発見状態" }));
    await waitFor(() => expect(repositories.progress.markDiscovered).toHaveBeenCalledWith(1, 51));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "発見物51の報告状態" }));
    await waitFor(() => expect(repositories.progress.setReported).toHaveBeenCalledWith(1, 51, true));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "発見物51のカード所有状態" }));
    await waitFor(() => expect(repositories.progress.setCardOwned).toHaveBeenCalledWith(1, 51, false));
    expect(screen.getByText("2 / 2ページ")).toBeInTheDocument();
  });

  it("marks discovered with unreported and card-owned defaults", async () => {
    const repositories = setup([profile(1)], [discovery(1, "新発見")]);
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "新発見の発見状態" }));
    await waitFor(() => expect(repositories.progress.markDiscovered).toHaveBeenCalledWith(1, 1));
    expect(screen.getByRole("checkbox", { name: "新発見の報告状態" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "新発見のカード所有状態" })).toBeChecked();
    expect(screen.queryByText("発見物を発見済みにしました。")).not.toBeInTheDocument();
  });

  it("renders relic report and card values as not applicable before and after discovery", async () => {
    const repositories = setup([profile(1)], [discovery(1, "レリック", { category: { id: 20, name: "レリック", sortOrder: 20 } })]);
    const user = await open(repositories);

    expect(screen.getAllByText("対象外")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: "レリックの報告状態" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "レリックのカード所有状態" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "レリックの発見状態" }));
    expect(screen.getByRole("checkbox", { name: "レリックの発見状態" })).toBeChecked();
    expect(screen.getAllByText("対象外")).toHaveLength(2);
  });

  it("treats legacy relic report and card values as not applicable", async () => {
    const repositories = setup(
      [profile(1)],
      [discovery(1, "既存レリック", { category: { id: 20, name: "レリック", sortOrder: 20 } })],
      new Map([[1, [progress(1, 1, true, true)]]]),
    );
    await open(repositories);
    expect(screen.getAllByText("対象外")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: "既存レリックの報告状態" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "既存レリックのカード所有状態" })).not.toBeInTheDocument();
  });

  it("excludes discovered relics from report and card filters", async () => {
    const relic = discovery(1, "レリック発見物", { category: { id: 20, name: "レリック", sortOrder: 20 } });
    const normalUnreported = discovery(2, "通常未報告");
    const normalReported = discovery(3, "通常報告済み");
    const normalOwned = discovery(4, "通常カード所有");
    const normalNotOwned = discovery(5, "通常カード非所有");
    const repositories = setup(
      [profile(1)],
      [relic, normalUnreported, normalReported, normalOwned, normalNotOwned],
      new Map([[1, [progress(1, 1, true, true), progress(1, 2), progress(1, 3, true), progress(1, 4), progress(1, 5, false, false)]]]),
    );
    const user = await open(repositories);

    await user.selectOptions(screen.getByLabelText("状態"), "unreported");
    expect(screen.getByText("通常未報告")).toBeInTheDocument();
    expect(screen.queryByText("レリック発見物")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("状態"), "reported");
    expect(screen.getByText("通常報告済み")).toBeInTheDocument();
    expect(screen.queryByText("レリック発見物")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("状態"), "all");
    await user.selectOptions(screen.getByLabelText("カード所有"), "owned");
    expect(screen.getByText("通常カード所有")).toBeInTheDocument();
    expect(screen.queryByText("レリック発見物")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("カード所有"), "not-owned");
    expect(screen.getByText("通常カード非所有")).toBeInTheDocument();
    expect(screen.queryByText("レリック発見物")).not.toBeInTheDocument();
  });

  it("keeps an undiscovered relic in the undiscovered filter", async () => {
    const repositories = setup([profile(1)], [discovery(1, "未発見レリック", { category: { id: 20, name: "レリック", sortOrder: 20 } })]);
    const user = await open(repositories);
    await user.selectOptions(screen.getByLabelText("状態"), "undiscovered");
    expect(screen.getByText("未発見レリック")).toBeInTheDocument();
  });

  it("asks before writing when a discovery has multiple active related quests", async () => {
    const repositories = setup([profile(1)], [discovery(1, "聖母のステンドグラス", {
      relatedQuests: [{ id: 10, title: "クエストA" }, { id: 20, title: "クエストB" }],
    })]);
    const user = await open(repositories);

    await user.click(screen.getByRole("checkbox", { name: "聖母のステンドグラスの発見状態" }));

    expect(screen.getByRole("dialog", { name: "関連クエストを選択" })).toBeInTheDocument();
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "クエストB" }));
    await user.click(screen.getByRole("button", { name: "発見済みにする" }));
    await waitFor(() => expect(repositories.link.discoverWithLinkedQuest).toHaveBeenCalledWith(1, 1, 20));
    expect(screen.getByRole("checkbox", { name: "聖母のステンドグラスの発見状態" })).toBeChecked();
  });

  it("allows multiple-relation discovery without changing quest progress", async () => {
    const repositories = setup([profile(1)], [discovery(1, "複数関連", {
      relatedQuests: [{ id: 10, title: "クエストA" }, { id: 20, title: "クエストB" }],
    })]);
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "複数関連の発見状態" }));
    await user.click(screen.getByRole("radio", { name: "クエスト進捗は変更しない" }));
    await user.click(screen.getByRole("button", { name: "発見済みにする" }));
    await waitFor(() => expect(repositories.link.discoverWithLinkedQuest).toHaveBeenCalledWith(1, 1, null));
  });

  it("cancels a multiple-relation dialog without writing", async () => {
    const repositories = setup([profile(1)], [discovery(1, "複数関連", {
      relatedQuests: [{ id: 10, title: "クエストA" }, { id: 20, title: "クエストB" }],
    })]);
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "複数関連の発見状態" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
  });

  it("closes an outstanding quest selection when the profile changes", async () => {
    const repositories = setup([profile(1, "A"), profile(2, "B")], [discovery(1, "複数関連", {
      relatedQuests: [{ id: 10, title: "クエストA" }, { id: 20, title: "クエストB" }],
    })]);
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "複数関連の発見状態" }));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
  });

  it("shows feedback when a related quest was auto-completed", async () => {
    const repositories = setup([profile(1)], [discovery(1, "単一関連", {
      relatedQuests: [{ id: 10, title: "クエストA" }],
    })]);
    repositories.link.discoverWithLinkedQuest.mockResolvedValue({
      discoveryCreated: true,
      questCompleted: true,
      questAlreadyCompleted: false,
      selectedQuestId: 10,
    });
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "単一関連の発見状態" }));
    const feedback = await screen.findByRole("status");
    expect(feedback).toHaveTextContent("関連クエストを達成済み");
    expect(feedback).toHaveClass("progress-feedback");
  });

  it.each([[true], [false]])("updates reported=%s independently", async (initial) => {
    vi.spyOn(window,"confirm").mockReturnValue(true);
    const repositories = setup([profile(1)], [discovery(1, "発見")], new Map([[1, [progress(1, 1, initial)]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "発見の報告状態" }));
    await waitFor(() => expect(repositories.progress.setReported).toHaveBeenCalledWith(1, 1, !initial));
    expect(screen.getByRole("checkbox", { name: "発見のカード所有状態" })).toBeChecked();
  });

  it.each([[true], [false]])("updates cardOwned=%s independently", async (initial) => {
    const repositories = setup([profile(1)], [discovery(1, "発見")], new Map([[1, [progress(1, 1, true, initial)]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "発見のカード所有状態" }));
    await waitFor(() => expect(repositories.progress.setCardOwned).toHaveBeenCalledWith(1, 1, !initial));
    expect(screen.getByRole("checkbox", { name: "発見の報告状態" })).toBeChecked();
  });

  it("returns to undiscovered through row deletion after warning", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const repositories = setup([profile(1)], [discovery(1, "既発見")], new Map([[1, [progress(1, 1, true, false, "重要メモ")]]]));
    const user = await open(repositories);
    await user.click(screen.getByRole("checkbox", { name: "既発見の発見状態" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("メモも削除"));
    await waitFor(() => expect(repositories.progress.markUndiscovered).toHaveBeenCalledWith(1, 1));
    expect(screen.getByRole("checkbox", { name: "既発見の報告状態" })).toBeDisabled();
  });

  it("does not offer report or card actions while undiscovered", async () => {
    const repositories = setup([profile(1)], [discovery(1, "未発見")]);
    await open(repositories);
    expect(screen.getByRole("checkbox", { name: "未発見の報告状態" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "未発見のカード所有状態" })).toBeDisabled();
  });

  it("prevents a duplicate row update while persistence is pending", async () => {
    let resolveWrite: (() => void) | undefined;
    const repositories = setup([profile(1)], [discovery(1, "発見")]);
    const persist = repositories.progress.markDiscovered;
    repositories.progress.markDiscovered = vi.fn(async (profileId, discoveryId) => {
      await new Promise<void>((resolve) => { resolveWrite = resolve; });
      await persist(profileId, discoveryId);
    });
    const user = await open(repositories);
    const checkbox = screen.getByRole("checkbox", { name: "発見の発見状態" });
    await user.click(checkbox);
    expect(checkbox).toBeDisabled();
    const table = screen.getByRole("table");
    await user.click(screen.getByRole("button", { name: "詳細フィルターを閉じる" }));
    await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    await user.click(screen.getByRole("button", { name: "メニューを閉じる" }));
    expect(screen.getByRole("table")).toBe(table);
    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
    expect(repositories.progress.markDiscovered).toHaveBeenCalledTimes(1);
    resolveWrite?.();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "発見の発見状態" })).toBeChecked());
  });

  it("keeps the previous state and displays an error when persistence fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repositories = setup([profile(1)], [discovery(1, "発見")]);
    repositories.progress.markDiscovered = vi.fn().mockRejectedValue(new Error("DB"));
    const user = await open(repositories);
    const checkbox = screen.getByRole("checkbox", { name: "発見の発見状態" });
    await user.click(checkbox);
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("発見物進捗を更新できませんでした");
    await user.click(screen.getByRole("button", { name: "詳細フィルターを閉じる" }));
    await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    expect(screen.getByRole("alert")).toBe(error);
    expect(repositories.progress.markDiscovered).toHaveBeenCalledTimes(1);
    expect(checkbox).not.toBeChecked();
  });

  it("loads profile progress independently on profile switch", async () => {
    const repositories = setup([profile(1, "A"), profile(2, "B")], [discovery(1, "発見")], new Map([[1, [progress(1, 1)]], [2, []]]));
    const user = await open(repositories);
    expect(screen.getByRole("checkbox", { name: "発見の発見状態" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "検索・フィルターを隠す" }));
    await user.click(screen.getByRole("button", { name: "メニューを閉じる" }));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "発見の発見状態" })).not.toBeChecked());
    expect(repositories.progress.listByProfile).toHaveBeenLastCalledWith(2);
  });

  it("ignores stale progress from a rapidly replaced profile request", async () => {
    let resolveA: ((items: DiscoveryProgress[]) => void) | undefined;
    let resolveB: ((items: DiscoveryProgress[]) => void) | undefined;
    const repositories = setup([profile(1, "A"), profile(2, "B")], [discovery(1, "発見")]);
    repositories.progress.listByProfile = vi.fn((id) => new Promise((resolve) => { if (id === 1) resolveA = resolve; else resolveB = resolve; }));
    const user = await openWithoutTable(repositories);
    await waitFor(() => expect(repositories.progress.listByProfile).toHaveBeenCalledWith(1));
    await user.selectOptions(screen.getByLabelText("現在のプロフィール"), "2");
    await waitFor(() => expect(repositories.progress.listByProfile).toHaveBeenCalledWith(2));
    resolveB?.([]);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    resolveA?.([progress(1, 1)]);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "発見の発見状態" })).not.toBeChecked());
  });

  it("explains an empty master and opens Master Data", async () => {
    const repositories = setup([profile(1)], []);
    const masterDataStatusRepository: MasterDataStatusRepositoryPort = {
      getStatus: vi.fn<MasterDataStatusRepositoryPort["getStatus"]>(async () => ({
        datasets: {
          quests: { dataset: "quests", activeCount: 0, latestImport: null },
          discoveries: { dataset: "discoveries", activeCount: 0, latestImport: null },
        },
        recentHistory: [],
      })),
    };
    const user = await open(repositories, masterDataStatusRepository);
    expect(await screen.findByText("発見物のマスターデータがありません")).toBeInTheDocument();
    expect(screen.getByText("「マスターデータ」画面で発見物情報を取り込むと、発見物の一覧を表示できます。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "マスターデータを開く" }));
    expect(await screen.findByRole("heading", { name: "マスターデータ" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "discovery_items.csv を選択" });
    expect(masterDataStatusRepository.getStatus).toHaveBeenCalledTimes(1);
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
    expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("1");
  });

  it("keeps the profile-loading state ahead of the master-empty guidance", async () => {
    const repositories = setup([profile(1)], []);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    repositories.profiles.list = vi.fn(async () => { await pending; return repositories.profiles.items; });
    await openWithoutTable(repositories);
    expect(screen.getByText("プロフィールを読み込んでいます…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "マスターデータを開く" })).not.toBeInTheDocument();
    await act(async () => finish());
    expect(await screen.findByRole("button", { name: "マスターデータを開く" })).toBeInTheDocument();
  });

  it.each(["master", "progress"] as const)("waits for %s loading before showing the master-empty guidance", async (source) => {
    const repositories = setup([profile(1)], []);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    if (source === "master") repositories.master.listWithRelations = vi.fn(async () => { await pending; return []; });
    else repositories.progress.listByProfile = vi.fn(async () => { await pending; return []; });
    await openWithoutTable(repositories);
    expect(screen.getByText("発見物を読み込んでいます…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "マスターデータを開く" })).not.toBeInTheDocument();
    await act(async () => finish());
    expect(await screen.findByRole("button", { name: "マスターデータを開く" })).toBeInTheDocument();
  });

  it.each(["master", "progress"] as const)("keeps %s errors separate from missing master data", async (source) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repositories = setup([profile(1)], [discovery(1, "合成発見物")]);
    if (source === "master") repositories.master.listWithRelations = vi.fn().mockRejectedValue(new Error("synthetic master failure"));
    else repositories.progress.listByProfile = vi.fn().mockRejectedValue(new Error("synthetic progress failure"));
    await openWithoutTable(repositories);
    expect(await screen.findByText(source === "master" ? "発見物を読み込めませんでした。" : "発見物進捗を読み込めませんでした。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "マスターデータを開く" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("prioritizes progress errors over an empty master and restores the guidance after retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repositories = setup([profile(1)], []);
    repositories.progress.listByProfile.mockRejectedValueOnce(new Error("synthetic progress failure"));
    const user = await openWithoutTable(repositories);

    expect(await screen.findByText("発見物進捗を読み込めませんでした。")).toBeInTheDocument();
    expect(screen.queryByText("発見物のマスターデータがありません")).not.toBeInTheDocument();
    expect(screen.queryByText("表示できる有効な発見物がありません")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "マスターデータを開く" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByRole("button", { name: "マスターデータを開く" })).toBeInTheDocument();
    expect(screen.getByText("発見物のマスターデータがありません")).toBeInTheDocument();
    expect(screen.queryByText("発見物進捗を読み込めませんでした。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("現在のプロフィール")).toHaveValue("1");
    expect(repositories.link.discoverWithLinkedQuest).not.toHaveBeenCalled();
  });

  it("shows a filtered-empty state separately", async () => {
    const repositories = setup([profile(1)], [discovery(1, "発見")]);
    const user = await open(repositories);
    await user.type(screen.getByLabelText("発見物名を検索"), "不存在");
    expect(screen.getByText("条件に一致する発見物がありません")).toBeInTheDocument();
    expect(screen.getByText("検索条件または絞り込み条件を変更してください。")).toBeInTheDocument();
    expect(screen.queryByText("表示できる有効な発見物がありません")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "マスターデータを開く" })).not.toBeInTheDocument();
  });

  it("does not treat inactive-only master data as unregistered", async () => {
    const repositories = setup([profile(1)], [discovery(1, "合成発見物", { isActive: false })]);
    await openWithoutTable(repositories);
    expect(await screen.findByText("表示できる有効な発見物がありません")).toBeInTheDocument();
    expect(screen.getByText("「マスターデータ」画面で登録状況を確認してください。")).toBeInTheDocument();
    expect(screen.queryByText("発見物のマスターデータがありません")).not.toBeInTheDocument();
    expect(screen.queryByText("条件に一致する発見物がありません")).not.toBeInTheDocument();
    expect(screen.queryByText("検索条件または絞り込み条件を変更してください。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "マスターデータを開く" })).not.toBeInTheDocument();
  });

  it("uses one batch master query and one batch progress query", async () => {
    const repositories = setup([profile(1)], [discovery(1, "A"), discovery(2, "B")]);
    await open(repositories);
    expect(repositories.master.listWithRelations).toHaveBeenCalledTimes(1);
    expect(repositories.progress.listByProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "マスターデータを開く" })).not.toBeInTheDocument();
  });
});

interface Repositories { profiles: MockProfiles; master: MockMaster; progress: MockProgress; link: MockProgressLink }

function historySummary(id:number, firstReportStatus:DiscoveryStateSummary["firstReportStatus"], overrides:Partial<DiscoveryStateSummary> = {}):DiscoveryStateSummary {
  return {id,active:1,categoryName:"地理",experience:100,masterUpdatedAt:"m",discovered:1,reported:0,reportHold:0,progressUpdatedAt:"p",
    firstReportStatus,legacyMeritCredit:0,historyUpdatedAt:"h",automaticReporting:0,mapRelated:0,...overrides};
}

function categoryStats(categories: Array<{ id: number; name: string; sortOrder: number }>): ProgressStats {
  return {
    quests: { total: 0, completed: 0, incomplete: 0 },
    discoveries: { total: categories.length, discovered: 0, undiscovered: categories.length, unreported: 0, reported: 0, cardOwned: 0, cardCapableDiscovered: 0 },
    adventureMerit: { knownMerit: 0, reportedCount: 0, knownExperienceCount: 0, unknownExperienceCount: 0 },
    categories: categories.map((category): DiscoveryCategoryProgressStats => ({
      categoryId: category.id, categoryName: category.name, sortOrder: category.sortOrder,
      total: 1, discovered: 0, undiscovered: 1, unreported: 0, cardOwned: 0,
      canReport: category.name !== "レリック", hasCard: category.name !== "レリック",
    })),
  };
}

async function openDrilldown(repositories: Repositories, stats: ProgressStats) {
  const user = userEvent.setup();
  render(<App
    profileRepository={repositories.profiles}
    discoveryRepository={repositories.master}
    discoveryProgressRepository={repositories.progress}
    progressLinkService={repositories.link}
    progressStatsRepository={{ getForProfile: vi.fn(async () => stats) }}
    questRepository={{ listWithDiscoveries: vi.fn(async () => []), listDependencies: vi.fn(async () => []) }}
    questProgressRepository={{ listCompletedQuestIds: vi.fn(async () => []), markCompleted: vi.fn(async () => undefined), markIncomplete: vi.fn(async () => undefined) }}
  />);
  await screen.findByRole("heading", { name: "プロフィール" });
  await user.click(screen.getByRole("button", { name: "概要" }));
  await screen.findByRole("group", { name: "補助的な進捗" });
  return user;
}

function setup(profiles: Profile[], master: DiscoveryWithRelations[], byProfile = new Map<number, DiscoveryProgress[]>()) {
  const progress = new MockProgress(byProfile);
  return { profiles: new MockProfiles(profiles), master: new MockMaster(master), progress, link: new MockProgressLink(progress) };
}

async function open(repositories: Repositories, masterDataStatusRepository?: MasterDataStatusRepositoryPort) {
  const user = await openWithoutTable(repositories, masterDataStatusRepository);
  if (repositories.profiles.items.length && repositories.master.items.length) expect(await screen.findByRole("table")).toBeInTheDocument();
  return user;
}

async function openWithoutTable(repositories: Repositories, masterDataStatusRepository?: MasterDataStatusRepositoryPort) {
  const user = userEvent.setup();
  render(<App profileRepository={repositories.profiles} masterDataStatusRepository={masterDataStatusRepository} discoveryRepository={repositories.master} discoveryProgressRepository={repositories.progress} progressLinkService={repositories.link} />);
  await screen.findByRole("heading", { name: "プロフィール" });
  await user.click(screen.getByRole("button", { name: "発見物" }));
  return user;
}

function bodyRows(): HTMLElement[] { return within(screen.getByRole("table")).getAllByRole("row").slice(1); }

class MockProfiles implements ProfileRepositoryPort {
  constructor(readonly items: Profile[]) {}
  list = vi.fn(async () => [...this.items]);
  create = vi.fn(async () => { throw new Error("unused"); });
  update = vi.fn(async (_id: number, _input: UpdateProfileInput) => { throw new Error("unused"); });
  delete = vi.fn(async () => undefined);
}

class MockMaster implements DiscoveryRepositoryPort {
  constructor(readonly items: DiscoveryWithRelations[]) {}
  listWithRelations = vi.fn(async () => [...this.items]);
}

class MockProgress implements DiscoveryProgressRepositoryPort {
  constructor(private readonly values: Map<number, DiscoveryProgress[]>) {}
  listByProfile = vi.fn(async (profileId: number) => [...(this.values.get(profileId) ?? [])]);
  markDiscovered = vi.fn(async (profileId: number, discoveryId: number) => { this.set(profileId, progress(profileId, discoveryId)); });
  markUndiscovered = vi.fn(async (profileId: number, discoveryId: number) => { this.values.set(profileId, (this.values.get(profileId) ?? []).filter((item) => item.discoveryId !== discoveryId)); });
  setReported = vi.fn(async (profileId: number, discoveryId: number, reported: boolean) => { this.change(profileId, discoveryId, (item) => ({ ...item, reported })); });
  setCardOwned = vi.fn(async (profileId: number, discoveryId: number, cardOwned: boolean) => { this.change(profileId, discoveryId, (item) => ({ ...item, cardOwned })); });
  private set(profileId: number, item: DiscoveryProgress) { this.values.set(profileId, [...(this.values.get(profileId) ?? []).filter((value) => value.discoveryId !== item.discoveryId), item]); }
  private change(profileId: number, discoveryId: number, change: (item: DiscoveryProgress) => DiscoveryProgress) { const item = (this.values.get(profileId) ?? []).find((value) => value.discoveryId === discoveryId); if (item) this.set(profileId, change(item)); }
}

class MockProgressLink implements ProgressLinkServicePort {
  constructor(private readonly progress: MockProgress) {}
  completeQuestWithLinkedDiscoveries = vi.fn(async () => ({
    questChanged: true,
    discoveriesCreated: 0,
    discoveriesAlreadyPresent: 0,
  }));
  discoverWithLinkedQuest = vi.fn(async (profileId: number, discoveryId: number, selectedQuestId: number | null) => {
    await this.progress.markDiscovered(profileId, discoveryId);
    return {
      discoveryCreated: true,
      questCompleted: selectedQuestId !== null,
      questAlreadyCompleted: false,
      selectedQuestId,
    };
  });
}

function profile(id: number, name = "航海者"): Profile { return { id, name, memo: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }; }

function progress(profileId: number, discoveryId: number, reported = false, cardOwned = true, memo: string | null = null): DiscoveryProgress { return { profileId, discoveryId, reported, cardOwned, memo, updatedAt: "2026-01-01T00:00:00.000Z" }; }

function masterThree() { return [discovery(1, "未発見物"), discovery(2, "未報告物"), discovery(3, "報告済み物")]; }

function discovery(id: number, name: string, overrides: { isActive?: boolean; automaticReporting?: boolean; description?: string | null; notes?: string | null; category?: { id: number; name: string; sortOrder: number } | null; rank?: number | null; era?: string | null; points?: number | null; difficulty?: number | null; experience?: number | null; relatedQuests?: Array<{ id: number; title: string; notes?: string | null }> } = {}): DiscoveryWithRelations {
  return {
    automaticReporting: overrides.automaticReporting ?? false,
    discovery: { id, gvdbId: id + 1000, categoryId: overrides.category === null ? null : (overrides.category?.id ?? 1), name, rank: overrides.rank ?? null, description: overrides.description ?? null, era: overrides.era ?? null, points: overrides.points ?? null, difficulty: overrides.difficulty ?? null, experience: overrides.experience ?? null, notes: overrides.notes ?? null, sourceUpdatedAt: null, isActive: overrides.isActive ?? true, rawRowJson: "{}", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    category: overrides.category === null ? null : (overrides.category ?? { id: 1, name: "地理", sortOrder: 10 }),
    relatedQuests: (overrides.relatedQuests ?? []).map((quest) => ({ ...quest, notes: quest.notes ?? null, offerCity: null })),
  };
}
