use super::{
    gate::{self, GateStop, StartupGuard},
    native_ui::{show_consent, ConsentDecision, NativeUiError},
    CanonicalError, CanonicalTerms, ConsentStore, TermsVersion,
};
use std::path::Path;

// 本文・versionのユーザー承認後にだけ埋込値を設定する。外部fileや環境変数で有効化しない。
const APPROVED_TERMS: Option<(u32, &[u8])> = None;

pub(crate) fn approved_terms() -> Result<Option<CanonicalTerms>, CanonicalError> {
    APPROVED_TERMS
        .map(|(version, body)| CanonicalTerms::from_body(TermsVersion::new(version)?, body))
        .transpose()
}

pub(crate) fn authorize(root: &Path, terms: &CanonicalTerms) -> Result<StartupGuard, GateStop> {
    authorize_with(root, terms, show_consent)
}

fn authorize_with(
    root: &Path,
    terms: &CanonicalTerms,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
) -> Result<StartupGuard, GateStop> {
    let store = ConsentStore::for_portable_root(root).map_err(GateStop::Storage)?;
    gate::authorize_for_startup(terms, &store, ui)?
        .into_startup(root, terms)
        .map_err(|_| GateStop::IdentityMismatch)
}

pub(crate) fn error_message(stop: &GateStop) -> String {
    match stop {
        GateStop::Storage(error) if error.kind == super::StorageErrorKind::Busy =>
            "同じアプリのフォルダーで起動処理が進行中のため、起動を中止しました。\n\n処理が終わってから起動し直してください。".into(),
        GateStop::Storage(error) => format!(
            "使用許諾の同意設定を読み取るか保存できないため、起動を中止しました。\n\n{error}\n\nアプリのフォルダーが書き込み可能か確認してください。同意記録は自動で削除・修復しません。"
        ),
        GateStop::Record(_) => "使用許諾の同意設定が破損しているか、この版では扱えないため、起動を中止しました。\n\nconfig/consent.jsonを保持したまま、使用しているアプリの版と設定を確認してください。".into(),
        GateStop::Ui(_) => "使用許諾画面を表示または確認できないため、起動を中止しました。".into(),
        GateStop::IdentityMismatch => "使用許諾の本文を確認できないため、起動を中止しました。".into(),
        GateStop::Declined(_) => "使用許諾に同意されなかったため、起動を中止しました。".into(),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use crate::consent::{
        native_ui::{DeclineReason, UiAcceptance},
        RecordStatus,
    };
    use std::fs;

    fn root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "dol-first-run-consent-{}",
            crate::portable_paths::unique_suffix()
        ));
        fs::create_dir(&root).unwrap();
        root
    }
    fn terms() -> CanonicalTerms {
        CanonicalTerms::from_body(
            TermsVersion::new(900006).unwrap(),
            b"TEST ONLY unit consent.",
        )
        .unwrap()
    }
    #[test]
    fn unapproved_terms_are_disabled() {
        assert!(approved_terms().unwrap().is_none());
    }
    #[test]
    fn initial_acceptance_saves_and_next_start_skips_ui_then_releases() {
        let root = root();
        let terms = terms();
        let store = ConsentStore::for_portable_root(&root).unwrap();
        let guard = authorize_with(&root, &terms, |t| {
            Ok(ConsentDecision::Accepted(UiAcceptance::for_test(t)))
        })
        .unwrap();
        assert!(store.read(&terms).is_err());
        guard.finish();
        assert!(matches!(
            store.read(&terms).unwrap(),
            RecordStatus::Accepted(_)
        ));
        let before = fs::read(store.record_path()).unwrap();
        let guard =
            authorize_with(&root, &terms, |_| panic!("同意済みのためUIを呼ばない")).unwrap();
        guard.finish();
        assert_eq!(fs::read(store.record_path()).unwrap(), before);
    }
    #[test]
    fn decline_and_close_do_not_create_settings_or_data() {
        for reason in [
            DeclineReason::Button,
            DeclineReason::Escape,
            DeclineReason::WindowClose,
        ] {
            let root = root();
            assert!(matches!(
                authorize_with(&root, &terms(), |_| Ok(ConsentDecision::Declined(reason))),
                Err(GateStop::Declined(_))
            ));
            assert_eq!(fs::read_dir(root).unwrap().count(), 0);
        }
    }
    #[test]
    fn corrupt_record_is_preserved_and_save_failure_does_not_authorize() {
        let root = root();
        fs::create_dir(root.join("config")).unwrap();
        fs::write(root.join("config/consent.json"), b"invalid JSON").unwrap();
        assert!(matches!(
            authorize_with(&root, &terms(), |_| panic!("破損記録を上書きしない")),
            Err(GateStop::Record(_))
        ));
        assert_eq!(
            fs::read(root.join("config/consent.json")).unwrap(),
            b"invalid JSON"
        );
        let denied = self::root();
        assert!(matches!(
            authorize_with(&denied, &terms(), |t| Ok(ConsentDecision::Accepted({
                fs::write(denied.join("config"), b"obstruction").unwrap();
                UiAcceptance::for_test(t)
            }))),
            Err(GateStop::Storage(_))
        ));
        assert_eq!(fs::read(denied.join("config")).unwrap(), b"obstruction");
        assert!(!denied.join("data").exists());
    }
}
