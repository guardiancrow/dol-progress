.bail on

PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT INTO profiles (name, memo)
VALUES ('__phase3_smoke_profile_1__', NULL);

INSERT INTO profiles (name, memo)
VALUES ('__phase3_smoke_profile_2__', NULL);

INSERT INTO quests (gvdb_id, title, raw_row_json)
VALUES (2147000001, '__phase3_smoke_quest__', '{}');

INSERT INTO discoveries (gvdb_id, name, raw_row_json)
VALUES (2147000001, '__phase3_smoke_discovery__', '{}');

SELECT 'quest_initial=' || COUNT(*)
FROM quest_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
)
AND quest_id = (
    SELECT id FROM quests WHERE gvdb_id = 2147000001
);

INSERT INTO quest_progress (profile_id, quest_id)
VALUES (
    (SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'),
    (SELECT id FROM quests WHERE gvdb_id = 2147000001)
)
ON CONFLICT(profile_id, quest_id) DO NOTHING;

INSERT INTO quest_progress (profile_id, quest_id)
VALUES (
    (SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'),
    (SELECT id FROM quests WHERE gvdb_id = 2147000001)
)
ON CONFLICT(profile_id, quest_id) DO NOTHING;

SELECT 'quest_completed=' || COUNT(*)
FROM quest_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
);

SELECT 'quest_other_profile=' || COUNT(*)
FROM quest_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_2__'
);

DELETE FROM quest_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
)
AND quest_id = (
    SELECT id FROM quests WHERE gvdb_id = 2147000001
);

SELECT 'quest_incomplete=' || COUNT(*)
FROM quest_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
);

SELECT 'discovery_initial=' || COUNT(*)
FROM discovery_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
);

INSERT INTO discovery_progress
    (profile_id, discovery_id, reported, card_owned)
VALUES (
    (SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'),
    (SELECT id FROM discoveries WHERE gvdb_id = 2147000001),
    0,
    1
)
ON CONFLICT(profile_id, discovery_id) DO NOTHING;

SELECT 'discovery_new=' || reported || '|' || card_owned
FROM discovery_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
);

UPDATE discovery_progress
SET reported = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
);

UPDATE discovery_progress
SET card_owned = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
);

INSERT INTO discovery_progress
    (profile_id, discovery_id, reported, card_owned)
VALUES (
    (SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'),
    (SELECT id FROM discoveries WHERE gvdb_id = 2147000001),
    0,
    1
)
ON CONFLICT(profile_id, discovery_id) DO NOTHING;

SELECT 'discovery_preserved=' || reported || '|' || card_owned
FROM discovery_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
);

INSERT INTO discovery_progress
    (profile_id, discovery_id, reported, card_owned)
VALUES (
    (SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_2__'),
    (SELECT id FROM discoveries WHERE gvdb_id = 2147000001),
    0,
    1
);

SELECT 'discovery_other_profile=' || reported || '|' || card_owned
FROM discovery_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_2__'
);

DELETE FROM discovery_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
)
AND discovery_id = (
    SELECT id FROM discoveries WHERE gvdb_id = 2147000001
);

SELECT 'discovery_undiscovered=' || COUNT(*)
FROM discovery_progress
WHERE profile_id = (
    SELECT id FROM profiles WHERE name = '__phase3_smoke_profile_1__'
);

DELETE FROM profiles
WHERE name = '__phase3_smoke_profile_2__';

SELECT 'profile_cascade=' || COUNT(*)
FROM discovery_progress
WHERE discovery_id = (
    SELECT id FROM discoveries WHERE gvdb_id = 2147000001
);

ROLLBACK;
