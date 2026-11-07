WITH map_relations AS (
  SELECT mq.discovery_id,
    MAX((SELECT COUNT(*) FROM quest_discoveries all_mq WHERE all_mq.quest_id=m.id)<>1) AS needs_review
  FROM quest_discoveries mq JOIN quests m ON m.id=mq.quest_id
  WHERE m.is_active=1 AND m.offer_method COLLATE BINARY IN
    ('地理学','考古学','宗教学','生物学','美術','財宝鑑定','天文学')
  GROUP BY mq.discovery_id
)
SELECT d.id, d.is_active AS active, c.name AS categoryName, d.experience, d.updated_at AS masterUpdatedAt,
  dp.discovery_id IS NOT NULL AS discovered,
  COALESCE(dp.reported,0) AS reported, COALESCE(dp.report_hold,0) AS reportHold,
  dp.updated_at AS progressUpdatedAt,
  COALESCE(h.first_report_status,'unknown') AS firstReportStatus,
  COALESCE(h.legacy_merit_credit,0) AS legacyMeritCredit,
  h.updated_at AS historyUpdatedAt,
  d.id IN (__AUTOMATIC_REPORTING_DISCOVERIES__) AS automaticReporting,
  mr.discovery_id IS NOT NULL AS mapRelated,
  COALESCE(mr.needs_review,0) AS mapNeedsReview
FROM discoveries d
LEFT JOIN discovery_categories c ON c.id=d.category_id
LEFT JOIN discovery_progress dp ON dp.discovery_id=d.id AND dp.profile_id=$1
LEFT JOIN discovery_reporting_history h ON h.discovery_id=d.id AND h.profile_id=$1
LEFT JOIN map_relations mr ON mr.discovery_id=d.id
ORDER BY d.id
