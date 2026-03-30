fn main() {
    // Keep the shell thin so future CLI and service entrypoints can share the same core.
    let _ = koko::http::app_router;
    let _ = koko::support::app_name();
}
