#![cfg_attr(not(test), allow(dead_code))]

use std::{
    io::{BufRead, BufReader},
    path::Path,
    path::PathBuf,
    process::{Child, Command, ExitStatus as ProcessExitStatus, Stdio},
    process::ExitCode,
    sync::{Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use koko::support::{self, ResolvedAppConfig, StartupBanner};
use sqlx::{
    Postgres,
    migrate::{MigrateDatabase, Migrator},
    postgres::PgPoolOptions,
};
use url::Url;

fn help_text() -> &'static str {
    "xtask\n\nUsage: cargo xtask [--help]\n       cargo xtask dev [--dry-run] [--skip-bundle] [--no-browser] [--database-url <url>] [--bind-addr <addr>] [--config-path <path>]\n\nWorkspace task runner."
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
    skip_bundle: bool,
    no_browser: bool,
    dry_run: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DevStep {
    ResolveConfig,
    ResolveBanner,
    BundleWeb,
    PrepareDatabase,
    BuildServer,
    LaunchChildProcess,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DevPreview {
    config: ResolvedAppConfig,
    service_banner: Option<StartupBanner>,
    planned_steps: Vec<DevStep>,
    dry_run_lines: Vec<String>,
}

impl DevPreview {
    fn dry_run_lines(&self) -> Vec<String> {
        self.dry_run_lines.clone()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct CommandOutput {
    stdout: String,
}

impl CommandOutput {
    fn stdout(stdout: impl Into<String>) -> Self {
        Self {
            stdout: stdout.into(),
        }
    }
}

trait AppConfigSource {
    fn load(&self, inputs: &DevInputs) -> Result<ResolvedAppConfig, String>;
}

trait StartupBannerSource {
    fn build(&self, config: &ResolvedAppConfig) -> Result<Option<StartupBanner>, String>;
}

#[allow(dead_code)]
trait CommandRunner {
    fn run(&self, program: &str, args: &[String]) -> Result<CommandOutput, String>;
}

#[allow(dead_code)]
trait DatabaseProvisioner {
    fn prepare(&self, database_url: &str, migrations_dir: &Path) -> Result<(), String>;
}

#[allow(dead_code)]
trait ChildProcess {
    fn wait_for_homepage_url(&mut self, timeout: Duration) -> Result<Option<String>, String>;
    fn wait(&mut self) -> Result<(), String>;
}

#[allow(dead_code)]
trait ChildProcessLauncher {
    fn launch(
        &self,
        program: &str,
        args: &[String],
        envs: &[(String, Option<String>)],
    ) -> Result<Box<dyn ChildProcess>, String>;
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

struct DevCoordinator<C, B, D, R, L, O> {
    workspace_root: PathBuf,
    config_source: C,
    banner_source: B,
    database_provisioner: D,
    command_runner: R,
    child_process_launcher: L,
    browser_opener: O,
}

impl<C, B, D, R, L, O> DevCoordinator<C, B, D, R, L, O>
where
    C: AppConfigSource,
    B: StartupBannerSource,
    D: DatabaseProvisioner,
    R: CommandRunner,
    L: ChildProcessLauncher,
    O: BrowserOpener,
{
    fn new(
        config_source: C,
        banner_source: B,
        database_provisioner: D,
        command_runner: R,
        child_process_launcher: L,
        browser_opener: O,
    ) -> Self {
        Self::with_workspace_root(
            default_workspace_root(),
            config_source,
            banner_source,
            database_provisioner,
            command_runner,
            child_process_launcher,
            browser_opener,
        )
    }

    fn with_workspace_root(
        workspace_root: PathBuf,
        config_source: C,
        banner_source: B,
        database_provisioner: D,
        command_runner: R,
        child_process_launcher: L,
        browser_opener: O,
    ) -> Self {
        Self {
            workspace_root,
            config_source,
            banner_source,
            database_provisioner,
            command_runner,
            child_process_launcher,
            browser_opener,
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
                DevStep::BundleWeb,
                DevStep::PrepareDatabase,
                DevStep::BuildServer,
                DevStep::LaunchChildProcess,
            ],
            dry_run_lines: Vec::new(),
        })
    }

    fn run(&self, inputs: DevInputs) -> Result<DevPreview, String> {
        let mut report = self.preview(inputs.clone())?;
        if inputs.dry_run {
            report.dry_run_lines = self.build_dry_run_lines(&report.config, inputs.skip_bundle);
            return Ok(report);
        }

        self.ensure_command("cargo")?;
        if !inputs.skip_bundle {
            self.ensure_command("powershell")?;
            self.run_bundle()?;
        }
        self.prepare_database(&report.config)?;
        self.build_server()?;

        let server_binary_path = self.server_binary_path();
        if !server_binary_path.exists() {
            return Err(format!(
                "Koko 构建已完成，但找不到可执行文件：{}",
                server_binary_path.display()
            ));
        }

        let mut child = self.child_process_launcher.launch(
            server_binary_path.to_string_lossy().as_ref(),
            &Vec::new(),
            &[
                (
                    "KOKO_DATABASE_URL".to_string(),
                    Some(report.config.database_url.clone()),
                ),
                (
                    "KOKO_BIND_ADDR".to_string(),
                    Some(report.config.bind_addr.to_string()),
                ),
                ("KOKO_ADMIN_TOKEN".to_string(), None),
            ],
        )?;
        if !inputs.no_browser {
            if let Some(homepage_url) = child.wait_for_homepage_url(AUTO_OPEN_TIMEOUT)? {
                self.browser_opener.open(&homepage_url)?;
            }
        }
        child.wait()?;

        Ok(report)
    }

    fn ensure_command(&self, name: &str) -> Result<(), String> {
        self.command_runner
            .run(name, &[String::from("--version")])
            .map(|_| ())
            .map_err(|error| format!("Missing required command: {name}. {error}"))
    }

    fn run_bundle(&self) -> Result<(), String> {
        self.command_runner
            .run(
                "powershell",
                &[
                    "-ExecutionPolicy".to_string(),
                    "Bypass".to_string(),
                    "-File".to_string(),
                    self.bundle_script_path().display().to_string(),
                ],
            )
            .map(|_| ())
    }

    fn prepare_database(&self, config: &ResolvedAppConfig) -> Result<(), String> {
        self.database_provisioner
            .prepare(&config.database_url, &self.migrations_dir())
    }

    fn build_server(&self) -> Result<(), String> {
        self.command_runner
            .run(
                "cargo",
                &[
                    "build".to_string(),
                    "--target-dir".to_string(),
                    RUN_TARGET_DIR.to_string(),
                ],
            )
            .map(|_| ())
    }

    fn build_dry_run_lines(
        &self,
        config: &ResolvedAppConfig,
        skip_bundle: bool,
    ) -> Vec<String> {
        let mut lines = Vec::new();
        if skip_bundle {
            lines.push("==> Skip web bundle".to_string());
        } else {
            lines.push(format!(
                "==> powershell -ExecutionPolicy Bypass -File {}",
                self.bundle_script_path().display()
            ));
        }
        let database = database_config(&config.database_url)
            .map(|value| value.database_name)
            .unwrap_or_else(|_| "<invalid-database-url>".to_string());
        lines.push(format!("==> Ensure database {database}"));
        lines.push(format!(
            "==> 准备数据库结构: {}",
            self.migrations_dir().display()
        ));
        lines.push("==> Set KOKO_DATABASE_URL".to_string());
        lines.push("==> Set KOKO_BIND_ADDR".to_string());
        lines.push(format!("==> cargo build --target-dir {RUN_TARGET_DIR}"));
        lines.push(format!("==> launch {}", self.server_binary_path().display()));
        lines
    }

    fn bundle_script_path(&self) -> PathBuf {
        self.workspace_root.join("scripts").join("dx-bundle-web.ps1")
    }

    fn migrations_dir(&self) -> PathBuf {
        self.workspace_root.join("migrations")
    }

    fn server_binary_path(&self) -> PathBuf {
        self.workspace_root
            .join("target")
            .join("run")
            .join("debug")
            .join(format!("{}{}", support::app_name(), std::env::consts::EXE_SUFFIX))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DatabaseConfig {
    database_name: String,
    admin_url: String,
}

fn database_config(database_url: &str) -> Result<DatabaseConfig, String> {
    let mut url = Url::parse(database_url).map_err(|error| error.to_string())?;
    let database_name = url.path().trim_start_matches('/').to_string();
    if database_name.trim().is_empty() {
        return Err(format!(
            "DatabaseUrl must include a database name. Got: {database_url}"
        ));
    }
    url.set_path("/postgres");
    Ok(DatabaseConfig {
        database_name,
        admin_url: url.to_string(),
    })
}

#[derive(Debug, Clone, Copy, Default)]
struct RealCommandRunner;

impl CommandRunner for RealCommandRunner {
    fn run(&self, program: &str, args: &[String]) -> Result<CommandOutput, String> {
        let output = Command::new(program)
            .args(args)
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(CommandOutput::stdout(
            String::from_utf8_lossy(&output.stdout).to_string(),
        ))
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct SqlxDatabaseProvisioner;

impl DatabaseProvisioner for SqlxDatabaseProvisioner {
    fn prepare(&self, database_url: &str, migrations_dir: &Path) -> Result<(), String> {
        // 这里直接复用 SQLx 官方数据库存在性与迁移能力，避免再复制一套 psql 编排语义。
        let runtime = tokio::runtime::Runtime::new().map_err(|error| error.to_string())?;
        runtime.block_on(async {
            if !Postgres::database_exists(database_url)
                .await
                .map_err(|error| error.to_string())?
            {
                Postgres::create_database(database_url)
                    .await
                    .map_err(|error| error.to_string())?;
            }

            let migrator = Migrator::new(migrations_dir)
                .await
                .map_err(|error| error.to_string())?;
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(database_url)
                .await
                .map_err(|error| error.to_string())?;

            let result = migrator.run(&pool).await.map_err(|error| error.to_string());
            pool.close().await;
            result
        })
    }
}

#[derive(Debug)]
struct RealChildProcess {
    child: Child,
    homepage_url: Arc<Mutex<Option<String>>>,
    observation_error: Arc<Mutex<Option<String>>>,
    exit_status: Option<ProcessExitStatus>,
    output_threads: Vec<JoinHandle<()>>,
}

impl ChildProcess for RealChildProcess {
    fn wait_for_homepage_url(&mut self, timeout: Duration) -> Result<Option<String>, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(error) = self.take_observation_error() {
                return Err(error);
            }

            if let Some(homepage_url) = self.homepage_url.lock().unwrap().clone() {
                return Ok(Some(homepage_url));
            }

            if Instant::now() >= deadline {
                return Ok(None);
            }

            if let Some(status) = self.child.try_wait().map_err(|error| error.to_string())? {
                self.exit_status = Some(status);
                self.join_output_threads();
                if let Some(error) = self.take_observation_error() {
                    return Err(error);
                }
                return Ok(self.homepage_url.lock().unwrap().clone());
            }

            thread::sleep(Duration::from_millis(200));
        }
    }

    fn wait(&mut self) -> Result<(), String> {
        let status = match self.exit_status.take() {
            Some(status) => status,
            None => self.child.wait().map_err(|error| error.to_string())?,
        };
        self.join_output_threads();
        if let Some(error) = self.take_observation_error() {
            return Err(error);
        }
        if !status.success() {
            return Err(format!(
                "Child process exited with code {}",
                status.code().unwrap_or(1)
            ));
        }
        Ok(())
    }
}

impl RealChildProcess {
    fn join_output_threads(&mut self) {
        for handle in self.output_threads.drain(..) {
            let _ = handle.join();
        }
    }

    fn take_observation_error(&self) -> Option<String> {
        self.observation_error.lock().unwrap().clone()
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct RealChildProcessLauncher;

impl ChildProcessLauncher for RealChildProcessLauncher {
    fn launch(
        &self,
        program: &str,
        args: &[String],
        envs: &[(String, Option<String>)],
    ) -> Result<Box<dyn ChildProcess>, String> {
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(default_workspace_root())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (name, value) in envs {
            match value {
                Some(value) => {
                    command.env(name, value);
                }
                None => {
                    command.env_remove(name);
                }
            }
        }
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let homepage_url = Arc::new(Mutex::new(None));
        let observation_error = Arc::new(Mutex::new(None));
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "xtask failed to capture child stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "xtask failed to capture child stderr".to_string())?;

        let stdout_homepage_url = homepage_url.clone();
        let stdout_observation_error = observation_error.clone();
        let stdout_thread = thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => {
                        if let Some(homepage_url) = parse_homepage_url_line(&line) {
                            let mut slot = stdout_homepage_url.lock().unwrap();
                            if slot.is_none() {
                                *slot = Some(homepage_url);
                            }
                        }
                        println!("{line}");
                    }
                    Err(error) => {
                        let mut slot = stdout_observation_error.lock().unwrap();
                        if slot.is_none() {
                            *slot = Some(format!("xtask failed to read child stdout: {error}"));
                        }
                        break;
                    }
                }
            }
        });
        let stderr_observation_error = observation_error.clone();
        let stderr_thread = thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                match line {
                    Ok(line) => eprintln!("{line}"),
                    Err(error) => {
                        let mut slot = stderr_observation_error.lock().unwrap();
                        if slot.is_none() {
                            *slot = Some(format!("xtask failed to read child stderr: {error}"));
                        }
                        break;
                    }
                }
            }
        });

        Ok(Box::new(RealChildProcess {
            child,
            homepage_url,
            observation_error,
            exit_status: None,
            output_threads: vec![stdout_thread, stderr_thread],
        }))
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct RealBrowserOpener;

impl BrowserOpener for RealBrowserOpener {
    fn open(&self, url: &str) -> Result<(), String> {
        webbrowser::open(url)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

const RUN_TARGET_DIR: &str = "target/run";
const AUTO_OPEN_TIMEOUT: Duration = Duration::from_secs(5);
const HOMEPAGE_PREFIX: &str = "==> 首页地址: ";

fn default_workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask should live under the workspace root")
        .to_path_buf()
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
        Some(command) if command == "dev" => dispatch_dev(&args[1..]),
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

fn dispatch_dev(args: &[String]) -> Response {
    match parse_dev_inputs(args) {
        Ok(inputs) => {
            let dry_run = inputs.dry_run;
            let coordinator = DevCoordinator::new(
                SupportConfigSource,
                SupportStartupBannerSource,
                SqlxDatabaseProvisioner,
                RealCommandRunner,
                RealChildProcessLauncher,
                RealBrowserOpener,
            );
            match coordinator.run(inputs) {
                Ok(report) if !dry_run || report.dry_run_lines.is_empty() => Response {
                    stream: OutputStream::Stdout,
                    message: String::new(),
                    exit_status: ExitStatus::Success,
                },
                Ok(report) => Response {
                    stream: OutputStream::Stdout,
                    message: report.dry_run_lines.join("\n"),
                    exit_status: ExitStatus::Success,
                },
                Err(error) => Response {
                    stream: OutputStream::Stderr,
                    message: error,
                    exit_status: ExitStatus::Failure,
                },
            }
        }
        Err(error) => Response {
            stream: OutputStream::Stderr,
            message: error,
            exit_status: ExitStatus::Failure,
        },
    }
}

fn parse_dev_inputs(args: &[String]) -> Result<DevInputs, String> {
    let mut inputs = DevInputs::default();
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--dry-run" => inputs.dry_run = true,
            "--skip-bundle" => inputs.skip_bundle = true,
            "--no-browser" => inputs.no_browser = true,
            "--database-url" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--database-url requires a value".to_string())?;
                inputs.database_url = Some(value.clone());
            }
            "--bind-addr" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--bind-addr requires a value".to_string())?;
                inputs.bind_addr = Some(value.clone());
            }
            "--config-path" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--config-path requires a value".to_string())?;
                inputs.config_path = Some(PathBuf::from(value));
            }
            unknown => {
                return Err(format!("unknown xtask dev argument `{unknown}`"));
            }
        }
        index += 1;
    }

    Ok(inputs)
}

fn parse_homepage_url_line(line: &str) -> Option<String> {
    line.strip_prefix(HOMEPAGE_PREFIX)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn main() -> ExitCode {
    let response = dispatch(std::env::args().skip(1));

    if !response.message.is_empty() {
        match response.stream {
            OutputStream::Stdout => println!("{}", response.message),
            OutputStream::Stderr => eprintln!("{}", response.message),
        }
    }

    response.exit_status.code()
}

#[cfg(test)]
mod tests {
    use super::{
        AppConfigSource, BrowserOpener, ChildProcess, ChildProcessLauncher, CommandOutput,
        CommandRunner, DatabaseProvisioner, DevCoordinator, DevInputs, ExitStatus, OutputStream,
        ResolvedAppConfig, StartupBanner, StartupBannerSource, SupportConfigSource,
        SupportStartupBannerSource, dispatch, help_text,
        parse_homepage_url_line,
    };
    use koko::support::AppConfig;
    use std::{
        cell::{Cell, RefCell},
        env, fs,
        path::{Path, PathBuf},
        rc::Rc,
        time::{Duration, SystemTime, UNIX_EPOCH},
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
            NoopDatabaseProvisioner,
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
            NoopDatabaseProvisioner,
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
        assert_eq!(report.planned_steps.len(), 6);
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
            NoopDatabaseProvisioner,
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
            NoopDatabaseProvisioner,
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

    #[test]
    fn dev_flow_executes_bundle_database_build_and_spawn_in_order() {
        let temp_root = temp_workspace_root("dev-run-order");
        write_fake_binary(&temp_root);
        let actions = SharedActionLog::default();
        let runner = RecordingCommandRunner::with_action_log(actions.clone());
        let launcher = RecordingChildProcessLauncher::with_action_log(actions.clone());
        let database = RecordingDatabaseProvisioner::with_action_log(actions.clone());
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            database,
            runner.clone(),
            launcher.clone(),
            RecordingBrowserOpener::default(),
        );

        let report = coordinator
            .run(DevInputs::default())
            .expect("dev run should succeed");
        let launch = launcher.launch_calls();

        assert_eq!(
            actions.actions(),
            vec![
                RecordedAction::CheckCommand("cargo".to_string()),
                RecordedAction::CheckCommand("powershell".to_string()),
                RecordedAction::BundleWeb,
                RecordedAction::PrepareDatabase("postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat".to_string()),
                RecordedAction::BuildServer,
                RecordedAction::LaunchChild,
                RecordedAction::WaitChild,
            ]
        );
        assert!(report.dry_run_lines().is_empty());
        assert_eq!(launch.len(), 1);
        assert_eq!(
            launch[0].envs,
            vec![
                (
                    "KOKO_DATABASE_URL".to_string(),
                    Some("postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat".to_string())
                ),
                (
                    "KOKO_BIND_ADDR".to_string(),
                    Some("127.0.0.1:8080".to_string())
                ),
                ("KOKO_ADMIN_TOKEN".to_string(), None),
            ]
        );
    }

    #[test]
    fn dev_flow_skip_bundle_omits_bundle_step() {
        let temp_root = temp_workspace_root("dev-run-skip-bundle");
        write_fake_binary(&temp_root);
        let actions = SharedActionLog::default();
        let runner = RecordingCommandRunner::with_action_log(actions.clone());
        let launcher = RecordingChildProcessLauncher::with_action_log(actions.clone());
        let database = RecordingDatabaseProvisioner::with_action_log(actions.clone());
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            database,
            runner.clone(),
            launcher,
            RecordingBrowserOpener::default(),
        );

        coordinator
            .run(DevInputs {
                skip_bundle: true,
                ..DevInputs::default()
            })
            .expect("dev run should succeed without bundle");

        assert_eq!(
            actions.actions(),
            vec![
                RecordedAction::CheckCommand("cargo".to_string()),
                RecordedAction::PrepareDatabase("postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat".to_string()),
                RecordedAction::BuildServer,
                RecordedAction::LaunchChild,
                RecordedAction::WaitChild,
            ]
        );
    }

    #[test]
    fn dev_flow_stops_before_spawn_when_migration_fails() {
        let temp_root = temp_workspace_root("dev-run-migration-fail");
        write_fake_binary(&temp_root);
        let actions = SharedActionLog::default();
        let runner = RecordingCommandRunner::with_action_log(actions.clone());
        let launcher = RecordingChildProcessLauncher::with_action_log(actions.clone());
        let database = RecordingDatabaseProvisioner::failing(
            actions.clone(),
            "Migration failed".to_string(),
        );
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            database,
            runner.clone(),
            launcher.clone(),
            RecordingBrowserOpener::default(),
        );

        let error = coordinator
            .run(DevInputs::default())
            .expect_err("migration failure should stop dev run");

        assert!(error.contains("Migration failed"));
        assert_eq!(launcher.launch_calls().len(), 0);
        assert_eq!(
            actions.actions(),
            vec![
                RecordedAction::CheckCommand("cargo".to_string()),
                RecordedAction::CheckCommand("powershell".to_string()),
                RecordedAction::BundleWeb,
                RecordedAction::PrepareDatabase("postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat".to_string()),
            ]
        );
    }

    #[test]
    fn dev_flow_stops_before_spawn_when_build_fails() {
        let temp_root = temp_workspace_root("dev-run-build-fail");
        write_fake_binary(&temp_root);
        let actions = SharedActionLog::default();
        let runner = RecordingCommandRunner::failing_build(actions.clone());
        let launcher = RecordingChildProcessLauncher::with_action_log(actions.clone());
        let database = RecordingDatabaseProvisioner::with_action_log(actions.clone());
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            database,
            runner,
            launcher.clone(),
            RecordingBrowserOpener::default(),
        );

        let error = coordinator
            .run(DevInputs::default())
            .expect_err("build failure should stop dev run");

        assert!(error.contains("cargo build failed"));
        assert_eq!(launcher.launch_calls().len(), 0);
        assert_eq!(
            actions.actions(),
            vec![
                RecordedAction::CheckCommand("cargo".to_string()),
                RecordedAction::CheckCommand("powershell".to_string()),
                RecordedAction::BundleWeb,
                RecordedAction::PrepareDatabase("postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat".to_string()),
                RecordedAction::BuildServer,
            ]
        );
    }

    #[test]
    fn dev_flow_dry_run_lists_steps_without_running_commands() {
        let temp_root = temp_workspace_root("dev-run-dry-run");
        fs::create_dir_all(temp_root.join("migrations")).expect("migrations dir should exist");
        let runner = RecordingCommandRunner::default();
        let launcher = RecordingChildProcessLauncher::default();
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            NoopDatabaseProvisioner,
            runner.clone(),
            launcher.clone(),
            RecordingBrowserOpener::default(),
        );

        let report = coordinator
            .run(DevInputs {
                dry_run: true,
                ..DevInputs::default()
            })
            .expect("dry-run should succeed");

        assert_eq!(runner.command_programs_and_args(), Vec::<String>::new());
        assert_eq!(launcher.launch_calls().len(), 0);
        let lines = report.dry_run_lines();
        assert!(lines.iter().any(|line| line.contains("dx-bundle-web.ps1")));
        assert!(lines.iter().any(|line| line.contains("Ensure database koko_dev_chat")));
        assert!(lines.iter().any(|line| line.contains("准备数据库结构")));
        assert!(lines.iter().any(|line| line.contains("cargo build --target-dir target/run")));
        assert!(lines.iter().any(|line| line.contains("==> launch ")));
    }

    #[test]
    fn auto_open_uses_exact_homepage_url_from_child_stdout() {
        let temp_root = temp_workspace_root("auto-open-exact-homepage");
        write_fake_binary(&temp_root);
        let actions = SharedActionLog::default();
        let runner = RecordingCommandRunner::with_action_log(actions.clone());
        let launcher = RecordingChildProcessLauncher::with_transcript(
            actions.clone(),
            vec![
                "child warming up".to_string(),
                "==> 首页地址: http://127.0.0.1:8899/ ".to_string(),
            ],
            vec!["child stderr noise".to_string()],
        );
        let database = RecordingDatabaseProvisioner::with_action_log(actions.clone());
        let browser = RecordingBrowserOpener::default();
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            database,
            runner,
            launcher,
            browser.clone(),
        );

        coordinator
            .run(DevInputs {
                skip_bundle: true,
                ..DevInputs::default()
            })
            .expect("homepage printed by Rust should trigger auto-open");

        assert_eq!(
            browser.opened_urls(),
            vec!["http://127.0.0.1:8899/".to_string()]
        );
    }

    #[test]
    fn auto_open_missing_homepage_only_disables_browser_open() {
        let temp_root = temp_workspace_root("auto-open-missing-homepage");
        write_fake_binary(&temp_root);
        let actions = SharedActionLog::default();
        let runner = RecordingCommandRunner::with_action_log(actions.clone());
        let launcher = RecordingChildProcessLauncher::with_transcript(
            actions,
            vec!["child ready without homepage".to_string()],
            vec!["==> 首页地址: http://127.0.0.1:9999/".to_string()],
        );
        let database = RecordingDatabaseProvisioner::with_action_log(SharedActionLog::default());
        let browser = RecordingBrowserOpener::default();
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            database,
            runner,
            launcher,
            browser.clone(),
        );

        coordinator
            .run(DevInputs {
                skip_bundle: true,
                ..DevInputs::default()
            })
            .expect("missing homepage should not fail startup");

        assert!(browser.opened_urls().is_empty());
    }

    #[test]
    fn auto_open_respects_no_browser_flag() {
        let temp_root = temp_workspace_root("auto-open-disabled");
        write_fake_binary(&temp_root);
        let actions = SharedActionLog::default();
        let runner = RecordingCommandRunner::with_action_log(actions.clone());
        let launcher = RecordingChildProcessLauncher::with_transcript(
            actions,
            vec!["==> 首页地址: http://127.0.0.1:8899/".to_string()],
            Vec::new(),
        );
        let database = RecordingDatabaseProvisioner::with_action_log(SharedActionLog::default());
        let browser = RecordingBrowserOpener::default();
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            database,
            runner,
            launcher,
            browser.clone(),
        );

        coordinator
            .run(DevInputs {
                skip_bundle: true,
                no_browser: true,
                ..DevInputs::default()
            })
            .expect("no-browser should skip auto-open");

        assert!(browser.opened_urls().is_empty());
    }

    #[test]
    fn auto_open_observation_failure_stops_dev_run() {
        let temp_root = temp_workspace_root("auto-open-observation-error");
        write_fake_binary(&temp_root);
        let actions = SharedActionLog::default();
        let runner = RecordingCommandRunner::with_action_log(actions.clone());
        let launcher = RecordingChildProcessLauncher::with_observation_error(
            actions,
            "xtask failed to read child stdout: broken pipe".to_string(),
        );
        let database = RecordingDatabaseProvisioner::with_action_log(SharedActionLog::default());
        let browser = RecordingBrowserOpener::default();
        let coordinator = DevCoordinator::with_workspace_root(
            temp_root.clone(),
            FakeConfigSource::new(test_dev_config(&temp_root)),
            FakeStartupBannerSource::without_banner(),
            database,
            runner,
            launcher,
            browser,
        );

        let error = coordinator
            .run(DevInputs {
                skip_bundle: true,
                ..DevInputs::default()
            })
            .expect_err("homepage observation failure should stop dev run");

        assert!(error.contains("failed to read child stdout"));
    }

    #[test]
    fn auto_open_parser_ignores_non_homepage_lines() {
        assert_eq!(parse_homepage_url_line("==> 管理入口: http://127.0.0.1:8080/admin"), None);
        assert_eq!(parse_homepage_url_line("child ready"), None);
    }

    #[test]
    fn auto_open_parser_extracts_trimmed_homepage_url() {
        assert_eq!(
            parse_homepage_url_line("==> 首页地址: http://127.0.0.1:8899/ "),
            Some("http://127.0.0.1:8899/".to_string())
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

        fn without_banner() -> Self {
            Self { banner: None }
        }
    }

    impl StartupBannerSource for FakeStartupBannerSource {
        fn build(&self, _config: &ResolvedAppConfig) -> Result<Option<StartupBanner>, String> {
            Ok(self.banner.clone())
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum RecordedAction {
        CheckCommand(String),
        BundleWeb,
        PrepareDatabase(String),
        BuildServer,
        LaunchChild,
        WaitChild,
    }

    #[derive(Debug, Clone, Default)]
    struct SharedActionLog(Rc<RefCell<Vec<RecordedAction>>>);

    impl SharedActionLog {
        fn push(&self, action: RecordedAction) {
            self.0.borrow_mut().push(action);
        }

        fn actions(&self) -> Vec<RecordedAction> {
            self.0.borrow().clone()
        }
    }

    #[derive(Debug, Clone)]
    struct RecordingCommandRunner {
        actions: SharedActionLog,
        calls: Rc<RefCell<Vec<String>>>,
        build_error: Rc<RefCell<Option<String>>>,
    }

    impl Default for RecordingCommandRunner {
        fn default() -> Self {
            Self {
                actions: SharedActionLog::default(),
                calls: Rc::new(RefCell::new(Vec::new())),
                build_error: Rc::new(RefCell::new(None)),
            }
        }
    }

    impl RecordingCommandRunner {
        fn with_action_log(actions: SharedActionLog) -> Self {
            Self {
                actions,
                calls: Rc::new(RefCell::new(Vec::new())),
                build_error: Rc::new(RefCell::new(None)),
            }
        }

        fn failing_build(actions: SharedActionLog) -> Self {
            Self {
                actions,
                calls: Rc::new(RefCell::new(Vec::new())),
                build_error: Rc::new(RefCell::new(Some("cargo build failed".to_string()))),
            }
        }

        fn command_programs_and_args(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl CommandRunner for RecordingCommandRunner {
        fn run(&self, program: &str, args: &[String]) -> Result<CommandOutput, String> {
            let rendered = if args.is_empty() {
                program.to_string()
            } else {
                format!("{program} {}", args.join(" "))
            };
            self.calls.borrow_mut().push(rendered);
            if args.len() == 1 && args[0] == "--version" {
                self.actions
                    .push(RecordedAction::CheckCommand(program.to_string()));
                return Ok(CommandOutput::default());
            }

            if program == "powershell" && args.iter().any(|arg| arg == "-File") {
                self.actions.push(RecordedAction::BundleWeb);
                return Ok(CommandOutput::default());
            }

            if program == "cargo" && args.first().is_some_and(|arg| arg == "build") {
                self.actions.push(RecordedAction::BuildServer);
                if let Some(error) = self.build_error.borrow_mut().take() {
                    return Err(error);
                }
            }
            Ok(CommandOutput::default())
        }
    }

    #[derive(Debug, Clone)]
    struct RecordingDatabaseProvisioner {
        actions: SharedActionLog,
        result: Rc<RefCell<Result<(), String>>>,
    }

    impl RecordingDatabaseProvisioner {
        fn with_action_log(actions: SharedActionLog) -> Self {
            Self {
                actions,
                result: Rc::new(RefCell::new(Ok(()))),
            }
        }

        fn failing(actions: SharedActionLog, error: String) -> Self {
            Self {
                actions,
                result: Rc::new(RefCell::new(Err(error))),
            }
        }
    }

    impl DatabaseProvisioner for RecordingDatabaseProvisioner {
        fn prepare(&self, database_url: &str, _migrations_dir: &Path) -> Result<(), String> {
            self.actions
                .push(RecordedAction::PrepareDatabase(database_url.to_string()));
            self.result.borrow().clone()
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct LaunchCall {
        program: String,
        args: Vec<String>,
        envs: Vec<(String, Option<String>)>,
    }

    #[derive(Debug, Clone, Default)]
    struct RecordingChildProcessLauncher {
        actions: SharedActionLog,
        calls: Rc<RefCell<Vec<LaunchCall>>>,
        stdout_lines: Vec<String>,
        stderr_lines: Vec<String>,
        observation_error: Option<String>,
    }

    impl RecordingChildProcessLauncher {
        fn with_action_log(actions: SharedActionLog) -> Self {
            Self {
                actions,
                calls: Rc::new(RefCell::new(Vec::new())),
                stdout_lines: Vec::new(),
                stderr_lines: Vec::new(),
                observation_error: None,
            }
        }

        fn with_transcript(
            actions: SharedActionLog,
            stdout_lines: Vec<String>,
            stderr_lines: Vec<String>,
        ) -> Self {
            Self {
                actions,
                calls: Rc::new(RefCell::new(Vec::new())),
                stdout_lines,
                stderr_lines,
                observation_error: None,
            }
        }

        fn with_observation_error(actions: SharedActionLog, error: String) -> Self {
            Self {
                actions,
                calls: Rc::new(RefCell::new(Vec::new())),
                stdout_lines: Vec::new(),
                stderr_lines: Vec::new(),
                observation_error: Some(error),
            }
        }

        fn launch_calls(&self) -> Vec<LaunchCall> {
            self.calls.borrow().clone()
        }
    }

    #[derive(Debug, Clone)]
    struct RecordingChildProcess {
        actions: SharedActionLog,
        stdout_lines: Vec<String>,
        stderr_lines: Vec<String>,
        observation_error: Option<String>,
    }

    impl ChildProcess for RecordingChildProcess {
        fn wait_for_homepage_url(&mut self, _timeout: Duration) -> Result<Option<String>, String> {
            if let Some(error) = self.observation_error.clone() {
                return Err(error);
            }
            let _ = &self.stderr_lines;
            Ok(self
                .stdout_lines
                .iter()
                .find_map(|line| parse_homepage_url_line(line)))
        }

        fn wait(&mut self) -> Result<(), String> {
            self.actions.push(RecordedAction::WaitChild);
            Ok(())
        }
    }

    impl ChildProcessLauncher for RecordingChildProcessLauncher {
        fn launch(
            &self,
            program: &str,
            args: &[String],
            envs: &[(String, Option<String>)],
        ) -> Result<Box<dyn ChildProcess>, String> {
            self.actions.push(RecordedAction::LaunchChild);
            self.calls.borrow_mut().push(LaunchCall {
                program: program.to_string(),
                args: args.to_vec(),
                envs: envs.to_vec(),
            });
            Ok(Box::new(RecordingChildProcess {
                actions: self.actions.clone(),
                stdout_lines: self.stdout_lines.clone(),
                stderr_lines: self.stderr_lines.clone(),
                observation_error: self.observation_error.clone(),
            }))
        }
    }

    #[derive(Debug, Clone, Default)]
    struct RecordingBrowserOpener {
        _calls: Cell<usize>,
        opened_urls: Rc<RefCell<Vec<String>>>,
    }

    impl RecordingBrowserOpener {
        fn opened_urls(&self) -> Vec<String> {
            self.opened_urls.borrow().clone()
        }
    }

    impl BrowserOpener for RecordingBrowserOpener {
        fn open(&self, url: &str) -> Result<(), String> {
            self._calls.set(self._calls.get() + 1);
            self.opened_urls.borrow_mut().push(url.to_string());
            Ok(())
        }
    }

    #[derive(Debug, Default)]
    struct NoopCommandRunner;

    impl CommandRunner for NoopCommandRunner {
        fn run(&self, _program: &str, _args: &[String]) -> Result<CommandOutput, String> {
            Ok(CommandOutput::default())
        }
    }

    #[derive(Debug, Clone, Copy, Default)]
    struct NoopDatabaseProvisioner;

    impl DatabaseProvisioner for NoopDatabaseProvisioner {
        fn prepare(&self, _database_url: &str, _migrations_dir: &Path) -> Result<(), String> {
            Ok(())
        }
    }

    #[derive(Debug, Default)]
    struct NoopChildProcessLauncher;

    impl ChildProcessLauncher for NoopChildProcessLauncher {
        fn launch(
            &self,
            _program: &str,
            _args: &[String],
            _envs: &[(String, Option<String>)],
        ) -> Result<Box<dyn ChildProcess>, String> {
            Ok(Box::new(RecordingChildProcess {
                actions: SharedActionLog::default(),
                stdout_lines: Vec::new(),
                stderr_lines: Vec::new(),
                observation_error: None,
            }))
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

    fn write_fake_binary(root: &Path) {
        let binary = root
            .join("target")
            .join("run")
            .join("debug")
            .join(format!("koko{}", std::env::consts::EXE_SUFFIX));
        fs::create_dir_all(binary.parent().expect("binary path should have a parent"))
            .expect("binary dir should be creatable");
        fs::write(binary, "fake-binary").expect("fake binary should be writable");
    }

    fn test_dev_config(root: &Path) -> ResolvedAppConfig {
        ResolvedAppConfig::load_for_test(
            Some("postgres://koko:koko_local@127.0.0.1:5432/koko_dev_chat"),
            Some("127.0.0.1:8080"),
            root.join("config").join("koko.toml"),
            Some("local-admin-token"),
            Some(false),
        )
        .expect("dev config should load")
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
