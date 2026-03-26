mod env;

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
    if dry_run {
        println!("[dry-run] 已读取 .env.local");
        println!("[dry-run] DATABASE_URL={}", env.database_url);
        println!("[dry-run] KOKO_API_BASE={}", env.api_base);
        return Ok(());
    }

    Err("init 尚未实现".into())
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
    if dry_run {
        println!("[dry-run] migrate 将使用 DATABASE_URL={}", env.database_url);
        return Ok(());
    }

    Err("migrate 尚未实现".into())
}
