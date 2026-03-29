mod support;

fn main() {
    // Keep the shell thin so future CLI and service entrypoints can share the same core.
    let _ = support::app_name();
}
