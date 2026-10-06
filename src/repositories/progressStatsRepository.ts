import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import { handleDatabaseErrors } from "../db/errors";
import { RELIC_CATEGORY_NAME } from "../discoveries/capabilities";
import type {
  AdventureMeritStats,
  DiscoveryCategoryProgressStats,
  DiscoveryProgressStats,
  ProgressStats,
} from "../overview/types";

interface QuestStatsRow {
  total: number;
  completed: number;
}

interface DiscoveryStatsRow {
  scope: "total" | "category";
  categoryId: number | null;
  categoryName: string | null;
  sortOrder: number | null;
  total: number;
  discovered: number;
  unreported: number;
  reported: number;
  cardOwned: number;
  cardCapableDiscovered: number;
  canReport: number | null;
  hasCard: number | null;
}

interface AdventureMeritStatsRow {
  knownMerit: number;
  reportedCount: number;
  knownExperienceCount: number;
  unknownExperienceCount: number;
}

export class ProgressStatsRepository {
  constructor(private readonly databaseProvider: DatabaseProvider = getDatabase) {}

  async getForProfile(profileId: number): Promise<ProgressStats> {
    return handleDatabaseErrors("progressStats.getForProfile", async () => {
      const database = await this.databaseProvider();
      const [questRows, discoveryRows, adventureMeritRows] = await Promise.all([
        database.select<QuestStatsRow[]>(
          `SELECT COUNT(*) AS total,
                  COUNT(qp.quest_id) AS completed
           FROM quests q
           LEFT JOIN quest_progress qp
             ON qp.quest_id = q.id AND qp.profile_id = $1
           WHERE q.is_active = 1`,
          [profileId],
        ),
        database.select<DiscoveryStatsRow[]>(
          `WITH active_progress AS (
             SELECT dp.discovery_id, dp.reported, dp.card_owned
             FROM discovery_progress dp
             WHERE dp.profile_id = $1
           ), stats AS (
             SELECT d.category_id AS categoryId,
                    COUNT(*) AS total,
                    COUNT(ap.discovery_id) AS discovered,
                    CASE WHEN c.name = '${RELIC_CATEGORY_NAME}' THEN 0 ELSE 1 END AS canReport,
                    CASE WHEN c.name = '${RELIC_CATEGORY_NAME}' THEN 0 ELSE 1 END AS hasCard,
                    COALESCE(SUM(CASE WHEN c.name IS NOT '${RELIC_CATEGORY_NAME}' AND ap.discovery_id IS NOT NULL AND ap.reported = 0 THEN 1 ELSE 0 END), 0) AS unreported,
                    COALESCE(SUM(CASE WHEN c.name IS NOT '${RELIC_CATEGORY_NAME}' AND ap.discovery_id IS NOT NULL AND ap.reported = 1 THEN 1 ELSE 0 END), 0) AS reported,
                    COALESCE(SUM(CASE WHEN c.name IS NOT '${RELIC_CATEGORY_NAME}' AND ap.discovery_id IS NOT NULL AND ap.card_owned = 1 THEN 1 ELSE 0 END), 0) AS cardOwned,
                    COALESCE(SUM(CASE WHEN c.name IS NOT '${RELIC_CATEGORY_NAME}' AND ap.discovery_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS cardCapableDiscovered
             FROM discoveries d
             LEFT JOIN discovery_categories c ON c.id = d.category_id
             LEFT JOIN active_progress ap ON ap.discovery_id = d.id
             WHERE d.is_active = 1
             GROUP BY d.category_id
           )
           SELECT 'total' AS scope,
                  NULL AS categoryId,
                  NULL AS categoryName,
                  NULL AS sortOrder,
                  COALESCE(SUM(total), 0) AS total,
                  COALESCE(SUM(discovered), 0) AS discovered,
                  COALESCE(SUM(unreported), 0) AS unreported,
                  COALESCE(SUM(reported), 0) AS reported,
                  COALESCE(SUM(cardOwned), 0) AS cardOwned,
                  COALESCE(SUM(cardCapableDiscovered), 0) AS cardCapableDiscovered,
                  NULL AS canReport,
                  NULL AS hasCard
           FROM stats
           UNION ALL
           SELECT 'category' AS scope,
                  c.id AS categoryId,
                  c.name AS categoryName,
                  c.sort_order AS sortOrder,
                  s.total,
                  s.discovered,
                  s.unreported,
                  s.reported,
                  s.cardOwned,
                  s.cardCapableDiscovered,
                  s.canReport,
                  s.hasCard
           FROM stats s
           JOIN discovery_categories c ON c.id = s.categoryId
           WHERE s.total > 0
           ORDER BY scope DESC, sortOrder, categoryName`,
          [profileId],
        ),
        database.select<AdventureMeritStatsRow[]>(
          `SELECT COALESCE(SUM(d.experience), 0) AS knownMerit,
                  COUNT(*) AS reportedCount,
                  COUNT(d.experience) AS knownExperienceCount,
                  COALESCE(SUM(CASE WHEN d.experience IS NULL THEN 1 ELSE 0 END), 0) AS unknownExperienceCount
           FROM discovery_progress dp
           JOIN discoveries d ON d.id = dp.discovery_id
           LEFT JOIN discovery_categories c ON c.id = d.category_id
           WHERE dp.profile_id = $1
             AND dp.reported = 1
             AND c.name IS NOT $2`,
          [profileId, RELIC_CATEGORY_NAME],
        ),
      ]);

      const quest = questRows[0] ?? { total: 0, completed: 0 };
      const discovery = discoveryRows.find((row) => row.scope === "total");
      const discoveries = mapDiscoveryStats(discovery);
      const adventureMerit = mapAdventureMeritStats(adventureMeritRows[0]);
      const categories = discoveryRows
        .filter(isCategoryRow)
        .map(mapCategoryStats);

      return {
        quests: {
          total: quest.total,
          completed: quest.completed,
          incomplete: quest.total - quest.completed,
        },
        discoveries,
        adventureMerit,
        categories,
      };
    });
  }
}

function mapAdventureMeritStats(
  row: AdventureMeritStatsRow | undefined,
): AdventureMeritStats {
  return {
    knownMerit: row?.knownMerit ?? 0,
    reportedCount: row?.reportedCount ?? 0,
    knownExperienceCount: row?.knownExperienceCount ?? 0,
    unknownExperienceCount: row?.unknownExperienceCount ?? 0,
  };
}

function mapDiscoveryStats(row: DiscoveryStatsRow | undefined): DiscoveryProgressStats {
  const total = row?.total ?? 0;
  const discovered = row?.discovered ?? 0;
  return {
    total,
    discovered,
    undiscovered: total - discovered,
    unreported: row?.unreported ?? 0,
    reported: row?.reported ?? 0,
    cardOwned: row?.cardOwned ?? 0,
    cardCapableDiscovered: row?.cardCapableDiscovered ?? 0,
  };
}

function isCategoryRow(
  row: DiscoveryStatsRow,
): row is DiscoveryStatsRow & {
  categoryId: number;
  categoryName: string;
  sortOrder: number;
} {
  return (
    row.scope === "category" &&
    row.categoryId !== null &&
    row.categoryName !== null &&
    row.sortOrder !== null
  );
}

function mapCategoryStats(
  row: DiscoveryStatsRow & {
    categoryId: number;
    categoryName: string;
    sortOrder: number;
  },
): DiscoveryCategoryProgressStats {
  return {
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    sortOrder: row.sortOrder,
    total: row.total,
    discovered: row.discovered,
    undiscovered: row.total - row.discovered,
    unreported: row.unreported,
    cardOwned: row.cardOwned,
    canReport: row.canReport === 1,
    hasCard: row.hasCard === 1,
  };
}
