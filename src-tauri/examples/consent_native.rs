//! 明示起動専用のTEST ONLY harness。正式EXE・通常test・保存経路には入らない。
use dol_progress_manager_lib::consent::{
    native_ui::{show_consent, ConsentDecision},
    CanonicalTerms, TermsVersion,
};

fn synthetic_terms() -> CanonicalTerms {
    let mut body=String::from("TEST ONLY — 合成利用条件。正式な利用条件ではありません。\nこの操作は同意記録を保存せず、アプリケーションも起動しません。\n\n");
    for n in 1..=360 {
        body.push_str(&format!("段落{n}：日本語の全文表示、スクロール、選択を検証します。English synthetic paragraph with a long line for wrapping and selection, punctuation ( ) / : ; © → 🙂.\n\n"));
    }
    CanonicalTerms::from_body(TermsVersion::new(900002).unwrap(), body.as_bytes())
        .expect("TEST ONLY fixtureはcanonical仕様に適合")
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let terms = synthetic_terms();
    println!(
        "TEST ONLY / version={} / utf8={} / utf16={} / sha256={}",
        terms.version().get(),
        terms.bytes().len(),
        terms.text().encode_utf16().count(),
        terms.sha256()
    );
    let result = match args.as_slice() {
        [mode] if mode == "--manual" => show_consent(&terms)
            .map(|decision| match decision {
                ConsentDecision::Accepted(ref accepted) => {
                    println!("Accepted / matches={}", accepted.matches(&terms))
                }
                ConsentDecision::Declined(reason) => println!("Declined / {reason:?}"),
            })
            .map_err(|error| error.to_string()),
        #[cfg(windows)]
        [mode] if mode == "--automated" => automation::run(&terms),
        _ => Err("--manual又は--automatedを明示指定してください。記録の保存は行いません。".into()),
    };
    if let Err(error) = result {
        eprintln!("Error: {error}");
        std::process::exit(1);
    }
}

#[cfg(windows)]
mod automation {
    use super::*;
    use dol_progress_manager_lib::consent::native_ui::{DeclineReason, UiErrorKind};
    use std::{
        ptr::null_mut,
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::*,
        Graphics::Gdi::*,
        System::Threading::{GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS, GR_USEROBJECTS},
        UI::{
            Controls::{EM_GETSEL, EM_LINESCROLL, EM_SETSEL},
            HiDpi::GetDpiForWindow,
            Input::KeyboardAndMouse::*,
            WindowsAndMessaging::*,
        },
    };
    const BODY: i32 = 101;
    const CHECK: i32 = 102;
    const ACCEPT: i32 = 103;
    const DECLINE: i32 = 104;
    type TestResult<T> = Result<T, String>;
    #[derive(Clone, Copy, Debug)]
    enum Case {
        Unchecked,
        Accepted,
        UncheckedAgain,
        Escape,
        Close,
        DisplayError,
        TamperedBody,
        Resized,
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
    fn require(ok: bool, label: &str) -> TestResult<()> {
        if ok {
            Ok(())
        } else {
            Err(label.into())
        }
    }
    unsafe fn send(hwnd: HWND, message: u32, w: usize, l: isize) -> TestResult<usize> {
        let mut result = 0;
        if SendMessageTimeoutW(
            hwnd,
            message,
            w,
            l,
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            3000,
            &mut result,
        ) == 0
        {
            Err(format!("message {message} timeout/error"))
        } else {
            Ok(result)
        }
    }
    unsafe extern "system" fn find_owned(hwnd: HWND, param: isize) -> BOOL {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == std::process::id()
            && IsWindowVisible(hwnd) != 0
            && !GetDlgItem(hwnd, BODY).is_null()
        {
            *(param as *mut HWND) = hwnd;
            return 0;
        }
        1
    }
    fn wait_for(mut condition: impl FnMut() -> bool, label: &str) -> TestResult<()> {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !condition() {
            if Instant::now() >= deadline {
                return Err(format!("timeout: {label}"));
            }
            thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    }
    unsafe fn text(hwnd: HWND) -> TestResult<String> {
        let len = send(hwnd, WM_GETTEXTLENGTH, 0, 0)?;
        let mut bytes = vec![0u16; len + 1];
        let read = send(hwnd, WM_GETTEXT, bytes.len(), bytes.as_mut_ptr() as isize)?;
        require(read == len, "全文read length")?;
        String::from_utf16(&bytes[..len]).map_err(|_| "UTF-16不正".into())
    }
    unsafe fn focus(hwnd: HWND) -> HWND {
        let tid = GetWindowThreadProcessId(hwnd, null_mut());
        let mut info: GUITHREADINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        if GetGUIThreadInfo(tid, &mut info) == 0 {
            null_mut()
        } else {
            info.hwndFocus
        }
    }
    unsafe fn key(hwnd: HWND, value: u16) -> TestResult<()> {
        require(
            PostMessageW(hwnd, WM_KEYDOWN, value as usize, 1) != 0,
            "key down post",
        )?;
        require(
            PostMessageW(hwnd, WM_KEYUP, value as usize, 0xc0000001u32 as isize) != 0,
            "key up post",
        )
    }
    fn drive(case: Case, canonical: String) -> TestResult<()> {
        unsafe {
            let mut hwnd: HWND = null_mut();
            wait_for(
                || {
                    EnumWindows(Some(find_owned), (&mut hwnd as *mut HWND) as isize);
                    !hwnd.is_null()
                },
                "owned TEST ONLY window",
            )?;
            let _owned = OwnedWindow(hwnd);
            println!("UI {case:?} / actual_dpi={}", GetDpiForWindow(hwnd));
            let duplicate_terms =
                CanonicalTerms::from_body(TermsVersion::new(900002).unwrap(), canonical.as_bytes())
                    .map_err(|error| error.to_string())?;
            require(
                matches!(show_consent(&duplicate_terms), Err(error) if error.kind == UiErrorKind::Busy),
                "多重UI API呼出しはBusyで、新しいwindowを作らない",
            )?;
            let body = GetDlgItem(hwnd, BODY);
            let check = GetDlgItem(hwnd, CHECK);
            let accept = GetDlgItem(hwnd, ACCEPT);
            let decline = GetDlgItem(hwnd, DECLINE);
            require(
                text(body)?.replace("\r\n", "\n") == canonical,
                "canonical全文一致",
            )?;
            require(
                GetWindowLongPtrW(body, GWL_STYLE) & ES_READONLY as isize != 0,
                "readonly EDIT",
            )?;
            require(send(check, BM_GETCHECK, 0, 0)? == 0, "初期checkbox未選択")?;
            require(IsWindowEnabled(accept) == 0, "初期同意button無効")?;
            wait_for(|| focus(hwnd) == body, "初期focus本文")?;
            // 標準EDITへの入力は無効、選択と長文scrollは利用できる。
            PostMessageW(body, WM_CHAR, b'X' as usize, 1);
            send(body, EM_SETSEL, 0, -1)?;
            let mut start = 0u32;
            let mut end = 0u32;
            send(
                body,
                EM_GETSEL,
                (&mut start as *mut u32) as usize,
                (&mut end as *mut u32) as isize,
            )?;
            require(
                start == 0
                    && end as usize == canonical.replace('\n', "\r\n").encode_utf16().count(),
                "全文選択",
            )?;
            send(body, EM_LINESCROLL, 0, 400)?;
            require(IsWindowEnabled(accept) == 0, "scrollで同意成立しない")?;
            key(body, VK_RETURN)?;
            thread::sleep(Duration::from_millis(30));
            require(
                IsWindow(hwnd) != 0 && IsWindowEnabled(accept) == 0,
                "未選択Enterで非同意",
            )?;
            require(
                text(body)?.replace("\r\n", "\n") == canonical,
                "入力で本文変更しない",
            )?;
            key(body, VK_TAB)?;
            wait_for(|| focus(hwnd) == check, "Tab本文→checkbox")?;
            if !matches!(case, Case::Unchecked) {
                key(check, VK_SPACE)?;
                wait_for(|| IsWindowEnabled(accept) != 0, "Spaceでcheckbox選択")?;
                key(check, VK_RETURN)?;
                thread::sleep(Duration::from_millis(30));
                require(IsWindow(hwnd) != 0, "選択済みEnterでも確定しない")?;
                key(check, VK_TAB)?;
                wait_for(|| focus(hwnd) == accept, "Tab→同意button")?;
                key(accept, VK_RETURN)?;
                thread::sleep(Duration::from_millis(30));
                require(IsWindow(hwnd) != 0, "同意button focusでもEnter非確定")?;
            }
            match case {
                Case::Unchecked => {
                    send(hwnd, WM_COMMAND, ACCEPT as usize, accept as isize)?;
                    require(IsWindow(hwnd) != 0, "未選択WM_COMMAND拒否")?;
                    send(decline, BM_CLICK, 0, 0)?;
                }
                Case::Accepted => {
                    key(accept, VK_SPACE)?;
                }
                Case::UncheckedAgain => {
                    send(check, BM_CLICK, 0, 0)?;
                    require(IsWindowEnabled(accept) == 0, "checkbox解除でbutton無効")?;
                    send(hwnd, WM_COMMAND, ACCEPT as usize, accept as isize)?;
                    require(IsWindow(hwnd) != 0, "解除後は確定不可")?;
                    send(decline, BM_CLICK, 0, 0)?;
                }
                Case::Escape => {
                    key(accept, VK_ESCAPE)?;
                }
                Case::Close => {
                    send(hwnd, WM_CLOSE, 0, 0)?;
                }
                Case::DisplayError => {
                    send(
                        hwnd,
                        WM_COMMAND,
                        (BODY as usize) | ((EN_ERRSPACE as usize) << 16),
                        body as isize,
                    )?;
                }
                Case::TamperedBody => {
                    let changed: Vec<_> = "TEST ONLY altered\r\n"
                        .encode_utf16()
                        .chain(Some(0))
                        .collect();
                    send(body, WM_SETTEXT, 0, changed.as_ptr() as isize)?;
                    send(accept, BM_CLICK, 0, 0)?;
                }
                Case::Resized => {
                    let mut before: RECT = std::mem::zeroed();
                    GetWindowRect(hwnd, &mut before);
                    require(
                        SetWindowPos(
                            hwnd,
                            null_mut(),
                            0,
                            0,
                            (before.right - before.left) * 3 / 4,
                            (before.bottom - before.top) * 3 / 4,
                            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
                        ) != 0,
                        "resize",
                    )?;
                    require(
                        text(body)?.replace("\r\n", "\n") == canonical,
                        "resize後全文",
                    )?;
                    let mut rect: RECT = std::mem::zeroed();
                    GetClientRect(hwnd, &mut rect);
                    for control in [body, check, accept, decline] {
                        let mut child: RECT = std::mem::zeroed();
                        GetWindowRect(control, &mut child);
                        let mut first = POINT {
                            x: child.left,
                            y: child.top,
                        };
                        let mut last = POINT {
                            x: child.right,
                            y: child.bottom,
                        };
                        ScreenToClient(hwnd, &mut first);
                        ScreenToClient(hwnd, &mut last);
                        require(
                            first.x >= 0
                                && first.y >= 0
                                && last.x <= rect.right
                                && last.y <= rect.bottom,
                            "resize後control bounds",
                        )?;
                    }
                    send(decline, BM_CLICK, 0, 0)?;
                }
            }
            wait_for(|| IsWindow(hwnd) == 0, "window破棄")?;
            for control in [body, check, accept, decline] {
                require(IsWindow(control) == 0, "child handle破棄")?;
            }
            Ok(())
        }
    }
    pub(super) fn run(terms: &CanonicalTerms) -> TestResult<()> {
        let mut warmed = None;
        for case in [
            Case::Unchecked,
            Case::Accepted,
            Case::UncheckedAgain,
            Case::Escape,
            Case::Close,
            Case::DisplayError,
            Case::TamperedBody,
            Case::Resized,
        ] {
            let canonical = terms.text().to_owned();
            let worker = thread::spawn(move || drive(case, canonical));
            let outcome = show_consent(terms);
            worker
                .join()
                .map_err(|_| "automation thread panic".to_string())??;
            match (case, &outcome) {
                (Case::Accepted, Ok(ConsentDecision::Accepted(record))) => {
                    require(record.matches(terms), "Accepted identity")?
                }
                (Case::Escape, Ok(ConsentDecision::Declined(DeclineReason::Escape))) => {}
                (Case::Close, Ok(ConsentDecision::Declined(DeclineReason::WindowClose))) => {}
                (Case::DisplayError | Case::TamperedBody, Err(error))
                    if error.kind == UiErrorKind::DisplayVerification => {}
                (
                    Case::Unchecked | Case::UncheckedAgain | Case::Resized,
                    Ok(ConsentDecision::Declined(DeclineReason::Button)),
                ) => {}
                _ => return Err(format!("{case:?}: unexpected result {outcome:?}")),
            }
            let resources = unsafe {
                (
                    GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS),
                    GetGuiResources(GetCurrentProcess(), GR_USEROBJECTS),
                )
            };
            if let Some(baseline) = warmed {
                require(resources == baseline, "warmup後GDI/USER resource数不変")?;
            } else {
                warmed = Some(resources);
            }
            println!(
                "PASS {case:?} / result={outcome:?} / GDI={} USER={}",
                resources.0, resources.1
            );
        }
        println!(
            "AUTOMATED PASS: 8 scenarios / human操作・DPI実機・Narrator確認は別途MANUAL_PENDING"
        );
        Ok(())
    }
}
