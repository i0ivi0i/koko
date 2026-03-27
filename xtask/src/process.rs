use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::Sender;
use std::thread::{self, JoinHandle};

use crate::logging::LogEvent;

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

pub fn spawn_logged(
    name: &'static str,
    spec: &CommandSpec,
    sender: Sender<LogEvent>,
) -> Result<ManagedChild, String> {
    let mut command = base_command(spec);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 {name} 失败: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{name} 标准输出管道不可用"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{name} 标准错误管道不可用"))?;

    let stdout_handle = spawn_reader(name, stdout, sender.clone());
    let stderr_handle = spawn_reader(name, stderr, sender);

    Ok(ManagedChild {
        child,
        readers: vec![stdout_handle, stderr_handle],
    })
}

fn command_exists(name: &str) -> bool {
    let paths = match std::env::var_os("PATH") {
        Some(paths) => paths,
        None => return false,
    };

    std::env::split_paths(&paths).any(|dir| candidate_paths(&dir, name).iter().any(|path| path.is_file()))
}

pub fn has_command(name: &str) -> bool {
    command_exists(name)
}

pub fn format_command(spec: &CommandSpec) -> String {
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

pub struct ManagedChild {
    child: Child,
    readers: Vec<JoinHandle<()>>,
}

impl ManagedChild {
    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, String> {
        self.child
            .try_wait()
            .map_err(|error| format!("读取子进程状态失败: {error}"))
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if self.try_wait()?.is_none() {
            self.child
                .kill()
                .map_err(|error| format!("停止子进程失败: {error}"))?;
            self.child
                .wait()
                .map_err(|error| format!("等待子进程退出失败: {error}"))?;
        }

        while let Some(reader) = self.readers.pop() {
            let _ = reader.join();
        }

        Ok(())
    }
}

fn candidate_paths(dir: &Path, name: &str) -> Vec<PathBuf> {
    let mut candidates = vec![dir.join(name)];

    if cfg!(windows) {
        let path = Path::new(name);
        if path.extension().is_none() {
            candidates.push(dir.join(path).with_extension("exe"));
        }
        if name == "cargo" {
            candidates.push(dir.join("cargo.exe"));
            candidates.push(dir.join("cargo.cmd"));
        }
        if name == "cargo-watch" {
            candidates.push(dir.join("cargo-watch.exe"));
        }
        if name == "dx" {
            candidates.push(dir.join("dx.exe"));
        }
    }

    candidates
}

fn base_command(spec: &CommandSpec) -> Command {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    if let Some(current_dir) = &spec.current_dir {
        command.current_dir(current_dir);
    }
    for (key, value) in &spec.envs {
        command.env(key, value);
    }
    command
}

fn spawn_reader<R>(
    source: &'static str,
    reader: R,
    sender: Sender<LogEvent>,
) -> JoinHandle<()>
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = std::io::BufReader::new(reader);
        for line in std::io::BufRead::lines(reader).map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let _ = sender.send(LogEvent::new(source, line));
        }
    })
}
