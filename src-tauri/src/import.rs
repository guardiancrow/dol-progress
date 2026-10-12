use std::{
    collections::{HashMap, HashSet},
    fs,
};

use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row, SqliteConnection, Transaction};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::active_database::ActiveDatabase;
use crate::quest_facets;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedFile {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportDataset {
    Quests,
    Discoveries,
}

impl ImportDataset {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Quests => "quests",
            Self::Discoveries => "discoveries",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportWarning {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    row_number: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipReference {
    gvdb_id: i64,
    display_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedQuestRow {
    gvdb_id: i64,
    source_order: i64,
    title: String,
    difficulty: Option<i64>,
    chrono_quest: Option<String>,
    offer_method: Option<String>,
    offer_city: Option<String>,
    required_skills: Option<String>,
    discovery_type_text: Option<String>,
    discovery_name: Option<String>,
    reward_items: Option<String>,
    notes: Option<String>,
    source_updated_at: Option<String>,
    chain_name: Option<String>,
    chain_order: Option<i64>,
    prerequisites: Vec<RelationshipReference>,
    dependents: Vec<RelationshipReference>,
    raw_row_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedDiscoveryRow {
    gvdb_id: i64,
    source_order: i64,
    category_name: Option<String>,
    name: String,
    rank: Option<i64>,
    description: Option<String>,
    era: Option<String>,
    points: Option<i64>,
    difficulty: Option<i64>,
    experience: Option<i64>,
    notes: Option<String>,
    source_updated_at: Option<String>,
    related_quests: Vec<RelationshipReference>,
    raw_row_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedImportRequest {
    dataset: ImportDataset,
    file_name: String,
    sha256: String,
    quests: Vec<NormalizedQuestRow>,
    discoveries: Vec<NormalizedDiscoveryRow>,
    warnings: Vec<ImportWarning>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    dataset: ImportDataset,
    file_name: String,
    sha256: String,
    imported_row_count: usize,
    inserted_count: usize,
    updated_count: usize,
    inactive_count: usize,
    relation_count: usize,
    warning_count: usize,
    warnings: Vec<ImportWarning>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommandError {
    kind: &'static str,
    user_message: String,
    detail: String,
}

impl ImportCommandError {
    fn duplicate(detail: impl Into<String>) -> Self {
        Self {
            kind: "DuplicateImport",
            user_message: "このファイルは既にインポート済みです。".into(),
            detail: detail.into(),
        }
    }

    fn database(detail: impl Into<String>) -> Self {
        Self {
            kind: "DatabaseImportError",
            user_message: "データベースへの取り込みに失敗しました。".into(),
            detail: detail.into(),
        }
    }
}

impl From<sqlx::Error> for ImportCommandError {
    fn from(error: sqlx::Error) -> Self {
        Self::database(error.to_string())
    }
}

#[tauri::command]
pub fn select_import_file(app: AppHandle) -> Result<Option<SelectedFile>, ImportCommandError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("大航海時代データベース CSV", &["csv"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = match selected {
        FilePath::Path(path) => path,
        FilePath::Url(url) => {
            return Err(ImportCommandError::database(format!(
                "Only local file paths are supported: {url}"
            )))
        }
    };
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ImportCommandError::database("Selected file name is not valid Unicode"))?
        .to_owned();
    let bytes = fs::read(&path).map_err(|error| {
        ImportCommandError::database(format!("Failed to read {}: {error}", path.display()))
    })?;
    Ok(Some(SelectedFile { file_name, bytes }))
}

#[tauri::command]
pub async fn apply_master_import(
    database: State<'_, ActiveDatabase>,
    request: NormalizedImportRequest,
) -> Result<ImportResult, ImportCommandError> {
    let pool = database.pool().await;
    let mut connection = pool
        .acquire()
        .await
        .map_err(|error| ImportCommandError::database(error.to_string()))?;
    apply_import(&mut connection, request, FailurePoint::None).await
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FailurePoint {
    None,
    AfterRelationshipRebuild,
}

async fn apply_import(
    connection: &mut SqliteConnection,
    request: NormalizedImportRequest,
    failure_point: FailurePoint,
) -> Result<ImportResult, ImportCommandError> {
    validate_request_shape(&request)?;
    let mut transaction = connection.begin().await?;
    let result = apply_import_transaction(&mut transaction, request, failure_point).await;
    match result {
        Ok(result) => {
            transaction.commit().await?;
            Ok(result)
        }
        Err(error) => {
            transaction
                .rollback()
                .await
                .map_err(ImportCommandError::from)?;
            Err(error)
        }
    }
}

#[cfg(test)]
pub(crate) async fn apply_import_for_test(
    connection: &mut SqliteConnection,
    request: NormalizedImportRequest,
) -> Result<ImportResult, ImportCommandError> {
    apply_import(connection, request, FailurePoint::None).await
}

fn validate_request_shape(request: &NormalizedImportRequest) -> Result<(), ImportCommandError> {
    let valid = match request.dataset {
        ImportDataset::Quests => !request.quests.is_empty() && request.discoveries.is_empty(),
        ImportDataset::Discoveries => request.quests.is_empty() && !request.discoveries.is_empty(),
    };
    if !valid {
        return Err(ImportCommandError::database(
            "Normalized import payload does not match its dataset or has no rows",
        ));
    }
    Ok(())
}

async fn apply_import_transaction(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    request: NormalizedImportRequest,
    failure_point: FailurePoint,
) -> Result<ImportResult, ImportCommandError> {
    let duplicate: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM master_import_history WHERE dataset = ? AND file_sha256 = ?)",
    )
    .bind(request.dataset.as_str())
    .bind(&request.sha256)
    .fetch_one(&mut **transaction)
    .await?;
    let source_order_incomplete = source_order_incomplete(transaction, &request.dataset).await?;
    let metadata_refresh = duplicate == 1 && source_order_incomplete;
    if duplicate == 1 && !metadata_refresh {
        return Err(ImportCommandError::duplicate(format!(
            "{}:{}",
            request.dataset.as_str(),
            request.sha256
        )));
    }

    let existing_ids = existing_master_ids(transaction, &request.dataset).await?;
    let active_ids = active_master_ids(transaction, &request.dataset).await?;
    let incoming_ids: HashSet<i64> = match request.dataset {
        ImportDataset::Quests => request.quests.iter().map(|row| row.gvdb_id).collect(),
        ImportDataset::Discoveries => request.discoveries.iter().map(|row| row.gvdb_id).collect(),
    };
    let inserted_count = incoming_ids.difference(&existing_ids).count();
    let updated_count = incoming_ids.intersection(&existing_ids).count();
    let inactive_count = active_ids.difference(&incoming_ids).count();

    match request.dataset {
        ImportDataset::Quests => update_quests(transaction, &request.quests).await?,
        ImportDataset::Discoveries => update_discoveries(transaction, &request.discoveries).await?,
    }

    let imported_row_count = incoming_ids.len();
    let source_max_updated_at = source_max_updated_at(&request);
    let mut warnings = request.warnings;
    let relation_count = rebuild_relationships(transaction, &mut warnings).await?;
    if failure_point == FailurePoint::AfterRelationshipRebuild {
        return Err(ImportCommandError::database(
            "Injected failure after relationship rebuild",
        ));
    }
    let notes = serde_json::to_string(&warnings)
        .map_err(|error| ImportCommandError::database(error.to_string()))?;

    if !metadata_refresh {
        sqlx::query(
            "INSERT INTO master_import_history \
             (dataset, file_name, file_sha256, row_count, source_max_updated_at, notes) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(request.dataset.as_str())
        .bind(&request.file_name)
        .bind(&request.sha256)
        .bind(imported_row_count as i64)
        .bind(source_max_updated_at)
        .bind(notes)
        .execute(&mut **transaction)
        .await?;
    }

    Ok(ImportResult {
        dataset: request.dataset,
        file_name: request.file_name,
        sha256: request.sha256,
        imported_row_count,
        inserted_count,
        updated_count,
        inactive_count,
        relation_count,
        warning_count: warnings.len(),
        warnings,
    })
}

async fn source_order_incomplete(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    dataset: &ImportDataset,
) -> Result<bool, ImportCommandError> {
    let sql = match dataset {
        ImportDataset::Quests => {
            "SELECT EXISTS(SELECT 1 FROM quests WHERE is_active = 1 AND source_order IS NULL)"
        }
        ImportDataset::Discoveries => {
            "SELECT EXISTS(SELECT 1 FROM discoveries WHERE is_active = 1 AND source_order IS NULL)"
        }
    };
    Ok(sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(&mut **transaction)
        .await?
        == 1)
}

async fn existing_master_ids(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    dataset: &ImportDataset,
) -> Result<HashSet<i64>, ImportCommandError> {
    let sql = match dataset {
        ImportDataset::Quests => "SELECT gvdb_id FROM quests",
        ImportDataset::Discoveries => "SELECT gvdb_id FROM discoveries",
    };
    Ok(sqlx::query_scalar::<_, i64>(sql)
        .fetch_all(&mut **transaction)
        .await?
        .into_iter()
        .collect())
}

async fn active_master_ids(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    dataset: &ImportDataset,
) -> Result<HashSet<i64>, ImportCommandError> {
    let sql = match dataset {
        ImportDataset::Quests => "SELECT gvdb_id FROM quests WHERE is_active = 1",
        ImportDataset::Discoveries => "SELECT gvdb_id FROM discoveries WHERE is_active = 1",
    };
    Ok(sqlx::query_scalar::<_, i64>(sql)
        .fetch_all(&mut **transaction)
        .await?
        .into_iter()
        .collect())
}

async fn update_quests(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    rows: &[NormalizedQuestRow],
) -> Result<(), ImportCommandError> {
    sqlx::query(
        "UPDATE quests SET is_active = 0, \
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .execute(&mut **transaction)
    .await?;

    for row in rows {
        // These source fields are validated in TypeScript and retained across the IPC boundary.
        // Derived relationships are rebuilt from raw_row_json after all UPSERTs.
        let _validated_source_fields = (&row.discovery_name, &row.prerequisites, &row.dependents);
        sqlx::query(
            "INSERT INTO quests (\
               gvdb_id, title, difficulty, chrono_quest, offer_method, offer_city, \
               required_skills, discovery_type_text, reward_items, notes, chain_name, \
               chain_order, source_updated_at, source_order, is_active, raw_row_json\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) \
             ON CONFLICT(gvdb_id) DO UPDATE SET \
               title = excluded.title, difficulty = excluded.difficulty, \
               chrono_quest = excluded.chrono_quest, offer_method = excluded.offer_method, \
               offer_city = excluded.offer_city, required_skills = excluded.required_skills, \
               discovery_type_text = excluded.discovery_type_text, \
               reward_items = excluded.reward_items, notes = excluded.notes, \
                chain_name = excluded.chain_name, chain_order = excluded.chain_order, \
                source_updated_at = excluded.source_updated_at, source_order = excluded.source_order, is_active = 1, \
               raw_row_json = excluded.raw_row_json, \
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        )
        .bind(row.gvdb_id)
        .bind(&row.title)
        .bind(row.difficulty)
        .bind(&row.chrono_quest)
        .bind(&row.offer_method)
        .bind(&row.offer_city)
        .bind(&row.required_skills)
        .bind(&row.discovery_type_text)
        .bind(&row.reward_items)
        .bind(&row.notes)
        .bind(&row.chain_name)
        .bind(row.chain_order)
        .bind(&row.source_updated_at)
        .bind(row.source_order)
        .bind(&row.raw_row_json)
        .execute(&mut **transaction)
        .await?;
        let quest_id: i64 = sqlx::query_scalar("SELECT id FROM quests WHERE gvdb_id = ?")
            .bind(row.gvdb_id)
            .fetch_one(&mut **transaction)
            .await?;
        quest_facets::replace_for_quest(
            transaction,
            quest_id,
            row.required_skills.as_deref(),
            row.offer_city.as_deref(),
        )
        .await?;
    }
    Ok(())
}

async fn update_discoveries(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    rows: &[NormalizedDiscoveryRow],
) -> Result<(), ImportCommandError> {
    sqlx::query(
        "UPDATE discoveries SET is_active = 0, \
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "UPDATE discovery_categories SET is_active = 0, \
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .execute(&mut **transaction)
    .await?;

    let mut next_sort_order: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM discovery_categories")
            .fetch_one(&mut **transaction)
            .await?;
    let mut category_ids = HashMap::<String, i64>::new();

    for row in rows {
        let _validated_relationships = &row.related_quests;
        let category_id = if let Some(category_name) = &row.category_name {
            if let Some(id) = category_ids.get(category_name) {
                Some(*id)
            } else {
                sqlx::query(
                    "INSERT INTO discovery_categories (name, sort_order, is_active) \
                     VALUES (?, ?, 1) \
                     ON CONFLICT(name) DO UPDATE SET \
                       is_active = 1, \
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                )
                .bind(category_name)
                .bind(next_sort_order)
                .execute(&mut **transaction)
                .await?;
                let id: i64 =
                    sqlx::query_scalar("SELECT id FROM discovery_categories WHERE name = ?")
                        .bind(category_name)
                        .fetch_one(&mut **transaction)
                        .await?;
                let was_new: i64 = sqlx::query_scalar(
                    "SELECT CASE WHEN sort_order = ? THEN 1 ELSE 0 END \
                     FROM discovery_categories WHERE id = ?",
                )
                .bind(next_sort_order)
                .bind(id)
                .fetch_one(&mut **transaction)
                .await?;
                if was_new == 1 {
                    next_sort_order += 1;
                }
                category_ids.insert(category_name.clone(), id);
                Some(id)
            }
        } else {
            None
        };

        sqlx::query(
            "INSERT INTO discoveries (\
               gvdb_id, category_id, name, rank, description, era, points, difficulty, \
               experience, notes, source_updated_at, source_order, is_active, raw_row_json\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) \
             ON CONFLICT(gvdb_id) DO UPDATE SET \
               category_id = excluded.category_id, name = excluded.name, rank = excluded.rank, \
               description = excluded.description, era = excluded.era, points = excluded.points, \
               difficulty = excluded.difficulty, experience = excluded.experience, \
                notes = excluded.notes, source_updated_at = excluded.source_updated_at, \
                source_order = excluded.source_order, is_active = 1, raw_row_json = excluded.raw_row_json, \
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        )
        .bind(row.gvdb_id)
        .bind(category_id)
        .bind(&row.name)
        .bind(row.rank)
        .bind(&row.description)
        .bind(&row.era)
        .bind(row.points)
        .bind(row.difficulty)
        .bind(row.experience)
        .bind(&row.notes)
        .bind(&row.source_updated_at)
        .bind(row.source_order)
        .bind(&row.raw_row_json)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

fn source_max_updated_at(request: &NormalizedImportRequest) -> Option<String> {
    match request.dataset {
        ImportDataset::Quests => request
            .quests
            .iter()
            .filter_map(|row| row.source_updated_at.clone())
            .max(),
        ImportDataset::Discoveries => request
            .discoveries
            .iter()
            .filter_map(|row| row.source_updated_at.clone())
            .max(),
    }
}

async fn rebuild_relationships(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    warnings: &mut Vec<ImportWarning>,
) -> Result<usize, ImportCommandError> {
    let quest_rows = sqlx::query("SELECT id, gvdb_id, title, raw_row_json FROM quests")
        .fetch_all(&mut **transaction)
        .await?;
    let discovery_rows = sqlx::query("SELECT id, gvdb_id, name, raw_row_json FROM discoveries")
        .fetch_all(&mut **transaction)
        .await?;

    let quests: HashMap<i64, (i64, String, String)> = quest_rows
        .into_iter()
        .map(|row| {
            (
                row.get::<i64, _>("gvdb_id"),
                (
                    row.get::<i64, _>("id"),
                    row.get::<String, _>("title"),
                    row.get::<String, _>("raw_row_json"),
                ),
            )
        })
        .collect();
    let discoveries: HashMap<i64, (i64, String, String)> = discovery_rows
        .into_iter()
        .map(|row| {
            (
                row.get::<i64, _>("gvdb_id"),
                (
                    row.get::<i64, _>("id"),
                    row.get::<String, _>("name"),
                    row.get::<String, _>("raw_row_json"),
                ),
            )
        })
        .collect();

    let mut quest_discoveries = HashSet::<(i64, i64)>::new();
    let mut dependencies = HashSet::<(i64, i64)>::new();

    for (quest_gvdb_id, (_, _, raw_json)) in &quests {
        let raw = parse_raw_row(raw_json)?;
        for reference in parse_raw_relationship(raw.get("前提クエスト"), "quests.前提クエスト")?
        {
            add_dependency(
                warnings,
                &quests,
                &mut dependencies,
                *quest_gvdb_id,
                reference.gvdb_id,
                DependencyNameTarget::Prerequisite,
                &reference.display_name,
            );
        }
        for reference in parse_raw_relationship(raw.get("後続クエスト"), "quests.後続クエスト")?
        {
            add_dependency(
                warnings,
                &quests,
                &mut dependencies,
                reference.gvdb_id,
                *quest_gvdb_id,
                DependencyNameTarget::Quest,
                &reference.display_name,
            );
        }
    }

    for (discovery_id, _, raw_json) in discoveries.values() {
        let raw = parse_raw_row(raw_json)?;
        for reference in
            parse_raw_relationship(raw.get("関連クエスト"), "discoveries.関連クエスト")?
        {
            if let Some((quest_id, actual_name, _)) = quests.get(&reference.gvdb_id) {
                warn_name_mismatch(
                    warnings,
                    "QuestNameMismatch",
                    reference.gvdb_id,
                    &reference.display_name,
                    actual_name,
                );
                quest_discoveries.insert((*quest_id, *discovery_id));
            } else {
                warn_missing(warnings, "MissingQuest", reference.gvdb_id);
            }
        }
    }

    sqlx::query("DELETE FROM quest_discoveries")
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM quest_dependencies")
        .execute(&mut **transaction)
        .await?;

    for (quest_id, discovery_id) in &quest_discoveries {
        sqlx::query("INSERT INTO quest_discoveries (quest_id, discovery_id) VALUES (?, ?)")
            .bind(quest_id)
            .bind(discovery_id)
            .execute(&mut **transaction)
            .await?;
    }
    for (quest_id, prerequisite_quest_id) in &dependencies {
        sqlx::query(
            "INSERT INTO quest_dependencies (quest_id, prerequisite_quest_id) VALUES (?, ?)",
        )
        .bind(quest_id)
        .bind(prerequisite_quest_id)
        .execute(&mut **transaction)
        .await?;
    }

    Ok(quest_discoveries.len() + dependencies.len())
}

fn parse_raw_row(
    raw_json: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, ImportCommandError> {
    let value: serde_json::Value = serde_json::from_str(raw_json)
        .map_err(|error| ImportCommandError::database(format!("Invalid raw_row_json: {error}")))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| ImportCommandError::database("raw_row_json is not an object"))
}

fn parse_raw_relationship(
    value: Option<&serde_json::Value>,
    field: &str,
) -> Result<Vec<RelationshipReference>, ImportCommandError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let text = value
        .as_str()
        .ok_or_else(|| ImportCommandError::database(format!("{field} is not a string")))?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut unique = HashMap::<i64, RelationshipReference>::new();
    for item in text.split(',') {
        let (id, display_name) = item
            .split_once(':')
            .ok_or_else(|| ImportCommandError::database(format!("Invalid {field}: {item}")))?;
        let gvdb_id = id.trim().parse::<i64>().map_err(|error| {
            ImportCommandError::database(format!("Invalid {field} ID: {error}"))
        })?;
        if gvdb_id <= 0 {
            return Err(ImportCommandError::database(format!(
                "Invalid non-positive {field} ID: {gvdb_id}"
            )));
        }
        unique.entry(gvdb_id).or_insert(RelationshipReference {
            gvdb_id,
            display_name: display_name.trim().to_owned(),
        });
    }
    Ok(unique.into_values().collect())
}

enum DependencyNameTarget {
    Quest,
    Prerequisite,
}

fn add_dependency(
    warnings: &mut Vec<ImportWarning>,
    quests: &HashMap<i64, (i64, String, String)>,
    dependencies: &mut HashSet<(i64, i64)>,
    quest_gvdb_id: i64,
    prerequisite_gvdb_id: i64,
    name_target: DependencyNameTarget,
    display_name: &str,
) {
    if quest_gvdb_id == prerequisite_gvdb_id {
        return;
    }
    let Some((quest_id, quest_name, _)) = quests.get(&quest_gvdb_id) else {
        warn_missing(warnings, "MissingQuest", quest_gvdb_id);
        return;
    };
    let Some((prerequisite_id, prerequisite_name, _)) = quests.get(&prerequisite_gvdb_id) else {
        warn_missing(warnings, "MissingPrerequisite", prerequisite_gvdb_id);
        return;
    };
    let (named_quest_gvdb_id, actual_name) = match name_target {
        DependencyNameTarget::Quest => (quest_gvdb_id, quest_name),
        DependencyNameTarget::Prerequisite => (prerequisite_gvdb_id, prerequisite_name),
    };
    warn_name_mismatch(
        warnings,
        "QuestNameMismatch",
        named_quest_gvdb_id,
        display_name,
        actual_name,
    );
    dependencies.insert((*quest_id, *prerequisite_id));
}

fn warn_missing(warnings: &mut Vec<ImportWarning>, code: &str, gvdb_id: i64) {
    warnings.push(ImportWarning {
        code: code.to_owned(),
        message: format!(
            "大航海時代データベースの関連先IDが存在しないためスキップしました: {gvdb_id}"
        ),
        row_number: None,
    });
}

fn warn_name_mismatch(
    warnings: &mut Vec<ImportWarning>,
    code: &str,
    gvdb_id: i64,
    source_name: &str,
    actual_name: &str,
) {
    if !source_name.is_empty() && source_name != actual_name {
        warnings.push(ImportWarning {
            code: code.to_owned(),
            message: format!(
                "関連名がマスター名と一致しません (ID {gvdb_id}): {source_name} / {actual_name}"
            ),
            row_number: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use sqlx::{Connection, SqliteConnection};
    use std::collections::BTreeMap;

    use super::*;

    async fn test_database() -> SqliteConnection {
        let mut connection = SqliteConnection::connect("sqlite::memory:")
            .await
            .expect("in-memory database must open");
        sqlx::raw_sql(crate::migrations::INITIAL_SCHEMA)
            .execute(&mut connection)
            .await
            .expect("initial schema must apply");
        sqlx::raw_sql(crate::migrations::QUEST_FACETS_SCHEMA)
            .execute(&mut connection)
            .await
            .expect("quest facets schema must apply");
        sqlx::raw_sql(crate::migrations::MASTER_SOURCE_ORDER_SCHEMA)
            .execute(&mut connection)
            .await
            .expect("master source order schema must apply");
        connection
    }

    fn quest(
        id: i64,
        title: &str,
        discovery_name: &str,
        prerequisites: &str,
        dependents: &str,
    ) -> NormalizedQuestRow {
        NormalizedQuestRow {
            gvdb_id: id,
            source_order: 0,
            title: title.into(),
            difficulty: Some(5),
            chrono_quest: None,
            offer_method: None,
            offer_city: None,
            required_skills: None,
            discovery_type_text: None,
            discovery_name: (!discovery_name.is_empty()).then(|| discovery_name.into()),
            reward_items: None,
            notes: None,
            source_updated_at: Some("2026-01-01".into()),
            chain_name: None,
            chain_order: None,
            prerequisites: Vec::new(),
            dependents: Vec::new(),
            raw_row_json: serde_json::json!({
                "ID": id.to_string(),
                "クエスト名・地図名": title,
                "発見物": discovery_name,
                "前提クエスト": prerequisites,
                "後続クエスト": dependents
            })
            .to_string(),
        }
    }

    fn discovery(id: i64, name: &str, category: &str, related: &str) -> NormalizedDiscoveryRow {
        NormalizedDiscoveryRow {
            gvdb_id: id,
            source_order: 0,
            category_name: Some(category.into()),
            name: name.into(),
            rank: Some(2),
            description: None,
            era: None,
            points: None,
            difficulty: None,
            experience: None,
            notes: None,
            source_updated_at: Some("2026-01-02".into()),
            related_quests: Vec::new(),
            raw_row_json: serde_json::json!({
                "ID": id.to_string(),
                "発見物名": name,
                "関連クエスト": related
            })
            .to_string(),
        }
    }

    fn quest_at(id: i64, title: &str, source_order: i64) -> NormalizedQuestRow {
        let mut row = quest(id, title, "", "", "");
        row.source_order = source_order;
        row
    }

    fn discovery_at(id: i64, name: &str, source_order: i64) -> NormalizedDiscoveryRow {
        let mut row = discovery(id, name, "史跡", "");
        row.source_order = source_order;
        row
    }

    fn quest_with_facets(
        id: i64,
        title: &str,
        required_skills: &str,
        offer_city: &str,
    ) -> NormalizedQuestRow {
        let mut row = quest(id, title, "", "", "");
        row.required_skills = (!required_skills.is_empty()).then(|| required_skills.into());
        row.offer_city = (!offer_city.is_empty()).then(|| offer_city.into());
        row.raw_row_json = serde_json::json!({
            "ID": id.to_string(),
            "クエスト名・地図名": title,
            "必要スキル": required_skills,
            "オファー都市": offer_city,
            "前提クエスト": "",
            "後続クエスト": ""
        })
        .to_string();
        row
    }

    fn quest_request(hash: &str, rows: Vec<NormalizedQuestRow>) -> NormalizedImportRequest {
        NormalizedImportRequest {
            dataset: ImportDataset::Quests,
            file_name: "quests.csv".into(),
            sha256: hash.into(),
            quests: rows,
            discoveries: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn discovery_request(hash: &str, rows: Vec<NormalizedDiscoveryRow>) -> NormalizedImportRequest {
        NormalizedImportRequest {
            dataset: ImportDataset::Discoveries,
            file_name: "discovery_items.csv".into(),
            sha256: hash.into(),
            quests: Vec::new(),
            discoveries: rows,
            warnings: Vec::new(),
        }
    }

    #[tokio::test]
    async fn imports_updates_and_inactivates_without_deleting_master_rows() {
        let mut database = test_database().await;
        let first = apply_import(
            &mut database,
            quest_request(
                "quest-hash-1",
                vec![
                    quest(1, "Quest 1", "", "", ""),
                    quest(2, "Quest 2", "", "", ""),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .expect("first import must succeed");
        assert_eq!(first.inserted_count, 2);

        let second = apply_import(
            &mut database,
            quest_request(
                "quest-hash-2",
                vec![quest(1, "Quest 1 updated", "", "", "")],
            ),
            FailurePoint::None,
        )
        .await
        .expect("second import must succeed");
        assert_eq!(second.updated_count, 1);
        assert_eq!(second.inactive_count, 1);

        let rows: Vec<(i64, String, i64)> =
            sqlx::query_as("SELECT gvdb_id, title, is_active FROM quests ORDER BY gvdb_id")
                .fetch_all(&mut database)
                .await
                .expect("quests must be readable");
        assert_eq!(
            rows,
            vec![(1, "Quest 1 updated".into(), 1), (2, "Quest 2".into(), 0)]
        );
    }

    #[tokio::test]
    async fn rejects_duplicate_hash_inside_the_transaction() {
        let mut database = test_database().await;
        let request = quest_request("same-hash", vec![quest(1, "Quest", "", "", "")]);
        apply_import(&mut database, request.clone(), FailurePoint::None)
            .await
            .expect("first import must succeed");
        let error = apply_import(&mut database, request, FailurePoint::None)
            .await
            .expect_err("duplicate must fail");
        assert_eq!(error.kind, "DuplicateImport");
        let history_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM master_import_history")
            .fetch_one(&mut database)
            .await
            .unwrap();
        assert_eq!(history_count, 1);
    }

    #[tokio::test]
    async fn refreshes_same_hash_only_when_that_dataset_lacks_source_order_metadata() {
        let mut database = test_database().await;
        sqlx::raw_sql(
            "INSERT INTO quests (id, gvdb_id, title, raw_row_json) VALUES (1, 1, 'Legacy quest', '{}');\
             INSERT INTO discoveries (id, gvdb_id, name, raw_row_json) VALUES (1, 10, 'Legacy discovery', '{}');\
             INSERT INTO master_import_history (dataset, file_name, file_sha256, row_count) VALUES\
               ('quests', 'quests.csv', 'same-hash', 1),\
               ('discoveries', 'discovery_items.csv', 'same-hash', 1);",
        )
        .execute(&mut database)
        .await
        .unwrap();

        let discovery_error = apply_import(
            &mut database,
            discovery_request("same-hash", vec![discovery_at(10, "Legacy discovery", 0)]),
            FailurePoint::None,
        )
        .await
        .expect("incomplete discovery metadata must allow one refresh");
        assert_eq!(discovery_error.updated_count, 1);
        assert_eq!(
            sqlx::query_scalar::<_, Option<i64>>(
                "SELECT source_order FROM discoveries WHERE gvdb_id = 10"
            )
            .fetch_one(&mut database)
            .await
            .unwrap(),
            Some(0)
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM master_import_history WHERE dataset = 'discoveries'"
            )
            .fetch_one(&mut database)
            .await
            .unwrap(),
            1,
            "metadata refresh must not create a duplicate history row"
        );
        let discovery_duplicate = apply_import(
            &mut database,
            discovery_request("same-hash", vec![discovery_at(10, "Legacy discovery", 0)]),
            FailurePoint::None,
        )
        .await
        .expect_err("completed discovery metadata must restore duplicate protection");
        assert_eq!(discovery_duplicate.kind, "DuplicateImport");

        let quest_refresh = apply_import(
            &mut database,
            quest_request("same-hash", vec![quest_at(1, "Legacy quest", 0)]),
            FailurePoint::None,
        )
        .await
        .expect("quest completeness is independent from discovery completeness");
        assert_eq!(quest_refresh.updated_count, 1);
        let quest_duplicate = apply_import(
            &mut database,
            quest_request("same-hash", vec![quest_at(1, "Legacy quest", 0)]),
            FailurePoint::None,
        )
        .await
        .expect_err("completed quest metadata must restore duplicate protection");
        assert_eq!(quest_duplicate.kind, "DuplicateImport");
    }

    #[tokio::test]
    async fn source_order_tracks_incremental_rows_reorders_and_preserves_identity() {
        let mut database = test_database().await;
        sqlx::query("INSERT INTO profiles (id, name) VALUES (1, 'User')")
            .execute(&mut database)
            .await
            .unwrap();
        apply_import(
            &mut database,
            quest_request(
                "quest-source-first",
                vec![
                    quest_at(1, "A", 0),
                    quest_at(2, "B", 1),
                    quest_at(3, "C", 2),
                    quest_at(4, "D", 3),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        let original_b_id: i64 = sqlx::query_scalar("SELECT id FROM quests WHERE gvdb_id = 2")
            .fetch_one(&mut database)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, ?, 'keep')",
        )
        .bind(original_b_id)
        .execute(&mut database)
        .await
        .unwrap();

        apply_import(
            &mut database,
            quest_request(
                "quest-source-second",
                vec![
                    quest_at(1, "A", 0),
                    quest_at(5, "NEW-X", 1),
                    quest_at(2, "B", 2),
                    quest_at(3, "C", 3),
                    quest_at(6, "NEW-Y", 4),
                    quest_at(4, "D", 5),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        let ordered: Vec<i64> = sqlx::query_scalar(
            "SELECT gvdb_id FROM quests ORDER BY source_order IS NULL, source_order, id",
        )
        .fetch_all(&mut database)
        .await
        .unwrap();
        assert_eq!(ordered, vec![1, 5, 2, 3, 6, 4]);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT id FROM quests WHERE gvdb_id = 2")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            original_b_id
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT memo FROM quest_progress WHERE profile_id = 1 AND quest_id = ?"
            )
            .bind(original_b_id)
            .fetch_one(&mut database)
            .await
            .unwrap(),
            "keep"
        );

        apply_import(
            &mut database,
            quest_request(
                "quest-source-reordered",
                vec![
                    quest_at(3, "C", 0),
                    quest_at(1, "A", 1),
                    quest_at(2, "B", 2),
                    quest_at(4, "D", 3),
                    quest_at(5, "NEW-X", 4),
                    quest_at(6, "NEW-Y", 5),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        let reordered: Vec<i64> = sqlx::query_scalar(
            "SELECT gvdb_id FROM quests ORDER BY source_order IS NULL, source_order, id",
        )
        .fetch_all(&mut database)
        .await
        .unwrap();
        assert_eq!(reordered, vec![3, 1, 2, 4, 5, 6]);

        let mut linked_discovery = discovery_at(11, "B", 1);
        linked_discovery.related_quests = vec![RelationshipReference {
            gvdb_id: 2,
            display_name: "B".into(),
        }];
        linked_discovery.raw_row_json = r#"{"関連クエスト":"2:B"}"#.into();
        let mut reordered_linked_discovery = discovery_at(11, "B", 2);
        reordered_linked_discovery.related_quests = vec![RelationshipReference {
            gvdb_id: 2,
            display_name: "B".into(),
        }];
        reordered_linked_discovery.raw_row_json = r#"{"関連クエスト":"2:B"}"#.into();
        apply_import(
            &mut database,
            discovery_request(
                "discovery-source-first",
                vec![
                    discovery_at(10, "A", 0),
                    linked_discovery,
                    discovery_at(12, "C", 2),
                    discovery_at(13, "D", 3),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        apply_import(
            &mut database,
            discovery_request(
                "discovery-source-second",
                vec![
                    discovery_at(10, "A", 0),
                    discovery_at(14, "NEW-X", 1),
                    reordered_linked_discovery,
                    discovery_at(12, "C", 3),
                    discovery_at(15, "NEW-Y", 4),
                    discovery_at(13, "D", 5),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quest_discoveries qd \
                 JOIN quests q ON q.id = qd.quest_id \
                 JOIN discoveries d ON d.id = qd.discovery_id \
                 WHERE q.gvdb_id = 2 AND d.gvdb_id = 11",
            )
            .fetch_one(&mut database)
            .await
            .unwrap(),
            1
        );
        let discovery_ordered: Vec<i64> = sqlx::query_scalar(
            "SELECT gvdb_id FROM discoveries ORDER BY source_order IS NULL, source_order, id",
        )
        .fetch_all(&mut database)
        .await
        .unwrap();
        assert_eq!(discovery_ordered, vec![10, 14, 11, 12, 15, 13]);
    }

    #[tokio::test]
    async fn inactive_master_retains_its_last_known_source_order() {
        let mut database = test_database().await;
        apply_import(
            &mut database,
            discovery_request(
                "inactive-source-first",
                vec![discovery_at(10, "A", 0), discovery_at(11, "B", 1)],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        let b_id: i64 = sqlx::query_scalar("SELECT id FROM discoveries WHERE gvdb_id = 11")
            .fetch_one(&mut database)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles (id, name) VALUES (1, 'User')")
            .execute(&mut database)
            .await
            .unwrap();
        sqlx::query("INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo) VALUES (1, ?, 1, 0, 'keep')")
            .bind(b_id)
            .execute(&mut database)
            .await
            .unwrap();
        apply_import(
            &mut database,
            discovery_request("inactive-source-second", vec![discovery_at(10, "A", 0)]),
            FailurePoint::None,
        )
        .await
        .unwrap();
        let inactive: (i64, i64, i64) = sqlx::query_as(
            "SELECT id, is_active, source_order FROM discoveries WHERE gvdb_id = 11",
        )
        .fetch_one(&mut database)
        .await
        .unwrap();
        assert_eq!(inactive, (b_id, 0, 1));
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT memo FROM discovery_progress WHERE profile_id = 1 AND discovery_id = ?"
            )
            .bind(b_id)
            .fetch_one(&mut database)
            .await
            .unwrap(),
            "keep"
        );
    }

    #[tokio::test]
    async fn imports_and_replaces_quest_facets_without_counting_them_as_relations() {
        let mut database = test_database().await;
        let first = apply_import(
            &mut database,
            quest_request(
                "facets-1",
                vec![quest_with_facets(
                    100,
                    "テスト依頼A",
                    "探索(7),財宝鑑定(9),ドイツ語,日本語(5),サルベージ",
                    "アテネ,アレクサンドリア",
                )],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        assert_eq!(first.relation_count, 0);
        let skills: Vec<(i64, String, Option<i64>, i64)> = sqlx::query_as(
            "SELECT position, skill_name, required_rank, is_language \
             FROM quest_required_skills ORDER BY position",
        )
        .fetch_all(&mut database)
        .await
        .unwrap();
        assert_eq!(
            skills,
            vec![
                (0, "探索".into(), Some(7), 0),
                (1, "財宝鑑定".into(), Some(9), 0),
                (2, "ドイツ語".into(), None, 1),
                (3, "日本語".into(), None, 1),
                (4, "サルベージ".into(), None, 0),
            ]
        );

        apply_import(
            &mut database,
            quest_request(
                "facets-2",
                vec![quest_with_facets(100, "更新", "探索(100)", "チュニス")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        let skills: Vec<(String, Option<i64>)> =
            sqlx::query_as("SELECT skill_name, required_rank FROM quest_required_skills")
                .fetch_all(&mut database)
                .await
                .unwrap();
        let cities: Vec<String> =
            sqlx::query_scalar("SELECT city_name FROM quest_offer_cities ORDER BY position")
                .fetch_all(&mut database)
                .await
                .unwrap();
        assert_eq!(skills, vec![("探索".into(), Some(100))]);
        assert_eq!(cities, vec!["チュニス"]);

        apply_import(
            &mut database,
            quest_request("facets-blank", vec![quest_with_facets(100, "空欄", "", "")]),
            FailurePoint::None,
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_required_skills")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_offer_cities")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn builds_discovery_relations_from_discoveries_and_unions_dependencies() {
        let mut database = test_database().await;
        apply_import(
            &mut database,
            quest_request(
                "q-rel",
                vec![
                    quest(1, "Quest 1", "Discovery 10", "", "2:Quest 2"),
                    quest(2, "Quest 2", "Missing discovery", "1:Quest 1", ""),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .expect("quest import must succeed with warnings");
        let result = apply_import(
            &mut database,
            discovery_request(
                "d-rel",
                vec![
                    discovery(10, "Discovery 10", "史跡", "1:Quest 1,1:duplicate"),
                    discovery(11, "Discovery 11", "史跡", "999:Missing quest"),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .expect("discovery import must complete relationships");

        let quest_discoveries: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM quest_discoveries")
            .fetch_one(&mut database)
            .await
            .unwrap();
        let dependencies: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM quest_dependencies")
            .fetch_one(&mut database)
            .await
            .unwrap();
        assert_eq!(quest_discoveries, 1);
        assert_eq!(dependencies, 1);
        assert_eq!(result.relation_count, 2);
        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.code == "MissingQuest"));
        assert!(result.warnings.iter().any(|warning| {
            warning.code == "MissingQuest"
                && warning.message
                    == "大航海時代データベースの関連先IDが存在しないためスキップしました: 999"
        }));
    }

    #[tokio::test]
    async fn dependent_name_is_compared_with_the_dependent_quest() {
        let mut database = test_database().await;
        let result = apply_import(
            &mut database,
            quest_request(
                "dependent-name-match",
                vec![
                    quest(3261, "獅子の子", "", "", "3266:恋とはどんなものかしら"),
                    quest(3266, "恋とはどんなものかしら", "", "", ""),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();

        assert_eq!(dependency_gvdb_ids(&mut database).await, vec![(3266, 3261)]);
        assert_eq!(warning_count(&result, "QuestNameMismatch"), 0);
    }

    #[tokio::test]
    async fn dependent_name_mismatch_warns_without_changing_the_id_relation() {
        let mut database = test_database().await;
        let result = apply_import(
            &mut database,
            quest_request(
                "dependent-name-mismatch",
                vec![
                    quest(3261, "獅子の子", "", "", "3266:別の名称"),
                    quest(3266, "恋とはどんなものかしら", "", "", ""),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();

        assert_eq!(dependency_gvdb_ids(&mut database).await, vec![(3266, 3261)]);
        assert_eq!(warning_count(&result, "QuestNameMismatch"), 1);
    }

    #[tokio::test]
    async fn prerequisite_name_is_compared_with_the_prerequisite_quest() {
        let mut database = test_database().await;
        let result = apply_import(
            &mut database,
            quest_request(
                "prerequisite-name-match",
                vec![
                    quest(3261, "獅子の子", "", "", ""),
                    quest(3266, "恋とはどんなものかしら", "", "3261:獅子の子", ""),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();

        assert_eq!(dependency_gvdb_ids(&mut database).await, vec![(3266, 3261)]);
        assert_eq!(warning_count(&result, "QuestNameMismatch"), 0);
    }

    #[tokio::test]
    async fn prerequisite_name_mismatch_warns_without_changing_the_id_relation() {
        let mut database = test_database().await;
        let result = apply_import(
            &mut database,
            quest_request(
                "prerequisite-name-mismatch",
                vec![
                    quest(3261, "獅子の子", "", "", ""),
                    quest(3266, "恋とはどんなものかしら", "", "3261:別の名称", ""),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();

        assert_eq!(dependency_gvdb_ids(&mut database).await, vec![(3266, 3261)]);
        assert_eq!(warning_count(&result, "QuestNameMismatch"), 1);
    }

    #[tokio::test]
    async fn discovery_related_quest_name_is_compared_with_the_referenced_quest() {
        let mut database = test_database().await;
        apply_import(
            &mut database,
            quest_request(
                "discovery-name-quests",
                vec![quest(3266, "恋とはどんなものかしら", "", "", "")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        let result = apply_import(
            &mut database,
            discovery_request(
                "discovery-name-relations",
                vec![
                    discovery(10, "Discovery 10", "史跡", "3266:恋とはどんなものかしら"),
                    discovery(11, "Discovery 11", "史跡", "3266:別の名称"),
                ],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();

        assert_eq!(discovery_relation_gvdb_ids(&mut database).await.len(), 2);
        assert_eq!(warning_count(&result, "QuestNameMismatch"), 1);
    }

    #[tokio::test]
    async fn does_not_create_discovery_relation_from_quest_display_name() {
        let mut database = test_database().await;
        apply_import(
            &mut database,
            discovery_request(
                "display-discovery",
                vec![discovery(10, "テスト発見物A", "財宝", "")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        apply_import(
            &mut database,
            quest_request(
                "display-quest",
                vec![quest(100, "テスト依頼A", "テスト発見物A", "", "")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();

        let relation_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM quest_discoveries")
            .fetch_one(&mut database)
            .await
            .unwrap();
        assert_eq!(relation_count, 0);
    }

    #[tokio::test]
    async fn import_order_produces_the_same_discovery_relations() {
        let mut quests_first = test_database().await;
        apply_import(
            &mut quests_first,
            quest_request(
                "order-a-quest",
                vec![quest(100, "テスト依頼A", "テスト発見物A", "", "")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        apply_import(
            &mut quests_first,
            discovery_request(
                "order-a-discovery",
                vec![discovery(10, "テスト発見物A", "財宝", "100:テスト依頼A")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();

        let mut discoveries_first = test_database().await;
        let unresolved = apply_import(
            &mut discoveries_first,
            discovery_request(
                "order-b-discovery",
                vec![discovery(10, "テスト発見物A", "財宝", "100:テスト依頼A")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        assert!(unresolved
            .warnings
            .iter()
            .any(|warning| warning.code == "MissingQuest"));
        assert_eq!(unresolved.relation_count, 0);
        let resolved = apply_import(
            &mut discoveries_first,
            quest_request(
                "order-b-quest",
                vec![quest(100, "テスト依頼A", "テスト発見物A", "", "")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        assert_eq!(resolved.relation_count, 1);

        assert_eq!(
            discovery_relation_gvdb_ids(&mut quests_first).await,
            discovery_relation_gvdb_ids(&mut discoveries_first).await
        );
        assert_eq!(
            discovery_relation_gvdb_ids(&mut quests_first).await,
            vec![(100, 10)]
        );
    }

    async fn discovery_relation_gvdb_ids(database: &mut SqliteConnection) -> Vec<(i64, i64)> {
        sqlx::query_as(
            "SELECT q.gvdb_id, d.gvdb_id \
             FROM quest_discoveries qd \
             JOIN quests q ON q.id = qd.quest_id \
             JOIN discoveries d ON d.id = qd.discovery_id \
             ORDER BY q.gvdb_id, d.gvdb_id",
        )
        .fetch_all(database)
        .await
        .unwrap()
    }

    async fn dependency_gvdb_ids(database: &mut SqliteConnection) -> Vec<(i64, i64)> {
        sqlx::query_as(
            "SELECT q.gvdb_id, p.gvdb_id \
             FROM quest_dependencies qd \
             JOIN quests q ON q.id = qd.quest_id \
             JOIN quests p ON p.id = qd.prerequisite_quest_id \
             ORDER BY q.gvdb_id, p.gvdb_id",
        )
        .fetch_all(database)
        .await
        .unwrap()
    }

    fn read_local_tsv(path: &std::path::Path) -> Vec<BTreeMap<String, String>> {
        let bytes = std::fs::read(path).expect("GVDB fixture must be readable");
        let (decoded, _, had_errors) = encoding_rs::SHIFT_JIS.decode(&bytes);
        assert!(!had_errors, "GVDB fixture must be valid CP932/Windows-31J");
        let normalized = decoded.replace("\r\n", "\n").replace('\r', "\n");
        let mut lines = normalized.lines();
        let headers: Vec<String> = lines
            .next()
            .unwrap()
            .split('\t')
            .map(str::to_owned)
            .collect();
        lines
            .enumerate()
            .map(|(index, line)| {
                let fields: Vec<&str> = line.split('\t').collect();
                assert_eq!(fields.len(), headers.len(), "row {}", index + 2);
                headers
                    .iter()
                    .cloned()
                    .zip(fields.into_iter().map(str::to_owned))
                    .collect()
            })
            .collect()
    }

    fn optional_text(value: &str) -> Option<String> {
        let value = value.trim();
        (!value.is_empty()).then(|| value.to_owned())
    }

    fn optional_integer(value: &str) -> Option<i64> {
        let value = value.trim();
        (!value.is_empty()).then(|| value.parse().expect("numeric GVDB field must parse"))
    }

    fn local_quest_rows(path: &std::path::Path) -> Vec<NormalizedQuestRow> {
        read_local_tsv(path)
            .into_iter()
            .enumerate()
            .map(|(source_order, raw)| NormalizedQuestRow {
                gvdb_id: raw["ID"].parse().unwrap(),
                source_order: source_order as i64,
                title: raw["クエスト名・地図名"].trim().to_owned(),
                difficulty: optional_integer(&raw["難易度"]),
                chrono_quest: optional_text(&raw["クロノクエスト"]),
                offer_method: optional_text(&raw["オファー方法"]),
                offer_city: optional_text(&raw["オファー都市"]),
                required_skills: optional_text(&raw["必要スキル"]),
                discovery_type_text: optional_text(&raw["発見物種類"]),
                discovery_name: optional_text(&raw["発見物"]),
                reward_items: optional_text(&raw["入手アイテム"]),
                notes: optional_text(&raw["備考"]),
                source_updated_at: optional_text(&raw["最終更新日時"]),
                chain_name: optional_text(&raw["連続クエスト名"]),
                chain_order: optional_integer(&raw["順序"]),
                prerequisites: Vec::new(),
                dependents: Vec::new(),
                raw_row_json: serde_json::to_string(&raw).unwrap(),
            })
            .collect()
    }

    fn local_discovery_rows(path: &std::path::Path) -> Vec<NormalizedDiscoveryRow> {
        read_local_tsv(path)
            .into_iter()
            .enumerate()
            .map(|(source_order, raw)| NormalizedDiscoveryRow {
                gvdb_id: raw["ID"].parse().unwrap(),
                source_order: source_order as i64,
                category_name: optional_text(&raw["種別"]),
                name: raw["発見物名"].trim().to_owned(),
                rank: optional_integer(&raw["ランク"]),
                description: optional_text(&raw["説明"]),
                era: optional_text(&raw["時代"]),
                points: optional_integer(&raw["ポイント"]),
                difficulty: optional_integer(&raw["難易度"]),
                experience: optional_integer(&raw["経験値"]),
                notes: optional_text(&raw["備考"]),
                source_updated_at: optional_text(&raw["最終更新日時"]),
                related_quests: Vec::new(),
                raw_row_json: serde_json::to_string(&raw).unwrap(),
            })
            .collect()
    }

    async fn assert_acceptance_contract(
        quest_rows: Vec<NormalizedQuestRow>,
        discovery_rows: Vec<NormalizedDiscoveryRow>,
    ) {
        let quest_order: BTreeMap<i64, i64> = quest_rows
            .iter()
            .map(|row| (row.gvdb_id, row.source_order))
            .collect();
        let discovery_order: BTreeMap<i64, i64> = discovery_rows
            .iter()
            .map(|row| (row.gvdb_id, row.source_order))
            .collect();
        // Acceptance never opens a caller-supplied database or application data root.
        let mut database = test_database().await;
        let quests = apply_import(
            &mut database,
            quest_request("acceptance-quests", quest_rows),
            FailurePoint::None,
        )
        .await
        .expect("quest import must satisfy the importer contract");
        let discoveries = apply_import(
            &mut database,
            discovery_request("acceptance-discoveries", discovery_rows),
            FailurePoint::None,
        )
        .await
        .expect("discovery import must satisfy the importer contract");

        let stored_quests: Vec<(i64, i64)> =
            sqlx::query_as("SELECT gvdb_id, source_order FROM quests ORDER BY gvdb_id")
                .fetch_all(&mut database)
                .await
                .unwrap();
        let stored_discoveries: Vec<(i64, i64)> =
            sqlx::query_as("SELECT gvdb_id, source_order FROM discoveries ORDER BY gvdb_id")
                .fetch_all(&mut database)
                .await
                .unwrap();
        assert_eq!(stored_quests.len(), quests.imported_row_count);
        assert_eq!(stored_discoveries.len(), discoveries.imported_row_count);
        assert_eq!(
            stored_quests.into_iter().collect::<BTreeMap<_, _>>(),
            quest_order
        );
        assert_eq!(
            stored_discoveries.into_iter().collect::<BTreeMap<_, _>>(),
            discovery_order
        );

        for sql in [
            "SELECT COUNT(*) FROM pragma_foreign_key_check",
            "SELECT COUNT(*) FROM quest_dependencies WHERE quest_id = prerequisite_quest_id",
            "SELECT COUNT(*) FROM (SELECT quest_id, prerequisite_quest_id FROM quest_dependencies GROUP BY quest_id, prerequisite_quest_id HAVING COUNT(*) > 1)",
            "SELECT COUNT(*) FROM (SELECT quest_id, discovery_id FROM quest_discoveries GROUP BY quest_id, discovery_id HAVING COUNT(*) > 1)",
            "SELECT COUNT(*) FROM quest_required_skills WHERE is_language = 1 AND required_rank IS NOT NULL",
            "SELECT COUNT(*) FROM quest_required_skills WHERE required_rank IS NOT NULL AND required_rank <= 0",
        ] {
            let violations: i64 = sqlx::query_scalar(sql)
                .fetch_one(&mut database)
                .await
                .unwrap();
            assert_eq!(violations, 0, "contract violation: {sql}");
        }
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&mut database)
            .await
            .unwrap();
        assert_eq!(foreign_keys, 1);
        let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&mut database)
            .await
            .unwrap();
        assert_eq!(integrity, "ok");
    }

    #[tokio::test]
    async fn synthetic_acceptance_satisfies_import_contract() {
        let mut first = quest_with_facets(100, "テスト依頼A", "探索(3),日本語(5)", "テスト都市A");
        first.source_order = 0;
        let second = quest_at(101, "テスト依頼B", 1);
        let mut linked = discovery(10, "テスト発見物A", "史跡", "100:テスト依頼A,100:重複");
        linked.source_order = 0;
        let unlinked = discovery_at(20, "テスト発見物B", 1);
        assert_acceptance_contract(vec![first, second], vec![linked, unlinked]).await;
    }

    #[tokio::test]
    #[ignore = "optional local GVDB files; ordinary tests use synthetic data"]
    async fn local_gvdb_acceptance_satisfies_import_contract() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        let quest_path = root.join("local-data/gvdb/quests.csv");
        let discovery_path = root.join("local-data/gvdb/discovery_items.csv");
        for path in [&quest_path, &discovery_path] {
            assert!(
                path.is_file(),
                "Optional local acceptance requires {}. Obtain the GVDB files manually and place them under ignored local-data/gvdb/; ordinary cargo test does not require them.",
                path.display()
            );
        }
        assert_acceptance_contract(
            local_quest_rows(&quest_path),
            local_discovery_rows(&discovery_path),
        )
        .await;
    }

    fn warning_count(result: &ImportResult, code: &str) -> usize {
        result
            .warnings
            .iter()
            .filter(|warning| warning.code == code)
            .count()
    }

    #[tokio::test]
    async fn preserves_all_user_data_during_master_imports() {
        let mut database = test_database().await;
        sqlx::query("INSERT INTO profiles (id, name) VALUES (1, 'User')")
            .execute(&mut database)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO quests (id, gvdb_id, title, raw_row_json) VALUES (1, 50, 'Old', '{}')",
        )
        .execute(&mut database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO discoveries (id, gvdb_id, name, raw_row_json) VALUES (1, 60, 'Old', '{}')",
        )
        .execute(&mut database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, 1, 'quest memo')",
        )
        .execute(&mut database)
        .await
        .unwrap();
        sqlx::query("INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo) VALUES (1, 1, 1, 0, 'discovery memo')")
            .execute(&mut database)
            .await
            .unwrap();

        apply_import(
            &mut database,
            quest_request("safety", vec![quest(50, "Updated", "", "", "")]),
            FailurePoint::None,
        )
        .await
        .expect("import must succeed");
        apply_import(
            &mut database,
            discovery_request(
                "discovery-safety",
                vec![discovery(60, "Updated discovery", "史跡", "")],
            ),
            FailurePoint::None,
        )
        .await
        .expect("discovery import must succeed");

        let profile: (String,) = sqlx::query_as("SELECT name FROM profiles WHERE id = 1")
            .fetch_one(&mut database)
            .await
            .unwrap();
        let quest_progress: (String,) =
            sqlx::query_as("SELECT memo FROM quest_progress WHERE profile_id = 1 AND quest_id = 1")
                .fetch_one(&mut database)
                .await
                .unwrap();
        let discovery_progress: (i64, i64, String) = sqlx::query_as("SELECT reported, card_owned, memo FROM discovery_progress WHERE profile_id = 1 AND discovery_id = 1")
            .fetch_one(&mut database)
            .await
            .unwrap();
        assert_eq!(profile.0, "User");
        assert_eq!(quest_progress.0, "quest memo");
        assert_eq!(discovery_progress, (1, 0, "discovery memo".into()));
    }

    #[tokio::test]
    async fn rolls_back_master_relations_and_history_after_injected_failure() {
        let mut database = test_database().await;
        apply_import(
            &mut database,
            quest_request(
                "baseline-quest",
                vec![quest_with_facets(1, "Before", "探索(3)", "リスボン")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        apply_import(
            &mut database,
            discovery_request(
                "baseline-discovery",
                vec![discovery(10, "Discovery", "史跡", "1:Before")],
            ),
            FailurePoint::None,
        )
        .await
        .unwrap();
        let before: (String, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT title, is_active, (SELECT COUNT(*) FROM quest_discoveries), (SELECT COUNT(*) FROM master_import_history), (SELECT COUNT(*) FROM quest_required_skills), (SELECT COUNT(*) FROM quest_offer_cities) FROM quests WHERE gvdb_id = 1",
        )
        .fetch_one(&mut database)
        .await
        .unwrap();

        let error = apply_import(
            &mut database,
            quest_request(
                "failed",
                vec![quest_with_facets(1, "After", "日本語(5)", "堺")],
            ),
            FailurePoint::AfterRelationshipRebuild,
        )
        .await
        .expect_err("injected failure must roll back");
        assert_eq!(error.kind, "DatabaseImportError");

        let after: (String, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT title, is_active, (SELECT COUNT(*) FROM quest_discoveries), (SELECT COUNT(*) FROM master_import_history), (SELECT COUNT(*) FROM quest_required_skills), (SELECT COUNT(*) FROM quest_offer_cities) FROM quests WHERE gvdb_id = 1",
        )
        .fetch_one(&mut database)
        .await
        .unwrap();
        assert_eq!(after, before);
        let failed_history: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM master_import_history WHERE file_sha256 = 'failed'",
        )
        .fetch_one(&mut database)
        .await
        .unwrap();
        assert_eq!(failed_history, 0);
    }
}
