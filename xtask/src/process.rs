use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc::Sender;
use std::thread::{self, JoinHandle};

use crate::logging::LogEvent;
use command_group::{CommandGroup, GroupChild};
use duct::cmd;

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
            args: args
                .into_iter()
                .map(|arg| arg.as_ref().to_owned())
                .collect(),
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
    if has_command(name) {
        return Ok(());
    }

    Err(format!("缺少命令 {name}。{hint}"))
}

pub fn run(spec: &CommandSpec, dry_run: bool) -> Result<(), String> {
    if dry_run {
        println!("[dry-run] {}", format_command(spec));
        return Ok(());
    }

    let mut expression = cmd(&spec.program, &spec.args);

    if let Some(current_dir) = &spec.current_dir {
        expression = expression.dir(current_dir);
    }
    for (key, value) in &spec.envs {
        expression = expression.env(key, value);
    }

    let output = expression
        .unchecked()
        .run()
        .map_err(|error| format!("执行 {} 失败: {error}", format_command(spec)))?;

    if output.status.success() {
        return Ok(());
    }

    Err(format!(
        "命令执行失败，退出码 {:?}: {}",
        output.status.code(),
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
        .group_spawn()
        .map_err(|error| format!("启动 {name} 失败: {error}"))?;

    let stdout = child
        .inner()
        .stdout
        .take()
        .ok_or_else(|| format!("{name} 标准输出管道不可用"))?;
    let stderr = child
        .inner()
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

pub fn has_command(name: &str) -> bool {
    which::which(name).is_ok()
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
    child: GroupChild,
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

fn spawn_reader<R>(source: &'static str, reader: R, sender: Sender<LogEvent>) -> JoinHandle<()>
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Mutex, OnceLock, mpsc};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[cfg(windows)]
    #[test]
    fn has_command_should_find_cmd_scripts_on_windows_path() {
        let _guard = windows_process_test_lock().lock().unwrap();
        let temp_dir = unique_temp_dir("path-cmd");
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(temp_dir.join("hello.cmd"), "@echo off\r\nexit /b 0\r\n").unwrap();

        let _path_guard = PathGuard::set(&temp_dir);

        assert!(has_command("hello"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(windows)]
    #[test]
    fn stop_should_kill_spawned_process_group() {
        let _guard = windows_process_test_lock().lock().unwrap();
        let temp_dir = unique_temp_dir("process-group");
        fs::create_dir_all(&temp_dir).unwrap();
        let pid_file = temp_dir.join("child.pid");
        let powershell = temp_dir.join("spawn-child.ps1");
        let child_path = pid_file.display().to_string().replace('\'', "''");
        let powershell_exe = which::which("powershell").unwrap();

        fs::write(
            &powershell,
            format!(
                "$p = Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -PassThru\nSet-Content -Path '{child_path}' -Value $p.Id\nStart-Sleep -Seconds 30\n"
            ),
        )
        .unwrap();

        let spec = CommandSpec::new(
            &powershell_exe.display().to_string(),
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                &powershell.display().to_string(),
            ],
        );
        let (sender, _receiver) = mpsc::channel();
        let mut child = spawn_logged("test", &spec, sender).unwrap();

        let child_pid = wait_for_pid(&pid_file);
        let _cleanup = ChildPidGuard(child_pid);

        child.stop().unwrap();

        std::thread::sleep(Duration::from_millis(400));

        assert!(!process_exists(child_pid));

        let _ = fs::remove_file(powershell);
        let _ = fs::remove_file(pid_file);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(windows)]
    struct PathGuard(Option<std::ffi::OsString>);

    #[cfg(windows)]
    impl PathGuard {
        fn set(path: &Path) -> Self {
            let original = std::env::var_os("PATH");
            unsafe {
                std::env::set_var("PATH", path.as_os_str());
            }
            Self(original)
        }
    }

    #[cfg(windows)]
    impl Drop for PathGuard {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => unsafe {
                    std::env::set_var("PATH", value);
                },
                None => unsafe {
                    std::env::remove_var("PATH");
                },
            }
        }
    }

    #[cfg(windows)]
    struct ChildPidGuard(u32);

    #[cfg(windows)]
    impl Drop for ChildPidGuard {
        fn drop(&mut self) {
            let _ = Command::new("taskkill")
                .args(["/PID", &self.0.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }

    #[cfg(windows)]
    fn process_exists(pid: u32) -> bool {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .output()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .any(|line| line.contains(&pid.to_string()))
            })
            .unwrap_or(false)
    }

    #[cfg(windows)]
    fn wait_for_pid(path: &Path) -> u32 {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(pid) = content.trim().parse() {
                    return pid;
                }
            }

            assert!(std::time::Instant::now() < deadline, "等待子进程 PID 超时");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("koko-xtask-{label}-{stamp}"))
    }

    #[cfg(windows)]
    fn windows_process_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }
}
