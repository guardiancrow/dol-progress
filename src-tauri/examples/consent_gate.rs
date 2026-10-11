//! TEST ONLY。専用fixture以外を受け付けず、通常起動・DBへ接続しない。
use dol_progress_manager_lib::consent::{
    gate::{self, GateOutcome, GateStop, PassBasis},
    native_ui::{show_consent, ConsentDecision, DeclineReason, NativeUiError},
    CanonicalTerms, ConsentStore, TermsVersion,
};
use std::{
    cell::Cell,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

fn terms() -> CanonicalTerms {
    CanonicalTerms::from_body(TermsVersion::new(900003).unwrap(),
        "TEST ONLY — 隔離統合用の合成条件。正式な利用条件ではありません。\n明示同意した場合、専用fixtureにだけ同意記録を保存します。\n通常アプリ、実config、DB、WebView2は起動しません。\n".as_bytes()).unwrap()
}
fn base() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("tmp/phase-local-5c-c/manual-fixtures")
}
fn new_fixture() -> Result<PathBuf, String> {
    fs::create_dir_all(base()).map_err(|e| e.to_string())?;
    let id = format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos(),
        std::process::id()
    );
    let root = base().join(&id);
    fs::create_dir(&root).map_err(|e| e.to_string())?;
    fs::write(root.join("TEST_ONLY.fixture"), b"TEST_ONLY gate harness")
        .map_err(|e| e.to_string())?;
    println!("fixture ID: {id}");
    Ok(root)
}
fn resume(id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit() || b == b'-') {
        return Err("fixture IDは数字とhyphenだけを指定してください".into());
    }
    let root = base().join(id);
    if fs::symlink_metadata(&root)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("fixture linkを拒否".into());
    }
    // ConsentStoreがWindows reparse/ancestor/typeも検査する。
    ConsentStore::for_portable_root(&root)
        .map_err(|e| e.to_string())?
        .read(&terms())
        .map_err(|e| e.to_string())?;
    if fs::read(root.join("TEST_ONLY.fixture")).map_err(|e| e.to_string())?
        != b"TEST_ONLY gate harness"
    {
        return Err("専用fixture markerがありません".into());
    }
    Ok(root)
}
fn invoke(
    root: &Path,
    mode: &str,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
) -> (GateOutcome<String, String>, u32, u32) {
    let ui_count = Cell::new(0);
    let next_count = Cell::new(0);
    let store = ConsentStore::for_portable_root(root).unwrap();
    let out = gate::run(
        &terms(),
        &store,
        |t| {
            ui_count.set(ui_count.get() + 1);
            ui(t)
        },
        |_| {
            next_count.set(next_count.get() + 1);
            assert!(store.read(&terms()).is_err());
            Ok(mode.to_owned())
        },
    );
    println!(
        "{out:?} / UI={} / mock-startup={}",
        ui_count.get(),
        next_count.get()
    );
    (out, ui_count.get(), next_count.get())
}
fn main() {
    if let Err(e) = execute() {
        eprintln!("TEST ONLY Error: {e}");
        std::process::exit(1)
    }
}
fn execute() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [flag, mode] if flag == "--new" && (mode == "Normal" || mode == "Recovery") => {
            manual(&new_fixture()?, mode)
        }
        [flag, id, mode] if flag == "--resume" && (mode == "Normal" || mode == "Recovery") => {
            manual(&resume(id)?, mode)
        }
        #[cfg(windows)]
        [flag] if flag == "--automated" => automation(),
        _ => Err("--new Normal|Recovery / --resume <fixture-ID> Normal|Recovery / --automated を明示指定してください".into()),
    }
}
fn manual(root: &Path, mode: &str) -> Result<(), String> {
    let (out, _, _) = invoke(root, mode, show_consent);
    match out {
        GateOutcome::Started { result, .. } => result.map(|_| ()),
        GateOutcome::Stopped(GateStop::Declined(_)) => Ok(()),
        GateOutcome::Stopped(_) => Err("gateが異常終了しました".into()),
    }
}
#[cfg(windows)]
fn automated_ui(terms: &CanonicalTerms, accept: bool) -> Result<ConsentDecision, NativeUiError> {
    let driver = std::thread::spawn(move || driver::operate(accept));
    let decision = show_consent(terms);
    driver
        .join()
        .expect("driver panic")
        .expect("driver failure");
    decision
}
#[cfg(windows)]
fn automation() -> Result<(), String> {
    let root = new_fixture()?;
    let (out, u, n) = invoke(&root, "Normal", |t| automated_ui(t, true));
    assert!(matches!(
        out,
        GateOutcome::Started {
            basis: PassBasis::SavedAcceptance,
            result: Ok(_)
        }
    ));
    assert_eq!((u, n), (1, 1));
    let record = root.join("config/consent.json");
    let bytes = fs::read(&record).map_err(|e| e.to_string())?;
    for mode in ["Normal", "Recovery"] {
        let (out, u, n) = invoke(&root, mode, |_| panic!("有効記録なのでUIを呼ばない"));
        assert!(
            matches!(out,GateOutcome::Started{basis:PassBasis::ExistingRecord,result:Ok(ref value)} if value==mode)
        );
        assert_eq!((u, n), (0, 1));
        assert_eq!(fs::read(&record).unwrap(), bytes);
    }
    let declined = new_fixture()?;
    let (out, u, n) = invoke(&declined, "Normal", |t| automated_ui(t, false));
    assert!(matches!(
        out,
        GateOutcome::Stopped(GateStop::Declined(DeclineReason::Button))
    ));
    assert_eq!((u, n), (1, 0));
    assert!(!declined.join("config").exists());
    println!("PASS: 実Native UI統合4シナリオ（初回保存／再起動／模擬Recovery／拒否）");
    Ok(())
}
#[cfg(windows)]
mod driver {
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
