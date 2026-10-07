use std::{
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::active_database::DATABASE_FILE_NAME;

static UNIQUE_ID: AtomicU64 = AtomicU64::new(0);
pub(crate) const BOOTSTRAP_FILE_NAME: &str = "data-root.json";
pub(crate) const LAST_GOOD_FILE_NAME: &str = "data-root.last-good.json";

#[derive(Clone, Debug)]
pub(crate) struct PortablePaths {
    pub(crate) executable_root: PathBuf,
    pub(crate) default_data_root: PathBuf,
    pub(crate) config_root: PathBuf,
}

impl PortablePaths {
    pub(crate) fn current() -> Result<Self, String> {
        Self::from_executable_result(std::env::current_exe())
    }

    fn from_executable_result(executable: io::Result<PathBuf>) -> Result<Self, String> {
        Self::from_executable(&executable.map_err(|error| error.to_string())?)
    }

    pub(crate) fn from_executable(executable: &Path) -> Result<Self, String> {
        if !executable.is_absolute()
            || !matches!(
                executable.components().next_back(),
                Some(Component::Normal(_))
            )
            || executable
                .components()
                .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        {
            return Err("実行ファイルの絶対パスを確認できません。".into());
        }
        let executable_root = executable
            .parent()
            .filter(|parent| parent.parent().is_some())
            .ok_or("実行ファイルの通常の親ディレクトリを確認できません。")?
            .to_path_buf();
        Ok(Self {
            default_data_root: executable_root.join("data"),
            config_root: executable_root.join("config"),
            executable_root,
        })
    }

    pub(crate) fn default_database_path(&self) -> PathBuf {
        self.default_data_root.join(DATABASE_FILE_NAME)
    }

    pub(crate) fn primary_bootstrap_path(&self) -> PathBuf {
        self.config_root.join(BOOTSTRAP_FILE_NAME)
    }

    pub(crate) fn last_good_bootstrap_path(&self) -> PathBuf {
        self.config_root.join(LAST_GOOD_FILE_NAME)
    }
}

pub(crate) fn unique_suffix() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_nanos());
    format!(
        "{now}-{}-{}",
        std::process::id(),
        UNIQUE_ID.fetch_add(1, Ordering::Relaxed)
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProbeStage {
    Create,
    Write,
    Flush,
    Sync,
    Rename,
    Delete,
    Cleanup,
}

pub(crate) fn validate_directory_writable(root: &Path) -> Result<(), String> {
    probe_with(root, |_| Ok(()))
}

fn probe_with(root: &Path, before: impl Fn(ProbeStage) -> io::Result<()>) -> Result<(), String> {
    let probe = root.join(format!(".dol-progress-write-probe-{}", unique_suffix()));
    let renamed = probe.with_extension("renamed");
    let mut owned: Option<PathBuf> = None;
    let mut file = None;
    let mut stage = ProbeStage::Create;
    let result = (|| -> io::Result<()> {
        before(stage)?;
        file = Some(
            fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&probe)?,
        );
        owned = Some(probe.clone());
        stage = ProbeStage::Write;
        before(stage)?;
        file.as_mut().unwrap().write_all(b"DOL write probe")?;
        stage = ProbeStage::Flush;
        before(stage)?;
        file.as_mut().unwrap().flush()?;
        stage = ProbeStage::Sync;
        before(stage)?;
        file.as_mut().unwrap().sync_all()?;
        drop(file.take());
        stage = ProbeStage::Rename;
        before(stage)?;
        rename_probe(&probe, &renamed)?;
        owned = Some(renamed.clone());
        stage = ProbeStage::Delete;
        before(stage)?;
        fs::remove_file(&renamed)?;
        owned = None;
        Ok(())
    })();
    drop(file);
    match result {
        Ok(()) => Ok(()),
        Err(primary) => {
            let cleanup = owned.as_ref().and_then(|path| {
                before(ProbeStage::Cleanup)
                    .and_then(|_| fs::remove_file(path))
                    .err()
            });
            Err(format!(
                "書き込み検査に失敗しました（{stage:?}）: {primary}{}",
                cleanup
                    .map(|error| format!(
                        "; cleanup失敗: {error}; 残存file: {}",
                        owned.unwrap().display()
                    ))
                    .unwrap_or_default()
            ))
        }
    }
}

// Windows rename must not replace a pre-existing file, even in a name collision.
#[cfg(windows)]
fn rename_probe(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0) } == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn rename_probe(source: &Path, target: &Path) -> io::Result<()> {
    // Portable tests on other hosts also avoid overwrite; Windows uses native rename.
    fs::hard_link(source, target)?;
    fs::remove_file(source)
}

fn fatal_message(detail: &str) -> String {
    format!("DOL Progress Manager の保存場所を準備できません。\n\nデータまたは設定のフォルダーへ書き込みできない可能性があります。ZIPを展開し、アプリのフォルダー全体を書き込み可能な場所へ移動してから起動してください。\n\nAppDataへ自動で切り替えることはありません。管理者権限やACLの変更は不要です。\n\n理由: {detail}")
}

pub(crate) fn exit_with_filesystem_error(detail: &str) -> ! {
    let message = fatal_message(detail);
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "DOL Progress Manager"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    #[cfg(not(windows))]
    eprintln!("{message}");
    std::process::exit(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injected_executable_resolves_unicode_spaces_and_errors_without_cwd() {
        let base = std::env::temp_dir().join("DOL 日本語 folder");
        let paths = PortablePaths::from_executable(&base.join("app.exe")).unwrap();
        assert_eq!(paths.executable_root, base);
        assert_eq!(
            paths.default_database_path(),
            base.join("data").join(DATABASE_FILE_NAME)
        );
        assert_eq!(
            paths.primary_bootstrap_path(),
            base.join("config").join(BOOTSTRAP_FILE_NAME)
        );
        assert_eq!(
            paths.last_good_bootstrap_path(),
            base.join("config").join(LAST_GOOD_FILE_NAME)
        );
        assert!(PortablePaths::from_executable(Path::new("app.exe")).is_err());
        assert!(PortablePaths::from_executable(Path::new("/")).is_err());
        assert!(PortablePaths::from_executable_result(Err(io::Error::other(
            "injected current_exe failure"
        )))
        .is_err());
    }

    #[test]
    fn probe_failures_cleanup_owned_files_and_report_both_errors() {
        let root = std::env::temp_dir().join(format!("dol-probe-{}", unique_suffix()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("keep.txt"), b"keep").unwrap();
        for fault in [
            ProbeStage::Create,
            ProbeStage::Write,
            ProbeStage::Flush,
            ProbeStage::Sync,
            ProbeStage::Rename,
            ProbeStage::Delete,
        ] {
            let error = probe_with(&root, |stage| {
                if stage == fault {
                    Err(io::Error::other("injected"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
            assert!(error.contains(&format!("{fault:?}")));
            assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        }
        let error = probe_with(&root, |stage| {
            if matches!(stage, ProbeStage::Write | ProbeStage::Cleanup) {
                Err(io::Error::other("injected"))
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert!(error.contains("Write") && error.contains("cleanup失敗"));
        assert_eq!(fs::read(root.join("keep.txt")).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_error_text_explains_portable_writeability_without_fallback() {
        let message = fatal_message("config denied");
        for required in [
            "DOL Progress Manager",
            "書き込み",
            "ZIP",
            "フォルダー全体",
            "AppData",
            "config denied",
        ] {
            assert!(message.contains(required));
        }
    }

    #[test]
    fn executable_resolution_is_cwd_independent() {
        const CASE_EXE: &str = "DOL_PORTABLE_CWD_TEST_EXE";
        if let Some(executable) = std::env::var_os(CASE_EXE) {
            let executable = PathBuf::from(executable);
            let paths = PortablePaths::from_executable(&executable).unwrap();
            assert_eq!(paths.executable_root, executable.parent().unwrap());
            assert_ne!(paths.executable_root, std::env::current_dir().unwrap());
            assert_eq!(
                paths.default_data_root,
                executable.parent().unwrap().join("data")
            );
            return;
        }
        // A child test process isolates CWD from concurrently executing DB tests.
        let root = std::env::temp_dir().join(format!("dol-cwd-{}", unique_suffix()));
        let other = root.join("Other CWD");
        fs::create_dir_all(&other).unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "portable_paths::tests::executable_resolution_is_cwd_independent",
            ])
            .current_dir(&other)
            .env(CASE_EXE, root.join("EXE 日本語 folder").join("app.exe"))
            .output()
            .unwrap();
        fs::remove_dir_all(root).unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn probe_succeeds_and_rename_collision_never_replaces_other_file() {
        let root = std::env::temp_dir().join(format!("dol-probe-collision-{}", unique_suffix()));
        fs::create_dir(&root).unwrap();
        validate_directory_writable(&root).unwrap();
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        let source = root.join("source");
        let target = root.join("target");
        fs::write(&source, b"source").unwrap();
        fs::write(&target, b"keep").unwrap();
        assert!(rename_probe(&source, &target).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"keep");
        assert_eq!(fs::read(&source).unwrap(), b"source");
        fs::remove_dir_all(root).unwrap();
    }
}
