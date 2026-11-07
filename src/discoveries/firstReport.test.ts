
import { expect, it } from "vitest";
import { firstReportDisplay } from "./firstReport";
it("never infers report history from absent history or legacy credit",()=>{
  expect(firstReportDisplay({effectiveReported:false,automaticReporting:false,canReport:true,historyPresent:false})).toMatchObject({text:"不明",title:expect.stringContaining("記録されていません")});
  expect(firstReportDisplay({effectiveReported:false,automaticReporting:false,canReport:true,historyPresent:true,firstReportStatus:"unknown",legacyMeritCredit:true})).toMatchObject({text:"不明",title:expect.stringContaining("算入資格")});
  expect(firstReportDisplay({effectiveReported:true,automaticReporting:false,canReport:false,firstReportStatus:"confirmed"})).toMatchObject({text:"対象外"});
});

it.each([
  ["unknown",true,false,"✓"], [undefined,true,false,"✓"],
  ["unknown",false,false,"不明"], [undefined,false,false,"不明"],
  ["confirmed",false,false,"✓"], ["not_reported",false,false,"—"],
  ["not_reported",true,false,"要確認"], ["unknown",true,true,"不明"],
  [undefined,true,true,"不明"],
] as const)("handles %s / current report %s / automatic %s", (status,reported,automatic,text)=>{
  expect(firstReportDisplay({canReport:true,firstReportStatus:status,effectiveReported:reported,automaticReporting:automatic})).toMatchObject({text});
});
