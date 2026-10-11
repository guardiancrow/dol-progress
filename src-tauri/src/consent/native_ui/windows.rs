use super::*;
use std::{
    cell::{Cell, RefCell},
    ffi::c_void,
    panic::{catch_unwind, AssertUnwindSafe},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::*,
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Controls::{EM_SETLIMITTEXT, EM_SETSEL},
        HiDpi::*,
        Input::KeyboardAndMouse::*,
        WindowsAndMessaging::*,
    },
};

const BODY: i32 = 101;
const CHECK: i32 = 102;
const ACCEPT: i32 = 103;
const DECLINE: i32 = 104;

#[cfg(test)]
#[path = "desktop_tests.rs"]
mod desktop_tests;

#[derive(Clone, Copy, Default)]
struct Controls {
    header: HWND,
    version: HWND,
    label: HWND,
    body: HWND,
    notice: HWND,
    check: HWND,
    accept: HWND,
    decline: HWND,
}
impl Controls {
    fn all(self) -> [HWND; 8] {
        [
            self.header,
            self.version,
            self.label,
            self.body,
            self.notice,
            self.check,
            self.accept,
            self.decline,
        ]
    }
}

// Boxの位置はwindow存続中固定。callbackは共有参照だけを作り、FFI呼出しを
// 跨いでRefCell借用を保持しない。同期的に再入するWin32通知にも対応する。
struct State {
    prepared: PreparedTerms,
    hwnd: Cell<HWND>,
    controls: Cell<Controls>,
    font: Cell<HFONT>,
    dpi: Cell<u32>,
    layout_ready: Cell<bool>,
    model: RefCell<UiModel>,
    outcome: RefCell<Option<Result<ConsentDecision, NativeUiError>>>,
}
impl State {
    fn finish(&self, result: Result<ConsentDecision, NativeUiError>) {
        let action = match &result {
            Ok(ConsentDecision::Accepted(_)) => Action::Accepted,
            Ok(ConsentDecision::Declined(reason)) => Action::Declined(*reason),
            Err(_) => Action::Error,
        };
        let first = if action == Action::Accepted {
            self.model.borrow_mut().accept()
        } else {
            self.model.borrow_mut().finish(action)
        };
        if !first {
            return;
        }
        *self.outcome.borrow_mut() = Some(result);
        // HWNDはこのthreadで作成し、このthreadだけで破棄する。
        unsafe {
            if DestroyWindow(self.hwnd.get()) == 0 {
                *self.outcome.borrow_mut() = Some(Err(NativeUiError::os(UiErrorKind::Cleanup)));
                PostQuitMessage(1);
            }
        }
    }
    fn fail(&self, error: NativeUiError) {
        self.finish(Err(error));
    }
}
impl Drop for State {
    fn drop(&mut self) {
        let font = self.font.replace(null_mut());
        if !font.is_null() {
            unsafe {
                DeleteObject(font);
            }
        }
    }
}

struct DialogGuard(HWND);
impl Drop for DialogGuard {
    fn drop(&mut self) {
        unsafe {
            if IsWindow(self.0) != 0 {
                // 万一の破棄失敗でも、解放したStateをcallbackが参照しない。
                SetWindowLongPtrW(self.0, GWLP_USERDATA, 0);
                DestroyWindow(self.0);
            }
        }
    }
}
struct DpiGuard(DPI_AWARENESS_CONTEXT);
impl Drop for DpiGuard {
    fn drop(&mut self) {
        unsafe {
            SetThreadDpiAwarenessContext(self.0);
        }
    }
}

pub(super) fn show(prepared: PreparedTerms) -> Result<ConsentDecision, NativeUiError> {
    unsafe {
        let mut previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        if previous.is_null() {
            previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE);
        }
        if previous.is_null() {
            return Err(NativeUiError::os(UiErrorKind::DpiContext));
        }
        let _dpi = DpiGuard(previous);
        let state = Box::new(State {
            prepared,
            hwnd: Cell::new(null_mut()),
            controls: Cell::new(Controls::default()),
            font: Cell::new(null_mut()),
            dpi: Cell::new(96),
            layout_ready: Cell::new(false),
            model: RefCell::new(UiModel::default()),
            outcome: RefCell::new(None),
        });
        let instance = GetModuleHandleW(null());
        if instance.is_null() {
            return Err(NativeUiError::os(UiErrorKind::CreateDialog));
        }
        // DLGTEMPLATE header(18 bytes) + menu/class/title各WORD(6 bytes)。
        // u32 arrayでDWORD alignmentを保証する。子controlはINITDIALOGで作成する。
        let template: [u32; 6] = [
            WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MAXIMIZEBOX | WS_MINIMIZEBOX,
            WS_EX_CONTROLPARENT,
            0,
            0,
            0,
            0,
        ];
        let hwnd = CreateDialogIndirectParamW(
            instance,
            template.as_ptr().cast(),
            null_mut(),
            Some(dialog_proc),
            (&*state as *const State) as isize,
        );
        if hwnd.is_null() {
            return state
                .outcome
                .borrow_mut()
                .take()
                .unwrap_or_else(|| Err(NativeUiError::os(UiErrorKind::CreateDialog)));
        }
        let guard = DialogGuard(hwnd);
        if state.outcome.borrow().is_none() {
            if let Err(error) = initial_size(&state) {
                state.fail(error);
            }
        }
        if state.outcome.borrow().is_none() {
            ShowWindow(hwnd, SW_SHOW);
            SetFocus(state.controls.get().body);
            SendMessageW(
                hwnd,
                WM_CHANGEUISTATE,
                (UIS_CLEAR | ((UISF_HIDEFOCUS | UISF_HIDEACCEL) << 16)) as usize,
                0,
            );
        }
        while state.outcome.borrow().is_none() {
            let mut msg: MSG = std::mem::zeroed();
            match GetMessageW(&mut msg, null_mut(), 0, 0) {
                -1 => {
                    state.fail(NativeUiError::os(UiErrorKind::MessageLoop));
                    break;
                }
                0 => {
                    state.fail(NativeUiError::new(UiErrorKind::UnexpectedDestroy));
                    break;
                }
                _ => {}
            }
            if matches!(
                msg.message,
                WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP
            ) && msg.wParam == VK_RETURN as usize
            {
                continue;
            }
            if msg.message == WM_KEYDOWN {
                if msg.wParam == VK_ESCAPE as usize {
                    state.finish(Ok(ConsentDecision::Declined(DeclineReason::Escape)));
                    continue;
                }
                // EnterはどのfocusでもAcceptしない。checkbox + Space/click/access keyで確定する。
                if msg.wParam == b'A' as usize
                    && GetKeyState(VK_CONTROL as i32) < 0
                    && GetFocus() == state.controls.get().body
                {
                    SendMessageW(state.controls.get().body, EM_SETSEL, 0, -1);
                    continue;
                }
            }
            if msg.message == WM_CHAR && msg.wParam == 13 {
                continue;
            }
            if IsDialogMessageW(hwnd, &msg) == 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        if IsWindow(hwnd) != 0 && DestroyWindow(hwnd) == 0 {
            return Err(NativeUiError::os(UiErrorKind::Cleanup));
        }
        drop(guard);
        let font = state.font.replace(null_mut());
        if !font.is_null() && DeleteObject(font) == 0 {
            return Err(NativeUiError::os(UiErrorKind::Cleanup));
        }
        let outcome = state
            .outcome
            .borrow_mut()
            .take()
            .unwrap_or_else(|| Err(NativeUiError::new(UiErrorKind::UnexpectedDestroy)));
        outcome
    }
}

unsafe extern "system" fn dialog_proc(hwnd: HWND, message: u32, w: usize, l: isize) -> isize {
    if message == WM_INITDIALOG {
        if l == 0 || GetWindowLongPtrW(hwnd, GWLP_USERDATA) != 0 {
            return 0;
        }
        // lはCreateDialogに渡した生存中Boxのみ。未検証pointerを外部APIから受け取らない。
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, l);
        let state = &*(l as *const State);
        state.hwnd.set(hwnd);
        #[cfg(test)]
        desktop_tests::remember(hwnd);
        if catch_unwind(AssertUnwindSafe(|| initialize(state)))
            .map_or_else(
                |_| Err(NativeUiError::new(UiErrorKind::CallbackPanic)),
                |value| value,
            )
            .map_err(|error| state.fail(error))
            .is_err()
        {
            return 0;
        }
        return 1;
    }
    let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const State;
    if pointer.is_null() {
        return 0;
    }
    let state = &*pointer;
    if message == WM_NCDESTROY {
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        return 0;
    }
    match catch_unwind(AssertUnwindSafe(|| handle(state, message, w, l))) {
        Ok(result) => result,
        Err(_) => {
            state.fail(NativeUiError::new(UiErrorKind::CallbackPanic));
            1
        }
    }
}

unsafe fn initialize(state: &State) -> Result<(), NativeUiError> {
    let hwnd = state.hwnd.get();
    if SetWindowTextW(hwnd, wide(WINDOW_TITLE).as_ptr()) == 0 {
        return Err(NativeUiError::os(UiErrorKind::CreateDialog));
    }
    let instance = GetModuleHandleW(null());
    let create =
        |class: &str, text: &str, style: u32, id: i32, ex: u32| -> Result<HWND, NativeUiError> {
            #[cfg(test)]
            if desktop_tests::checkpoint() {
                return Err(NativeUiError::new(UiErrorKind::CreateControl));
            }
            let control = CreateWindowExW(
                ex,
                wide(class).as_ptr(),
                wide(text).as_ptr(),
                WS_CHILD | WS_VISIBLE | style,
                0,
                0,
                1,
                1,
                hwnd,
                id as usize as HMENU,
                instance,
                null(),
            );
            if control.is_null() {
                Err(NativeUiError::os(UiErrorKind::CreateControl))
            } else {
                #[cfg(test)]
                desktop_tests::remember(control);
                Ok(control)
            }
        };
    // real dialogと先行STATIC labelにより標準MSAA/UIAの名前・役割を利用する。
    let header = create("STATIC", "DOL Progress Manager — 利用条件", 0, 110, 0)?;
    let version = create(
        "STATIC",
        &format!("利用条件の版：{}", state.prepared.acceptance.terms_version),
        0,
        111,
        0,
    )?;
    let label = create("STATIC", "利用条件本文(&T)：", 0, 112, 0)?;
    let body = create(
        "EDIT",
        "",
        WS_TABSTOP
            | WS_VSCROLL
            | ES_MULTILINE as u32
            | ES_READONLY as u32
            | ES_AUTOVSCROLL as u32
            | ES_WANTRETURN as u32,
        BODY,
        WS_EX_CLIENTEDGE,
    )?;
    let notice = create("STATIC","第三者ライセンスおよびNOTICEは別途適用されます。\r\nこの画面はアプリケーションの利用条件を表示します。",0,113,0)?;
    let check = create(
        "BUTTON",
        "表示された利用条件を確認し、同意します(&C)",
        WS_TABSTOP | BS_AUTOCHECKBOX as u32 | BS_MULTILINE as u32,
        CHECK,
        0,
    )?;
    let accept = create(
        "BUTTON",
        "同意する(&A)",
        WS_TABSTOP | BS_PUSHBUTTON as u32,
        ACCEPT,
        0,
    )?;
    let decline = create(
        "BUTTON",
        "同意しない／終了する(&D)",
        WS_TABSTOP | BS_PUSHBUTTON as u32,
        DECLINE,
        0,
    )?;
    state.controls.set(Controls {
        header,
        version,
        label,
        body,
        notice,
        check,
        accept,
        decline,
    });
    EnableWindow(accept, 0);
    SendMessageW(check, BM_SETCHECK, 0, 0);
    SendMessageW(body, EM_SETLIMITTEXT, state.prepared.display.len() - 1, 0);
    if SetWindowTextW(body, state.prepared.display.as_ptr()) == 0 {
        return Err(NativeUiError::os(UiErrorKind::DisplayVerification));
    }
    if read_text(body)? != state.prepared.display {
        return Err(NativeUiError::new(UiErrorKind::DisplayVerification));
    }
    let dpi = GetDpiForWindow(hwnd);
    if dpi == 0 {
        return Err(NativeUiError::os(UiErrorKind::DpiContext));
    }
    state.dpi.set(dpi);
    update_font(state)?;
    #[cfg(test)]
    {
        if desktop_tests::checkpoint() {
            return Err(NativeUiError::new(UiErrorKind::Font));
        }
        if desktop_tests::checkpoint() {
            panic!("TEST ONLY: callback内panicの隔離試験");
        }
    }
    state.model.borrow_mut().ready();
    Ok(())
}

unsafe fn handle(state: &State, message: u32, w: usize, l: isize) -> isize {
    let hwnd = state.hwnd.get();
    let controls = state.controls.get();
    match message {
        WM_COMMAND => {
            let id = (w & 0xffff) as i32;
            let notification = (w >> 16) as u32;
            if id == BODY
                && l == controls.body as isize
                && matches!(notification, EN_ERRSPACE | EN_MAXTEXT)
            {
                state.fail(NativeUiError::new(UiErrorKind::DisplayVerification));
                return 1;
            }
            if notification != BN_CLICKED {
                return 0;
            }
            if id == CHECK && l == controls.check as isize {
                let checked = SendMessageW(controls.check, BM_GETCHECK, 0, 0) == 1;
                state.model.borrow_mut().check(checked);
                let enabled = state.model.borrow().can_accept();
                EnableWindow(controls.accept, i32::from(enabled));
                return 1;
            }
            if id == ACCEPT && l == controls.accept as isize {
                if IsWindowEnabled(controls.accept) != 0
                    && SendMessageW(controls.check, BM_GETCHECK, 0, 0) == 1
                {
                    if read_text(controls.body).is_ok_and(|text| text == state.prepared.display) {
                        state.finish(Ok(ConsentDecision::Accepted(
                            state.prepared.acceptance.clone(),
                        )));
                    } else {
                        state.fail(NativeUiError::new(UiErrorKind::DisplayVerification));
                    }
                }
                return 1;
            }
            if id == DECLINE && l == controls.decline as isize {
                state.finish(Ok(ConsentDecision::Declined(DeclineReason::Button)));
                return 1;
            }
            if id == IDOK {
                return 1;
            }
            if id == IDCANCEL {
                state.finish(Ok(ConsentDecision::Declined(DeclineReason::Escape)));
                return 1;
            }
            0
        }
        WM_CLOSE => {
            state.finish(Ok(ConsentDecision::Declined(DeclineReason::WindowClose)));
            1
        }
        WM_DESTROY => {
            if state.outcome.borrow().is_none() {
                state.model.borrow_mut().finish(Action::Error);
                *state.outcome.borrow_mut() =
                    Some(Err(NativeUiError::new(UiErrorKind::UnexpectedDestroy)));
            }
            PostQuitMessage(0);
            1
        }
        WM_SIZE => {
            if state.layout_ready.get() && w != SIZE_MINIMIZED as usize && !controls.body.is_null()
            {
                if let Err(error) = relayout(state) {
                    state.fail(error);
                }
            }
            1
        }
        WM_GETMINMAXINFO => {
            let limits = &mut *(l as *mut MINMAXINFO);
            let work = work_area(hwnd);
            if let Ok(work) = work {
                let minimum = outer_rect(360, 360, state.dpi.get());
                if let Ok(minimum) = minimum {
                    limits.ptMinTrackSize.x =
                        (minimum.right - minimum.left).min(work.right - work.left);
                    limits.ptMinTrackSize.y =
                        (minimum.bottom - minimum.top).min(work.bottom - work.top);
                }
            }
            1
        }
        WM_DPICHANGED => {
            state.dpi.set((w & 0xffff) as u32);
            let suggested = &*(l as *const RECT);
            if let Err(error) = update_font(state) {
                state.fail(error);
                return 1;
            }
            if SetWindowPos(
                hwnd,
                null_mut(),
                suggested.left,
                suggested.top,
                suggested.right - suggested.left,
                suggested.bottom - suggested.top,
                SWP_NOZORDER | SWP_NOACTIVATE,
            ) == 0
            {
                state.fail(NativeUiError::os(UiErrorKind::Layout));
            }
            1
        }
        WM_SETTINGCHANGE => {
            if let Err(error) = update_font(state) {
                state.fail(error);
            }
            InvalidateRect(hwnd, null(), 1);
            0
        }
        WM_SYSCOLORCHANGE | WM_THEMECHANGED => {
            InvalidateRect(hwnd, null(), 1);
            0
        }
        WM_CTLCOLORSTATIC | WM_CTLCOLOREDIT => {
            let body = l == controls.body as isize;
            let bg = if body { COLOR_WINDOW } else { COLOR_BTNFACE };
            SetTextColor(
                w as HDC,
                GetSysColor(if body {
                    COLOR_WINDOWTEXT
                } else {
                    COLOR_BTNTEXT
                }),
            );
            SetBkColor(w as HDC, GetSysColor(bg));
            GetSysColorBrush(bg) as isize
        }
        DM_GETDEFID | DM_SETDEFID => {
            SetWindowLongPtrW(hwnd, DWLP_MSGRESULT as i32, 0);
            1
        }
        _ => 0,
    }
}

unsafe fn read_text(hwnd: HWND) -> Result<Vec<u16>, NativeUiError> {
    let len = GetWindowTextLengthW(hwnd);
    if len < 0 || len > 262144 {
        return Err(NativeUiError::new(UiErrorKind::DisplayVerification));
    }
    let mut text = vec![0u16; len as usize + 1];
    let read = GetWindowTextW(hwnd, text.as_mut_ptr(), text.len() as i32);
    if read != len {
        Err(NativeUiError::os(UiErrorKind::DisplayVerification))
    } else {
        Ok(text)
    }
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

unsafe fn update_font(state: &State) -> Result<(), NativeUiError> {
    let mut metrics: NONCLIENTMETRICSW = std::mem::zeroed();
    metrics.cbSize = std::mem::size_of::<NONCLIENTMETRICSW>() as u32;
    if SystemParametersInfoW(
        SPI_GETNONCLIENTMETRICS,
        metrics.cbSize,
        (&mut metrics as *mut NONCLIENTMETRICSW).cast::<c_void>(),
        0,
    ) == 0
    {
        return Err(NativeUiError::os(UiErrorKind::Font));
    }
    let system_dpi = GetDpiForSystem();
    if system_dpi == 0 {
        return Err(NativeUiError::os(UiErrorKind::Font));
    }
    metrics.lfMessageFont.lfHeight = (i64::from(metrics.lfMessageFont.lfHeight)
        * i64::from(state.dpi.get())
        / i64::from(system_dpi)) as i32;
    let font = CreateFontIndirectW(&metrics.lfMessageFont);
    if font.is_null() {
        return Err(NativeUiError::os(UiErrorKind::Font));
    }
    let old = state.font.replace(font);
    for control in state.controls.get().all() {
        SendMessageW(control, WM_SETFONT, font as usize, 1);
    }
    if !old.is_null() && DeleteObject(old) == 0 {
        return Err(NativeUiError::os(UiErrorKind::Cleanup));
    }
    Ok(())
}
unsafe fn work_area(hwnd: HWND) -> Result<RECT, NativeUiError> {
    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    let mut info: MONITORINFO = std::mem::zeroed();
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if GetMonitorInfoW(monitor, &mut info) == 0 {
        Err(NativeUiError::os(UiErrorKind::Layout))
    } else {
        Ok(info.rcWork)
    }
}
unsafe fn outer_rect(width: i32, height: i32, dpi: u32) -> Result<RECT, NativeUiError> {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: scale(width, dpi),
        bottom: scale(height, dpi),
    };
    if AdjustWindowRectExForDpi(
        &mut rect,
        WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MAXIMIZEBOX | WS_MINIMIZEBOX,
        0,
        WS_EX_CONTROLPARENT,
        dpi,
    ) == 0
    {
        Err(NativeUiError::os(UiErrorKind::Layout))
    } else {
        Ok(rect)
    }
}
unsafe fn initial_size(state: &State) -> Result<(), NativeUiError> {
    let work = work_area(state.hwnd.get())?;
    let rect = outer_rect(760, 640, state.dpi.get())?;
    let width = (rect.right - rect.left).min(work.right - work.left);
    let height = (rect.bottom - rect.top).min(work.bottom - work.top);
    state.layout_ready.set(true);
    if SetWindowPos(
        state.hwnd.get(),
        null_mut(),
        work.left + (work.right - work.left - width) / 2,
        work.top + (work.bottom - work.top - height) / 2,
        width,
        height,
        SWP_NOZORDER | SWP_NOACTIVATE,
    ) == 0
    {
        return Err(NativeUiError::os(UiErrorKind::Layout));
    }
    relayout(state)
}
unsafe fn relayout(state: &State) -> Result<(), NativeUiError> {
    let mut client: RECT = std::mem::zeroed();
    if GetClientRect(state.hwnd.get(), &mut client) == 0 {
        return Err(NativeUiError::os(UiErrorKind::Layout));
    }
    let positions = layout(client.right, client.bottom, state.dpi.get())?;
    let controls = state.controls.get().all();
    for (control, rect) in controls.into_iter().zip([
        positions.header,
        positions.version,
        positions.label,
        positions.body,
        positions.notice,
        positions.check,
        positions.accept,
        positions.decline,
    ]) {
        if MoveWindow(control, rect.x, rect.y, rect.width, rect.height, 1) == 0 {
            return Err(NativeUiError::os(UiErrorKind::Layout));
        }
    }
    Ok(())
}
