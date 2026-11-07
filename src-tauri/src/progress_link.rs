use serde::{Deserialize, Serialize};
use sqlx::{Connection, SqliteConnection, Transaction};
use tauri::State;

use crate::active_database::ActiveDatabase;

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
    pub(crate) kind: &'static str,
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
    let mut transaction = connection.begin_with("BEGIN IMMEDIATE").await?;
    let result = complete_quest_transaction(&mut transaction, profile_id, quest_id).await;
    finish_transaction(transaction, result).await
}

async fn complete_quest_transaction(
    transaction: &mut SqliteConnection,
    profile_id: i64,
    quest_id: i64,
) -> Result<QuestCompletionResult, ProgressLinkCommandError> {
    crate::discovery_state::validate_profile(transaction, profile_id)
        .await
        .map_err(|e| ProgressLinkCommandError::invalid_selection(format!("{e:?}")))?;
    let active: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM quests WHERE id=? AND is_active=1)")
            .bind(quest_id)
            .fetch_one(&mut *transaction)
            .await?;
    if !active {
        return Err(ProgressLinkCommandError::invalid_selection(
            "Quest is missing or inactive",
        ));
    }
    let quest_changed = sqlx::query(
        "INSERT INTO quest_progress (profile_id, quest_id) VALUES (?, ?) \
         ON CONFLICT(profile_id, quest_id) DO NOTHING",
    )
    .bind(profile_id)
    .bind(quest_id)
    .execute(&mut *transaction)
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
    .fetch_one(&mut *transaction)
    .await?;
    let related: Vec<i64> = sqlx::query_scalar("SELECT d.id FROM quest_discoveries qd JOIN discoveries d ON d.id=qd.discovery_id WHERE qd.quest_id=? AND d.is_active=1 ORDER BY d.id").bind(quest_id).fetch_all(&mut *transaction).await?;
    let mut discoveries_created = 0;
    for discovery in related {
        if crate::discovery_state::initialize(transaction, profile_id, discovery, Some(quest_id))
            .await
            .map_err(|e| ProgressLinkCommandError::database(format!("{e:?}")))?
        {
            discoveries_created += 1;
        }
    }

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
    let mut transaction = connection.begin_with("BEGIN IMMEDIATE").await?;
    let result = discover_transaction(
        &mut transaction,
        profile_id,
        discovery_id,
        selected_quest_id,
    )
    .await;
    finish_transaction(transaction, result).await
}

pub(crate) async fn discover_transaction(
    transaction: &mut SqliteConnection,
    profile_id: i64,
    discovery_id: i64,
    selected_quest_id: Option<i64>,
) -> Result<DiscoveryCompletionResult, ProgressLinkCommandError> {
    let current = crate::discovery_state::read_state(transaction, profile_id, discovery_id)
        .await
        .map_err(|e| ProgressLinkCommandError::invalid_selection(format!("{e:?}")))?;
    if current.progress.is_some() {
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
    .fetch_all(&mut *transaction)
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

    let discovery_created =
        crate::discovery_state::initialize(transaction, profile_id, discovery_id, quest_id)
            .await
            .map_err(|e| ProgressLinkCommandError::database(format!("{e:?}")))?;
    if !discovery_created {
        return Err(ProgressLinkCommandError::invalid_selection(
            "Discovery is missing or inactive",
        ));
    }
    let (quest_completed, quest_already_completed) = if let Some(quest_id) = quest_id {
        let changed = sqlx::query(
            "INSERT INTO quest_progress (profile_id, quest_id) VALUES (?, ?) \
             ON CONFLICT(profile_id, quest_id) DO NOTHING",
        )
        .bind(profile_id)
        .bind(quest_id)
        .execute(&mut *transaction)
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
        connection
            .execute(crate::migrations::MAP_REPORT_HOLD_SCHEMA)
            .await
            .unwrap();
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

    #[tokio::test]
    async fn offer_methods_initialize_both_routes_without_overwriting_existing_progress() {
        for (method, expected) in [
            ("通常", 0),
            ("追究クエスト", 1),
            ("レガシー", 1),
            ("トレジャーハント", 1),
            ("追及クエスト", 0),
            ("レガシー ", 0),
        ] {
            for from_quest in [true, false] {
                for relic in [true, false] {
                    let mut db = database().await;
                    sqlx::query("UPDATE quests SET offer_method = ? WHERE id = 1")
                        .bind(method)
                        .execute(&mut db)
                        .await
                        .unwrap();
                    relate(&mut db, 1, 1).await;
                    if relic {
                        make_relic(&mut db, 1).await;
                    }
                    if from_quest {
                        complete_quest(&mut db, 1, 1).await.unwrap();
                    } else {
                        discover(&mut db, 1, 1, None).await.unwrap();
                    }
                    let state: (i64, i64) = sqlx::query_as("SELECT reported, card_owned FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1")
                        .fetch_one(&mut db).await.unwrap();
                    assert_eq!(
                        state,
                        (if relic { 0 } else { expected }, if relic { 0 } else { 1 }),
                        "{method}, quest={from_quest}, relic={relic}"
                    );
                    assert_eq!(count(&mut db, "discovery_progress", 2).await, 0);
                    sqlx::query("UPDATE discovery_progress SET reported = 0, card_owned = 0, memo = 'keep', updated_at = '2000-01-01T00:00:00Z' WHERE profile_id = 1")
                        .execute(&mut db).await.unwrap();
                    sqlx::query("DELETE FROM quest_progress WHERE profile_id = 1")
                        .execute(&mut db)
                        .await
                        .unwrap();
                    complete_quest(&mut db, 1, 1).await.unwrap();
                    discover(&mut db, 1, 1, None).await.unwrap();
                    let state: (i64, i64, String, String) = sqlx::query_as("SELECT reported, card_owned, memo, updated_at FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1")
                        .fetch_one(&mut db).await.unwrap();
                    assert_eq!(state, (0, 0, "keep".into(), "2000-01-01T00:00:00Z".into()));
                }
            }
        }
    }

    #[tokio::test]
    async fn multiple_relations_use_only_selected_route_and_fail_atomically() {
        for (selected, expected) in [(None, 0), (Some(1), 1), (Some(2), 0)] {
            let mut db = database().await;
            sqlx::query("UPDATE quests SET offer_method = 'レガシー' WHERE id = 1")
                .execute(&mut db)
                .await
                .unwrap();
            relate(&mut db, 1, 1).await;
            relate(&mut db, 2, 1).await;
            discover(&mut db, 1, 1, selected).await.unwrap();
            let reported: i64 = sqlx::query_scalar(
                "SELECT reported FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1",
            )
            .fetch_one(&mut db)
            .await
            .unwrap();
            assert_eq!(reported, expected);
            assert_eq!(
                count(&mut db, "quest_progress", 1).await,
                i64::from(selected.is_some())
            );
            assert!(discover(&mut db, 2, 1, Some(3)).await.is_err());
            assert_eq!(count(&mut db, "discovery_progress", 2).await, 0);
        }
        let mut db = database().await;
        sqlx::query("UPDATE quests SET offer_method = '追究クエスト' WHERE id = 1")
            .execute(&mut db)
            .await
            .unwrap();
        relate(&mut db, 1, 1).await;
        db.execute("CREATE TRIGGER fail_quest BEFORE INSERT ON quest_progress BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").await.unwrap();
        assert!(discover(&mut db, 1, 1, None).await.is_err());
        assert_eq!(count(&mut db, "discovery_progress", 1).await, 0);
        assert_eq!(count(&mut db, "quest_progress", 1).await, 0);
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

    #[tokio::test]
    async fn file_pool_completion_and_cancel_finish_with_full_synthetic_master() {
        use futures_core::Stream;
        use std::time::{Duration, SystemTime, UNIX_EPOCH};
        let directory = std::env::temp_dir().join(format!(
            "dol-quest-click-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let database = crate::active_database::ActiveDatabase::open(directory.join("fixture.db"))
            .await
            .unwrap();
        {
            let pool = database.pool().await;
            let mut connection = pool.acquire().await.unwrap();
            for schema in [
                INITIAL_SCHEMA,
                crate::migrations::QUEST_FACETS_SCHEMA,
                crate::migrations::MASTER_SOURCE_ORDER_SCHEMA,
                crate::migrations::MAP_REPORT_HOLD_SCHEMA,
            ] {
                sqlx::raw_sql(schema)
                    .execute(&mut *connection)
                    .await
                    .unwrap();
            }
            sqlx::raw_sql("INSERT INTO profiles(id,name) VALUES(1,'synthetic'),(2,'other');
                WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<6784)
                INSERT INTO quests(id,gvdb_id,title,offer_method,raw_row_json) SELECT x,x,'synthetic',CASE WHEN x%2=0 THEN '地理学' ELSE '冒険クエスト' END,'{}' FROM n;
                WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4032)
                INSERT INTO discoveries(id,gvdb_id,name,raw_row_json) SELECT x,x,'synthetic','{}' FROM n;
                INSERT INTO quest_discoveries SELECT id,id FROM discoveries;")
                .execute(&mut *connection).await.unwrap();
        }
        let started = std::time::Instant::now();
        // The shipped SQLite must execute the same bulk SQL used by the frontend.
        let summary_sql = include_str!("../../src/discoveries/discoveryStateSummaries.sql")
            .replace(
                "__AUTOMATIC_REPORTING_DISCOVERIES__",
                &crate::discovery_capabilities::automatic_reporting_discoveries_sql(),
            );
        let pool = database.pool().await;
        let read_started = std::time::Instant::now();
        let rows = tokio::time::timeout(
            Duration::from_secs(2),
            sqlx::query(&summary_sql).bind(1i64).fetch_all(&*pool),
        )
        .await
        .expect("bulk summary exceeded 2 seconds")
        .unwrap();
        assert_eq!(rows.len(), 4032);
        eprintln!(
            "shipped SQLite summary completed in {:?}",
            read_started.elapsed()
        );
        drop(pool);
        tokio::time::timeout(Duration::from_secs(10), async {
            // Match the command boundary: acquire/drop a pooled connection for each click.
            for quest in [1, 2, 5001, 5002] {
                for _ in 0..2 {
                    let pool = database.pool().await;
                    let mut connection = pool.acquire().await.unwrap();
                    let result = complete_quest(&mut connection, 1, quest).await.unwrap();
                    assert!(result.quest_changed);
                    assert_eq!(result.discoveries_created + result.discoveries_already_present, u64::from(quest <= 4032));
                    drop(connection);
                    let deleted = sqlx::query("DELETE FROM quest_progress WHERE profile_id=1 AND quest_id=?").bind(quest).execute(&*pool).await.unwrap();
                    assert_eq!(deleted.rows_affected(), 1);
                    let _: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM quest_progress WHERE profile_id=1").fetch_one(&*pool).await.unwrap();
                }
            }
            let pool = database.pool().await;
            let mut connection = pool.acquire().await.unwrap();
            // A failed linked insert must release its writer transaction for the next command.
            sqlx::raw_sql("CREATE TRIGGER fail_synthetic BEFORE INSERT ON discovery_progress WHEN NEW.discovery_id=3 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;")
                .execute(&mut *connection).await.unwrap();
            let error = complete_quest(&mut connection, 1, 3).await.unwrap_err();
            assert_eq!(error.kind, "DatabaseError");
            assert_eq!(count(&mut connection, "quest_progress", 1).await, 0);
            assert!(complete_quest(&mut connection, 1, 4).await.unwrap().quest_changed);
            assert_eq!(count(&mut connection, "quest_progress", 2).await, 0);
        }).await.expect("quest updates or rollback held the pool/SQLite writer longer than 10 seconds");
        eprintln!(
            "synthetic pooled quest sequence completed in {:?}",
            started.elapsed()
        );
        // Reproduce the pre-fix query plan and its effect on a concurrent writer.
        // This deliberately retains the former correlated EXISTS as a regression reference.
        let old_query = "SELECT d.id,
            EXISTS(SELECT 1 FROM quest_discoveries mq JOIN quests m ON m.id=mq.quest_id
              WHERE mq.discovery_id=d.id AND m.is_active=1 AND m.offer_method COLLATE BINARY IN
              ('地理学','考古学','宗教学','生物学','美術','財宝鑑定','天文学')) AS mapRelated,
            EXISTS(SELECT 1 FROM quest_discoveries mq JOIN quests m ON m.id=mq.quest_id
              WHERE mq.discovery_id=d.id AND m.is_active=1 AND m.offer_method COLLATE BINARY IN
              ('地理学','考古学','宗教学','生物学','美術','財宝鑑定','天文学')
              AND (SELECT COUNT(*) FROM quest_discoveries all_mq WHERE all_mq.quest_id=m.id)<>1) AS mapNeedsReview
            FROM discoveries d ORDER BY d.id";
        let pool = database.pool().await;
        let read_pool = pool.clone();
        let (ready, running) = tokio::sync::oneshot::channel();
        let reader = tokio::spawn(async move {
            let mut rows = Box::pin(sqlx::query(old_query).fetch(&read_pool));
            std::future::poll_fn(|cx| rows.as_mut().poll_next(cx))
                .await
                .unwrap()
                .unwrap();
            ready.send(()).unwrap();
            while let Some(row) = std::future::poll_fn(|cx| rows.as_mut().poll_next(cx)).await {
                row.unwrap();
            }
        });
        tokio::time::timeout(Duration::from_secs(30), async {
            running.await.unwrap();
            let mut writer = pool.acquire().await.unwrap();
            let result = complete_quest(&mut writer, 1, 5003).await;
            eprintln!("concurrent writer with old summary: {result:?}");
            assert!(
                result.is_err(),
                "old correlated query did not retain the reader lock"
            );
            assert!(result.unwrap_err().detail.contains("locked"));
            reader.await.unwrap();
            assert!(
                complete_quest(&mut writer, 1, 5003)
                    .await
                    .unwrap()
                    .quest_changed
            );
        })
        .await
        .expect("old-query reproduction exceeded 30 seconds");
        let fixed_started = std::time::Instant::now();
        tokio::time::timeout(Duration::from_secs(2), async {
            let read = sqlx::query(&summary_sql).bind(1i64).fetch_all(&*pool);
            let write = async {
                let mut connection = pool.acquire().await.unwrap();
                complete_quest(&mut connection, 1, 5004).await.unwrap()
            };
            let (rows, result) = tokio::join!(read, write);
            assert_eq!(rows.unwrap().len(), 4032);
            assert!(result.quest_changed);
            sqlx::query("DELETE FROM quest_progress WHERE profile_id=1 AND quest_id=5004")
                .execute(&*pool)
                .await
                .unwrap();
        })
        .await
        .expect("fixed summary blocked a concurrent quest command");
        eprintln!(
            "fixed summary and concurrent writer completed in {:?}",
            fixed_started.elapsed()
        );
        drop(pool);
        database.pool().await.close().await;
        std::fs::remove_dir_all(directory).unwrap();
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
