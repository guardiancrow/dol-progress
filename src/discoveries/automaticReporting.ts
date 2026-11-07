import meritEligibleSql from "./meritEligibleDiscoveries.sql?raw";
import specialReportingQuestsSql from "./specialReportingQuests.sql?raw";
import automaticReportingSql from "./automaticReportingDiscoveries.sql?raw";

// Current master data determines this state; it does not record the discovery route.
export const automaticReportingDiscoveriesSql = automaticReportingSql.replace(
  "__SPECIAL_REPORTING_QUESTS__", specialReportingQuestsSql,
);


export const meritEligibleDiscoveriesSql = meritEligibleSql.replace(
  "__AUTOMATIC_REPORTING_DISCOVERIES__", automaticReportingDiscoveriesSql,
);
