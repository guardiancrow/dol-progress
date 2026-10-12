//! 明示feature専用。自動fixtureはTEMP、手動fixtureは専用永続root。旧fixtureは探索しない。
use super::storage::{pin_directory, read_regular, validate_root};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

const NAMESPACE: &str = "DOL-Consent-Test-Only-v1";
const MARKER: &str = "TEST_ONLY.fixture";

/// 手動検証専用。自動fixtureとはmarkerと階層を分離する。
pub struct ManualFixture {
    base: PathBuf,
    fixture: Fixture,
    created_mode: String,
}
impl ManualFixture {
    pub fn default_root() -> Result<PathBuf, String> {
        let executable = std::env::current_exe().map_err(|e| format!("EXE path取得: {e}"))?;
        Ok(executable
            .parent()
            .ok_or("EXE親directoryがありません")?
            .join("manual-fixtures"))
    }
    pub fn open(base: &Path, id: Option<&str>, mode: &str) -> Result<Self, String> {
        if !matches!(mode, "Normal" | "Recovery") {
            return Err("手動mode不一致".into());
        }
        if let Some(id) = id {
            validate_id(id)?;
        }
        validate_root(base).map_err(|e| format!("manual root path検証: {e}"))?;
        let owner = format!("DOL-Consent-Manual-TEST-ONLY-v1\n{}\n", namespace()?);
        let mut pins = Vec::new();
        // resumeは欠損rootを作らない。既存rootは空でもmarkerなしでは採用しない。
        for directory in base.ancestors().collect::<Vec<_>>().into_iter().rev() {
            match fs::symlink_metadata(directory) {
                Ok(_) => pins.push(
                    pin_directory(directory).map_err(|e| format!("manual directory pin: {e}"))?,
                ),
                Err(e) if e.kind() == io::ErrorKind::NotFound && id.is_none() => {
                    if !create_dir(directory, "manual directory作成")? {
                        return Err("manual directory作成競合。内容を採用せず停止します".into());
                    }
                    pins.push(
                        pin_directory(directory)
                            .map_err(|e| format!("manual directory pin: {e}"))?,
                    );
                    if directory == base {
                        write_marker(&base.join(MARKER), owner.as_bytes())?;
                    }
                }
                Err(e) => return Err(format!("manual directory確認: {e}")),
            }
        }
        check_marker(&base.join(MARKER), owner.as_bytes())?;
        let collection = base.join("fixtures");
        if id.is_some() {
            pins.push(pin_directory(&collection).map_err(|e| format!("manual fixtures pin: {e}"))?);
        } else {
            ensure_dir(&collection, &mut pins)?;
        }
        let fresh = id.is_none();
        let id = id
            .map(str::to_owned)
            .unwrap_or_else(crate::portable_paths::unique_suffix);
        let root = collection.join(&id);
        if fresh && !create_dir(&root, "manual fixture作成")? {
            return Err("manual fixture ID衝突".into());
        }
        pins.push(pin_directory(&root).map_err(|e| format!("manual fixture pin: {e}"))?);
        if fresh {
            write_marker(
                &root.join(MARKER),
                format!("DOL-Consent-Manual-gate-v1\n{mode}\n").as_bytes(),
            )?;
        }
        let bytes = read_regular(&root.join(MARKER))
            .map_err(|e| format!("manual fixture marker検証: {e}"))?;
        let created_mode = match bytes.as_deref() {
            Some(b"DOL-Consent-Manual-gate-v1\nNormal\n") => "Normal",
            Some(b"DOL-Consent-Manual-gate-v1\nRecovery\n") => "Recovery",
            _ => return Err("手動fixture marker不一致".into()),
        };
        Ok(Self {
            base: base.to_owned(),
            fixture: Fixture {
                root,
                id,
                _pins: pins,
            },
            created_mode: created_mode.to_owned(),
        })
    }
    pub fn base(&self) -> &Path {
        &self.base
    }
    pub fn root(&self) -> &Path {
        self.fixture.root()
    }
    pub fn id(&self) -> &str {
        self.fixture.id()
    }
    pub fn created_mode(&self) -> &str {
        &self.created_mode
    }
}

pub struct Fixture {
    root: PathBuf,
    id: String,
    // ancestorを削除共有なしで保持し、startup中のroot差替えを防ぐ。
    _pins: Vec<File>,
}
impl Fixture {
    pub fn new(kind: &str) -> Result<Self, String> {
        Self::open(kind, None)
    }
    pub fn resume(kind: &str, id: &str) -> Result<Self, String> {
        Self::open(kind, Some(id))
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn id(&self) -> &str {
        &self.id
    }
    fn open(kind: &str, id: Option<&str>) -> Result<Self, String> {
        if !matches!(kind, "gate" | "startup") {
            return Err("fixture kind不一致".into());
        }
        if let Some(id) = id {
            validate_id(id)?;
        }
        let base = std::env::temp_dir().join(namespace()?);
        validate_root(&base).map_err(|e| format!("TEMP path検証: {e}"))?;
        let mut pins = Vec::new();
        for directory in base
            .parent()
            .unwrap()
            .ancestors()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
        {
            ensure_dir(directory, &mut pins)?;
        }
        let created = create_dir(&base, "namespace作成")?;
        pins.push(pin_directory(&base).map_err(|e| format!("namespace pin: {e}"))?);
        let owner = base.join(MARKER);
        if created {
            write_marker(&owner, NAMESPACE.as_bytes())?;
        }
        check_marker(&owner, NAMESPACE.as_bytes())?;
        let kind_root = base.join(kind);
        ensure_dir(&kind_root, &mut pins)?;
        let fresh = id.is_none();
        let id = id
            .map(str::to_owned)
            .unwrap_or_else(crate::portable_paths::unique_suffix);
        let root = kind_root.join(&id);
        if id.is_empty() {
            return Err("空fixture ID".into());
        }
        // new/resumeを分離し、既存IDを新規作成として採用しない。
        let root_created = if fresh {
            create_dir(&root, "fixture作成")?
        } else {
            false
        };
        if fresh && !root_created {
            return Err("fixture ID衝突".into());
        }
        pins.push(pin_directory(&root).map_err(|e| format!("fixture pin（ID={id}）: {e}"))?);
        if root_created {
            write_marker(&root.join(MARKER), kind.as_bytes())?;
        }
        check_marker(&root.join(MARKER), kind.as_bytes())?;
        Ok(Self {
            root,
            id,
            _pins: pins,
        })
    }
}

// TEMPが共有設定の場合も別Windows利用者のfixture IDを同じrootへ解決しない。
// SIDはpath用digestにだけ使用し、画面・監査ログへ出力しない。
#[cfg(windows)]
fn namespace() -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(process: HANDLE, access: u32, token: *mut HANDLE) -> i32;
        fn GetTokenInformation(
            token: HANDLE,
            class: u32,
            info: *mut c_void,
            length: u32,
            returned: *mut u32,
        ) -> i32;
    }
    struct Token(HANDLE);
    impl Drop for Token {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    #[repr(C)]
    struct TokenUser {
        sid: *const u8,
        attributes: u32,
    }
    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken((-1isize) as HANDLE, 8, &mut token) == 0 {
            return Err(format!(
                "fixture user token: {}",
                io::Error::last_os_error()
            ));
        }
        let token = Token(token);
        let mut needed = 0;
        GetTokenInformation(token.0, 1, std::ptr::null_mut(), 0, &mut needed);
        if !(std::mem::size_of::<TokenUser>() as u32..=65536).contains(&needed) {
            return Err("fixture user token size".into());
        }
        let mut buffer = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
        if GetTokenInformation(token.0, 1, buffer.as_mut_ptr().cast(), needed, &mut needed) == 0 {
            return Err(format!(
                "fixture user identity: {}",
                io::Error::last_os_error()
            ));
        }
        let start = buffer.as_ptr() as usize;
        let end = start + (needed as usize).min(buffer.len() * std::mem::size_of::<usize>());
        let sid = (*buffer.as_ptr().cast::<TokenUser>()).sid;
        let address = sid as usize;
        if address < start || address.checked_add(8).is_none_or(|n| n > end) {
            return Err("fixture SID bounds".into());
        }
        let count = *sid.add(1) as usize;
        let length = 8 + count * 4;
        if *sid != 1 || count > 15 || address.checked_add(length).is_none_or(|n| n > end) {
            return Err("fixture SID format".into());
        }
        Ok(format!(
            "{NAMESPACE}-{:x}",
            Sha256::digest(std::slice::from_raw_parts(sid, length))
        ))
    }
}
#[cfg(not(windows))]
fn namespace() -> Result<String, String> {
    Err("Windows専用fixture".into())
}
fn validate_id(id: &str) -> Result<(), String> {
    if id.len() > 100
        || id.split('-').count() != 3
        || id
            .split('-')
            .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        Err("fixture IDはこのPCで出力された3区分の数字を指定してください".into())
    } else {
        Ok(())
    }
}
fn create_dir(path: &Path, stage: &str) -> Result<bool, String> {
    match fs::create_dir(path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(format!("{stage}: {e}")),
    }
}
fn ensure_dir(path: &Path, pins: &mut Vec<File>) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            create_dir(path, "TEMP親directory作成")?;
        }
        Err(e) => return Err(format!("TEMP親directory確認: {e}")),
    }
    pins.push(pin_directory(path).map_err(|e| format!("TEMP directory pin: {e}"))?);
    Ok(())
}
fn write_marker(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("marker作成: {e}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("marker保存: {e}"))
}
fn check_marker(path: &Path, expected: &[u8]) -> Result<(), String> {
    if read_regular(path)
        .map_err(|e| format!("marker検証: {e}"))?
        .as_deref()
        != Some(expected)
    {
        return Err("専用fixture marker不一致（既存directoryは採用しません）".into());
    }
    Ok(())
}

/// startupの入力treeを検査する。既存fileは単一linkの通常fileだけを許可する。
#[cfg(all(windows, feature = "consent-startup-harness"))]
pub(crate) fn pin_tree(root: &Path) -> Result<Vec<File>, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::*;
    let mut pins = vec![pin_directory(root).map_err(|e| format!("tree directory pin: {e}"))?];
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            pins.extend(pin_tree(&path)?);
        } else {
            let file = OpenOptions::new()
                .access_mode(0)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&path)
                .map_err(|e| format!("tree file open: {e}"))?;
            super::storage::check_regular_handle(&file)
                .map_err(|e| format!("tree file type/link: {e}"))?;
        }
    }
    Ok(pins)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ids_reject_paths_and_cross_namespace_names() {
        assert!(validate_id("123-456-0").is_ok());
        for id in [
            "",
            "../123",
            "123-456",
            "123--0",
            "C:\\root",
            "123-456-0/child",
        ] {
            assert!(validate_id(id).is_err());
        }
    }
    #[cfg(windows)]
    #[test]
    fn fixture_resume_checks_marker_kind_and_missing_id_without_recreating_root() {
        let fixture = Fixture::new("gate").unwrap();
        let resumed = Fixture::resume("gate", fixture.id()).unwrap();
        assert_eq!(fixture.root(), resumed.root());
        assert!(Fixture::resume("startup", fixture.id()).is_err());
        let missing = crate::portable_paths::unique_suffix();
        assert!(Fixture::resume("gate", &missing).is_err());
        assert!(!fixture.root().parent().unwrap().join(missing).exists());
        fs::write(fixture.root().join(MARKER), b"wrong kind").unwrap();
        assert!(Fixture::resume("gate", fixture.id()).is_err());
        assert!(!fixture.root().join("config").exists());
    }
    #[cfg(windows)]
    #[test]
    fn manual_new_resume_modes_and_missing_resume_are_isolated() {
        let owner = Fixture::new("gate").unwrap();
        let base = owner.root().join("日本語 manual root");
        let first = ManualFixture::open(&base, None, "Normal").unwrap();
        let second = ManualFixture::open(&base, None, "Recovery").unwrap();
        assert_ne!(first.id(), second.id());
        let resumed = ManualFixture::open(&base, Some(first.id()), "Recovery").unwrap();
        assert_eq!(first.root(), resumed.root());
        assert_eq!(resumed.created_mode(), "Normal");
        let missing = owner.root().join("missing");
        assert!(ManualFixture::open(&missing, Some(first.id()), "Normal").is_err());
        assert!(!missing.exists());
        assert!(ManualFixture::open(&base, Some("1-2-3"), "Normal").is_err());
        assert!(!base.join("fixtures/1-2-3").exists());
        assert_eq!(
            ManualFixture::default_root().unwrap(),
            std::env::current_exe()
                .unwrap()
                .parent()
                .unwrap()
                .join("manual-fixtures")
        );
    }
    #[cfg(windows)]
    #[test]
    fn manual_rejects_unmarked_foreign_and_bad_fixture_without_writes() {
        let owner = Fixture::new("gate").unwrap();
        let untouched = owner.root().join("application data");
        fs::create_dir(&untouched).unwrap();
        fs::write(untouched.join("db.sqlite"), b"sentinel").unwrap();
        assert!(ManualFixture::open(&untouched, None, "Normal").is_err());
        assert_eq!(fs::read(untouched.join("db.sqlite")).unwrap(), b"sentinel");
        assert_eq!(fs::read_dir(&untouched).unwrap().count(), 1);
        let base = owner.root().join("manual");
        let fixture = ManualFixture::open(&base, None, "Normal").unwrap();
        for id in ["..", "../1-2-3", "C:\\outside", "1-2-3/child", "1-2"] {
            assert!(ManualFixture::open(&base, Some(id), "Normal").is_err());
        }
        fs::write(base.join(MARKER), b"different Windows owner").unwrap();
        assert!(ManualFixture::open(&base, None, "Normal").is_err());
        assert!(ManualFixture::open(&base, Some(fixture.id()), "Normal").is_err());
        assert_eq!(fs::read_dir(base.join("fixtures")).unwrap().count(), 1);
    }
    #[cfg(windows)]
    #[test]
    fn manual_concurrent_new_ids_and_marker_integrity() {
        let owner = Fixture::new("gate").unwrap();
        let base = owner.root().join("manual");
        let first = ManualFixture::open(&base, None, "Normal").unwrap();
        let joins = (0..8)
            .map(|_| {
                let base = base.clone();
                std::thread::spawn(move || {
                    ManualFixture::open(&base, None, "Recovery")
                        .unwrap()
                        .id()
                        .to_owned()
                })
            })
            .collect::<Vec<_>>();
        let mut ids = joins
            .into_iter()
            .map(|j| j.join().unwrap())
            .collect::<Vec<_>>();
        ids.push(first.id().to_owned());
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 9);
        fs::write(first.root().join(MARKER), b"wrong fixture kind").unwrap();
        assert!(ManualFixture::open(&base, Some(first.id()), "Normal").is_err());
        assert!(!first.root().join("config").exists());
    }
}
#[cfg(windows)]
pub mod driver {
    use std::{
        ptr::null_mut,
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::*,
        UI::{Input::KeyboardAndMouse::IsWindowEnabled, WindowsAndMessaging::*},
    };
    unsafe extern "system" fn find(hwnd: HWND, param: isize) -> BOOL {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == std::process::id()
            && IsWindowVisible(hwnd) != 0
            && !GetDlgItem(hwnd, 101).is_null()
        {
            *(param as *mut HWND) = hwnd;
            return 0;
        }
        1
    }
    struct OwnedWindow(HWND);
    impl Drop for OwnedWindow {
        fn drop(&mut self) {
            unsafe {
                let mut pid = 0;
                GetWindowThreadProcessId(self.0, &mut pid);
                if pid == std::process::id() && IsWindow(self.0) != 0 {
                    PostMessageW(self.0, WM_CLOSE, 0, 0);
                }
            }
        }
    }
    unsafe fn click(hwnd: HWND) -> Result<(), String> {
        let mut result = 0;
        if SendMessageTimeoutW(
            hwnd,
            BM_CLICK,
            0,
            0,
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            3000,
            &mut result,
        ) == 0
        {
            Err("button timeout".into())
        } else {
            Ok(())
        }
    }
    pub fn operate(accept: bool) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut hwnd: HWND = null_mut();
        while hwnd.is_null() {
            unsafe {
                EnumWindows(Some(find), (&mut hwnd as *mut HWND) as isize);
            }
            if Instant::now() >= deadline {
                return Err("自身のNative dialog待機期限".into());
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _owned = OwnedWindow(hwnd);
        unsafe {
            if accept {
                click(GetDlgItem(hwnd, 102))?;
                if IsWindowEnabled(GetDlgItem(hwnd, 103)) == 0 {
                    return Err("accept disabled".into());
                }
                click(GetDlgItem(hwnd, 103))?;
            } else {
                click(GetDlgItem(hwnd, 104))?;
            }
        }
        Ok(())
    }
}
