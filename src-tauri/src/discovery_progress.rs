use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};
use tauri::State;

use crate::{active_database::ActiveDatabase, discovery_capabilities};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryProgressFlagRequest {
    profile_id: i64,
    discovery_id: i64,
    value: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryProgressRequest {
    profile_id: i64,
    discovery_id: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryProgressCommandError {
    kind: &'static str,
    user_message: String,
    detail: String,
}

impl DiscoveryProgressCommandError {
    fn unsupported(operation: &str, discovery_id: i64) -> Self {
        Self {
            kind: "UnsupportedDiscoveryOperation",
            user_message: "レリックではこの操作は利用できません。".into(),
            detail: format!("{operation} is not applicable to relic discovery {discovery_id}"),
        }
    }

    fn not_found(discovery_id: i64) -> Self {
        Self {
            kind: "DiscoveryProgressNotFound",
            user_message: "発見物進捗が見つかりません。再読み込みしてください。".into(),
            detail: format!("Discovery progress {discovery_id} was not found"),
        }
    }

    fn database(detail: impl Into<String>) -> Self {
        Self {
            kind: "DatabaseError",
            user_message: "発見物進捗を更新できませんでした。もう一度お試しください。".into(),
            detail: detail.into(),
        }
    }
}

impl From<sqlx::Error> for DiscoveryProgressCommandError {
    fn from(error: sqlx::Error) -> Self {
        Self::database(error.to_string())
    }
}

#[tauri::command]
pub(crate) async fn mark_discovery_discovered(
    database: State<'_, ActiveDatabase>,
    request: DiscoveryProgressRequest,
) -> Result<(), DiscoveryProgressCommandError> {
    let pool = database.pool().await;
    let mut connection = pool.acquire().await?;
    mark_discovered(&mut connection, request.profile_id, request.discovery_id).await
}

#[tauri::command]
pub(crate) async fn set_discovery_reported(
    database: State<'_, ActiveDatabase>,
    request: DiscoveryProgressFlagRequest,
) -> Result<(), DiscoveryProgressCommandError> {
    let pool = database.pool().await;
    let mut connection = pool.acquire().await?;
    set_reported(
        &mut connection,
        request.profile_id,
        request.discovery_id,
        request.value,
    )
    .await
}

pub(crate) async fn mark_discovered(
    connection: &mut SqliteConnection,
    profile_id: i64,
    discovery_id: i64,
) -> Result<(), DiscoveryProgressCommandError> {
    sqlx::query(
        "INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned) \
         VALUES (?, ?, 0, CASE WHEN (SELECT c.name FROM discoveries d \
                                    LEFT JOIN discovery_categories c ON c.id = d.category_id \
                                    WHERE d.id = ?) = ? THEN 0 ELSE 1 END) \
         ON CONFLICT(profile_id, discovery_id) DO NOTHING",
    )
    .bind(profile_id)
    .bind(discovery_id)
    .bind(discovery_id)
    .bind(discovery_capabilities::RELIC_CATEGORY_NAME)
    .execute(connection)
    .await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn set_discovery_card_owned(
    database: State<'_, ActiveDatabase>,
    request: DiscoveryProgressFlagRequest,
) -> Result<(), DiscoveryProgressCommandError> {
    let pool = database.pool().await;
    let mut connection = pool.acquire().await?;
    set_card_owned(
        &mut connection,
        request.profile_id,
        request.discovery_id,
        request.value,
    )
    .await
}

pub(crate) async fn set_reported(
    connection: &mut SqliteConnection,
    profile_id: i64,
    discovery_id: i64,
    value: bool,
) -> Result<(), DiscoveryProgressCommandError> {
    set_flag(connection, "reported", profile_id, discovery_id, value).await
}

pub(crate) async fn set_card_owned(
    connection: &mut SqliteConnection,
    profile_id: i64,
    discovery_id: i64,
    value: bool,
) -> Result<(), DiscoveryProgressCommandError> {
    set_flag(connection, "card_owned", profile_id, discovery_id, value).await
}

async fn set_flag(
    connection: &mut SqliteConnection,
    column: &'static str,
    profile_id: i64,
    discovery_id: i64,
    value: bool,
) -> Result<(), DiscoveryProgressCommandError> {
    let category_name: Option<String> = sqlx::query(
        "SELECT c.name FROM discoveries d \
         LEFT JOIN discovery_categories c ON c.id = d.category_id \
         WHERE d.id = ?",
    )
    .bind(discovery_id)
    .fetch_optional(&mut *connection)
    .await?
    .and_then(|row| row.try_get("name").ok());

    let supported = match column {
        "reported" => discovery_capabilities::can_report(category_name.as_deref()),
        "card_owned" => discovery_capabilities::has_card(category_name.as_deref()),
        _ => unreachable!("only fixed discovery progress columns are accepted"),
    };
    if !supported {
        return Err(DiscoveryProgressCommandError::unsupported(
            column,
            discovery_id,
        ));
    }

    let result = sqlx::query(&format!(
        "UPDATE discovery_progress SET {column} = ?, \
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
         WHERE profile_id = ? AND discovery_id = ?",
    ))
    .bind(value)
    .bind(profile_id)
    .bind(discovery_id)
    .execute(connection)
    .await?;
    if result.rows_affected() == 0 {
        return Err(DiscoveryProgressCommandError::not_found(discovery_id));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::{Connection, Executor, SqliteConnection};

    use super::{mark_discovered, set_card_owned, set_reported};
    use crate::migrations::INITIAL_SCHEMA;

    async fn database() -> SqliteConnection {
        let mut connection = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        connection.execute(INITIAL_SCHEMA).await.unwrap();
        connection
            .execute("INSERT INTO profiles (id, name) VALUES (1, 'A')")
            .await
            .unwrap();
        connection
            .execute(
                "INSERT INTO discovery_categories (id, name) VALUES (1, '通常'), (2, 'レリック')",
            )
            .await
            .unwrap();
        connection.execute("INSERT INTO discoveries (id, gvdb_id, category_id, name, raw_row_json) VALUES (1, 1, 1, 'Normal', '{}'), (2, 2, 2, 'Relic', '{}')").await.unwrap();
        connection.execute("INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned) VALUES (1, 1, 0, 1), (1, 2, 0, 0)").await.unwrap();
        connection
    }

    #[tokio::test]
    async fn normal_discovery_flags_can_be_changed() {
        let mut db = database().await;
        set_reported(&mut db, 1, 1, true).await.unwrap();
        set_card_owned(&mut db, 1, 1, false).await.unwrap();
        let state: (i64, i64) = sqlx::query_as("SELECT reported, card_owned FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1").fetch_one(&mut db).await.unwrap();
        assert_eq!(state, (1, 0));
    }

    #[tokio::test]
    async fn relic_flag_mutations_are_rejected_without_changing_progress() {
        let mut db = database().await;
        let reported = set_reported(&mut db, 1, 2, true).await.unwrap_err();
        let card = set_card_owned(&mut db, 1, 2, true).await.unwrap_err();
        assert_eq!(reported.kind, "UnsupportedDiscoveryOperation");
        assert_eq!(card.kind, "UnsupportedDiscoveryOperation");
        let state: (i64, i64) = sqlx::query_as("SELECT reported, card_owned FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 2").fetch_one(&mut db).await.unwrap();
        assert_eq!(state, (0, 0));
    }

    #[tokio::test]
    async fn discovery_creation_uses_normal_and_relic_card_defaults() {
        let mut db = database().await;
        db.execute("DELETE FROM discovery_progress").await.unwrap();
        mark_discovered(&mut db, 1, 1).await.unwrap();
        mark_discovered(&mut db, 1, 2).await.unwrap();
        let rows: Vec<(i64, i64)> = sqlx::query_as("SELECT discovery_id, card_owned FROM discovery_progress WHERE profile_id = 1 ORDER BY discovery_id").fetch_all(&mut db).await.unwrap();
        assert_eq!(rows, vec![(1, 1), (2, 0)]);
    }
}
