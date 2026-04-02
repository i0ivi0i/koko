#![cfg_attr(not(test), allow(dead_code))]

use std::{
    path::PathBuf,
    process::ExitCode,
};

use koko::support::{self, ResolvedAppConfig, StartupBanner};

fn help_text() -> &'static str {
    "xtask\n\nUsage: cargo xtask [--help]\n\nMinimal workspace task runner placeholder."
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExitStatus {
    Success,
    Failure,
}

impl ExitStatus {
    fn code(self) -> ExitCode {
        match self {
            Self::Success => ExitCode::SUCCESS,
            Self::Failure => ExitCode::FAILURE,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Response {
    stream: OutputStream,
    message: String,
    exit_status: ExitStatus,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct DevInputs {
    database_url: Option<String>,
    bind_addr: Option<String>,
    config_path: Option<PathBuf>,
    admin_cookie_secure: Option<bool>,
    dry_run: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DevStep {
    ResolveConfig,
    ResolveBanner,
    PrepareDatabase,
    LaunchChildProcess,
    OpenBrowser,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DevPreview {
    config: ResolvedAppConfig,
    service_banner: Option<StartupBanner>,
    planned_steps: Vec<DevStep>,
}

trait AppConfigSource {
    fn load(&self, inputs: &DevInputs) -> Result<ResolvedAppConfig, String>;
}

trait StartupBannerSource {
    fn build(&self, config: &ResolvedAppConfig) -> Result<Option<StartupBanner>, String>;
}

#[allow(dead_code)]
trait CommandRunner {
    fn run(&self, program: &str, args: &[String]) -> Result<(), String>;
}

#[allow(dead_code)]
trait ChildProcessLauncher {
    fn launch(&self, program: &str, args: &[String]) -> Result<(), String>;
}

#[allow(dead_code)]
trait BrowserOpener {
    fn open(&self, url: &str) -> Result<(), String>;
}

#[derive(Debug, Clone, Copy, Default)]
struct SupportConfigSource;

impl AppConfigSource for SupportConfigSource {
    fn load(&self, inputs: &DevInputs) -> Result<ResolvedAppConfig, String> {
        support::ResolvedAppConfig::load_for_xtask_preview(
            inputs.database_url.as_deref(),
            inputs.bind_addr.as_deref(),
            inputs.config_path.clone(),
            inputs.admin_cookie_secure,
        )
        .map_err(|error| error.to_string())
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct SupportStartupBannerSource;

impl StartupBannerSource for SupportStartupBannerSource {
    fn build(&self, _config: &ResolvedAppConfig) -> Result<Option<StartupBanner>, String> {
        // xtask 只保留后续从真实子进程输出中观察服务真相的注入口；
        // Task 2 这里不能基于配置自行推导首页地址、管理入口或启动横幅。
        Ok(None)
    }
}

struct DevCoordinator<C, B, R, L, O> {
    config_source: C,
    banner_source: B,
    _command_runner: R,
    _child_process_launcher: L,
    _browser_opener: O,
}

impl<C, B, R, L, O> DevCoordinator<C, B, R, L, O>
where
    C: AppConfigSource,
    B: StartupBannerSource,
    R: CommandRunner,
    L: ChildProcessLauncher,
    O: BrowserOpener,
{
    fn new(
        config_source: C,
        banner_source: B,
        command_runner: R,
        child_process_launcher: L,
        browser_opener: O,
    ) -> Self {
        Self {
            config_source,
            banner_source,
            _command_runner: command_runner,
            _child_process_launcher: child_process_launcher,
            _browser_opener: browser_opener,
        }
    }

    fn preview(&self, inputs: DevInputs) -> Result<DevPreview, String> {
        let config = self.config_source.load(&inputs)?;
        let service_banner = if inputs.dry_run {
            None
        } else {
            self.banner_source.build(&config)?
        };

        Ok(DevPreview {
            config,
            service_banner,
            planned_steps: vec![
                DevStep::ResolveConfig,
                DevStep::ResolveBanner,
                DevStep::PrepareDatabase,
                DevStep::LaunchChildProcess,
                DevStep::OpenBrowser,
            ],
        })
    }
}

fn dispatch(args: impl IntoIterator<Item = String>) -> Response {
    let args = args.into_iter().collect::<Vec<_>>();

    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Response {
            stream: OutputStream::Stdout,
            message: help_text().to_owned(),
            exit_status: ExitStatus::Success,
        };
    }

    match args.first() {
        Some(command) => Response {
            stream: OutputStream::Stderr,
            message: format!("xtask placeholder: unknown or unimplemented command `{command}`"),
            exit_status: ExitStatus::Failure,
        },
        None => Response {
            stream: OutputStream::Stderr,
            message: "xtask placeholder: no command provided; use --help".to_owned(),
            exit_status: ExitStatus::Failure,
        },
    }
}

fn main() -> ExitCode {
    let response = dispatch(std::env::args().skip(1));

    match response.stream {
        OutputStream::Stdout => println!("{}", response.message),
        OutputStream::Stderr => eprintln!("{}", response.message),
    }

    response.exit_status.code()
}

#[cfg(test)]
mod tests {
    use super::{
        AppConfigSource, BrowserOpener, ChildProcessLauncher, CommandRunner, DevCoordinator,
        DevInputs, ExitStatus, OutputStream, ResolvedAppConfig, StartupBanner,
        StartupBannerSource, SupportConfigSource, SupportStartupBannerSource, dispatch, help_text,
    };
    use koko::support::AppConfig;
    use std::{
        cell::Cell,
        env, fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn help_text_mentions_usage() {
        assert!(help_text().contains("Usage: cargo xtask"));
    }

    #[test]
    fn help_request_exits_successfully() {
        let response = dispatch(["--help".to_owned()]);
        assert_eq!(response.stream, OutputStream::Stdout);
        assert_eq!(response.exit_status, ExitStatus::Success);
    }

    #[test]
    fn missing_command_exits_with_failure() {
        let response = dispatch(Vec::<String>::new());
        assert_eq!(response.stream, OutputStream::Stderr);
        assert_eq!(response.exit_status, ExitStatus::Failure);
    }

    #[test]
    fn unknown_command_exits_with_failure() {
        let response = dispatch(["foo".to_owned()]);
        assert_eq!(response.stream, OutputStream::Stderr);
        assert_eq!(response.exit_status, ExitStatus::Failure);
    }

    #[test]
    fn dev_plan_reuses_shared_config_source_when_no_overrides_are_provided() {
        let _isolation = TestIsolationGuard::acquire();
        let temp_root = temp_workspace_root("shared-config");
        let _cwd_guard = CurrentDirGuard::switch_to(&temp_root);
        write_config_file(
            &temp_root.join("config").join("koko.toml"),
            "shared-admin-token",
        );
        let _env_guard = EnvGuard::set(&[
            ("KOKO_DATABASE_URL", Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test")),
            ("KOKO_BIND_ADDR", Some("127.0.0.1:8080")),
            ("KOKO_ADMIN_TOKEN", None),
            ("KOKO_ADMIN_COOKIE_SECURE", Some("false")),
        ]);

        let expected = ResolvedAppConfig::load().expect("shared config should load");
        let coordinator = DevCoordinator::new(
            SupportConfigSource,
            SupportStartupBannerSource,
            NoopCommandRunner::default(),
            NoopChildProcessLauncher::default(),
            NoopBrowserOpener::default(),
        );

        let report = coordinator
            .preview(DevInputs::default())
            .expect("preview should succeed");

        assert_eq!(report.config.database_url, expected.database_url);
        assert_eq!(report.config.bind_addr, expected.bind_addr);
        assert_eq!(report.config.config_path, expected.config_path);
        assert_eq!(report.config.admin_token_seed, expected.admin_token_seed);
        assert_eq!(report.config.admin_cookie_secure, expected.admin_cookie_secure);
        assert!(report.service_banner.is_none());
    }

    #[test]
    fn app_config_load_for_test_ignores_process_env_defaults() {
        let _isolation = TestIsolationGuard::acquire();
        let config_path = temp_config_path("load-for-test-env");
        let _env_guard = EnvGuard::set(&[
            ("KOKO_DATABASE_URL", Some("postgres://env-user:env-pass@127.0.0.1:5432/env_db")),
            ("KOKO_BIND_ADDR", Some("127.0.0.1:9090")),
            ("KOKO_ADMIN_TOKEN", Some("env-admin-token")),
            ("KOKO_ADMIN_COOKIE_SECURE", Some("true")),
        ]);

        let result = AppConfig::load_for_test(
            None,
            None,
            config_path.clone(),
            Some("explicit-admin-token"),
            None,
        );
        assert!(matches!(
            result,
            Err(koko::support::ConfigError::MissingEnv("KOKO_DATABASE_URL"))
        ));

        let config = AppConfig::load_for_test(
            Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
            None,
            config_path,
            Some("explicit-admin-token"),
            None,
        )
        .expect("load_for_test should stay explicit and deterministic");

        assert_eq!(config.bind_addr.to_string(), "0.0.0.0:8080");
        assert_eq!(config.admin_token, "explicit-admin-token");
        assert!(!config.admin_cookie_secure);
    }

    #[test]
    fn dev_preview_dry_run_does_not_fabricate_service_truth() {
        let config = ResolvedAppConfig::load_for_test(
            Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
            Some("127.0.0.1:8080"),
            temp_config_path("dry-run"),
            Some("shared-admin-token"),
            Some(false),
        )
        .expect("test config should load");

        let coordinator = DevCoordinator::new(
            FakeConfigSource::new(config),
            FakeStartupBannerSource::with_banner(StartupBanner {
                home_urls: vec!["http://sentinel-home/".to_string()],
                lan_urls: vec!["http://sentinel-lan/".to_string()],
                admin_url: "http://sentinel-home/admin".to_string(),
                admin_token: "shared-admin-token".to_string(),
                admin_token_notice: None,
            }),
            RecordingCommandRunner::default(),
            RecordingChildProcessLauncher::default(),
            RecordingBrowserOpener::default(),
        );

        let report = coordinator
            .preview(DevInputs {
                dry_run: true,
                ..DevInputs::default()
            })
            .expect("dry-run preview should succeed");

        assert!(report.service_banner.is_none());
        assert_eq!(report.planned_steps.len(), 5);
    }

    #[test]
    fn dev_preview_consumes_banner_source_without_reconstructing_urls() {
        let config = ResolvedAppConfig::load_for_test(
            Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
            Some("127.0.0.1:8080"),
            temp_config_path("banner-source"),
            Some("shared-admin-token"),
            Some(false),
        )
        .expect("test config should load");

        let coordinator = DevCoordinator::new(
            FakeConfigSource::new(config),
            FakeStartupBannerSource::with_banner(StartupBanner {
                home_urls: vec!["http://sentinel-home/".to_string()],
                lan_urls: vec!["http://sentinel-lan/".to_string()],
                admin_url: "http://sentinel-home/admin".to_string(),
                admin_token: "shared-admin-token".to_string(),
                admin_token_notice: Some("sentinel".to_string()),
            }),
            RecordingCommandRunner::default(),
            RecordingChildProcessLauncher::default(),
            RecordingBrowserOpener::default(),
        );

        let report = coordinator
            .preview(DevInputs::default())
            .expect("preview should succeed");

        assert_eq!(
            report.service_banner.as_ref().and_then(|banner| banner.home_urls.first()),
            Some(&"http://sentinel-home/".to_string())
        );
        assert_eq!(
            report
                .service_banner
                .as_ref()
                .map(|banner| banner.admin_url.as_str()),
            Some("http://sentinel-home/admin")
        );
    }

    #[test]
    fn dev_preview_does_not_bootstrap_config_file_when_missing() {
        let _isolation = TestIsolationGuard::acquire();
        let temp_root = temp_workspace_root("preview-no-bootstrap");
        let _cwd_guard = CurrentDirGuard::switch_to(&temp_root);
        let _env_guard = EnvGuard::set(&[
            ("KOKO_DATABASE_URL", Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test")),
            ("KOKO_BIND_ADDR", Some("127.0.0.1:8080")),
            ("KOKO_ADMIN_TOKEN", None),
            ("KOKO_ADMIN_COOKIE_SECURE", Some("false")),
        ]);
        let coordinator = DevCoordinator::new(
            SupportConfigSource,
            SupportStartupBannerSource,
            NoopCommandRunner::default(),
            NoopChildProcessLauncher::default(),
            NoopBrowserOpener::default(),
        );

        let report = coordinator
            .preview(DevInputs::default())
            .expect("preview should only resolve orchestration inputs");
        let config_path = temp_root.join(&report.config.config_path);

        assert!(report.service_banner.is_none());
        assert!(
            !config_path.exists(),
            "preview must not bootstrap config: {report:?}"
        );
    }

    #[derive(Debug, Clone)]
    struct FakeConfigSource {
        config: ResolvedAppConfig,
    }

    impl FakeConfigSource {
        fn new(config: ResolvedAppConfig) -> Self {
            Self { config }
        }
    }

    impl AppConfigSource for FakeConfigSource {
        fn load(&self, _inputs: &DevInputs) -> Result<ResolvedAppConfig, String> {
            Ok(self.config.clone())
        }
    }

    #[derive(Debug, Clone)]
    struct FakeStartupBannerSource {
        banner: Option<StartupBanner>,
    }

    impl FakeStartupBannerSource {
        fn with_banner(banner: StartupBanner) -> Self {
            Self {
                banner: Some(banner),
            }
        }
    }

    impl StartupBannerSource for FakeStartupBannerSource {
        fn build(&self, _config: &ResolvedAppConfig) -> Result<Option<StartupBanner>, String> {
            Ok(self.banner.clone())
        }
    }

    #[derive(Debug, Default)]
    struct RecordingCommandRunner {
        _calls: Cell<usize>,
    }

    impl CommandRunner for RecordingCommandRunner {
        fn run(&self, _program: &str, _args: &[String]) -> Result<(), String> {
            self._calls.set(self._calls.get() + 1);
            Ok(())
        }
    }

    #[derive(Debug, Default)]
    struct RecordingChildProcessLauncher {
        _calls: Cell<usize>,
    }

    impl ChildProcessLauncher for RecordingChildProcessLauncher {
        fn launch(&self, _program: &str, _args: &[String]) -> Result<(), String> {
            self._calls.set(self._calls.get() + 1);
            Ok(())
        }
    }

    #[derive(Debug, Default)]
    struct RecordingBrowserOpener {
        _calls: Cell<usize>,
    }

    impl BrowserOpener for RecordingBrowserOpener {
        fn open(&self, _url: &str) -> Result<(), String> {
            self._calls.set(self._calls.get() + 1);
            Ok(())
        }
    }

    #[derive(Debug, Default)]
    struct NoopCommandRunner;

    impl CommandRunner for NoopCommandRunner {
        fn run(&self, _program: &str, _args: &[String]) -> Result<(), String> {
            Ok(())
        }
    }

    #[derive(Debug, Default)]
    struct NoopChildProcessLauncher;

    impl ChildProcessLauncher for NoopChildProcessLauncher {
        fn launch(&self, _program: &str, _args: &[String]) -> Result<(), String> {
            Ok(())
        }
    }

    #[derive(Debug, Default)]
    struct NoopBrowserOpener;

    impl BrowserOpener for NoopBrowserOpener {
        fn open(&self, _url: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn temp_workspace_root(case_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();

        env::temp_dir()
            .join("koko-xtask-tests")
            .join(format!("{case_name}-{unique}"))
    }

    fn temp_config_path(case_name: &str) -> PathBuf {
        temp_workspace_root(case_name)
            .join("config")
            .join("koko.toml")
    }

    fn write_config_file(config_path: &Path, admin_token: &str) {
        fs::create_dir_all(config_path.parent().expect("config path should have a parent"))
            .expect("config dir should be creatable");
        fs::write(config_path, format!("admin_token = \"{admin_token}\"\n"))
            .expect("config file should be writable");
    }

    struct CurrentDirGuard {
        previous: PathBuf,
    }

    impl CurrentDirGuard {
        fn switch_to(next: &Path) -> Self {
            let previous = env::current_dir().expect("current dir should be available");
            fs::create_dir_all(next).expect("test workspace root should be creatable");
            env::set_current_dir(next).expect("test workspace root should be enterable");
            Self { previous }
        }
    }

    impl Drop for CurrentDirGuard {
        fn drop(&mut self) {
            let _ = env::set_current_dir(&self.previous);
        }
    }

    struct EnvGuard {
        previous: Vec<(&'static str, Option<String>)>,
    }

    impl EnvGuard {
        fn set(entries: &[(&'static str, Option<&'static str>)]) -> Self {
            let previous = entries
                .iter()
                .map(|(name, value)| {
                    let name = *name;
                    let previous = env::var(name).ok();
                    match value {
                        Some(value) => {
                            // Rust 2024 treats process env mutation as unsafe because it is global state.
                            unsafe { env::set_var(name, value) }
                        }
                        None => {
                            // 同上，只在测试里短暂改写，再由 guard 恢复。
                            unsafe { env::remove_var(name) }
                        }
                    }
                    (name, previous)
                })
                .collect();

            Self { previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (name, previous) in self.previous.drain(..) {
                match previous {
                    Some(value) => unsafe { env::set_var(name, value) },
                    None => unsafe { env::remove_var(name) },
                }
            }
        }
    }

    struct TestIsolationGuard {
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl TestIsolationGuard {
        fn acquire() -> Self {
            use std::sync::{Mutex, OnceLock};

            static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
            let lock = LOCK.get_or_init(|| Mutex::new(()));
            Self {
                _guard: lock.lock().expect("test isolation lock should be available"),
            }
        }
    }
}
