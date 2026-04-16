from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


REQUEST_TIMEOUT = "30m"
MAX_DURATION = "30m"


@dataclass
class LauncherHandle:
    process: subprocess.Popen[Any]
    stdout_path: Path
    stderr_path: Path


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def parse_concurrency_levels(raw: str) -> list[int]:
    levels: list[int] = []
    for piece in raw.replace("，", ",").replace(";", ",").split(","):
        token = piece.strip()
        if not token:
            continue
        level = int(token)
        if level <= 0:
            raise ValueError(f"并发路数必须是正整数，收到: {level}")
        levels.append(level)
    if not levels:
        raise ValueError("至少需要一个并发路数。")
    return levels


def ensure_http_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"BaseUrl 必须是 http(s) 地址，当前收到: {base_url}")
    return base_url.rstrip("/")


def find_command(command_name: str) -> Path:
    resolved = shutil.which(command_name)
    if resolved:
        return Path(resolved)

    local_app_data = Path(os.environ["LOCALAPPDATA"])
    fallback_map = {
        "tusd.exe": local_app_data / "Programs" / "tusd" / "bin" / "tusd.exe",
        "k6.exe": local_app_data / "Programs" / "k6" / "bin" / "k6.exe",
    }
    fallback = fallback_map.get(command_name)
    if fallback and fallback.exists():
        return fallback

    raise FileNotFoundError(f"缺少命令 {command_name}，请先安装。")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def wait_tcp_port(host: str, port: int, timeout_seconds: int = 180) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(2)
            if sock.connect_ex((host, port)) == 0:
                return
        time.sleep(2)
    raise TimeoutError(f"等待 {host}:{port} 超时。")


def start_launcher(repo_root: Path, tusd_bin_dir: Path, k6_bin_dir: Path, stdout_path: Path, stderr_path: Path) -> LauncherHandle:
    stdout_path.unlink(missing_ok=True)
    stderr_path.unlink(missing_ok=True)

    launcher_env_path = os.pathsep.join([str(tusd_bin_dir), str(k6_bin_dir), os.environ.get("PATH", "")])
    escaped_launcher_env_path = launcher_env_path.replace("'", "''")
    escaped_repo_root = str(repo_root).replace("'", "''")
    launcher_command = (
        f"$env:PATH = '{escaped_launcher_env_path}'; "
        f"Set-Location '{escaped_repo_root}'; "
        "& '.\\run.ps1'"
    )

    stdout_file = stdout_path.open("w", encoding="utf-8")
    stderr_file = stderr_path.open("w", encoding="utf-8")
    try:
        process = subprocess.Popen(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                launcher_command,
            ],
            cwd=repo_root,
            stdout=stdout_file,
            stderr=stderr_file,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    finally:
        stdout_file.close()
        stderr_file.close()

    return LauncherHandle(process=process, stdout_path=stdout_path, stderr_path=stderr_path)


def stop_process_tree(pid: int | None) -> None:
    if not pid:
        return
    subprocess.run(
        ["taskkill.exe", "/PID", str(pid), "/T", "/F"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def summarize_launcher(stdout_path: Path) -> dict[str, Any]:
    if not stdout_path.exists():
        return {
            "complete_enter_count": 0,
            "complete_exit_count": 0,
            "cleanup_noise_count": 0,
            "last_complete_log": None,
        }

    lines = stdout_path.read_text(encoding="utf-8", errors="replace").splitlines()
    complete_lines = [line for line in lines if "媒体上传 complete 重活" in line]
    return {
        "complete_enter_count": sum("complete_heavy_work_enter" in line for line in complete_lines),
        "complete_exit_count": sum("complete_heavy_work_exit" in line for line in complete_lines),
        "cleanup_noise_count": sum("解析上传残留临时文件路径失败" in line for line in lines),
        "last_complete_log": complete_lines[-1] if complete_lines else None,
    }


def round_or_none(value: Any, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def collect_result(vu: int, iterations_per_vu: int, k6_exit_code: int, summary: dict[str, Any], summary_path: Path) -> dict[str, Any]:
    timings = summary.get("timings_ms", {})
    aggregate = summary.get("aggregate", {})
    scenario = summary.get("scenario", {})
    return {
        "并发路数": vu,
        "k6退出码": k6_exit_code,
        "每路次数": iterations_per_vu,
        "总上传数": scenario.get("total_iterations"),
        "上传总量MiB": round_or_none(aggregate.get("uploaded_mib")),
        "完成成功率": round_or_none((aggregate.get("complete_success_rate") or 0) * 100),
        "HTTP失败率": round_or_none((aggregate.get("http_req_failed_rate") or 0) * 100),
        "Patch平均毫秒": round_or_none(timings.get("tus_patch", {}).get("avg")),
        "PatchP95毫秒": round_or_none(timings.get("tus_patch", {}).get("p95")),
        "Complete平均毫秒": round_or_none(timings.get("complete", {}).get("avg")),
        "CompleteP95毫秒": round_or_none(timings.get("complete", {}).get("p95")),
        "端到端平均毫秒": round_or_none((timings.get("end_to_end") or {}).get("avg")),
        "端到端P95毫秒": round_or_none((timings.get("end_to_end") or {}).get("p95")),
        "摘要文件": str(summary_path),
    }


def update_status(
    status_path: Path,
    *,
    phase: str,
    base_url: str,
    upload_file: Path,
    launcher: LauncherHandle | None,
    results: list[dict[str, Any]],
    current_vu: int | None,
    current_summary_path: Path | None,
    current_k6_log_path: Path | None,
    note: str | None = None,
    error: str | None = None,
) -> None:
    launcher_summary = (
        summarize_launcher(launcher.stdout_path)
        if launcher
        else {
            "complete_enter_count": 0,
            "complete_exit_count": 0,
            "cleanup_noise_count": 0,
            "last_complete_log": None,
        }
    )
    write_json(
        status_path,
        {
            "phase": phase,
            "base_url": base_url,
            "upload_file": str(upload_file),
            "current_vu": current_vu,
            "current_summary_path": str(current_summary_path) if current_summary_path else None,
            "current_k6_log_path": str(current_k6_log_path) if current_k6_log_path else None,
            "launcher_stdout_path": str(launcher.stdout_path) if launcher else None,
            "launcher_stderr_path": str(launcher.stderr_path) if launcher else None,
            "launcher_progress": launcher_summary,
            "results": results,
            "note": note,
            "error": error,
            "updated_at": now_iso(),
        },
    )


def run_k6_level(
    *,
    repo_root: Path,
    k6_path: Path,
    script_path: Path,
    base_url: str,
    upload_file: Path,
    vu: int,
    iterations_per_vu: int,
    summary_path: Path,
    k6_log_path: Path,
    launcher: LauncherHandle,
    status_path: Path,
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    env = os.environ.copy()
    env.update(
        {
            "KOKO_BASE_URL": base_url,
            "KOKO_UPLOAD_FILE": str(upload_file),
            "KOKO_BENCH_VUS": str(vu),
            "KOKO_BENCH_ITERATIONS_PER_VU": str(iterations_per_vu),
            "KOKO_BENCH_SUMMARY_FILE": str(summary_path),
            "KOKO_REQUEST_TIMEOUT": REQUEST_TIMEOUT,
            "KOKO_BENCH_MAX_DURATION": MAX_DURATION,
        }
    )

    summary_path.unlink(missing_ok=True)
    k6_log_path.unlink(missing_ok=True)
    with k6_log_path.open("w", encoding="utf-8") as k6_log_file:
        process = subprocess.Popen(
            [str(k6_path), "run", str(script_path)],
            cwd=repo_root,
            env=env,
            stdout=k6_log_file,
            stderr=subprocess.STDOUT,
        )
        try:
            while process.poll() is None:
                update_status(
                    status_path,
                    phase="running_k6",
                    base_url=base_url,
                    upload_file=upload_file,
                    launcher=launcher,
                    results=results,
                    current_vu=vu,
                    current_summary_path=summary_path,
                    current_k6_log_path=k6_log_path,
                    note="k6 已启动，当前主要在等待后端 complete 重活收口。",
                )
                time.sleep(3)
            exit_code = process.wait()
        finally:
            if process.poll() is None:
                stop_process_tree(process.pid)

    if not summary_path.exists():
        raise RuntimeError(f"k6 未产出摘要文件，vus={vu}")

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    result = collect_result(vu, iterations_per_vu, exit_code, summary, summary_path)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="本地单机媒体上传并发压测编排器。")
    parser.add_argument("--upload-file", required=True, help="要压测的大视频文件绝对路径。")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080", help="业务 HTTP 服务地址。")
    parser.add_argument("--concurrency-levels", default="1,2,4,8", help="逗号分隔的并发路数，例如 1,2,4。")
    parser.add_argument("--iterations-per-vu", type=int, default=1, help="每个 VU 的迭代次数。")
    parser.add_argument("--status-file", default="", help="状态文件路径；为空时写到临时目录。")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    upload_file = Path(args.upload_file)
    if not upload_file.exists():
        raise FileNotFoundError(f"压测文件不存在: {upload_file}")

    base_url = ensure_http_url(args.base_url)
    levels = parse_concurrency_levels(args.concurrency_levels)
    if args.iterations_per_vu <= 0:
        raise ValueError(f"每路次数必须是正整数，收到: {args.iterations_per_vu}")

    tusd_path = find_command("tusd.exe")
    k6_path = find_command("k6.exe")
    script_path = repo_root / "scripts" / "媒体上传并发压测.js"

    status_path = Path(args.status_file) if args.status_file else Path(tempfile.gettempdir()) / "koko-media-upload-bench-status.json"
    launcher_stdout = Path(tempfile.gettempdir()) / "koko-bench-launcher.stdout.log"
    launcher_stderr = Path(tempfile.gettempdir()) / "koko-bench-launcher.stderr.log"

    results: list[dict[str, Any]] = []
    launcher: LauncherHandle | None = None
    try:
        update_status(
            status_path,
            phase="starting_launcher",
            base_url=base_url,
            upload_file=upload_file,
            launcher=None,
            results=results,
            current_vu=None,
            current_summary_path=None,
            current_k6_log_path=None,
            note=f"准备启动 launcher，并按并发档位 {levels} 依次压测。",
        )

        launcher = start_launcher(repo_root, tusd_path.parent, k6_path.parent, launcher_stdout, launcher_stderr)
        update_status(
            status_path,
            phase="waiting_ports",
            base_url=base_url,
            upload_file=upload_file,
            launcher=launcher,
            results=results,
            current_vu=None,
            current_summary_path=None,
            current_k6_log_path=None,
            note="launcher 已启动，等待 8080/1081/7072 就绪。",
        )

        for port in (8080, 1081, 7072):
            wait_tcp_port("127.0.0.1", port)

        for vu in levels:
            summary_path = Path(tempfile.gettempdir()) / f"koko-media-upload-bench-{vu}vu.json"
            k6_log_path = Path(tempfile.gettempdir()) / f"koko-media-upload-bench-{vu}vu.log"
            result = run_k6_level(
                repo_root=repo_root,
                k6_path=k6_path,
                script_path=script_path,
                base_url=base_url,
                upload_file=upload_file,
                vu=vu,
                iterations_per_vu=args.iterations_per_vu,
                summary_path=summary_path,
                k6_log_path=k6_log_path,
                launcher=launcher,
                status_path=status_path,
                results=results,
            )
            results.append(result)
            update_status(
                status_path,
                phase="running_k6",
                base_url=base_url,
                upload_file=upload_file,
                launcher=launcher,
                results=results,
                current_vu=vu,
                current_summary_path=summary_path,
                current_k6_log_path=k6_log_path,
                note=f"并发 {vu} 路已收集完成。",
            )

        cleanup_noise_count = summarize_launcher(launcher.stdout_path)["cleanup_noise_count"]
        update_status(
            status_path,
            phase="completed",
            base_url=base_url,
            upload_file=upload_file,
            launcher=launcher,
            results=results,
            current_vu=None,
            current_summary_path=None,
            current_k6_log_path=None,
            note="压测完成。" if cleanup_noise_count == 0 else "压测完成，但启动日志里仍发现清理噪音。",
            error=None if cleanup_noise_count == 0 else "启动日志仍发现上传残留清理噪音。",
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        update_status(
            status_path,
            phase="failed",
            base_url=base_url,
            upload_file=upload_file,
            launcher=launcher,
            results=results,
            current_vu=None,
            current_summary_path=None,
            current_k6_log_path=None,
            error=str(exc),
        )
        raise
    finally:
        if launcher:
            stop_process_tree(launcher.process.pid)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[bench] 失败: {exc}", file=sys.stderr)
        raise
