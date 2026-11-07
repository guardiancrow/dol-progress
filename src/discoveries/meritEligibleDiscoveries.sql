SELECT discovery_id FROM discovery_reporting_history
WHERE profile_id = $1
  AND (first_report_status = 'confirmed' OR legacy_merit_credit = 1)
UNION
SELECT discovery_id FROM discovery_progress
WHERE profile_id = $1 AND discovery_id IN (__AUTOMATIC_REPORTING_DISCOVERIES__)
