//! TEST ONLY。feature専用entryから実startupを呼び、通常runには接続しない。
use crate::{
    active_database::{ActiveDatabase, DATABASE_FILE_NAME},
    consent::{
        gate::{self, GateStop},
        harness::{driver, Fixture},
        native_ui::{show_consent, ConsentDecision, DeclineReason, NativeUiError, UiErrorKind},
        CanonicalTerms, ConsentStore, TermsVersion,
    },
    data_root::{self, StartupFailure, StartupPresentation, StartupState},
    portable_paths::PortablePaths,
    runtime_preflight,
};
use serde::Serialize;
use std::{
    fs,
    io::{Seek, SeekFrom, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{Manager, RunEvent};

const CASES: &[&str] = &[
    "normal",
    "existing",
    "retained_default",
    "recovery",
    "custom",
    "decline",
    "decline_existing",
    "record_mismatch",
    "ui_error",
    "corrupt",
    "future",
    "save_failure",
    "busy",
    "identity",
    "prepare_failure",
    "build_failure",
    "setup_failure",
    "initialize_failure",
    "unwind",
    "process_exit",
];
fn terms() -> CanonicalTerms {
    CanonicalTerms::from_body(TermsVersion::new(900005).unwrap(), "TEST ONLY — 実startup隔離検証用の合成条件です。正式な利用条件ではありません。\n明示同意後、専用の一時fixtureだけに記録を保存します。\n実アプリのDB・config・backupは使用しません。\n".as_bytes()).unwrap()
}
#[derive(Default, Serialize)]
struct Evidence {
    case: String,
    preflight: bool,
    fixture_id: String,
    ui: u32,
    prepare: u32,
    builder: u32,
    initialize: u32,
    state: String,
    root_mode: String,
    udf_files: usize,
    gate_files_preserved: bool,
    fixture_setup_db: bool,
    basis: String,
    outcome: String,
    marks: Vec<String>,
    progress: Vec<i64>,
}
struct Log {
    file: Mutex<fs::File>,
    data: Mutex<Evidence>,
}
impl Log {
    fn update(&self, f: impl FnOnce(&mut Evidence)) {
        let mut data = self.data.lock().unwrap();
        f(&mut data);
        let mut file = self.file.lock().unwrap();
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.set_len(0))
            .and_then(|_| file.write_all(&serde_json::to_vec_pretty(&*data).unwrap()))
            .and_then(|_| file.sync_all())
            .expect("owned audit log write");
    }
}
fn automated_ui(t: &CanonicalTerms, accept: bool) -> Result<ConsentDecision, NativeUiError> {
    let worker = std::thread::spawn(move || driver::operate(accept));
    let out = show_consent(t);
    let driven = worker.join().map_err(|_| NativeUiError {
        kind: UiErrorKind::ThreadPanic,
        os_error: None,
    })?;
    driven.map_err(|_| NativeUiError {
        kind: UiErrorKind::MessageLoop,
        os_error: None,
    })?;
    out
}
fn probe(id: &str, busy: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let status = Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
        .args(["--probe", id])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("probe child spawn: {e}"))?;
    let expected = if busy { 10 } else { 0 };
    if status.code() != Some(expected) {
        return Err(format!(
            "probe child code {:?}, expected {expected}",
            status.code()
        ));
    }
    Ok(())
}
fn observe(log: &Log, id: &str, stage: &str, busy: bool) -> Result<(), String> {
    probe(id, busy)?;
    log.update(|d| {
        d.marks.push(format!(
            "{stage}:{}",
            if busy { "Busy" } else { "Available" }
        ))
    });
    Ok(())
}
fn close_database(db: &ActiveDatabase) {
    tauri::async_runtime::block_on(async { db.pool().await.close().await });
}
fn seed_database(root: &Path) -> Result<(), String> {
    let paths = PortablePaths::from_executable(&root.join("TEST_ONLY.exe"))?;
    let plan = data_root::prepare_startup(paths)?;
    let (db, _) = tauri::async_runtime::block_on(data_root::initialize(plan))
        .map_err(|_| "synthetic DB provisioning failure")?;
    let result = tauri::async_runtime::block_on(async {
        let pool = db.pool().await;
        sqlx::raw_sql("INSERT INTO profiles(id,name) VALUES(1,'TEST ONLY'); INSERT INTO quests(id,gvdb_id,title,raw_row_json) VALUES(1,1,'TEST ONLY','{}'); INSERT INTO discoveries(id,gvdb_id,name,raw_row_json) VALUES(1,1,'TEST ONLY','{}'); INSERT INTO quest_progress(profile_id,quest_id) VALUES(1,1); INSERT INTO discovery_progress(profile_id,discovery_id,reported,card_owned) VALUES(1,1,0,1);").execute(&*pool).await.map_err(|_| "synthetic data seed failure".to_owned())
    });
    close_database(&db);
    result.map(|_| ())
}
fn progress(db: &ActiveDatabase) -> Result<Vec<i64>, String> {
    tauri::async_runtime::block_on(async {
        let pool = db.pool().await;
        let mut counts = Vec::new();
        for query in [
            "SELECT count(*) FROM profiles",
            "SELECT count(*) FROM quest_progress",
            "SELECT count(*) FROM discovery_progress",
        ] {
            counts.push(
                sqlx::query_scalar::<_, i64>(query)
                    .fetch_one(&*pool)
                    .await
                    .map_err(|_| "progress query error")?,
            );
        }
        Ok(counts)
    })
}
pub fn run_cli() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [flag, id] if flag == "--probe" => {
            let fixture = Fixture::resume("startup", id)?;
            let store =
                ConsentStore::for_portable_root(fixture.root()).map_err(|e| e.to_string())?;
            match gate::authorize_for_startup(&terms(), &store, |_| {
                Err(NativeUiError {
                    kind: UiErrorKind::InvalidInput,
                    os_error: None,
                })
            }) {
                Ok(permit) => {
                    drop(permit);
                    Ok(())
                }
                Err(GateStop::Storage(error))
                    if error.kind == crate::consent::StorageErrorKind::Busy =>
                {
                    std::process::exit(10)
                }
                Err(_) => Err("probe consent not valid".into()),
            }
        }
        [flag, case] if flag == "--scenario" => scenario(case, None),
        [flag, case, resume, id] if flag == "--scenario" && resume == "--resume" => {
            scenario(case, Some(id))
        }
        _ => Err("--scenario <case> [--resume <fixture-ID>] / --probe <fixture-ID>".into()),
    }
}
fn scenario(case: &str, resume: Option<&str>) -> Result<(), String> {
    if !CASES.contains(&case) || (case == "existing") != resume.is_some() {
        return Err("case/resume不一致".into());
    }
    // このmarker検証とancestor pinが成功するまで、preflight/startupを呼ばない。
    let fixture = match resume {
        Some(id) => Fixture::resume("startup", id)?,
        None => Fixture::new("startup")?,
    };
    let root = fixture.root().to_owned();
    let id = fixture.id().to_owned();
    println!("fixture ID: {id}");
    let mut tree_pins = crate::consent::harness::pin_tree(&root)?;
    runtime_preflight::before_portable_startup(|| ())
        .map_err(|_| "WebView2 preflight unavailable")?;
    let paths = PortablePaths::from_executable(&root.join("TEST_ONLY.exe"))?;
    let audit_name = format!(
        "TEST_ONLY.result-{}.json",
        crate::portable_paths::unique_suffix()
    );
    println!("audit name: {audit_name}");
    let log = Arc::new(Log {
        file: Mutex::new(
            fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(root.join(audit_name))
                .map_err(|e| e.to_string())?,
        ),
        data: Mutex::new(Evidence {
            case: case.into(),
            preflight: true,
            fixture_id: id.clone(),
            ..Default::default()
        }),
    });
    let bundle = terms();
    let store = ConsentStore::for_portable_root(&root).map_err(|e| e.to_string())?;
    if resume.is_none() {
        let mut sentinel = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(root.join("KEEP.sentinel"))
            .map_err(|e| e.to_string())?;
        sentinel
            .write_all(b"TEST ONLY sentinel")
            .map_err(|e| e.to_string())?;
    } else if fs::read(root.join("KEEP.sentinel")).map_err(|e| e.to_string())?
        != b"TEST ONLY sentinel"
    {
        return Err("fixture sentinel不一致".into());
    }
    let mut custom_fixture = None;
    let mut held_lease = None;
    let seed_record = matches!(
        case,
        "recovery"
            | "record_mismatch"
            | "retained_default"
            | "custom"
            | "busy"
            | "prepare_failure"
            | "build_failure"
            | "setup_failure"
            | "initialize_failure"
            | "unwind"
            | "process_exit"
    );
    if seed_record {
        let seed_terms = if case == "record_mismatch" {
            CanonicalTerms::from_body(bundle.version(), b"TEST ONLY previous body identity")
                .unwrap()
        } else {
            bundle.clone()
        };
        drop(
            store
                .save_after_explicit_acceptance(&seed_terms)
                .map_err(|e| e.to_string())?,
        );
    }
    if case == "retained_default" {
        seed_database(&root)?;
        log.update(|d| d.fixture_setup_db = true);
    }
    if case == "decline_existing" {
        seed_database(&root)?;
        log.update(|d| d.fixture_setup_db = true);
    }
    if case == "record_mismatch" {
        assert_eq!(
            store.read(&bundle).unwrap(),
            crate::consent::RecordStatus::HashMismatch
        );
        log.update(|d| d.marks.push("initial-record:HashMismatch".into()));
    }
    if case == "recovery" {
        fs::write(
            root.join("config/data-root.json"),
            b"TEST ONLY invalid bootstrap",
        )
        .map_err(|e| e.to_string())?;
    }
    if case == "custom" {
        let other = Fixture::new("startup")?;
        seed_database(other.root())?;
        log.update(|d| d.fixture_setup_db = true);
        let custom = other.root().join("data");
        fs::write(root.join("config/data-root.json"), serde_json::to_vec(&serde_json::json!({"version":1,"mode":"custom","dataRoot":custom,"state":"committed"})).unwrap()).map_err(|e| e.to_string())?;
        fs::create_dir(root.join("data")).map_err(|e| e.to_string())?;
        fs::write(
            root.join("data").join(DATABASE_FILE_NAME),
            b"TEST ONLY non-selected DB sentinel",
        )
        .map_err(|e| e.to_string())?;
        custom_fixture = Some(other);
    }
    if matches!(case, "corrupt" | "future") {
        fs::create_dir(root.join("config")).map_err(|e| e.to_string())?;
        let bytes = if case == "corrupt" {
            b"TEST ONLY corrupt".to_vec()
        } else {
            serde_json::to_vec(&serde_json::json!({"schemaVersion":99,"canonicalVersion":1,"termsVersion":900005,"termsSha256":bundle.sha256(),"state":"accepted"})).unwrap()
        };
        fs::write(store.record_path(), bytes).map_err(|e| e.to_string())?;
    }
    if case == "busy" {
        held_lease = Some(
            store
                .lock_verified_record(&bundle)
                .map_err(|e| e.to_string())?,
        );
    }
    let before_record = fs::read(store.record_path()).ok();
    let before_files = if matches!(
        case,
        "decline"
            | "decline_existing"
            | "record_mismatch"
            | "ui_error"
            | "corrupt"
            | "future"
            | "save_failure"
            | "busy"
            | "identity"
    ) {
        file_snapshot(&root)?
    } else {
        Default::default()
    };
    let case_owned = case.to_owned();
    let permit = gate::authorize_for_startup(&bundle, &store, |t| {
        log.update(|d| d.ui += 1);
        match case {
            "ui_error" => Err(NativeUiError {
                kind: UiErrorKind::CreateDialog,
                os_error: Some(8),
            }),
            "identity" => automated_ui(
                &CanonicalTerms::from_body(t.version(), b"TEST ONLY different identity").unwrap(),
                true,
            ),
            "decline" | "decline_existing" | "record_mismatch" => automated_ui(t, false),
            "save_failure" => {
                let decision = automated_ui(t, true)?;
                fs::write(root.join("config"), b"TEST ONLY save obstruction")
                    .expect("owned save fault fixture");
                Ok(decision)
            }
            _ => automated_ui(t, true),
        }
    });
    let permit = match permit {
        Err(stop) => {
            let matches_case = match (&stop, case) {
                (GateStop::Declined(DeclineReason::Button), "decline")
                | (GateStop::Declined(DeclineReason::Button), "decline_existing")
                | (GateStop::Declined(DeclineReason::Button), "record_mismatch")
                | (GateStop::Ui(_), "ui_error")
                | (GateStop::IdentityMismatch, "identity") => true,
                (GateStop::Record(crate::consent::RecordStatus::Corrupt(_)), "corrupt")
                | (
                    GateStop::Record(crate::consent::RecordStatus::UnsupportedSchema {
                        version: 99,
                    }),
                    "future",
                ) => true,
                (GateStop::Storage(e), "busy") => e.kind == crate::consent::StorageErrorKind::Busy,
                (GateStop::Storage(_), "save_failure") => true,
                _ => false,
            };
            if !matches_case {
                return Err(format!("unexpected gate stop {stop:?}"));
            }
            assert!(!root.join("webview").exists());
            if case != "decline_existing" {
                assert!(!root.join("data").exists());
            }
            assert_eq!(fs::read(store.record_path()).ok(), before_record);
            if case != "save_failure" {
                assert_eq!(file_snapshot(&root)?, before_files);
                log.update(|d| d.gate_files_preserved = true);
            } else {
                let mut after = file_snapshot(&root)?;
                after.remove("config");
                assert_eq!(after, before_files);
                assert_eq!(
                    fs::read(root.join("config")).unwrap(),
                    b"TEST ONLY save obstruction"
                );
            }
            log.update(|d| d.outcome = format!("gate-stop:{stop:?}"));
            drop(held_lease);
            return Ok(());
        }
        Ok(permit) => permit,
    };
    let guard = permit
        .into_startup(&root, &bundle)
        .map_err(|e| format!("permit binding: {e:?}"))?;
    log.update(|d| d.basis = format!("{:?}", guard.basis()));
    assert_eq!(guard.record().terms_sha256(), bundle.sha256());
    observe(&log, &id, "authorized", true)?;
    if case == "unwind" {
        let unwind = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = guard;
            panic!("TEST ONLY pre-builder unwind");
        }));
        assert!(unwind.is_err());
        observe(&log, &id, "after-unwind", false)?;
        log.update(|d| d.outcome = "pre-builder-unwind".into());
        return Ok(());
    }
    if case == "prepare_failure" {
        fs::write(root.join("data"), b"TEST ONLY prepare obstruction")
            .map_err(|e| e.to_string())?;
    }
    tree_pins.extend(crate::consent::harness::pin_tree(&root)?);
    let custom_path = custom_fixture.as_ref().map(|f| f.root().join("data"));
    validate_bootstrap_scope(&root, custom_path.as_deref(), case == "recovery")?;
    if let Some(custom) = &custom_fixture {
        tree_pins.extend(crate::consent::harness::pin_tree(custom.root())?);
    }
    log.update(|d| d.prepare += 1);
    let prepared = data_root::prepare_startup(paths.clone()).map(|plan| (paths, plan));
    let (paths, plan) = match prepared {
        Ok(value) => value,
        Err(_) if case == "prepare_failure" => {
            drop(guard);
            observe(&log, &id, "after-prepare-error", false)?;
            log.update(|d| d.outcome = "prepare-error".into());
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    observe(&log, &id, "prepared", true)?;
    if case == "initialize_failure" {
        fs::create_dir(paths.default_database_path()).map_err(|e| e.to_string())?;
    }
    let udf = root.join("webview");
    fs::create_dir(&udf)
        .or_else(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                Ok(())
            } else {
                Err(e)
            }
        })
        .map_err(|e| e.to_string())?;
    // 新規root、又は再開前の検査済みtreeだけにWebViewを接続する。
    tree_pins.extend(crate::consent::harness::pin_tree(&root)?);
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "local.dol-progress.test-only-startup".into();
    context.config_mut().app.windows.clear();
    context.config_mut().app.security.capabilities.clear();
    let plugin_log = log.clone();
    let plugin_id = id.clone();
    let plugin_case = case.to_owned();
    // Builderではleaseを観測する。Windows window生成はReady後のsetupで行う。
    let plugin = tauri::plugin::Builder::<tauri::Wry>::new("test-only-window")
        .setup(move |app, _| {
            observe(&plugin_log, &plugin_id, "builder-plugin", true)
                .map_err(std::io::Error::other)?;
            if plugin_case == "build_failure" {
                return Err(std::io::Error::other("TEST ONLY builder plugin failure").into());
            }
            let _ = app;
            Ok(())
        })
        .build();
    let setup_log = log.clone();
    let setup_id = id.clone();
    let expected_database = custom_path
        .map(|p| p.join(DATABASE_FILE_NAME))
        .unwrap_or_else(|| paths.default_database_path());
    log.update(|d| d.builder += 1);
    let built = tauri::Builder::default()
        .manage(paths)
        .plugin(plugin)
        .setup(move |app| {
            let work = (|| -> Result<(), String> {
                observe(&setup_log, &setup_id, "ready-user-setup", true)?;
                tauri::WebviewWindowBuilder::new(
                    app,
                    "test-only",
                    tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                )
                .title("TEST ONLY isolated startup")
                .visible(false)
                .data_directory(udf)
                .build()
                .map_err(|_| "isolated window construction error")?;
                observe(&setup_log, &setup_id, "window-created", true)?;
                if app.get_webview_window("test-only").is_none() {
                    return Err("isolated window missing".into());
                }
                if case_owned == "setup_failure" {
                    return Err("TEST ONLY setup failure".into());
                }
                if case_owned == "process_exit" {
                    setup_log.update(|d| d.outcome = "process-exit-held-lease".into());
                    std::process::exit(25);
                }
                setup_log.update(|d| d.initialize += 1);
                match tauri::async_runtime::block_on(data_root::initialize(plan)) {
                    Ok((db, info)) => {
                        if db.database_path() != expected_database {
                            close_database(&db);
                            return Err("database scope mismatch".into());
                        }
                        let counts = progress(&db)?;
                        if matches!(case_owned.as_str(), "custom" | "retained_default")
                            && counts != vec![1, 1, 1]
                        {
                            close_database(&db);
                            return Err("custom synthetic progress mismatch".into());
                        }
                        let mode = serde_json::to_value(&info)
                            .map_err(|_| "root info serialization")?["mode"]
                            .as_str()
                            .ok_or("root mode missing")?
                            .to_owned();
                        if !app.manage(db)
                            || !app
                                .manage(StartupState(Mutex::new(StartupPresentation::Normal(info))))
                        {
                            return Err("Normal state registration error".into());
                        }
                        setup_log.update(|d| {
                            d.state = "Normal".into();
                            d.root_mode = mode;
                            d.progress = counts;
                        });
                    }
                    Err(StartupFailure::Recovery(info)) => {
                        if !app.manage(StartupState(Mutex::new(StartupPresentation::Recovery(
                            info,
                        )))) {
                            return Err("Recovery state registration error".into());
                        }
                        setup_log.update(|d| d.state = "Recovery".into());
                    }
                    Err(StartupFailure::Filesystem(_)) => {
                        return Err("initialize-filesystem-error".into())
                    }
                }
                observe(&setup_log, &setup_id, "state-registered", true)?;
                Ok(())
            })();
            // Err返却がTauri内部panicとなる場合も、FFIに到達する前に明示解放・証拠保存。
            guard.finish();
            observe(&setup_log, &setup_id, "after-setup-release", false)
                .map_err(std::io::Error::other)?;
            if let Err(error) = work {
                setup_log.update(|d| d.outcome = error.clone());
                return Err(std::io::Error::other(error).into());
            }
            Ok(())
        })
        .build(context);
    let app = match built {
        Ok(app) => app,
        Err(_) if case == "build_failure" => {
            observe(&log, &id, "after-build-error", false)?;
            log.update(|d| d.outcome = "build-error".into());
            return Ok(());
        }
        Err(error) => return Err(format!("real Tauri build: {error}")),
    };
    observe(&log, &id, "built-before-ready", true)?;
    let event_log = log.clone();
    let event_id = id.clone();
    let code = app.run_return(move |app, event| {
        if let RunEvent::Ready = event {
            // setup終了後もevent loopが稼働中の時点で再取得を確認する。
            observe(&event_log, &event_id, "event-loop-ready", false).expect("event-loop probe");
            let state = app.state::<StartupState>();
            let state = state.0.lock().unwrap();
            assert!(matches!(
                &*state,
                StartupPresentation::Normal(_) | StartupPresentation::Recovery(_)
            ));
            if let Some(db) = app.try_state::<ActiveDatabase>() {
                close_database(&db);
            }
            event_log.update(|d| d.outcome = "startup-complete".into());
            app.exit(0);
        }
    });
    if code != 0 {
        return Err(format!("event loop exit {code}"));
    }
    let udf_files = fs::read_dir(root.join("webview"))
        .map_err(|e| e.to_string())?
        .count();
    if udf_files == 0 {
        return Err("isolated UDF files not observed".into());
    }
    log.update(|d| d.udf_files = udf_files);
    assert_eq!(
        fs::read(root.join("KEEP.sentinel")).unwrap(),
        b"TEST ONLY sentinel"
    );
    if case == "custom" {
        assert_eq!(
            fs::read(root.join("data").join(DATABASE_FILE_NAME)).unwrap(),
            b"TEST ONLY non-selected DB sentinel"
        );
    }
    if case == "recovery" {
        assert!(!root.join("data").join(DATABASE_FILE_NAME).exists());
        assert_eq!(
            fs::read(root.join("config/data-root.json")).unwrap(),
            b"TEST ONLY invalid bootstrap"
        );
    }
    if case == "existing" {
        assert_eq!(fs::read(store.record_path()).ok(), before_record);
    }
    drop(custom_fixture);
    Ok(())
}
fn file_snapshot(root: &Path) -> Result<std::collections::BTreeMap<String, String>, String> {
    use sha2::{Digest, Sha256};
    fn walk(
        base: &Path,
        path: &Path,
        result: &mut std::collections::BTreeMap<String, String>,
    ) -> Result<(), String> {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let md = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if md.is_dir() {
                walk(base, &path, result)?;
            } else {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or("snapshot filename")?;
                if name.starts_with("TEST_ONLY.result-") || name == "consent-startup.lock" {
                    continue;
                }
                let relative = path
                    .strip_prefix(base)
                    .map_err(|_| "snapshot scope")?
                    .to_string_lossy()
                    .replace('\\', "/");
                result.insert(
                    relative,
                    format!(
                        "{:x}",
                        Sha256::digest(fs::read(path).map_err(|e| e.to_string())?)
                    ),
                );
            }
        }
        Ok(())
    }
    let mut result = std::collections::BTreeMap::new();
    walk(root, root, &mut result)?;
    Ok(result)
}
fn validate_bootstrap_scope(
    root: &Path,
    custom: Option<&Path>,
    recovery: bool,
) -> Result<(), String> {
    fn locator(value: &serde_json::Value, custom: Option<&Path>) -> bool {
        match value.get("mode").and_then(serde_json::Value::as_str) {
            Some("default") => value.get("dataRoot").is_none_or(serde_json::Value::is_null),
            Some("custom") => value
                .get("dataRoot")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|v| custom == Some(Path::new(v))),
            _ => false,
        }
    }
    for name in ["data-root.json", "data-root.last-good.json"] {
        let path = root.join("config").join(name);
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("bootstrap scope read failure".into()),
        };
        if recovery && name == "data-root.json" && bytes == b"TEST ONLY invalid bootstrap" {
            continue;
        }
        if bytes.len() > 65536 {
            return Err("bootstrap scope size limit".into());
        }
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| "bootstrap scope JSON failure")?;
        if !locator(&value, custom)
            || value
                .get("previous")
                .is_some_and(|p| !p.is_null() && !locator(p, custom))
        {
            return Err("fixture外のData Root指定を拒否（startup未実行）".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_validator_rejects_unowned_custom_before_resolver() {
        let root = std::env::temp_dir().join(format!(
            "dol-startup-scope-{}",
            crate::portable_paths::unique_suffix()
        ));
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(
            root.join("config/data-root.json"),
            br#"{"mode":"custom","dataRoot":"C:\\NOT_OWNED"}"#,
        )
        .unwrap();
        assert!(validate_bootstrap_scope(&root, None, false).is_err());
        fs::write(
            root.join("config/data-root.json"),
            br#"{"mode":"default","previous":{"mode":"custom","dataRoot":"C:\\NOT_OWNED"}}"#,
        )
        .unwrap();
        assert!(validate_bootstrap_scope(&root, None, false).is_err());
        fs::write(root.join("config/data-root.json"), br#"{"mode":"default"}"#).unwrap();
        assert!(validate_bootstrap_scope(&root, None, false).is_ok());
        // このtest自身が作成したrootだけを後始末する。
        fs::remove_dir_all(root).unwrap();
    }
}
