use futures_core::future::BoxFuture;
use sqlx::{
    error::BoxDynError,
    migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator},
    SqlitePool,
};

pub(crate) const INITIAL_SCHEMA: &str = include_str!("../migrations/001_initial.sql");
pub(crate) const QUEST_FACETS_SCHEMA: &str = include_str!("../migrations/002_quest_facets.sql");
pub(crate) const MASTER_SOURCE_ORDER_SCHEMA: &str =
    include_str!("../migrations/003_master_source_order.sql");

#[derive(Debug)]
struct MigrationList(Vec<MigrationDefinition>);

#[derive(Debug)]
struct MigrationDefinition {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

pub(crate) struct MigrationIdentity {
    pub(crate) version: i64,
    pub(crate) description: &'static str,
    pub(crate) checksum: &'static [u8],
}

const INITIAL_SCHEMA_CHECKSUM: &[u8] = &[
    0xd9, 0xab, 0x12, 0xca, 0xb1, 0xa0, 0x35, 0x3b, 0x38, 0xc4, 0xa9, 0x08, 0x78, 0xa7, 0x51, 0x78,
    0x0f, 0x13, 0x79, 0xbc, 0xea, 0xe6, 0x2c, 0xa0, 0x2a, 0xd8, 0xf0, 0x55, 0x86, 0xb8, 0x9e, 0xce,
    0xff, 0x1d, 0xb8, 0x73, 0xbd, 0x8b, 0x3c, 0x62, 0x4d, 0x22, 0x82, 0xe3, 0x3b, 0xc1, 0x97, 0x9e,
];
const QUEST_FACETS_CHECKSUM: &[u8] = &[
    0x75, 0x4d, 0xcb, 0x97, 0xdb, 0x22, 0x68, 0x48, 0x4c, 0x80, 0x72, 0x6d, 0xc5, 0x92, 0xfa, 0x6d,
    0xe6, 0xc1, 0x83, 0xc8, 0x39, 0x18, 0x7a, 0xe3, 0x8e, 0xf4, 0xd1, 0x42, 0x20, 0x50, 0x6f, 0x34,
    0x05, 0x50, 0xad, 0x05, 0xba, 0x7c, 0x26, 0xa8, 0x48, 0xc0, 0xb6, 0x1f, 0x33, 0x57, 0x09, 0x55,
];
const MASTER_SOURCE_ORDER_CHECKSUM: &[u8] = &[
    0x5d, 0xda, 0x5f, 0x40, 0x1e, 0xf9, 0x6f, 0xc6, 0x6e, 0x1e, 0x24, 0xe7, 0xe1, 0xa9, 0xc0, 0xde,
    0xb1, 0x70, 0x04, 0xca, 0x4c, 0xda, 0xd0, 0xaf, 0x27, 0x08, 0x5d, 0xde, 0x70, 0xa5, 0xe8, 0x3b,
    0x37, 0x70, 0x0c, 0x40, 0x5a, 0x48, 0xad, 0x7f, 0xcf, 0x86, 0xa7, 0x49, 0xa2, 0xb0, 0xfe, 0xda,
];

pub(crate) const SUPPORTED_MIGRATION_PREFIX: [MigrationIdentity; 3] = [
    MigrationIdentity {
        version: 1,
        description: "initial_schema",
        checksum: INITIAL_SCHEMA_CHECKSUM,
    },
    MigrationIdentity {
        version: 2,
        description: "quest_facets",
        checksum: QUEST_FACETS_CHECKSUM,
    },
    MigrationIdentity {
        version: 3,
        description: "master_source_order",
        checksum: MASTER_SOURCE_ORDER_CHECKSUM,
    },
];

impl MigrationSource<'static> for MigrationList {
    fn resolve(self) -> BoxFuture<'static, std::result::Result<Vec<SqlxMigration>, BoxDynError>> {
        Box::pin(async move {
            Ok(self
                .0
                .into_iter()
                .map(|migration| {
                    SqlxMigration::new(
                        migration.version,
                        migration.description.into(),
                        MigrationType::ReversibleUp,
                        migration.sql.into(),
                        false,
                    )
                })
                .collect())
        })
    }
}

fn all() -> MigrationList {
    MigrationList(vec![
        MigrationDefinition {
            version: 1,
            description: "initial_schema",
            sql: INITIAL_SCHEMA,
        },
        MigrationDefinition {
            version: 2,
            description: "quest_facets",
            sql: QUEST_FACETS_SCHEMA,
        },
        MigrationDefinition {
            version: 3,
            description: "master_source_order",
            sql: MASTER_SOURCE_ORDER_SCHEMA,
        },
    ])
}

/// Runs the historical migrations with metadata compatible with Phase 12.
pub(crate) async fn run(pool: &SqlitePool) -> Result<(), String> {
    let migrator = Migrator::new(all())
        .await
        .map_err(|error| error.to_string())?;
    migrator.run(pool).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};

    use super::{run, INITIAL_SCHEMA, QUEST_FACETS_SCHEMA};

    fn test_path(label: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "dol-progress-migration-{label}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        directory.join("test.db")
    }

    fn lowercase_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[tokio::test]
    async fn fresh_database_applies_each_historical_migration_once() {
        let path = test_path("fresh");
        let pool = SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();

        run(&pool).await.unwrap();
        run(&pool).await.unwrap();

        let migrations: Vec<(i64, String, bool, Vec<u8>)> = sqlx::query_as(
            "SELECT version, description, success, checksum FROM _sqlx_migrations ORDER BY version",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(migrations.len(), 3);
        assert_eq!(migrations[0].0, 1);
        assert_eq!(migrations[0].1, "initial_schema");
        assert!(migrations[0].2);
        assert_eq!(
            lowercase_hex(&migrations[0].3),
            "d9ab12cab1a0353b38c4a90878a751780f1379bceae62ca02ad8f05586b89eceff1db873bd8b3c624d2282e33bc1979e"
        );
        assert_eq!(migrations[1].0, 2);
        assert_eq!(migrations[1].1, "quest_facets");
        assert!(migrations[1].2);
        assert_eq!(
            lowercase_hex(&migrations[1].3),
            "754dcb97db2268484c80726dc592fa6de6c183c839187ae38ef4d14220506f340550ad05ba7c26a848c0b61f33570955"
        );
        assert_eq!(migrations[2].0, 3);
        assert_eq!(migrations[2].1, "master_source_order");
        assert!(migrations[2].2);
        assert_eq!(
            lowercase_hex(&migrations[2].3),
            "5dda5f401ef96fc66e1e24e7e1a9c0deb17004ca4cdad0af27085dde70a5e83b37700c405a48ad7fcf86a749a2b0feda"
        );

        pool.close().await;
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn existing_database_adds_nullable_source_order_without_changing_master_identity_or_progress(
    ) {
        let path = test_path("legacy-v2");
        let pool = SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();

        sqlx::raw_sql(INITIAL_SCHEMA).execute(&pool).await.unwrap();
        sqlx::raw_sql(QUEST_FACETS_SCHEMA)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE _sqlx_migrations (\
               version BIGINT PRIMARY KEY, description TEXT NOT NULL,\
               installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\
               success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL\
             );\
             INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES\
               (1, 'initial_schema', 1, X'D9AB12CAB1A0353B38C4A90878A751780F1379BCEAE62CA02AD8F05586B89ECEFF1DB873BD8B3C624D2282E33BC1979E', 1),\
               (2, 'quest_facets', 1, X'754DCB97DB2268484C80726DC592FA6DE6C183C839187AE38EF4D14220506F340550AD05BA7C26A848C0B61F33570955', 1);\
             INSERT INTO profiles (id, name) VALUES (1, 'legacy profile');\
             INSERT INTO quests (id, gvdb_id, title, raw_row_json) VALUES (7, 700, 'legacy quest', '{}');\
             INSERT INTO discoveries (id, gvdb_id, name, raw_row_json) VALUES (8, 800, 'legacy discovery', '{}');\
             INSERT INTO quest_discoveries (quest_id, discovery_id) VALUES (7, 8);\
             INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, 7, 'preserve quest');\
             INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo)\
               VALUES (1, 8, 1, 0, 'preserve discovery');",
        )
        .execute(&pool)
        .await
        .unwrap();

        run(&pool).await.unwrap();

        let quest: (i64, i64, Option<i64>) =
            sqlx::query_as("SELECT id, gvdb_id, source_order FROM quests WHERE id = 7")
                .fetch_one(&pool)
                .await
                .unwrap();
        let discovery: (i64, i64, Option<i64>) =
            sqlx::query_as("SELECT id, gvdb_id, source_order FROM discoveries WHERE id = 8")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(quest, (7, 700, None));
        assert_eq!(discovery, (8, 800, None));
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quest_progress WHERE profile_id = 1 AND quest_id = 7",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 8",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quest_discoveries WHERE quest_id = 7 AND discovery_id = 8",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );

        pool.close().await;
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
