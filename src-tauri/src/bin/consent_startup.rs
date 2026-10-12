// TEST ONLY。Tauriのbin manifestを使用し、marker付き一時rootだけへ接続する。
fn main() {
    #[cfg(windows)]
    if let Err(error) = dol_progress_manager_lib::startup_harness::run_cli() {
        eprintln!("TEST ONLY ERROR: {error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    panic!("Windows専用隔離startup harness");
}
