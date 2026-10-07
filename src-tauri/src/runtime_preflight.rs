const WEBVIEW2_DOWNLOAD_URL: &str =
    "https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section";

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RuntimeUnavailable;

impl RuntimeUnavailable {
    pub(crate) fn message(&self) -> String {
        format!("DOL Progress Manager を実行するには Microsoft Edge WebView2 Runtime が必要です。\n\n利用可能なRuntimeを確認できません。Microsoft公式から WebView2 Evergreen Runtime を導入し、導入後にアプリを再度起動してください。\n\nアプリ自身はRuntimeを自動ダウンロード・インストールしません。\n\nMicrosoft公式ページ:\n{WEBVIEW2_DOWNLOAD_URL}")
    }
}

pub(crate) fn before_portable_startup<T>(
    startup: impl FnOnce() -> T,
) -> Result<T, RuntimeUnavailable> {
    #[cfg(windows)]
    {
        after_detection(tauri::webview_version, startup)
    }
    #[cfg(not(windows))]
    {
        Ok(startup())
    }
}

#[cfg(any(windows, test))]
#[derive(Debug, PartialEq, Eq)]
enum RuntimePreflightDecision {
    Continue,
    Unavailable,
}

#[cfg(any(windows, test))]
fn classify_detection<E>(detection: Result<String, E>) -> RuntimePreflightDecision {
    match detection {
        // Trust the Loader's selection, including channel suffixes; do not parse versions.
        Ok(version) if !version.trim().is_empty() && !version.chars().any(char::is_control) => {
            RuntimePreflightDecision::Continue
        }
        _ => RuntimePreflightDecision::Unavailable,
    }
}

#[cfg(any(windows, test))]
fn after_detection<T, E>(
    detect: impl FnOnce() -> Result<String, E>,
    startup: impl FnOnce() -> T,
) -> Result<T, RuntimeUnavailable> {
    match classify_detection(detect()) {
        RuntimePreflightDecision::Continue => Ok(startup()),
        RuntimePreflightDecision::Unavailable => Err(RuntimeUnavailable),
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::Cell, fs};

    use super::*;
    use crate::{
        data_root,
        portable_paths::{unique_suffix, PortablePaths},
    };

    #[test]
    fn loader_success_allows_version_and_channel_suffixes() {
        for version in [
            "135.0.3179.54",
            "135.0.3179.54 Beta",
            "135.0.3179.54 Dev",
            "135.0.3179.54 Canary",
            "135.0.3179.54 Preview",
            "version returned by Loader",
        ] {
            assert_eq!(
                classify_detection::<()>(Ok(version.into())),
                RuntimePreflightDecision::Continue
            );
        }
    }

    #[test]
    fn errors_empty_whitespace_and_control_values_are_unavailable() {
        for result in [
            Err("injected detection failure"),
            Ok(""),
            Ok(" \t\r\n "),
            Ok("\0"),
            Ok("135.0.3179.54\0"),
        ] {
            assert_eq!(
                classify_detection(result.map(str::to_owned)),
                RuntimePreflightDecision::Unavailable
            );
        }
    }

    #[test]
    fn native_message_guides_manual_official_install_and_restart() {
        let message = RuntimeUnavailable.message();
        for required in [
            "DOL Progress Manager",
            "Microsoft Edge WebView2 Runtime",
            "Microsoft公式",
            "WebView2 Evergreen Runtime",
            "再度起動",
            "自動ダウンロード・インストールしません",
            WEBVIEW2_DOWNLOAD_URL,
        ] {
            assert!(message.contains(required), "{required}");
        }
        assert!(WEBVIEW2_DOWNLOAD_URL.starts_with("https://developer.microsoft.com/"));
        assert_eq!(message.matches(WEBVIEW2_DOWNLOAD_URL).count(), 1);
    }

    #[test]
    fn unavailable_never_enters_portable_preflight_or_builder_continuation() {
        let root = std::env::temp_dir().join(format!("dol-runtime-missing-{}", unique_suffix()));
        fs::create_dir(&root).unwrap();
        let paths = PortablePaths::from_executable(&root.join("app.exe")).unwrap();
        for detection in [
            Err("injected detection failure"),
            Ok(""),
            Ok(" \t "),
            Ok("\0"),
        ] {
            let continued = Cell::new(false);
            let result = after_detection(
                || detection.map(str::to_owned),
                || {
                    let plan = data_root::prepare_startup(paths.clone()).unwrap();
                    continued.set(true);
                    plan
                },
            );
            assert!(matches!(result, Err(RuntimeUnavailable)));
            assert!(!continued.get());
            assert!(!paths.config_root.exists());
            assert!(!paths.default_data_root.exists());
            assert!(!paths.default_database_path().exists());
        }
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn loader_success_reaches_existing_portable_preflight_after_detection() {
        let root = std::env::temp_dir().join(format!("dol-runtime-present-{}", unique_suffix()));
        fs::create_dir(&root).unwrap();
        let paths = PortablePaths::from_executable(&root.join("app.exe")).unwrap();
        let detected = Cell::new(false);
        let result = after_detection(
            || {
                assert!(!paths.config_root.exists() && !paths.default_data_root.exists());
                detected.set(true);
                Ok::<_, ()>("135.0.3179.54 Dev".into())
            },
            || {
                assert!(detected.get());
                data_root::prepare_startup(paths.clone())
            },
        );
        assert!(result.unwrap().is_ok());
        assert!(paths.config_root.is_dir() && paths.default_data_root.is_dir());
        assert!(!paths.default_database_path().exists());
        fs::remove_dir(&paths.config_root).unwrap();
        fs::remove_dir(&paths.default_data_root).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn loader_success_preserves_portable_filesystem_failure() {
        let root = std::env::temp_dir().join(format!("dol-runtime-fs-failure-{}", unique_suffix()));
        fs::create_dir(&root).unwrap();
        let paths = PortablePaths::from_executable(&root.join("app.exe")).unwrap();
        fs::write(&paths.config_root, b"keep collision file").unwrap();
        let continued = Cell::new(false);
        let result = after_detection(
            || Ok::<_, ()>("135.0.3179.54".into()),
            || {
                data_root::prepare_startup(paths.clone()).map(|plan| {
                    continued.set(true);
                    plan
                })
            },
        );
        assert!(result.unwrap().is_err());
        assert!(!continued.get());
        assert!(!paths.default_data_root.exists());
        assert_eq!(
            fs::read(&paths.config_root).unwrap(),
            b"keep collision file"
        );
        fs::remove_file(&paths.config_root).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
