use super::*;
use serde_json::{json, Value};

const TEST_VERSION: u32 = 900_001;
const SYNTHETIC: &str = "TEST_ONLY 合成利用条件。\n\n・合成データだけを使用する。\n";
const SYNTHETIC_SHA: &str = "db939deee4de12faf54e230687f214c3e1414aa734a882347fe0250ff6c0b7ad";

fn terms(version: u32) -> CanonicalTerms {
    CanonicalTerms::from_body(TermsVersion::new(version).unwrap(), SYNTHETIC.as_bytes()).unwrap()
}

fn fixture_record(version: u32) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "schemaVersion": 1, "canonicalVersion": 1,
        "termsVersion": version, "termsSha256": SYNTHETIC_SHA, "state": "accepted"
    }))
    .unwrap()
}

fn altered_record(field: &str, value: Value) -> Vec<u8> {
    let mut record: Value = serde_json::from_slice(&fixture_record(TEST_VERSION)).unwrap();
    record[field] = value;
    serde_json::to_vec(&record).unwrap()
}

#[test]
fn canonical_sha256_matches_independent_node_vectors() {
    let version = TermsVersion::new(TEST_VERSION).unwrap();
    let abc = CanonicalTerms::from_body(version, b"abc").unwrap();
    assert_eq!(abc.bytes(), b"abc\n");
    assert_eq!(
        abc.sha256(),
        "edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb"
    );
    let japanese = terms(TEST_VERSION);
    assert_eq!(japanese.bytes(), SYNTHETIC.as_bytes());
    assert_eq!(japanese.sha256(), SYNTHETIC_SHA);
}

#[test]
fn canonical_bom_crlf_and_outer_empty_lines_are_equivalent() {
    let expected = terms(TEST_VERSION);
    for text in [
        format!("\u{feff}{SYNTHETIC}"),
        SYNTHETIC.replace('\n', "\r\n"),
        format!("\n\n{SYNTHETIC}\n\n"),
    ] {
        assert_eq!(
            CanonicalTerms::from_body(expected.version(), text.as_bytes()).unwrap(),
            expected
        );
    }
}

#[test]
fn canonical_keeps_internal_space_blank_lines_unicode_and_bom() {
    let original = terms(TEST_VERSION);
    for changed in [
        SYNTHETIC.replace("条件。", "条件。 "),
        SYNTHETIC.replace("\n\n", "\n\n\n"),
        SYNTHETIC.replace("条件", "條件"),
        SYNTHETIC.replace("条件", "条\u{feff}件"),
    ] {
        assert_ne!(
            CanonicalTerms::from_body(original.version(), changed.as_bytes())
                .unwrap()
                .sha256(),
            original.sha256()
        );
    }
    let composed = CanonicalTerms::from_body(original.version(), "TEST_ONLY é".as_bytes()).unwrap();
    let decomposed =
        CanonicalTerms::from_body(original.version(), "TEST_ONLY e\u{301}".as_bytes()).unwrap();
    assert_ne!(composed.sha256(), decomposed.sha256());
}

#[test]
fn canonical_rejects_empty_invalid_utf8_and_controls() {
    for bytes in [b"".as_slice(), b"\n\n", b" ", b"\xef\xbb\xbf"] {
        assert_eq!(
            CanonicalTerms::from_body(TermsVersion::new(1).unwrap(), bytes),
            Err(CanonicalError::EmptyBody)
        );
    }
    assert_eq!(
        CanonicalTerms::from_body(TermsVersion::new(1).unwrap(), &[0xff]),
        Err(CanonicalError::InvalidUtf8)
    );
    assert_eq!(
        CanonicalTerms::from_body(TermsVersion::new(1).unwrap(), b"a\rb"),
        Err(CanonicalError::LoneCarriageReturn)
    );
    for body in ["TEST_ONLY\0", "TEST_ONLY\t", "TEST_ONLY\u{7f}"] {
        assert_eq!(
            CanonicalTerms::from_body(TermsVersion::new(1).unwrap(), body.as_bytes()),
            Err(CanonicalError::ControlCharacter)
        );
    }
}

#[test]
fn canonical_rejects_markup_and_oversize_without_truncation() {
    for body in [
        "# title",
        "#### title",
        "`code`",
        "**bold**",
        "_italic_",
        "[link](https://example.test)",
        "<!-- marker -->",
        "|table|",
        "- bullet",
        "1. list",
        "> quote",
    ] {
        assert_eq!(
            CanonicalTerms::from_body(TermsVersion::new(1).unwrap(), body.as_bytes()),
            Err(CanonicalError::UnsupportedMarkup)
        );
    }
    assert_eq!(
        CanonicalTerms::from_body(TermsVersion::new(1).unwrap(), &vec![b'a'; 128 * 1024 + 1]),
        Err(CanonicalError::TooLarge)
    );
    assert!(CanonicalTerms::from_body(
        TermsVersion::new(1).unwrap(),
        b"TEST_ONLY https://example.test/a_b"
    )
    .is_ok());
}

#[test]
fn condition_version_has_no_app_version_dependency() {
    for value in [
        "",
        "0",
        "01",
        "+1",
        "-1",
        "1.0",
        "1e2",
        " 1",
        "1 ",
        "４",
        "4294967296",
    ] {
        assert_eq!(
            TermsVersion::parse(value),
            Err(CanonicalError::InvalidVersion)
        );
    }
    assert_eq!(TermsVersion::parse("4294967295").unwrap().get(), u32::MAX);
    let first = terms(TEST_VERSION);
    let revised = terms(TEST_VERSION + 1);
    assert_eq!(first.sha256(), revised.sha256());
    assert_ne!(first.version(), revised.version());
}

fn synthetic_readme(body: &str) -> String {
    format!("# TEST_ONLY\n\n## その他\n合成案内\n\n## License\n合成序文\n\n### 利用条件\n\n{body}\n### 第三者ライセンス資料\n合成案内\n\n## 次の節\n合成案内\n")
}

#[test]
fn readme_extracts_only_canonical_terms_and_ignores_other_sections() {
    let expected = terms(TEST_VERSION);
    let doc = synthetic_readme(SYNTHETIC);
    for text in [
        doc.clone(),
        format!(
            "\u{feff}Application version: TEST_ONLY\r\n{}",
            doc.replace('\n', "\r\n")
        ),
        doc.replace("合成案内", "変更した案内"),
    ] {
        assert_eq!(
            CanonicalTerms::from_readme(expected.version(), text.as_bytes()).unwrap(),
            expected
        );
    }
}

#[test]
fn readme_rejects_missing_duplicate_or_misplaced_headings() {
    let doc = synthetic_readme(SYNTHETIC);
    for text in [
        doc.replace("## License", "## Other"),
        doc.replace("### 利用条件", "### Other"),
        format!("{doc}\n## License\n"),
        format!("{doc}\n### 利用条件\n"),
        doc.replace("## License", "## Other\n### 利用条件\n"),
        doc.replace("## License", "### License"),
    ] {
        assert_eq!(
            CanonicalTerms::from_readme(TermsVersion::new(TEST_VERSION).unwrap(), text.as_bytes()),
            Err(CanonicalError::HeadingBoundary)
        );
    }
    let embedded_bom = synthetic_readme(&format!("\u{feff}{SYNTHETIC}"));
    assert_ne!(
        CanonicalTerms::from_readme(
            TermsVersion::new(TEST_VERSION).unwrap(),
            embedded_bom.as_bytes()
        )
        .unwrap()
        .sha256(),
        SYNTHETIC_SHA
    );
}

#[test]
fn record_accepts_only_exact_schema_version_hash_and_state() {
    assert!(matches!(
        parse_record(&fixture_record(TEST_VERSION), &terms(TEST_VERSION)),
        RecordStatus::Accepted(_)
    ));
    let accepted = ConsentRecord::accepted(&terms(TEST_VERSION));
    assert_eq!(accepted.terms_version(), TEST_VERSION);
    assert_eq!(accepted.terms_sha256(), SYNTHETIC_SHA);
    let value = serde_json::to_value(&accepted).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 5);
    assert_eq!(value["state"], "accepted");
    for excluded in ["acceptedAt", "user", "account", "machineId", "appVersion"] {
        assert!(value.get(excluded).is_none());
    }
}

#[test]
fn record_distinguishes_old_future_and_hash_mismatch() {
    let current = terms(TEST_VERSION);
    assert_eq!(
        parse_record(&fixture_record(TEST_VERSION - 1), &current),
        RecordStatus::Outdated {
            recorded_version: TEST_VERSION - 1
        }
    );
    assert_eq!(
        parse_record(&fixture_record(TEST_VERSION + 1), &current),
        RecordStatus::FutureTerms {
            recorded_version: TEST_VERSION + 1
        }
    );
    assert_eq!(
        parse_record(
            &altered_record("termsSha256", json!("0".repeat(64))),
            &current
        ),
        RecordStatus::HashMismatch
    );
    assert_eq!(
        parse_record(&fixture_record(TEST_VERSION), &terms(TEST_VERSION + 1)),
        RecordStatus::Outdated {
            recorded_version: TEST_VERSION
        }
    );
}

#[test]
fn record_unknown_envelopes_are_not_treated_as_repairable_schema_one() {
    for version in [0, 2, u32::MAX] {
        assert_eq!(
            parse_record(
                &serde_json::to_vec(&json!({"schemaVersion":version,"futureOnly":true})).unwrap(),
                &terms(TEST_VERSION)
            ),
            RecordStatus::UnsupportedSchema { version }
        );
    }
    assert_eq!(
        parse_record(
            &serde_json::to_vec(&json!({"schemaVersion":1,"canonicalVersion":2,"futureOnly":true}))
                .unwrap(),
            &terms(TEST_VERSION)
        ),
        RecordStatus::UnsupportedCanonical { version: 2 }
    );
}

#[test]
fn record_rejects_invalid_hash_spelling() {
    for hash in [
        SYNTHETIC_SHA.to_uppercase(),
        "0".repeat(63),
        "0".repeat(65),
        "g".repeat(64),
        format!(" {SYNTHETIC_SHA}"),
    ] {
        assert_eq!(
            parse_record(
                &altered_record("termsSha256", json!(hash)),
                &terms(TEST_VERSION)
            ),
            RecordStatus::Corrupt(RecordIssue::InvalidHash)
        );
    }
}

#[test]
fn record_does_not_correct_unaccepted_states() {
    for state in ["declined", "pending", "", "Accepted", "true"] {
        assert_eq!(
            parse_record(&altered_record("state", json!(state)), &terms(TEST_VERSION)),
            RecordStatus::InvalidState
        );
    }
    for state in [json!(true), json!(false), json!(null), json!(1)] {
        assert_eq!(
            parse_record(&altered_record("state", state), &terms(TEST_VERSION)),
            RecordStatus::Corrupt(RecordIssue::InvalidType)
        );
    }
}

#[test]
fn record_rejects_wrong_field_types_zero_and_overflow() {
    for field in ["schemaVersion", "canonicalVersion", "termsVersion"] {
        for value in [
            json!("1"),
            json!(1.0),
            json!(true),
            json!(-1),
            json!(null),
            json!([]),
        ] {
            assert_eq!(
                parse_record(&altered_record(field, value), &terms(TEST_VERSION)),
                RecordStatus::Corrupt(RecordIssue::InvalidType)
            );
        }
    }
    for value in [json!(0), json!(4294967296u64)] {
        assert_eq!(
            parse_record(&altered_record("termsVersion", value), &terms(TEST_VERSION)),
            RecordStatus::Corrupt(RecordIssue::InvalidVersion)
        );
    }
    assert_eq!(
        parse_record(
            &altered_record("termsSha256", json!(9)),
            &terms(TEST_VERSION)
        ),
        RecordStatus::Corrupt(RecordIssue::InvalidType)
    );
}

#[test]
fn record_rejects_unknown_missing_and_duplicate_keys() {
    assert_eq!(
        parse_record(&altered_record("extra", json!(1)), &terms(TEST_VERSION)),
        RecordStatus::Corrupt(RecordIssue::UnknownField)
    );
    for field in [
        "schemaVersion",
        "canonicalVersion",
        "termsVersion",
        "termsSha256",
        "state",
    ] {
        let mut value: Value = serde_json::from_slice(&fixture_record(TEST_VERSION)).unwrap();
        value.as_object_mut().unwrap().remove(field);
        assert_eq!(
            parse_record(&serde_json::to_vec(&value).unwrap(), &terms(TEST_VERSION)),
            RecordStatus::Corrupt(RecordIssue::MissingField)
        );
    }
    let text = String::from_utf8(fixture_record(TEST_VERSION)).unwrap();
    for field in [
        "schemaVersion",
        "canonicalVersion",
        "termsVersion",
        "termsSha256",
        "state",
        "\\u0073chemaVersion",
    ] {
        let duplicate = text.replacen('{', &format!("{{\"{field}\":1,"), 1);
        assert_eq!(
            parse_record(duplicate.as_bytes(), &terms(TEST_VERSION)),
            RecordStatus::Corrupt(RecordIssue::MalformedJson)
        );
    }
}

#[test]
fn record_rejects_empty_torn_invalid_utf8_bom_and_trailing_values() {
    for bytes in [
        b"{".as_slice(),
        b"[]",
        b"null",
        b"{} {}",
        b" \n",
        b"\xef\xbb\xbf{}",
    ] {
        assert!(matches!(
            parse_record(bytes, &terms(TEST_VERSION)),
            RecordStatus::Corrupt(_)
        ));
    }
    assert_eq!(
        parse_record(b"", &terms(TEST_VERSION)),
        RecordStatus::Corrupt(RecordIssue::Empty)
    );
    assert_eq!(
        parse_record(&[0xff], &terms(TEST_VERSION)),
        RecordStatus::Corrupt(RecordIssue::InvalidUtf8)
    );
    assert_eq!(
        parse_record(&vec![b' '; 4097], &terms(TEST_VERSION)),
        RecordStatus::Corrupt(RecordIssue::TooLarge)
    );
    let mut text = fixture_record(TEST_VERSION);
    text.extend_from_slice(b"\nfalse");
    assert_eq!(
        parse_record(&text, &terms(TEST_VERSION)),
        RecordStatus::Corrupt(RecordIssue::MalformedJson)
    );
}

#[cfg(windows)]
mod filesystem {
    use super::*;
    use std::os::windows::{fs::OpenOptionsExt, process::CommandExt};
    use std::{
        fs, io,
        path::{Path, PathBuf},
        process::{Child, Command},
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc, Barrier,
        },
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        root: PathBuf,
        portable: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let base = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("tmp/phase-local-5c-a/fixtures");
            fs::create_dir_all(&base).unwrap();
            let root = base.join(format!(
                "{}-{}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            fs::write(root.join("TEST_ONLY.fixture"), b"TEST_ONLY").unwrap();
            let portable = root.join("portable");
            fs::create_dir(&portable).unwrap();
            Self { root, portable }
        }
        fn store(&self) -> ConsentStore {
            ConsentStore::for_portable_root(&self.portable).unwrap()
        }
        fn config(&self) -> PathBuf {
            self.portable.join("config")
        }
        fn with_record(&self, bytes: &[u8]) {
            fs::create_dir(self.config()).unwrap();
            fs::write(self.store().record_path(), bytes).unwrap();
        }
    }
    // 隔離証拠を残す。実dataの探索やrecursive cleanupは行わない。

    fn hidden(command: &mut Command) -> &mut Command {
        command.creation_flags(0x08000000)
    }

    #[test]
    fn read_missing_does_not_create_config_or_lock() {
        let f = Fixture::new();
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap(),
            RecordStatus::Missing
        );
        assert!(!f.config().exists());
        assert_eq!(fs::read_dir(&f.portable).unwrap().count(), 0);
    }

    #[test]
    fn new_save_reread_and_valid_record_lease_are_consistent() {
        let f = Fixture::new();
        let store = f.store();
        let current = terms(TEST_VERSION);
        let saved = store.save_after_explicit_acceptance(&current).unwrap();
        assert!(saved.was_written());
        assert_eq!(saved.record().terms_sha256(), SYNTHETIC_SHA);
        assert_eq!(
            store.read(&current).unwrap_err().kind,
            StorageErrorKind::Busy
        );
        assert_eq!(
            store.lock_verified_record(&current).unwrap_err().kind,
            StorageErrorKind::Busy
        );
        drop(saved);
        assert!(matches!(
            store.read(&current).unwrap(),
            RecordStatus::Accepted(_)
        ));
        let before = fs::read(store.record_path()).unwrap();
        let verified = store.lock_verified_record(&current).unwrap();
        assert!(!verified.was_written());
        drop(verified);
        assert!(!store
            .save_after_explicit_acceptance(&current)
            .unwrap()
            .was_written());
        assert_eq!(fs::read(store.record_path()).unwrap(), before);
        assert_eq!(fs::read_dir(f.config()).unwrap().count(), 2);
    }

    #[test]
    fn explicit_upgrade_and_hash_reconsent_do_not_downgrade() {
        let f = Fixture::new();
        f.with_record(&fixture_record(TEST_VERSION - 1));
        let store = f.store();
        drop(
            store
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap(),
        );
        assert!(matches!(
            store.read(&terms(TEST_VERSION)).unwrap(),
            RecordStatus::Accepted(_)
        ));
        let before = fs::read(store.record_path()).unwrap();
        assert!(matches!(
            store
                .save_after_explicit_acceptance(&terms(TEST_VERSION - 1))
                .unwrap_err()
                .kind,
            StorageErrorKind::BlockedRecord(RecordStatus::FutureTerms { .. })
        ));
        assert_eq!(fs::read(store.record_path()).unwrap(), before);
        let changed = CanonicalTerms::from_body(
            TermsVersion::new(TEST_VERSION).unwrap(),
            b"TEST_ONLY changed",
        )
        .unwrap();
        drop(store.save_after_explicit_acceptance(&changed).unwrap());
        assert!(matches!(
            store.read(&changed).unwrap(),
            RecordStatus::Accepted(_)
        ));
    }

    #[test]
    fn corrupt_unsupported_and_unaccepted_records_are_preserved_without_lock_creation() {
        for bytes in [
            b"{".to_vec(),
            altered_record("schemaVersion", json!(2)),
            altered_record("canonicalVersion", json!(2)),
            altered_record("state", json!("declined")),
            altered_record("extra", json!(true)),
            vec![b' '; 4097],
        ] {
            let f = Fixture::new();
            f.with_record(&bytes);
            assert!(matches!(
                f.store()
                    .save_after_explicit_acceptance(&terms(TEST_VERSION))
                    .unwrap_err()
                    .kind,
                StorageErrorKind::BlockedRecord(_)
            ));
            assert_eq!(fs::read(f.store().record_path()).unwrap(), bytes);
            assert_eq!(fs::read_dir(f.config()).unwrap().count(), 1);
        }
    }

    #[test]
    fn path_validation_rejects_relative_parent_devices_streams_and_aliases() {
        for path in [
            "relative",
            ".",
            "D:\\",
            "D:\\safe\\..\\other",
            "D:\\safe\\.\\other",
            "D:\\safe\\NUL",
            "D:\\safe\\CON.txt",
            "D:\\safe\\COM¹",
            "D:\\safe\\name:stream",
            "D:\\safe\\name.",
            "D:\\safe\\name ",
            "\\\\server\\share\\folder",
            "\\\\.\\pipe\\fake",
        ] {
            assert_eq!(
                ConsentStore::for_portable_root(Path::new(path))
                    .unwrap_err()
                    .kind,
                StorageErrorKind::InvalidPath
            );
        }
    }

    #[test]
    fn missing_portable_root_is_not_created() {
        let f = Fixture::new();
        let missing = f.root.join("missing");
        let store = ConsentStore::for_portable_root(&missing).unwrap();
        assert!(store.read(&terms(TEST_VERSION)).is_err());
        assert!(store
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
        assert!(!missing.exists());
    }

    #[test]
    fn config_record_and_lock_directory_collisions_are_rejected() {
        let f = Fixture::new();
        fs::write(f.config(), b"TEST_ONLY sentinel").unwrap();
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap_err().kind,
            StorageErrorKind::PathConflict
        );
        assert!(f
            .store()
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
        assert_eq!(fs::read(f.config()).unwrap(), b"TEST_ONLY sentinel");
        let f = Fixture::new();
        fs::create_dir(f.config()).unwrap();
        fs::create_dir(f.store().record_path()).unwrap();
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap_err().kind,
            StorageErrorKind::PathConflict
        );
        let f = Fixture::new();
        fs::create_dir(f.config()).unwrap();
        fs::create_dir(f.config().join("consent-startup.lock")).unwrap();
        assert_eq!(
            f.store()
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap_err()
                .kind,
            StorageErrorKind::PathConflict
        );
        assert!(!f.store().record_path().exists());
    }

    #[test]
    fn exclusive_reader_is_an_io_error_not_a_missing_record() {
        let f = Fixture::new();
        f.with_record(&fixture_record(TEST_VERSION));
        let blocker = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(f.store().record_path())
            .unwrap();
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap_err().kind,
            StorageErrorKind::Io
        );
        assert!(f
            .store()
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
        drop(blocker);
        assert_eq!(
            fs::read(f.store().record_path()).unwrap(),
            fixture_record(TEST_VERSION)
        );
    }

    struct DenyAcl(PathBuf);
    impl DenyAcl {
        fn new(path: &Path, access: &str) -> Self {
            let output = hidden(
                Command::new("icacls")
                    .arg(path)
                    .arg("/deny")
                    .arg(format!("*S-1-1-0:(OI)(CI)({access})")),
            )
            .output()
            .unwrap();
            assert!(output.status.success(), "隔離fixtureへのACL設定失敗");
            Self(path.into())
        }
    }
    impl Drop for DenyAcl {
        fn drop(&mut self) {
            let output = hidden(
                Command::new("icacls")
                    .arg(&self.0)
                    .arg("/remove:d")
                    .arg("*S-1-1-0"),
            )
            .output()
            .unwrap();
            assert!(output.status.success(), "隔離fixtureのACL復元失敗");
        }
    }

    #[test]
    fn write_denied_config_stops_without_record_or_normal_data() {
        let f = Fixture::new();
        fs::create_dir(f.config()).unwrap();
        let deny = DenyAcl::new(&f.config(), "W");
        assert!(f
            .store()
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
        drop(deny);
        assert!(!f.store().record_path().exists());
        assert_eq!(fs::read_dir(f.config()).unwrap().count(), 0);
        assert!(!f.portable.join("data").exists());
    }

    #[test]
    fn read_denied_config_stops_and_preserves_record() {
        let f = Fixture::new();
        f.with_record(&fixture_record(TEST_VERSION));
        let deny = DenyAcl::new(&f.config(), "R");
        assert!(f.store().read(&terms(TEST_VERSION)).is_err());
        assert!(f
            .store()
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
        drop(deny);
        assert_eq!(
            fs::read(f.store().record_path()).unwrap(),
            fixture_record(TEST_VERSION)
        );
    }

    fn junction(path: &Path, target: &Path) {
        let output = hidden(
            Command::new("cmd.exe")
                .arg("/c")
                .arg("mklink")
                .arg("/J")
                .arg(path.to_str().unwrap().replace('/', "\\"))
                .arg(target.to_str().unwrap().replace('/', "\\")),
        )
        .output()
        .unwrap();
        assert!(
            output.status.success(),
            "隔離fixtureでのjunction生成失敗: {:?} / {} / {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn junction_config_and_ancestor_do_not_write_to_another_fixture() {
        let outside = Fixture::new();
        let f = Fixture::new();
        junction(&f.config(), &outside.portable);
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap_err().kind,
            StorageErrorKind::UnsafePath
        );
        assert!(f
            .store()
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
        assert_eq!(fs::read_dir(&outside.portable).unwrap().count(), 0);
        let alias = f.root.join("alias");
        junction(&alias, &outside.portable);
        let store = ConsentStore::for_portable_root(&alias).unwrap();
        assert!(store
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
        assert!(!outside.config().exists());
        let record_link = Fixture::new();
        fs::create_dir(record_link.config()).unwrap();
        junction(&record_link.store().record_path(), &outside.portable);
        assert_eq!(
            record_link
                .store()
                .read(&terms(TEST_VERSION))
                .unwrap_err()
                .kind,
            StorageErrorKind::UnsafePath
        );
        assert!(record_link
            .store()
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
    }

    #[test]
    fn file_symlink_is_rejected_or_privilege_limitation_is_recorded() {
        let outside = Fixture::new();
        outside.with_record(&fixture_record(TEST_VERSION));
        let f = Fixture::new();
        fs::create_dir(f.config()).unwrap();
        match std::os::windows::fs::symlink_file(
            outside.store().record_path(),
            f.store().record_path(),
        ) {
            Ok(()) => {
                assert_eq!(
                    f.store().read(&terms(TEST_VERSION)).unwrap_err().kind,
                    StorageErrorKind::UnsafePath
                );
                assert!(f
                    .store()
                    .save_after_explicit_acceptance(&terms(TEST_VERSION))
                    .is_err());
                assert_eq!(
                    fs::read(outside.store().record_path()).unwrap(),
                    fixture_record(TEST_VERSION)
                );
            }
            Err(e) if e.raw_os_error() == Some(1314) => {
                fs::write(
                    f.root.join("SYMLINK_SKIPPED.txt"),
                    b"TEST_ONLY: OS error 1314; junction test remains active",
                )
                .unwrap();
            }
            Err(e) => panic!("symlink fixture生成失敗: {e}"),
        }
    }

    #[test]
    fn hardlinked_record_and_lock_are_rejected_without_touching_other_file() {
        let outside = Fixture::new();
        outside.with_record(&fixture_record(TEST_VERSION));
        let f = Fixture::new();
        fs::create_dir(f.config()).unwrap();
        fs::hard_link(outside.store().record_path(), f.store().record_path()).unwrap();
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap_err().kind,
            StorageErrorKind::UnsafePath
        );
        assert!(f
            .store()
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .is_err());
        let lock_fixture = Fixture::new();
        fs::create_dir(lock_fixture.config()).unwrap();
        fs::hard_link(
            outside.store().record_path(),
            lock_fixture.config().join("consent-startup.lock"),
        )
        .unwrap();
        assert_eq!(
            lock_fixture
                .store()
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap_err()
                .kind,
            StorageErrorKind::UnsafePath
        );
        assert_eq!(
            fs::read(outside.store().record_path()).unwrap(),
            fixture_record(TEST_VERSION)
        );
    }

    #[test]
    fn faults_before_replacement_preserve_existing_record_and_report_artifacts() {
        for stage in [
            SaveStage::PrepareConfig,
            SaveStage::TempCreate,
            SaveStage::TempWrite,
            SaveStage::TempHalfWritten,
            SaveStage::TempSync,
            SaveStage::VerifyTemporary,
            SaveStage::BackupCreate,
            SaveStage::BackupWrite,
            SaveStage::BackupSync,
            SaveStage::Replace,
        ] {
            let f = Fixture::new();
            let old = fixture_record(TEST_VERSION - 1);
            f.with_record(&old);
            let error = f
                .store()
                .save_with(&terms(TEST_VERSION), |here| {
                    if here == stage {
                        Err(io::Error::other("TEST_ONLY injected failure"))
                    } else {
                        Ok(())
                    }
                })
                .unwrap_err();
            assert_eq!(error.stage, stage);
            assert_eq!(error.commit_state, CommitState::NotReplaced);
            assert_eq!(fs::read(f.store().record_path()).unwrap(), old);
            assert!(error
                .recovery_artifacts
                .iter()
                .all(|path| path.starts_with(f.config())));
            drop(
                f.store()
                    .save_after_explicit_acceptance(&terms(TEST_VERSION))
                    .unwrap(),
            );
        }
    }

    #[test]
    fn faults_after_replace_never_return_success_and_keep_original_backup() {
        for stage in [
            SaveStage::AfterReplace,
            SaveStage::DestinationSync,
            SaveStage::VerifyDestination,
            SaveStage::Cleanup,
        ] {
            let f = Fixture::new();
            let old = fixture_record(TEST_VERSION - 1);
            f.with_record(&old);
            let error = f
                .store()
                .save_with(&terms(TEST_VERSION), |here| {
                    if here == stage {
                        Err(io::Error::other("TEST_ONLY injected failure"))
                    } else {
                        Ok(())
                    }
                })
                .unwrap_err();
            assert_eq!(error.stage, stage);
            assert_ne!(error.commit_state, CommitState::NotReplaced);
            assert!(error
                .recovery_artifacts
                .iter()
                .any(|path| fs::read(path).is_ok_and(|bytes| bytes == old)));
            assert!(matches!(
                f.store().read(&terms(TEST_VERSION)).unwrap(),
                RecordStatus::Accepted(_)
            ));
        }
    }

    #[test]
    fn actual_replace_failure_preserves_readonly_old_record_and_synced_backup() {
        let f = Fixture::new();
        let old = fixture_record(TEST_VERSION - 1);
        f.with_record(&old);
        let path = f.store().record_path();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();
        let error = f
            .store()
            .save_after_explicit_acceptance(&terms(TEST_VERSION))
            .unwrap_err();
        assert_eq!(error.stage, SaveStage::Replace);
        assert_eq!(error.commit_state, CommitState::ReplacementAttempted);
        assert_eq!(fs::read(&path).unwrap(), old);
        assert!(error
            .recovery_artifacts
            .iter()
            .any(|path| fs::read(path).is_ok_and(|bytes| bytes == old)));
    }

    #[test]
    fn first_save_does_not_overwrite_a_destination_created_during_save() {
        let f = Fixture::new();
        let path = f.store().record_path();
        let sentinel = fixture_record(TEST_VERSION + 1);
        let error = f
            .store()
            .save_with(&terms(TEST_VERSION), |stage| {
                if stage == SaveStage::Replace {
                    fs::write(&path, &sentinel)?;
                }
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error.stage, SaveStage::Replace);
        assert_eq!(fs::read(path).unwrap(), sentinel);
    }

    #[test]
    fn corrupted_temp_and_final_readback_are_detected() {
        let f = Fixture::new();
        let error = f
            .store()
            .save_with(&terms(TEST_VERSION), |stage| {
                if stage == SaveStage::VerifyTemporary {
                    let temp = fs::read_dir(f.config())?
                        .map(|e| e.unwrap().path())
                        .find(|p| {
                            p.file_name()
                                .unwrap()
                                .to_string_lossy()
                                .starts_with(".consent-tmp-")
                        })
                        .unwrap();
                    fs::write(temp, b"TEST_ONLY corruption")?;
                }
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error.kind, StorageErrorKind::Verification);
        assert!(!f.store().record_path().exists());
        let f = Fixture::new();
        f.with_record(&fixture_record(TEST_VERSION - 1));
        let error = f
            .store()
            .save_with(&terms(TEST_VERSION), |stage| {
                if stage == SaveStage::VerifyDestination {
                    fs::write(f.store().record_path(), b"TEST_ONLY corruption")?;
                }
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error.kind, StorageErrorKind::Verification);
        assert_eq!(error.commit_state, CommitState::ReplacedUnverified);
    }

    #[test]
    fn record_changed_before_replace_is_not_overwritten() {
        let f = Fixture::new();
        let old = fixture_record(TEST_VERSION - 1);
        f.with_record(&old);
        let replacement = altered_record("schemaVersion", json!(2));
        let error = f
            .store()
            .save_with(&terms(TEST_VERSION), |stage| {
                if stage == SaveStage::Replace {
                    fs::write(f.store().record_path(), &replacement)?;
                }
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error.kind, StorageErrorKind::RecordChanged);
        assert_eq!(error.commit_state, CommitState::NotReplaced);
        assert_eq!(fs::read(f.store().record_path()).unwrap(), replacement);
        assert!(error
            .recovery_artifacts
            .iter()
            .any(|path| fs::read(path).is_ok_and(|bytes| bytes == old)));
    }

    #[test]
    fn failed_first_write_leaves_only_non_authoritative_artifacts() {
        let f = Fixture::new();
        let error = f
            .store()
            .save_with(&terms(TEST_VERSION), |stage| {
                if stage == SaveStage::TempHalfWritten {
                    Err(io::Error::other("TEST_ONLY partial write"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
        assert_eq!(error.commit_state, CommitState::NotReplaced);
        assert!(!error.recovery_artifacts.is_empty());
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap(),
            RecordStatus::Missing
        );
        assert!(!f.portable.join("data").exists());
    }

    #[test]
    fn leftover_artifacts_never_count_as_consent_or_busy_lock() {
        let f = Fixture::new();
        fs::create_dir(f.config()).unwrap();
        fs::write(
            f.config().join(".consent-tmp-TEST_ONLY"),
            fixture_record(TEST_VERSION),
        )
        .unwrap();
        fs::write(
            f.config().join(".consent-previous-TEST_ONLY"),
            fixture_record(TEST_VERSION),
        )
        .unwrap();
        fs::write(
            f.config().join("consent-startup.lock"),
            b"TEST_ONLY stale bytes",
        )
        .unwrap();
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap(),
            RecordStatus::Missing
        );
        drop(
            f.store()
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap(),
        );
        assert_eq!(
            fs::read(f.config().join("consent-startup.lock")).unwrap(),
            b"TEST_ONLY stale bytes"
        );
        assert!(f.config().join(".consent-previous-TEST_ONLY").exists());
    }

    #[test]
    fn saving_does_not_touch_synthetic_db_bootstrap_or_other_fixture() {
        let f = Fixture::new();
        fs::create_dir(f.config()).unwrap();
        fs::create_dir(f.portable.join("data")).unwrap();
        let mut protected = vec![
            f.config().join("data-root.json"),
            f.config().join("data-root.last-good.json"),
            f.portable.join("data/dol-progress.db"),
        ];
        let outside = Fixture::new();
        protected.push(outside.portable.join("TEST_ONLY sentinel"));
        for path in &protected {
            fs::write(path, b"TEST_ONLY preserved bytes").unwrap();
        }
        drop(
            f.store()
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap(),
        );
        for path in &protected {
            assert_eq!(fs::read(path).unwrap(), b"TEST_ONLY preserved bytes");
        }
        assert!(!outside.config().exists());
    }

    #[test]
    fn copied_record_retains_content_identity_without_claiming_new_person_consent() {
        let source = Fixture::new();
        drop(
            source
                .store()
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap(),
        );
        let copied = Fixture::new();
        copied.with_record(&fs::read(source.store().record_path()).unwrap());
        assert!(matches!(
            copied.store().read(&terms(TEST_VERSION)).unwrap(),
            RecordStatus::Accepted(_)
        ));
        let fresh_recipient = Fixture::new();
        assert_eq!(
            fresh_recipient.store().read(&terms(TEST_VERSION)).unwrap(),
            RecordStatus::Missing
        );
    }

    #[test]
    fn competing_writers_never_downgrade_highest_condition_version() {
        let f = Fixture::new();
        let barrier = Arc::new(Barrier::new(6));
        let workers: Vec<_> = (0..6)
            .map(|n| {
                let barrier = barrier.clone();
                let store = f.store();
                thread::spawn(move || {
                    barrier.wait();
                    let deadline = Instant::now() + Duration::from_secs(10);
                    loop {
                        match store.save_after_explicit_acceptance(&terms(TEST_VERSION + n)) {
                            Ok(lease) => {
                                drop(lease);
                                break;
                            }
                            Err(e)
                                if e.kind == StorageErrorKind::Busy
                                    && Instant::now() < deadline =>
                            {
                                thread::sleep(Duration::from_millis(2))
                            }
                            Err(e)
                                if matches!(
                                    e.kind,
                                    StorageErrorKind::BlockedRecord(
                                        RecordStatus::FutureTerms { .. }
                                    )
                                ) =>
                            {
                                break
                            }
                            Err(e) => panic!("競合同意保存の失敗: {e}"),
                        }
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert!(matches!(
            f.store().read(&terms(TEST_VERSION + 5)).unwrap(),
            RecordStatus::Accepted(_)
        ));
    }

    #[test]
    fn concurrent_readers_observe_complete_records_during_replacement() {
        let f = Fixture::new();
        drop(
            f.store()
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap(),
        );
        let reader_store = f.store();
        let barrier = Arc::new(Barrier::new(2));
        let reader_barrier = barrier.clone();
        let reader = thread::spawn(move || {
            reader_barrier.wait();
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut snapshots = 0;
            while snapshots < 100 {
                assert!(Instant::now() < deadline);
                match reader_store.read(&terms(TEST_VERSION + 10)) {
                    Ok(RecordStatus::Accepted(_) | RecordStatus::Outdated { .. }) => snapshots += 1,
                    Err(error) if error.kind == StorageErrorKind::Busy => {
                        thread::sleep(Duration::from_millis(2))
                    }
                    result => panic!("排他snapshotの不整合: {result:?}"),
                }
            }
        });
        barrier.wait();
        for n in 1..=10 {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                match f
                    .store()
                    .save_after_explicit_acceptance(&terms(TEST_VERSION + n))
                {
                    Ok(lease) => {
                        drop(lease);
                        break;
                    }
                    Err(error)
                        if error.kind == StorageErrorKind::Busy && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(2))
                    }
                    result => panic!("排他保存の不整合: {result:?}"),
                }
            }
        }
        reader.join().unwrap();
    }

    struct OwnedChild(Child);
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn child_holds_consent_lock() {
        let Some(root) = std::env::var_os("DOL_CONSENT_TEST_CHILD_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tmp/phase-local-5c-a/fixtures")
            .canonicalize()
            .unwrap();
        let root = root.canonicalize().unwrap();
        assert!(root.starts_with(&base) && root != base);
        assert_eq!(
            fs::read(root.join("TEST_ONLY.fixture")).unwrap(),
            b"TEST_ONLY"
        );
        let store = ConsentStore::for_portable_root(&root.join("portable")).unwrap();
        let lease = store.lock_verified_record(&terms(TEST_VERSION)).unwrap();
        fs::write(root.join("CHILD_READY"), b"TEST_ONLY").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !root.join("CHILD_RELEASE").exists() {
            assert!(Instant::now() < deadline, "child lock timeout");
            thread::sleep(Duration::from_millis(5));
        }
        drop(lease);
    }

    #[test]
    fn separate_process_lock_reports_busy_and_releases_without_deleting_lock_file() {
        let f = Fixture::new();
        drop(
            f.store()
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap(),
        );
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "consent::tests::filesystem::child_holds_consent_lock",
            ])
            .env("DOL_CONSENT_TEST_CHILD_ROOT", &f.root)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let mut child = OwnedChild(hidden(&mut command).spawn().unwrap());
        let deadline = Instant::now() + Duration::from_secs(10);
        while !f.root.join("CHILD_READY").exists() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            f.store()
                .save_after_explicit_acceptance(&terms(TEST_VERSION))
                .unwrap_err()
                .kind,
            StorageErrorKind::Busy
        );
        assert_eq!(
            f.store().read(&terms(TEST_VERSION)).unwrap_err().kind,
            StorageErrorKind::Busy
        );
        fs::write(f.root.join("CHILD_RELEASE"), b"TEST_ONLY").unwrap();
        assert!(child.0.wait().unwrap().success());
        drop(
            f.store()
                .lock_verified_record(&terms(TEST_VERSION))
                .unwrap(),
        );
        assert!(f.config().join("consent-startup.lock").exists());
    }
}
