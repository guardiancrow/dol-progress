CREATE TABLE quest_required_skills (
    quest_id       INTEGER NOT NULL,
    position       INTEGER NOT NULL,
    skill_name     TEXT NOT NULL,
    required_rank  INTEGER,
    is_language    INTEGER NOT NULL DEFAULT 0
                   CHECK (is_language IN (0, 1)),
    PRIMARY KEY (quest_id, position),
    CHECK (skill_name <> ''),
    CHECK (required_rank IS NULL OR required_rank > 0),
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE quest_offer_cities (
    quest_id   INTEGER NOT NULL,
    position   INTEGER NOT NULL,
    city_name  TEXT NOT NULL,
    PRIMARY KEY (quest_id, position),
    CHECK (city_name <> ''),
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX idx_quest_required_skills_skill_name
    ON quest_required_skills(skill_name);

CREATE INDEX idx_quest_required_skills_quest
    ON quest_required_skills(quest_id);

CREATE INDEX idx_quest_offer_cities_city_name
    ON quest_offer_cities(city_name);

CREATE INDEX idx_quest_offer_cities_quest
    ON quest_offer_cities(quest_id);
