use std::{
    fs,
    future::Future,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use tokio::sync::{RwLock, RwLockReadGuard};

pub(crate) const DATABASE_FILE_NAME: &str = "dol-progress.db";

/// Owns the sole application database path and pool.
///
/// A read guard is held through normal operations. Maintenance acquires the
/// write guard, so no normal operation can retain a pool connection while the
/// database file is replaced and the pool is reopened.
pub(crate) struct ActiveDatabase {
    database_path: PathBuf,
    pool: RwLock<SqlitePool>,
    retired_after_root_transition: AtomicBool,
}

impl ActiveDatabase {
    #[cfg(test)]
    pub(crate) async fn open(database_path: PathBuf) -> Result<Self, String> {
        let pool = open_pool(&database_path).await?;
        Ok(Self {
            database_path,
            pool: RwLock::new(pool),
            retired_after_root_transition: AtomicBool::new(false),
        })
    }

    pub(crate) async fn open_existing(database_path: PathBuf) -> Result<Self, String> {
        let pool = open_existing_pool(&database_path).await?;
        Ok(Self {
            database_path,
            pool: RwLock::new(pool),
            retired_after_root_transition: AtomicBool::new(false),
        })
    }

    pub(crate) fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub(crate) async fn pool(&self) -> RwLockReadGuard<'_, SqlitePool> {
        self.pool.read().await
    }

    pub(crate) async fn with_maintenance<T, F, Fut>(&self, operation: F) -> Result<T, String>
    where
        F: FnOnce(&Path) -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let mut pool = self.pool.write().await;
        if self.retired_after_root_transition.load(Ordering::Acquire) {
            return Err("保存場所変更後の以前のデータベースは再起動まで操作できません。".into());
        }
        pool.close().await;

        let operation_result = operation(&self.database_path).await;
        let reopen_result = open_pool(&self.database_path).await;

        match reopen_result {
            Ok(reopened) => {
                *pool = reopened;
                operation_result
            }
            Err(error) => Err(format!(
                "Database maintenance completed or failed, then pool reopen failed: {error}"
            )),
        }
    }

    /// Runs a durable root transition. On success the old pool stays closed so
    /// no command can write the old source while restart is pending.
    pub(crate) async fn with_root_transition<T>(
        &self,
        operation: impl for<'a> FnOnce(
            &'a Path,
            &'a SqlitePool,
        )
            -> futures_core::future::BoxFuture<'a, Result<T, String>>,
    ) -> Result<T, String> {
        let pool = self.pool.write().await;
        if self.retired_after_root_transition.load(Ordering::Acquire) {
            return Err("保存場所変更は既に完了しています。再起動してください。".into());
        }
        let operation_result = operation(&self.database_path, &pool).await;
        if operation_result.is_ok() {
            pool.close().await;
            self.retired_after_root_transition
                .store(true, Ordering::Release);
        }
        operation_result
    }
}

async fn open_pool(path: &Path) -> Result<SqlitePool, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Database path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);
    SqlitePool::connect_with(options)
        .await
        .map_err(|error| error.to_string())
}

async fn open_existing_pool(path: &Path) -> Result<SqlitePool, String> {
    if !path.is_file() {
        return Err(format!("Database file is unavailable: {}", path.display()));
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .foreign_keys(true);
    SqlitePool::connect_with(options)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn central_pool_enforces_foreign_keys_and_reopens_after_maintenance() {
        let directory = std::env::temp_dir().join(format!(
            "dol-progress-active-database-{}",
            std::process::id()
        ));
        let path = directory.join(DATABASE_FILE_NAME);
        let database = ActiveDatabase::open(path.clone()).await.unwrap();

        {
            let pool = database.pool().await;
            let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
                .fetch_one(&*pool)
                .await
                .unwrap();
            assert_eq!(foreign_keys, 1);
        }

        database
            .with_maintenance(|current| {
                let current = current.to_path_buf();
                let expected = path.clone();
                async move {
                    assert_eq!(current, expected);
                    Ok(())
                }
            })
            .await
            .unwrap();
        {
            let pool = database.pool().await;
            sqlx::query("SELECT 1").execute(&*pool).await.unwrap();
            pool.close().await;
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn successful_root_transition_retires_old_database_for_maintenance_and_second_transition()
    {
        let directory = std::env::temp_dir().join(format!(
            "dol-progress-retired-database-{}",
            std::process::id()
        ));
        let path = directory.join(DATABASE_FILE_NAME);
        let database = ActiveDatabase::open(path).await.unwrap();

        database
            .with_root_transition(|_, _| Box::pin(async { Ok(()) }))
            .await
            .unwrap();
        let maintenance = database
            .with_maintenance(|_| async { Ok(()) })
            .await
            .expect_err("maintenance must not reopen a retired source database");
        assert!(maintenance.contains("再起動"));
        let second_transition = database
            .with_root_transition(|_, _| Box::pin(async { Ok(()) }))
            .await
            .expect_err("a second transition must be rejected");
        assert!(second_transition.contains("再起動"));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
