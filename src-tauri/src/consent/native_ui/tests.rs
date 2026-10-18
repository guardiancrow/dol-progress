use super::*;
use crate::consent::TermsVersion;

fn terms() -> CanonicalTerms {
    CanonicalTerms::from_body(
        TermsVersion::new(900002).unwrap(),
        "TEST ONLY 合成本文。\nJapanese 日本語 © → 🙂\n".as_bytes(),
    )
    .unwrap()
}

#[test]
fn prepared_display_preserves_full_content_and_canonical_identity() {
    let terms = terms();
    let prepared = PreparedTerms::new(&terms).unwrap();
    let text = String::from_utf16(&prepared.display[..prepared.display.len() - 1]).unwrap();
    assert_eq!(text.replace("\r\n", "\n"), terms.text());
    assert_eq!(prepared.display.last(), Some(&0));
    assert!(prepared.acceptance.matches(&terms));
    assert_eq!(prepared.acceptance.terms_version(), 900002);
    assert_eq!(prepared.acceptance.terms_sha256(), terms.sha256());
}
#[test]
fn adopted_v2_display_preserves_full_body_and_final_line() {
    let terms = crate::consent::first_run::approved_terms()
        .unwrap()
        .unwrap();
    let prepared = PreparedTerms::new(&terms).unwrap();
    let displayed = String::from_utf16(&prepared.display[..prepared.display.len() - 1]).unwrap();
    assert_eq!(displayed.replace("\r\n", "\n"), terms.text());
    assert!(displayed.contains("Microsoft Windows SDK由来コードの条件"));
    assert!(displayed.contains("認識すべきであった場合"));
    assert!(displayed.ends_with("使用許諾文制定日：2026年10月18日\r\n"));
    assert_eq!(prepared.acceptance.terms_version(), 2);
    assert!(prepared.acceptance.matches(&terms));
}
#[test]
fn long_display_above_default_edit_limit_is_never_truncated() {
    let body = "TEST ONLY 日本語 and English 🙂 — long synthetic paragraph.\n".repeat(1500);
    let terms =
        CanonicalTerms::from_body(TermsVersion::new(900003).unwrap(), body.as_bytes()).unwrap();
    let prepared = PreparedTerms::new(&terms).unwrap();
    assert!(prepared.display.len() > 32767);
    assert_eq!(
        String::from_utf16(&prepared.display[..prepared.display.len() - 1])
            .unwrap()
            .replace("\r\n", "\n"),
        terms.text()
    );
}
#[test]
fn malformed_display_input_never_produces_a_ui_bundle() {
    for text in ["", "TEST ONLY\0tail", "TEST ONLY\rtail", "TEST ONLY\ttail"] {
        assert_eq!(
            display_utf16(text).unwrap_err().kind,
            UiErrorKind::InvalidInput
        );
    }
}
#[test]
fn unchecked_and_unverified_models_cannot_accept() {
    let mut model = UiModel::default();
    assert!(!model.accept());
    model.check(true);
    assert!(!model.accept());
    model.check(false);
    model.ready();
    assert!(!model.can_accept());
    assert!(!model.accept());
}
#[test]
fn check_then_explicit_button_accepts_once() {
    let mut model = UiModel::default();
    model.ready();
    model.check(true);
    assert!(model.can_accept());
    assert_eq!(model.terminal, None);
    assert!(model.accept());
    assert_eq!(model.terminal, Some(Action::Accepted));
    assert!(!model.accept());
    assert!(!model.finish(Action::Declined(DeclineReason::Button)));
}
#[test]
fn unchecking_revokes_acceptance_without_creating_a_decision() {
    let mut model = UiModel::default();
    model.ready();
    model.check(true);
    model.check(false);
    assert!(!model.can_accept());
    assert!(!model.accept());
    assert_eq!(model.terminal, None);
}
#[test]
fn every_decline_and_error_is_terminal_without_implicit_acceptance() {
    for action in [
        Action::Declined(DeclineReason::Button),
        Action::Declined(DeclineReason::WindowClose),
        Action::Declined(DeclineReason::Escape),
        Action::Error,
    ] {
        let mut model = UiModel::default();
        model.ready();
        model.check(true);
        assert!(model.finish(action));
        model.check(true);
        model.ready();
        assert!(!model.can_accept());
        assert!(!model.accept());
        assert_eq!(model.terminal, Some(action));
    }
}
#[test]
fn acceptance_matches_version_and_hash_without_app_version() {
    let prepared = PreparedTerms::new(&terms()).unwrap();
    let newer =
        CanonicalTerms::from_body(TermsVersion::new(900003).unwrap(), terms().bytes()).unwrap();
    let changed =
        CanonicalTerms::from_body(TermsVersion::new(900002).unwrap(), b"TEST ONLY changed\n")
            .unwrap();
    assert!(!prepared.acceptance.matches(&newer));
    assert!(!prepared.acceptance.matches(&changed));
}
#[test]
fn dpi_layout_keeps_controls_inside_and_footer_separate_from_body() {
    for dpi in [96, 120, 144, 192, 240, 384] {
        for (w, h) in [(360, 360), (460, 420), (760, 640), (1000, 700)] {
            let width = scale(w, dpi);
            let height = scale(h, dpi);
            let layout = layout(width, height, dpi).unwrap();
            assert!(layout.body.height >= scale(60, dpi));
            assert!(layout.body.y + layout.body.height < layout.notice.y);
            assert!(layout.notice.y + layout.notice.height < layout.check.y);
            assert!(layout.check.y + layout.check.height < layout.accept.y);
            for rect in [
                layout.header,
                layout.version,
                layout.label,
                layout.body,
                layout.notice,
                layout.check,
                layout.accept,
                layout.decline,
            ] {
                assert!(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
                assert!(rect.x + rect.width <= width && rect.y + rect.height <= height);
            }
        }
    }
}
#[test]
fn invalid_dpi_or_unusable_client_area_fails_instead_of_clipping() {
    for (w, h, dpi) in [
        (100, 640, 96),
        (760, 100, 96),
        (760, 640, 0),
        (760, 640, 10000),
    ] {
        assert_eq!(layout(w, h, dpi).unwrap_err().kind, UiErrorKind::Layout);
    }
}
#[test]
fn active_ui_rejects_concurrency_and_releases_after_drop() {
    let guard = ActiveUi::acquire().unwrap();
    assert!(matches!(
        ActiveUi::acquire(),
        Err(NativeUiError {
            kind: UiErrorKind::Busy,
            ..
        })
    ));
    drop(guard);
    drop(ActiveUi::acquire().unwrap());
}
