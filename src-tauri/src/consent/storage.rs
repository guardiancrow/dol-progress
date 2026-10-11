use super::{parse_record, record::MAX_RECORD_BYTES, CanonicalTerms, ConsentRecord, RecordStatus};
use std::{
    error::Error,
    fmt,
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const RECORD_NAME: &str = "consent.json";
const LOCK_NAME: &str = "consent-startup.lock";
static NEXT_ARTIFACT: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug)]
pub struct ConsentStore {
    portable_root: PathBuf,
    config_root: PathBuf,
}

impl ConsentStore {
    /// 呼出し元が指定したEXE親を使う。current_exeや実configを探索しない。
    pub fn for_portable_root(root: &Path) -> Result<Self, StorageError> {
        validate_root(root)?;
        Ok(Self {
            portable_root: root.into(),
            config_root: root.join("config"),
        })
    }

    pub fn record_path(&self) -> PathBuf {
        self.config_root.join(RECORD_NAME)
    }

    pub fn read(&self, current: &CanonicalTerms) -> Result<RecordStatus, StorageError> {
        self.snapshot(current).map(|(status, _)| status)
    }

    // gateがUI前後を比較するためのbytes。読取りと同じ排他・path検査を使う。
    pub(super) fn snapshot(
        &self,
        current: &CanonicalTerms,
    ) -> Result<(RecordStatus, Option<Vec<u8>>), StorageError> {
        let mut directories = pin_root(&self.portable_root)?;
        if !pin_config(&self.config_root, &mut directories, false)? {
            return Ok((RecordStatus::Missing, None));
        }
        let read_lock = acquire_read_lock_if_present(&self.config_root.join(LOCK_NAME))?;
        let snapshot = self.read_pinned(current);
        if read_lock.is_none() {
            // 最初のwriterがlockを新設した場合も、無排他snapshotをそのまま返さない。
            let later_lock = acquire_read_lock_if_present(&self.config_root.join(LOCK_NAME))?;
            if later_lock.is_some() {
                return self.read_pinned(current);
            }
        }
        snapshot
    }

    /// 明示同意を確認した呼出し元だけが使用する。UI・起動許可は生成しない。
    pub fn save_after_explicit_acceptance(
        &self,
        current: &CanonicalTerms,
    ) -> Result<ConsentLease, StorageError> {
        self.save_with(current, |_| Ok(()))
    }

    /// 有効記録を確認した後の排他再検証。将来のstartupまでleaseを保持できる。
    pub fn lock_verified_record(
        &self,
        current: &CanonicalTerms,
    ) -> Result<ConsentLease, StorageError> {
        let initial = self.read(current)?;
        require_accepted(initial)?;
        let lock = self.acquire(false)?;
        let (status, _) = self.read_pinned(current)?;
        let record = require_accepted(status)?;
        Ok(ConsentLease {
            record,
            was_written: false,
            _lock: lock,
        })
    }

    pub(super) fn save_with(
        &self,
        current: &CanonicalTerms,
        before: impl FnMut(SaveStage) -> io::Result<()>,
    ) -> Result<ConsentLease, StorageError> {
        self.save_checked(current, None, before)
    }

    // 既存save APIの意味論は維持し、gateだけがUI前snapshotを指定する。
    pub(super) fn save_checked(
        &self,
        current: &CanonicalTerms,
        expected: Option<&Option<Vec<u8>>>,
        mut before: impl FnMut(SaveStage) -> io::Result<()>,
    ) -> Result<ConsentLease, StorageError> {
        // 破損・未対応記録は、lock/config作成より前にも拒否する。
        require_replaceable(self.read(current)?)?;
        before(SaveStage::PrepareConfig)
            .map_err(|e| StorageError::io(SaveStage::PrepareConfig, e))?;
        let lock = self.acquire(true)?;
        let (status, original) = self.read_pinned(current)?;
        require_replaceable(status.clone())?;
        if let RecordStatus::Accepted(record) = status {
            return Ok(ConsentLease {
                record,
                was_written: false,
                _lock: lock,
            });
        }

        if expected.is_some_and(|expected| expected != &original) {
            return Err(StorageError::new(
                SaveStage::ReadRecord,
                StorageErrorKind::RecordChanged,
            ));
        }

        let record = ConsentRecord::accepted(current);
        let mut bytes = serde_json::to_vec_pretty(&record)
            .map_err(|_| StorageError::new(SaveStage::TempWrite, StorageErrorKind::Verification))?;
        bytes.push(b'\n');
        let mut artifacts = Vec::new();
        let mut commit = CommitState::NotReplaced;
        let result = (|| -> Result<(), StorageError> {
            step(&mut before, SaveStage::TempCreate)?;
            let (temporary, mut file) =
                create_artifact(&self.config_root, "tmp", SaveStage::TempCreate)?;
            artifacts.push(temporary.clone());
            step(&mut before, SaveStage::TempWrite)?;
            let half = bytes.len() / 2;
            file.write_all(&bytes[..half])
                .map_err(|e| StorageError::io(SaveStage::TempWrite, e))?;
            step(&mut before, SaveStage::TempHalfWritten)?;
            file.write_all(&bytes[half..])
                .map_err(|e| StorageError::io(SaveStage::TempWrite, e))?;
            step(&mut before, SaveStage::TempSync)?;
            file.sync_all()
                .map_err(|e| StorageError::io(SaveStage::TempSync, e))?;
            drop(file);
            step(&mut before, SaveStage::VerifyTemporary)?;
            let temporary_bytes = read_regular(&temporary)?.ok_or_else(|| {
                StorageError::new(SaveStage::VerifyTemporary, StorageErrorKind::Verification)
            })?;
            if temporary_bytes != bytes
                || !matches!(
                    parse_record(&temporary_bytes, current),
                    RecordStatus::Accepted(_)
                )
            {
                return Err(StorageError::new(
                    SaveStage::VerifyTemporary,
                    StorageErrorKind::Verification,
                ));
            }

            let mut backup = None;
            if let Some(original) = original.as_ref() {
                // ReplaceFile自体が失敗して旧名が消えても、旧bytesの保全copyは残す。
                step(&mut before, SaveStage::BackupCreate)?;
                let (path, mut file) =
                    create_artifact(&self.config_root, "previous", SaveStage::BackupCreate)?;
                artifacts.push(path.clone());
                step(&mut before, SaveStage::BackupWrite)?;
                file.write_all(original)
                    .map_err(|e| StorageError::io(SaveStage::BackupWrite, e))?;
                step(&mut before, SaveStage::BackupSync)?;
                file.sync_all()
                    .map_err(|e| StorageError::io(SaveStage::BackupSync, e))?;
                drop(file);
                if read_regular(&path)?.as_deref() != Some(original.as_slice()) {
                    return Err(StorageError::new(
                        SaveStage::BackupSync,
                        StorageErrorKind::Verification,
                    ));
                }
                backup = Some(path);
            }
            step(&mut before, SaveStage::Replace)?;
            if read_regular(&self.record_path())?.as_deref() != original.as_deref() {
                return Err(StorageError::new(
                    SaveStage::Replace,
                    StorageErrorKind::RecordChanged,
                ));
            }
            // API失敗ではdestinationの所在を保証できないので状態を先に更新する。
            commit = CommitState::ReplacementAttempted;
            replace(&temporary, &self.record_path(), original.is_some())?;
            commit = CommitState::ReplacedUnverified;
            step(&mut before, SaveStage::AfterReplace)?;
            step(&mut before, SaveStage::DestinationSync)?;
            sync_destination(&self.record_path())?;
            step(&mut before, SaveStage::VerifyDestination)?;
            let (status, saved) = self.read_pinned(current)?;
            if !matches!(status, RecordStatus::Accepted(_))
                || saved.as_deref() != Some(bytes.as_slice())
            {
                return Err(StorageError::new(
                    SaveStage::VerifyDestination,
                    StorageErrorKind::Verification,
                ));
            }
            commit = CommitState::Verified;
            step(&mut before, SaveStage::Cleanup)?;
            if let Some(backup) = backup {
                fs::remove_file(backup).map_err(|e| StorageError::io(SaveStage::Cleanup, e))?;
            }
            Ok(())
        })();
        if let Err(mut error) = result {
            error.commit_state = commit;
            error.recovery_artifacts = artifacts;
            // 失敗時は自分が作ったtmp/旧bytesを残し、復旧判断を呼出し元へ返す。
            return Err(error);
        }
        Ok(ConsentLease {
            record,
            was_written: true,
            _lock: lock,
        })
    }

    fn read_pinned(
        &self,
        current: &CanonicalTerms,
    ) -> Result<(RecordStatus, Option<Vec<u8>>), StorageError> {
        let bytes = read_regular(&self.record_path())?;
        let status = bytes
            .as_ref()
            .map_or(RecordStatus::Missing, |bytes| parse_record(bytes, current));
        Ok((status, bytes))
    }

    fn acquire(&self, create_config: bool) -> Result<WriteLock, StorageError> {
        let mut directories = pin_root(&self.portable_root)?;
        if !pin_config(&self.config_root, &mut directories, create_config)? {
            return Err(StorageError::new(
                SaveStage::PrepareConfig,
                StorageErrorKind::MissingRoot,
            ));
        }
        let lock = acquire_file_lock(&self.config_root.join(LOCK_NAME))?;
        Ok(WriteLock {
            _file: lock,
            _directories: directories,
        })
    }
}

#[derive(Debug)]
pub struct ConsentLease {
    record: ConsentRecord,
    was_written: bool,
    _lock: WriteLock,
}

impl ConsentLease {
    pub fn record(&self) -> &ConsentRecord {
        &self.record
    }
    pub fn was_written(&self) -> bool {
        self.was_written
    }
}

#[derive(Debug)]
struct WriteLock {
    _file: File,
    _directories: Vec<File>,
}

fn require_replaceable(status: RecordStatus) -> Result<(), StorageError> {
    match status {
        RecordStatus::Missing
        | RecordStatus::Accepted(_)
        | RecordStatus::Outdated { .. }
        | RecordStatus::HashMismatch => Ok(()),
        status => Err(StorageError::new(
            SaveStage::ReadRecord,
            StorageErrorKind::BlockedRecord(status),
        )),
    }
}

fn require_accepted(status: RecordStatus) -> Result<ConsentRecord, StorageError> {
    match status {
        RecordStatus::Accepted(record) => Ok(record),
        status => Err(StorageError::new(
            SaveStage::ReadRecord,
            StorageErrorKind::BlockedRecord(status),
        )),
    }
}

fn step(
    before: &mut impl FnMut(SaveStage) -> io::Result<()>,
    stage: SaveStage,
) -> Result<(), StorageError> {
    before(stage).map_err(|e| StorageError::io(stage, e))
}

fn validate_root(root: &Path) -> Result<(), StorageError> {
    let invalid = || StorageError::new(SaveStage::PathValidation, StorageErrorKind::InvalidPath);
    if !root.is_absolute() || root.parent().is_none() || root.file_name().is_none() {
        return Err(invalid());
    }
    let text = root.to_str().ok_or_else(invalid)?;
    if text
        .split(['/', '\\'])
        .any(|part| matches!(part, "." | ".."))
    {
        return Err(invalid());
    }
    for component in root.components() {
        match component {
            Component::ParentDir | Component::CurDir => return Err(invalid()),
            Component::Normal(name) => {
                let name = name.to_str().ok_or_else(invalid)?;
                if name
                    .chars()
                    .any(|c| c.is_control() || "<>:\"|?*".contains(c))
                    || name.ends_with(['.', ' '])
                {
                    return Err(invalid());
                }
                let base = name.split('.').next().unwrap_or("").to_uppercase();
                if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                    || ["COM", "LPT"].iter().any(|prefix| {
                        base.strip_prefix(prefix).is_some_and(|n| {
                            matches!(
                                n,
                                "1" | "2"
                                    | "3"
                                    | "4"
                                    | "5"
                                    | "6"
                                    | "7"
                                    | "8"
                                    | "9"
                                    | "¹"
                                    | "²"
                                    | "³"
                            )
                        })
                    })
                {
                    return Err(invalid());
                }
            }
            #[cfg(windows)]
            Component::Prefix(prefix) => {
                if !matches!(
                    prefix.kind(),
                    std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)
                ) {
                    return Err(invalid());
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn pin_root(root: &Path) -> Result<Vec<File>, StorageError> {
    root.ancestors()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(pin_directory)
        .collect()
}

fn pin_config(
    path: &Path,
    directories: &mut Vec<File>,
    create: bool,
) -> Result<bool, StorageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => check_directory(&metadata)?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            if !create {
                return Ok(false);
            }
            match fs::create_dir(path) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(StorageError::io(SaveStage::PrepareConfig, e)),
            }
        }
        Err(e) => return Err(StorageError::io(SaveStage::ReadRecord, e)),
    }
    directories.push(pin_directory(path)?);
    Ok(true)
}

fn check_directory(metadata: &Metadata) -> Result<(), StorageError> {
    check_reparse(metadata)?;
    if !metadata.is_dir() {
        return Err(StorageError::new(
            SaveStage::PathValidation,
            StorageErrorKind::PathConflict,
        ));
    }
    Ok(())
}

fn check_reparse(metadata: &Metadata) -> Result<(), StorageError> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(StorageError::new(
                SaveStage::PathValidation,
                StorageErrorKind::UnsafePath,
            ));
        }
    }
    if metadata.file_type().is_symlink() {
        return Err(StorageError::new(
            SaveStage::PathValidation,
            StorageErrorKind::UnsafePath,
        ));
    }
    Ok(())
}

fn pin_directory(path: &Path) -> Result<File, StorageError> {
    check_directory(
        &fs::symlink_metadata(path).map_err(|e| StorageError::io(SaveStage::PathValidation, e))?,
    )?;
    let mut options = OpenOptions::new();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::*;
        options
            .access_mode(0)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(not(windows))]
    options.read(true);
    let file = options
        .open(path)
        .map_err(|e| StorageError::io(SaveStage::PathValidation, e))?;
    check_directory(
        &file
            .metadata()
            .map_err(|e| StorageError::io(SaveStage::PathValidation, e))?,
    )?;
    Ok(file)
}

fn check_regular_handle(file: &File) -> Result<(), StorageError> {
    let metadata = file
        .metadata()
        .map_err(|e| StorageError::io(SaveStage::ReadRecord, e))?;
    check_reparse(&metadata)?;
    if !metadata.is_file() {
        return Err(StorageError::new(
            SaveStage::PathValidation,
            StorageErrorKind::PathConflict,
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(StorageError::io(
                SaveStage::PathValidation,
                io::Error::last_os_error(),
            ));
        }
        if info.nNumberOfLinks != 1 {
            return Err(StorageError::new(
                SaveStage::PathValidation,
                StorageErrorKind::UnsafePath,
            ));
        }
    }
    Ok(())
}

fn read_regular(path: &Path) -> Result<Option<Vec<u8>>, StorageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            check_reparse(&metadata)?;
            if !metadata.is_file() {
                return Err(StorageError::new(
                    SaveStage::PathValidation,
                    StorageErrorKind::PathConflict,
                ));
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(StorageError::io(SaveStage::ReadRecord, e)),
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::*;
        options
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|e| StorageError::io(SaveStage::ReadRecord, e))?;
    check_regular_handle(&file)?;
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| StorageError::io(SaveStage::ReadRecord, e))?;
    Ok(Some(bytes))
}

#[cfg(windows)]
fn acquire_file_lock(path: &Path) -> Result<File, StorageError> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            check_reparse(&metadata)?;
            if !metadata.is_file() {
                return Err(StorageError::new(
                    SaveStage::AcquireLock,
                    StorageErrorKind::PathConflict,
                ));
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(StorageError::io(SaveStage::AcquireLock, e)),
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| StorageError::io(SaveStage::AcquireLock, e))?;
    check_regular_handle(&file)?;
    Ok(file)
}

#[cfg(windows)]
fn acquire_read_lock_if_present(path: &Path) -> Result<Option<File>, StorageError> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ};
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            check_reparse(&metadata)?;
            if !metadata.is_file() {
                return Err(StorageError::new(
                    SaveStage::ReadRecord,
                    StorageErrorKind::PathConflict,
                ));
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(StorageError::io(SaveStage::ReadRecord, e)),
    }
    // 作成・truncateなし。reader同士は共有し、write leaseと重ならない。
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| {
            let busy = matches!(e.raw_os_error(), Some(32 | 33));
            let mut error = StorageError::io(SaveStage::ReadRecord, e);
            if busy {
                error.kind = StorageErrorKind::Busy;
            }
            error
        })?;
    check_regular_handle(&file)?;
    Ok(Some(file))
}

#[cfg(not(windows))]
fn acquire_read_lock_if_present(path: &Path) -> Result<Option<File>, StorageError> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(StorageError::io(SaveStage::ReadRecord, e)),
        Ok(_) => Err(StorageError::new(
            SaveStage::ReadRecord,
            StorageErrorKind::UnsupportedPlatform,
        )),
    }
}

#[cfg(not(windows))]
fn acquire_file_lock(_path: &Path) -> Result<File, StorageError> {
    Err(StorageError::new(
        SaveStage::AcquireLock,
        StorageErrorKind::UnsupportedPlatform,
    ))
}

fn create_artifact(
    root: &Path,
    role: &str,
    stage: SaveStage,
) -> Result<(PathBuf, File), StorageError> {
    for _ in 0..16 {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let serial = NEXT_ARTIFACT.fetch_add(1, Ordering::Relaxed);
        let path = root.join(format!(
            ".consent-{role}-{time}-{}-{serial}",
            std::process::id()
        ));
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(file) => {
                check_regular_handle(&file)?;
                return Ok((path, file));
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(StorageError::io(stage, e)),
        }
    }
    Err(StorageError::new(stage, StorageErrorKind::PathConflict))
}

#[cfg(windows)]
fn replace(temporary: &Path, destination: &Path, existing: bool) -> Result<(), StorageError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, ReplaceFileW};
    let temp: Vec<_> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let dest: Vec<_> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let success = unsafe {
        if existing {
            ReplaceFileW(
                dest.as_ptr(),
                temp.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        } else {
            // 初回保存はdestinationを上書きしない。
            MoveFileExW(temp.as_ptr(), dest.as_ptr(), 0)
        }
    };
    if success == 0 {
        Err(StorageError::io(
            SaveStage::Replace,
            io::Error::last_os_error(),
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace(_temporary: &Path, _destination: &Path, _existing: bool) -> Result<(), StorageError> {
    Err(StorageError::new(
        SaveStage::Replace,
        StorageErrorKind::UnsupportedPlatform,
    ))
}

fn sync_destination(path: &Path) -> Result<(), StorageError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::*;
        options
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
    }
    let file = options
        .open(path)
        .map_err(|e| StorageError::io(SaveStage::DestinationSync, e))?;
    check_regular_handle(&file)?;
    file.sync_all()
        .map_err(|e| StorageError::io(SaveStage::DestinationSync, e))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SaveStage {
    PathValidation,
    ReadRecord,
    PrepareConfig,
    AcquireLock,
    TempCreate,
    TempWrite,
    TempHalfWritten,
    TempSync,
    VerifyTemporary,
    BackupCreate,
    BackupWrite,
    BackupSync,
    Replace,
    AfterReplace,
    DestinationSync,
    VerifyDestination,
    Cleanup,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitState {
    NotReplaced,
    ReplacementAttempted,
    ReplacedUnverified,
    Verified,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StorageErrorKind {
    InvalidPath,
    UnsafePath,
    PathConflict,
    MissingRoot,
    Busy,
    Io,
    Verification,
    RecordChanged,
    UnsupportedPlatform,
    BlockedRecord(RecordStatus),
}

#[derive(Debug)]
pub struct StorageError {
    pub stage: SaveStage,
    pub kind: StorageErrorKind,
    pub commit_state: CommitState,
    pub io_kind: Option<io::ErrorKind>,
    pub os_error: Option<i32>,
    pub recovery_artifacts: Vec<PathBuf>,
}

impl StorageError {
    fn new(stage: SaveStage, kind: StorageErrorKind) -> Self {
        Self {
            stage,
            kind,
            commit_state: CommitState::NotReplaced,
            io_kind: None,
            os_error: None,
            recovery_artifacts: Vec::new(),
        }
    }
    fn io(stage: SaveStage, error: io::Error) -> Self {
        let kind =
            if stage == SaveStage::AcquireLock && matches!(error.raw_os_error(), Some(32 | 33)) {
                StorageErrorKind::Busy
            } else {
                StorageErrorKind::Io
            };
        Self {
            io_kind: Some(error.kind()),
            os_error: error.raw_os_error(),
            ..Self::new(stage, kind)
        }
    }
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "同意記録の処理に失敗しました（{:?}／{:?}、OS error {:?}）",
            self.stage, self.kind, self.os_error
        )
    }
}
impl Error for StorageError {}
