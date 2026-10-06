use serde::{Deserialize, Serialize};
use sqlx::{Connection, SqliteConnection, Transaction};
use tauri::State;

use crate::{active_database::ActiveDatabase, discovery_capabilities::RELIC_CATEGORY_NAME};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteQuestRequest {
    profile_id: i64,
    quest_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverRequest {
    profile_id: i64,
    discovery_id: i64,
    selected_quest_id: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuestCompletionResult {
    quest_changed: bool,
    discoveries_created: u64,
    discoveries_already_present: u64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryCompletionResult {
    discovery_created: bool,
    quest_completed: bool,
    quest_already_completed: bool,
    selected_quest_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressLinkCommandError {
    kind: &'static str,
    user_message: String,
    detail: String,
}

impl ProgressLinkCommandError {
    fn database(detail: impl Into<String>) -> Self {
        Self {
            kind: "DatabaseError",
            user_message: "進捗を更新できませんでした。もう一度お試しください。".into(),
            detail: detail.into(),
        }
    }

    fn invalid_selection(detail: impl Into<String>) -> Self {
        Self {
            kind: "InvalidSelection",
            user_message: "関連クエストが更新されています。もう一度選択してください。".into(),
            detail: detail.into(),
        }
    }
}

impl From<sqlx::Error> for ProgressLinkCommandError {
    fn from(error: sqlx::Error) -> Self {
        Self::database(error.to_string())
    }
}

#[tauri::command]
pub async fn complete_quest_with_linked_discoveries(
    database: State<'_, ActiveDatabase>,
    request: CompleteQuestRequest,
) -> Result<QuestCompletionResult, ProgressLinkCommandError> {
    let pool = database.pool().await;
    let mut connection = pool.acquire().await?;
    complete_quest(&mut connection, request.profile_id, request.quest_id).await
}

#[tauri::command]
pub async fn discover_with_linked_quest(
    database: State<'_, ActiveDatabase>,
    request: DiscoverRequest,
) -> Result<DiscoveryCompletionResult, ProgressLinkCommandError> {
    let pool = database.pool().await;
    let mut connection = pool.acquire().await?;
    discover(
        &mut connection,
        request.profile_id,
        request.discovery_id,
        request.selected_quest_id,
    )
    .await
}

pub(crate) async fn complete_quest(
    connection: &mut SqliteConnection,
    profile_id: i64,
    quest_id: i64,
) -> Result<QuestCompletionResult, ProgressLinkCommandError> {
    let mut transaction = connection.begin().await?;
    let result = complete_quest_transaction(&mut transaction, profile_id, quest_id).await;
    finish_transaction(transaction, result).await
}

async fn complete_quest_transaction(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    profile_id: i64,
    quest_id: i64,
) -> Result<QuestCompletionResult, ProgressLinkCommandError> {
    let quest_changed = sqlx::query(
        "INSERT INTO quest_progress (profile_id, quest_id) VALUES (?, ?) \
         ON CONFLICT(profile_id, quest_id) DO NOTHING",
    )
    .bind(profile_id)
    .bind(quest_id)
    .execute(&mut **transaction)
    .await?
    .rows_affected()
        == 1;

    if !quest_changed {
        return Ok(QuestCompletionResult {
            quest_changed: false,
            discoveries_created: 0,
            discoveries_already_present: 0,
        });
    }

    let active_related: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quest_discoveries qd \
         JOIN discoveries d ON d.id = qd.discovery_id AND d.is_active = 1 \
         WHERE qd.quest_id = ?",
    )
    .bind(quest_id)
    .fetch_one(&mut **transaction)
    .await?;
    let discoveries_created = sqlx::query(
        "INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned) \
         SELECT ?, qd.discovery_id, 0, CASE WHEN c.name = ? THEN 0 ELSE 1 END \
         FROM quest_discoveries qd \
         JOIN discoveries d ON d.id = qd.discovery_id AND d.is_active = 1 \
         LEFT JOIN discovery_categories c ON c.id = d.category_id \
         WHERE qd.quest_id = ? \
           AND NOT EXISTS (\
             SELECT 1 FROM discovery_progress dp \
             WHERE dp.profile_id = ? AND dp.discovery_id = qd.discovery_id\
           )",
    )
    .bind(profile_id)
    .bind(RELIC_CATEGORY_NAME)
    .bind(quest_id)
    .bind(profile_id)
    .execute(&mut **transaction)
    .await?
    .rows_affected();

    Ok(QuestCompletionResult {
        quest_changed,
        discoveries_created,
        discoveries_already_present: active_related as u64 - discoveries_created,
    })
}

pub(crate) async fn discover(
    connection: &mut SqliteConnection,
    profile_id: i64,
    discovery_id: i64,
    selected_quest_id: Option<i64>,
) -> Result<DiscoveryCompletionResult, ProgressLinkCommandError> {
    let mut transaction = connection.begin().await?;
    let result = discover_transaction(
        &mut transaction,
        profile_id,
        discovery_id,
        selected_quest_id,
    )
    .await;
    finish_transaction(transaction, result).await
}

async fn discover_transaction(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    profile_id: i64,
    discovery_id: i64,
    selected_quest_id: Option<i64>,
) -> Result<DiscoveryCompletionResult, ProgressLinkCommandError> {
    let discovery_created = sqlx::query(
        "INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned) \
         VALUES (?, ?, 0, CASE WHEN (SELECT c.name FROM discovery_categories c \
                                    JOIN discoveries d ON d.category_id = c.id \
                                    WHERE d.id = ?) = ? THEN 0 ELSE 1 END) \
         ON CONFLICT(profile_id, discovery_id) DO NOTHING",
    )
    .bind(profile_id)
    .bind(discovery_id)
    .bind(discovery_id)
    .bind(RELIC_CATEGORY_NAME)
    .execute(&mut **transaction)
    .await?
    .rows_affected()
        == 1;

    if !discovery_created {
        return Ok(DiscoveryCompletionResult {
            discovery_created: false,
            quest_completed: false,
            quest_already_completed: false,
            selected_quest_id: None,
        });
    }

    let related_quest_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT q.id FROM quest_discoveries qd \
         JOIN quests q ON q.id = qd.quest_id AND q.is_active = 1 \
         WHERE qd.discovery_id = ? ORDER BY q.id",
    )
    .bind(discovery_id)
    .fetch_all(&mut **transaction)
    .await?;

    let quest_id = match related_quest_ids.as_slice() {
        [] => {
            if selected_quest_id.is_some() {
                return Err(ProgressLinkCommandError::invalid_selection(
                    "Discovery has no active related quest",
                ));
            }
            None
        }
        [only] => {
            if selected_quest_id.is_some_and(|selected| selected != *only) {
                return Err(ProgressLinkCommandError::invalid_selection(
                    "Selected quest is not the active related quest",
                ));
            }
            Some(*only)
        }
        many => match selected_quest_id {
            None => None,
            Some(selected) if many.contains(&selected) => Some(selected),
            Some(_) => {
                return Err(ProgressLinkCommandError::invalid_selection(
                    "Selected quest is not an active direct relation",
                ))
            }
        },
    };

    let (quest_completed, quest_already_completed) = if let Some(quest_id) = quest_id {
        let changed = sqlx::query(
            "INSERT INTO quest_progress (profile_id, quest_id) VALUES (?, ?) \
             ON CONFLICT(profile_id, quest_id) DO NOTHING",
        )
        .bind(profile_id)
        .bind(quest_id)
        .execute(&mut **transaction)
        .await?
        .rows_affected()
            == 1;
        (changed, !changed)
    } else {
        (false, false)
    };

    Ok(DiscoveryCompletionResult {
        discovery_created,
        quest_completed,
        quest_already_completed,
        selected_quest_id: quest_id,
    })
}

async fn finish_transaction<T>(
    transaction: Transaction<'_, sqlx::Sqlite>,
    result: Result<T, ProgressLinkCommandError>,
) -> Result<T, ProgressLinkCommandError> {
    match result {
        Ok(value) => {
            transaction.commit().await?;
            Ok(value)
        }
        Err(error) => {
            transaction.rollback().await?;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use sqlx::{Connection, Executor, Row, SqliteConnection, Transaction};

    use super::{
        complete_quest, complete_quest_transaction, discover, discover_transaction,
        ProgressLinkCommandError,
    };
    use crate::migrations::INITIAL_SCHEMA;

    async fn database() -> SqliteConnection {
        let mut connection = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        connection.execute(INITIAL_SCHEMA).await.unwrap();
        sqlx::query("INSERT INTO profiles (id, name) VALUES (1, 'A'), (2, 'B')")
            .execute(&mut connection)
            .await
            .unwrap();
        for (id, active) in [(1, 1), (2, 1), (3, 1), (4, 0)] {
            sqlx::query("INSERT INTO quests (id, gvdb_id, title, is_active, raw_row_json) VALUES (?, ?, ?, ?, '{}')")
                .bind(id).bind(1000 + id).bind(format!("Quest {id}")).bind(active)
                .execute(&mut connection).await.unwrap();
        }
        for (id, active) in [(1, 1), (2, 1), (3, 1), (4, 0), (5, 1)] {
            sqlx::query("INSERT INTO discoveries (id, gvdb_id, name, is_active, raw_row_json) VALUES (?, ?, ?, ?, '{}')")
                .bind(id).bind(2000 + id).bind(format!("Discovery {id}")).bind(active)
                .execute(&mut connection).await.unwrap();
        }
        connection
    }

    async fn relate(connection: &mut SqliteConnection, quest: i64, discovery: i64) {
        sqlx::query("INSERT INTO quest_discoveries (quest_id, discovery_id) VALUES (?, ?)")
            .bind(quest)
            .bind(discovery)
            .execute(connection)
            .await
            .unwrap();
    }

    async fn make_relic(connection: &mut SqliteConnection, discovery_id: i64) {
        sqlx::query("INSERT OR IGNORE INTO discovery_categories (id, name) VALUES (1, 'レリック')")
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query("UPDATE discoveries SET category_id = 1 WHERE id = ?")
            .bind(discovery_id)
            .execute(connection)
            .await
            .unwrap();
    }

    async fn count(connection: &mut SqliteConnection, table: &str, profile: i64) -> i64 {
        sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {table} WHERE profile_id = ?"
        ))
        .bind(profile)
        .fetch_one(connection)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn quest_completion_creates_all_missing_active_discoveries_and_preserves_existing_state()
    {
        let mut db = database().await;
        for discovery in 1..=4 {
            relate(&mut db, 1, discovery).await;
        }
        sqlx::query("INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo) VALUES (1, 2, 1, 0, 'keep')")
            .execute(&mut db).await.unwrap();

        let result = complete_quest(&mut db, 1, 1).await.unwrap();
        assert_eq!(result.discoveries_created, 2);
        assert_eq!(result.discoveries_already_present, 1);
        let rows = sqlx::query("SELECT discovery_id, reported, card_owned, memo FROM discovery_progress WHERE profile_id = 1 ORDER BY discovery_id")
            .fetch_all(&mut db).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(
            (
                rows[0].get::<i64, _>(0),
                rows[0].get::<i64, _>(1),
                rows[0].get::<i64, _>(2)
            ),
            (1, 0, 1)
        );
        assert_eq!(
            (
                rows[1].get::<i64, _>(0),
                rows[1].get::<i64, _>(1),
                rows[1].get::<i64, _>(2),
                rows[1].get::<String, _>(3)
            ),
            (2, 1, 0, "keep".into())
        );
        assert_eq!(rows[2].get::<i64, _>(0), 3);
    }

    #[tokio::test]
    async fn quest_completion_with_no_relation_and_duplicate_operation_are_idempotent_and_profile_scoped(
    ) {
        let mut db = database().await;
        relate(&mut db, 2, 1).await;
        let first = complete_quest(&mut db, 1, 2).await.unwrap();
        let duplicate = complete_quest(&mut db, 1, 2).await.unwrap();
        assert!(first.quest_changed);
        assert!(!duplicate.quest_changed);
        assert_eq!(count(&mut db, "quest_progress", 1).await, 1);
        assert_eq!(count(&mut db, "quest_progress", 2).await, 0);
        assert_eq!(count(&mut db, "discovery_progress", 2).await, 0);
    }

    #[tokio::test]
    async fn discovery_with_zero_one_or_multiple_active_quests_has_defined_behavior_without_recursion(
    ) {
        let mut db = database().await;
        relate(&mut db, 1, 2).await;
        relate(&mut db, 1, 3).await;
        relate(&mut db, 2, 3).await;
        relate(&mut db, 4, 5).await;

        let zero = discover(&mut db, 1, 1, None).await.unwrap();
        assert_eq!(zero.selected_quest_id, None);
        let one = discover(&mut db, 1, 2, None).await.unwrap();
        assert_eq!(one.selected_quest_id, Some(1));
        assert!(one.quest_completed);
        let multiple_none = discover(&mut db, 1, 3, None).await.unwrap();
        assert_eq!(multiple_none.selected_quest_id, None);
        let inactive_only = discover(&mut db, 2, 5, None).await.unwrap();
        assert_eq!(inactive_only.selected_quest_id, None);
        assert_eq!(count(&mut db, "quest_progress", 1).await, 1);
        assert_eq!(count(&mut db, "discovery_progress", 1).await, 3);
        assert_eq!(count(&mut db, "discovery_progress", 2).await, 1);
        // Quest 1 also relates to Discovery 3, but discovery-driven completion does not recurse.
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 3"
            )
            .fetch_one(&mut db)
            .await
            .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn discovery_multiple_selection_completes_only_the_selected_active_direct_quest() {
        let mut db = database().await;
        relate(&mut db, 1, 1).await;
        relate(&mut db, 2, 1).await;
        let result = discover(&mut db, 1, 1, Some(2)).await.unwrap();
        assert_eq!(result.selected_quest_id, Some(2));
        assert!(result.quest_completed);
        let ids: Vec<i64> =
            sqlx::query_scalar("SELECT quest_id FROM quest_progress WHERE profile_id = 1")
                .fetch_all(&mut db)
                .await
                .unwrap();
        assert_eq!(ids, vec![2]);
    }

    #[tokio::test]
    async fn discovery_single_relation_preserves_an_already_completed_quest_and_uses_defaults() {
        let mut db = database().await;
        relate(&mut db, 1, 1).await;
        sqlx::query(
            "INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, 1, 'keep')",
        )
        .execute(&mut db)
        .await
        .unwrap();

        let result = discover(&mut db, 1, 1, None).await.unwrap();

        assert!(!result.quest_completed);
        assert!(result.quest_already_completed);
        let discovery_state: (i64, i64) = sqlx::query_as(
            "SELECT reported, card_owned FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1",
        )
        .fetch_one(&mut db)
        .await
        .unwrap();
        assert_eq!(discovery_state, (0, 1));
        let quest_memo: String = sqlx::query_scalar(
            "SELECT memo FROM quest_progress WHERE profile_id = 1 AND quest_id = 1",
        )
        .fetch_one(&mut db)
        .await
        .unwrap();
        assert_eq!(quest_memo, "keep");
    }

    #[tokio::test]
    async fn direct_discovery_keeps_relic_card_state_not_applicable() {
        let mut db = database().await;
        make_relic(&mut db, 1).await;

        discover(&mut db, 1, 1, None).await.unwrap();

        let state: (i64, i64) = sqlx::query_as(
            "SELECT reported, card_owned FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1",
        )
        .fetch_one(&mut db)
        .await
        .unwrap();
        assert_eq!(state, (0, 0));
    }

    #[tokio::test]
    async fn relic_discovery_progress_remains_profile_scoped() {
        let mut db = database().await;
        make_relic(&mut db, 1).await;

        discover(&mut db, 1, 1, None).await.unwrap();
        discover(&mut db, 2, 1, None).await.unwrap();

        let rows: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT profile_id, card_owned FROM discovery_progress WHERE discovery_id = 1 ORDER BY profile_id",
        )
        .fetch_all(&mut db)
        .await
        .unwrap();
        assert_eq!(rows, vec![(1, 0), (2, 0)]);
    }

    #[tokio::test]
    async fn quest_completion_creates_relic_without_card_and_normal_discovery_with_card() {
        let mut db = database().await;
        make_relic(&mut db, 2).await;
        relate(&mut db, 1, 1).await;
        relate(&mut db, 1, 2).await;

        complete_quest(&mut db, 1, 1).await.unwrap();

        let rows: Vec<(i64, i64, i64)> = sqlx::query_as(
            "SELECT discovery_id, reported, card_owned FROM discovery_progress WHERE profile_id = 1 ORDER BY discovery_id",
        )
        .fetch_all(&mut db)
        .await
        .unwrap();
        assert_eq!(rows, vec![(1, 0, 1), (2, 0, 0)]);
    }

    #[tokio::test]
    async fn stale_selection_rolls_back_discovery_creation() {
        let mut db = database().await;
        relate(&mut db, 1, 1).await;
        relate(&mut db, 2, 1).await;
        let error = discover(&mut db, 1, 1, Some(3)).await.unwrap_err();
        assert_eq!(error.kind, "InvalidSelection");
        assert_eq!(count(&mut db, "discovery_progress", 1).await, 0);
        assert_eq!(count(&mut db, "quest_progress", 1).await, 0);
    }

    #[tokio::test]
    async fn existing_discovery_operation_does_not_later_complete_a_quest() {
        let mut db = database().await;
        relate(&mut db, 1, 1).await;
        sqlx::query("INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo) VALUES (1, 1, 1, 0, 'keep')")
            .execute(&mut db).await.unwrap();
        let result = discover(&mut db, 1, 1, None).await.unwrap();
        assert!(!result.discovery_created);
        assert_eq!(count(&mut db, "quest_progress", 1).await, 0);
        let state: (i64, i64, String) = sqlx::query_as("SELECT reported, card_owned, memo FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1")
            .fetch_one(&mut db).await.unwrap();
        assert_eq!(state, (1, 0, "keep".into()));
    }

    #[tokio::test]
    async fn quest_transaction_failure_after_primary_insert_rolls_back_everything() {
        let mut db = database().await;
        relate(&mut db, 1, 1).await;
        sqlx::raw_sql(
            "CREATE TRIGGER test_fail_discovery_insert BEFORE INSERT ON discovery_progress \
             BEGIN SELECT RAISE(ABORT, 'test-only failure after quest insert'); END;",
        )
        .execute(&mut db)
        .await
        .unwrap();
        let error = complete_quest(&mut db, 1, 1).await.unwrap_err();
        assert_eq!(error.kind, "DatabaseError");
        assert_eq!(count(&mut db, "quest_progress", 1).await, 0);
        assert_eq!(count(&mut db, "discovery_progress", 1).await, 0);
    }

    #[tokio::test]
    async fn discovery_transaction_failure_after_primary_insert_rolls_back_everything() {
        let mut db = database().await;
        relate(&mut db, 1, 1).await;
        sqlx::raw_sql(
            "CREATE TRIGGER test_fail_quest_insert BEFORE INSERT ON quest_progress \
             BEGIN SELECT RAISE(ABORT, 'test-only failure after discovery insert'); END;",
        )
        .execute(&mut db)
        .await
        .unwrap();
        let error = discover(&mut db, 1, 1, None).await.unwrap_err();
        assert_eq!(error.kind, "DatabaseError");
        assert_eq!(count(&mut db, "discovery_progress", 1).await, 0);
        assert_eq!(count(&mut db, "quest_progress", 1).await, 0);
    }

    #[tokio::test]
    async fn undo_directions_never_delete_linked_user_data() {
        let mut db = database().await;
        relate(&mut db, 1, 1).await;
        complete_quest(&mut db, 1, 1).await.unwrap();
        sqlx::query("UPDATE discovery_progress SET reported = 1, card_owned = 0, memo = 'keep' WHERE profile_id = 1 AND discovery_id = 1")
            .execute(&mut db).await.unwrap();

        sqlx::query("DELETE FROM quest_progress WHERE profile_id = 1 AND quest_id = 1")
            .execute(&mut db)
            .await
            .unwrap();
        let discovery_state: (i64, i64, String) = sqlx::query_as(
            "SELECT reported, card_owned, memo FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1",
        ).fetch_one(&mut db).await.unwrap();
        assert_eq!(discovery_state, (1, 0, "keep".into()));

        sqlx::query(
            "INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, 1, 'quest memo')",
        )
        .execute(&mut db)
        .await
        .unwrap();
        sqlx::query("DELETE FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1")
            .execute(&mut db)
            .await
            .unwrap();
        let quest_memo: String = sqlx::query_scalar(
            "SELECT memo FROM quest_progress WHERE profile_id = 1 AND quest_id = 1",
        )
        .fetch_one(&mut db)
        .await
        .unwrap();
        assert_eq!(quest_memo, "quest memo");
    }

    #[allow(dead_code)]
    async fn _compile_transaction_helpers(
        transaction: &mut Transaction<'_, sqlx::Sqlite>,
    ) -> Result<(), ProgressLinkCommandError> {
        complete_quest_transaction(transaction, 1, 1).await?;
        discover_transaction(transaction, 1, 1, None).await?;
        Ok(())
    }
}
