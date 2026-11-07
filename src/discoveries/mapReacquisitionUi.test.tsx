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
  for(const id of [2,3]) expect(within(screen.getByText(`発見${id}`).closest("tr")!).getByText("地図・要確認")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox",{name:"発見1の報告状態"})).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox",{name:"発見2のカード所有状態"})).not.toBeInTheDocument();
});
