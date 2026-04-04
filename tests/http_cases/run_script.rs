use super::*;

#[test]
fn root_run_script_invokes_cargo_run_koko_binary() {
    let (shim_dir, log_path, _cleanup) = temp_fake_cargo(0);
    let output = run_root_script_with_fake_cargo(
        &[
            "--demo-arg",
            "demo-value",
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
    assert!(!log.contains("--demo-arg"));
    assert!(!log.contains("demo-value"));
}

#[test]
fn root_run_script_passes_through_cargo_exit_code() {
    let (shim_dir, _log_path, _cleanup) = temp_fake_cargo(23);
    let output = run_root_script_with_fake_cargo(&["--ignored"], &shim_dir);

    assert_eq!(output.status.code(), Some(23));
}

#[test]
fn root_run_script_ignores_unknown_script_args() {
    let (shim_dir, log_path, _cleanup) = temp_fake_cargo(0);
    let output = run_root_script_with_fake_cargo(&["--placeholder", "fixture-path"], &shim_dir);

    assert!(output.status.success());
    let log = fs::read_to_string(&log_path).unwrap();
    assert!(log.contains("args|run --bin koko"));
    assert!(!log.contains("fixture-path"));
}

