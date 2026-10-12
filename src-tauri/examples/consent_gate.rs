//! TEST ONLY。専用fixture以外を受け付けず、通常起動・DBへ接続しない。
#[cfg(windows)]
use dol_progress_manager_lib::consent::harness::driver;
use dol_progress_manager_lib::consent::harness::Fixture;
use dol_progress_manager_lib::consent::{
    gate::{self, GateOutcome, GateStop, PassBasis},
    native_ui::{show_consent, ConsentDecision, DeclineReason, NativeUiError},
    CanonicalTerms, ConsentStore, TermsVersion,
};
use std::{cell::Cell, fs, path::Path};

fn terms() -> CanonicalTerms {
    CanonicalTerms::from_body(TermsVersion::new(900003).unwrap(),
        "TEST ONLY — 隔離統合用の合成条件。正式な利用条件ではありません。\n明示同意した場合、専用fixtureにだけ同意記録を保存します。\n通常アプリ、実config、DB、WebView2は起動しません。\n".as_bytes()).unwrap()
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
            { let fixture = Fixture::new("gate")?; println!("fixture ID: {}", fixture.id()); manual(fixture.root(), mode) }
        }
        [flag, id, mode] if flag == "--resume" && (mode == "Normal" || mode == "Recovery") => {
            { let fixture = Fixture::resume("gate", id)?; manual(fixture.root(), mode) }
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
    let fixture = Fixture::new("gate")?;
    let root = fixture.root();
    println!("fixture ID: {}", fixture.id());
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
    let declined_fixture = Fixture::new("gate")?;
    let declined = declined_fixture.root();
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
