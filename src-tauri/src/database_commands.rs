use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Column, Row, SqlitePool, TypeInfo, ValueRef};
use tauri::State;

use crate::active_database::ActiveDatabase;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseRequest {
    query: String,
    #[serde(default)]
    bind_values: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteResult {
    rows_affected: u64,
    last_insert_id: i64,
}

#[tauri::command]
pub(crate) async fn database_select(
    database: State<'_, ActiveDatabase>,
    request: DatabaseRequest,
) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let pool = database.pool().await;
    select_with_pool(&pool, request).await
}

async fn select_with_pool(
    pool: &SqlitePool,
    request: DatabaseRequest,
) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let mut query = sqlx::query(&request.query);
    for value in request.bind_values {
        query = bind_value(query, value)?;
    }
    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    rows.iter().map(row_to_json).collect()
}

#[tauri::command]
pub(crate) async fn database_execute(
    database: State<'_, ActiveDatabase>,
    request: DatabaseRequest,
) -> Result<ExecuteResult, String> {
    let pool = database.pool().await;
    execute_with_pool(&pool, request).await
}

async fn execute_with_pool(
    pool: &SqlitePool,
    request: DatabaseRequest,
) -> Result<ExecuteResult, String> {
    let mut query = sqlx::query(&request.query);
    for value in request.bind_values {
        query = bind_value(query, value)?;
    }
    let result = query
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ExecuteResult {
        rows_affected: result.rows_affected(),
        last_insert_id: result.last_insert_rowid(),
    })
}

fn bind_value<'q>(
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: Value,
) -> Result<sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, String> {
    match value {
        Value::Null => Ok(query.bind(Option::<String>::None)),
        Value::Bool(value) => Ok(query.bind(value)),
        Value::String(value) => Ok(query.bind(value)),
        Value::Number(value) => {
            if let Some(integer) = value.as_i64() {
                Ok(query.bind(integer))
            } else if let Some(real) = value.as_f64() {
                Ok(query.bind(real))
            } else {
                Err("Database parameter number is out of range".into())
            }
        }
        Value::Array(_) | Value::Object(_) => {
            Err("Database parameters must be scalar JSON values".into())
        }
    }
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Result<BTreeMap<String, Value>, String> {
    let mut result = BTreeMap::new();
    for (index, column) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(index).map_err(|error| error.to_string())?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            match raw.type_info().name() {
                "INTEGER" => Value::from(
                    row.try_get::<i64, _>(index)
                        .map_err(|error| error.to_string())?,
                ),
                "REAL" => Value::from(
                    row.try_get::<f64, _>(index)
                        .map_err(|error| error.to_string())?,
                ),
                "TEXT" => Value::from(
                    row.try_get::<String, _>(index)
                        .map_err(|error| error.to_string())?,
                ),
                "BLOB" => Value::Array(
                    row.try_get::<Vec<u8>, _>(index)
                        .map_err(|error| error.to_string())?
                        .into_iter()
                        .map(Value::from)
                        .collect(),
                ),
                type_name => return Err(format!("Unsupported SQLite value type: {type_name}")),
            }
        };
        result.insert(column.name().to_owned(), value);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn adapter_preserves_scalar_rows_nulls_bound_values_and_execute_results() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        execute_with_pool(
            &pool,
            DatabaseRequest {
                query: "CREATE TABLE values_test (id INTEGER PRIMARY KEY, value_text TEXT, value_integer INTEGER, value_real REAL)".into(),
                bind_values: vec![],
            },
        )
        .await
        .unwrap();
        let inserted = execute_with_pool(
            &pool,
            DatabaseRequest {
                query: "INSERT INTO values_test (value_text, value_integer, value_real) VALUES (?, ?, ?)".into(),
                bind_values: vec![Value::Null, Value::from(4), Value::from(1.5)],
            },
        )
        .await
        .unwrap();
        assert_eq!(inserted.rows_affected, 1);
        assert_eq!(inserted.last_insert_id, 1);

        let rows = select_with_pool(
            &pool,
            DatabaseRequest {
                query:
                    "SELECT id, value_text, value_integer, value_real FROM values_test WHERE id = ?"
                        .into(),
                bind_values: vec![Value::from(1)],
            },
        )
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get("id"), Some(&Value::from(1)));
        assert_eq!(rows[0].get("value_text"), Some(&Value::Null));
        assert_eq!(rows[0].get("value_integer"), Some(&Value::from(4)));
        assert_eq!(rows[0].get("value_real"), Some(&Value::from(1.5)));
        assert!(select_with_pool(
            &pool,
            DatabaseRequest {
                query: "SELECT * FROM values_test WHERE id = ?".into(),
                bind_values: vec![Value::String("' OR 1=1 --".into())],
            },
        )
        .await
        .unwrap()
        .is_empty());
        pool.close().await;
    }
}
