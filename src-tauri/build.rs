fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // The locked Tauri CLI defaults to static CRT; keep native dependencies on /MD.
        std::env::set_var("STATIC_VCRUNTIME", "false");
    }
    tauri_build::build()
}
