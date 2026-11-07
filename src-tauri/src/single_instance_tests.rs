use super::*;
use std::{
    cell::Cell,
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::ERROR_INVALID_HANDLE,
    System::Threading::{CreateEventW, GetCurrentProcess, GetProcessHandleCount},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

fn unique_id() -> String {
    format!(
        "{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

fn test_name(id: &str) -> String {
    format!(r"Local\com.dolprogress.manager.test.{id}")
}

#[test]
fn production_name_matches_identifier_without_build_or_path_suffix() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(
        MUTEX_NAME,
        format!(
            r"Local\{}.single-instance",
            config["identifier"].as_str().unwrap()
        )
    );
}

#[test]
fn fresh_object_allows_startup_and_drop_allows_restart() {
    let name = test_name(&unique_id());
    unsafe { SetLastError(ERROR_ALREADY_EXISTS) };
    let first = InstanceGuard::acquire(&name).unwrap();
    let started = Cell::new(false);
    assert_eq!(
        run_with_name(&name, || started.set(true)),
        Err(StartupError::AlreadyRunning)
    );
    assert!(!started.get());
    drop(first);
    run_with_name(&name, || started.set(true)).unwrap();
    assert!(started.get());
    run_with_name(&name, || {}).unwrap();
}

#[test]
fn panic_unwinding_closes_the_handle() {
    let name = test_name(&unique_id());
    let result = std::panic::catch_unwind(|| {
        let _ = run_with_name(&name, || panic!("injected startup failure"));
    });
    assert!(result.is_err());
    run_with_name(&name, || {}).unwrap();
}

#[test]
fn another_object_type_causes_safe_stop_before_startup() {
    let name = test_name(&unique_id());
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    // SAFETY: 終端付きUTF-16を渡し、成功handleだけを一度所有する。
    let event = unsafe { CreateEventW(std::ptr::null(), 0, 0, wide.as_ptr()) };
    assert!(!event.is_null());
    let event = unsafe { OwnedHandle::from_raw_handle(event) };
    let started = Cell::new(false);
    assert_eq!(
        run_with_name(&name, || started.set(true)),
        Err(StartupError::CreationFailed(ERROR_INVALID_HANDLE))
    );
    assert!(!started.get());
    drop(event);
    run_with_name(&name, || {}).unwrap();
}

#[test]
fn errors_explain_duplicate_and_creation_failure() {
    assert_eq!(
        StartupError::AlreadyRunning.message(),
        "アプリケーションは既に起動しています。"
    );
    assert!(StartupError::CreationFailed(5)
        .message()
        .contains("起動を中止"));
    assert!(StartupError::CreationFailed(5).message().contains('5'));
}

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tmp/map-c6a/process-tests")
            .join(unique_id());
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("TEST_ONLY.fixture"), b"TEST_ONLY").unwrap();
        Self { root }
    }

    fn name(&self) -> String {
        test_name(self.root.file_name().unwrap().to_str().unwrap())
    }

    fn spawn(&self, id: &str, mode: &str, executable: &Path, cwd: &Path) -> OwnedChild {
        let child = Command::new(executable)
            .args(["--exact", "single_instance::tests::child_process"])
            .env("DOL_INSTANCE_TEST_ROOT", &self.root)
            .env("DOL_INSTANCE_TEST_ID", id)
            .env("DOL_INSTANCE_TEST_MODE", mode)
            .current_dir(cwd)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW: このtestが生成するchildだけ。
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        OwnedChild(child)
    }

    fn child(&self, id: &str, mode: &str) -> OwnedChild {
        self.spawn(id, mode, &std::env::current_exe().unwrap(), &self.root)
    }

    fn wait_for(&self, file: &str) {
        wait_until(|| self.root.join(file).exists());
    }

    fn release(&self) {
        fs::write(self.root.join("RELEASE"), b"TEST_ONLY").unwrap();
    }
}

struct OwnedChild(Child);

impl OwnedChild {
    fn wait(&mut self) {
        wait_until(|| self.0.try_wait().unwrap().is_some());
        assert!(self.0.wait().unwrap().success());
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        // 失敗時も、このfixtureからspawnして所有するtest childだけを終了する。
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

fn wait_until(mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !ready() {
        assert!(Instant::now() < deadline, "isolated process test timed out");
        thread::sleep(Duration::from_millis(5));
    }
}

fn handle_count() -> u32 {
    let mut count = 0;
    // SAFETY: 現在processのpseudo handleと、書込み可能なu32だけを渡す。
    assert_ne!(
        unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut count) },
        0
    );
    count
}

#[test]
fn child_process() {
    let Some(root) = std::env::var_os("DOL_INSTANCE_TEST_ROOT") else {
        return;
    };
    let root = PathBuf::from(root).canonicalize().unwrap();
    let base = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("tmp/map-c6a/process-tests")
        .canonicalize()
        .unwrap();
    assert!(root.starts_with(&base) && root != base);
    assert_eq!(
        fs::read(root.join("TEST_ONLY.fixture")).unwrap(),
        b"TEST_ONLY"
    );
    let id = std::env::var("DOL_INSTANCE_TEST_ID").unwrap();
    assert!(id.chars().all(|c| c.is_ascii_alphanumeric()));
    let mode = std::env::var("DOL_INSTANCE_TEST_MODE").unwrap();
    let name = test_name(root.file_name().unwrap().to_str().unwrap());
    if mode == "leak" {
        drop(InstanceGuard::acquire(&name).unwrap());
        let before = handle_count();
        for _ in 0..2000 {
            let first = InstanceGuard::acquire(&name).unwrap();
            assert!(matches!(
                InstanceGuard::acquire(&name),
                Err(StartupError::AlreadyRunning)
            ));
            drop(first);
        }
        let after = handle_count();
        assert!(
            after <= before + 2,
            "handle count grew: {before} -> {after}"
        );
        fs::write(
            root.join(format!("{id}.handles")),
            format!("{before} {after}"),
        )
        .unwrap();
        return;
    }
    if mode == "race" {
        fs::write(root.join(format!("{id}.ready")), b"TEST_ONLY").unwrap();
        wait_until(|| root.join("START").exists());
    }
    let result = run_with_name(&name, || {
        // 本物のrun()の代わりのcontinuation。Runtime検出以降へ進んだ印を
        // 専用fixtureだけに残す。既存のconfig/Data RootやDBは解決しない。
        let startup = root.join(format!("{id}.startup"));
        fs::create_dir(&startup).unwrap();
        for stage in [
            "runtime",
            "consent",
            "data-root",
            "db-initialize",
            "migration",
        ] {
            fs::write(startup.join(stage), b"TEST_ONLY").unwrap();
        }
        fs::write(root.join(format!("{id}.started")), b"TEST_ONLY").unwrap();
        wait_until(|| root.join("RELEASE").exists());
    });
    match result {
        Ok(()) => {}
        Err(StartupError::AlreadyRunning) => {
            assert!(!root.join(format!("{id}.startup")).exists());
            fs::write(root.join(format!("{id}.blocked")), b"TEST_ONLY").unwrap();
        }
        Err(error) => panic!("unexpected startup error: {error:?}"),
    }
}

#[test]
fn other_process_is_blocked_without_entering_startup_then_normal_exit_allows_restart() {
    let f = Fixture::new();
    let mut first = f.child("first", "hold");
    f.wait_for("first.started");
    let mut second = f.child("second", "hold");
    second.wait();
    f.wait_for("second.blocked");
    assert!(!f.root.join("second.startup").exists());
    f.release();
    first.wait();
    f.child("restart", "hold").wait();
    f.wait_for("restart.started");
}

#[test]
fn near_simultaneous_processes_allow_exactly_one_startup() {
    let f = Fixture::new();
    let mut children: Vec<_> = (0..8).map(|n| f.child(&format!("p{n}"), "race")).collect();
    for n in 0..8 {
        f.wait_for(&format!("p{n}.ready"));
    }
    fs::write(f.root.join("START"), b"TEST_ONLY").unwrap();
    let count = |suffix: &str| {
        (0..8)
            .filter(|n| f.root.join(format!("p{n}.{suffix}")).exists())
            .count()
    };
    wait_until(|| count("started") + count("blocked") == 8);
    assert_eq!(count("started"), 1);
    assert_eq!(count("blocked"), 7);
    f.release();
    for child in &mut children {
        child.wait();
    }
}

#[test]
fn forced_exit_of_owned_test_process_does_not_leave_a_mutex() {
    let f = Fixture::new();
    let mut first = f.child("terminated", "hold");
    f.wait_for("terminated.started");
    first.0.kill().unwrap();
    first.0.wait().unwrap();
    f.release();
    f.child("restart", "hold").wait();
    f.wait_for("restart.started");
}

#[test]
fn copied_test_executables_in_separate_portable_directories_and_cwds_share_the_mutex() {
    let f = Fixture::new();
    let a = f.root.join("portable-a");
    let b = f.root.join("portable-b");
    fs::create_dir(&a).unwrap();
    fs::create_dir(&b).unwrap();
    let executable = std::env::current_exe().unwrap();
    let first_exe = a.join("test-app.exe");
    let second_exe = b.join("test-app.exe");
    fs::copy(&executable, &first_exe).unwrap();
    fs::copy(&executable, &second_exe).unwrap();
    let mut first = f.spawn("first", "hold", &first_exe, &a);
    f.wait_for("first.started");
    let mut second = f.spawn("second", "hold", &second_exe, &b);
    second.wait();
    f.wait_for("second.blocked");
    assert!(!f.root.join("second.startup").exists());
    f.release();
    first.wait();
}

#[test]
fn primary_and_duplicate_handles_do_not_accumulate() {
    let f = Fixture::new();
    f.child("leak", "leak").wait();
    f.wait_for("leak.handles");
    // child終了後にも同じ名前で起動できることを確認する。
    run_with_name(&f.name(), || {}).unwrap();
}
