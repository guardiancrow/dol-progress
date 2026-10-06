PRAGMA foreign_keys = ON;

CREATE TABLE profiles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    memo        TEXT,
    created_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE discovery_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
                CHECK (is_active IN (0, 1)),
    created_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE quests (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    gvdb_id              INTEGER NOT NULL UNIQUE,
    title                TEXT NOT NULL,
    difficulty           INTEGER,
    chrono_quest         TEXT,
    offer_method         TEXT,
    offer_city           TEXT,
    required_skills      TEXT,
    discovery_type_text  TEXT,
    reward_items         TEXT,
    notes                TEXT,
    chain_name           TEXT,
    chain_order          INTEGER,
    source_updated_at    TEXT,
    is_active            INTEGER NOT NULL DEFAULT 1
                         CHECK (is_active IN (0, 1)),
    raw_row_json         TEXT NOT NULL,
    created_at           TEXT NOT NULL
                         DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at           TEXT NOT NULL
                         DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE discoveries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    gvdb_id            INTEGER NOT NULL UNIQUE,
    category_id        INTEGER,
    name               TEXT NOT NULL,
    rank               INTEGER,
    description        TEXT,
    era                TEXT,
    points             INTEGER,
    difficulty         INTEGER,
    experience         INTEGER,
    notes              TEXT,
    source_updated_at  TEXT,
    is_active          INTEGER NOT NULL DEFAULT 1
                       CHECK (is_active IN (0, 1)),
    raw_row_json       TEXT NOT NULL,
    created_at         TEXT NOT NULL
                       DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at         TEXT NOT NULL
                       DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (category_id)
        REFERENCES discovery_categories(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE quest_discoveries (
    quest_id      INTEGER NOT NULL,
    discovery_id  INTEGER NOT NULL,
    PRIMARY KEY (quest_id, discovery_id),
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (discovery_id)
        REFERENCES discoveries(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE quest_dependencies (
    quest_id               INTEGER NOT NULL,
    prerequisite_quest_id  INTEGER NOT NULL,
    PRIMARY KEY (quest_id, prerequisite_quest_id),
    CHECK (quest_id <> prerequisite_quest_id),
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (prerequisite_quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE quest_progress (
    profile_id  INTEGER NOT NULL,
    quest_id    INTEGER NOT NULL,
    memo        TEXT,
    updated_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (profile_id, quest_id),
    FOREIGN KEY (profile_id)
        REFERENCES profiles(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE discovery_progress (
    profile_id    INTEGER NOT NULL,
    discovery_id  INTEGER NOT NULL,
    reported      INTEGER NOT NULL DEFAULT 0
                  CHECK (reported IN (0, 1)),
    card_owned    INTEGER NOT NULL DEFAULT 1
                  CHECK (card_owned IN (0, 1)),
    memo          TEXT,
    updated_at    TEXT NOT NULL
                  DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (profile_id, discovery_id),
    FOREIGN KEY (profile_id)
        REFERENCES profiles(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (discovery_id)
        REFERENCES discoveries(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE master_import_history (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset                TEXT NOT NULL
                           CHECK (dataset IN ('quests', 'discoveries')),
    file_name              TEXT NOT NULL,
    file_sha256            TEXT NOT NULL,
    row_count              INTEGER,
    source_max_updated_at  TEXT,
    imported_at            TEXT NOT NULL
                           DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    notes                  TEXT,
    UNIQUE (dataset, file_sha256)
);

CREATE INDEX idx_quests_title
    ON quests(title);

CREATE INDEX idx_quests_offer_method
    ON quests(offer_method);

CREATE INDEX idx_quests_offer_city
    ON quests(offer_city);

CREATE INDEX idx_quests_active
    ON quests(is_active);

CREATE INDEX idx_discoveries_name
    ON discoveries(name);

CREATE INDEX idx_discoveries_category
    ON discoveries(category_id);

CREATE INDEX idx_discoveries_active
    ON discoveries(is_active);

CREATE INDEX idx_quest_discoveries_discovery
    ON quest_discoveries(discovery_id);

CREATE INDEX idx_quest_dependencies_prerequisite
    ON quest_dependencies(prerequisite_quest_id);

CREATE INDEX idx_discovery_progress_profile_reported
    ON discovery_progress(profile_id, reported);

CREATE INDEX idx_discovery_progress_profile_card_owned
    ON discovery_progress(profile_id, card_owned);
