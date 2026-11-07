use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row, SqliteConnection};
use tauri::State;

use crate::{active_database::ActiveDatabase, discovery_capabilities, progress_link};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StateError {
    pub(crate) kind: &'static str,
    user_message: &'static str,
    detail: String,
}

impl StateError {
    fn unsupported() -> Self {
        Self {
            kind: "UnsupportedDiscoveryOperation",
            user_message: "この発見物ではこの操作は利用できません。",
            detail: "Manual reporting is not supported".into(),
        }
    }
    pub(crate) fn invalid(detail: impl Into<String>) -> Self {
        Self {
            kind: "InvalidDiscoveryOperation",
            user_message: "対象または操作内容を確認してください。",
            detail: detail.into(),
        }
    }
    pub(crate) fn conflict() -> Self {
        Self {
            kind: "DiscoveryStateConflict",
            user_message: "状態が変更されています。再読み込みしてください。",
            detail: "Expected state does not match current state".into(),
        }
    }
}

impl From<sqlx::Error> for StateError {
    fn from(error: sqlx::Error) -> Self {
        if let sqlx::Error::Database(ref db) = error {
            if db
                .code()
                .and_then(|code| code.parse::<i32>().ok())
                .is_some_and(|code| matches!(code & 255, 5 | 6))
            {
                return Self::conflict();
            }
        }
        Self {
            kind: "DatabaseError",
            user_message: "進捗を更新できませんでした。再読み込みしてください。",
            detail: error.to_string(),
        }
    }
}

impl From<progress_link::ProgressLinkCommandError> for StateError {
    fn from(error: progress_link::ProgressLinkCommandError) -> Self {
        Self {
            kind: error.kind,
            user_message: "登録できませんでした。再読み込みしてください。",
            detail: format!("{error:?}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurrentProgress {
    pub(crate) reported: bool,
    pub(crate) report_hold: bool,
    card_owned: bool,
    memo: Option<String>,
    updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FirstReportStatus {
    Unknown,
    NotReported,
    Confirmed,
}

impl FirstReportStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::NotReported => "not_reported",
            Self::Confirmed => "confirmed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportingHistory {
    status: FirstReportStatus,
    legacy_merit_credit: bool,
    updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedQuest {
    id: i64,
    offer_method: Option<String>,
    active: bool,
    updated_at: String,
    discovery_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryState {
    pub(crate) profile_id: i64,
    pub(crate) discovery_id: i64,
    pub(crate) progress: Option<CurrentProgress>,
    history: Option<ReportingHistory>,
    category_name: Option<String>,
    active: bool,
    master_updated_at: String,
    automatic_reporting: bool,
    related_quests: Vec<RelatedQuest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StateRequest {
    profile_id: i64,
    discovery_id: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CurrentState {
    Undiscovered,
    Unreported,
    Reported,
    ReportHold,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Operation {
    Register {
        state: CurrentState,
        selected_quest_id: Option<i64>,
    },
    Report,
    Rediscover {
        hold: bool,
    },
    SetHold {
        value: bool,
    },
    CorrectHistory {
        status: FirstReportStatus,
        remove_legacy_credit: bool,
        current_state: Option<CurrentState>,
    },
    RemoveCurrent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateRequest {
    expected: DiscoveryState,
    source_map_id: Option<i64>,
    operation: Operation,
}

#[tauri::command]
pub(crate) async fn get_discovery_state(
    database: State<'_, ActiveDatabase>,
    request: StateRequest,
) -> Result<DiscoveryState, StateError> {
    let pool = database.pool().await;
    let mut connection = pool.acquire().await?;
    let mut tx = connection.begin().await?;
    let result = read_state(&mut tx, request.profile_id, request.discovery_id).await?;
    tx.commit().await?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn update_discovery_state(
    database: State<'_, ActiveDatabase>,
    request: UpdateRequest,
) -> Result<DiscoveryState, StateError> {
    let pool = database.pool().await;
    let mut connection = pool.acquire().await?;
    update(&mut connection, request).await
}

pub(crate) async fn read_state(
    connection: &mut SqliteConnection,
    profile: i64,
    discovery: i64,
) -> Result<DiscoveryState, StateError> {
    validate_profile(connection, profile).await?;
    let row = sqlx::query("SELECT d.is_active,d.updated_at,c.name FROM discoveries d LEFT JOIN discovery_categories c ON c.id=d.category_id WHERE d.id=?")
        .bind(discovery).fetch_optional(&mut *connection).await?
        .ok_or_else(|| StateError::invalid("Discovery does not exist"))?;
    let progress = sqlx::query("SELECT reported,report_hold,card_owned,memo,updated_at FROM discovery_progress WHERE profile_id=? AND discovery_id=?")
        .bind(profile).bind(discovery).fetch_optional(&mut *connection).await?
        .map(|r| CurrentProgress { reported:r.get("reported"),report_hold:r.get("report_hold"),card_owned:r.get("card_owned"),memo:r.get("memo"),updated_at:r.get("updated_at") });
    let history = sqlx::query("SELECT first_report_status,legacy_merit_credit,updated_at FROM discovery_reporting_history WHERE profile_id=? AND discovery_id=?")
        .bind(profile).bind(discovery).fetch_optional(&mut *connection).await?
        .map(|r| -> Result<ReportingHistory, StateError> { Ok(ReportingHistory {
            status:match r.get::<String,_>("first_report_status").as_str() {
                "unknown"=>FirstReportStatus::Unknown,"not_reported"=>FirstReportStatus::NotReported,"confirmed"=>FirstReportStatus::Confirmed,
                _=>return Err(StateError::invalid("Invalid history status")),
            },legacy_merit_credit:r.get("legacy_merit_credit"),updated_at:r.get("updated_at") }) }).transpose()?;
    let related_quests = sqlx::query("SELECT q.id,q.offer_method,q.is_active,q.updated_at,(SELECT COUNT(*) FROM quest_discoveries all_qd WHERE all_qd.quest_id=q.id) AS discovery_count FROM quest_discoveries qd JOIN quests q ON q.id=qd.quest_id WHERE qd.discovery_id=? ORDER BY q.id")
        .bind(discovery).fetch_all(&mut *connection).await?.iter()
        .map(|r| RelatedQuest { id:r.get("id"),offer_method:r.get("offer_method"),active:r.get("is_active"),updated_at:r.get("updated_at"),discovery_count:r.get("discovery_count") }).collect();
    let automatic_reporting = sqlx::query_scalar(&format!(
        "SELECT ? IN ({})",
        discovery_capabilities::automatic_reporting_discoveries_sql()
    ))
    .bind(discovery)
    .fetch_one(&mut *connection)
    .await?;
    Ok(DiscoveryState {
        profile_id: profile,
        discovery_id: discovery,
        progress,
        history,
        category_name: row.get("name"),
        active: row.get("is_active"),
        master_updated_at: row.get("updated_at"),
        automatic_reporting,
        related_quests,
    })
}

pub(crate) async fn validate_profile(
    connection: &mut SqliteConnection,
    profile: i64,
) -> Result<(), StateError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?)")
        .bind(profile)
        .fetch_one(connection)
        .await?;
    if profile <= 0 || !exists {
        return Err(StateError::invalid("Profile does not exist"));
    }
    Ok(())
}

// 呼び出し側の書き込みtransaction内で使用する。自動報告を実報告確認へ変換しない。
pub(crate) async fn initialize(
    connection: &mut SqliteConnection,
    profile: i64,
    discovery: i64,
    route: Option<i64>,
) -> Result<bool, StateError> {
    let changed = sqlx::query(&format!("INSERT INTO discovery_progress(profile_id,discovery_id,reported,card_owned) SELECT ?,d.id,CASE WHEN c.name IS NOT 'レリック' AND ? IN ({}) THEN 1 ELSE 0 END,CASE WHEN c.name='レリック' THEN 0 ELSE 1 END FROM discoveries d LEFT JOIN discovery_categories c ON c.id=d.category_id WHERE d.id=? AND d.is_active=1 ON CONFLICT(profile_id,discovery_id) DO NOTHING", discovery_capabilities::SPECIAL_REPORTING_QUESTS_SQL))
        .bind(profile).bind(route).bind(discovery).execute(connection).await?.rows_affected()==1;
    Ok(changed)
}

pub(crate) async fn confirm_report(
    connection: &mut SqliteConnection,
    profile: i64,
    discovery: i64,
) -> Result<(), StateError> {
    sqlx::query("INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status) VALUES (?,?,'confirmed') ON CONFLICT(profile_id,discovery_id) DO UPDATE SET first_report_status='confirmed',legacy_merit_credit=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .bind(profile).bind(discovery).execute(connection).await?;
    Ok(())
}

pub(crate) async fn update(
    connection: &mut SqliteConnection,
    request: UpdateRequest,
) -> Result<DiscoveryState, StateError> {
    // 検証前にwriter lockを取得し、別connectionの検証・更新との交錯を防ぐ。
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await?;
    let result = apply(&mut tx, request).await;
    match result {
        Ok(state) => {
            tx.commit().await?;
            Ok(state)
        }
        Err(error) => {
            tx.rollback().await?;
            Err(error)
        }
    }
}

async fn apply(
    connection: &mut SqliteConnection,
    request: UpdateRequest,
) -> Result<DiscoveryState, StateError> {
    let expected = request.expected;
    let profile = expected.profile_id;
    let discovery = expected.discovery_id;
    let before = read_state(connection, profile, discovery).await?;
    if before != expected {
        return Err(StateError::conflict());
    }
    if let Some(map) = request.source_map_id {
        let valid = before.active
            && before.related_quests.iter().any(|q| {
                q.id == map
                    && q.active
                    && q.discovery_count == 1
                    && matches!(
                        q.offer_method.as_deref(),
                        Some(
                            "地理学"
                                | "考古学"
                                | "宗教学"
                                | "生物学"
                                | "美術"
                                | "財宝鑑定"
                                | "天文学"
                        )
                    )
            });
        if !valid {
            return Err(StateError::invalid(
                "Map is inactive, unrelated, unsupported, or has multiple discoveries",
            ));
        }
    }
    match request.operation {
        Operation::Register {
            state,
            selected_quest_id,
        } => {
            if before.progress.is_some() {
                return Err(StateError::conflict());
            }
            if !before.active || matches!(state, CurrentState::Undiscovered) {
                return Err(StateError::invalid("Invalid registration"));
            }
            if let Some(map) = request.source_map_id {
                if selected_quest_id != Some(map) {
                    return Err(StateError::invalid(
                        "Registration route must match source map",
                    ));
                }
            }
            progress_link::discover_transaction(connection, profile, discovery, selected_quest_id)
                .await
                .map_err(StateError::from)?;
            // 特殊Questによる初期化は既存規則を優先し、通常の未報告指定で上書きしない。
            if !matches!(state, CurrentState::Unreported) {
                write_current(connection, &before, state).await?;
            }
        }
        Operation::Report => write_current(connection, &before, CurrentState::Reported).await?,
        Operation::Rediscover { hold } => {
            manual_report_allowed(&before)?;
            if !before.progress.as_ref().is_some_and(|p| p.reported) {
                return Err(StateError::invalid(
                    "Rediscovery requires a currently reported discovery",
                ));
            }
            write_current(
                connection,
                &before,
                if hold {
                    CurrentState::ReportHold
                } else {
                    CurrentState::Unreported
                },
            )
            .await?
        }
        Operation::SetHold { value } => {
            let progress = before.progress.as_ref().ok_or_else(StateError::conflict)?;
            if value {
                manual_report_allowed(&before)?;
            }
            if value && progress.reported {
                return Err(StateError::invalid(
                    "Use rediscover to change reported state",
                ));
            }
            sqlx::query("UPDATE discovery_progress SET report_hold=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE profile_id=? AND discovery_id=?")
                .bind(value).bind(profile).bind(discovery).execute(&mut *connection).await?;
        }
        Operation::RemoveCurrent => {
            write_current(connection, &before, CurrentState::Undiscovered).await?
        }
        Operation::CorrectHistory {
            status,
            remove_legacy_credit,
            current_state,
        } => {
            if !discovery_capabilities::can_report(before.category_name.as_deref()) {
                return Err(StateError::invalid("Relic history is not applicable"));
            }
            if let Some(state) = current_state {
                if matches!(state, CurrentState::Reported) && status != FirstReportStatus::Confirmed
                {
                    return Err(StateError::invalid(
                        "Recording a report requires confirmed history",
                    ));
                }
                if before.progress.is_none() {
                    return Err(StateError::invalid(
                        "Correction cannot register a discovery",
                    ));
                }
                write_current(connection, &before, state).await?;
            }
            let current = read_state(connection, profile, discovery).await?;
            if status == FirstReportStatus::NotReported
                && current.progress.as_ref().is_some_and(|p| p.reported)
                && !current.automatic_reporting
            {
                return Err(StateError::invalid(
                    "Unreported history conflicts with current reported state",
                ));
            }
            let credit = status == FirstReportStatus::Unknown
                && !remove_legacy_credit
                && before
                    .history
                    .as_ref()
                    .is_some_and(|h| h.legacy_merit_credit);
            sqlx::query("INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status,legacy_merit_credit) VALUES (?,?,?,?) ON CONFLICT(profile_id,discovery_id) DO UPDATE SET first_report_status=excluded.first_report_status,legacy_merit_credit=excluded.legacy_merit_credit,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
                .bind(profile).bind(discovery).bind(status.as_str()).bind(credit).execute(&mut *connection).await?;
        }
    }
    read_state(connection, profile, discovery).await
}

// 既存UIの二値操作は実行時の状態へ適用する。falseは再発見として履歴を保持する。
pub(crate) async fn update_compat(
    connection: &mut SqliteConnection,
    profile: i64,
    discovery: i64,
    operation: Operation,
) -> Result<DiscoveryState, StateError> {
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await?;
    let result = async {
        let expected = read_state(&mut tx, profile, discovery).await?;
        // 旧UIのfalse再送は、既に未報告なら維持意思も含めて変更しない。
        if matches!(operation, Operation::Rediscover { hold: false })
            && expected.progress.as_ref().is_some_and(|p| !p.reported)
        {
            manual_report_allowed(&expected)?;
            return Ok(expected);
        }
        apply(
            &mut tx,
            UpdateRequest {
                expected,
                source_map_id: None,
                operation,
            },
        )
        .await
    }
    .await;
    match result {
        Ok(state) => {
            tx.commit().await?;
            Ok(state)
        }
        Err(error) => {
            tx.rollback().await?;
            Err(error)
        }
    }
}

fn manual_report_allowed(state: &DiscoveryState) -> Result<(), StateError> {
    if state.automatic_reporting
        || !discovery_capabilities::can_report(state.category_name.as_deref())
    {
        return Err(StateError::unsupported());
    }
    Ok(())
}

async fn write_current(
    connection: &mut SqliteConnection,
    state: &DiscoveryState,
    target: CurrentState,
) -> Result<(), StateError> {
    let profile = state.profile_id;
    let discovery = state.discovery_id;
    if matches!(target, CurrentState::Undiscovered) {
        sqlx::query("DELETE FROM discovery_progress WHERE profile_id=? AND discovery_id=?")
            .bind(profile)
            .bind(discovery)
            .execute(connection)
            .await?;
        return Ok(());
    }
    manual_report_allowed(state)?;
    let result=sqlx::query("UPDATE discovery_progress SET reported=?,report_hold=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE profile_id=? AND discovery_id=?")
        .bind(matches!(target,CurrentState::Reported)).bind(matches!(target,CurrentState::ReportHold))
        .bind(profile).bind(discovery).execute(&mut *connection).await?;
    if result.rows_affected() != 1 {
        return Err(StateError::conflict());
    }
    if matches!(target, CurrentState::Reported) {
        confirm_report(connection, profile, discovery).await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "discovery_state_tests.rs"]
mod tests;
