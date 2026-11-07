use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row, SqliteConnection};
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
            user_message: "この発見物ではこの操作は利用できません。".into(),
            detail: format!("{operation} is not supported for discovery {discovery_id}"),
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
    crate::progress_link::discover(connection, profile_id, discovery_id, None)
        .await
        .map_err(|e| DiscoveryProgressCommandError::database(format!("{e:?}")))?;
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

#[tauri::command]
pub(crate) async fn remove_discovery_progress(
    database: State<'_, ActiveDatabase>,
    request: DiscoveryProgressRequest,
) -> Result<crate::discovery_state::DiscoveryState, crate::discovery_state::StateError> {
    let pool = database.pool().await;
    let mut connection = pool.acquire().await?;
    crate::discovery_state::update_compat(
        &mut connection,
        request.profile_id,
        request.discovery_id,
        crate::discovery_state::Operation::RemoveCurrent,
    )
    .await
}

pub(crate) async fn set_reported(
    connection: &mut SqliteConnection,
    profile_id: i64,
    discovery_id: i64,
    value: bool,
) -> Result<(), DiscoveryProgressCommandError> {
    crate::discovery_state::update_compat(
        connection,
        profile_id,
        discovery_id,
        if value {
            crate::discovery_state::Operation::Report
        } else {
            crate::discovery_state::Operation::Rediscover { hold: false }
        },
    )
    .await
    .map_err(|e| DiscoveryProgressCommandError {
        kind: e.kind,
        user_message: "報告状態を更新できませんでした。再読み込みしてください。".into(),
        detail: format!("{e:?}"),
    })?;
    Ok(())
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
    let mut transaction = connection.begin_with("BEGIN IMMEDIATE").await?;
    match set_flag_transaction(&mut transaction, column, profile_id, discovery_id, value).await {
        Ok(()) => {
            transaction.commit().await?;
            Ok(())
        }
        Err(error) => {
            transaction.rollback().await?;
            Err(error)
        }
    }
}

async fn set_flag_transaction(
    connection: &mut SqliteConnection,
    column: &'static str,
    profile_id: i64,
    discovery_id: i64,
    value: bool,
) -> Result<(), DiscoveryProgressCommandError> {
    crate::discovery_state::read_state(connection, profile_id, discovery_id)
        .await
        .map_err(|e| DiscoveryProgressCommandError::database(format!("{e:?}")))?;
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

    if column == "reported" {
        let automatic: bool = sqlx::query_scalar(&format!(
            "SELECT ? IN ({})",
            discovery_capabilities::automatic_reporting_discoveries_sql()
        ))
        .bind(discovery_id)
        .fetch_one(&mut *connection)
        .await?;
        if automatic {
            return Err(DiscoveryProgressCommandError::unsupported(
                column,
                discovery_id,
            ));
        }
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
            .execute(crate::migrations::MAP_REPORT_HOLD_SCHEMA)
            .await
            .unwrap();
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
    async fn automatic_reporting_rejects_manual_changes_but_keeps_cards_independent() {
        let mut db = database().await;
        db.execute("INSERT INTO quests (id, gvdb_id, title, offer_method, raw_row_json) VALUES (1, 1, 'Special', '追究クエスト', '{}'), (2, 2, 'Other', NULL, '{}')").await.unwrap();
        db.execute("INSERT INTO quest_discoveries VALUES (1, 1)")
            .await
            .unwrap();
        for value in [false, true] {
            assert_eq!(
                set_reported(&mut db, 1, 1, value).await.unwrap_err().kind,
                "UnsupportedDiscoveryOperation"
            );
        }
        set_card_owned(&mut db, 1, 1, false).await.unwrap();
        let reported: i64 =
            sqlx::query_scalar("SELECT reported FROM discovery_progress WHERE discovery_id = 1")
                .fetch_one(&mut db)
                .await
                .unwrap();
        assert_eq!(reported, 0);
        // Multiple active relations disable inference, regardless of completed quests.
        db.execute("INSERT INTO quest_discoveries VALUES (2, 1)")
            .await
            .unwrap();
        set_reported(&mut db, 1, 1, true).await.unwrap();
        db.execute("UPDATE quests SET is_active = 0 WHERE id = 2")
            .await
            .unwrap();
        assert!(set_reported(&mut db, 1, 1, false).await.is_err());
        // Changes to master data never repair stored user values.
        db.execute("UPDATE quests SET offer_method = '通常' WHERE id = 1")
            .await
            .unwrap();
        set_reported(&mut db, 1, 1, false).await.unwrap();
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
