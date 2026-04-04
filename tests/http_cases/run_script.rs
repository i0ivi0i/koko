use super::*;

#[test]
fn root_run_script_forwards_powershell_args_to_cargo_xtask_dev() {
    let (shim_dir, log_path, _cleanup) = temp_fake_xtask_cargo(0);
    let output = run_root_script_with_fake_cargo(
        &[
            "-DatabaseUrl",
            "postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat",
            "-AdminToken",
            "manual-admin-token",
            "-BindAddr",
            "127.0.0.1:8080",
            "-SkipBundle",
            "-DryRun",
            "-NoBrowser",
        ],
        &shim_dir,
    );

    assert!(
        output.status.success(),
        "run.ps1 should forward to cargo xtask dev\nstdout={}\nstderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let log = fs::read_to_string(&log_path).unwrap();
    assert!(log.contains("args|xtask dev"));
    assert!(log.contains("--database-url postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat"));
    assert!(log.contains("--admin-token manual-admin-token"));
    assert!(log.contains("--bind-addr 127.0.0.1:8080"));
    assert!(log.contains("--skip-bundle"));
    assert!(log.contains("--dry-run"));
    assert!(log.contains("--no-browser"));
    assert!(log.contains("env|KOKO_ADMIN_TOKEN="));
}

#[test]
fn root_run_script_passes_through_xtask_exit_code() {
    let (shim_dir, _log_path, _cleanup) = temp_fake_xtask_cargo(23);
    let output = run_root_script_with_fake_cargo(&["-DryRun"], &shim_dir);

    assert_eq!(output.status.code(), Some(23));
}

#[test]
fn root_run_script_rejects_legacy_test_seam_args() {
    let (shim_dir, log_path, _cleanup) = temp_fake_xtask_cargo(0);
    let output = run_root_script_with_fake_cargo(
        &["-TestChildScript", "tests/http_support/fixtures/powershell/fake-rust-startup.ps1"],
        &shim_dir,
    );

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("TestChildScript"));
    assert!(
        !log_path.exists() || fs::read_to_string(&log_path).unwrap_or_default().trim().is_empty(),
        "legacy seam args should fail before cargo xtask is invoked"
    );
}

