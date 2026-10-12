//! TEST ONLY。専用fixture以外を受け付けず、通常起動・DBへ接続しない。
#[cfg(windows)]
use dol_progress_manager_lib::consent::harness::driver;
use dol_progress_manager_lib::consent::harness::{Fixture, ManualFixture};
use dol_progress_manager_lib::consent::{
    gate::{self, GateOutcome, GateStop, PassBasis},
    native_ui::{show_consent, ConsentDecision, DeclineReason, NativeUiError},
    CanonicalTerms, ConsentStore, TermsVersion,
};
use std::{
    cell::Cell,
    fs,
    path::{Path, PathBuf},
};

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
    match parse_cli(&args)? {
        #[cfg(windows)]
        Cli::Automated => automation(),
        Cli::Manual { id, mode, root } => {
            let root = match root {
                Some(root) => root,
                None => ManualFixture::default_root()?,
            };
            let fixture = ManualFixture::open(&root, id.as_deref(), &mode)
                .map_err(|e| format!("{e}。安全で未使用の絶対pathを --fixture-root <directory> で指定してください。TEMP/APPDATAへの自動切替は行いません"))?;
            println!(
                "TEST ONLY / Mode: {mode} / Action: {} / Created mode: {}",
                if id.is_some() { "resume" } else { "new" },
                fixture.created_mode()
            );
            println!("fixture ID: {}", fixture.id());
            println!("Fixture Root: {}", fixture.base().display());
            println!("Fixture Dir: {}", fixture.root().display());
            println!(
                "Consent File (planned, not saved): {}",
                fixture.root().join("config").join("consent.json").display()
            );
            manual(fixture.root(), &mode)
        }
        #[cfg(not(windows))]
        Cli::Automated => Err("Windows専用です".into()),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Cli {
    Automated,
    Manual {
        id: Option<String>,
        mode: String,
        root: Option<PathBuf>,
    },
}
fn parse_cli(args: &[String]) -> Result<Cli, String> {
    let usage = "--new Normal|Recovery / --resume <fixture-ID> Normal|Recovery / --automated。手動のみ --fixture-root <絶対directory>（順序自由）";
    let mut root = None;
    let mut action = None;
    let mut positional = Vec::new();
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--fixture-root" => {
                index += 1;
                let value = args
                    .get(index)
                    .filter(|s| !s.is_empty() && !s.starts_with("--"))
                    .ok_or(usage)?;
                if root.replace(PathBuf::from(value)).is_some() {
                    return Err(usage.into());
                }
            }
            "--new" | "--resume" | "--automated" => {
                if action.replace(args[index].as_str()).is_some() {
                    return Err(usage.into());
                }
            }
            value if value.starts_with("--") => return Err(usage.into()),
            value => positional.push(value),
        }
        index += 1;
    }
    match (action, positional.as_slice()) {
        (Some("--automated"), []) if root.is_none() => Ok(Cli::Automated),
        (Some("--new"), [mode]) if matches!(*mode, "Normal" | "Recovery") => Ok(Cli::Manual {
            id: None,
            mode: (*mode).to_owned(),
            root,
        }),
        (Some("--resume"), [id, mode]) if matches!(*mode, "Normal" | "Recovery") => {
            Ok(Cli::Manual {
                id: Some((*id).to_owned()),
                mode: (*mode).to_owned(),
                root,
            })
        }
        _ => Err(usage.into()),
    }
}
fn manual(root: &Path, mode: &str) -> Result<(), String> {
    let (out, _, _) = invoke(root, mode, show_consent);
    match out {
        GateOutcome::Started { basis, result } => {
            println!(
                "Consent File (gate verified, {basis:?}): {}",
                root.join("config").join("consent.json").display()
            );
            result.map(|_| ())
        }
        GateOutcome::Stopped(GateStop::Declined(_)) => {
            println!("Consent File: this run did not save or verify a record");
            Ok(())
        }
        GateOutcome::Stopped(_) => {
            println!("Consent File: this run did not save or verify a record");
            Err("gateが異常終了しました".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(parts: &[&str]) -> Result<Cli, String> {
        parse_cli(&parts.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }
    #[test]
    fn cli_root_order_and_existing_commands() {
        for parts in [
            vec!["--fixture-root", "D:\\test root", "--new", "Normal"],
            vec!["--new", "--fixture-root", "D:\\test root", "Normal"],
            vec!["--new", "Normal", "--fixture-root", "D:\\test root"],
        ] {
            assert_eq!(
                parse(&parts).unwrap(),
                Cli::Manual {
                    id: None,
                    mode: "Normal".into(),
                    root: Some("D:\\test root".into())
                }
            );
        }
        assert_eq!(parse(&["--automated"]).unwrap(), Cli::Automated);
        assert!(parse(&["--resume", "1-2-3", "Recovery"]).is_ok());
    }
    #[test]
    fn cli_rejects_duplicates_unknown_incomplete_and_auto_override() {
        for parts in [
            vec![],
            vec!["--new"],
            vec!["--new", "Other"],
            vec!["--resume", "1-2-3"],
            vec!["--new", "Normal", "extra"],
            vec!["--new", "Normal", "--new"],
            vec!["--fixture-root"],
            vec!["--new", "Normal", "--unknown"],
            vec!["--automated", "--fixture-root", "D:\\test"],
            vec![
                "--new",
                "Normal",
                "--fixture-root",
                "D:\\a",
                "--fixture-root",
                "D:\\b",
            ],
        ] {
            assert!(parse(&parts).is_err(), "{parts:?}");
        }
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
