use super::{
    gate::{self, GateStop, StartupGuard},
    native_ui::{show_consent, ConsentDecision, NativeUiError},
    CanonicalError, CanonicalTerms, ConsentStore, TermsVersion,
};
use std::path::Path;

// 2026-10-18の実装依頼に基づきv2を採用。契約適合性・配布の承認とは区別する。
// 外部fileや環境変数では差し替えない。
const APPROVED_TERMS: Option<(u32, &[u8])> = Some((2, APPROVED_BODY.as_bytes()));
const APPROVED_BODY: &str = r#"DOL Progress Manager 使用許諾

本アプリの独自コードと資料はMIT Licenseに基づいて提供されています。利用、複製、変更、再配布等の権利と条件はMIT License原文によります。

本アプリは現状のまま提供されます。保証と責任に関する条件はMIT License原文によります。法令によって認められる利用者の権利を、この説明によって制限するものではありません。

進捗データはお使いのPCに保存されます。利用・更新前には必要なバックアップを確保してください。

本アプリは、大航海時代データベースからのマスターデータの自動取得、同サイトへの書き込み、進捗データの外部送信を行いません。マスターデータは利用者自身が手動取得したファイルを取り込みます。

本アプリは非公式のファンメイドツールです。「大航海時代 Online」および「大航海時代データベース」の運営者・権利者との提携や、公認を示すものではありません。

『大航海時代 Online』の名称、ロゴ、画像その他の著作物・商標等に関する権利は、株式会社コーエーテクモゲームスまたは各権利者に帰属します。本アプリの独自コードと資料に適用するMIT Licenseによって、これら第三者の権利が許諾されるものではありません。

第三者のコード、データ、名称、商標には、それぞれの権利とライセンスが適用されます。

Microsoft Windows SDK由来コードの条件

本アプリの実行ファイルには、Microsoft Windows SDKのucrt.libおよびntdll.libに由来するコードが組み込まれています。以下、この組込み部分を「SDK対象コード」といいます。この条件はSDK対象コードだけに適用し、本プロジェクト独自のMIT License対象部分や、別のライセンスが適用される第三者OSSには適用しません。WebView2 SDKなど、別の条件を持つ第三者コードについては、配布物のTHIRD-PARTY-NOTICES.txtを参照してください。

SDK対象コードに関する著作権その他の権利はMicrosoftまたは各権利者に留保されます。SDK対象コードの利用・複製・再配布は、Microsoftの適用される使用許諾条件および適用法令に従います。SDK対象コードの所有権が移転するものではありません。本項は、その適用条件に基づく利用・再配布上の条件を説明するものであり、本プロジェクトがMicrosoft由来コードについて新たな権利や独立した再配布許諾を付与するものではありません。

SDK対象コードを利用・複製・再配布する場合は、Microsoftの適用条件で認められる範囲で、Microsoft Windows上で動作する本アプリに組み込まれた形で扱ってください。SDK対象コードを単独の配布対象としたり、改変したりすることはできません。SDK対象コードに含まれる著作権・商標・特許の表示を削除・変更せず、SDK対象コードの技術的制限を回避しないでください。SDK対象コードのリバースエンジニアリング、逆コンパイル、逆アセンブルは、適用法令がこの制限にかかわらず明示的に認める場合とその範囲を除き、行うことはできません。

SDK対象コードをMicrosoft以外のOS上で動作させるために再配布したり、悪意のある、欺瞞的な、または違法なプログラムに含めたりすることはできません。Microsoftの商標を、Microsoftが本アプリを提供・公認していると誤認させる形で使用しないでください。これらの条件は、SDK対象コードを含まない独自MITソースの利用・改変・移植・再配布を制限しません。

SDK対象コードは現状のまま提供され、その使用に伴うリスクは利用者が負います。MicrosoftはSDK対象コードについて明示の保証、担保または条件を提供せず、適用法令が許す範囲で、商品性、特定目的への適合性および非侵害についての黙示の保証も否認します。

適用法令が許す範囲で、SDK対象コードに関してMicrosoftおよびその供給者から賠償を受けられる損害は、直接損害に限り、5米ドルを上限とします。結果的損害、逸失利益、特別損害、間接損害、付随的損害その他の損害について賠償を受けることはできません。この制限は、契約違反、保証・担保・条件違反、厳格責任、過失その他の不法行為などの請求原因にかかわらず、Microsoftが損害の可能性を認識していた場合や、認識すべきであった場合にも適用されます。

前記の制限・免責は、適用法令により認められ、契約によって制限できない利用者の権利を制限しません。居住国その他の適用法令による消費者の権利、法定保証および例外が優先する場合があります。

SDK対象コードを含む本アプリを再配布する場合は、この条件を受領者が確認できる形で一緒に提供し、外部の利用者および再配布者にこの条件への合意を求めてください。本項によってMicrosoft由来コードをMIT Licenseで再許諾することはできません。独自MIT部分のライセンス表示と、第三者OSSに適用されるライセンス・通知も引き続き保持してください。

SDK対象コードを利用・再配布する方には、上記のSDK対象コードの条件に同意していただくことを求めます。同意しない場合はSDK対象コードを含む実行ファイルを利用・再配布しないでください。独自MITソースに認められた権利は、この同意の有無によって変更されません。

「同意する」を選ぶと、上記の使用許諾とSDK対象コードの条件を確認し同意した結果を設定として保存してアプリを起動します。「同意しない」を選ぶか、この画面を閉じると起動しません。

プロジェクト情報・ソースコードの参照先：
https://github.com/guardiancrow/dol-progress

Copyright (c) 2026 guardiancrow

使用許諾文制定日：2026年10月18日
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
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tmp/publication-consent-v2-implementation/fixtures")
            .join(crate::portable_paths::unique_suffix());
        fs::create_dir_all(&root).unwrap();
        root
    }
    fn terms() -> CanonicalTerms {
        approved_terms()
            .unwrap()
            .expect("承認済み本文が設定されている")
    }
    #[test]
    fn approved_terms_are_enabled_and_match_entire_body_version_and_hash() {
        let expected = include_str!("fixtures/terms-v2.txt");
        let current = terms();
        assert_eq!(current.version().get(), 2);
        assert_eq!(super::super::CANONICAL_VERSION, 1);
        assert_eq!(current.text(), expected);
        assert_eq!(
            current.sha256(),
            "59ea9b72e880a997c79be808232d096f21482a36ca7d71d6949ab1f5fb5b4d03"
        );
        assert_eq!(
            current.sha256(),
            CanonicalTerms::from_body(TermsVersion::new(2).unwrap(), expected.as_bytes())
                .unwrap()
                .sha256()
        );
        assert!(current.bytes().ends_with(b"\n") && !current.bytes().ends_with(b"\n\n"));
        println!(
            "Approved termsVersion=2 canonicalVersion=1 SHA-256={}",
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
            assert_eq!(t.version().get(), 2);
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
            assert_eq!(record.terms_version(), 2);
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
    fn historical_v1_body_version_and_hash_are_preserved() {
        let old = v1_terms();
        assert_eq!(old.version().get(), 1);
        assert_eq!(super::super::CANONICAL_VERSION, 1);
        assert_eq!(old.text(), include_str!("fixtures/terms-v1.txt"));
        assert_eq!(
            old.sha256(),
            "008980e0dadaabbf6a32c0337134ef50ad2214e40ba5bbd68fc8bf54a2c1807a"
        );
    }

    fn v1_terms() -> CanonicalTerms {
        CanonicalTerms::from_body(
            TermsVersion::new(1).unwrap(),
            include_bytes!("fixtures/terms-v1.txt"),
        )
        .unwrap()
    }

    // 本文の形式差だけを除く。語句・空白・句読点を補正して比較しない。
    fn sdk_block<'a>(text: &'a str, heading: &str, end: &str) -> &'a str {
        text.split_once(heading)
            .expect("SDK条件の見出しが必要")
            .1
            .split_once(end)
            .expect("SDK条件の終端が必要")
            .0
            .trim_matches('\n')
    }

    #[test]
    fn sdk_conditions_match_readme_without_text_corrections() {
        let readme = include_str!("../../../README.md").replace("\r\n", "\n");
        let current = terms();
        let expected = sdk_block(
            current.text(),
            "Microsoft Windows SDK由来コードの条件\n\n",
            "\n\n「同意する」",
        );
        let actual = sdk_block(
            &readme,
            "### Microsoft Windows SDK由来コードの利用・再配布条件\n\n",
            "\n## 仕様書",
        );
        assert_eq!(expected.split("\n\n").count(), 9);
        assert_eq!(actual, expected);
    }

    fn verify_reacceptance(old: &CanonicalTerms, next: &CanonicalTerms, outdated: bool) {
        for reason in [
            DeclineReason::Button,
            DeclineReason::Escape,
            DeclineReason::WindowClose,
        ] {
            let root = root();
            let store = ConsentStore::for_portable_root(&root).unwrap();
            drop(store.save_after_explicit_acceptance(old).unwrap());
            fs::create_dir(root.join("data")).unwrap();
            let protected = [
                ("data/app.sqlite3", b"TEST_ONLY progress DB".as_slice()),
                ("config/settings.json", b"TEST_ONLY settings".as_slice()),
            ];
            for (path, bytes) in protected {
                fs::write(root.join(path), bytes).unwrap();
            }
            let original = fs::read(store.record_path()).unwrap();
            if outdated {
                assert!(matches!(
                    store.read(next).unwrap(),
                    RecordStatus::Outdated {
                        recorded_version: 1
                    }
                ));
            } else {
                assert!(matches!(
                    store.read(next).unwrap(),
                    RecordStatus::HashMismatch
                ));
            }
            let called = std::cell::Cell::new(false);
            assert!(matches!(
                authorize_with(&root, next, |t| {
                    called.set(true);
                    assert_eq!(t.text(), next.text());
                    assert_eq!(t.version(), next.version());
                    Ok(ConsentDecision::Declined(reason))
                }),
                Err(GateStop::Declined(_))
            ));
            assert!(called.get());
            assert_eq!(fs::read(store.record_path()).unwrap(), original);
            for (path, bytes) in protected {
                assert_eq!(fs::read(root.join(path)).unwrap(), bytes);
            }
            authorize_with(&root, next, |t| {
                assert_eq!(t.text(), next.text());
                Ok(ConsentDecision::Accepted(UiAcceptance::for_test(t)))
            })
            .unwrap()
            .finish();
            if let RecordStatus::Accepted(record) = store.read(next).unwrap() {
                assert_eq!(record.terms_version(), next.version().get());
                assert_eq!(record.terms_sha256(), next.sha256());
            } else {
                panic!("明示同意した本文だけを保存する");
            }
            for (path, bytes) in protected {
                assert_eq!(fs::read(root.join(path)).unwrap(), bytes);
            }
        }
    }

    #[test]
    fn historical_v1_requires_explicit_v2_reacceptance() {
        verify_reacceptance(&v1_terms(), &terms(), true);
    }

    #[test]
    fn same_version_hash_mismatch_requires_explicit_reacceptance() {
        let current = terms();
        let previous = CanonicalTerms::from_body(
            current.version(),
            b"TEST ONLY previous body with the same version.\n",
        )
        .unwrap();
        verify_reacceptance(&previous, &current, false);
    }
}
