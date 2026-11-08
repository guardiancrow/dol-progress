// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryTable } from "../components/discoveries/DiscoveryTable";

import type { DiscoveryRowViewModel } from "./types";




afterEach(cleanup);
function row(id:number, discovered:boolean, reported=false, mapRelated=true):DiscoveryRowViewModel {
  return {id,name:`発見${id}`,description:null,notes:null,category:{id:1,name:"史跡",sortOrder:1},rank:1,era:null,points:1,difficulty:1,experience:100,
    relatedQuests:[],mapRelated,canReport:true,hasCard:true,automaticReporting:false,effectiveReported:reported,
    status:!discovered?"undiscovered":reported?"reported":"unreported",updating:false,
    progress:discovered?{profileId:1,discoveryId:id,reported,cardOwned:true,memo:"keep",updatedAt:"p"}:null};
}
const actions={onToggleDiscovered:vi.fn(async()=>undefined),onSetReported:vi.fn(async()=>undefined),onSetCardOwned:vi.fn(async()=>undefined)};

it("lists unreported map discoveries, combines existing filters and adds no column or row buttons",async()=>{
  const user=userEvent.setup();
  render(<DiscoveryTable rows={[row(1,true),row(2,true,true),row(3,false),row(4,true,false,false)]} paginationResetKey={1} {...actions}/>);
  const first=screen.getByText("発見1").closest("tr")!;
  expect(within(first).getByText("地図・再入手抑止")).toBeInTheDocument();
  expect(within(screen.getByText("発見2").closest("tr")!).getByText("地図・再入手候補")).toBeInTheDocument();
  expect(within(screen.getByText("発見3").closest("tr")!).getByText("地図・再入手候補")).toBeInTheDocument();
  expect(within(screen.getByText("発見4").closest("tr")!).queryByText(/地図/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(12);
  expect(screen.queryByRole("button",{name:/報告履歴|維持する|維持を解除/})).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("地図"),"related");
  expect(screen.getByText("発見1")).toBeInTheDocument();
  expect(screen.getByText("発見2")).toBeInTheDocument();
  expect(screen.getByText("発見3")).toBeInTheDocument();
  expect(screen.queryByText("発見4")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("地図"),"suppressed");
  expect(screen.getByText("発見1")).toBeInTheDocument();
  expect(screen.queryByText("発見4")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("状態"),"reported");
  expect(screen.getByText("条件に一致する発見物がありません")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("地図"),"candidate");
  expect(screen.getByText("発見2")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("状態"),"all");
  await user.selectOptions(screen.getByLabelText("分類"),"1");
  await user.type(screen.getByLabelText("発見物名を検索"),"発見3");
  expect(screen.getByText("発見3")).toBeInTheDocument();
  expect(screen.queryByText("発見2")).not.toBeInTheDocument();
});

it("has no correction entry and preserves ordinary discovery, reporting and card actions",async()=>{
  const user=userEvent.setup();
  const handlers={onToggleDiscovered:vi.fn(async()=>undefined),onSetReported:vi.fn(async()=>undefined),onSetCardOwned:vi.fn(async()=>undefined)};
  render(<DiscoveryTable rows={[row(1,true)]} paginationResetKey={1} {...handlers}/>);
  expect(screen.queryByRole("button",{name:/進捗入力の訂正|報告履歴|訂正画面を開く/})).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox",{name:"発見1の発見状態"}));
  await user.click(screen.getByRole("checkbox",{name:"発見1の報告状態"}));
  await user.click(screen.getByRole("checkbox",{name:"発見1のカード所有状態"}));
  expect(handlers.onToggleDiscovered).toHaveBeenCalledExactlyOnceWith(1,true);
  expect(handlers.onSetReported).toHaveBeenCalledExactlyOnceWith(1,true);
  expect(handlers.onSetCardOwned).toHaveBeenCalledExactlyOnceWith(1,false);
});

it("preserves automatic reporting and marks relics and ambiguous relationships for review",()=>{
  const automatic={...row(1,true),automaticReporting:true,effectiveReported:true,status:"reported" as const};
  const relic={...row(2,true),canReport:false,hasCard:false,category:{id:2,name:"レリック",sortOrder:2}};
  const multiple={...row(3,true),mapNeedsReview:true};
  render(<DiscoveryTable rows={[automatic,relic,multiple]} paginationResetKey={1} {...actions}/>);
  expect(within(screen.getByText("発見1").closest("tr")!).getByText("地図・再入手候補")).toBeInTheDocument();
  for(const id of [2,3]) expect(within(screen.getByText(`発見${id}`).closest("tr")!).getByText("地図・判定保留")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox",{name:"発見1の報告状態"})).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox",{name:"発見2のカード所有状態"})).not.toBeInTheDocument();
});

it("explains each pending map decision on hover or focus and filters by the same label", async () => {
  const user = userEvent.setup();
  const relic = {...row(1,true),canReport:false,hasCard:false};
  const multiple = {...row(2,true),mapNeedsReview:true};
  const both = {...row(3,true),canReport:false,mapNeedsReview:true};
  render(<DiscoveryTable rows={[relic,multiple,both,row(4,true)]} paginationResetKey={1} {...actions}/>);
  await user.selectOptions(screen.getByLabelText("地図"), "review");
  expect(screen.queryByText("発見4")).not.toBeInTheDocument();
  expect(screen.getByText("4件中 3件表示")).toBeInTheDocument();
  const relicRow = within(screen.getByText("発見1").closest("tr")!);
  expect(relicRow.getByRole("tooltip")).toHaveTextContent("報告対象外の発見物");
  expect(relicRow.getByRole("tooltip")).not.toHaveTextContent("複数");
  const multipleRow = within(screen.getByText("発見2").closest("tr")!);
  expect(multipleRow.getByRole("tooltip")).toHaveTextContent("一つの地図に複数の発見物");
  expect(multipleRow.getByRole("tooltip")).not.toHaveTextContent("報告対象外");
  const bothRow = within(screen.getByText("発見3").closest("tr")!);
  expect(bothRow.getByRole("tooltip")).toHaveTextContent("複数の発見物");
  expect(bothRow.getByRole("tooltip")).toHaveTextContent("報告対象外");
  expect(multipleRow.getByLabelText(/地図・判定保留：一つの地図/)).toHaveAttribute("tabindex", "0");
  expect(screen.queryByText("地図・要確認")).not.toBeInTheDocument();
});

it("filters all current unreported discoveries by saved history, including non-map and missing history", async () => {
  const user = userEvent.setup();
  const rows: DiscoveryRowViewModel[] = [
    {...row(1,true),firstReportStatus:"not_reported"},
    {...row(2,true),firstReportStatus:"confirmed"},
    {...row(3,true,false,false),firstReportStatus:"unknown",legacyMeritCredit:true},
    {...row(4,true,false,false),historyPresent:false},
    {...row(5,true,false,false),firstReportStatus:"not_reported",category:null},
    {...row(6,true),firstReportStatus:"not_reported",automaticReporting:true,effectiveReported:true},
    {...row(7,true),firstReportStatus:"confirmed",canReport:false,hasCard:false},
    {...row(8,false),firstReportStatus:"confirmed"},
    {...row(9,true,true),firstReportStatus:"confirmed"},
    {...row(10,true,false,false),firstReportStatus:"confirmed"},
    {...row(11,true),firstReportStatus:"not_reported",unreportedHistoryReady:false},
  ];
  const before = structuredClone(rows);
  const handlers={onToggleDiscovered:vi.fn(),onSetReported:vi.fn(),onSetCardOwned:vi.fn()};
  render(<DiscoveryTable rows={rows} paginationResetKey={1} {...handlers}/>);
  await user.selectOptions(screen.getByLabelText("状態"), "unreported");
  for (const [value, ids] of [["not_reported",[1,5]], ["confirmed",[2,10]], ["unknown",[3,4]]] as const) {
    await user.selectOptions(screen.getByLabelText("未報告の内訳"), value);
    expect(within(screen.getByRole("table")).getAllByRole("row").slice(1).map(r=>within(r).getByText(/^発見\d+$/).textContent)).toEqual(ids.map(id=>`発見${id}`));
    expect(screen.getByText("11件中 2件表示")).toBeInTheDocument();
    expect(screen.getByText("未報告 2件")).toBeInTheDocument();
  }
  await user.selectOptions(screen.getByLabelText("状態"), "reported");
  expect(screen.getByText("条件に一致する発見物がありません")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("未報告の内訳"), "all");
  expect(screen.getByText("発見9")).toBeInTheDocument();
  expect(rows).toEqual(before);
  for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
});

it("combines breakdown with category, card, map and search filters", async () => {
  const user = userEvent.setup();
  const rows = [row(1,true),row(2,true),row(3,true,false,false),{...row(4,true),category:null}]
    .map(r=>({...r,firstReportStatus:"not_reported" as const}));
  rows[1].progress!.cardOwned=false;
  render(<DiscoveryTable rows={rows} paginationResetKey={1} {...actions}/>);
  await user.selectOptions(screen.getByLabelText("未報告の内訳"), "not_reported");
  await user.selectOptions(screen.getByLabelText("状態"), "unreported");
  await user.selectOptions(screen.getByLabelText("分類"), "1");
  await user.selectOptions(screen.getByLabelText("カード所有"), "owned");
  await user.selectOptions(screen.getByLabelText("地図"), "suppressed");
  expect(screen.getByText("4件中 1件表示")).toBeInTheDocument();
  expect(screen.getByText("発見1")).toBeInTheDocument();
  await user.type(screen.getByLabelText("発見物名を検索"), "発見2");
  expect(screen.getByText("条件に一致する発見物がありません")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("カード所有"), "not-owned");
  expect(screen.getByText("発見2")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("未報告の内訳"), "all");
  expect(screen.getByLabelText("状態")).toHaveValue("unreported");
  expect(screen.getByLabelText("地図")).toHaveValue("suppressed");
  expect(screen.getByText("4件中 1件表示")).toBeInTheDocument();
});

it("resets paging after breakdown changes and preserves sorting and page sizes", async () => {
  const user = userEvent.setup();
  const rows = Array.from({length:120},(_,i)=>({...row(i+1,true),firstReportStatus:i<60?"not_reported" as const:"confirmed" as const}));
  render(<DiscoveryTable rows={rows} paginationResetKey={1} {...actions}/>);
  await user.click(screen.getByRole("button",{name:"次ページ"}));
  expect(screen.getByText("2 / 3ページ")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("未報告の内訳"), "confirmed");
  expect(screen.getByText("1 / 2ページ")).toBeInTheDocument();
  expect(screen.getByText("120件中 60件表示")).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"発見物名で並べ替え"}));
  await user.click(screen.getByRole("button",{name:"発見物名で並べ替え"}));
  expect(within(screen.getByRole("table")).getAllByRole("row")[1]).toHaveTextContent("発見120");
  await user.click(screen.getByRole("button",{name:"次ページ"}));
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(11);
  await user.selectOptions(screen.getByLabelText("1ページの件数"), "100");
  expect(screen.getByText("1 / 1ページ")).toBeInTheDocument();
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(61);
  await user.selectOptions(screen.getByLabelText("未報告の内訳"), "unknown");
  expect(screen.getByText("0 / 0ページ")).toBeInTheDocument();
});
