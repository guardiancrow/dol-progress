use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection, SqlitePool};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::active_database::ActiveDatabase;

const REQUIRED_COLUMNS_V1: &[(&str, &[&str])] = &[
    (
        "_sqlx_migrations",
        &[
            "version",
            "description",
            "installed_on",
            "success",
            "checksum",
            "execution_time",
        ],
    ),
    (
        "profiles",
        &["id", "name", "memo", "created_at", "updated_at"],
    ),
    (
        "quests",
        &[
            "id",
            "gvdb_id",
            "title",
            "difficulty",
            "chrono_quest",
            "offer_method",
            "offer_city",
            "required_skills",
            "discovery_type_text",
            "reward_items",
            "notes",
            "chain_name",
            "chain_order",
            "source_updated_at",
            "is_active",
            "raw_row_json",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "discoveries",
        &[
            "id",
            "gvdb_id",
            "category_id",
            "name",
            "rank",
            "description",
            "era",
            "points",
            "difficulty",
            "experience",
            "notes",
            "source_updated_at",
            "is_active",
            "raw_row_json",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "discovery_categories",
        &[
            "id",
            "name",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "quest_progress",
        &["profile_id", "quest_id", "memo", "updated_at"],
    ),
    (
        "discovery_progress",
        &[
            "profile_id",
            "discovery_id",
            "reported",
            "card_owned",
            "memo",
            "updated_at",
        ],
    ),
    ("quest_discoveries", &["quest_id", "discovery_id"]),
    ("quest_dependencies", &["quest_id", "prerequisite_quest_id"]),
    (
        "master_import_history",
        &[
            "id",
            "dataset",
            "file_name",
            "file_sha256",
            "row_count",
            "source_max_updated_at",
            "imported_at",
            "notes",
        ],
    ),
];
const REQUIRED_COLUMNS_V2: &[(&str, &[&str])] = &[
    (
        "quest_required_skills",
        &[
            "quest_id",
            "position",
            "skill_name",
            "required_rank",
            "is_language",
        ],
    ),
    ("quest_offer_cities", &["quest_id", "position", "city_name"]),
];
const REQUIRED_COLUMNS_V3: &[(&str, &[&str])] = &[
    ("quests", &["source_order"]),
    ("discoveries", &["source_order"]),
];

static UNIQUE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct RestoreSelectionState(Mutex<Option<RestoreSelection>>);

struct RestoreSelection {
    token: String,
    path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    file_name: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreCandidate {
    token: String,
    file_name: String,
    size_bytes: u64,
    migration_version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    restart_requested: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreError {
    kind: &'static str,
    user_message: String,
    detail: String,
}

impl BackupRestoreError {
    fn new(kind: &'static str, user_message: &'static str, detail: impl Into<String>) -> Self {
        Self {
            kind,
            user_message: user_message.into(),
            detail: detail.into(),
        }
    }

    fn backup(detail: impl Into<String>) -> Self {
        Self::new(
            "BackupFailed",
            "バックアップを作成できませんでした。",
            detail,
        )
    }

    fn backup_validation(detail: impl Into<String>) -> Self {
        Self::new(
            "BackupValidationFailed",
            "作成したバックアップの検証に失敗しました。",
            detail,
        )
    }

    fn invalid(detail: impl Into<String>) -> Self {
        Self::new(
            "InvalidBackup",
            "有効なDOL Progress Managerバックアップではありません。",
            detail,
        )
    }

    fn incompatible(detail: impl Into<String>) -> Self {
        Self::new(
            "IncompatibleBackup",
            "このバックアップは現在のアプリと互換性がありません。",
            detail,
        )
    }

    fn restore(detail: impl Into<String>) -> Self {
        Self::new(
            "RestoreFailed",
            "バックアップから復元できませんでした。現在のデータは維持されています。",
            detail,
        )
    }
}

#[derive(Debug)]
struct ValidationError {
    incompatible: bool,
    detail: String,
}

#[tauri::command]
pub async fn create_database_backup(
    app: AppHandle,
    database: State<'_, ActiveDatabase>,
) -> Result<Option<BackupResult>, BackupRestoreError> {
    let default_name = backup_file_name();
    let selected = app
        .dialog()
        .file()
        .add_filter("SQLite backup", &["sqlite3"])
        .set_file_name(&default_name)
        .blocking_save_file();
    let Some(destination) = selected else {
        return Ok(None);
    };
    let destination = local_path(destination, BackupRestoreError::backup)?;
    let current = database.database_path();
    ensure_distinct_paths(&current, &destination).map_err(BackupRestoreError::backup)?;
    create_active_backup(&database, &destination)
        .await
        .map(Some)
}

#[tauri::command]
pub async fn select_restore_backup(
    app: AppHandle,
    database: State<'_, ActiveDatabase>,
    selections: State<'_, RestoreSelectionState>,
) -> Result<Option<RestoreCandidate>, BackupRestoreError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("SQLite backup", &["sqlite3", "db"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = local_path(selected, BackupRestoreError::invalid)?;
    let current = database.database_path();
    ensure_distinct_paths(&current, &path).map_err(BackupRestoreError::invalid)?;
    let validation = validate_database(&path)
        .await
        .map_err(map_validation_error)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| BackupRestoreError::invalid(format!("Cannot read metadata: {error}")))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| BackupRestoreError::invalid("Backup file name is not valid Unicode"))?
        .to_owned();
    let token = unique_suffix();
    *selections
        .0
        .lock()
        .map_err(|_| BackupRestoreError::invalid("Restore selection state is poisoned"))? =
        Some(RestoreSelection {
            token: token.clone(),
            path,
        });
    Ok(Some(RestoreCandidate {
        token,
        file_name,
        size_bytes: metadata.len(),
        migration_version: validation,
    }))
}

#[tauri::command]
pub async fn restore_database_backup(
    app: AppHandle,
    database: State<'_, ActiveDatabase>,
    selections: State<'_, RestoreSelectionState>,
    token: String,
) -> Result<RestoreResult, BackupRestoreError> {
    let selected = selections
        .0
        .lock()
        .map_err(|_| BackupRestoreError::restore("Restore selection state is poisoned"))?
        .take()
        .filter(|selection| selection.token == token)
        .ok_or_else(|| BackupRestoreError::restore("Restore selection is missing or expired"))?;
    database
        .with_maintenance(|current| {
            let current = current.to_path_buf();
            let source = selected.path.clone();
            async move {
                restore_backup(&current, &source)
                    .await
                    .map_err(|error| error.detail)
            }
        })
        .await
        .map_err(BackupRestoreError::restore)?;
    app.request_restart();
    Ok(RestoreResult {
        restart_requested: true,
    })
}

async fn create_backup(
    current: &Path,
    destination: &Path,
) -> Result<BackupResult, BackupRestoreError> {
    let temporary = sibling_temporary_path(destination, "backup");
    remove_if_exists(&temporary).map_err(BackupRestoreError::backup)?;
    let result = async {
        vacuum_into(current, &temporary)
            .await
            .map_err(BackupRestoreError::backup)?;
        validate_database(&temporary)
            .await
            .map_err(|error| BackupRestoreError::backup_validation(error.detail))?;
        replace_destination(&temporary, destination).map_err(BackupRestoreError::backup)?;
        let size_bytes = fs::metadata(destination)
            .map_err(|error| BackupRestoreError::backup(error.to_string()))?
            .len();
        let file_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| BackupRestoreError::backup("Destination file name is not Unicode"))?
            .to_owned();
        Ok(BackupResult {
            file_name,
            size_bytes,
        })
    }
    .await;
    if result.is_err() {
        let _ = remove_if_exists(&temporary);
    }
    result
}

async fn create_active_backup(
    database: &ActiveDatabase,
    destination: &Path,
) -> Result<BackupResult, BackupRestoreError> {
    let temporary = sibling_temporary_path(destination, "backup");
    remove_if_exists(&temporary).map_err(BackupRestoreError::backup)?;
    let pool = database.pool().await;
    let result = async {
        vacuum_into_pool(&pool, &temporary)
            .await
            .map_err(BackupRestoreError::backup)?;
        validate_database(&temporary)
            .await
            .map_err(|error| BackupRestoreError::backup_validation(error.detail))?;
        replace_destination(&temporary, destination).map_err(BackupRestoreError::backup)?;
        let size_bytes = fs::metadata(destination)
            .map_err(|error| BackupRestoreError::backup(error.to_string()))?
            .len();
        let file_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| BackupRestoreError::backup("Destination file name is not Unicode"))?
            .to_owned();
        Ok(BackupResult {
            file_name,
            size_bytes,
        })
    }
    .await;
    if result.is_err() {
        let _ = remove_if_exists(&temporary);
    }
    result
}

pub(crate) async fn restore_backup(
    current: &Path,
    source: &Path,
) -> Result<(), BackupRestoreError> {
    restore_backup_with_failure(current, source, RestoreFailurePoint::None).await
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RestoreFailurePoint {
    None,
    AfterCurrentRename,
}

async fn restore_backup_with_failure(
    current: &Path,
    source: &Path,
    failure_point: RestoreFailurePoint,
) -> Result<(), BackupRestoreError> {
    validate_database(source)
        .await
        .map_err(map_validation_error)?;
    let parent = current
        .parent()
        .ok_or_else(|| BackupRestoreError::restore("Current database has no parent directory"))?;
    fs::create_dir_all(parent).map_err(|error| BackupRestoreError::restore(error.to_string()))?;
    let staging = sibling_temporary_path(current, "restore-staging");
    let safety = sibling_temporary_path(current, "pre-restore-safety");
    let rollback = sibling_temporary_path(current, "restore-rollback");
    for path in [&staging, &safety, &rollback] {
        remove_if_exists(path).map_err(BackupRestoreError::restore)?;
    }

    let operation = async {
        create_backup(current, &safety).await.map_err(|error| {
            BackupRestoreError::restore(format!(
                "Pre-restore safety backup failed: {}",
                error.detail
            ))
        })?;
        fs::copy(source, &staging).map_err(|error| {
            BackupRestoreError::restore(format!("Staging copy failed: {error}"))
        })?;
        validate_database(&staging)
            .await
            .map_err(map_validation_error)?;
        checkpoint_database(current).await?;
        remove_sqlite_sidecars(current).map_err(BackupRestoreError::restore)?;
        fs::rename(current, &rollback).map_err(|error| {
            BackupRestoreError::restore(format!("Current DB rename failed: {error}"))
        })?;
        let replacement = if failure_point == RestoreFailurePoint::AfterCurrentRename {
            Err(std::io::Error::other(
                "Injected failure after current DB rename",
            ))
        } else {
            fs::rename(&staging, current)
        };
        if let Err(error) = replacement {
            let rollback_error = fs::rename(&rollback, current).err();
            return Err(BackupRestoreError::restore(format!(
                "Replacement failed: {error}; rollback error: {rollback_error:?}"
            )));
        }
        if let Err(error) = validate_database(current).await {
            let _ = remove_if_exists(current);
            let rollback_result = fs::rename(&rollback, current);
            return Err(BackupRestoreError::restore(format!(
                "Restored DB validation failed: {}; rollback: {rollback_result:?}",
                error.detail
            )));
        }
        let _ = remove_if_exists(&rollback);
        let _ = remove_if_exists(&safety);
        Ok(())
    }
    .await;

    if operation.is_err() {
        let _ = remove_if_exists(&staging);
        if !current.exists() && safety.exists() {
            let _ = fs::rename(&safety, current);
        }
    }
    operation
}

async fn vacuum_into(source: &Path, destination: &Path) -> Result<(), String> {
    let mut connection = open_database(source).await?;
    sqlx::query("VACUUM INTO ?")
        .bind(destination.to_string_lossy().to_string())
        .execute(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    connection.close().await.map_err(|error| error.to_string())
}

async fn vacuum_into_pool(pool: &SqlitePool, destination: &Path) -> Result<(), String> {
    sqlx::query("VACUUM INTO ?")
        .bind(destination.to_string_lossy().to_string())
        .execute(pool)
        .await
        .map_err(|error| error.to_string())
        .map(|_| ())
}

async fn checkpoint_database(path: &Path) -> Result<(), BackupRestoreError> {
    let mut connection = open_database(path)
        .await
        .map_err(BackupRestoreError::restore)?;
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&mut connection)
        .await
        .map_err(|error| BackupRestoreError::restore(error.to_string()))?;
    connection
        .close()
        .await
        .map_err(|error| BackupRestoreError::restore(error.to_string()))
}

async fn open_database(path: &Path) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .foreign_keys(true);
    SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| error.to_string())
}

async fn validate_database(path: &Path) -> Result<i64, ValidationError> {
    let mut connection = open_database(path)
        .await
        .map_err(|detail| ValidationError {
            incompatible: false,
            detail,
        })?;
    let quick_check: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| ValidationError {
            incompatible: false,
            detail: error.to_string(),
        })?;
    if quick_check != "ok" {
        return Err(ValidationError {
            incompatible: false,
            detail: format!("PRAGMA quick_check returned: {quick_check}"),
        });
    }
    let foreign_key_violations: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&mut connection)
            .await
            .map_err(|error| ValidationError {
                incompatible: false,
                detail: error.to_string(),
            })?;
    if foreign_key_violations != 0 {
        return Err(ValidationError {
            incompatible: false,
            detail: format!("PRAGMA foreign_key_check returned {foreign_key_violations} rows"),
        });
    }
    validate_required_columns(&mut connection, REQUIRED_COLUMNS_V1).await?;
    let version = validate_migration_history(&mut connection).await?;
    if version >= 2 {
        validate_required_columns(&mut connection, REQUIRED_COLUMNS_V2).await?;
    }
    if version >= 3 {
        validate_required_columns(&mut connection, REQUIRED_COLUMNS_V3).await?;
    }
    connection.close().await.map_err(|error| ValidationError {
        incompatible: false,
        detail: error.to_string(),
    })?;
    Ok(version)
}

async fn validate_migration_history(
    connection: &mut SqliteConnection,
) -> Result<i64, ValidationError> {
    let rows = sqlx::query(
        "SELECT version, description, success, checksum FROM _sqlx_migrations ORDER BY version",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| ValidationError {
        incompatible: true,
        detail: error.to_string(),
    })?;
    if rows.is_empty() {
        return Err(ValidationError {
            incompatible: true,
            detail: "Migration history is empty".into(),
        });
    }
    if rows.len() > crate::migrations::SUPPORTED_MIGRATION_PREFIX.len() {
        return Err(ValidationError {
            incompatible: true,
            detail: "Migration history contains an unknown version".into(),
        });
    }
    for (index, row) in rows.iter().enumerate() {
        let expected = &crate::migrations::SUPPORTED_MIGRATION_PREFIX[index];
        let version: i64 = row.get("version");
        let description: String = row.get("description");
        let success: bool = row.get("success");
        let checksum: Vec<u8> = row.get("checksum");
        if version != expected.version
            || description != expected.description
            || !success
            || checksum.as_slice() != expected.checksum
        {
            return Err(ValidationError {
                incompatible: true,
                detail: format!(
                    "Migration history does not match the supported prefix at version {version}"
                ),
            });
        }
    }
    Ok(crate::migrations::SUPPORTED_MIGRATION_PREFIX[rows.len() - 1].version)
}

async fn validate_required_columns(
    connection: &mut SqliteConnection,
    requirements: &[(&str, &[&str])],
) -> Result<(), ValidationError> {
    let tables: std::collections::HashSet<String> =
        sqlx::query("SELECT name FROM sqlite_schema WHERE type = 'table'")
            .fetch_all(&mut *connection)
            .await
            .map_err(|error| ValidationError {
                incompatible: false,
                detail: error.to_string(),
            })?
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();
    for (table, expected_columns) in requirements {
        if !tables.contains(*table) {
            return Err(ValidationError {
                incompatible: false,
                detail: format!("Required table is missing: {table}"),
            });
        }
        let columns: std::collections::HashSet<String> =
            sqlx::query(&format!("PRAGMA table_info(\"{table}\")"))
                .fetch_all(&mut *connection)
                .await
                .map_err(|error| ValidationError {
                    incompatible: false,
                    detail: error.to_string(),
                })?
                .iter()
                .map(|row| row.get::<String, _>("name"))
                .collect();
        let missing: Vec<&str> = expected_columns
            .iter()
            .copied()
            .filter(|column| !columns.contains(*column))
            .collect();
        if !missing.is_empty() {
            return Err(ValidationError {
                incompatible: false,
                detail: format!(
                    "Required columns are missing from {table}: {}",
                    missing.join(", ")
                ),
            });
        }
    }
    Ok(())
}

/// Shared validation for a candidate active data root. This does not create a
/// database and is intentionally stricter than merely opening SQLite.
pub(crate) async fn validate_application_database(path: &Path) -> Result<i64, String> {
    validate_database(path).await.map_err(|error| error.detail)
}

pub(crate) async fn snapshot_pool_into(
    pool: &SqlitePool,
    destination: &Path,
) -> Result<(), String> {
    vacuum_into_pool(pool, destination).await
}

pub(crate) fn replace_staged_database(temporary: &Path, destination: &Path) -> Result<(), String> {
    replace_destination(temporary, destination)
}

fn map_validation_error(error: ValidationError) -> BackupRestoreError {
    if error.incompatible {
        BackupRestoreError::incompatible(error.detail)
    } else {
        BackupRestoreError::invalid(error.detail)
    }
}

fn local_path(
    path: FilePath,
    error: fn(String) -> BackupRestoreError,
) -> Result<PathBuf, BackupRestoreError> {
    match path {
        FilePath::Path(path) => Ok(path),
        FilePath::Url(url) => Err(error(format!("Only local paths are supported: {url}"))),
    }
}

fn ensure_distinct_paths(first: &Path, second: &Path) -> Result<(), String> {
    let normalize = |path: &Path| -> Result<PathBuf, String> {
        let parent = path
            .parent()
            .ok_or_else(|| "Path has no parent directory".to_string())?;
        let parent = parent.canonicalize().map_err(|error| error.to_string())?;
        Ok(parent.join(
            path.file_name()
                .ok_or_else(|| "Path has no file name".to_string())?,
        ))
    };
    let first = normalize(first)?;
    let second = normalize(second)?;
    #[cfg(windows)]
    let same = first
        .to_string_lossy()
        .eq_ignore_ascii_case(&second.to_string_lossy());
    #[cfg(not(windows))]
    let same = first == second;
    if same {
        Err("The live database cannot be used as a backup path".into())
    } else {
        Ok(())
    }
}

fn replace_destination(temporary: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return fs::rename(temporary, destination).map_err(|error| error.to_string());
    }
    let previous = sibling_temporary_path(destination, "previous");
    remove_if_exists(&previous)?;
    fs::rename(destination, &previous).map_err(|error| error.to_string())?;
    match fs::rename(temporary, destination) {
        Ok(()) => {
            let _ = remove_if_exists(&previous);
            Ok(())
        }
        Err(error) => {
            let rollback = fs::rename(&previous, destination);
            Err(format!(
                "Destination replace failed: {error}; rollback: {rollback:?}"
            ))
        }
    }
}

fn remove_sqlite_sidecars(database: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", database.to_string_lossy()));
        remove_if_exists(&sidecar)?;
    }
    Ok(())
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn sibling_temporary_path(path: &Path, label: &str) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("dol-progress.sqlite3");
    path.with_file_name(format!(".{name}.{label}-{}", unique_suffix()))
}

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = UNIQUE_ID.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{counter:x}")
}

fn backup_file_name() -> String {
    // UTC keeps filename generation dependency-free and Windows-safe.
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("dol-progress-backup-{seconds}.sqlite3")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::{INITIAL_SCHEMA, MASTER_SOURCE_ORDER_SCHEMA, QUEST_FACETS_SCHEMA};

    fn test_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("dol-progress-{label}-{}", unique_suffix()));
        fs::create_dir_all(&path).expect("test directory must be created");
        path
    }

    async fn create_application_database(path: &Path) {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .expect("test database must open");
        sqlx::raw_sql(INITIAL_SCHEMA)
            .execute(&mut connection)
            .await
            .expect("initial schema must apply");
        sqlx::raw_sql(QUEST_FACETS_SCHEMA)
            .execute(&mut connection)
            .await
            .expect("quest facets schema must apply");
        sqlx::raw_sql(MASTER_SOURCE_ORDER_SCHEMA)
            .execute(&mut connection)
            .await
            .expect("master source order schema must apply");
        sqlx::raw_sql(
            "CREATE TABLE _sqlx_migrations (\
               version BIGINT PRIMARY KEY, description TEXT NOT NULL,\
               installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\
               success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL\
             );\
             INSERT INTO _sqlx_migrations\
               (version, description, success, checksum, execution_time)\
             VALUES (1, 'initial_schema', 1, X'D9AB12CAB1A0353B38C4A90878A751780F1379BCEAE62CA02AD8F05586B89ECEFF1DB873BD8B3C624D2282E33BC1979E', 1);\
             INSERT INTO _sqlx_migrations\
               (version, description, success, checksum, execution_time)\
             VALUES (2, 'quest_facets', 1, X'754DCB97DB2268484C80726DC592FA6DE6C183C839187AE38EF4D14220506F340550AD05BA7C26A848C0B61F33570955', 1);\
             INSERT INTO profiles (id, name, memo, created_at, updated_at) VALUES\
               (1, 'Profile A', 'alpha memo', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),\
               (2, 'Profile B', 'bravo memo', '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z');\
             INSERT INTO quests\
               (id, gvdb_id, title, difficulty, offer_method, offer_city, required_skills,\
                notes, source_updated_at, is_active, raw_row_json, created_at, updated_at) VALUES\
               (1, 1001, 'Quest One', 3, '酒場', 'リスボン', '探索(3)', 'quest one memo',\
                '2026-02-01 01:00:00', 1, '{\"ID\":\"1001\"}', '2026-02-02T00:00:00.000Z', '2026-02-03T00:00:00.000Z'),\
               (2, 1002, 'Quest Two', 6, '地図', 'セビリア', '考古学(6)', 'quest two memo',\
                '2026-02-04 01:00:00', 1, '{\"ID\":\"1002\"}', '2026-02-05T00:00:00.000Z', '2026-02-06T00:00:00.000Z'),\
               (3, 1003, 'Quest Three', 8, '勅命', 'ロンドン', '宗教学(8)', NULL,\
                '2026-02-07 01:00:00', 0, '{\"ID\":\"1003\"}', '2026-02-08T00:00:00.000Z', '2026-02-09T00:00:00.000Z');\
             INSERT INTO discovery_categories\
               (id, name, sort_order, is_active, created_at, updated_at) VALUES\
               (1, '史跡', 10, 1, '2026-03-01T00:00:00.000Z', '2026-03-02T00:00:00.000Z'),\
               (2, '宗教建築', 20, 1, '2026-03-03T00:00:00.000Z', '2026-03-04T00:00:00.000Z');\
             INSERT INTO discoveries\
               (id, gvdb_id, category_id, name, rank, description, points, difficulty,\
                experience, notes, source_updated_at, is_active, raw_row_json, created_at, updated_at) VALUES\
               (1, 2001, 1, 'Discovery One', 1, 'first', 2, 3, 100, 'one memo',\
                '2026-04-01 01:00:00', 1, '{\"ID\":\"2001\"}', '2026-04-02T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),\
               (2, 2002, 2, 'Discovery Two', 2, 'second', 4, 5, 200, 'two memo',\
                '2026-04-04 01:00:00', 1, '{\"ID\":\"2002\"}', '2026-04-05T00:00:00.000Z', '2026-04-06T00:00:00.000Z'),\
               (3, 2003, 1, 'Discovery Three', 3, 'third', 6, 7, 300, NULL,\
                '2026-04-07 01:00:00', 0, '{\"ID\":\"2003\"}', '2026-04-08T00:00:00.000Z', '2026-04-09T00:00:00.000Z');\
             INSERT INTO quest_discoveries (quest_id, discovery_id) VALUES (1, 1), (2, 2), (3, 3);\
             INSERT INTO quest_dependencies (quest_id, prerequisite_quest_id) VALUES (2, 1), (3, 2);\
             INSERT INTO quest_required_skills (quest_id, position, skill_name, required_rank, is_language) VALUES\
               (1, 0, '探索', 3, 0), (2, 0, '考古学', 6, 0), (3, 0, '宗教学', 8, 0);\
             INSERT INTO quest_offer_cities (quest_id, position, city_name) VALUES\
               (1, 0, 'リスボン'), (2, 0, 'セビリア'), (3, 0, 'ロンドン');\
             INSERT INTO quest_progress (profile_id, quest_id, memo)\
               VALUES (1, 1, 'A completed one'), (2, 2, 'B completed two');\
             INSERT INTO discovery_progress\
               (profile_id, discovery_id, reported, card_owned, memo)\
               VALUES\
                 (1, 1, 0, 1, 'discovered unreported'),\
                 (1, 2, 1, 1, 'reported with card'),\
                 (2, 3, 1, 0, 'reported without card');\
             INSERT INTO master_import_history\
               (id, dataset, file_name, file_sha256, row_count, source_max_updated_at, imported_at, notes)\
               VALUES (1, 'quests', 'quests.csv',\
                 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 3,\
                 '2026-02-07 01:00:00', '2026-05-01T00:00:00.000Z', 'acceptance baseline');",
        )
        .execute(&mut connection)
        .await
        .expect("representative data must be inserted");
        sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (3, 'master_source_order', 1, X'5DDA5F401EF96FC66E1E24E7E1A9C0DEB17004CA4CDAD0AF27085DDE70A5E83B37700C405A48AD7FCF86A749A2B0FEDA', 1)")
            .execute(&mut connection)
            .await
            .expect("master source order migration history must apply");
        connection.close().await.expect("test DB must close");
    }

    async fn create_phase_10_database(path: &Path) {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(INITIAL_SCHEMA)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE _sqlx_migrations (\
               version BIGINT PRIMARY KEY, description TEXT NOT NULL,\
               installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\
               success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL\
             );\
             INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)\
               VALUES (1, 'initial_schema', 1, X'D9AB12CAB1A0353B38C4A90878A751780F1379BCEAE62CA02AD8F05586B89ECEFF1DB873BD8B3C624D2282E33BC1979E', 1);\
             INSERT INTO profiles (id, name, memo) VALUES (1, 'Phase 10 Profile', 'keep profile');\
             INSERT INTO quests (id, gvdb_id, title, offer_city, required_skills, raw_row_json)\
               VALUES (1, 100, 'テスト依頼A', 'アテネ,チュニス',\
                       '探索(2),ギリシャ語(2),サルベージ', '{}');\
             INSERT INTO discoveries (id, gvdb_id, name, raw_row_json)\
               VALUES (1, 2001, 'Phase 10 Discovery', '{}');\
             INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, 1, 'keep quest');\
             INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo)\
               VALUES (1, 1, 1, 0, 'keep discovery');\
             INSERT INTO master_import_history (dataset, file_name, file_sha256, row_count)\
               VALUES ('quests', 'quests.csv', 'phase10-upgrade-hash', 1);",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        connection.close().await.unwrap();
    }

    async fn scalar(path: &Path, query: &str) -> i64 {
        let mut connection = open_database(path).await.expect("database must open");
        let value = sqlx::query_scalar(query)
            .fetch_one(&mut connection)
            .await
            .expect("scalar query must succeed");
        connection.close().await.expect("database must close");
        value
    }

    async fn profile_name(path: &Path) -> String {
        let mut connection = open_database(path).await.expect("database must open");
        let value = sqlx::query_scalar("SELECT name FROM profiles WHERE id = 1")
            .fetch_one(&mut connection)
            .await
            .expect("profile must exist");
        connection.close().await.expect("database must close");
        value
    }

    #[derive(Debug, PartialEq, Eq)]
    struct ApplicationSnapshot {
        profiles: Vec<String>,
        quests: Vec<String>,
        discoveries: Vec<String>,
        discovery_categories: Vec<String>,
        quest_discoveries: Vec<String>,
        quest_dependencies: Vec<String>,
        quest_required_skills: Vec<String>,
        quest_offer_cities: Vec<String>,
        quest_progress: Vec<String>,
        discovery_progress: Vec<String>,
        master_import_history: Vec<String>,
    }

    async fn snapshot_rows(path: &Path, query: &str) -> Vec<String> {
        let mut connection = open_database(path).await.expect("database must open");
        let rows = sqlx::query_scalar(query)
            .fetch_all(&mut connection)
            .await
            .expect("snapshot query must succeed");
        connection.close().await.expect("database must close");
        rows
    }

    async fn application_snapshot(path: &Path) -> ApplicationSnapshot {
        ApplicationSnapshot {
            profiles: snapshot_rows(
                path,
                "SELECT json_array(id,name,memo,created_at,updated_at) FROM profiles ORDER BY id",
            )
            .await,
            quests: snapshot_rows(
                path,
                "SELECT json_array(id,gvdb_id,title,difficulty,chrono_quest,offer_method,offer_city,required_skills,discovery_type_text,reward_items,notes,chain_name,chain_order,source_updated_at,source_order,is_active,raw_row_json,created_at,updated_at) FROM quests ORDER BY id",
            )
            .await,
            discoveries: snapshot_rows(
                path,
                "SELECT json_array(id,gvdb_id,category_id,name,rank,description,era,points,difficulty,experience,notes,source_updated_at,source_order,is_active,raw_row_json,created_at,updated_at) FROM discoveries ORDER BY id",
            )
            .await,
            discovery_categories: snapshot_rows(
                path,
                "SELECT json_array(id,name,sort_order,is_active,created_at,updated_at) FROM discovery_categories ORDER BY id",
            )
            .await,
            quest_discoveries: snapshot_rows(
                path,
                "SELECT json_array(quest_id,discovery_id) FROM quest_discoveries ORDER BY quest_id,discovery_id",
            )
            .await,
            quest_dependencies: snapshot_rows(
                path,
                "SELECT json_array(quest_id,prerequisite_quest_id) FROM quest_dependencies ORDER BY quest_id,prerequisite_quest_id",
            )
            .await,
            quest_required_skills: snapshot_rows(
                path,
                "SELECT json_array(quest_id,position,skill_name,required_rank,is_language) FROM quest_required_skills ORDER BY quest_id,position",
            )
            .await,
            quest_offer_cities: snapshot_rows(
                path,
                "SELECT json_array(quest_id,position,city_name) FROM quest_offer_cities ORDER BY quest_id,position",
            )
            .await,
            quest_progress: snapshot_rows(
                path,
                "SELECT json_array(profile_id,quest_id,memo,updated_at) FROM quest_progress ORDER BY profile_id,quest_id",
            )
            .await,
            discovery_progress: snapshot_rows(
                path,
                "SELECT json_array(profile_id,discovery_id,reported,card_owned,memo,updated_at) FROM discovery_progress ORDER BY profile_id,discovery_id",
            )
            .await,
            master_import_history: snapshot_rows(
                path,
                "SELECT json_array(id,dataset,file_name,file_sha256,row_count,source_max_updated_at,imported_at,notes) FROM master_import_history ORDER BY id",
            )
            .await,
        }
    }

    async fn integrity(path: &Path) -> (String, i64) {
        let mut connection = open_database(path).await.expect("database must open");
        let quick_check = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&mut connection)
            .await
            .expect("quick_check must succeed");
        let foreign_key_violations =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&mut connection)
                .await
                .expect("foreign_key_check must succeed");
        connection.close().await.expect("database must close");
        (quick_check, foreign_key_violations)
    }

    fn operation_artifacts(directory: &Path) -> Vec<PathBuf> {
        let mut artifacts: Vec<PathBuf> = fs::read_dir(directory)
            .expect("test directory must be readable")
            .map(|entry| entry.expect("directory entry must be readable").path())
            .filter(|path| {
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("");
                name.contains(".backup-")
                    || name.contains(".previous-")
                    || name.contains(".restore-staging-")
                    || name.contains(".restore-rollback-")
                    || name.contains(".pre-restore-safety-")
            })
            .collect();
        artifacts.sort();
        artifacts
    }

    #[tokio::test]
    async fn vacuum_backup_is_valid_and_does_not_change_current_data() {
        let directory = test_directory("backup");
        let current = directory.join("current.db");
        let destination = directory.join("snapshot.sqlite3");
        create_application_database(&current).await;

        let result = create_backup(&current, &destination)
            .await
            .expect("backup must succeed");

        assert_eq!(result.file_name, "snapshot.sqlite3");
        assert!(result.size_bytes > 0);
        assert_eq!(validate_database(&destination).await.unwrap(), 3);
        for table in [
            "profiles",
            "quest_progress",
            "discovery_progress",
            "quests",
            "discoveries",
            "master_import_history",
        ] {
            let query = format!("SELECT COUNT(*) FROM {table}");
            assert_eq!(
                scalar(&current, &query).await,
                scalar(&destination, &query).await
            );
        }
        assert_eq!(profile_name(&current).await, "Profile A");
        fs::remove_dir_all(directory).expect("test directory must be removed");
    }

    #[tokio::test]
    async fn backup_replaces_an_existing_destination_only_after_validation() {
        let directory = test_directory("replace");
        let current = directory.join("current.db");
        let destination = directory.join("snapshot.sqlite3");
        create_application_database(&current).await;
        fs::write(&destination, b"old destination").unwrap();

        create_backup(&current, &destination).await.unwrap();

        assert_eq!(validate_database(&destination).await.unwrap(), 3);
        assert_eq!(profile_name(&destination).await, "Profile A");
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn invalid_backup_destination_leaves_current_database_untouched() {
        let directory = test_directory("invalid-destination");
        let current = directory.join("current.db");
        create_application_database(&current).await;
        let baseline = application_snapshot(&current).await;
        let invalid_destination = directory.join("missing").join("snapshot.sqlite3");

        assert!(create_backup(&current, &invalid_destination).await.is_err());
        assert_eq!(application_snapshot(&current).await, baseline);
        assert_eq!(integrity(&current).await, ("ok".to_string(), 0));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn rejects_non_sqlite_and_missing_tables() {
        let directory = test_directory("invalid");
        let text = directory.join("text.sqlite3");
        fs::write(&text, b"not sqlite").unwrap();
        assert!(validate_database(&text).await.is_err());

        let empty = directory.join("empty.sqlite3");
        let options = SqliteConnectOptions::new()
            .filename(&empty)
            .create_if_missing(true);
        SqliteConnection::connect_with(&options)
            .await
            .unwrap()
            .close()
            .await
            .unwrap();
        let error = validate_database(&empty).await.unwrap_err();
        assert!(error.detail.contains("Required table is missing"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn rejects_a_future_or_failed_migration() {
        let directory = test_directory("future");
        let database = directory.join("future.sqlite3");
        create_application_database(&database).await;
        let mut connection = open_database(&database).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET version = 4 WHERE version = 3")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();

        let error = validate_database(&database).await.unwrap_err();
        assert!(error.incompatible);

        let failed = directory.join("failed.sqlite3");
        create_application_database(&failed).await;
        let mut connection = open_database(&failed).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET success = 0 WHERE version = 3")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        assert!(validate_database(&failed).await.unwrap_err().incompatible);
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn rejects_empty_or_checksum_mismatched_migration_history() {
        let directory = test_directory("migration-history");
        let database = directory.join("empty-history.sqlite3");
        let checksum_database = directory.join("checksum-history.sqlite3");
        create_application_database(&checksum_database).await;
        let mut connection = open_database(&checksum_database).await.unwrap();
        sqlx::query("DELETE FROM _sqlx_migrations")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        let error = validate_database(&checksum_database).await.unwrap_err();
        assert!(error.incompatible);
        assert!(error.detail.contains("empty"));

        create_application_database(&database).await;
        let mut connection = open_database(&database).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum = X'01' WHERE version = 1")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        let error = validate_database(&database).await.unwrap_err();
        assert!(error.incompatible);
        assert!(error.detail.contains("supported prefix"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn rejects_application_named_database_with_required_columns_missing() {
        let directory = test_directory("missing-column");
        let database = directory.join("dol-progress.db");
        create_application_database(&database).await;
        let mut connection = open_database(&database).await.unwrap();
        sqlx::raw_sql("DROP TABLE profiles; CREATE TABLE profiles (id INTEGER PRIMARY KEY);")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        let error = validate_database(&database).await.unwrap_err();
        assert!(!error.incompatible);
        assert!(error.detail.contains("profiles"));
        assert!(error.detail.contains("name"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn rejects_version_three_database_when_source_order_columns_are_missing() {
        let directory = test_directory("missing-source-order");
        let database = directory.join("dol-progress.db");
        create_application_database(&database).await;
        let mut connection = open_database(&database).await.unwrap();
        sqlx::raw_sql("ALTER TABLE discoveries DROP COLUMN source_order;")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();

        let error = validate_database(&database).await.unwrap_err();
        assert!(!error.incompatible);
        assert!(error.detail.contains("discoveries"));
        assert!(error.detail.contains("source_order"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn production_backup_restore_round_trip_restores_full_application_snapshot() {
        let directory = test_directory("round-trip");
        let current = directory.join("current.db");
        let backup = directory.join("snapshot.sqlite3");
        create_application_database(&current).await;
        let baseline = application_snapshot(&current).await;
        assert_eq!(baseline.profiles.len(), 2);
        assert_eq!(baseline.quests.len(), 3);
        assert_eq!(baseline.discoveries.len(), 3);
        assert_eq!(baseline.discovery_categories.len(), 2);
        assert_eq!(baseline.quest_progress.len(), 2);
        assert_eq!(baseline.discovery_progress.len(), 3);
        assert_eq!(integrity(&current).await, ("ok".to_string(), 0));

        create_backup(&current, &backup).await.unwrap();
        assert_eq!(validate_database(&backup).await.unwrap(), 3);
        assert_eq!(integrity(&backup).await, ("ok".to_string(), 0));
        assert_eq!(application_snapshot(&backup).await, baseline);

        let mut connection = open_database(&current).await.unwrap();
        sqlx::raw_sql(
            "UPDATE profiles SET name = 'Profile A changed' WHERE id = 1;\
             INSERT INTO profiles (id, name, memo) VALUES (3, 'Profile C', 'created after backup');\
             DELETE FROM quest_progress WHERE profile_id = 1 AND quest_id = 1;\
             INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, 3, 'new completion');\
             UPDATE discovery_progress SET reported = 1, card_owned = 0, memo = 'changed'\
               WHERE profile_id = 1 AND discovery_id = 1;\
             UPDATE discovery_progress SET card_owned = 0 WHERE profile_id = 1 AND discovery_id = 2;\
             UPDATE quests SET title = 'Quest One changed', is_active = 0 WHERE id = 1;\
             UPDATE discoveries SET name = 'Discovery Two changed' WHERE id = 2;\
             DELETE FROM quest_discoveries WHERE quest_id = 1 AND discovery_id = 1;\
             DELETE FROM master_import_history;",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        connection.close().await.unwrap();
        let changed = application_snapshot(&current).await;
        assert_ne!(
            changed, baseline,
            "the current DB must differ before restore"
        );

        restore_backup(&current, &backup).await.unwrap();

        assert_eq!(integrity(&current).await, ("ok".to_string(), 0));
        assert_eq!(application_snapshot(&current).await, baseline);
        assert!(operation_artifacts(&directory).is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn backup_restore_round_trip_preserves_phase_12_auto_linked_progress() {
        let directory = test_directory("phase12-round-trip");
        let current = directory.join("current.db");
        let backup = directory.join("snapshot.sqlite3");
        create_application_database(&current).await;
        let mut connection = open_database(&current).await.unwrap();
        sqlx::raw_sql(
            "DELETE FROM quest_progress WHERE profile_id = 1 AND quest_id = 1;\
             DELETE FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1;",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        crate::progress_link::complete_quest(&mut connection, 1, 1)
            .await
            .unwrap();
        crate::progress_link::discover(&mut connection, 2, 1, None)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quest_progress WHERE quest_id = 1 AND profile_id IN (1, 2)",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap(),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM discovery_progress WHERE discovery_id = 1 AND profile_id IN (1, 2)",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap(),
            2
        );
        connection.close().await.unwrap();

        let baseline = application_snapshot(&current).await;
        create_backup(&current, &backup).await.unwrap();
        let mut connection = open_database(&current).await.unwrap();
        sqlx::raw_sql(
            "DELETE FROM quest_progress WHERE (profile_id = 1 AND quest_id = 1) \
                OR (profile_id = 2 AND quest_id = 1);\
             DELETE FROM discovery_progress WHERE discovery_id = 1;",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        connection.close().await.unwrap();
        assert_ne!(application_snapshot(&current).await, baseline);

        restore_backup(&current, &backup).await.unwrap();

        assert_eq!(integrity(&current).await, ("ok".to_string(), 0));
        assert_eq!(application_snapshot(&current).await, baseline);
        assert!(operation_artifacts(&directory).is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn production_restore_failure_after_current_rename_rolls_back_full_current_snapshot() {
        let directory = test_directory("rollback");
        let current = directory.join("current.db");
        let backup = directory.join("snapshot.sqlite3");
        create_application_database(&current).await;
        create_backup(&current, &backup).await.unwrap();
        let mut connection = open_database(&current).await.unwrap();
        sqlx::raw_sql(
            "UPDATE profiles SET name = 'Current Profile A must survive' WHERE id = 1;\
             UPDATE quest_progress SET memo = 'current quest progress must survive'\
               WHERE profile_id = 1 AND quest_id = 1;\
             UPDATE discovery_progress SET reported = 1, card_owned = 0,\
               memo = 'current discovery progress must survive'\
               WHERE profile_id = 1 AND discovery_id = 1;\
             UPDATE quests SET title = 'Current master must survive' WHERE id = 1;",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        connection.close().await.unwrap();
        let pre_restore = application_snapshot(&current).await;
        let restore_target = application_snapshot(&backup).await;
        assert_ne!(pre_restore, restore_target);
        assert_eq!(integrity(&current).await, ("ok".to_string(), 0));

        let result =
            restore_backup_with_failure(&current, &backup, RestoreFailurePoint::AfterCurrentRename)
                .await;

        let error = result.expect_err("injected replacement failure must return RestoreFailed");
        assert_eq!(error.kind, "RestoreFailed");
        assert!(error.detail.contains("Replacement failed"));
        assert!(error
            .detail
            .contains("Injected failure after current DB rename"));
        assert!(error.detail.contains("rollback error: None"));
        assert_eq!(integrity(&current).await, ("ok".to_string(), 0));
        assert_eq!(application_snapshot(&current).await, pre_restore);
        assert_ne!(application_snapshot(&current).await, restore_target);

        let artifacts = operation_artifacts(&directory);
        assert_eq!(artifacts.len(), 1);
        assert!(artifacts[0]
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .contains("pre-restore-safety"));
        assert_eq!(integrity(&artifacts[0]).await, ("ok".to_string(), 0));
        assert_eq!(application_snapshot(&artifacts[0]).await, pre_restore);
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn phase_10_backup_restores_then_migrates_and_backfills_quest_facets() {
        let directory = test_directory("phase10-upgrade");
        let current = directory.join("current.db");
        let phase10_backup = directory.join("phase10.sqlite3");
        create_application_database(&current).await;
        create_phase_10_database(&phase10_backup).await;
        assert_eq!(validate_database(&phase10_backup).await.unwrap(), 1);

        restore_backup(&current, &phase10_backup).await.unwrap();
        let mut connection = open_database(&current).await.unwrap();
        sqlx::raw_sql(QUEST_FACETS_SCHEMA)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (2, 'quest_facets', 1, X'754DCB97DB2268484C80726DC592FA6DE6C183C839187AE38EF4D14220506F340550AD05BA7C26A848C0B61F33570955', 1)")
            .execute(&mut connection).await.unwrap();
        sqlx::raw_sql(MASTER_SOURCE_ORDER_SCHEMA)
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (3, 'master_source_order', 1, X'5DDA5F401EF96FC66E1E24E7E1A9C0DEB17004CA4CDAD0AF27085DDE70A5E83B37700C405A48AD7FCF86A749A2B0FEDA', 1)")
            .execute(&mut connection).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quests WHERE source_order IS NOT NULL",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap(),
            0,
            "legacy backup migration must not infer source order from local IDs"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM discoveries WHERE source_order IS NOT NULL",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap(),
            0,
            "legacy backup migration must not infer source order from local IDs"
        );
        assert!(crate::quest_facets::backfill_connection(&mut connection)
            .await
            .unwrap());

        let skills: Vec<(String, Option<i64>, i64)> = sqlx::query_as(
            "SELECT skill_name, required_rank, is_language FROM quest_required_skills ORDER BY position",
        ).fetch_all(&mut connection).await.unwrap();
        assert_eq!(
            skills,
            vec![
                ("探索".into(), Some(2), 0),
                ("ギリシャ語".into(), None, 1),
                ("サルベージ".into(), None, 0),
            ]
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_offer_cities")
                .fetch_one(&mut connection)
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT name FROM profiles")
                .fetch_one(&mut connection)
                .await
                .unwrap(),
            "Phase 10 Profile"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT memo FROM quest_progress")
                .fetch_one(&mut connection)
                .await
                .unwrap(),
            "keep quest"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT memo FROM discovery_progress")
                .fetch_one(&mut connection)
                .await
                .unwrap(),
            "keep discovery"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM master_import_history")
                .fetch_one(&mut connection)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("PRAGMA quick_check")
                .fetch_one(&mut connection)
                .await
                .unwrap(),
            "ok"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&mut connection)
                .await
                .unwrap(),
            0
        );
        connection.close().await.unwrap();
        assert_eq!(validate_database(&current).await.unwrap(), 3);
        fs::remove_dir_all(directory).unwrap();
    }
}
