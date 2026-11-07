#[cfg(windows)]
use std::os::windows::io::{FromRawHandle, OwnedHandle};

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{GetLastError, SetLastError, ERROR_ALREADY_EXISTS, ERROR_SUCCESS},
    System::Threading::CreateMutexW,
};

#[cfg(windows)]
const MUTEX_NAME: &str = r"Local\com.dolprogress.manager.single-instance";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StartupError {
    AlreadyRunning,
    CreationFailed(u32),
}

impl StartupError {
    pub(crate) fn message(&self) -> String {
        match self {
            Self::AlreadyRunning => "アプリケーションは既に起動しています。".into(),
            Self::CreationFailed(code) => format!(
                "多重起動を防止するための確認に失敗したため、起動を中止しました。\n\nWindowsエラーコード: {code}"
            ),
        }
    }
}

pub(crate) fn run(startup: impl FnOnce()) -> Result<(), StartupError> {
    #[cfg(windows)]
    {
        run_with_name(MUTEX_NAME, startup)
    }
    #[cfg(not(windows))]
    {
        startup();
        Ok(())
    }
}

#[cfg(windows)]
fn run_with_name(name: &str, startup: impl FnOnce()) -> Result<(), StartupError> {
    let _instance = InstanceGuard::acquire(name)?;
    startup();
    Ok(())
}

// Mutexの所有権ではなくオブジェクトの存在を使う。wait/ReleaseMutexは行わない。
#[cfg(windows)]
#[derive(Debug)]
struct InstanceGuard {
    _handle: OwnedHandle,
}

#[cfg(windows)]
impl InstanceGuard {
    fn acquire(name: &str) -> Result<Self, StartupError> {
        let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        // SAFETY: nameは呼出し中有効な終端付きUTF-16。NULL属性でhandleを非継承にし、
        // bInitialOwner=FALSEで所有権を取得しない。last-errorは他のAPIを挟まず取得する。
        let (handle, error) = unsafe {
            SetLastError(ERROR_SUCCESS);
            let handle = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
            (handle, GetLastError())
        };
        if handle.is_null() {
            return Err(StartupError::CreationFailed(error));
        }
        // SAFETY: CreateMutexWが返した有効なhandleを一度だけ所有する。
        // OwnedHandleがCloseHandleを行う。重複時もErrを返す前に解放される。
        let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
        if error == ERROR_ALREADY_EXISTS {
            return Err(StartupError::AlreadyRunning);
        }
        Ok(Self { _handle: handle })
    }
}

#[cfg(all(test, windows))]
#[path = "single_instance_tests.rs"]
mod tests;
