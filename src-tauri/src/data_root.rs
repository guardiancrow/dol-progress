use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::{
    active_database::{ActiveDatabase, DATABASE_FILE_NAME},
    backup_restore::{replace_staged_database, snapshot_pool_into, validate_application_database},
};

const BOOTSTRAP_FILE_NAME: &str = "data-root.json";
const LAST_GOOD_FILE_NAME: &str = "data-root.last-good.json";
static UNIQUE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    version: u8,
    mode: RootMode,
    #[serde(default)]
    data_root: Option<PathBuf>,
    state: BootstrapState,
    #[serde(default)]
    transition_id: Option<String>,
    #[serde(default)]
    previous: Option<PreviousRoot>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum RootMode {
    Default,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum BootstrapState {
    Pending,
    Committed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PreviousRoot {
    mode: RootMode,
    #[serde(default)]
    data_root: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataRootInfo {
    mode: String,
    data_root: String,
    database_path: String,
    default_database_path: String,
    default_database_exists: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryInfo {
    message: String,
    configured_root: Option<String>,
    last_good_available: bool,
    pending_previous_available: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum StartupPresentation {
    Normal(DataRootInfo),
    Recovery(RecoveryInfo),
}

pub(crate) struct StartupState(pub(crate) Mutex<StartupPresentation>);
#[derive(Default)]
pub(crate) struct DataRootSelectionState(Mutex<Option<PathBuf>>);

pub(crate) struct DataRootResolver;

pub(crate) struct ResolvedRoot {
    pub(crate) info: DataRootInfo,
    pub(crate) path: PathBuf,
    pub(crate) create_if_missing: bool,
    pending: bool,
    bootstrap: Option<Bootstrap>,
}

impl DataRootResolver {
    pub(crate) fn default_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
        app.path()
            .app_config_dir()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn resolve<R: Runtime>(app: &AppHandle<R>) -> Result<ResolvedRoot, RecoveryInfo> {
        Self::resolve_at(Self::default_root(app).map_err(recovery)?)
    }

    fn resolve_at(default_root: PathBuf) -> Result<ResolvedRoot, RecoveryInfo> {
        let default_db = default_root.join(DATABASE_FILE_NAME);
        let bootstrap_path = default_root.join(BOOTSTRAP_FILE_NAME);
        let bootstrap = match read_bootstrap(&bootstrap_path) {
            Ok(value) => value,
            Err(detail) => return Err(recovery_with_last_good(detail, &default_root)),
        };
        let Some(bootstrap) = bootstrap else {
            if missing_primary_requires_recovery(&default_root) {
                return Err(recovery_with_last_good(
                    "保存場所設定の本体が見つかりません。標準保存場所へ自動で切り替えていません。",
                    &default_root,
                ));
            }
            return Ok(resolved_info(
                RootMode::Default,
                default_root,
                default_db,
                true,
                false,
                None,
            ));
        };
        let root = match &bootstrap.mode {
            RootMode::Default => default_root.clone(),
            RootMode::Custom => bootstrap.data_root.clone().ok_or_else(|| {
                recovery_for_bootstrap(
                    "カスタム保存場所の指定がありません。",
                    &bootstrap,
                    &default_root,
                )
            })?,
        };
        if matches!(bootstrap.mode, RootMode::Custom) {
            validate_local_root(&root)
                .map_err(|message| recovery_for_bootstrap(message, &bootstrap, &default_root))?;
        }
        let database = root.join(DATABASE_FILE_NAME);
        if !database.is_file() {
            return Err(recovery_for_bootstrap(
                "設定されているデータ保存場所のデータベースを開けません。別の場所へ自動作成していません。",
                &bootstrap,
                &default_root,
            ));
        }
        Ok(resolved_info(
            bootstrap.mode.clone(),
            root,
            database,
            false,
            bootstrap.state == BootstrapState::Pending,
            Some(bootstrap),
        ))
    }
}

fn missing_primary_requires_recovery(default_root: &Path) -> bool {
    default_root.join(LAST_GOOD_FILE_NAME).exists()
}

fn resolved_info(
    mode: RootMode,
    root: PathBuf,
    database: PathBuf,
    create_if_missing: bool,
    pending: bool,
    bootstrap: Option<Bootstrap>,
) -> ResolvedRoot {
    let default_root = if mode == RootMode::Default {
        root.clone()
    } else {
        bootstrap.as_ref().and_then(|_| None).unwrap_or_default()
    };
    // The caller replaces these default fields below; this helper only keeps the active invariant compact.
    let info = DataRootInfo {
        mode: match mode {
            RootMode::Default => "default".into(),
            RootMode::Custom => "custom".into(),
        },
        data_root: root.display().to_string(),
        database_path: database.display().to_string(),
        default_database_path: String::new(),
        default_database_exists: false,
    };
    let _ = default_root;
    ResolvedRoot {
        info,
        path: database,
        create_if_missing,
        pending,
        bootstrap,
    }
}

pub(crate) async fn initialize<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(ActiveDatabase, DataRootInfo), RecoveryInfo> {
    let resolved = DataRootResolver::resolve(app)?;
    let default_root = DataRootResolver::default_root(app).map_err(recovery)?;
    initialize_resolved(&default_root, resolved).await
}

#[cfg(test)]
async fn initialize_at(
    default_root: &Path,
) -> Result<(ActiveDatabase, DataRootInfo), RecoveryInfo> {
    let resolved = DataRootResolver::resolve_at(default_root.to_path_buf())?;
    initialize_resolved(default_root, resolved).await
}

async fn initialize_resolved(
    default_root: &Path,
    mut resolved: ResolvedRoot,
) -> Result<(ActiveDatabase, DataRootInfo), RecoveryInfo> {
    let default_db = default_root.join(DATABASE_FILE_NAME);
    resolved.info.default_database_path = default_db.display().to_string();
    resolved.info.default_database_exists = default_db.is_file();
    let database = if resolved.create_if_missing {
        ActiveDatabase::open(resolved.path.clone()).await
    } else {
        ActiveDatabase::open_existing(resolved.path.clone()).await
    }
    .map_err(recovery)?;
    {
        let pool = database.pool().await;
        crate::migrations::run(&pool).await.map_err(recovery)?;
        crate::quest_facets::backfill_pool(&pool)
            .await
            .map_err(recovery)?;
    }
    validate_application_database(&resolved.path)
        .await
        .map_err(recovery)?;
    if resolved.pending {
        let bootstrap = resolved.bootstrap.take().expect("pending bootstrap exists");
        let committed = Bootstrap {
            state: BootstrapState::Committed,
            previous: None,
            ..bootstrap
        };
        write_committed(default_root, &committed).map_err(recovery)?;
    }
    Ok((database, resolved.info))
}

#[tauri::command]
pub(crate) fn data_root_status(
    state: State<'_, StartupState>,
) -> Result<StartupPresentation, String> {
    state
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "Data root state is unavailable".into())
}

#[tauri::command]
pub(crate) fn choose_custom_data_root(
    app: AppHandle,
    database: State<'_, ActiveDatabase>,
    selections: State<'_, DataRootSelectionState>,
) -> Result<Option<String>, String> {
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let root = local_directory(selected)?;
    validate_new_destination(&root, database.database_path().parent().unwrap())?;
    *selections
        .0
        .lock()
        .map_err(|_| "Selection state is unavailable")? = Some(root.clone());
    Ok(Some(root.display().to_string()))
}

#[tauri::command]
pub(crate) async fn migrate_selected_data_root(
    app: AppHandle,
    database: State<'_, ActiveDatabase>,
    selections: State<'_, DataRootSelectionState>,
) -> Result<(), String> {
    let destination = selections
        .0
        .lock()
        .map_err(|_| "Selection state is unavailable")?
        .take()
        .ok_or("保存場所を選択してください。")?;
    migrate_to_root(&app, &database, destination, RootMode::Custom).await?;
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub(crate) async fn migrate_to_default_data_root(
    app: AppHandle,
    database: State<'_, ActiveDatabase>,
) -> Result<(), String> {
    let destination = DataRootResolver::default_root(&app)?;
    if same_path(&destination, database.database_path().parent().unwrap())? {
        return Err("既に標準保存場所を使用しています。".into());
    }
    migrate_to_root(&app, &database, destination, RootMode::Default).await?;
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub(crate) fn recovery_choose_existing_root(
    app: AppHandle,
    selections: State<'_, DataRootSelectionState>,
) -> Result<Option<String>, String> {
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let root = local_directory(selected)?;
    validate_existing_root(&root)?;
    *selections
        .0
        .lock()
        .map_err(|_| "Selection state is unavailable")? = Some(root.clone());
    Ok(Some(root.display().to_string()))
}

#[tauri::command]
pub(crate) fn recovery_activate_selected_root(
    app: AppHandle,
    selections: State<'_, DataRootSelectionState>,
) -> Result<(), String> {
    let root = selections
        .0
        .lock()
        .map_err(|_| "Selection state is unavailable")?
        .take()
        .ok_or("保存場所を選択してください。")?;
    validate_existing_root(&root)?;
    let bootstrap = Bootstrap {
        version: 1,
        mode: RootMode::Custom,
        data_root: Some(root),
        state: BootstrapState::Committed,
        transition_id: None,
        previous: None,
    };
    write_committed(&DataRootResolver::default_root(&app)?, &bootstrap)?;
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub(crate) fn recovery_rollback_previous(app: AppHandle) -> Result<(), String> {
    let default_root = DataRootResolver::default_root(&app)?;
    let bootstrap = read_bootstrap(&default_root.join(BOOTSTRAP_FILE_NAME))?
        .filter(|value| value.state == BootstrapState::Pending)
        .ok_or("進行中の保存場所変更に戻せる直前の保存場所がありません。")?;
    let previous = bootstrap
        .previous
        .ok_or("復旧できる直前の保存場所がありません。")?;
    let replacement = Bootstrap {
        version: 1,
        mode: previous.mode,
        data_root: previous.data_root,
        state: BootstrapState::Committed,
        transition_id: None,
        previous: None,
    };
    let root = match &replacement.mode {
        RootMode::Default => default_root.clone(),
        RootMode::Custom => replacement
            .data_root
            .clone()
            .ok_or("前のカスタム保存場所が不正です。")?,
    };
    validate_existing_root(&root)?;
    write_committed(&default_root, &replacement)?;
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub(crate) fn recovery_activate_last_good(app: AppHandle) -> Result<(), String> {
    let default_root = DataRootResolver::default_root(&app)?;
    let bootstrap = last_good(&default_root)?
        .filter(|value| value.state == BootstrapState::Committed && value.mode == RootMode::Custom)
        .ok_or("利用できる最後の正常なカスタム保存場所がありません。")?;
    let root = bootstrap
        .data_root
        .clone()
        .ok_or("最後の正常な保存場所の指定が不正です。")?;
    validate_existing_root(&root)?;
    write_committed(&default_root, &bootstrap)?;
    app.request_restart();
    Ok(())
}

async fn migrate_to_root(
    app: &AppHandle,
    database: &ActiveDatabase,
    destination_root: PathBuf,
    destination_mode: RootMode,
) -> Result<(), String> {
    migrate_to_root_at(
        DataRootResolver::default_root(app)?,
        database,
        destination_root,
        destination_mode,
    )
    .await
}

async fn migrate_to_root_at(
    default_root: PathBuf,
    database: &ActiveDatabase,
    destination_root: PathBuf,
    destination_mode: RootMode,
) -> Result<(), String> {
    migrate_to_root_inner(
        default_root,
        database,
        destination_root,
        destination_mode,
        #[cfg(test)]
        None,
    )
    .await
}

#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum MigrationFault {
    Snapshot,
    TemporaryValidation,
    TargetFinalize,
    TargetValidation,
    PendingBootstrap,
}

#[cfg(test)]
async fn migrate_to_root_at_with_fault(
    default_root: PathBuf,
    database: &ActiveDatabase,
    destination_root: PathBuf,
    destination_mode: RootMode,
    fault: MigrationFault,
) -> Result<(), String> {
    migrate_to_root_inner(
        default_root,
        database,
        destination_root,
        destination_mode,
        Some(fault),
    )
    .await
}

async fn migrate_to_root_inner(
    default_root: PathBuf,
    database: &ActiveDatabase,
    destination_root: PathBuf,
    destination_mode: RootMode,
    #[cfg(test)] fault: Option<MigrationFault>,
) -> Result<(), String> {
    let source_root = database
        .database_path()
        .parent()
        .ok_or("Active database has no parent")?
        .to_path_buf();
    if same_path(&source_root, &destination_root)? {
        return Err("現在と同じ保存場所は選択できません。".into());
    }
    if destination_mode == RootMode::Custom {
        validate_new_destination(&destination_root, &source_root)?;
    } else {
        validate_default_destination(&destination_root, &source_root)?;
    }
    let target = destination_root.join(DATABASE_FILE_NAME);
    if destination_mode == RootMode::Default && target.exists() {
        validate_application_database(&target).await?;
    }
    let temporary = destination_root.join(format!(
        ".dol-progress-migration-{}.sqlite3",
        unique_suffix()
    ));
    let previous = PreviousRoot {
        mode: if same_path(&source_root, &default_root)? {
            RootMode::Default
        } else {
            RootMode::Custom
        },
        data_root: if same_path(&source_root, &default_root)? {
            None
        } else {
            Some(source_root.clone())
        },
    };
    database
        .with_root_transition(|_, pool| {
            let target = target.clone();
            let temporary = temporary.clone();
            let destination_root = destination_root.clone();
            let default_root = default_root.clone();
            let previous = previous.clone();
            let destination_mode = destination_mode.clone();
            Box::pin(async move {
                #[cfg(test)]
                if fault == Some(MigrationFault::Snapshot) {
                    return Err("Injected migration snapshot failure".into());
                }
                snapshot_pool_into(pool, &temporary).await?;
                #[cfg(test)]
                if fault == Some(MigrationFault::TemporaryValidation) {
                    return Err("Injected temporary validation failure".into());
                }
                validate_application_database(&temporary).await?;
                let safety = if target.exists() {
                    let value = destination_root.join(format!(
                        "dol-progress.before-switch-{}.sqlite3",
                        unique_suffix()
                    ));
                    fs::rename(&target, &value).map_err(|error| error.to_string())?;
                    Some(value)
                } else {
                    None
                };
                #[cfg(test)]
                if fault == Some(MigrationFault::TargetFinalize) {
                    if let Some(safety) = safety {
                        let _ = fs::rename(safety, &target);
                    }
                    return Err("Injected target finalize failure".into());
                }
                if let Err(error) = replace_staged_database(&temporary, &target) {
                    if let Some(safety) = safety {
                        let _ = fs::rename(safety, &target);
                    }
                    return Err(error);
                }
                let target_validation = async {
                    #[cfg(test)]
                    if fault == Some(MigrationFault::TargetValidation) {
                        return Err("Injected target validation failure".into());
                    }
                    validate_application_database(&target).await
                }
                .await;
                if let Err(error) = target_validation {
                    if let Some(safety) = safety {
                        let _ = fs::remove_file(&target);
                        let _ = fs::rename(safety, &target);
                    }
                    return Err(error);
                }
                let pending = Bootstrap {
                    version: 1,
                    mode: destination_mode,
                    data_root: if target.parent() == Some(default_root.as_path()) {
                        None
                    } else {
                        target.parent().map(Path::to_path_buf)
                    },
                    state: BootstrapState::Pending,
                    transition_id: Some(unique_suffix()),
                    previous: Some(previous),
                };
                #[cfg(test)]
                if fault == Some(MigrationFault::PendingBootstrap) {
                    return Err("Injected pending bootstrap failure".into());
                }
                write_pending(&default_root, &pending)
            })
        })
        .await
}

fn validate_default_destination(root: &Path, source: &Path) -> Result<(), String> {
    if same_path(root, source)? {
        return Err("現在と同じ保存場所は選択できません。".into());
    }
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    validate_directory_writable(root)
}

fn validate_new_destination(root: &Path, source: &Path) -> Result<(), String> {
    validate_local_root(root)?;
    if paths_overlap(root, source)? {
        return Err("移行元と移行先が重なる保存場所は選択できません。".into());
    }
    if fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .next()
        .is_some()
    {
        return Err("新しい保存場所には空のディレクトリを選択してください。".into());
    }
    validate_directory_writable(root)
}

fn validate_existing_root(root: &Path) -> Result<(), String> {
    validate_local_root(root)?;
    let db = root.join(DATABASE_FILE_NAME);
    futures_block(validate_application_database(&db)).map(|_| ())
}

fn futures_block<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tauri::async_runtime::block_on(future)
}

fn validate_local_root(root: &Path) -> Result<(), String> {
    if !root.is_absolute() || root.parent().is_none() {
        return Err("絶対パスの通常ディレクトリを選択してください。".into());
    }
    #[cfg(windows)]
    ensure_no_reparse_points(root)?;
    let normalized = root.canonicalize().map_err(|error| error.to_string())?;
    if normalized.parent().is_none() {
        return Err("ドライブのルートは選択できません。".into());
    }
    let lower = normalized.to_string_lossy().to_ascii_lowercase();
    if lower.contains("\\program files") || lower.contains("\\program files (x86)") {
        return Err("Program Files 配下は選択できません。".into());
    }
    if let Ok(executable) = std::env::current_exe().and_then(|value| {
        value
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| std::io::Error::other("No executable directory"))
    }) {
        if same_path(&normalized, &executable)? {
            return Err("アプリケーション本体のディレクトリは選択できません。".into());
        }
    }
    #[cfg(windows)]
    windows_validate_root(root)?;
    Ok(())
}

#[cfg(windows)]
fn windows_validate_root(root: &Path) -> Result<(), String> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::{
        Storage::FileSystem::{GetDriveTypeW, GetVolumeInformationW},
        System::WindowsProgramming::DRIVE_FIXED,
    };
    let drive_letter = local_drive_letter(root)?;
    let drive = format!("{drive_letter}:\\");
    let drive_wide: Vec<u16> = OsStr::new(&drive).encode_wide().chain(Some(0)).collect();
    let drive_type = unsafe { GetDriveTypeW(drive_wide.as_ptr()) };
    let mut fs_name = [0u16; 64];
    let result = unsafe {
        GetVolumeInformationW(
            drive_wide.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            fs_name.as_mut_ptr(),
            fs_name.len() as u32,
        )
    };
    if result == 0 {
        return Err("NTFS のローカル固定ドライブを選択してください。".into());
    }
    validate_windows_volume(
        drive_type,
        String::from_utf16_lossy(&fs_name).trim_end_matches('\0'),
        DRIVE_FIXED,
    )
}

#[cfg(windows)]
fn validate_windows_volume(
    drive_type: u32,
    filesystem: &str,
    fixed_drive_type: u32,
) -> Result<(), String> {
    if drive_type != fixed_drive_type {
        return Err("ローカル固定ドライブを選択してください。".into());
    }
    if !filesystem.eq_ignore_ascii_case("NTFS") {
        return Err("NTFS のローカル固定ドライブを選択してください。".into());
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_no_reparse_points(root: &Path) -> Result<(), String> {
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileAttributesW, FILE_ATTRIBUTE_REPARSE_POINT, INVALID_FILE_ATTRIBUTES,
    };

    ensure_no_reparse_points_with(
        root,
        |path| {
            let wide = wide_path(path);
            let attributes = unsafe { GetFileAttributesW(wide.as_ptr()) };
            if attributes == INVALID_FILE_ATTRIBUTES {
                Err(std::io::Error::last_os_error().to_string())
            } else {
                Ok(attributes)
            }
        },
        FILE_ATTRIBUTE_REPARSE_POINT,
    )
}

#[cfg(windows)]
fn ensure_no_reparse_points_with(
    root: &Path,
    mut attributes: impl FnMut(&Path) -> Result<u32, String>,
    reparse_flag: u32,
) -> Result<(), String> {
    for ancestor in root.ancestors() {
        if attributes(ancestor)? & reparse_flag != 0 {
            return Err(
                "シンボリックリンクまたはジャンクションを含む保存場所は選択できません。".into(),
            );
        }
    }
    Ok(())
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Vec<u16> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

    OsStr::new(path.as_os_str())
        .encode_wide()
        .chain(Some(0))
        .collect()
}

/// `canonicalize` may produce `\\?\D:\...`; that is a local verbatim-disk
/// prefix, not a UNC path. Drive type is checked separately below.
#[cfg(windows)]
fn local_drive_letter(root: &Path) -> Result<char, String> {
    use std::path::{Component, Prefix};

    let Some(Component::Prefix(prefix)) = root.components().next() else {
        return Err("Windows ドライブ文字を含む絶対パスを選択してください。".into());
    };
    match prefix.kind() {
        Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => Ok(letter as char),
        Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _) => {
            Err("ネットワーク共有は選択できません。".into())
        }
        Prefix::DeviceNS(_) => Err("デバイス名前空間は選択できません。".into()),
        Prefix::Verbatim(_) => Err("未対応のverbatimパスは選択できません。".into()),
    }
}

fn validate_directory_writable(root: &Path) -> Result<(), String> {
    let probe = root.join(format!(".dol-progress-write-probe-{}", unique_suffix()));
    let renamed = root.join(format!(
        ".dol-progress-write-probe-{}-renamed",
        unique_suffix()
    ));
    fs::write(&probe, b"probe").map_err(|error| error.to_string())?;
    fs::rename(&probe, &renamed).map_err(|error| error.to_string())?;
    fs::remove_file(renamed).map_err(|error| error.to_string())
}
fn local_directory(path: FilePath) -> Result<PathBuf, String> {
    match path {
        FilePath::Path(path) => Ok(path),
        FilePath::Url(url) => Err(format!("ローカルディレクトリだけを選択してください: {url}")),
    }
}
fn same_path(first: &Path, second: &Path) -> Result<bool, String> {
    let first = first.canonicalize().map_err(|error| error.to_string())?;
    let second = second.canonicalize().map_err(|error| error.to_string())?;
    #[cfg(windows)]
    {
        Ok(first
            .to_string_lossy()
            .eq_ignore_ascii_case(&second.to_string_lossy()))
    }
    #[cfg(not(windows))]
    {
        Ok(first == second)
    }
}

fn paths_overlap(first: &Path, second: &Path) -> Result<bool, String> {
    let first = first.canonicalize().map_err(|error| error.to_string())?;
    let second = second.canonicalize().map_err(|error| error.to_string())?;
    Ok(path_is_same_or_child(&first, &second) || path_is_same_or_child(&second, &first))
}

fn path_is_same_or_child(candidate: &Path, ancestor: &Path) -> bool {
    #[cfg(windows)]
    {
        let candidate = candidate.to_string_lossy();
        let ancestor = ancestor.to_string_lossy();
        let ancestor = ancestor.trim_end_matches(['\\', '/']);
        candidate.eq_ignore_ascii_case(ancestor)
            || candidate
                .get(..ancestor.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(ancestor))
                && candidate
                    .as_bytes()
                    .get(ancestor.len())
                    .is_some_and(|value| *value == b'\\' || *value == b'/')
    }
    #[cfg(not(windows))]
    {
        candidate == ancestor || candidate.starts_with(ancestor)
    }
}
fn unique_suffix() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_nanos());
    format!("{now}-{}", UNIQUE_ID.fetch_add(1, Ordering::Relaxed))
}

fn read_bootstrap(path: &Path) -> Result<Option<Bootstrap>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let text =
        fs::read_to_string(path).map_err(|error| format!("保存場所設定を読めません: {error}"))?;
    let value: Bootstrap = serde_json::from_str(&text)
        .map_err(|error| format!("保存場所設定が壊れています: {error}"))?;
    validate_bootstrap(&value)?;
    Ok(Some(value))
}

fn validate_bootstrap(value: &Bootstrap) -> Result<(), String> {
    if value.version != 1 {
        return Err("対応していない保存場所設定のバージョンです。".into());
    }
    validate_root_locator(&value.mode, value.data_root.as_deref())?;
    if value.state == BootstrapState::Pending
        && (value.transition_id.as_deref().is_none_or(str::is_empty) || value.previous.is_none())
    {
        return Err("進行中の保存場所設定に復旧情報がありません。".into());
    }
    if value.state == BootstrapState::Committed && value.previous.is_some() {
        return Err("確定済みの保存場所設定に復旧情報が残っています。".into());
    }
    if let Some(previous) = &value.previous {
        validate_root_locator(&previous.mode, previous.data_root.as_deref())?;
    }
    Ok(())
}

fn validate_root_locator(mode: &RootMode, root: Option<&Path>) -> Result<(), String> {
    match (mode, root) {
        (RootMode::Default, None) | (RootMode::Custom, Some(_)) => Ok(()),
        (RootMode::Default, Some(_)) => {
            Err("標準保存場所設定にカスタムパスが含まれています。".into())
        }
        (RootMode::Custom, None) => Err("カスタム保存場所の指定がありません。".into()),
    }
}
fn last_good(root: &Path) -> Result<Option<Bootstrap>, String> {
    read_bootstrap(&root.join(LAST_GOOD_FILE_NAME))
}
fn write_pending(root: &Path, value: &Bootstrap) -> Result<(), String> {
    atomic_write(&root.join(BOOTSTRAP_FILE_NAME), value)
}
fn write_committed(root: &Path, value: &Bootstrap) -> Result<(), String> {
    atomic_write(&root.join(BOOTSTRAP_FILE_NAME), value)?;
    atomic_write(&root.join(LAST_GOOD_FILE_NAME), value)
}
fn atomic_write(path: &Path, value: &Bootstrap) -> Result<(), String> {
    atomic_write_with(path, value, |_| Ok(()))
}

#[derive(Clone, Copy)]
enum AtomicWriteStage {
    TempWrite,
    TempSync,
    Replace,
}

fn atomic_write_with(
    path: &Path,
    value: &Bootstrap,
    before_stage: impl Fn(AtomicWriteStage) -> Result<(), String>,
) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Bootstrap has no parent")?)
        .map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("tmp-{}", unique_suffix()));
    let text = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    before_stage(AtomicWriteStage::TempWrite)?;
    file.write_all(&text).map_err(|error| error.to_string())?;
    before_stage(AtomicWriteStage::TempSync)?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    read_bootstrap(&temporary)?;
    before_stage(AtomicWriteStage::Replace)?;
    if path.exists() {
        replace_existing_bootstrap(&temporary, path)?;
    } else {
        fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn replace_existing_bootstrap(temporary: &Path, path: &Path) -> Result<(), String> {
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    let replaced = wide_path(path);
    let replacement = wide_path(temporary);
    let result = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_existing_bootstrap(temporary: &Path, path: &Path) -> Result<(), String> {
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn recovery_with_last_good(message: impl Into<String>, default_root: &Path) -> RecoveryInfo {
    let last_good = last_good(default_root).ok().flatten();
    RecoveryInfo {
        message: message.into(),
        configured_root: last_good
            .as_ref()
            .and_then(|value| value.data_root.as_ref())
            .map(|root| root.display().to_string()),
        last_good_available: last_good.is_some_and(|value| {
            value.state == BootstrapState::Committed && value.mode == RootMode::Custom
        }),
        pending_previous_available: false,
    }
}

fn recovery_for_bootstrap(
    message: impl Into<String>,
    bootstrap: &Bootstrap,
    default_root: &Path,
) -> RecoveryInfo {
    let last_good = last_good(default_root).ok().flatten();
    RecoveryInfo {
        message: message.into(),
        configured_root: bootstrap
            .data_root
            .as_ref()
            .map(|root| root.display().to_string()),
        last_good_available: last_good.is_some_and(|value| {
            value.state == BootstrapState::Committed && value.mode == RootMode::Custom
        }),
        pending_previous_available: bootstrap.state == BootstrapState::Pending
            && bootstrap.previous.is_some(),
    }
}
fn recovery(detail: impl Into<String>) -> RecoveryInfo {
    RecoveryInfo {
        message: detail.into(),
        configured_root: None,
        last_good_available: false,
        pending_previous_available: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};

    struct Harness {
        root: PathBuf,
        default_root: PathBuf,
        custom_a: PathBuf,
        custom_b: PathBuf,
    }

    impl Harness {
        fn new(label: &str) -> Self {
            let root = test_root(label);
            let default_root = root.join("AppConfig");
            let custom_a = root.join("CustomA");
            let custom_b = root.join("CustomB");
            fs::create_dir_all(&custom_a).unwrap();
            fs::create_dir_all(&custom_b).unwrap();
            Self {
                root,
                default_root,
                custom_a,
                custom_b,
            }
        }

        fn default_db(&self) -> PathBuf {
            self.default_root.join(DATABASE_FILE_NAME)
        }

        fn custom_a_db(&self) -> PathBuf {
            self.custom_a.join(DATABASE_FILE_NAME)
        }

        fn custom_b_db(&self) -> PathBuf {
            self.custom_b.join(DATABASE_FILE_NAME)
        }

        fn cleanup(self) {
            let _ = fs::remove_dir_all(self.root);
        }
    }

    async fn seed_fixture(database: &ActiveDatabase, marker: &str) {
        let pool = database.pool().await;
        sqlx::raw_sql(&format!(
            "INSERT INTO profiles (id, name, memo) VALUES (1, 'Profile A', '{marker}');\
             INSERT INTO discovery_categories (id, name, sort_order) VALUES (1, 'History', 1);\
             INSERT INTO quests (id, gvdb_id, title, raw_row_json) VALUES\
               (1, 1001, 'Quest A', '{{}}'), (2, 1002, 'Quest B', '{{}}'), (3, 1003, 'Quest C', '{{}}');\
             INSERT INTO discoveries (id, gvdb_id, category_id, name, raw_row_json) VALUES\
               (1, 2001, 1, 'Discovery A', '{{}}'), (2, 2002, 1, 'Discovery B', '{{}}'), (3, 2003, 1, 'Discovery C', '{{}}');\
             INSERT INTO quest_discoveries (quest_id, discovery_id) VALUES (1, 1), (2, 2), (3, 3);\
             INSERT INTO quest_dependencies (quest_id, prerequisite_quest_id) VALUES (2, 1);\
             INSERT INTO quest_required_skills (quest_id, position, skill_name, required_rank, is_language) VALUES (1, 0, 'Search', 2, 0);\
             INSERT INTO quest_offer_cities (quest_id, position, city_name) VALUES (1, 0, 'Lisbon');\
             INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, 1, 'Quest progress A');\
             INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo) VALUES\
               (1, 1, 0, 1, 'unreported card'), (1, 2, 1, 0, 'reported no card');\
             INSERT INTO master_import_history (dataset, file_name, file_sha256, row_count, notes) VALUES\
               ('quests', 'fixture.tsv', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2, 'fixture');"
        ))
        .execute(&*pool)
        .await
        .unwrap();
    }

    async fn add_profile_marker(database: &ActiveDatabase, marker: &str) {
        let pool = database.pool().await;
        sqlx::query("INSERT INTO profiles (name, memo) VALUES (?, ?)")
            .bind(marker)
            .bind(marker)
            .execute(&*pool)
            .await
            .unwrap();
    }

    async fn complete_linked_quest(database: &ActiveDatabase) {
        let pool = database.pool().await;
        let mut connection = pool.acquire().await.unwrap();
        crate::progress_link::complete_quest(&mut connection, 1, 3)
            .await
            .unwrap();
    }

    async fn import_quest_through_active_pool(database: &ActiveDatabase) {
        let request = serde_json::from_value(serde_json::json!({
            "dataset": "quests",
            "fileName": "isolated-custom-import.csv",
            "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "quests": [{
                "gvdbId": 1001,
                "title": "Quest A imported through active pool",
                "difficulty": null,
                "chronoQuest": null,
                "offerMethod": null,
                "offerCity": "Lisbon",
                "requiredSkills": "Search 2",
                "discoveryTypeText": null,
                "discoveryName": null,
                "rewardItems": null,
                "notes": null,
                "sourceUpdatedAt": null,
                "chainName": null,
                "chainOrder": null,
                "sourceOrder": 0,
                "prerequisites": [],
                "dependents": [],
                "rawRowJson": "{}"
            }],
            "discoveries": [],
            "warnings": []
        }))
        .unwrap();
        let pool = database.pool().await;
        let mut connection = pool.acquire().await.unwrap();
        crate::import::apply_import_for_test(&mut connection, request)
            .await
            .unwrap();
    }

    async fn open_snapshot_pool(path: &Path) -> SqlitePool {
        SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(false)
                .foreign_keys(true),
        )
        .await
        .unwrap()
    }

    async fn logical_snapshot(path: &Path) -> Vec<String> {
        let pool = open_snapshot_pool(path).await;
        let queries = [
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%s:%s', id, name, coalesce(memo,'')) AS value FROM profiles ORDER BY id)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%d:%s', id, gvdb_id, title) AS value FROM quests ORDER BY id)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%d:%s', id, gvdb_id, name) AS value FROM discoveries ORDER BY id)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%d:%s', profile_id, quest_id, coalesce(memo,'')) AS value FROM quest_progress ORDER BY profile_id, quest_id)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%d:%d:%d:%s', profile_id, discovery_id, reported, card_owned, coalesce(memo,'')) AS value FROM discovery_progress ORDER BY profile_id, discovery_id)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%d', quest_id, discovery_id) AS value FROM quest_discoveries ORDER BY quest_id, discovery_id)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%d', quest_id, prerequisite_quest_id) AS value FROM quest_dependencies ORDER BY quest_id, prerequisite_quest_id)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%d:%s:%d:%d', quest_id, position, skill_name, coalesce(required_rank, 0), is_language) AS value FROM quest_required_skills ORDER BY quest_id, position)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%d:%s', quest_id, position, city_name) AS value FROM quest_offer_cities ORDER BY quest_id, position)",
            "SELECT group_concat(value, '|') FROM (SELECT printf('%d:%s:%d:%s', version, description, success, hex(checksum)) AS value FROM _sqlx_migrations ORDER BY version)",
        ];
        let mut snapshot = Vec::new();
        for query in queries {
            snapshot.push(
                sqlx::query_scalar::<_, Option<String>>(query)
                    .fetch_one(&pool)
                    .await
                    .unwrap()
                    .unwrap_or_default(),
            );
        }
        pool.close().await;
        snapshot
    }

    async fn assert_integrity(path: &Path) {
        let pool = open_snapshot_pool(path).await;
        let quick: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&pool)
            .await
            .unwrap();
        let foreign: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(quick, "ok");
        assert_eq!(foreign, 0);
        pool.close().await;
    }

    async fn create_valid_database(root: &Path) {
        let database = ActiveDatabase::open(root.join(DATABASE_FILE_NAME))
            .await
            .unwrap();
        {
            let pool = database.pool().await;
            crate::migrations::run(&pool).await.unwrap();
        }
        drop(database);
    }

    fn pending_custom(root: PathBuf, previous: PreviousRoot) -> Bootstrap {
        Bootstrap {
            version: 1,
            mode: RootMode::Custom,
            data_root: Some(root),
            state: BootstrapState::Pending,
            transition_id: Some("pending-test".into()),
            previous: Some(previous),
        }
    }

    #[tokio::test]
    async fn isolated_default_custom_custom_transition_preserves_logical_data_and_inactive_sources()
    {
        let harness = Harness::new("default-custom-custom");
        let (default_database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&default_database, "default-old").await;
        let default_before = logical_snapshot(&harness.default_db()).await;

        migrate_to_root_at(
            harness.default_root.clone(),
            &default_database,
            harness.custom_a.clone(),
            RootMode::Custom,
        )
        .await
        .unwrap();
        assert_eq!(
            read_bootstrap(&harness.default_root.join(BOOTSTRAP_FILE_NAME))
                .unwrap()
                .unwrap()
                .state,
            BootstrapState::Pending
        );
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );
        drop(default_database);

        let (custom_a, info) = initialize_at(&harness.default_root).await.unwrap();
        assert_eq!(info.mode, "custom");
        assert_eq!(
            logical_snapshot(&harness.custom_a_db()).await,
            default_before
        );
        assert_integrity(&harness.custom_a_db()).await;
        add_profile_marker(&custom_a, "post-custom-a").await;
        complete_linked_quest(&custom_a).await;
        import_quest_through_active_pool(&custom_a).await;
        let custom_a_before_move = logical_snapshot(&harness.custom_a_db()).await;
        assert!(custom_a_before_move
            .iter()
            .any(|rows| rows.contains("1:3:")));
        assert!(custom_a_before_move
            .iter()
            .any(|rows| rows.contains("1:3:0:1:")));
        assert!(custom_a_before_move
            .iter()
            .any(|rows| rows.contains("Quest A imported through active pool")));
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );

        migrate_to_root_at(
            harness.default_root.clone(),
            &custom_a,
            harness.custom_b.clone(),
            RootMode::Custom,
        )
        .await
        .unwrap();
        drop(custom_a);
        let (custom_b, info) = initialize_at(&harness.default_root).await.unwrap();
        assert_eq!(info.data_root, harness.custom_b.display().to_string());
        assert_eq!(
            logical_snapshot(&harness.custom_b_db()).await,
            custom_a_before_move
        );
        add_profile_marker(&custom_b, "post-custom-b").await;
        assert_eq!(
            logical_snapshot(&harness.custom_a_db()).await,
            custom_a_before_move
        );
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );
        assert_integrity(&harness.custom_b_db()).await;
        drop(custom_b);
        harness.cleanup();
    }

    #[tokio::test]
    async fn isolated_custom_default_transition_retains_old_default_as_safety_copy() {
        let harness = Harness::new("custom-default");
        let (default_database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&default_database, "old-default-only").await;
        let old_default = logical_snapshot(&harness.default_db()).await;
        migrate_to_root_at(
            harness.default_root.clone(),
            &default_database,
            harness.custom_a.clone(),
            RootMode::Custom,
        )
        .await
        .unwrap();
        drop(default_database);
        let (custom_a, _) = initialize_at(&harness.default_root).await.unwrap();
        add_profile_marker(&custom_a, "latest-custom-only").await;
        let latest_custom = logical_snapshot(&harness.custom_a_db()).await;

        migrate_to_root_at(
            harness.default_root.clone(),
            &custom_a,
            harness.default_root.clone(),
            RootMode::Default,
        )
        .await
        .unwrap();
        drop(custom_a);
        let (default_database, info) = initialize_at(&harness.default_root).await.unwrap();
        assert_eq!(info.mode, "default");
        assert_eq!(logical_snapshot(&harness.default_db()).await, latest_custom);
        assert_eq!(
            logical_snapshot(&harness.custom_a_db()).await,
            latest_custom
        );
        let safety = fs::read_dir(&harness.default_root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("dol-progress.before-switch-"))
            })
            .expect("old Default safety copy");
        assert_eq!(logical_snapshot(&safety).await, old_default);
        assert_integrity(&harness.default_db()).await;
        drop(default_database);
        harness.cleanup();
    }

    #[tokio::test]
    async fn isolated_custom_backup_restore_stays_local_to_active_root() {
        let harness = Harness::new("custom-backup-restore");
        let (default_database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&default_database, "default-source").await;
        let default_before = logical_snapshot(&harness.default_db()).await;
        migrate_to_root_at(
            harness.default_root.clone(),
            &default_database,
            harness.custom_a.clone(),
            RootMode::Custom,
        )
        .await
        .unwrap();
        drop(default_database);
        let (custom_a, _) = initialize_at(&harness.default_root).await.unwrap();
        let backup = harness.root.join("custom-backup.sqlite3");
        {
            let pool = custom_a.pool().await;
            snapshot_pool_into(&pool, &backup).await.unwrap();
        }
        let backup_snapshot = logical_snapshot(&backup).await;
        add_profile_marker(&custom_a, "after-backup").await;
        custom_a
            .with_maintenance(|current| {
                let backup = backup.clone();
                let current = current.to_path_buf();
                async move {
                    crate::backup_restore::restore_backup(&current, &backup)
                        .await
                        .map_err(|_| "restore failed".to_string())
                }
            })
            .await
            .unwrap();
        assert_eq!(
            logical_snapshot(&harness.custom_a_db()).await,
            backup_snapshot
        );
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );
        assert_eq!(
            read_bootstrap(&harness.default_root.join(BOOTSTRAP_FILE_NAME))
                .unwrap()
                .unwrap()
                .mode,
            RootMode::Custom
        );
        assert_integrity(&harness.custom_a_db()).await;
        drop(custom_a);
        harness.cleanup();
    }

    async fn assert_faulted_transition_preserves_active_source(fault: MigrationFault) {
        let harness = Harness::new("transition-fault");
        let (database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&database, "source-before-fault").await;
        let source_before = logical_snapshot(&harness.default_db()).await;

        let error = migrate_to_root_at_with_fault(
            harness.default_root.clone(),
            &database,
            harness.custom_a.clone(),
            RootMode::Custom,
            fault,
        )
        .await
        .expect_err("the injected transition fault must fail");
        assert!(error.contains("Injected"));
        assert_eq!(logical_snapshot(&harness.default_db()).await, source_before);
        add_profile_marker(&database, "source-remains-active").await;
        assert!(logical_snapshot(&harness.default_db())
            .await
            .iter()
            .any(|rows| rows.contains("source-remains-active")));
        assert!(
            read_bootstrap(&harness.default_root.join(BOOTSTRAP_FILE_NAME))
                .unwrap()
                .is_none()
        );

        drop(database);
        let (_, info) = initialize_at(&harness.default_root).await.unwrap();
        assert_eq!(info.mode, "default");
        harness.cleanup();
    }

    #[tokio::test]
    async fn isolated_transition_faults_keep_source_active_and_unregistered_target_inactive() {
        for fault in [
            MigrationFault::Snapshot,
            MigrationFault::TemporaryValidation,
            MigrationFault::TargetFinalize,
            MigrationFault::TargetValidation,
            MigrationFault::PendingBootstrap,
        ] {
            assert_faulted_transition_preserves_active_source(fault).await;
        }
    }

    #[tokio::test]
    async fn finalized_target_without_pending_bootstrap_is_never_silently_adopted() {
        let harness = Harness::new("orphan-target");
        let (database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&database, "source-before-orphan").await;
        let source_before = logical_snapshot(&harness.default_db()).await;

        migrate_to_root_at_with_fault(
            harness.default_root.clone(),
            &database,
            harness.custom_a.clone(),
            RootMode::Custom,
            MigrationFault::PendingBootstrap,
        )
        .await
        .expect_err("pending bootstrap fault must leave an orphan target");
        assert!(harness.custom_a_db().is_file());
        assert_eq!(
            logical_snapshot(&harness.custom_a_db()).await,
            source_before
        );
        assert!(validate_new_destination(&harness.custom_a, &harness.default_root).is_err());

        drop(database);
        let (_, info) = initialize_at(&harness.default_root).await.unwrap();
        assert_eq!(info.mode, "default");
        assert_eq!(logical_snapshot(&harness.default_db()).await, source_before);
        harness.cleanup();
    }

    #[tokio::test]
    async fn concurrent_root_transitions_create_only_one_pending_bootstrap_and_retire_source() {
        let harness = Harness::new("double-transition");
        let (database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&database, "double-transition-source").await;
        let source_before = logical_snapshot(&harness.default_db()).await;

        let first = migrate_to_root_at(
            harness.default_root.clone(),
            &database,
            harness.custom_a.clone(),
            RootMode::Custom,
        );
        let second = migrate_to_root_at(
            harness.default_root.clone(),
            &database,
            harness.custom_b.clone(),
            RootMode::Custom,
        );
        let (first, second) = tokio::join!(first, second);
        assert_ne!(first.is_ok(), second.is_ok());
        assert_eq!(logical_snapshot(&harness.default_db()).await, source_before);
        let pending = read_bootstrap(&harness.default_root.join(BOOTSTRAP_FILE_NAME))
            .unwrap()
            .expect("exactly one transition must have written pending bootstrap");
        assert_eq!(pending.state, BootstrapState::Pending);
        let successful_root = if first.is_ok() {
            &harness.custom_a
        } else {
            &harness.custom_b
        };
        assert_eq!(
            pending.data_root.as_deref(),
            Some(successful_root.as_path())
        );
        assert!(database
            .with_maintenance(|_| async { Ok(()) })
            .await
            .expect_err("retired source must not be reopened")
            .contains("再起動"));

        drop(database);
        let (_, info) = initialize_at(&harness.default_root).await.unwrap();
        assert_eq!(info.data_root, successful_root.display().to_string());
        harness.cleanup();
    }

    #[tokio::test]
    async fn custom_to_default_target_fault_restores_existing_default_and_keeps_custom_active() {
        for fault in [
            MigrationFault::TargetFinalize,
            MigrationFault::TargetValidation,
        ] {
            let harness = Harness::new("default-target-fault");
            let (default_database, _) = initialize_at(&harness.default_root).await.unwrap();
            seed_fixture(&default_database, "old-default-target").await;
            let old_default = logical_snapshot(&harness.default_db()).await;
            migrate_to_root_at(
                harness.default_root.clone(),
                &default_database,
                harness.custom_a.clone(),
                RootMode::Custom,
            )
            .await
            .unwrap();
            drop(default_database);
            let (custom_a, _) = initialize_at(&harness.default_root).await.unwrap();
            add_profile_marker(&custom_a, "custom-must-remain-active").await;
            let custom_before = logical_snapshot(&harness.custom_a_db()).await;

            migrate_to_root_at_with_fault(
                harness.default_root.clone(),
                &custom_a,
                harness.default_root.clone(),
                RootMode::Default,
                fault,
            )
            .await
            .expect_err("target fault must fail without committing a root switch");
            assert_eq!(logical_snapshot(&harness.default_db()).await, old_default);
            assert_eq!(
                logical_snapshot(&harness.custom_a_db()).await,
                custom_before
            );
            add_profile_marker(&custom_a, "custom-still-writable").await;
            assert!(logical_snapshot(&harness.custom_a_db())
                .await
                .iter()
                .any(|rows| rows.contains("custom-still-writable")));
            assert_eq!(
                read_bootstrap(&harness.default_root.join(BOOTSTRAP_FILE_NAME))
                    .unwrap()
                    .unwrap()
                    .mode,
                RootMode::Custom
            );
            drop(custom_a);
            harness.cleanup();
        }
    }

    #[tokio::test]
    async fn invalid_existing_default_rejects_custom_to_default_without_changing_custom_source() {
        let harness = Harness::new("invalid-default-target");
        let (default_database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&default_database, "default-to-corrupt").await;
        migrate_to_root_at(
            harness.default_root.clone(),
            &default_database,
            harness.custom_a.clone(),
            RootMode::Custom,
        )
        .await
        .unwrap();
        drop(default_database);
        let (custom_a, _) = initialize_at(&harness.default_root).await.unwrap();
        let custom_before = logical_snapshot(&harness.custom_a_db()).await;
        fs::write(harness.default_db(), b"not a sqlite database").unwrap();

        migrate_to_root_at(
            harness.default_root.clone(),
            &custom_a,
            harness.default_root.clone(),
            RootMode::Default,
        )
        .await
        .expect_err("invalid existing Default database must be rejected");
        assert_eq!(
            logical_snapshot(&harness.custom_a_db()).await,
            custom_before
        );
        add_profile_marker(&custom_a, "custom-after-invalid-default").await;
        drop(custom_a);
        harness.cleanup();
    }

    #[tokio::test]
    async fn isolated_resolver_commits_valid_pending_target_and_rejects_invalid_target_without_fallback(
    ) {
        let harness = Harness::new("pending-resolver");
        let (default_database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&default_database, "default-before-pending").await;
        let default_before = logical_snapshot(&harness.default_db()).await;
        create_valid_database(&harness.custom_a).await;
        let pending = pending_custom(
            harness.custom_a.clone(),
            PreviousRoot {
                mode: RootMode::Default,
                data_root: None,
            },
        );
        write_pending(&harness.default_root, &pending).unwrap();
        drop(default_database);

        let (custom_database, info) = initialize_at(&harness.default_root).await.unwrap();
        assert_eq!(info.mode, "custom");
        assert_eq!(
            read_bootstrap(&harness.default_root.join(BOOTSTRAP_FILE_NAME))
                .unwrap()
                .unwrap()
                .state,
            BootstrapState::Committed
        );
        drop(custom_database);

        let invalid_pending = pending_custom(
            harness.custom_b.clone(),
            PreviousRoot {
                mode: RootMode::Custom,
                data_root: Some(harness.custom_a.clone()),
            },
        );
        write_pending(&harness.default_root, &invalid_pending).unwrap();
        let recovery = match initialize_at(&harness.default_root).await {
            Err(recovery) => recovery,
            Ok(_) => panic!("invalid pending target must enter recovery"),
        };
        assert!(recovery.pending_previous_available);
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );
        assert_eq!(
            read_bootstrap(&harness.default_root.join(BOOTSTRAP_FILE_NAME))
                .unwrap()
                .unwrap()
                .state,
            BootstrapState::Pending
        );
        harness.cleanup();
    }

    #[tokio::test]
    async fn isolated_resolver_uses_recovery_for_missing_or_invalid_primary_not_default_fallback() {
        let harness = Harness::new("last-good-resolver");
        let (default_database, _) = initialize_at(&harness.default_root).await.unwrap();
        seed_fixture(&default_database, "default-must-not-be-selected").await;
        let default_before = logical_snapshot(&harness.default_db()).await;
        create_valid_database(&harness.custom_a).await;
        let last_good = committed_custom(harness.custom_a.clone());
        write_committed(&harness.default_root, &last_good).unwrap();
        fs::remove_file(harness.default_root.join(BOOTSTRAP_FILE_NAME)).unwrap();

        let recovery = match initialize_at(&harness.default_root).await {
            Err(recovery) => recovery,
            Ok(_) => panic!("missing primary must enter recovery"),
        };
        assert!(recovery.last_good_available);
        assert!(!recovery.pending_previous_available);
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );

        fs::write(harness.default_root.join(BOOTSTRAP_FILE_NAME), "{").unwrap();
        let recovery = match initialize_at(&harness.default_root).await {
            Err(recovery) => recovery,
            Ok(_) => panic!("malformed primary must enter recovery"),
        };
        assert!(recovery.last_good_available);
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );

        fs::remove_file(harness.custom_a_db()).unwrap();
        fs::remove_file(harness.default_root.join(BOOTSTRAP_FILE_NAME)).unwrap();
        let recovery = match initialize_at(&harness.default_root).await {
            Err(recovery) => recovery,
            Ok(_) => panic!("missing last-good database must remain in recovery"),
        };
        assert!(recovery.last_good_available);
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );

        fs::write(harness.default_root.join(LAST_GOOD_FILE_NAME), "{").unwrap();
        let recovery = match initialize_at(&harness.default_root).await {
            Err(recovery) => recovery,
            Ok(_) => panic!("invalid last-good must remain in recovery"),
        };
        assert!(!recovery.last_good_available);
        assert_eq!(
            logical_snapshot(&harness.default_db()).await,
            default_before
        );
        drop(default_database);
        harness.cleanup();
    }
    #[test]
    fn bootstrap_round_trip_and_legacy_are_distinct() {
        let root = std::env::temp_dir().join(format!("dol-root-bootstrap-{}", unique_suffix()));
        fs::create_dir_all(&root).unwrap();
        assert!(read_bootstrap(&root.join(BOOTSTRAP_FILE_NAME))
            .unwrap()
            .is_none());
        let value = Bootstrap {
            version: 1,
            mode: RootMode::Default,
            data_root: None,
            state: BootstrapState::Committed,
            transition_id: None,
            previous: None,
        };
        write_committed(&root, &value).unwrap();
        assert_eq!(
            read_bootstrap(&root.join(BOOTSTRAP_FILE_NAME)).unwrap(),
            Some(value)
        );
        fs::remove_dir_all(root).unwrap();
    }

    fn test_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("dol-root-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn committed_custom(root: PathBuf) -> Bootstrap {
        Bootstrap {
            version: 1,
            mode: RootMode::Custom,
            data_root: Some(root),
            state: BootstrapState::Committed,
            transition_id: Some("test-transition".into()),
            previous: None,
        }
    }

    #[test]
    fn missing_primary_distinguishes_legacy_from_last_good_recovery() {
        let root = test_root("missing-primary");
        assert!(!missing_primary_requires_recovery(&root));
        write_committed(
            &root,
            &committed_custom(PathBuf::from(r"D:\data\last-good")),
        )
        .unwrap();
        fs::remove_file(root.join(BOOTSTRAP_FILE_NAME)).unwrap();
        assert!(missing_primary_requires_recovery(&root));
        fs::write(root.join(LAST_GOOD_FILE_NAME), "{").unwrap();
        assert!(missing_primary_requires_recovery(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_or_unsupported_primary_keeps_last_good_as_a_separate_recovery_option() {
        let root = test_root("malformed-primary");
        let last_good_bootstrap = committed_custom(PathBuf::from(r"D:\data\last-good"));
        write_committed(&root, &last_good_bootstrap).unwrap();
        fs::write(root.join(BOOTSTRAP_FILE_NAME), "{").unwrap();
        assert!(read_bootstrap(&root.join(BOOTSTRAP_FILE_NAME)).is_err());
        let recovery = recovery_with_last_good("broken", &root);
        assert!(recovery.last_good_available);
        assert!(!recovery.pending_previous_available);
        fs::write(
            root.join(BOOTSTRAP_FILE_NAME),
            r#"{"version":2,"mode":"custom","dataRoot":"D:\\data\\last-good","state":"committed"}"#,
        )
        .unwrap();
        assert!(read_bootstrap(&root.join(BOOTSTRAP_FILE_NAME)).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_previous_and_last_good_are_not_the_same_recovery_action() {
        let root = test_root("pending-previous");
        let committed = committed_custom(PathBuf::from(r"D:\data\last-good"));
        write_committed(&root, &committed).unwrap();
        let pending = Bootstrap {
            version: 1,
            mode: RootMode::Custom,
            data_root: Some(PathBuf::from(r"D:\data\target")),
            state: BootstrapState::Pending,
            transition_id: Some("pending".into()),
            previous: Some(PreviousRoot {
                mode: RootMode::Default,
                data_root: None,
            }),
        };
        let pending_recovery = recovery_for_bootstrap("pending", &pending, &root);
        assert!(pending_recovery.last_good_available);
        assert!(pending_recovery.pending_previous_available);
        let committed_recovery = recovery_for_bootstrap("committed", &committed, &root);
        assert!(committed_recovery.last_good_available);
        assert!(!committed_recovery.pending_previous_available);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_write_failures_preserve_the_existing_primary() {
        let root = test_root("atomic-failures");
        let primary = root.join(BOOTSTRAP_FILE_NAME);
        let old = Bootstrap {
            version: 1,
            mode: RootMode::Default,
            data_root: None,
            state: BootstrapState::Committed,
            transition_id: None,
            previous: None,
        };
        let new = committed_custom(PathBuf::from(r"D:\data\new"));
        atomic_write(&primary, &old).unwrap();
        for stage in [
            AtomicWriteStage::TempWrite,
            AtomicWriteStage::TempSync,
            AtomicWriteStage::Replace,
        ] {
            assert!(atomic_write_with(&primary, &new, |current| {
                if std::mem::discriminant(&current) == std::mem::discriminant(&stage) {
                    Err("injected failure".into())
                } else {
                    Ok(())
                }
            })
            .is_err());
            assert_eq!(read_bootstrap(&primary).unwrap(), Some(old.clone()));
        }
        fs::remove_file(&primary).unwrap();
        assert!(atomic_write_with(&primary, &new, |stage| {
            if matches!(stage, AtomicWriteStage::Replace) {
                Err("injected initial creation rename failure".into())
            } else {
                Ok(())
            }
        })
        .is_err());
        assert!(read_bootstrap(&primary).unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_write_replaces_existing_primary_and_creates_missing_primary() {
        let root = test_root("atomic-replace");
        let primary = root.join(BOOTSTRAP_FILE_NAME);
        let old = Bootstrap {
            version: 1,
            mode: RootMode::Default,
            data_root: None,
            state: BootstrapState::Committed,
            transition_id: None,
            previous: None,
        };
        let new = committed_custom(PathBuf::from(r"D:\data\new"));
        atomic_write(&primary, &old).unwrap();
        atomic_write(&primary, &new).unwrap();
        assert_eq!(read_bootstrap(&primary).unwrap(), Some(new.clone()));
        fs::remove_file(&primary).unwrap();
        atomic_write(&primary, &old).unwrap();
        assert_eq!(read_bootstrap(&primary).unwrap(), Some(old));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_prefix_classification_accepts_local_and_verbatim_disks_only() {
        use windows_sys::Win32::System::WindowsProgramming::{
            DRIVE_FIXED, DRIVE_REMOTE, DRIVE_REMOVABLE,
        };

        assert_eq!(
            local_drive_letter(Path::new(r"D:\data\dol-progress-data")).unwrap(),
            'D'
        );
        assert_eq!(
            local_drive_letter(Path::new(r"\\?\D:\data\dol-progress-data")).unwrap(),
            'D'
        );
        assert!(local_drive_letter(Path::new(r"\\server\share\data")).is_err());
        assert!(local_drive_letter(Path::new(r"\\?\UNC\server\share\data")).is_err());
        assert!(local_drive_letter(Path::new(r"\\.\PhysicalDrive0")).is_err());
        assert!(local_drive_letter(Path::new(r"\\?\GLOBALROOT\Device\HarddiskVolume1")).is_err());
        assert!(validate_windows_volume(DRIVE_FIXED, "NTFS", DRIVE_FIXED).is_ok());
        assert!(validate_windows_volume(DRIVE_REMOTE, "NTFS", DRIVE_FIXED).is_err());
        assert!(validate_windows_volume(DRIVE_REMOVABLE, "NTFS", DRIVE_FIXED).is_err());
        assert!(validate_windows_volume(DRIVE_FIXED, "exFAT", DRIVE_FIXED).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_comparison_and_reparse_ancestor_check_are_alias_safe() {
        assert!(path_is_same_or_child(
            Path::new(r"D:\Data\Child"),
            Path::new(r"d:\data")
        ));
        assert!(!path_is_same_or_child(
            Path::new(r"D:\Database"),
            Path::new(r"D:\Data")
        ));
        let root = Path::new(r"D:\data\junction\child");
        ensure_no_reparse_points_with(
            root,
            |path| {
                Ok(u32::from(
                    path.to_string_lossy()
                        .eq_ignore_ascii_case(r"D:\data\junction"),
                ))
            },
            1,
        )
        .expect_err("a reparse ancestor must be rejected");

        ensure_no_reparse_points_with(root, |path| Ok(u32::from(path == root)), 1)
            .expect_err("a selected reparse point must be rejected");

        let directory = test_root("canonical-alias");
        let child = directory.join("child");
        fs::create_dir(&child).unwrap();
        let canonical = directory.canonicalize().unwrap();
        assert!(same_path(&directory, &canonical).unwrap());
        assert!(paths_overlap(&canonical, &child).unwrap());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn new_destination_requires_a_truly_empty_writable_directory() {
        let root = test_root("destination-empty");
        let source = root.join("source");
        fs::create_dir(&source).unwrap();
        let empty = root.join("empty");
        fs::create_dir(&empty).unwrap();
        validate_new_destination(&empty, &source).expect("an empty temporary directory is valid");

        for name in [
            ".hidden",
            "desktop.ini",
            "unrelated.txt",
            DATABASE_FILE_NAME,
            ".dol-progress-migration-partial.sqlite3",
        ] {
            let destination = root.join(format!("nonempty-{}", unique_suffix()));
            fs::create_dir(&destination).unwrap();
            fs::write(destination.join(name), b"artifact").unwrap();
            assert!(
                validate_new_destination(&destination, &source).is_err(),
                "{name}"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
}
