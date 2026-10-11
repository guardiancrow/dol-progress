//! 通常testではignored。生成途中のhidden dialogを専用threadで試験する。
use super::*;
use crate::consent::TermsVersion;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS, GR_USEROBJECTS,
};
thread_local! {
    static FAIL_AT: Cell<usize> = const { Cell::new(0) };
    static STEP: Cell<usize> = const { Cell::new(0) };
    static HANDLES: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
}
pub(super) fn checkpoint() -> bool {
    let step = STEP.with(|counter| {
        let step = counter.get() + 1;
        counter.set(step);
        step
    });
    FAIL_AT.with(|failure| failure.get() == step)
}
pub(super) fn remember(hwnd: HWND) {
    HANDLES.with(|handles| handles.borrow_mut().push(hwnd as usize));
}
fn failed_creation(stage: usize) -> (u32, u32) {
    std::thread::spawn(move || {
        FAIL_AT.with(|failure| failure.set(stage));
        let terms = CanonicalTerms::from_body(
            TermsVersion::new(900004).unwrap(),
            b"TEST ONLY native creation failure\n",
        )
        .unwrap();
        let result = show(PreparedTerms::new(&terms).unwrap()).unwrap_err();
        assert_eq!(
            result.kind,
            match stage {
                1..=8 => UiErrorKind::CreateControl,
                9 => UiErrorKind::Font,
                _ => UiErrorKind::CallbackPanic,
            }
        );
        HANDLES.with(|handles| {
            for handle in handles.borrow().iter() {
                assert_eq!(unsafe { IsWindow(*handle as HWND) }, 0);
            }
        });
        unsafe {
            (
                GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS),
                GetGuiResources(GetCurrentProcess(), GR_USEROBJECTS),
            )
        }
    })
    .join()
    .unwrap()
}
#[test]
#[ignore = "desktop sessionを使う明示実行専用。通常cargo testではNative windowを作らない"]
fn partial_creation_font_and_callback_failures_release_owned_resources() {
    let baseline = failed_creation(1);
    for stage in 1..=10 {
        let resources = failed_creation(stage);
        assert_eq!(resources, baseline, "TEST ONLY failure stage {stage}");
        println!(
            "PASS creation failure stage {stage} / GDI={} USER={}",
            resources.0, resources.1
        );
    }
}
