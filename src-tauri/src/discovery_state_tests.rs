use super::*;
use sqlx::Executor;

async fn seed(db: &mut SqliteConnection) {
    for sql in [
        crate::migrations::INITIAL_SCHEMA,
        crate::migrations::QUEST_FACETS_SCHEMA,
        crate::migrations::MASTER_SOURCE_ORDER_SCHEMA,
        crate::migrations::MAP_REPORT_HOLD_SCHEMA,
    ] {
        db.execute(sql).await.unwrap();
    }
    db.execute("PRAGMA foreign_keys=ON").await.unwrap();
    db.execute("INSERT INTO profiles(id,name) VALUES (1,'A'),(2,'B');
        INSERT INTO discovery_categories(id,name) VALUES (1,'史跡'),(2,'レリック');
        INSERT INTO quests(id,gvdb_id,title,offer_method,is_active,raw_row_json) VALUES
        (1,101,'map','地理学',1,'{}'),(2,102,'special','レガシー',1,'{}'),
        (3,103,'other','冒険クエスト',1,'{}'),(4,104,'inactive','地理学',0,'{}'),
        (5,105,'no relation','地理学',1,'{}');
        INSERT INTO discoveries(id,gvdb_id,name,category_id,experience,is_active,raw_row_json) VALUES
        (1,201,'normal',1,100,1,'{}'),(2,202,'special',1,200,1,'{}'),
        (3,203,'relic',2,900,1,'{}'),(4,204,'multiple',1,400,1,'{}'),
        (5,205,'unrelated',NULL,NULL,1,'{}'),(6,206,'inactive',1,600,0,'{}');
        INSERT INTO quest_discoveries VALUES (1,1),(2,2),(3,3),(1,4),(3,4),(4,6);")
        .await.unwrap();
}

async fn fixture() -> SqliteConnection {
    let mut db = SqliteConnection::connect("sqlite::memory:").await.unwrap();
    seed(&mut db).await;
    db
}

async fn change(db: &mut SqliteConnection, discovery: i64, operation: Operation) -> DiscoveryState {
    let expected = read_state(db, 1, discovery).await.unwrap();
    update(
        db,
        UpdateRequest {
            expected,
            source_map_id: None,
            operation,
        },
    )
    .await
    .unwrap()
}

async fn register(
    db: &mut SqliteConnection,
    discovery: i64,
    state: CurrentState,
) -> DiscoveryState {
    change(
        db,
        discovery,
        Operation::Register {
            state,
            selected_quest_id: None,
        },
    )
    .await
}

async fn merit(db: &mut SqliteConnection, profile: i64) -> (i64, i64) {
    let automatic = discovery_capabilities::automatic_reporting_discoveries_sql();
    let eligible = include_str!("../../src/discoveries/meritEligibleDiscoveries.sql")
        .replace("__AUTOMATIC_REPORTING_DISCOVERIES__", &automatic);
    sqlx::query_as(&format!("SELECT COALESCE(SUM(d.experience),0),COUNT(*) FROM ({eligible}) e JOIN discoveries d ON d.id=e.discovery_id LEFT JOIN discovery_categories c ON c.id=d.category_id WHERE c.name IS NOT 'レリック'"))
        .bind(profile).fetch_one(db).await.unwrap()
}

#[tokio::test]
async fn first_discovery_supports_all_three_discovered_states_without_assuming_a_report() {
    for target in [
        CurrentState::Unreported,
        CurrentState::ReportHold,
        CurrentState::Reported,
    ] {
        let mut db = fixture().await;
        let state = register(&mut db, 1, target).await;
        let p = state.progress.unwrap();
        assert_eq!(p.reported, matches!(target, CurrentState::Reported));
        assert_eq!(p.report_hold, matches!(target, CurrentState::ReportHold));
        assert!(p.card_owned);
        assert_eq!(
            state.history.is_some(),
            matches!(target, CurrentState::Reported)
        );
        assert_eq!(
            merit(&mut db, 1).await,
            if matches!(target, CurrentState::Reported) {
                (100, 1)
            } else {
                (0, 0)
            }
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quest_progress WHERE profile_id=1 AND quest_id=1"
            )
            .fetch_one(&mut db)
            .await
            .unwrap(),
            1
        );
        assert!(read_state(&mut db, 2, 1).await.unwrap().progress.is_none());
    }
}

#[tokio::test]
async fn report_rediscovery_hold_and_compatibility_path_keep_merit_cards_memo_and_quest_independent(
) {
    let mut db = fixture().await;
    register(&mut db, 1, CurrentState::Unreported).await;
    db.execute("UPDATE discovery_progress SET card_owned=0,memo='keep' WHERE discovery_id=1; DELETE FROM quest_progress;").await.unwrap();
    crate::discovery_progress::set_reported(&mut db, 1, 1, true)
        .await
        .unwrap();
    assert_eq!(merit(&mut db, 1).await, (100, 1));
    change(&mut db, 1, Operation::Report).await;
    let held = change(&mut db, 1, Operation::Rediscover { hold: true }).await;
    assert_eq!(
        held.history.as_ref().unwrap().status,
        FirstReportStatus::Confirmed
    );
    assert!(!held.progress.as_ref().unwrap().reported);
    for value in [false, true, false, true] {
        let state = change(&mut db, 1, Operation::SetHold { value }).await;
        assert_eq!(state.history, held.history);
        assert_eq!(state.progress.as_ref().unwrap().report_hold, value);
    }
    crate::discovery_progress::set_reported(&mut db, 1, 1, true)
        .await
        .unwrap();
    let state = read_state(&mut db, 1, 1).await.unwrap();
    assert!(!state.progress.as_ref().unwrap().report_hold);
    assert!(!state.progress.as_ref().unwrap().card_owned);
    assert_eq!(
        state.progress.as_ref().unwrap().memo.as_deref(),
        Some("keep")
    );
    assert_eq!(merit(&mut db, 1).await, (100, 1));
    crate::discovery_progress::set_reported(&mut db, 1, 1, false)
        .await
        .unwrap();
    assert_eq!(merit(&mut db, 1).await, (100, 1));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_progress")
            .fetch_one(&mut db)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn legacy_unknown_history_and_explicit_corrections_have_distinct_semantics() {
    let mut db = fixture().await;
    register(&mut db, 1, CurrentState::Unreported).await;
    db.execute("INSERT INTO discovery_reporting_history(profile_id,discovery_id,legacy_merit_credit) VALUES (1,1,1)").await.unwrap();
    let held = change(&mut db, 1, Operation::SetHold { value: true }).await;
    assert_eq!(
        held.history.as_ref().unwrap().status,
        FirstReportStatus::Unknown
    );
    assert!(held.history.as_ref().unwrap().legacy_merit_credit);
    let history = held.history;
    change(&mut db, 1, Operation::RemoveCurrent).await;
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap().history, history);
    assert_eq!(merit(&mut db, 1).await, (100, 1));
    let unknown = change(
        &mut db,
        1,
        Operation::CorrectHistory {
            status: FirstReportStatus::Unknown,
            remove_legacy_credit: false,
            current_state: None,
        },
    )
    .await;
    assert!(unknown.history.unwrap().legacy_merit_credit);
    change(
        &mut db,
        1,
        Operation::CorrectHistory {
            status: FirstReportStatus::Unknown,
            remove_legacy_credit: true,
            current_state: None,
        },
    )
    .await;
    assert_eq!(merit(&mut db, 1).await, (0, 0));
    change(
        &mut db,
        1,
        Operation::CorrectHistory {
            status: FirstReportStatus::Confirmed,
            remove_legacy_credit: false,
            current_state: None,
        },
    )
    .await;
    assert_eq!(merit(&mut db, 1).await, (100, 1));
    register(&mut db, 1, CurrentState::Reported).await;
    let corrected = change(
        &mut db,
        1,
        Operation::CorrectHistory {
            status: FirstReportStatus::NotReported,
            remove_legacy_credit: true,
            current_state: Some(CurrentState::Undiscovered),
        },
    )
    .await;
    assert!(corrected.progress.is_none());
    assert_eq!(
        corrected.history.unwrap().status,
        FirstReportStatus::NotReported
    );
    assert_eq!(merit(&mut db, 1).await, (0, 0));
}

#[tokio::test]
async fn report_confirmation_clears_legacy_and_failed_correction_does_not_leave_partial_history() {
    let mut db = fixture().await;
    register(&mut db, 1, CurrentState::ReportHold).await;
    db.execute("INSERT INTO discovery_reporting_history(profile_id,discovery_id,legacy_merit_credit) VALUES (1,1,1)").await.unwrap();
    let reported = change(&mut db, 1, Operation::Report).await;
    assert!(!reported.history.as_ref().unwrap().legacy_merit_credit);
    assert_eq!(
        reported.history.as_ref().unwrap().status,
        FirstReportStatus::Confirmed
    );
    assert!(update(
        &mut db,
        UpdateRequest {
            expected: reported.clone(),
            source_map_id: None,
            operation: Operation::CorrectHistory {
                status: FirstReportStatus::NotReported,
                remove_legacy_credit: true,
                current_state: None
            }
        }
    )
    .await
    .is_err());
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap(), reported);
}

#[tokio::test]
async fn direct_and_linked_registration_share_special_relic_and_multiple_route_rules() {
    let mut db = fixture().await;
    crate::discovery_progress::mark_discovered(&mut db, 1, 2)
        .await
        .unwrap();
    crate::progress_link::discover(&mut db, 2, 2, None)
        .await
        .unwrap();
    for profile in [1, 2] {
        let state = read_state(&mut db, profile, 2).await.unwrap();
        assert!(state.progress.unwrap().reported);
        assert!(state.history.is_none());
        assert_eq!(merit(&mut db, profile).await, (200, 1));
    }
    for operation in [
        Operation::Report,
        Operation::Rediscover { hold: true },
        Operation::SetHold { value: true },
    ] {
        let expected = read_state(&mut db, 1, 2).await.unwrap();
        assert_eq!(
            update(
                &mut db,
                UpdateRequest {
                    expected,
                    source_map_id: None,
                    operation
                }
            )
            .await
            .unwrap_err()
            .kind,
            "UnsupportedDiscoveryOperation"
        );
    }
    register(&mut db, 3, CurrentState::Unreported).await;
    assert!(
        !read_state(&mut db, 1, 3)
            .await
            .unwrap()
            .progress
            .unwrap()
            .card_owned
    );
    for operation in [
        Operation::Report,
        Operation::SetHold { value: true },
        Operation::CorrectHistory {
            status: FirstReportStatus::Confirmed,
            remove_legacy_credit: false,
            current_state: None,
        },
    ] {
        let expected = read_state(&mut db, 1, 3).await.unwrap();
        assert!(update(
            &mut db,
            UpdateRequest {
                expected,
                source_map_id: None,
                operation
            }
        )
        .await
        .is_err());
    }
    let mut db = fixture().await;
    register(&mut db, 4, CurrentState::Unreported).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_progress")
            .fetch_one(&mut db)
            .await
            .unwrap(),
        0
    );
    register(&mut db, 5, CurrentState::Unreported).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_progress")
            .fetch_one(&mut db)
            .await
            .unwrap(),
        0
    );
    let mut db = fixture().await;
    change(
        &mut db,
        4,
        Operation::Register {
            state: CurrentState::ReportHold,
            selected_quest_id: Some(3),
        },
    )
    .await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT quest_id FROM quest_progress")
            .fetch_one(&mut db)
            .await
            .unwrap(),
        3
    );
}

#[tokio::test]
async fn stale_progress_history_and_map_master_are_rejected_and_invalid_ids_do_not_write() {
    let mut db = fixture().await;
    let expected = read_state(&mut db, 1, 1).await.unwrap();
    register(&mut db, 1, CurrentState::Unreported).await;
    assert_eq!(
        update(
            &mut db,
            UpdateRequest {
                expected,
                source_map_id: None,
                operation: Operation::Register {
                    state: CurrentState::Reported,
                    selected_quest_id: None
                }
            }
        )
        .await
        .unwrap_err()
        .kind,
        "DiscoveryStateConflict"
    );
    let expected = read_state(&mut db, 1, 1).await.unwrap();
    change(
        &mut db,
        1,
        Operation::CorrectHistory {
            status: FirstReportStatus::Unknown,
            remove_legacy_credit: false,
            current_state: None,
        },
    )
    .await;
    assert_eq!(
        update(
            &mut db,
            UpdateRequest {
                expected,
                source_map_id: None,
                operation: Operation::Report
            }
        )
        .await
        .unwrap_err()
        .kind,
        "DiscoveryStateConflict"
    );
    let expected = read_state(&mut db, 1, 1).await.unwrap();
    db.execute("UPDATE quests SET offer_method='生物学' WHERE id=1")
        .await
        .unwrap();
    assert_eq!(
        update(
            &mut db,
            UpdateRequest {
                expected,
                source_map_id: Some(1),
                operation: Operation::Report
            }
        )
        .await
        .unwrap_err()
        .kind,
        "DiscoveryStateConflict"
    );
    for map in [1, 2, 4, 5, 999] {
        // map 1 has multiple discoveries, other maps are unrelated/inactive.
        let expected = read_state(&mut db, 1, 1).await.unwrap();
        assert!(update(
            &mut db,
            UpdateRequest {
                expected,
                source_map_id: Some(map),
                operation: Operation::Report
            }
        )
        .await
        .is_err());
    }
    assert!(read_state(&mut db, 999, 1).await.is_err());
    assert!(read_state(&mut db, 1, 999).await.is_err());
    let expected = read_state(&mut db, 1, 6).await.unwrap();
    assert!(update(
        &mut db,
        UpdateRequest {
            expected,
            source_map_id: None,
            operation: Operation::Register {
                state: CurrentState::Unreported,
                selected_quest_id: None
            }
        }
    )
    .await
    .is_err());
    db.execute("DELETE FROM quest_discoveries WHERE quest_id=1 AND discovery_id=4")
        .await
        .unwrap();
    let expected = read_state(&mut db, 1, 1).await.unwrap();
    assert!(
        update(
            &mut db,
            UpdateRequest {
                expected,
                source_map_id: Some(1),
                operation: Operation::Report
            }
        )
        .await
        .unwrap()
        .progress
        .unwrap()
        .reported
    );
}

#[tokio::test]
async fn transaction_faults_roll_back_current_history_and_linked_quest() {
    let mut db = fixture().await;
    register(&mut db, 1, CurrentState::ReportHold).await;
    let before = read_state(&mut db, 1, 1).await.unwrap();
    db.execute("CREATE TRIGGER fail_history BEFORE INSERT ON discovery_reporting_history BEGIN SELECT RAISE(ABORT,'synthetic'); END;").await.unwrap();
    assert!(update(
        &mut db,
        UpdateRequest {
            expected: before.clone(),
            source_map_id: None,
            operation: Operation::Report
        }
    )
    .await
    .is_err());
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap(), before);
    assert!(update(
        &mut db,
        UpdateRequest {
            expected: before.clone(),
            source_map_id: None,
            operation: Operation::CorrectHistory {
                status: FirstReportStatus::Confirmed,
                remove_legacy_credit: false,
                current_state: Some(CurrentState::Undiscovered)
            }
        }
    )
    .await
    .is_err());
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap(), before);
    let mut db = fixture().await;
    let before = read_state(&mut db, 1, 1).await.unwrap();
    db.execute("CREATE TRIGGER fail_quest BEFORE INSERT ON quest_progress BEGIN SELECT RAISE(ABORT,'synthetic'); END;").await.unwrap();
    assert!(update(
        &mut db,
        UpdateRequest {
            expected: before.clone(),
            source_map_id: None,
            operation: Operation::Register {
                state: CurrentState::Reported,
                selected_quest_id: None
            }
        }
    )
    .await
    .is_err());
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap(), before);
}

#[tokio::test]
async fn separate_connections_detect_stale_state_and_writer_contention() {
    use sqlx::sqlite::SqliteConnectOptions;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    let path = std::env::temp_dir().join(format!(
        "dol-map-c2-{}-{}.db",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .foreign_keys(true)
        .busy_timeout(Duration::ZERO);
    let mut a = SqliteConnection::connect_with(&options).await.unwrap();
    seed(&mut a).await;
    let mut b = SqliteConnection::connect_with(&options).await.unwrap();
    let stale = read_state(&mut b, 1, 1).await.unwrap();
    register(&mut a, 1, CurrentState::Unreported).await;
    assert_eq!(
        update(
            &mut b,
            UpdateRequest {
                expected: stale,
                source_map_id: None,
                operation: Operation::Report
            }
        )
        .await
        .unwrap_err()
        .kind,
        "DiscoveryStateConflict"
    );
    let expected = read_state(&mut b, 1, 1).await.unwrap();
    let tx = a.begin_with("BEGIN IMMEDIATE").await.unwrap();
    assert_eq!(
        update(
            &mut b,
            UpdateRequest {
                expected,
                source_map_id: None,
                operation: Operation::Report
            }
        )
        .await
        .unwrap_err()
        .kind,
        "DiscoveryStateConflict"
    );
    tx.rollback().await.unwrap();
    a.close().await.unwrap();
    b.close().await.unwrap();
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn source_map_registration_validates_route_and_does_not_discover_siblings() {
    let mut db = fixture().await;
    db.execute("DELETE FROM quest_discoveries WHERE quest_id=1 AND discovery_id=4")
        .await
        .unwrap();
    let expected = read_state(&mut db, 1, 1).await.unwrap();
    assert!(update(
        &mut db,
        UpdateRequest {
            expected: expected.clone(),
            source_map_id: Some(1),
            operation: Operation::Register {
                state: CurrentState::ReportHold,
                selected_quest_id: None
            }
        }
    )
    .await
    .is_err());
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap(), expected);
    let state = update(
        &mut db,
        UpdateRequest {
            expected,
            source_map_id: Some(1),
            operation: Operation::Register {
                state: CurrentState::ReportHold,
                selected_quest_id: Some(1),
            },
        },
    )
    .await
    .unwrap();
    assert!(state.progress.unwrap().report_hold);
    assert!(read_state(&mut db, 1, 4).await.unwrap().progress.is_none());
    assert_eq!(merit(&mut db, 1).await, (0, 0));
}

#[tokio::test]
async fn legacy_update_failure_and_master_change_preserve_stored_intent() {
    let mut db = fixture().await;
    register(&mut db, 1, CurrentState::ReportHold).await;
    db.execute("INSERT INTO discovery_reporting_history(profile_id,discovery_id,legacy_merit_credit) VALUES (1,1,1); CREATE TRIGGER fail_update BEFORE UPDATE ON discovery_reporting_history BEGIN SELECT RAISE(ABORT,'synthetic'); END;").await.unwrap();
    let before = read_state(&mut db, 1, 1).await.unwrap();
    assert!(crate::discovery_progress::set_reported(&mut db, 1, 1, true)
        .await
        .is_err());
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap(), before);
    // 既存UIのfalse再送は維持意思を消さず、履歴も変更しない。
    crate::discovery_progress::set_reported(&mut db, 1, 1, false)
        .await
        .unwrap();
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap(), before);
    db.execute("DROP TRIGGER fail_update; UPDATE quests SET offer_method='レガシー' WHERE id=1;")
        .await
        .unwrap();
    let state = read_state(&mut db, 1, 1).await.unwrap();
    assert!(state.automatic_reporting);
    assert!(state.progress.as_ref().unwrap().report_hold);
    let cleaned = change(&mut db, 1, Operation::SetHold { value: false }).await;
    assert_eq!(cleaned.history, state.history);
    assert!(!cleaned.progress.unwrap().report_hold);
}

#[tokio::test]
async fn public_json_contract_round_trips_camel_case_and_required_expected_state() {
    let mut db = fixture().await;
    let expected = read_state(&mut db, 1, 1).await.unwrap();
    let json = serde_json::json!({"expected":expected,"sourceMapId":null,"operation":{"kind":"register","state":"reportHold","selectedQuestId":null}});
    let request: UpdateRequest = serde_json::from_value(json).unwrap();
    let state = update(&mut db, request).await.unwrap();
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(json["progress"]["reportHold"], true);
    assert_eq!(
        serde_json::from_value::<DiscoveryState>(json).unwrap(),
        state
    );
    assert!(serde_json::from_value::<UpdateRequest>(
        serde_json::json!({"operation":{"kind":"report"}})
    )
    .is_err());
}

#[tokio::test]
async fn combined_unreported_history_correction_is_atomic_and_preserves_card_memo_and_quests() {
    let mut db = fixture().await;
    register(&mut db, 1, CurrentState::Reported).await;
    db.execute(
        "UPDATE discovery_progress SET memo='synthetic keep' WHERE profile_id=1 AND discovery_id=1",
    )
    .await
    .unwrap();
    let before = read_state(&mut db, 1, 1).await.unwrap();
    let quests: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM quest_progress")
        .fetch_one(&mut db)
        .await
        .unwrap();
    let operation = Operation::CorrectHistory {
        status: FirstReportStatus::NotReported,
        remove_legacy_credit: false,
        current_state: Some(CurrentState::Unreported),
    };
    db.execute("CREATE TRIGGER fail_history_correction BEFORE UPDATE ON discovery_reporting_history BEGIN SELECT RAISE(ABORT,'synthetic'); END;").await.unwrap();
    assert!(update(
        &mut db,
        UpdateRequest {
            expected: before.clone(),
            source_map_id: None,
            operation,
        }
    )
    .await
    .is_err());
    assert_eq!(read_state(&mut db, 1, 1).await.unwrap(), before);
    assert_eq!(merit(&mut db, 1).await, (100, 1));
    db.execute("DROP TRIGGER fail_history_correction")
        .await
        .unwrap();
    let corrected = change(
        &mut db,
        1,
        Operation::CorrectHistory {
            status: FirstReportStatus::NotReported,
            remove_legacy_credit: false,
            current_state: Some(CurrentState::Unreported),
        },
    )
    .await;
    assert!(!corrected.progress.as_ref().unwrap().reported);
    assert_eq!(
        corrected.progress.as_ref().unwrap().card_owned,
        before.progress.as_ref().unwrap().card_owned
    );
    assert_eq!(
        corrected.progress.as_ref().unwrap().memo,
        before.progress.as_ref().unwrap().memo
    );
    assert_eq!(
        corrected.history.unwrap().status,
        FirstReportStatus::NotReported
    );
    assert_eq!(merit(&mut db, 1).await, (0, 0));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_progress")
            .fetch_one(&mut db)
            .await
            .unwrap(),
        quests
    );
    assert!(read_state(&mut db, 2, 1).await.unwrap().history.is_none());
}

#[tokio::test]
async fn non_map_weather_history_requires_explicit_confirmation_and_preserves_current_progress() {
    for experience in [Some(125_i64), None] {
        for status in [FirstReportStatus::NotReported, FirstReportStatus::Confirmed] {
            for legacy in [false, true] {
                let mut db = fixture().await;
                db.execute("INSERT INTO discovery_categories(id,name) VALUES(3,'気象・現象'); UPDATE discoveries SET category_id=3 WHERE id=5;").await.unwrap();
                sqlx::query("UPDATE discoveries SET experience=? WHERE id=5")
                    .bind(experience)
                    .execute(&mut db)
                    .await
                    .unwrap();
                let registered = register(&mut db, 5, CurrentState::Unreported).await;
                assert!(registered.related_quests.is_empty());
                assert!(registered.history.is_none());
                assert!(!registered.progress.unwrap().reported);
                db.execute("UPDATE discovery_progress SET card_owned=0,memo='synthetic weather',report_hold=1 WHERE profile_id=1 AND discovery_id=5").await.unwrap();
                if legacy {
                    db.execute("INSERT INTO discovery_reporting_history(profile_id,discovery_id,legacy_merit_credit) VALUES(1,5,1)").await.unwrap();
                }
                let before = read_state(&mut db, 1, 5).await.unwrap();
                let corrected = change(
                    &mut db,
                    5,
                    Operation::CorrectHistory {
                        status,
                        remove_legacy_credit: false,
                        current_state: None,
                    },
                )
                .await;
                assert_eq!(corrected.progress, before.progress);
                assert_eq!(corrected.history.as_ref().unwrap().status, status);
                assert!(!corrected.history.as_ref().unwrap().legacy_merit_credit);
                let expected_merit = if status == FirstReportStatus::Confirmed {
                    (experience.unwrap_or(0), 1)
                } else {
                    (0, 0)
                };
                assert_eq!(merit(&mut db, 1).await, expected_merit);
                assert_eq!(
                    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_progress")
                        .fetch_one(&mut db)
                        .await
                        .unwrap(),
                    0
                );
                let other_profile = read_state(&mut db, 2, 5).await.unwrap();
                assert!(other_profile.history.is_none());
                assert!(other_profile.progress.is_none());
                // 古いsnapshotを再送しても、確定した履歴を上書きしない。
                assert_eq!(
                    update(
                        &mut db,
                        UpdateRequest {
                            expected: before,
                            source_map_id: None,
                            operation: Operation::CorrectHistory {
                                status: FirstReportStatus::Unknown,
                                remove_legacy_credit: false,
                                current_state: None
                            },
                        }
                    )
                    .await
                    .unwrap_err()
                    .kind,
                    "DiscoveryStateConflict"
                );
                assert_eq!(read_state(&mut db, 1, 5).await.unwrap(), corrected);
                if status == FirstReportStatus::Confirmed {
                    let reported = change(&mut db, 5, Operation::Report).await;
                    let rediscovered =
                        change(&mut db, 5, Operation::Rediscover { hold: false }).await;
                    assert_eq!(rediscovered.history, reported.history);
                    change(&mut db, 5, Operation::RemoveCurrent).await;
                    let registered = register(&mut db, 5, CurrentState::Unreported).await;
                    assert_eq!(registered.history, reported.history);
                    assert_eq!(merit(&mut db, 1).await, expected_merit);
                }
            }
        }
    }
}

#[tokio::test]
async fn non_map_history_conflicts_require_atomic_current_correction() {
    for target in [CurrentState::Unreported, CurrentState::Undiscovered] {
        let mut db = fixture().await;
        register(&mut db, 5, CurrentState::Reported).await;
        db.execute("UPDATE discovery_progress SET memo='synthetic keep' WHERE profile_id=1 AND discovery_id=5").await.unwrap();
        let before = read_state(&mut db, 1, 5).await.unwrap();
        assert!(before.related_quests.is_empty());
        assert!(update(
            &mut db,
            UpdateRequest {
                expected: before.clone(),
                source_map_id: None,
                operation: Operation::CorrectHistory {
                    status: FirstReportStatus::NotReported,
                    remove_legacy_credit: false,
                    current_state: None
                },
            }
        )
        .await
        .is_err());
        assert_eq!(read_state(&mut db, 1, 5).await.unwrap(), before);
        db.execute("CREATE TRIGGER fail_weather_history BEFORE UPDATE ON discovery_reporting_history BEGIN SELECT RAISE(ABORT,'synthetic'); END;").await.unwrap();
        assert!(update(
            &mut db,
            UpdateRequest {
                expected: before.clone(),
                source_map_id: None,
                operation: Operation::CorrectHistory {
                    status: FirstReportStatus::NotReported,
                    remove_legacy_credit: false,
                    current_state: Some(target)
                },
            }
        )
        .await
        .is_err());
        assert_eq!(read_state(&mut db, 1, 5).await.unwrap(), before);
        db.execute("DROP TRIGGER fail_weather_history")
            .await
            .unwrap();
        let corrected = change(
            &mut db,
            5,
            Operation::CorrectHistory {
                status: FirstReportStatus::NotReported,
                remove_legacy_credit: false,
                current_state: Some(target),
            },
        )
        .await;
        if matches!(target, CurrentState::Unreported) {
            let progress = corrected.progress.unwrap();
            assert!(!progress.reported);
            assert_eq!(
                progress.card_owned,
                before.progress.as_ref().unwrap().card_owned
            );
            assert_eq!(progress.memo, before.progress.unwrap().memo);
        } else {
            assert!(corrected.progress.is_none());
        }
        assert_eq!(
            corrected.history.unwrap().status,
            FirstReportStatus::NotReported
        );
        assert_eq!(merit(&mut db, 1).await, (0, 0));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_progress")
                .fetch_one(&mut db)
                .await
                .unwrap(),
            0
        );
    }
}

#[tokio::test]
async fn resetting_confirmed_history_to_unknown_preserves_progress_and_never_restores_legacy_credit(
) {
    for map_related in [false, true] {
        for status in [FirstReportStatus::NotReported, FirstReportStatus::Confirmed] {
            for remove_current in [false, true] {
                for experience in [Some(125_i64), None] {
                    let mut db = fixture().await;
                    db.execute("INSERT INTO discovery_categories(id,name) VALUES(3,'気象・現象'); UPDATE discoveries SET category_id=3 WHERE id=5; INSERT INTO quest_progress(profile_id,quest_id,memo) VALUES(1,3,'synthetic quest');").await.unwrap();
                    sqlx::query("UPDATE discoveries SET experience=? WHERE id=5")
                        .bind(experience)
                        .execute(&mut db)
                        .await
                        .unwrap();
                    if map_related {
                        db.execute("INSERT INTO quest_discoveries VALUES(1,5)")
                            .await
                            .unwrap();
                    }
                    let discovered = register(&mut db, 5, CurrentState::Unreported).await;
                    assert!(discovered.history.is_none());
                    db.execute("UPDATE discovery_progress SET card_owned=0,memo='synthetic weather',report_hold=1 WHERE profile_id=1 AND discovery_id=5; INSERT INTO discovery_reporting_history(profile_id,discovery_id,legacy_merit_credit) VALUES(1,5,1);").await.unwrap();
                    let confirmed = change(
                        &mut db,
                        5,
                        Operation::CorrectHistory {
                            status,
                            remove_legacy_credit: false,
                            current_state: None,
                        },
                    )
                    .await;
                    assert!(!confirmed.history.unwrap().legacy_merit_credit);
                    if remove_current {
                        let removed = change(&mut db, 5, Operation::RemoveCurrent).await;
                        assert_eq!(removed.history.unwrap().status, status);
                    }
                    let before = read_state(&mut db, 1, 5).await.unwrap();
                    let quests: Vec<(i64, Option<String>, String)> = sqlx::query_as("SELECT quest_id,memo,updated_at FROM quest_progress WHERE profile_id=1 ORDER BY quest_id").fetch_all(&mut db).await.unwrap();
                    let operation = || Operation::CorrectHistory {
                        status: FirstReportStatus::Unknown,
                        remove_legacy_credit: false,
                        current_state: None,
                    };
                    db.execute("CREATE TRIGGER fail_unknown_history BEFORE UPDATE ON discovery_reporting_history BEGIN SELECT RAISE(ABORT,'synthetic'); END;").await.unwrap();
                    assert!(update(
                        &mut db,
                        UpdateRequest {
                            expected: before.clone(),
                            source_map_id: None,
                            operation: operation()
                        }
                    )
                    .await
                    .is_err());
                    assert_eq!(read_state(&mut db, 1, 5).await.unwrap(), before);
                    db.execute("DROP TRIGGER fail_unknown_history")
                        .await
                        .unwrap();
                    let reset = change(&mut db, 5, operation()).await;
                    assert_eq!(
                        reset.history.as_ref().unwrap().status,
                        FirstReportStatus::Unknown
                    );
                    assert!(!reset.history.unwrap().legacy_merit_credit);
                    assert_eq!(reset.progress, before.progress);
                    assert_eq!(reset.related_quests, before.related_quests);
                    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM discovery_reporting_history WHERE profile_id=1 AND discovery_id=5").fetch_one(&mut db).await.unwrap(), 1);
                    assert_eq!(sqlx::query_as::<_,(i64,Option<String>,String)>("SELECT quest_id,memo,updated_at FROM quest_progress WHERE profile_id=1 ORDER BY quest_id").fetch_all(&mut db).await.unwrap(), quests);
                    assert_eq!(merit(&mut db, 1).await, (0, 0));
                    assert!(read_state(&mut db, 2, 5).await.unwrap().history.is_none());
                }
            }
        }
    }
}
