CREATE TABLE search_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page TEXT NOT NULL CHECK (page IN ('quests', 'discoveries')),
    name TEXT NOT NULL CHECK (
        length(name) > 0 AND instr(name, char(0)) = 0
        AND name = trim(name, char(9, 10, 11, 12, 13, 32, 160, 5760,
            8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202,
            8232, 8233, 8239, 8287, 12288, 65279))
    ),
    definition_json TEXT NOT NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_used_at TEXT,
    UNIQUE (page, name),
    CONSTRAINT search_bookmarks_definition_format CHECK (
        CASE WHEN json_valid(definition_json) THEN
            json_type(definition_json, '$.schemaVersion') IS 'integer'
            AND json_extract(definition_json, '$.schemaVersion') >= 1
        ELSE 0 END
    ),
    CONSTRAINT search_bookmarks_definition_page CHECK (
        CASE WHEN json_valid(definition_json) THEN json_extract(definition_json, '$.page') IS page ELSE 0 END
    )
);

-- The write and limit checks share SQLite's writer lock, including across connections.
CREATE TRIGGER search_bookmarks_before_insert
BEFORE INSERT ON search_bookmarks
BEGIN
    SELECT CASE WHEN (SELECT COUNT(*) FROM search_bookmarks) >= 50
        THEN RAISE(ABORT, 'search_bookmark_limit') END;
    SELECT CASE WHEN NEW.is_favorite = 1 AND (SELECT COUNT(*) FROM search_bookmarks WHERE is_favorite = 1) >= 5
        THEN RAISE(ABORT, 'search_bookmark_favorite_limit') END;
END;

CREATE TRIGGER search_bookmarks_before_favorite
BEFORE UPDATE OF is_favorite ON search_bookmarks
WHEN OLD.is_favorite = 0 AND NEW.is_favorite = 1
BEGIN
    SELECT CASE WHEN (SELECT COUNT(*) FROM search_bookmarks WHERE is_favorite = 1) >= 5
        THEN RAISE(ABORT, 'search_bookmark_favorite_limit') END;
END;
