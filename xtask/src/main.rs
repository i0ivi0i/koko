mod env;
mod logging;
mod process;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use std::process::ExitCode;

enum Command {
    Init,
    Dev,
    Migrate,
    Test,
    Check,
}

struct Cli {
    command: Command,
    dry_run: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let cli = parse_args()?;
    let root = env::workspace_root();

    match cli.command {
        Command::Init => run_init(root, cli.dry_run),
        Command::Dev => run_dev(root, cli.dry_run),
        Command::Migrate => run_migrate(root, cli.dry_run),
        Command::Test => run_test(root, cli.dry_run),
        Command::Check => run_check(root, cli.dry_run),
    }
}

fn parse_args() -> Result<Cli, String> {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        return Err("缺少子命令。可用命令: init, dev, migrate, test, check".into());
    };

    let mut dry_run = false;
    for arg in args {
        match arg.as_str() {
            "--dry-run" => dry_run = true,
            other => return Err(format!("不支持的参数: {other}")),
        }
    }

    let command = match command.as_str() {
        "init" => Command::Init,
        "dev" => Command::Dev,
        "migrate" => Command::Migrate,
        "test" => Command::Test,
        "check" => Command::Check,
        other => return Err(format!("不支持的子命令: {other}")),
    };

    Ok(Cli { command, dry_run })
}

fn run_init(root: &std::path::Path, dry_run: bool) -> Result<(), String> {
    let env = env::load_local_env(root)?;
    process::require_command(
        "sqlx",
        "请先执行 cargo install sqlx-cli --no-default-features --features native-tls,postgres",
    )?;
    process::require_command("cargo-watch", "请先执行 cargo install cargo-watch")?;
    process::require_command("dx", "请先执行 cargo install dioxus-cli")?;

    println!("已读取 .env.local");
    println!("DATABASE_URL={}", env.database_url);
    println!("KOKO_API_BASE={}", env.api_base);

    let database_create = process::CommandSpec::new("sqlx", ["database", "create"])
        .current_dir(root)
        .env("DATABASE_URL", &env.database_url);
    let migrate_run = process::CommandSpec::new("sqlx", ["migrate", "run"])
        .current_dir(root)
        .env("DATABASE_URL", &env.database_url);

    process::run(&database_create, dry_run)?;
    process::run(&migrate_run, dry_run)
}

fn run_dev(root: &std::path::Path, dry_run: bool) -> Result<(), String> {
    let env = env::load_local_env(root)?;
    process::require_command("cargo-watch", "请先执行 cargo install cargo-watch")?;
    process::require_command("dx", "请先执行 cargo install dioxus-cli")?;
    let use_sccache = process::has_command("sccache");
    let backend = backend_dev_spec(root, &env, use_sccache);
    let frontend = frontend_dev_spec(root, &env);

    if dry_run {
        println!("[dry-run] 后端命令: {}", process::format_command(&backend));
        println!("[dry-run] 前端命令: {}", process::format_command(&frontend));
        println!("[dry-run] RUST_LOG={}", env.rust_log);
        println!(
            "[dry-run] 编译缓存: {}",
            if use_sccache { "sccache" } else { "默认 rustc" }
        );
        println!("[dry-run] 日志模式: 终端聚合");
        return Ok(());
    }

    if use_sccache {
        println!("已启用 sccache 编译缓存。");
    } else {
        println!("未检测到 sccache，继续使用默认 rustc。");
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_signal = Arc::clone(&stop);
    ctrlc::set_handler(move || {
        stop_signal.store(true, Ordering::SeqCst);
    })
    .map_err(|error| format!("注册 Ctrl+C 处理器失败: {error}"))?;

    let (sender, receiver) = mpsc::channel();
    let mut backend_child = process::spawn_logged("server", &backend, sender.clone())?;
    let mut frontend_child = process::spawn_logged("web", &frontend, sender)?;

    println!("开发服务已启动。按 Ctrl+C 停止。");
    println!("后端监听: {}", env.server_bind);
    println!("前端监听: {}", env.web_bind);
    println!("后端入口: {}", env.api_base);
    println!("前端入口: {}", frontend_entry_url(&env.api_base, &env.web_bind));

    loop {
        while let Ok(event) = receiver.recv_timeout(Duration::from_millis(200)) {
            logging::print_event(&event);
        }

        if stop.load(Ordering::SeqCst) {
            println!("收到退出信号，正在停止开发服务...");
            break;
        }

        if let Some(status) = backend_child.try_wait()? {
            println!("后端进程已退出，退出码: {:?}", status.code());
            break;
        }

        if let Some(status) = frontend_child.try_wait()? {
            println!("前端进程已退出，退出码: {:?}", status.code());
            break;
        }
    }

    backend_child.stop()?;
    frontend_child.stop()?;

    for event in receiver.try_iter() {
        logging::print_event(&event);
    }

    Ok(())
}

fn run_migrate(root: &std::path::Path, dry_run: bool) -> Result<(), String> {
    let env = env::load_local_env(root)?;
    process::require_command(
        "sqlx",
        "请先执行 cargo install sqlx-cli --no-default-features --features native-tls,postgres",
    )?;

    println!("已读取 .env.local");
    println!("DATABASE_URL={}", env.database_url);

    let migrate_run = process::CommandSpec::new("sqlx", ["migrate", "run"])
        .current_dir(root)
        .env("DATABASE_URL", &env.database_url);

    process::run(&migrate_run, dry_run)
}

fn run_test(root: &std::path::Path, dry_run: bool) -> Result<(), String> {
    let env = env::load_local_env(root)?;
    let test =
        apply_sccache(process::CommandSpec::new("cargo", ["test"]).current_dir(root), process::has_command("sccache"))
            .env("DATABASE_URL", &env.database_url);

    process::run(&test, dry_run)
}

fn run_check(root: &std::path::Path, dry_run: bool) -> Result<(), String> {
    let env = env::load_local_env(root)?;
    let use_sccache = process::has_command("sccache");
    let server_check = apply_sccache(
        process::CommandSpec::new("cargo", ["check", "-p", "koko-server"]).current_dir(root),
        use_sccache,
    )
    .env("DATABASE_URL", &env.database_url);
    let web_check = apply_sccache(
        process::CommandSpec::new(
            "cargo",
            ["check", "-p", "koko-web", "--target", "wasm32-unknown-unknown"],
        )
        .current_dir(root),
        use_sccache,
    );

    process::run(&server_check, dry_run)?;
    process::run(&web_check, dry_run)
}

fn backend_dev_spec(
    root: &std::path::Path,
    env: &env::LocalEnv,
    use_sccache: bool,
) -> process::CommandSpec {
    let target_dir = dev_target_dir(root, "dev-server");

    apply_sccache(
        process::CommandSpec::new(
            "cargo",
            [
                "watch",
                "--",
                "cargo",
                "run",
                "--package",
                "koko-server",
                "--bin",
                "koko-server",
            ],
        )
        .current_dir(root),
        use_sccache,
    )
    .env("DATABASE_URL", &env.database_url)
    .env("SERVER_BIND", &env.server_bind)
    .env("RUST_LOG", &env.rust_log)
    .env("CARGO_TARGET_DIR", &target_dir)
}

fn frontend_dev_spec(root: &std::path::Path, env: &env::LocalEnv) -> process::CommandSpec {
    let target_dir = dev_target_dir(root, "dev-web");
    let (web_host, web_port) = split_socket_addr(&env.web_bind);

    process::CommandSpec::new(
        "dx",
        [
            "serve",
            "--platform",
            "web",
            "--port",
            &web_port,
            "--addr",
            &web_host,
        ],
    )
    .current_dir(&root.join("web"))
    .env("KOKO_API_BASE", &env.api_base)
    .env("CARGO_TARGET_DIR", &target_dir)
}

fn split_socket_addr(bind: &str) -> (String, String) {
    let Some((host, port)) = bind.rsplit_once(':') else {
        return ("0.0.0.0".to_owned(), "8080".to_owned());
    };

    (host.to_owned(), port.to_owned())
}

fn frontend_entry_url(api_base: &str, web_bind: &str) -> String {
    let host = api_base
        .split("://")
        .nth(1)
        .unwrap_or(api_base)
        .split('/')
        .next()
        .unwrap_or(api_base)
        .split(':')
        .next()
        .unwrap_or("127.0.0.1");
    let (_, port) = split_socket_addr(web_bind);

    format!("http://{host}:{port}")
}

fn apply_sccache(spec: process::CommandSpec, use_sccache: bool) -> process::CommandSpec {
    if use_sccache {
        spec.env("RUSTC_WRAPPER", "sccache")
    } else {
        spec
    }
}

fn dev_target_dir(root: &std::path::Path, name: &str) -> String {
    root.join("target").join(name).display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_dev_command_should_not_enable_hotpatch_by_default() {
        let root = std::path::Path::new("D:/koko");
        let env = env::LocalEnv {
            database_url: "postgres://local".into(),
            api_base: "http://127.0.0.1:3000".into(),
            server_bind: "0.0.0.0:3000".into(),
            web_bind: "0.0.0.0:8080".into(),
            rust_log: "info".into(),
        };

        let command = frontend_dev_spec(root, &env);
        let formatted = process::format_command(&command);

        assert!(!formatted.contains("--hot-patch"));
    }

    #[test]
    fn backend_dev_command_should_use_sccache_when_available() {
        let root = std::path::Path::new("D:/koko");
        let env = env::LocalEnv {
            database_url: "postgres://local".into(),
            api_base: "http://127.0.0.1:3000".into(),
            server_bind: "0.0.0.0:3000".into(),
            web_bind: "0.0.0.0:8080".into(),
            rust_log: "info".into(),
        };

        let command = backend_dev_spec(root, &env, true);
        let formatted = process::format_command(&command);

        assert!(formatted.contains("RUSTC_WRAPPER=sccache"));
    }

    #[test]
    fn backend_dev_command_should_not_require_sccache() {
        let root = std::path::Path::new("D:/koko");
        let env = env::LocalEnv {
            database_url: "postgres://local".into(),
            api_base: "http://127.0.0.1:3000".into(),
            server_bind: "0.0.0.0:3000".into(),
            web_bind: "0.0.0.0:8080".into(),
            rust_log: "info".into(),
        };

        let command = backend_dev_spec(root, &env, false);
        let formatted = process::format_command(&command);

        assert!(!formatted.contains("RUSTC_WRAPPER=sccache"));
    }

    #[test]
    fn backend_dev_command_should_use_dedicated_target_dir() {
        let root = std::path::Path::new("D:/koko");
        let env = env::LocalEnv {
            database_url: "postgres://local".into(),
            api_base: "http://127.0.0.1:3000".into(),
            server_bind: "0.0.0.0:3000".into(),
            web_bind: "0.0.0.0:8080".into(),
            rust_log: "info".into(),
        };

        let command = backend_dev_spec(root, &env, false);
        let formatted = process::format_command(&command);
        let expected = format!("CARGO_TARGET_DIR={}", dev_target_dir(root, "dev-server"));

        assert!(formatted.contains(&expected));
    }

    #[test]
    fn frontend_dev_command_should_use_dedicated_target_dir() {
        let root = std::path::Path::new("D:/koko");
        let env = env::LocalEnv {
            database_url: "postgres://local".into(),
            api_base: "http://127.0.0.1:3000".into(),
            server_bind: "0.0.0.0:3000".into(),
            web_bind: "0.0.0.0:8080".into(),
            rust_log: "info".into(),
        };

        let command = frontend_dev_spec(root, &env);
        let formatted = process::format_command(&command);
        let expected = format!("CARGO_TARGET_DIR={}", dev_target_dir(root, "dev-web"));

        assert!(formatted.contains(&expected));
    }

    #[test]
    fn frontend_dev_command_should_respect_custom_web_bind() {
        let root = std::path::Path::new("D:/koko");
        let env = env::LocalEnv {
            database_url: "postgres://local".into(),
            api_base: "http://192.168.1.7:3000".into(),
            server_bind: "0.0.0.0:3000".into(),
            web_bind: "0.0.0.0:9090".into(),
            rust_log: "info".into(),
        };

        let command = frontend_dev_spec(root, &env);
        let formatted = process::format_command(&command);

        assert!(formatted.contains("--addr 0.0.0.0"));
        assert!(formatted.contains("--port 9090"));
    }

    #[test]
    fn frontend_entry_url_should_follow_api_host_and_web_port() {
        assert_eq!(
            frontend_entry_url("http://192.168.1.7:3000", "0.0.0.0:8088"),
            "http://192.168.1.7:8088"
        );
    }
}
