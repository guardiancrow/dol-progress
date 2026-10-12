#![cfg(windows)]
use super::*;
use crate::consent::{
    native_ui::{UiAcceptance, UiErrorKind},
    CommitState, StorageErrorKind, TermsVersion,
};
use serde_json::{json, Value};
use std::{
    cell::Cell,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Barrier,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static SERIAL: AtomicU64 = AtomicU64::new(0);
fn terms(version: u32, body: &str) -> CanonicalTerms {
    CanonicalTerms::from_body(TermsVersion::new(version).unwrap(), body.as_bytes()).unwrap()
}
fn current() -> CanonicalTerms {
    terms(900003, "TEST ONLY 合成条件。正式本文ではありません。")
}
fn accepted(t: &CanonicalTerms) -> Result<ConsentDecision, NativeUiError> {
    Ok(ConsentDecision::Accepted(UiAcceptance::for_test(t)))
}
struct Fixture {
    root: PathBuf,
    store: ConsentStore,
}
impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tmp/phase-local-5c-c/fixtures")
            .join(format!(
                "{}-{}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("TEST_ONLY.fixture"), b"TEST_ONLY").unwrap();
        let store = ConsentStore::for_portable_root(&root).unwrap();
        Self { root, store }
    }
    fn put(&self, bytes: &[u8]) {
        fs::create_dir_all(self.root.join("config")).unwrap();
        fs::write(self.store.record_path(), bytes).unwrap();
    }
    fn record(&self, t: &CanonicalTerms) {
        self.put(&serde_json::to_vec(&ConsentRecord::accepted(t)).unwrap());
    }
    fn altered(&self, key: &str, value: Value) {
        let mut v = serde_json::to_value(ConsentRecord::accepted(&current())).unwrap();
        v[key] = value;
        self.put(&serde_json::to_vec(&v).unwrap());
    }
    fn bytes(&self) -> Vec<u8> {
        fs::read(self.store.record_path()).unwrap()
    }
}
fn passed<T, E: std::fmt::Debug>(out: GateOutcome<T, E>, expected: PassBasis) -> T {
    match out {
        GateOutcome::Started { basis, result } => {
            assert_eq!(basis, expected);
            result.unwrap()
        }
        _ => panic!("expected pass"),
    }
}
fn zero_with(
    f: &Fixture,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
) -> GateStop {
    let calls = Cell::new(0);
    let out = run(&current(), &f.store, ui, |_| {
        calls.set(calls.get() + 1);
        Ok::<_, ()>(())
    });
    assert_eq!(calls.get(), 0);
    match out {
        GateOutcome::Stopped(stop) => stop,
        _ => panic!("unexpected startup"),
    }
}

#[test]
fn first_accept_saves_verified_record_then_normal_once() {
    let f = Fixture::new();
    let ui_calls = Cell::new(0);
    let next = Cell::new(0);
    let out = run(
        &current(),
        &f.store,
        |t| {
            ui_calls.set(ui_calls.get() + 1);
            assert!(!f.root.join("config").exists());
            accepted(t)
        },
        |r| {
            next.set(next.get() + 1);
            assert_eq!(r.terms_sha256(), current().sha256());
            assert!(matches!(
                crate::consent::parse_record(&f.bytes(), &current()),
                RecordStatus::Accepted(_)
            ));
            assert_eq!(
                f.store.read(&current()).unwrap_err().kind,
                StorageErrorKind::Busy
            );
            Ok::<_, ()>("Normal")
        },
    );
    assert_eq!(passed(out, PassBasis::SavedAcceptance), "Normal");
    assert_eq!((ui_calls.get(), next.get()), (1, 1));
    assert!(matches!(
        f.store.read(&current()).unwrap(),
        RecordStatus::Accepted(_)
    ));
}
#[test]
fn second_run_skips_ui_and_does_not_rewrite() {
    let f = Fixture::new();
    passed(
        run(&current(), &f.store, accepted, |_| Ok::<_, ()>(())),
        PassBasis::SavedAcceptance,
    );
    let bytes = f.bytes();
    let metadata = fs::metadata(f.store.record_path())
        .unwrap()
        .last_write_time();
    let n = Cell::new(0);
    passed(
        run(
            &current(),
            &f.store,
            |_| panic!("UI must be skipped"),
            |_| {
                n.set(n.get() + 1);
                Ok::<_, ()>(())
            },
        ),
        PassBasis::ExistingRecord,
    );
    assert_eq!(n.get(), 1);
    assert_eq!(f.bytes(), bytes);
    assert_eq!(
        fs::metadata(f.store.record_path())
            .unwrap()
            .last_write_time(),
        metadata
    );
}
use std::os::windows::fs::MetadataExt;
#[test]
fn same_version_same_hash_recovery_callback_once() {
    let f = Fixture::new();
    f.record(&current());
    assert_eq!(
        passed(
            run(
                &current(),
                &f.store,
                |_| panic!("no UI"),
                |_| Ok::<_, ()>("Recovery")
            ),
            PassBasis::ExistingRecord
        ),
        "Recovery"
    );
}
#[test]
fn new_version_requires_ui_even_when_body_unchanged() {
    let f = Fixture::new();
    f.record(&terms(900002, current().text()));
    passed(
        run(&current(), &f.store, accepted, |_| Ok::<_, ()>(())),
        PassBasis::SavedAcceptance,
    );
    assert!(matches!(
        f.store.read(&current()).unwrap(),
        RecordStatus::Accepted(_)
    ));
}
#[test]
fn same_version_different_hash_requires_explicit_acceptance() {
    let f = Fixture::new();
    f.record(&terms(900003, "TEST ONLY 旧本文"));
    let old = f.bytes();
    assert!(matches!(
        zero_with(&f, |_| Ok(ConsentDecision::Declined(DeclineReason::Button))),
        GateStop::Declined(_)
    ));
    assert_eq!(f.bytes(), old);
    passed(
        run(&current(), &f.store, accepted, |_| Ok::<_, ()>(())),
        PassBasis::SavedAcceptance,
    );
    assert_ne!(f.bytes(), old);
}
macro_rules! decline_case {($name:ident,$reason:expr)=>{#[test]fn $name(){let f=Fixture::new();assert!(matches!(zero_with(&f, |_|Ok(ConsentDecision::Declined($reason))),GateStop::Declined(r) if r==$reason));assert!(!f.root.join("config").exists());}};}
decline_case!(decline_button_leaves_config_absent, DeclineReason::Button);
decline_case!(window_close_stops_without_write, DeclineReason::WindowClose);
decline_case!(escape_stops_without_write, DeclineReason::Escape);
#[test]
fn ui_error_leaves_config_absent_and_calls_zero() {
    let f = Fixture::new();
    assert!(matches!(
        zero_with(&f, |_| Err(NativeUiError {
            kind: UiErrorKind::DisplayVerification,
            os_error: None
        })),
        GateStop::Ui(_)
    ));
    assert!(!f.root.join("config").exists());
}
macro_rules! identity_case {
    ($name:ident,$identity:expr) => {
        #[test]
        fn $name() {
            let f = Fixture::new();
            assert!(matches!(
                zero_with(&f, |_| accepted(&$identity)),
                GateStop::IdentityMismatch
            ));
            assert!(!f.root.join("config").exists());
        }
    };
}
identity_case!(
    wrong_ui_version_stops_before_save,
    terms(900004, current().text())
);
identity_case!(
    wrong_ui_hash_stops_before_save,
    terms(900003, "TEST ONLY 別本文")
);
#[test]
fn broken_json_stops_without_ui_or_overwrite() {
    let f = Fixture::new();
    f.put(b"{broken");
    let old = f.bytes();
    assert!(matches!(
        zero_with(&f, |_| panic!("no UI")),
        GateStop::Record(RecordStatus::Corrupt(_))
    ));
    assert_eq!(f.bytes(), old);
}
macro_rules! blocked_case {
    ($name:ident,$field:literal,$value:expr,$pattern:pat) => {
        #[test]
        fn $name() {
            let f = Fixture::new();
            f.altered($field, $value);
            let old = f.bytes();
            assert!(matches!(
                zero_with(&f, |_| panic!("no UI")),
                GateStop::Record($pattern)
            ));
            assert_eq!(f.bytes(), old);
        }
    };
}
blocked_case!(
    invalid_state_stops,
    "state",
    json!("declined"),
    RecordStatus::InvalidState
);
blocked_case!(
    unknown_schema_stops,
    "schemaVersion",
    json!(2),
    RecordStatus::UnsupportedSchema { .. }
);
blocked_case!(
    unknown_canonical_stops,
    "canonicalVersion",
    json!(2),
    RecordStatus::UnsupportedCanonical { .. }
);
blocked_case!(
    future_terms_stops,
    "termsVersion",
    json!(900004),
    RecordStatus::FutureTerms { .. }
);
#[test]
fn read_sharing_error_stops_without_ui() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    f.record(&current());
    let handle = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(f.store.record_path())
        .unwrap();
    assert!(matches!(
        zero_with(&f, |_| panic!("no UI")),
        GateStop::Storage(_)
    ));
    drop(handle);
    assert!(matches!(
        f.store.read(&current()).unwrap(),
        RecordStatus::Accepted(_)
    ));
}
#[test]
fn directory_collision_stops_without_ui() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("config")).unwrap();
    fs::create_dir(f.store.record_path()).unwrap();
    assert!(matches!(
        zero_with(&f, |_| panic!("no UI")),
        GateStop::Storage(_)
    ));
    assert!(f.store.record_path().is_dir());
}
#[test]
fn unsafe_hardlink_does_not_write_outside_fixture() {
    let f = Fixture::new();
    let outside = Fixture::new();
    outside.record(&current());
    fs::create_dir(f.root.join("config")).unwrap();
    fs::hard_link(outside.store.record_path(), f.store.record_path()).unwrap();
    let old = outside.bytes();
    assert!(matches!(
        zero_with(&f, |_| panic!("no UI")),
        GateStop::Storage(_)
    ));
    assert_eq!(outside.bytes(), old);
}
#[test]
fn busy_lease_stops_before_ui_then_releases() {
    let f = Fixture::new();
    f.record(&current());
    let lease = f.store.lock_verified_record(&current()).unwrap();
    assert!(
        matches!(zero_with(&f, |_|panic!("no UI")), GateStop::Storage(e) if e.kind==StorageErrorKind::Busy)
    );
    drop(lease);
    passed(
        run(
            &current(),
            &f.store,
            |_| panic!("no UI"),
            |_| Ok::<_, ()>(()),
        ),
        PassBasis::ExistingRecord,
    );
}
#[test]
fn matching_record_written_during_ui_skips_duplicate_save() {
    let f = Fixture::new();
    let saved = Cell::new(0);
    let out = run_with(
        &current(),
        &f.store,
        |t| {
            drop(f.store.save_after_explicit_acceptance(t).unwrap());
            accepted(t)
        },
        |_| Ok::<_, ()>(()),
        |stage| {
            if stage == SaveStage::TempCreate {
                saved.set(saved.get() + 1)
            }
            Ok(())
        },
    );
    passed(out, PassBasis::ConcurrentAcceptance);
    assert_eq!(saved.get(), 0);
}
#[test]
fn different_old_version_written_during_ui_is_not_overwritten() {
    let f = Fixture::new();
    assert!(
        matches!(zero_with(&f,|t|{f.record(&terms(900002,t.text()));accepted(t)}),GateStop::Storage(e) if e.kind==StorageErrorKind::RecordChanged)
    );
    assert!(matches!(
        f.store.read(&current()).unwrap(),
        RecordStatus::Outdated {
            recorded_version: 900002
        }
    ));
}
#[test]
fn different_hash_written_during_ui_is_not_overwritten() {
    let f = Fixture::new();
    let other = terms(900003, "TEST ONLY concurrent");
    assert!(
        matches!(zero_with(&f,|t|{f.record(&other);accepted(t)}),GateStop::Storage(e) if e.kind==StorageErrorKind::RecordChanged)
    );
    assert!(matches!(
        f.store.read(&other).unwrap(),
        RecordStatus::Accepted(_)
    ));
}
#[test]
fn future_record_written_during_ui_stops_without_rollback() {
    let f = Fixture::new();
    let future = terms(900004, current().text());
    assert!(matches!(
        zero_with(&f, |t| {
            drop(f.store.save_after_explicit_acceptance(&future).unwrap());
            accepted(t)
        }),
        GateStop::Storage(_)
    ));
    assert!(matches!(
        f.store.read(&future).unwrap(),
        RecordStatus::Accepted(_)
    ));
}
#[test]
fn changed_old_record_at_lock_acquisition_is_not_overwritten() {
    let f = Fixture::new();
    f.record(&terms(900001, current().text()));
    let n = Cell::new(0);
    let out = run_with(
        &current(),
        &f.store,
        accepted,
        |_| {
            n.set(n.get() + 1);
            Ok::<_, ()>(())
        },
        |stage| {
            if stage == SaveStage::PrepareConfig {
                f.record(&terms(900002, current().text()));
            }
            Ok(())
        },
    );
    assert!(
        matches!(out,GateOutcome::Stopped(GateStop::Storage(e)) if e.kind==StorageErrorKind::RecordChanged)
    );
    assert_eq!(n.get(), 0);
    assert!(matches!(
        f.store.read(&current()).unwrap(),
        RecordStatus::Outdated {
            recorded_version: 900002
        }
    ));
}
fn fault(stage: SaveStage) {
    let f = Fixture::new();
    f.record(&terms(900002, current().text()));
    let old = f.bytes();
    let n = Cell::new(0);
    let out = run_with(
        &current(),
        &f.store,
        accepted,
        |_| {
            n.set(n.get() + 1);
            Ok::<_, ()>(())
        },
        |s| {
            if s == stage {
                Err(io::Error::other("TEST ONLY injected"))
            } else {
                Ok(())
            }
        },
    );
    let error = match out {
        GateOutcome::Stopped(GateStop::Storage(e)) => e,
        _ => panic!("fault passed"),
    };
    assert_eq!(error.stage, stage);
    assert_eq!(n.get(), 0);
    if error.commit_state == CommitState::NotReplaced {
        assert_eq!(f.bytes(), old);
    } else {
        assert!(error
            .recovery_artifacts
            .iter()
            .any(|p| fs::read(p).is_ok_and(|bytes| bytes == old)));
    }
    // failureでもleaseが残っていない。正式記録をreadできる（成功と同一視しない）。
    assert!(f.store.read(&current()).is_ok());
}
macro_rules! fault_case {
    ($name:ident,$stage:ident) => {
        #[test]
        fn $name() {
            fault(SaveStage::$stage)
        }
    };
}
fault_case!(prepare_config_failure_blocks_startup, PrepareConfig);
fault_case!(temp_create_failure_preserves_old, TempCreate);
fault_case!(temp_write_failure_preserves_old, TempWrite);
fault_case!(half_write_failure_preserves_old, TempHalfWritten);
fault_case!(temp_sync_failure_preserves_old, TempSync);
fault_case!(
    temporary_verification_failure_preserves_old,
    VerifyTemporary
);
fault_case!(backup_write_failure_preserves_old, BackupWrite);
fault_case!(backup_sync_failure_preserves_old, BackupSync);
fault_case!(replace_failure_preserves_old, Replace);
fault_case!(after_replace_failure_retains_old_artifact, AfterReplace);
fault_case!(destination_sync_failure_blocks_startup, DestinationSync);
fault_case!(
    destination_verification_failure_blocks_startup,
    VerifyDestination
);
fault_case!(cleanup_failure_blocks_startup, Cleanup);
#[test]
fn actual_destination_reverification_detects_corruption() {
    let f = Fixture::new();
    f.record(&terms(900002, current().text()));
    let old = f.bytes();
    let n = Cell::new(0);
    let out = run_with(
        &current(),
        &f.store,
        accepted,
        |_| {
            n.set(n.get() + 1);
            Ok::<_, ()>(())
        },
        |s| {
            if s == SaveStage::VerifyDestination {
                fs::write(f.store.record_path(), b"{broken").unwrap();
            }
            Ok(())
        },
    );
    assert_eq!(n.get(), 0);
    assert!(
        matches!(out,GateOutcome::Stopped(GateStop::Storage(e)) if e.kind==StorageErrorKind::Verification&& e.recovery_artifacts.iter().any(|p|fs::read(p).is_ok_and(|b|b==old)))
    );
}
#[test]
fn downstream_error_is_distinct_and_preserves_record() {
    let f = Fixture::new();
    let out = run(&current(), &f.store, accepted, |_| {
        Err::<(), _>("TEST ONLY startup failure")
    });
    assert!(matches!(
        out,
        GateOutcome::Started {
            basis: PassBasis::SavedAcceptance,
            result: Err(_)
        }
    ));
    let bytes = f.bytes();
    drop(f.store.lock_verified_record(&current()).unwrap());
    assert_eq!(f.bytes(), bytes);
}
#[test]
fn downstream_panic_releases_lease_without_deleting_record() {
    let f = Fixture::new();
    assert!(std::panic::catch_unwind(|| run(
        &current(),
        &f.store,
        accepted,
        |_| -> Result<(), ()> { panic!("TEST ONLY downstream panic") }
    ))
    .is_err());
    let bytes = f.bytes();
    drop(f.store.lock_verified_record(&current()).unwrap());
    assert_eq!(f.bytes(), bytes);
}
#[test]
fn two_threads_cannot_start_same_root_while_callback_holds_lease() {
    let f = Fixture::new();
    f.record(&current());
    let ready = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let store = f.store.clone();
    let r = ready.clone();
    let end = release.clone();
    let worker = thread::spawn(move || {
        run(
            &current(),
            &store,
            |_| panic!("no UI"),
            |_| {
                r.wait();
                end.wait();
                Ok::<_, ()>(())
            },
        )
    });
    ready.wait();
    assert!(
        matches!(zero_with(&f, |_|panic!("no UI")),GateStop::Storage(e) if e.kind==StorageErrorKind::Busy)
    );
    release.wait();
    passed(worker.join().unwrap(), PassBasis::ExistingRecord);
    drop(f.store.lock_verified_record(&current()).unwrap());
}
#[test]
fn two_concurrent_acceptances_allow_only_one_callback_until_lease_drops() {
    let f = Fixture::new();
    let barrier = Arc::new(Barrier::new(2));
    let (tx, rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let store = f.store.clone();
    let b = barrier.clone();
    let worker = thread::spawn(move || {
        run(
            &current(),
            &store,
            |t| {
                b.wait();
                accepted(t)
            },
            |_| {
                tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(30)).unwrap();
                Ok::<_, ()>(())
            },
        )
    });
    let stop = zero_with(&f, |t| {
        barrier.wait();
        rx.recv_timeout(Duration::from_secs(30)).unwrap();
        accepted(t)
    });
    assert!(matches!(stop,GateStop::Storage(e) if e.kind==StorageErrorKind::Busy));
    release_tx.send(()).unwrap();
    passed(worker.join().unwrap(), PassBasis::SavedAcceptance);
}
#[test]
fn orphan_artifacts_are_not_acceptance_and_are_preserved() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("config")).unwrap();
    let p = f.root.join("config/.consent-previous-orphan");
    fs::write(
        &p,
        serde_json::to_vec(&ConsentRecord::accepted(&current())).unwrap(),
    )
    .unwrap();
    assert!(matches!(
        zero_with(&f, |_| Ok(ConsentDecision::Declined(DeclineReason::Button))),
        GateStop::Declined(_)
    ));
    assert!(p.exists());
    assert!(!f.store.record_path().exists());
}
#[test]
fn synthetic_database_config_and_external_sentinel_never_change() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("data")).unwrap();
    fs::create_dir(f.root.join("config")).unwrap();
    let paths = [
        f.root.join("data/synthetic.db"),
        f.root.join("config/data-root.json"),
        f.root.join("config/data-root.last-good.json"),
    ];
    for p in &paths {
        fs::write(p, b"TEST ONLY sentinel").unwrap();
    }
    let outside = Fixture::new();
    let sentinel = outside.root.join("untouched");
    fs::write(&sentinel, b"TEST ONLY outside").unwrap();
    zero_with(&f, |_| Ok(ConsentDecision::Declined(DeclineReason::Button)));
    zero_with(&f, |_| {
        Err(NativeUiError {
            kind: UiErrorKind::CreateDialog,
            os_error: None,
        })
    });
    let n = Cell::new(0);
    let out = run_with(
        &current(),
        &f.store,
        accepted,
        |_| {
            n.set(n.get() + 1);
            Ok::<_, ()>(())
        },
        |_| Err(io::Error::other("TEST ONLY")),
    );
    assert!(matches!(out, GateOutcome::Stopped(_)));
    assert_eq!(n.get(), 0);
    passed(
        run(&current(), &f.store, accepted, |_| Ok::<_, ()>(())),
        PassBasis::SavedAcceptance,
    );
    for p in &paths {
        assert_eq!(fs::read(p).unwrap(), b"TEST ONLY sentinel");
    }
    assert_eq!(fs::read(sentinel).unwrap(), b"TEST ONLY outside");
    assert_eq!(fs::read_dir(outside.root).unwrap().count(), 2);
}
#[test]
fn production_run_has_no_synthetic_terms() {
    let lib = include_str!("../../lib.rs");
    let run = &lib[lib.find("#[cfg_attr").unwrap()..];
    assert!(!run.contains("TEST ONLY"));
    assert!(!run.contains("900003"));
    assert!(run.contains("runtime_preflight::before_portable_startup"));
    assert!(run.contains("data_root::prepare_startup"));
}

// 子processだけで実行する補助entry。独立した試験成功数には数えない。
#[test]
#[ignore = "隔離process試験の補助entry"]
fn child_gate_callback_holds_lease() {
    let root = PathBuf::from(std::env::var_os("DOL_GATE_FIXTURE").expect("explicit fixture"));
    let base = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("tmp/phase-local-5c-c/fixtures")
        .canonicalize()
        .unwrap();
    let root = root.canonicalize().unwrap();
    assert!(root.starts_with(&base) && root != base);
    assert_eq!(
        fs::read(root.join("TEST_ONLY.fixture")).unwrap(),
        b"TEST_ONLY"
    );
    let store = ConsentStore::for_portable_root(&root).unwrap();
    passed(
        run(
            &current(),
            &store,
            |_| panic!("no UI"),
            |_| {
                fs::write(root.join("CHILD_READY"), b"TEST_ONLY").unwrap();
                let deadline = Instant::now() + Duration::from_secs(30);
                while !root.join("CHILD_RELEASE").exists() {
                    assert!(Instant::now() < deadline);
                    thread::sleep(Duration::from_millis(5));
                }
                Ok::<_, ()>(())
            },
        ),
        PassBasis::ExistingRecord,
    );
}
#[test]
fn separate_process_gate_stops_while_child_startup_holds_lease() {
    use std::os::windows::process::CommandExt;
    use std::process::{Child, Command, Stdio};
    struct OwnedChild(Child);
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let f = Fixture::new();
    f.record(&current());
    let mut child = OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "consent::gate::tests::child_gate_callback_holds_lease",
                "--ignored",
            ])
            .env("DOL_GATE_FIXTURE", &f.root)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    while !f.root.join("CHILD_READY").exists() {
        assert!(Instant::now() < deadline);
        assert!(child.0.try_wait().unwrap().is_none());
        thread::sleep(Duration::from_millis(5));
    }
    assert!(
        matches!(zero_with(&f, |_|panic!("no UI")),GateStop::Storage(e) if e.kind==StorageErrorKind::Busy)
    );
    fs::write(f.root.join("CHILD_RELEASE"), b"TEST_ONLY").unwrap();
    assert!(child.0.wait().unwrap().success());
    passed(
        run(
            &current(),
            &f.store,
            |_| panic!("no UI"),
            |_| Ok::<_, ()>(()),
        ),
        PassBasis::ExistingRecord,
    );
}
