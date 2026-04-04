use super::*;

#[test]
fn root_run_script_invokes_cargo_run_koko_binary() {
    let (shim_dir, log_path, _cleanup) = temp_fake_cargo(0);
    let output = run_root_script_with_fake_cargo(
        &[
            "--database-url",
            "postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat",
            "--admin-token",
            "manual-admin-token",
            "--bind-addr",
            "127.0.0.1:8080",
            "--skip-bundle",
            "--dry-run",
            "--no-browser",
        ],
        &shim_dir,
    );

    assert!(
        output.status.success(),
        "run.ps1 should invoke cargo run --bin koko\nstdout={}\nstderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let log = fs::read_to_string(&log_path).unwrap();
    assert!(log.contains("args|run --bin koko"));
    assert!(!log.contains("--database-url"));
    assert!(!log.contains("--admin-token"));
    assert!(!log.contains("--bind-addr"));
    assert!(!log.contains("--skip-bundle"));
    assert!(!log.contains("--dry-run"));
    assert!(!log.contains("--no-browser"));
}

#[test]
fn root_run_script_passes_through_cargo_exit_code() {
    let (shim_dir, _log_path, _cleanup) = temp_fake_cargo(23);
    let output = run_root_script_with_fake_cargo(&["--dry-run"], &shim_dir);

    assert_eq!(output.status.code(), Some(23));
}

#[test]
fn root_run_script_ignores_unknown_script_args() {
    let (shim_dir, log_path, _cleanup) = temp_fake_cargo(0);
    let output = run_root_script_with_fake_cargo(
        &["-TestChildScript", "tests/http_support/fixtures/powershell/fake-rust-startup.ps1"],
        &shim_dir,
    );

    assert!(output.status.success());
    let log = fs::read_to_string(&log_path).unwrap();
    assert!(log.contains("args|run --bin koko"));
    assert!(!log.contains("fake-rust-startup.ps1"));
}

