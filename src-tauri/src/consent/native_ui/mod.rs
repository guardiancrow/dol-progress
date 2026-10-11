//! Windows Native UIは判断と表示本文の識別だけを返す。保存・DB・Tauriを呼ばない。

use super::CanonicalTerms;
use std::{
    error::Error,
    fmt,
    sync::atomic::{AtomicBool, Ordering},
};

#[cfg(test)]
mod tests;
#[cfg(windows)]
mod windows;

static UI_ACTIVE: AtomicBool = AtomicBool::new(false);
pub const WINDOW_TITLE: &str = "DOL Progress Manager — 利用条件";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UiAcceptance {
    terms_version: u32,
    terms_sha256: String,
}

impl UiAcceptance {
    #[cfg(test)]
    pub(crate) fn for_test(terms: &CanonicalTerms) -> Self {
        Self {
            terms_version: terms.version().get(),
            terms_sha256: terms.sha256().into(),
        }
    }
    pub fn terms_version(&self) -> u32 {
        self.terms_version
    }
    pub fn terms_sha256(&self) -> &str {
        &self.terms_sha256
    }
    pub fn matches(&self, terms: &CanonicalTerms) -> bool {
        self.terms_version == terms.version().get() && self.terms_sha256 == terms.sha256()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeclineReason {
    Button,
    WindowClose,
    Escape,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConsentDecision {
    Accepted(UiAcceptance),
    Declined(DeclineReason),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UiErrorKind {
    UnsupportedPlatform,
    Busy,
    InvalidInput,
    ThreadStart,
    ThreadPanic,
    DpiContext,
    CreateDialog,
    CreateControl,
    Font,
    DisplayVerification,
    Layout,
    MessageLoop,
    CallbackPanic,
    UnexpectedDestroy,
    Cleanup,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeUiError {
    pub kind: UiErrorKind,
    pub os_error: Option<i32>,
}
impl NativeUiError {
    fn new(kind: UiErrorKind) -> Self {
        Self {
            kind,
            os_error: None,
        }
    }
    #[cfg(windows)]
    fn os(kind: UiErrorKind) -> Self {
        Self {
            kind,
            os_error: std::io::Error::last_os_error().raw_os_error(),
        }
    }
}
impl fmt::Display for NativeUiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "利用条件画面を正常に処理できません（{:?}、OS error {:?}）",
            self.kind, self.os_error
        )
    }
}
impl Error for NativeUiError {}

/// blocking API。専用UI thread上で表示し、Accept以外で保存権限を生成しない。
/// 本文は渡されたimmutable bundleのみ。current_exe、README、configを探索しない。
pub fn show_consent(terms: &CanonicalTerms) -> Result<ConsentDecision, NativeUiError> {
    let prepared = PreparedTerms::new(terms)?;
    #[cfg(windows)]
    {
        let _guard = ActiveUi::acquire()?;
        std::thread::Builder::new()
            .name("native-consent-ui".into())
            .spawn(move || windows::show(prepared))
            .map_err(|_| NativeUiError::new(UiErrorKind::ThreadStart))?
            .join()
            .map_err(|_| NativeUiError::new(UiErrorKind::ThreadPanic))?
    }
    #[cfg(not(windows))]
    {
        let _ = prepared;
        Err(NativeUiError::new(UiErrorKind::UnsupportedPlatform))
    }
}

struct ActiveUi;
impl ActiveUi {
    fn acquire() -> Result<Self, NativeUiError> {
        UI_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| NativeUiError::new(UiErrorKind::Busy))
    }
}
impl Drop for ActiveUi {
    fn drop(&mut self) {
        UI_ACTIVE.store(false, Ordering::Release);
    }
}

struct PreparedTerms {
    display: Vec<u16>,
    acceptance: UiAcceptance,
}
impl PreparedTerms {
    fn new(terms: &CanonicalTerms) -> Result<Self, NativeUiError> {
        let display = display_utf16(terms.text())?;
        Ok(Self {
            display,
            acceptance: UiAcceptance {
                terms_version: terms.version().get(),
                terms_sha256: terms.sha256().into(),
            },
        })
    }
}

fn display_utf16(canonical: &str) -> Result<Vec<u16>, NativeUiError> {
    if canonical.is_empty()
        || canonical.contains(['\0', '\r'])
        || canonical.chars().any(|c| c.is_control() && c != '\n')
    {
        return Err(NativeUiError::new(UiErrorKind::InvalidInput));
    }
    // CRLFはEDIT表示だけの変換。canonical/hashへ戻したり本文を書き換えない。
    let mut value: Vec<_> = canonical.replace('\n', "\r\n").encode_utf16().collect();
    value.push(0);
    Ok(value)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Accepted,
    Declined(DeclineReason),
    Error,
}
#[derive(Default)]
struct UiModel {
    display_verified: bool,
    checked: bool,
    terminal: Option<Action>,
}
impl UiModel {
    fn ready(&mut self) {
        if self.terminal.is_none() {
            self.display_verified = true;
        }
    }
    fn check(&mut self, checked: bool) {
        if self.terminal.is_none() {
            self.checked = checked;
        }
    }
    fn can_accept(&self) -> bool {
        self.display_verified && self.checked && self.terminal.is_none()
    }
    fn accept(&mut self) -> bool {
        if !self.can_accept() {
            return false;
        }
        self.terminal = Some(Action::Accepted);
        true
    }
    fn finish(&mut self, action: Action) -> bool {
        if self.terminal.is_some() {
            false
        } else {
            self.terminal = Some(action);
            true
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}
#[derive(Debug)]
struct Layout {
    header: Rect,
    version: Rect,
    label: Rect,
    body: Rect,
    notice: Rect,
    check: Rect,
    accept: Rect,
    decline: Rect,
}
fn scale(value: i32, dpi: u32) -> i32 {
    ((i64::from(value) * i64::from(dpi) + 48) / 96) as i32
}
fn layout(width: i32, height: i32, dpi: u32) -> Result<Layout, NativeUiError> {
    if !(48..=768).contains(&dpi) || width < scale(360, dpi) || height < scale(360, dpi) {
        return Err(NativeUiError::new(UiErrorKind::Layout));
    }
    let margin = scale(16, dpi);
    let gap = scale(8, dpi);
    let inner = width - 2 * margin;
    let buttons_y = height - margin - scale(36, dpi);
    let check_y = buttons_y - gap - scale(48, dpi);
    let notice_y = check_y - gap - scale(48, dpi);
    let body_y = margin + scale(28 + 24 + 24, dpi) + 3 * gap;
    let button_width = (inner - gap) / 2;
    Ok(Layout {
        header: Rect {
            x: margin,
            y: margin,
            width: inner,
            height: scale(28, dpi),
        },
        version: Rect {
            x: margin,
            y: margin + scale(28, dpi) + gap,
            width: inner,
            height: scale(24, dpi),
        },
        label: Rect {
            x: margin,
            y: margin + scale(52, dpi) + 2 * gap,
            width: inner,
            height: scale(24, dpi),
        },
        body: Rect {
            x: margin,
            y: body_y,
            width: inner,
            height: notice_y - gap - body_y,
        },
        notice: Rect {
            x: margin,
            y: notice_y,
            width: inner,
            height: scale(48, dpi),
        },
        check: Rect {
            x: margin,
            y: check_y,
            width: inner,
            height: scale(48, dpi),
        },
        accept: Rect {
            x: margin,
            y: buttons_y,
            width: button_width,
            height: scale(36, dpi),
        },
        decline: Rect {
            x: margin + button_width + gap,
            y: buttons_y,
            width: inner - button_width - gap,
            height: scale(36, dpi),
        },
    })
}
