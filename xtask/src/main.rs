mod env;
mod process;

use std::process::ExitCode;

enum Command {
    Init,
    Dev,
    Migrate,
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
    }
}

fn parse_args() -> Result<Cli, String> {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        return Err("缺少子命令。可用命令: init, dev, migrate".into());
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
    if dry_run {
        println!("[dry-run] dev 将使用 DATABASE_URL={}", env.database_url);
        println!("[dry-run] dev 将使用 KOKO_API_BASE={}", env.api_base);
        return Ok(());
    }

    Err("dev 尚未实现".into())
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
