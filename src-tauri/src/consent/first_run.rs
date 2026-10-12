use super::{
    gate::{self, GateStop, StartupGuard},
    native_ui::{show_consent, ConsentDecision, NativeUiError},
    CanonicalError, CanonicalTerms, ConsentStore, TermsVersion,
};
use std::path::Path;

// 2026-10-12に承認された本文。外部fileや環境変数では差し替えない。
const APPROVED_TERMS: Option<(u32, &[u8])> = Some((1, APPROVED_BODY.as_bytes()));
const APPROVED_BODY: &str = r#"DOL Progress Manager 使用許諾

本アプリの独自コードと資料はMIT Licenseに基づいて提供されています。利用、複製、変更、再配布等の権利と条件はMIT License原文によります。

本アプリは現状のまま提供されます。保証と責任に関する条件はMIT License原文によります。法令によって認められる利用者の権利を、この説明によって制限するものではありません。

進捗データはお使いのPCに保存されます。利用・更新前には必要なバックアップを確保してください。

本アプリは非公式のファンメイドツールです。「大航海時代 Online」および「大航海時代データベース」の運営者・権利者との提携や、公認を示すものではありません。

『大航海時代 Online』の名称、ロゴ、画像その他の著作物・商標等に関する権利は、株式会社コーエーテクモゲームスまたは各権利者に帰属します。本アプリの独自コードと資料に適用するMIT Licenseによって、これら第三者の権利が許諾されるものではありません。

第三者のコード、データ、名称、商標には、それぞれの権利とライセンスが適用されます。

「同意する」を選ぶと、確認結果を設定として保存してアプリを起動します。「同意しない」を選ぶか、この画面を閉じると起動しません。

本アプリのソースコードはGitHubで公開する予定です。

公開予定先：
https://github.com/guardiancrow/dol-progress

Copyright (c) 2026 guardiancrow

使用許諾文制定日：2026年10月12日
"#;

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
        approved_terms()
            .unwrap()
            .expect("承認済み本文が設定されている")
    }
    #[test]
    fn approved_terms_are_enabled_and_match_entire_body_version_and_hash() {
        use sha2::{Digest, Sha256};
        let expected = r#"DOL Progress Manager 使用許諾

本アプリの独自コードと資料はMIT Licenseに基づいて提供されています。利用、複製、変更、再配布等の権利と条件はMIT License原文によります。

本アプリは現状のまま提供されます。保証と責任に関する条件はMIT License原文によります。法令によって認められる利用者の権利を、この説明によって制限するものではありません。

進捗データはお使いのPCに保存されます。利用・更新前には必要なバックアップを確保してください。

本アプリは非公式のファンメイドツールです。「大航海時代 Online」および「大航海時代データベース」の運営者・権利者との提携や、公認を示すものではありません。

『大航海時代 Online』の名称、ロゴ、画像その他の著作物・商標等に関する権利は、株式会社コーエーテクモゲームスまたは各権利者に帰属します。本アプリの独自コードと資料に適用するMIT Licenseによって、これら第三者の権利が許諾されるものではありません。

第三者のコード、データ、名称、商標には、それぞれの権利とライセンスが適用されます。

「同意する」を選ぶと、確認結果を設定として保存してアプリを起動します。「同意しない」を選ぶか、この画面を閉じると起動しません。

本アプリのソースコードはGitHubで公開する予定です。

公開予定先：
https://github.com/guardiancrow/dol-progress

Copyright (c) 2026 guardiancrow

使用許諾文制定日：2026年10月12日
"#;
        let current = terms();
        assert_eq!(current.version().get(), 1);
        assert_eq!(super::super::CANONICAL_VERSION, 1);
        assert_eq!(current.text(), expected);
        assert_eq!(
            current.sha256(),
            format!("{:x}", Sha256::digest(expected.as_bytes()))
        );
        assert!(current.bytes().ends_with(b"\n") && !current.bytes().ends_with(b"\n\n"));
        println!(
            "Approved termsVersion=1 canonicalVersion=1 SHA-256={}",
            current.sha256()
        );
    }
    #[test]
    fn initial_acceptance_saves_and_next_start_skips_ui_then_releases() {
        let root = root();
        let terms = terms();
        let store = ConsentStore::for_portable_root(&root).unwrap();
        let guard = authorize_with(&root, &terms, |t| {
            assert_eq!(t.text(), APPROVED_BODY);
            assert_eq!(t.version().get(), 1);
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
        if let RecordStatus::Accepted(record) = store.read(&terms).unwrap() {
            assert_eq!(record.terms_version(), 1);
            assert_eq!(record.terms_sha256(), terms.sha256());
        }
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

    #[test]
    fn previous_version_and_changed_body_require_explicit_reacceptance() {
        let current = terms();
        let changed = format!("{}本文変更の検証。\n", current.text());
        for next in [
            CanonicalTerms::from_body(TermsVersion::new(2).unwrap(), current.bytes()).unwrap(),
            CanonicalTerms::from_body(current.version(), changed.as_bytes()).unwrap(),
        ] {
            let root = root();
            let store = ConsentStore::for_portable_root(&root).unwrap();
            drop(store.save_after_explicit_acceptance(&current).unwrap());
            let original = fs::read(store.record_path()).unwrap();
            assert!(matches!(
                store.read(&next).unwrap(),
                RecordStatus::Outdated { .. } | RecordStatus::HashMismatch
            ));
            let called = std::cell::Cell::new(false);
            assert!(matches!(
                authorize_with(&root, &next, |_| {
                    called.set(true);
                    Ok(ConsentDecision::Declined(DeclineReason::Button))
                }),
                Err(GateStop::Declined(_))
            ));
            assert!(called.get());
            assert_eq!(fs::read(store.record_path()).unwrap(), original);
            authorize_with(&root, &next, |t| {
                Ok(ConsentDecision::Accepted(UiAcceptance::for_test(t)))
            })
            .unwrap()
            .finish();
            assert!(matches!(
                store.read(&next).unwrap(),
                RecordStatus::Accepted(_)
            ));
        }
    }
}
