use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

const GVDB_URL: &str = "https://gvdb.mydns.jp/db/";

#[tauri::command]
pub(crate) fn open_gvdb_site() -> Result<(), String> {
    open_fixed_url()
}

fn open_fixed_url() -> Result<(), String> {
    let wide_url: Vec<u16> = GVDB_URL.encode_utf16().chain(std::iter::once(0)).collect();
    let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    // Both UTF-16 buffers remain alive and NUL-terminated throughout the Windows call.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            wide_url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    check_shell_result(result as isize)
}

fn check_shell_result(result: isize) -> Result<(), String> {
    if result <= 32 {
        Err(format!(
            "既定ブラウザーを開けませんでした（Windows error: {result}）。"
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_url_and_shell_result_boundary() {
        assert_eq!(GVDB_URL, "https://gvdb.mydns.jp/db/");
        assert!(check_shell_result(32).is_err());
        assert!(check_shell_result(33).is_ok());
    }
}
