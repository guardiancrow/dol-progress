# AGENTS.md

## 1. Project overview

This repository contains a local desktop application for managing personal progress in the MMORPG
「大航海時代 Online」.

The application uses publicly provided GVDB master data for quests and discovery items, while all
user-specific progress is stored locally.

The primary goals are:

- keep quest progress permanently on the user's PC;
- keep discovery progress permanently on the user's PC;
- manage the "unreported" state of discovered items;
- manage current discovery-card ownership independently from discovery/report status;
- support multiple character profiles;
- provide searching, filtering, and progress visualization;
- avoid unnecessary access to GVDB.

The application is intended for personal/local use. It is not a replacement for GVDB and must not
write data back to GVDB.

## 2. Authoritative specifications

The following files are the authoritative specifications for this project:

- Functional requirements: `docs/requirements.md`
- SQLite schema and persistence rules: `docs/database-design.md`
- GVDB master-data import rules: `docs/data-import.md`
- Backup and restore safety rules: `docs/backup-restore.md`

Do not duplicate detailed specifications in this file. When behavior changes, update the appropriate
authoritative specification together with the code.

If this file conflicts with a more detailed specification above, stop and identify the conflict
rather than silently inventing new behavior.

## 3. Technology stack

Use the following stack unless the specification is deliberately revised:

- Tauri 2
- React
- TypeScript
- Vite
- SQLite
- SQLx（Rustの`ActiveDatabase`による中央pool）
- TanStack Table for data-heavy list/table UI when the UI phase begins
- Vitest for TypeScript unit tests

TypeScript is the primary application language.

Use Rust only where Tauri or a platform capability genuinely requires it. Do not move ordinary
application logic into Rust without a concrete reason. Active database path resolution, pool lifecycle,
migration, and maintenance are Rust responsibilities so every DB access path uses one active database.
Data Rootのbootstrap解決、Custom root移行、RecoveryもRustの責務であり、Frontendや個別commandがDB pathを再構築してはならない。

Use the package manager already configured in the repository. Do not switch package managers as part
of unrelated work.

## 4. Non-negotiable data-safety rules

The following rules take priority over implementation convenience.

1. The application must not automatically access GVDB over the network.
2. The application must not implement write operations to GVDB.
3. Master-data import must never delete, reset, overwrite, or recreate user progress.
4. The following tables are user data and must not be modified by master-data import:
   - `profiles`
   - `quest_progress`
   - `discovery_progress`
5. Master records missing from a newly imported source file must not be hard-deleted.
   Set `is_active = 0` instead.
6. Master-data import must run inside a transaction.
7. A failed import must roll back completely.
8. Database schema changes must be performed through migrations.
9. Do not edit an already-applied migration to change schema history. Add a new migration.
10. Do not introduce destructive migrations without explicitly documenting the effect on existing
    user data and providing a safe migration path.
11. Do not assume that upstream GVDB data may be redistributed. Full upstream datasets must not be
    committed to the repository unless the user explicitly decides otherwise.

## 5. Architecture rules

Keep the UI, application logic, and persistence logic separated.

Recommended responsibility boundaries:

- React components: presentation and user interaction
- application/service layer: use cases and state transitions
- repository/data-access layer: SQL and persistence
- import module: parsing, validation, normalization, and transactional master updates

Do not place ad-hoc SQL directly inside React components.

Do not make UI components responsible for parsing GVDB files.

Prefer small, explicit modules over large generic abstractions.

Do not introduce an ORM unless the project specification is deliberately changed. SQLite access
should remain straightforward and auditable.

## 6. TypeScript rules

- Keep TypeScript strict mode enabled.
- Avoid `any` unless interfacing with an unavoidable untyped boundary.
- Validate external input before persisting it.
- Treat imported GVDB data as untrusted input.
- Use domain-specific types where they make state transitions clearer.
- Do not encode independent domain states into one combined enum when the specification models them
  separately.

In particular:

- quest completion is represented by the presence of a `quest_progress` row;
- discovery is represented by the presence of a `discovery_progress` row;
- `reported` and `card_owned` are independent flags.

## 7. SQLite rules

Follow `docs/database-design.md`.

In addition:

- enable SQLite foreign-key enforcement for every connection;
- use parameterized SQL;
- do not build SQL by concatenating untrusted text;
- keep master data and user progress logically separated;
- preserve external GVDB IDs separately from local primary keys;
- use transactions for operations that update more than one related master table;
- update `updated_at` explicitly when modifying rows whose timestamp is user-visible or operationally
  useful.

## 8. GVDB import rules

Follow `docs/data-import.md`.

Key invariants:

- no automatic download;
- user selects local files manually;
- source files are tab-delimited even though their extension is `.csv`;
- source encoding must be handled as CP932 / Windows-31J compatible data;
- validate headers before changing the database;
- validate all rows before entering the write phase where practical;
- compute SHA-256 and detect duplicate imports;
- resolve relationships by numeric GVDB ID, not by display name;
- never fabricate missing master records merely to satisfy a relationship;
- never modify user-progress tables during import.

## 9. Testing requirements

Changes to master-data import must include tests covering the affected behavior.

At minimum, import tests must cover:

- valid quest import;
- valid discovery import;
- CP932 decoding;
- tab-delimited parsing;
- empty optional fields;
- malformed required fields;
- relationship parsing;
- duplicate relationship removal;
- duplicate-file detection by SHA-256;
- inactive marking for master rows absent from the new file;
- preservation of `profiles`;
- preservation of `quest_progress`;
- preservation of `discovery_progress`;
- rollback when an import fails.

Use small synthetic fixtures. Do not require tests to access GVDB or the public internet.

When modifying database behavior, test migrations against an existing database state where practical,
not only against an empty database.

## 10. Network policy

The normal application must work offline.

Do not add:

- automatic update polling for GVDB data;
- background scraping;
- background master-data refresh;
- telemetry or analytics that transmits user progress;
- any GVDB POST/PUT/PATCH/DELETE behavior.

A future feature that changes this policy requires an explicit specification change.

## 11. Scope discipline

Do not add features simply because they appear useful.

The v1 scope is defined in `docs/requirements.md`.

Examples explicitly outside v1 include cloud sync, web-service deployment, user authentication,
smartphone synchronization, card history, and automatic GVDB downloads.

When a requested change is outside the current specification, identify it as a specification change
before implementing it.

## 12. Documentation rules

Documentation prose should be written in Japanese unless there is a strong reason to use English.

Code identifiers, SQL identifiers, filenames, and API names should use English.

When a code change alters documented behavior, update the relevant file under `docs/` in the same
change.

Keep comments focused on non-obvious constraints and reasoning. Do not comment self-evident code.

## 13. Definition of done

A change is complete only when:

- it follows the authoritative specifications;
- relevant tests pass;
- TypeScript type checking passes;
- the Tauri application still builds for the current development target;
- schema changes are represented by migrations;
- relevant documentation is updated;
- no user-progress safety invariant has been weakened.
