import { MAP_OFFER_METHODS } from "../quests/offerMethods";

export const MAP_TARGET_OFFER_METHODS = [...MAP_OFFER_METHODS, "陸地再調査時の報酬"] as const;

export function mapTargetDiscoveriesSql(firstParameter: number): string {
  const parameters = MAP_TARGET_OFFER_METHODS.map((_, index) => `$${firstParameter + index}`).join(", ");
  return `SELECT DISTINCT qd.discovery_id
          FROM quest_discoveries qd
          JOIN quests q ON q.id = qd.quest_id
          WHERE q.is_active = 1 AND q.offer_method COLLATE BINARY IN (${parameters})`;
}
