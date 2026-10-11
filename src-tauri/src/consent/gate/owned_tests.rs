#![cfg(windows)]
use super::*;
use crate::consent::{
    native_ui::{UiAcceptance, UiErrorKind},
    StorageErrorKind, TermsVersion,
};
use serde_json::json;
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
fn terms() -> CanonicalTerms {
    CanonicalTerms::from_body(
        TermsVersion::new(900004).unwrap(),
        b"TEST ONLY owned permit fixture.",
    )
    .unwrap()
}
fn accept(t: &CanonicalTerms) -> Result<ConsentDecision, NativeUiError> {
    Ok(ConsentDecision::Accepted(UiAcceptance::for_test(t)))
}
fn base() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("tmp/phase-local-5c-e/fixtures")
}
struct Fixture {
    root: PathBuf,
    store: ConsentStore,
}
impl Fixture {
    fn new() -> Self {
        let root = base().join(format!(
            "{}-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
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
    fn authorize(&self) -> OwnedPermit {
        authorize_for_startup(&terms(), &self.store, accept).unwrap_or_else(|e| panic!("{e:?}"))
    }
    fn guard(&self) -> StartupGuard {
        self.authorize().into_startup(&self.root, &terms()).unwrap()
    }
    fn available(&self) {
        assert!(matches!(
            self.store.read(&terms()).unwrap(),
            RecordStatus::Accepted(_)
        ));
        drop(self.guard());
    }
}

#[test]
fn existing_record_issues_bound_permit_without_ui_or_rewrite() {
    let f = Fixture::new();
    f.record(&terms());
    let before = fs::read(f.store.record_path()).unwrap();
    let permit = authorize_for_startup(&terms(), &f.store, |_| panic!("UI must be skipped"))
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(permit.consent_root(), f.root);
    assert_eq!(permit.terms(), &terms());
    let guard = permit.into_startup(&f.root, &terms()).unwrap();
    assert_eq!(guard.basis(), PassBasis::ExistingRecord);
    assert_eq!(guard.record().terms_sha256(), terms().sha256());
    guard.finish();
    f.available();
    assert_eq!(fs::read(f.store.record_path()).unwrap(), before);
}
#[test]
fn new_acceptance_issues_permit_only_after_verified_save() {
    let f = Fixture::new();
    let guard = f.guard();
    assert_eq!(guard.basis(), PassBasis::SavedAcceptance);
    assert!(matches!(
        crate::consent::parse_record(&fs::read(f.store.record_path()).unwrap(), &terms()),
        RecordStatus::Accepted(_)
    ));
    assert!(matches!(f.store.read(&terms()), Err(e) if e.kind == StorageErrorKind::Busy));
    guard.finish();
    f.available();
}
#[test]
fn decline_does_not_issue_permit_or_create_config() {
    let f = Fixture::new();
    for reason in [
        DeclineReason::Button,
        DeclineReason::WindowClose,
        DeclineReason::Escape,
    ] {
        assert!(
            matches!(authorize_for_startup(&terms(), &f.store, |_| Ok(ConsentDecision::Declined(reason))), Err(GateStop::Declined(r)) if r==reason)
        );
    }
    assert!(!f.root.join("config").exists());
}
#[test]
fn ui_error_does_not_issue_permit_or_create_config() {
    let f = Fixture::new();
    assert!(matches!(
        authorize_for_startup(&terms(), &f.store, |_| Err(NativeUiError {
            kind: UiErrorKind::DisplayVerification,
            os_error: None
        })),
        Err(GateStop::Ui(_))
    ));
    assert!(!f.root.join("config").exists());
}
#[test]
fn mismatched_ui_identity_does_not_issue_permit() {
    let f = Fixture::new();
    let other = CanonicalTerms::from_body(TermsVersion::new(900005).unwrap(), b"other").unwrap();
    assert!(matches!(
        authorize_for_startup(&terms(), &f.store, |_| accept(&other)),
        Err(GateStop::IdentityMismatch)
    ));
    assert!(!f.root.join("config").exists());
}
#[test]
fn corrupt_unknown_and_future_records_never_issue_permit() {
    for (key, value) in [
        ("schemaVersion", json!(999)),
        ("canonicalVersion", json!(999)),
        ("termsVersion", json!(900005)),
        ("state", json!("declined")),
    ] {
        let f = Fixture::new();
        let mut record = serde_json::to_value(ConsentRecord::accepted(&terms())).unwrap();
        record[key] = value;
        let bytes = serde_json::to_vec(&record).unwrap();
        f.put(&bytes);
        assert!(matches!(
            authorize_for_startup(&terms(), &f.store, |_| panic!("no UI")),
            Err(GateStop::Record(_))
        ));
        assert_eq!(fs::read(f.store.record_path()).unwrap(), bytes);
    }
    let f = Fixture::new();
    f.put(b"{bad");
    assert!(matches!(
        authorize_for_startup(&terms(), &f.store, |_| panic!("no UI")),
        Err(GateStop::Record(RecordStatus::Corrupt(_)))
    ));
    assert_eq!(fs::read(f.store.record_path()).unwrap(), b"{bad");
}
#[test]
fn writer_failure_at_each_stage_never_issues_permit() {
    for stage in [
        SaveStage::PrepareConfig,
        SaveStage::TempCreate,
        SaveStage::TempWrite,
        SaveStage::TempHalfWritten,
        SaveStage::TempSync,
        SaveStage::VerifyTemporary,
        SaveStage::BackupCreate,
        SaveStage::BackupWrite,
        SaveStage::BackupSync,
        SaveStage::Replace,
        SaveStage::AfterReplace,
        SaveStage::DestinationSync,
        SaveStage::VerifyDestination,
        SaveStage::Cleanup,
    ] {
        let f = Fixture::new();
        let old = CanonicalTerms::from_body(TermsVersion::new(900003).unwrap(), b"old").unwrap();
        f.record(&old);
        let result = authorize(&terms(), &f.store, accept, |s| {
            if s == stage {
                Err(io::Error::other("TEST ONLY fault"))
            } else {
                Ok(())
            }
        });
        assert!(matches!(result, Err(GateStop::Storage(e)) if e.stage==stage));
        assert!(!f.root.join("data").exists());
        // 保存が進んでいる段階でもlockを再取得できる。旧条件なら再同意が必要。
        drop(f.authorize());
    }
}
#[test]
fn wrong_root_consumes_and_releases_permit() {
    let f = Fixture::new();
    let other = Fixture::new();
    let permit = f.authorize();
    assert!(matches!(
        permit.into_startup(&other.root, &terms()),
        Err(PermitBindingError::RootMismatch)
    ));
    assert!(!other.root.join("config").exists());
    f.available();
}
#[test]
fn wrong_terms_version_and_hash_consume_and_release_permit() {
    let f = Fixture::new();
    for other in [
        CanonicalTerms::from_body(
            TermsVersion::new(900005).unwrap(),
            terms().text().as_bytes(),
        )
        .unwrap(),
        CanonicalTerms::from_body(TermsVersion::new(900004).unwrap(), b"different").unwrap(),
    ] {
        assert!(matches!(
            f.authorize().into_startup(&f.root, &other),
            Err(PermitBindingError::TermsMismatch)
        ));
        f.available();
    }
}
#[test]
fn permit_owns_terms_and_root_after_inputs_are_dropped() {
    let f = Fixture::new();
    let permit = {
        let t = terms();
        let store = f.store.clone();
        authorize_for_startup(&t, &store, accept).unwrap_or_else(|e| panic!("{e:?}"))
    };
    assert_eq!(permit.terms(), &terms());
    assert_eq!(permit.consent_root(), f.root);
    drop(permit);
    f.available();
}
#[test]
fn permit_and_guard_have_required_auto_traits_without_unsafe_impl() {
    fn constraints<T: Send + Sync + 'static>() {}
    constraints::<OwnedPermit>();
    constraints::<StartupGuard>();
    // TauriのSetupHookと同じFnOnce/Send/'static形状を、実Appなしでcompileする。
    fn hook(
        guard: StartupGuard,
    ) -> Box<dyn FnOnce(&mut ()) -> Result<(), Box<dyn std::error::Error>> + Send + 'static> {
        Box::new(move |_| {
            guard.finish();
            Ok(())
        })
    }
    let _ = hook;
    // 対象がClone/Copyを実装すると型推論が曖昧になりcompileが失敗する。
    trait AmbiguousIfClone<A> {
        fn check() {}
    }
    impl<T: ?Sized> AmbiguousIfClone<()> for T {}
    struct HasClone;
    impl<T: ?Sized + Clone> AmbiguousIfClone<HasClone> for T {}
    let _ = <OwnedPermit as AmbiguousIfClone<_>>::check;
    let _ = <StartupGuard as AmbiguousIfClone<_>>::check;
    trait AmbiguousIfCopy<A> {
        fn check() {}
    }
    impl<T: ?Sized> AmbiguousIfCopy<()> for T {}
    struct HasCopy;
    impl<T: ?Sized + Copy> AmbiguousIfCopy<HasCopy> for T {}
    let _ = <OwnedPermit as AmbiguousIfCopy<_>>::check;
    let _ = <StartupGuard as AmbiguousIfCopy<_>>::check;
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn child(f: &Fixture, mode: &str) -> OwnedChild {
    OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "consent::gate::owned_tests::child_owned_permit_helper",
                "--ignored",
            ])
            .env("DOL_OWNED_FIXTURE", &f.root)
            .env("DOL_OWNED_MODE", mode)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .unwrap(),
    )
}
fn wait_done(child: &mut OwnedChild) -> std::process::ExitStatus {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            return status;
        }
        assert!(Instant::now() < deadline, "child timeout");
        thread::sleep(Duration::from_millis(5));
    }
}
fn probe(f: &Fixture, busy: bool) {
    assert!(wait_done(&mut child(
        f,
        if busy { "probe-busy" } else { "probe-free" }
    ))
    .success());
}
fn await_marker(f: &Fixture, child: &mut OwnedChild, name: &str) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !f.root.join(name).exists() {
        assert!(child.0.try_wait().unwrap().is_none());
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
}

fn mock_startup(f: &Fixture, result: &str) {
    let permit = f.authorize();
    probe(f, true);
    let root = f.root.clone();
    let store = f.store.clone();
    let result = result.to_owned();
    let setup: Box<dyn FnOnce() -> Result<&'static str, ()> + Send + 'static> =
        Box::new(move || {
            let guard = permit.into_startup(&root, &terms()).unwrap();
            let local = Fixture { root, store };
            for stage in [
                "prepare",
                "build",
                "Ready-window",
                "setup",
                "State-register",
            ] {
                fs::write(local.root.join("MOCK_STAGE"), stage).unwrap();
                probe(&local, true);
            }
            fs::write(local.root.join("MOCK_RESULT"), result).unwrap();
            guard.finish();
            probe(&local, false);
            Ok("registered")
        });
    assert_eq!(thread::spawn(setup).join().unwrap(), Ok("registered"));
    // 模擬稼働が続く間もleaseは保持しない。
    probe(f, false);
    f.available();
}
#[test]
fn mock_normal_handoff_holds_until_registration_then_releases() {
    mock_startup(&Fixture::new(), "Normal");
}
#[test]
fn mock_recovery_handoff_holds_until_registration_then_releases() {
    mock_startup(&Fixture::new(), "Recovery");
}

fn early_error(stage: &str) {
    let f = Fixture::new();
    let result = (|| -> Result<(), &str> {
        let guard = f.guard();
        probe(&f, true);
        assert_eq!(guard.record().terms_sha256(), terms().sha256());
        Err(stage)
    })();
    assert_eq!(result, Err(stage));
    probe(&f, false);
    f.available();
}
#[test]
fn prepare_error_drops_guard() {
    early_error("prepare");
}
#[test]
fn build_error_drops_guard() {
    early_error("build");
}
#[test]
fn window_error_drops_guard() {
    early_error("window");
}
#[test]
fn setup_error_drops_guard() {
    early_error("setup");
}
#[test]
fn uncalled_setup_closure_drop_releases_guard() {
    let f = Fixture::new();
    let guard = f.guard();
    let setup: Box<dyn FnOnce() + Send> = Box::new(move || guard.finish());
    probe(&f, true);
    drop(setup);
    probe(&f, false);
}
#[test]
fn setup_panic_unwinds_and_releases_guard() {
    let f = Fixture::new();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = f.guard();
        probe(&f, true);
        panic!("TEST ONLY setup panic");
    }));
    assert!(result.is_err());
    probe(&f, false);
    f.available();
}
#[test]
fn normal_drop_and_explicit_finish_release_without_deleting_record() {
    let f = Fixture::new();
    let permit = f.authorize();
    probe(&f, true);
    drop(permit);
    probe(&f, false);
    let before = fs::read(f.store.record_path()).unwrap();
    f.guard().finish();
    probe(&f, false);
    assert_eq!(fs::read(f.store.record_path()).unwrap(), before);
}
#[test]
fn same_identity_written_during_ui_is_not_saved_twice() {
    let f = Fixture::new();
    let mut saved = None;
    let permit = authorize_for_startup(&terms(), &f.store, |t| {
        let guard = f.guard();
        saved = Some(fs::read(f.store.record_path()).unwrap());
        guard.finish();
        accept(t)
    })
    .unwrap_or_else(|e| panic!("{e:?}"));
    let guard = permit.into_startup(&f.root, &terms()).unwrap();
    assert_eq!(guard.basis(), PassBasis::ConcurrentAcceptance);
    guard.finish();
    assert_eq!(Some(fs::read(f.store.record_path()).unwrap()), saved);
}
#[test]
fn changed_old_identity_during_ui_does_not_issue_permit() {
    let f = Fixture::new();
    let old = CanonicalTerms::from_body(TermsVersion::new(900002).unwrap(), b"old").unwrap();
    f.record(&old);
    let other = CanonicalTerms::from_body(TermsVersion::new(900003).unwrap(), b"other").unwrap();
    assert!(
        matches!(authorize_for_startup(&terms(),&f.store,|t|{drop(f.store.save_after_explicit_acceptance(&other).unwrap());accept(t)}),Err(GateStop::Storage(e)) if e.kind==StorageErrorKind::RecordChanged)
    );
    assert!(matches!(
        f.store.read(&other).unwrap(),
        RecordStatus::Accepted(_)
    ));
}
#[test]
fn saved_permit_blocks_second_startup_until_finish() {
    let f = Fixture::new();
    let guard = f.guard();
    assert!(
        matches!(authorize_for_startup(&terms(),&f.store,|_|panic!("Busy before UI")),Err(GateStop::Storage(e)) if e.kind==StorageErrorKind::Busy)
    );
    probe(&f, true);
    guard.finish();
    probe(&f, false);
    f.available();
}

fn terminal_process(mode: &str) {
    let f = Fixture::new();
    f.record(&terms());
    let before = fs::read(f.store.record_path()).unwrap();
    let mut process = child(&f, mode);
    await_marker(&f, &mut process, "CHILD_HELD");
    probe(&f, true);
    fs::write(f.root.join("PARENT_GO"), b"TEST_ONLY").unwrap();
    let status = wait_done(&mut process);
    assert_eq!(status.success(), mode == "explicit-exit");
    assert_eq!(
        f.root.join("FINISHED_BEFORE_EXIT").exists(),
        mode == "explicit-exit"
    );
    assert!(!f.root.join("DROP_EXECUTED").exists());
    probe(&f, false);
    assert_eq!(fs::read(f.store.record_path()).unwrap(), before);
}
#[test]
fn process_exit_releases_os_handles_without_running_drop() {
    terminal_process("exit");
}
#[test]
fn abort_releases_os_handles_without_running_drop() {
    terminal_process("abort");
}
#[test]
fn explicit_release_before_exit_is_observable() {
    terminal_process("explicit-exit");
}
#[test]
fn forced_termination_releases_os_handles_without_cleanup_claim() {
    let f = Fixture::new();
    f.record(&terms());
    let mut process = child(&f, "hold");
    await_marker(&f, &mut process, "CHILD_HELD");
    probe(&f, true);
    process.0.kill().unwrap();
    assert!(!wait_done(&mut process).success());
    assert!(!f.root.join("DROP_EXECUTED").exists());
    probe(&f, false);
}
#[test]
fn fixture_sentinels_are_unchanged_and_no_real_startup_is_called() {
    let f = Fixture::new();
    let outside = Fixture::new();
    for name in ["bootstrap.json", "last-good.json", "mock-db-sentinel"] {
        fs::write(f.root.join(name), b"SYNTHETIC SENTINEL").unwrap();
    }
    fs::write(outside.root.join("OUTSIDE"), b"SYNTHETIC OUTSIDE").unwrap();
    mock_startup(&f, "Normal");
    for name in ["bootstrap.json", "last-good.json", "mock-db-sentinel"] {
        assert_eq!(fs::read(f.root.join(name)).unwrap(), b"SYNTHETIC SENTINEL");
    }
    assert_eq!(
        fs::read(outside.root.join("OUTSIDE")).unwrap(),
        b"SYNTHETIC OUTSIDE"
    );
    let lib = include_str!("../../lib.rs");
    let run = &lib[lib.find("#[cfg_attr").unwrap()..];
    assert!(!run.contains("consent"));
    assert!(!run.contains("authorize_for_startup"));
    assert!(!run.contains("900004"));
}

// 親試験が起動する補助entry。assertion件数へ含めない。
#[test]
#[ignore = "隔離子processの補助entry"]
fn child_owned_permit_helper() {
    let root = PathBuf::from(std::env::var_os("DOL_OWNED_FIXTURE").expect("explicit fixture"))
        .canonicalize()
        .unwrap();
    let base = base().canonicalize().unwrap();
    assert!(root.starts_with(&base) && root != base);
    assert_eq!(
        fs::read(root.join("TEST_ONLY.fixture")).unwrap(),
        b"TEST_ONLY"
    );
    let f = Fixture {
        store: ConsentStore::for_portable_root(&root).unwrap(),
        root,
    };
    let mode = std::env::var("DOL_OWNED_MODE").unwrap();
    if mode == "probe-busy" {
        assert!(
            matches!(authorize_for_startup(&terms(),&f.store,|_|panic!("no UI")),Err(GateStop::Storage(e)) if e.kind==StorageErrorKind::Busy)
        );
        return;
    }
    if mode == "probe-free" {
        drop(f.authorize());
        return;
    }
    struct DropProbe(PathBuf);
    impl Drop for DropProbe {
        fn drop(&mut self) {
            fs::write(self.0.join("DROP_EXECUTED"), b"TEST_ONLY").unwrap();
        }
    }
    let _drop_probe = DropProbe(f.root.clone());
    let guard = f.guard();
    fs::write(f.root.join("CHILD_HELD"), b"TEST_ONLY").unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    while !f.root.join("PARENT_GO").exists() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
    match mode.as_str() {
        "exit" => std::process::exit(23),
        "abort" => std::process::abort(),
        "explicit-exit" => {
            guard.finish();
            probe(&f, false);
            fs::write(f.root.join("FINISHED_BEFORE_EXIT"), b"TEST_ONLY").unwrap();
            std::process::exit(0);
        }
        _ => panic!("unexpected mode"),
    }
}
