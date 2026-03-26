use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct CommandSpec {
    program: String,
    args: Vec<String>,
    current_dir: Option<PathBuf>,
    envs: Vec<(String, String)>,
}

impl CommandSpec {
    pub fn new<I, S>(program: &str, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        Self {
            program: program.to_owned(),
            args: args.into_iter().map(|arg| arg.as_ref().to_owned()).collect(),
            current_dir: None,
            envs: Vec::new(),
        }
    }

    pub fn current_dir(mut self, path: &Path) -> Self {
        self.current_dir = Some(path.to_path_buf());
        self
    }

    pub fn env(mut self, key: &str, value: &str) -> Self {
        self.envs.push((key.to_owned(), value.to_owned()));
        self
    }
}

pub fn require_command(name: &str, hint: &str) -> Result<(), String> {
    if command_exists(name) {
        return Ok(());
    }

    Err(format!("缺少命令 {name}。{hint}"))
}

pub fn run(spec: &CommandSpec, dry_run: bool) -> Result<(), String> {
    if dry_run {
        println!("[dry-run] {}", format_command(spec));
        return Ok(());
    }

    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    if let Some(current_dir) = &spec.current_dir {
        command.current_dir(current_dir);
    }
    for (key, value) in &spec.envs {
        command.env(key, value);
    }

    let status = command
        .status()
        .map_err(|error| format!("执行 {} 失败: {error}", format_command(spec)))?;

    if status.success() {
        return Ok(());
    }

    Err(format!(
        "命令执行失败，退出码 {:?}: {}",
        status.code(),
        format_command(spec)
    ))
}

fn command_exists(name: &str) -> bool {
    let paths = match std::env::var_os("PATH") {
        Some(paths) => paths,
        None => return false,
    };

    std::env::split_paths(&paths).any(|dir| candidate_paths(&dir, name).iter().any(|path| path.is_file()))
}

fn candidate_paths(dir: &Path, name: &str) -> Vec<PathBuf> {
    if cfg!(windows) {
        let executable = OsStr::new(name);
        let ext = OsStr::new("exe");

        let path = Path::new(name);
        let mut candidates = vec![dir.join(path)];
        if path.extension().is_none() {
            candidates.push(dir.join(path).with_extension(ext));
        }
        if executable == OsStr::new("cargo") {
            candidates.push(dir.join("cargo.cmd"));
        }
        candidates
    } else {
        vec![dir.join(name)]
    }
}

fn format_command(spec: &CommandSpec) -> String {
    let mut parts = Vec::new();

    if let Some(current_dir) = &spec.current_dir {
        parts.push(format!("cd {}", current_dir.display()));
    }
    for (key, value) in &spec.envs {
        parts.push(format!("{key}={value}"));
    }

    parts.push(spec.program.clone());
    parts.extend(spec.args.iter().cloned());
    parts.join(" ")
}
