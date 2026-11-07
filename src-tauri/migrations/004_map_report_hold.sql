ALTER TABLE discovery_progress ADD COLUMN report_hold INTEGER NOT NULL DEFAULT 0
    CHECK (report_hold IN (0, 1) AND (report_hold = 0 OR reported = 0));

CREATE TABLE discovery_reporting_history (
    profile_id INTEGER NOT NULL,
    discovery_id INTEGER NOT NULL,
    first_report_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (first_report_status IN ('unknown', 'not_reported', 'confirmed')),
    legacy_merit_credit INTEGER NOT NULL DEFAULT 0 CHECK (legacy_merit_credit IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (profile_id, discovery_id),
    CHECK (legacy_merit_credit = 0 OR first_report_status = 'unknown'),
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (discovery_id) REFERENCES discoveries(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 003時点の算入条件を固定する。実際の初回報告履歴は推定しない。
INSERT INTO discovery_reporting_history (profile_id, discovery_id, legacy_merit_credit)
SELECT dp.profile_id, dp.discovery_id, 1
FROM discovery_progress dp
JOIN discoveries d ON d.id = dp.discovery_id
LEFT JOIN discovery_categories c ON c.id = d.category_id
WHERE c.name IS NOT 'レリック'
AND (dp.reported = 1 OR dp.discovery_id IN (
    SELECT qd.discovery_id
    FROM quest_discoveries qd
    JOIN quests q ON q.id = qd.quest_id AND q.is_active = 1
    JOIN discoveries ad ON ad.id = qd.discovery_id
    LEFT JOIN discovery_categories ac ON ac.id = ad.category_id
    WHERE ac.name IS NOT 'レリック'
    GROUP BY qd.discovery_id
    HAVING COUNT(*) = 1 AND MAX(q.offer_method COLLATE BINARY IN
        ('追究クエスト', 'レガシー', 'トレジャーハント')) = 1
));
