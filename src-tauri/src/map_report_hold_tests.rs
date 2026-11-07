use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};

use crate::migrations::{self, MigrationList};

fn automatic() -> String {
    include_str!("../../src/discoveries/automaticReportingDiscoveries.sql").replace(
        "__SPECIAL_REPORTING_QUESTS__",
        include_str!("../../src/discoveries/specialReportingQuests.sql"),
    )
}

fn old_ids() -> String {
    format!("SELECT dp.discovery_id FROM discovery_progress dp JOIN discoveries d ON d.id=dp.discovery_id LEFT JOIN discovery_categories c ON c.id=d.category_id WHERE dp.profile_id=$1 AND c.name IS NOT 'レリック' AND (dp.reported=1 OR dp.discovery_id IN ({}))", automatic())
}

fn new_ids() -> String {
    let eligible = include_str!("../../src/discoveries/meritEligibleDiscoveries.sql")
        .replace("__AUTOMATIC_REPORTING_DISCOVERIES__", &automatic());
    format!("SELECT e.discovery_id FROM ({eligible}) e JOIN discoveries d ON d.id=e.discovery_id LEFT JOIN discovery_categories c ON c.id=d.category_id WHERE c.name IS NOT 'レリック'")
}

async fn ids(pool: &SqlitePool, sql: &str, profile: i64) -> Vec<i64> {
    sqlx::query_scalar(&format!("{sql} ORDER BY 1"))
        .bind(profile)
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn merit(pool: &SqlitePool, sql: &str, profile: i64) -> (i64, i64, i64, i64) {
    sqlx::query_as(&format!("SELECT COALESCE(SUM(experience),0), COUNT(*), COUNT(experience), COUNT(*)-COUNT(experience) FROM discoveries WHERE id IN ({sql})"))
        .bind(profile).fetch_one(pool).await.unwrap()
}

async fn reports(pool: &SqlitePool, profile: i64) -> (i64, i64) {
    sqlx::query_as(&format!("SELECT COALESCE(SUM(CASE WHEN dp.reported=1 OR dp.discovery_id IN ({0}) THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN dp.reported=0 AND dp.discovery_id NOT IN ({0}) THEN 1 ELSE 0 END),0) FROM discovery_progress dp JOIN discoveries d ON d.id=dp.discovery_id LEFT JOIN discovery_categories c ON c.id=d.category_id WHERE dp.profile_id=$1 AND d.is_active=1 AND c.name IS NOT 'レリック'", automatic()))
        .bind(profile).fetch_one(pool).await.unwrap()
}

async fn legacy() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(&pool)
        .await
        .unwrap();
    let mut definitions = migrations::all().0;
    definitions.truncate(3);
    sqlx::migrate::Migrator::new(MigrationList(definitions))
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    sqlx::raw_sql("INSERT INTO profiles (id,name,memo,created_at,updated_at) VALUES (1,'A','memo','created','updated'),(2,'B',NULL,'c','u');
        INSERT INTO discovery_categories(id,name) VALUES (1,'史跡'),(2,'レリック');
        INSERT INTO quests(id,gvdb_id,title,offer_method,is_active,raw_row_json) VALUES
        (1,101,'pursuit','追究クエスト',1,'{}'),(2,102,'legacy','レガシー',1,'{}'),
        (3,103,'treasure','トレジャーハント',1,'{}'),(4,104,'normal',NULL,1,'{}'),
        (5,105,'inactive','レガシー',0,'{}'),(6,106,'typo','追及クエスト',1,'{}');")
        .execute(&pool).await.unwrap();
    for id in 1..=12_i64 {
        sqlx::query("INSERT INTO discoveries(id,gvdb_id,name,category_id,experience,is_active,raw_row_json) VALUES (?,?,?, ?,?,?, '{}')")
            .bind(id).bind(200+id).bind(format!("D{id}"))
            .bind(if id==10 {None} else {Some(if id==4 {2} else {1})})
            .bind(if id==2 {None} else {Some(id*10)})
            .bind(if id==7 {0} else {1}).execute(&pool).await.unwrap();
    }
    sqlx::raw_sql("INSERT INTO quest_discoveries VALUES (1,1),(5,1),(2,2),(3,3),(3,4),(1,5),(4,5),(1,6),(2,6),(2,7),(6,8),(2,9),(5,11);
        INSERT INTO quest_progress(profile_id,quest_id,memo,updated_at) VALUES (1,1,'quest memo','original'),(2,4,NULL,'other');
        INSERT INTO discovery_progress(profile_id,discovery_id,reported,card_owned,memo,updated_at) VALUES
        (1,1,0,0,'keep','original'),(1,2,0,1,NULL,'original'),(1,3,1,0,'x','original'),
        (1,4,1,1,'relic','original'),(1,5,0,1,NULL,'original'),(1,6,1,1,NULL,'original'),
        (1,7,0,0,NULL,'original'),(1,8,0,0,NULL,'original'),(1,10,1,1,'null category','original'),
        (1,11,0,1,NULL,'original'),(2,5,1,0,'B','other'),(2,2,0,1,NULL,'other');
        INSERT INTO master_import_history(dataset,file_name,file_sha256,row_count) VALUES ('quests','synthetic','abc',6);")
        .execute(&pool).await.unwrap();
    pool
}

async fn snapshot(pool: &SqlitePool) -> Vec<(String, Vec<String>)> {
    let tables: Vec<String> = sqlx::query_scalar("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_sqlx_migrations','discovery_reporting_history') ORDER BY name")
        .fetch_all(pool).await.unwrap();
    let mut result = Vec::new();
    for table in tables {
        let columns = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|r| r.get::<String, _>("name"))
            .filter(|name| name != "report_hold")
            .map(|name| format!("\"{name}\""))
            .collect::<Vec<_>>()
            .join(",");
        let rows = sqlx::query_scalar(&format!(
            "SELECT json_array({columns}) FROM {table} ORDER BY 1"
        ))
        .fetch_all(pool)
        .await
        .unwrap();
        result.push((table, rows));
    }
    result
}

#[tokio::test]
async fn migration_preserves_every_old_column_and_all_profile_aggregates() {
    let pool = legacy().await;
    let before = snapshot(&pool).await;
    let mut expected = Vec::new();
    for profile in [1, 2, 3] {
        expected.push((
            ids(&pool, &old_ids(), profile).await,
            merit(&pool, &old_ids(), profile).await,
            reports(&pool, profile).await,
        ));
    }
    migrations::run(&pool).await.unwrap();
    migrations::run(&pool).await.unwrap();
    assert_eq!(snapshot(&pool).await, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM discovery_progress WHERE report_hold<>0"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM discovery_reporting_history WHERE first_report_status<>'unknown' OR legacy_merit_credit<>1").fetch_one(&pool).await.unwrap(),0);
    for (index, profile) in [1, 2, 3].into_iter().enumerate() {
        assert_eq!(ids(&pool, &new_ids(), profile).await, expected[index].0);
        assert_eq!(merit(&pool, &new_ids(), profile).await, expected[index].1);
        assert_eq!(reports(&pool, profile).await, expected[index].2);
    }
    assert_eq!(expected[0].0, vec![1, 2, 3, 6, 7, 10]);
    assert_eq!(expected[0].1, (270, 6, 5, 1));
    // 再発見・現在進捗削除は合成DBのSQL操作。新commandはC2で実装する。
    sqlx::raw_sql("UPDATE discovery_progress SET reported=0,report_hold=1 WHERE profile_id=1 AND discovery_id=6; DELETE FROM discovery_progress WHERE profile_id=1 AND discovery_id=10;
        UPDATE discovery_reporting_history SET first_report_status='confirmed',legacy_merit_credit=0 WHERE profile_id=1 AND discovery_id=3;")
        .execute(&pool).await.unwrap();
    assert_eq!(merit(&pool, &new_ids(), 1).await, expected[0].1);
    sqlx::raw_sql("DELETE FROM discovery_progress WHERE profile_id=1 AND discovery_id=3;
        INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status) VALUES (1,12,'confirmed');")
        .execute(&pool).await.unwrap();
    assert_eq!(merit(&pool, &new_ids(), 1).await, (390, 7, 6, 1));
    sqlx::query("UPDATE discovery_reporting_history SET first_report_status='not_reported',legacy_merit_credit=0 WHERE profile_id=1 AND discovery_id=6")
        .execute(&pool).await.unwrap();
    assert_eq!(merit(&pool, &new_ids(), 1).await, (330, 6, 5, 1));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn migration_failure_rolls_back_schema_credit_and_history() {
    let pool = legacy().await;
    let before = snapshot(&pool).await;
    let mut definitions = migrations::all().0;
    definitions.last_mut().unwrap().sql = Box::leak(
        format!(
            "{}\nSELECT * FROM deliberately_missing_table;",
            migrations::MAP_REPORT_HOLD_SCHEMA
        )
        .into_boxed_str(),
    );
    let migrator = sqlx::migrate::Migrator::new(MigrationList(definitions))
        .await
        .unwrap();
    assert!(migrator.run(&pool).await.is_err());
    assert_eq!(snapshot(&pool).await, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM pragma_table_info('discovery_progress') WHERE name='report_hold'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name='discovery_reporting_history'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT MAX(version) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap(),
        3
    );
    migrations::run(&pool).await.unwrap();
}

#[tokio::test]
async fn constraints_and_history_lifetime_are_enforced_by_bundled_sqlite() {
    let pool = legacy().await;
    migrations::run(&pool).await.unwrap();
    for sql in [
        "UPDATE discovery_progress SET report_hold=2 WHERE profile_id=1 AND discovery_id=1",
        "UPDATE discovery_progress SET report_hold=NULL WHERE profile_id=1 AND discovery_id=1",
        "UPDATE discovery_progress SET report_hold=1 WHERE profile_id=1 AND discovery_id=3",
        "UPDATE discovery_reporting_history SET first_report_status='bad'",
        "UPDATE discovery_reporting_history SET first_report_status='confirmed'",
        "UPDATE discovery_reporting_history SET legacy_merit_credit=2",
        "INSERT INTO discovery_reporting_history(profile_id,discovery_id) VALUES (999,1)",
        "INSERT INTO discovery_reporting_history(profile_id,discovery_id) VALUES (1,999)",
        "INSERT INTO discovery_reporting_history(profile_id,discovery_id) VALUES (1,1)",
    ] {
        assert!(sqlx::query(sql).execute(&pool).await.is_err(), "{sql}");
    }
    sqlx::query(
        "UPDATE discovery_progress SET report_hold=1 WHERE profile_id=1 AND discovery_id=1",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(sqlx::query(
        "UPDATE discovery_progress SET reported=1 WHERE profile_id=1 AND discovery_id=1"
    )
    .execute(&pool)
    .await
    .is_err());
    sqlx::query("UPDATE discovery_progress SET reported=1,report_hold=0 WHERE profile_id=1 AND discovery_id=1").execute(&pool).await.unwrap();
    sqlx::query("DELETE FROM discovery_progress WHERE profile_id=1 AND discovery_id=10")
        .execute(&pool)
        .await
        .unwrap();
    assert!(sqlx::query("DELETE FROM discoveries WHERE id=10")
        .execute(&pool)
        .await
        .is_err());
    sqlx::query("UPDATE discoveries SET is_active=0 WHERE id=10")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(ids(&pool, &new_ids(), 1).await, vec![1, 2, 3, 6, 7, 10]);
    sqlx::query("DELETE FROM profiles WHERE id=1")
        .execute(&pool)
        .await
        .unwrap();
    assert!(ids(&pool, &new_ids(), 1).await.is_empty());
    assert_eq!(ids(&pool, &new_ids(), 2).await, vec![2, 5]);
}
