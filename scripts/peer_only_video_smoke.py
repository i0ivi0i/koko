from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable


默认房间号 = "1234b"
默认视频路径 = Path(r"D:\200-生活\230-照片备份\233-Telegram\色色\VID_20230820_121323_316.mp4")
默认设备等待秒 = 30
默认缓存等待秒 = 240
默认续播等待秒 = 90
默认轮询间隔秒 = 1.0


@dataclass(frozen=True)
class 页面句柄:
    page_id: int
    isolated_context: str


@dataclass(frozen=True)
class 命令入口:
    display_name: str
    argv: tuple[str, ...]


def 读取_dotenv(repo_root: Path) -> dict[str, str]:
    env_path = repo_root / ".env"
    if not env_path.exists():
        return {}
    result: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def 解析参数(repo_root: Path) -> argparse.Namespace:
    dotenv = 读取_dotenv(repo_root)
    default_port = dotenv.get("APP_PORT", "8080")
    parser = argparse.ArgumentParser(
        description="真实浏览器 peer-only 视频续播冒烟脚本"
    )
    parser.add_argument(
        "--base-url",
        default=f"http://127.0.0.1:{default_port}",
        help="Koko Web 地址",
    )
    parser.add_argument(
        "--room-code",
        default=默认房间号,
        help="要进入的房间短码",
    )
    parser.add_argument(
        "--video-file",
        default=str(默认视频路径),
        help="要上传的本地视频文件路径",
    )
    parser.add_argument(
        "--database-url",
        default=dotenv.get("DATABASE_URL", ""),
        help="PostgreSQL 连接串；默认读 .env",
    )
    parser.add_argument(
        "--device-timeout",
        type=int,
        default=默认设备等待秒,
        help="页面设备 token / 元素等待秒数",
    )
    parser.add_argument(
        "--cache-timeout",
        type=int,
        default=默认缓存等待秒,
        help="浏览器 A 等待附件本地完整缓存的秒数",
    )
    parser.add_argument(
        "--peer-timeout",
        type=int,
        default=默认续播等待秒,
        help="浏览器 B 等待 peer-only 续播成功的秒数",
    )
    parser.add_argument(
        "--keep-pages",
        action="store_true",
        help="成功后保留新开的 DevTools 页面，便于手工继续观察",
    )
    return parser.parse_args()


def 记录(message: str) -> None:
    print(message, flush=True)


def 解析命令入口(command_name: str) -> 命令入口:
    resolved = shutil.which(command_name)
    if not resolved:
        raise FileNotFoundError(f"缺少命令 {command_name}，请先安装后再运行脚本。")
    resolved_path = Path(resolved)
    if resolved_path.suffix.lower() == ".ps1":
        return 命令入口(
            display_name=command_name,
            argv=(
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(resolved_path),
            ),
        )
    return 命令入口(display_name=command_name, argv=(str(resolved_path),))


def 断言文件存在(file_path: Path) -> None:
    if not file_path.exists():
        raise FileNotFoundError(f"视频文件不存在: {file_path}")


def http_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    expect_status: int | None = 200,
    timeout: int = 30,
) -> tuple[int, Any]:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.getcode()
            raw = response.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
    text = raw.decode("utf-8", errors="replace").strip()
    parsed: Any
    if text:
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = text
    else:
        parsed = None
    if expect_status is not None and status != expect_status:
        raise RuntimeError(f"HTTP {method} {url} 返回 {status}: {parsed}")
    return status, parsed


def http_bytes(
    method: str,
    url: str,
    *,
    timeout: int = 30,
) -> tuple[int, bytes]:
    request = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.getcode(), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def 运行命令(
    args: list[str],
    *,
    cwd: Path,
    timeout: int = 30,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        args,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"命令失败: {' '.join(args)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def 解析_devtools消息(message: str) -> Any:
    fenced = re.search(r"```json\s*(.*?)\s*```", message, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    plain = message.removeprefix("Script ran on page and returned:").strip()
    if plain:
        try:
            return json.loads(plain)
        except json.JSONDecodeError:
            return plain
    return message


class ChromeDevTools客户端:
    def __init__(self, repo_root: Path, command: 命令入口) -> None:
        self.repo_root = repo_root
        self.command = command

    def _run(self, *args: str, timeout: int = 30) -> Any:
        result = 运行命令(
            [*self.command.argv, *args, "--output-format=json"],
            cwd=self.repo_root,
            timeout=timeout,
        )
        text = result.stdout.strip()
        if not text:
            return None
        payload = json.loads(text)
        if isinstance(payload, dict) and "message" in payload:
            return 解析_devtools消息(str(payload["message"]))
        return payload

    def new_page(self, url: str, isolated_context: str, *, timeout: int = 30) -> 页面句柄:
        payload = self._run(
            "new_page",
            url,
            "--isolatedContext",
            isolated_context,
            timeout=timeout,
        )
        pages = payload.get("pages", []) if isinstance(payload, dict) else []
        selected = next(
            (
                page
                for page in pages
                if page.get("selected") is True and page.get("isolatedContext") == isolated_context
            ),
            None,
        )
        if not selected:
            raise RuntimeError(f"新页面未返回选中页: {payload}")
        return 页面句柄(page_id=int(selected["id"]), isolated_context=isolated_context)

    def select_page(self, page_id: int) -> None:
        self._run("select_page", str(page_id))

    def close_page(self, page_id: int) -> None:
        self._run("close_page", str(page_id))

    def take_snapshot(self, page_id: int) -> dict[str, Any]:
        self.select_page(page_id)
        payload = self._run("take_snapshot")
        if not isinstance(payload, dict) or "snapshot" not in payload:
            raise RuntimeError(f"快照返回形状不对: {payload}")
        return payload["snapshot"]

    def fill(self, page_id: int, uid: str, value: str) -> None:
        self.select_page(page_id)
        self._run("fill", uid, value)

    def click(self, page_id: int, uid: str) -> None:
        self.select_page(page_id)
        self._run("click", uid)

    def upload_file(self, page_id: int, uid: str, file_path: Path) -> None:
        self.select_page(page_id)
        self._run("upload_file", uid, str(file_path))

    def evaluate(self, page_id: int, function_source: str, *, timeout: int = 30) -> Any:
        self.select_page(page_id)
        return self._run("evaluate_script", function_source, timeout=timeout)

    def list_network_requests(self, page_id: int, *, page_size: int = 200) -> list[dict[str, Any]]:
        self.select_page(page_id)
        payload = self._run("list_network_requests", "--pageSize", str(page_size))
        if not isinstance(payload, dict):
            raise RuntimeError(f"network 请求返回形状不对: {payload}")
        return payload.get("networkRequests", [])


def 遍历快照节点(snapshot_node: dict[str, Any]) -> Iterable[dict[str, Any]]:
    yield snapshot_node
    for child in snapshot_node.get("children", []) or []:
        yield from 遍历快照节点(child)


def 查找快照节点(
    snapshot: dict[str, Any],
    *,
    role: str | None = None,
    name: str | None = None,
) -> dict[str, Any] | None:
    for node in 遍历快照节点(snapshot):
        if role is not None and node.get("role") != role:
            continue
        if name is not None and node.get("name") != name:
            continue
        return node
    return None


def 快照包含文本(snapshot: dict[str, Any], text: str) -> bool:
    return any(text in str(node.get("name", "")) for node in 遍历快照节点(snapshot))


def 等待(
    description: str,
    check: Callable[[], Any],
    *,
    timeout_seconds: int,
    interval_seconds: float = 默认轮询间隔秒,
) -> Any:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            result = check()
            if result:
                return result
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(interval_seconds)
    if last_error:
        raise TimeoutError(f"{description} 超时，最后一次错误: {last_error}") from last_error
    raise TimeoutError(f"{description} 超时。")


def 进入房间(
    chrome: ChromeDevTools客户端,
    page: 页面句柄,
    room_code: str,
    *,
    timeout_seconds: int,
) -> None:
    snapshot = chrome.take_snapshot(page.page_id)
    if 查找快照节点(snapshot, role="textbox", name="输入消息"):
        return
    room_input = 查找快照节点(snapshot, role="textbox", name="房间短码")
    join_button = 查找快照节点(snapshot, role="button", name="进房")
    if not room_input or not join_button:
        raise RuntimeError(f"首屏没有找到进房元素: {snapshot}")
    chrome.fill(page.page_id, room_input["id"], room_code)
    chrome.click(page.page_id, join_button["id"])

    def 已进入房间() -> dict[str, Any] | None:
        next_snapshot = chrome.take_snapshot(page.page_id)
        return next_snapshot if 查找快照节点(next_snapshot, role="textbox", name="输入消息") else None

    等待("进入房间", 已进入房间, timeout_seconds=timeout_seconds)


def 上传并发送消息(
    chrome: ChromeDevTools客户端,
    page: 页面句柄,
    video_file: Path,
    message_text: str,
    *,
    timeout_seconds: int,
) -> None:
    snapshot = chrome.take_snapshot(page.page_id)
    upload_button = 查找快照节点(snapshot, role="button", name="选择图片或视频")
    input_box = 查找快照节点(snapshot, role="textbox", name="输入消息")
    if not upload_button or not input_box:
        raise RuntimeError(f"房间输入区缺少上传或发送入口: {snapshot}")

    chrome.upload_file(page.page_id, upload_button["id"], video_file)

    def 草稿可发送() -> dict[str, Any] | None:
        next_snapshot = chrome.take_snapshot(page.page_id)
        return next_snapshot if 快照包含文本(next_snapshot, "可发送") else None

    等待("附件草稿变成可发送", 草稿可发送, timeout_seconds=timeout_seconds)
    chrome.fill(page.page_id, input_box["id"], message_text)
    clicked = chrome.evaluate(
        page.page_id,
        """
() => {
  const shell = document.querySelector('koko-chat-shell');
  const button = shell?.shadowRoot?.querySelector('#shellConsolePrimaryAction');
  if (!(button instanceof HTMLButtonElement)) {
    return false;
  }
  button.click();
  return true;
}
""".strip(),
    )
    if clicked is not True:
        raise RuntimeError(f"没有找到发送按钮: {clicked}")

    def 消息已出现在时间线() -> dict[str, Any] | None:
        next_snapshot = chrome.take_snapshot(page.page_id)
        return next_snapshot if 快照包含文本(next_snapshot, message_text) else None

    等待("消息出现在时间线", 消息已出现在时间线, timeout_seconds=timeout_seconds)


def 读取页面设备令牌(chrome: ChromeDevTools客户端, page: 页面句柄) -> str:
    token = chrome.evaluate(
        page.page_id,
        "() => localStorage.getItem('koko_device_anonymous_token')",
    )
    if not isinstance(token, str) or not token:
        raise RuntimeError(f"页面未返回 device token: {token}")
    return token


def 引导匿名身份(base_url: str, device_token: str) -> dict[str, Any]:
    _, body = http_json(
        "POST",
        f"{base_url.rstrip('/')}/api/session/bootstrap",
        {"device_anonymous_token": device_token},
    )
    if not isinstance(body, dict) or "session_id" not in body:
        raise RuntimeError(f"bootstrap 返回形状不对: {body}")
    return body


def 拉取房间快照(base_url: str, session_id: str, room_code: str) -> dict[str, Any]:
    _, body = http_json(
        "POST",
        f"{base_url.rstrip('/')}/api/rooms/join-or-create",
        {"session_id": session_id, "room_code": room_code},
    )
    if not isinstance(body, dict) or "snapshot_messages" not in body:
        raise RuntimeError(f"join-or-create 返回形状不对: {body}")
    return body


def 从房间快照定位附件(
    room_snapshot: dict[str, Any],
    *,
    message_text: str,
) -> str:
    messages = room_snapshot.get("snapshot_messages")
    if not isinstance(messages, list):
        raise RuntimeError(f"房间快照缺少 snapshot_messages: {room_snapshot}")
    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        if message.get("text") != message_text and message.get("body") != message_text:
            continue
        attachments = message.get("attachments")
        if not isinstance(attachments, list) or not attachments:
            raise RuntimeError(f"目标消息没有附件: {message}")
        attachment = attachments[0]
        attachment_id = attachment.get("attachment_id")
        if isinstance(attachment_id, str) and attachment_id:
            return attachment_id
    raise RuntimeError(f"房间快照里没找到目标消息 `{message_text}`")


def 打开视频查看器(
    chrome: ChromeDevTools客户端,
    page: 页面句柄,
    attachment_id: str,
    *,
    timeout_seconds: int,
) -> None:
    click_js = f"""
() => {{
  const shell = document.querySelector('koko-chat-shell');
  const button = shell?.shadowRoot?.querySelector(
    'button.message-video-preview-trigger[data-attachment-id="{attachment_id}"]'
  );
  if (!(button instanceof HTMLButtonElement)) {{
    return false;
  }}
  button.click();
  return true;
}}
""".strip()
    clicked = chrome.evaluate(page.page_id, click_js)
    if clicked is not True:
        raise RuntimeError(f"没有找到附件 {attachment_id} 的查看器入口: {clicked}")

    def 查看器已打开() -> dict[str, Any] | None:
        snapshot = chrome.take_snapshot(page.page_id)
        return snapshot if 查找快照节点(snapshot, role="dialog", name="视频查看器") else None

    等待("视频查看器弹出", 查看器已打开, timeout_seconds=timeout_seconds)


def 等待本地缓存完整(
    chrome: ChromeDevTools客户端,
    page: 页面句柄,
    attachment_id: str,
    *,
    timeout_seconds: int,
) -> dict[str, Any]:
    read_cache_js = f"""
() => {{
  const raw = localStorage.getItem('koko_media_asset_records');
  if (!raw) {{
    return null;
  }}
  try {{
    const parsed = JSON.parse(raw);
    return parsed['{attachment_id}'] ?? null;
  }} catch {{
    return null;
  }}
}}
""".strip()

    def 已完整() -> dict[str, Any] | None:
        record = chrome.evaluate(page.page_id, read_cache_js, timeout=30)
        if isinstance(record, dict) and record.get("complete") is True:
            return record
        return None

    return 等待("浏览器 A 本地完整缓存", 已完整, timeout_seconds=timeout_seconds)


def 上报协作分发存活(base_url: str, session_id: str, attachment_id: str) -> None:
    status, _ = http_json(
        "POST",
        f"{base_url.rstrip('/')}/api/media/{attachment_id}/presence?session_id={session_id}",
        payload=None,
        expect_status=204,
    )
    if status != 204:
        raise RuntimeError(f"presence 上报失败: {status}")


def 查询定位(base_url: str, session_id: str, attachment_id: str) -> dict[str, Any]:
    _, body = http_json(
        "GET",
        f"{base_url.rstrip('/')}/api/media/{attachment_id}/locator?session_id={session_id}",
    )
    if not isinstance(body, dict):
        raise RuntimeError(f"locator 返回形状不对: {body}")
    return body


def psql_exec(repo_root: Path, psql_command: 命令入口, database_url: str, sql: str) -> str:
    result = 运行命令(
        [*psql_command.argv, "-d", database_url, "-At", "-F", "\t", "-c", sql],
        cwd=repo_root,
        timeout=30,
    )
    return result.stdout.strip()


def sql_literal(raw: str) -> str:
    return "'" + raw.replace("'", "''") + "'"


def 直接切到_peer_only(
    repo_root: Path,
    psql_command: 命令入口,
    database_url: str,
    attachment_id: str,
) -> None:
    literal = sql_literal(attachment_id)
    sql = f"""
BEGIN;
UPDATE attachment_distribution_metadata
SET web_seed_until = NOW() - INTERVAL '5 minutes'
WHERE attachment_id = {literal};

UPDATE attachment_streaming_manifests
SET streaming_expires_at = NOW() - INTERVAL '25 hours',
    streaming_deleted_at = NOW() - INTERVAL '1 minute'
WHERE attachment_id = {literal};

UPDATE attachments
SET origin_expires_at = NOW() - INTERVAL '25 hours',
    origin_deleted_at = NOW() - INTERVAL '1 minute',
    mezzanine_expires_at = NOW() - INTERVAL '25 hours',
    mezzanine_deleted_at = NOW() - INTERVAL '1 minute'
WHERE attachment_id = {literal};
COMMIT;
""".strip()
    psql_exec(repo_root, psql_command, database_url, sql)


def 等待_peer_only定位(
    base_url: str,
    session_id: str,
    attachment_id: str,
    *,
    timeout_seconds: int,
) -> dict[str, Any]:
    def locator_ready() -> dict[str, Any] | None:
        locator = 查询定位(base_url, session_id, attachment_id)
        distribution = locator.get("distribution") if isinstance(locator, dict) else None
        streaming_asset = locator.get("streaming_asset") if isinstance(locator, dict) else None
        manifest = (
            streaming_asset.get("manifest")
            if isinstance(streaming_asset, dict)
            else None
        )
        lifecycle = (
            streaming_asset.get("lifecycle")
            if isinstance(streaming_asset, dict)
            else None
        )
        if not isinstance(distribution, dict) or not isinstance(manifest, dict):
            return None
        if distribution.get("availability") != "available":
            return None
        if distribution.get("survival_mode") != "peer_only_after_expiry":
            return None
        if distribution.get("web_seed_url") is not None:
            return None
        if manifest.get("hls_master_url") is not None:
            return None
        if manifest.get("dash_mpd_url") is not None:
            return None
        if not isinstance(lifecycle, dict) or not lifecycle.get("streaming_deleted_at"):
            return None
        return locator

    return 等待("locator 切到 peer-only 语义", locator_ready, timeout_seconds=timeout_seconds)


def 断言服务端流媒体与冷源已退场(
    base_url: str,
    session_id: str,
    attachment_id: str,
) -> None:
    original_status, _ = http_bytes(
        "GET",
        f"{base_url.rstrip('/')}/api/attachments/{attachment_id}/content?session_id={session_id}&variant=original",
    )
    if original_status == 200:
        raise RuntimeError("original 冷源仍然可读，peer-only 测试不成立。")

    hls_status, _ = http_bytes(
        "GET",
        f"{base_url.rstrip('/')}/api/media/{attachment_id}/stream/hls/master.m3u8?session_id={session_id}",
    )
    if hls_status == 200:
        raise RuntimeError("HLS manifest 仍然可读，peer-only 测试不成立。")


def 等待浏览器续播成功(
    chrome: ChromeDevTools客户端,
    page: 页面句柄,
    *,
    timeout_seconds: int,
) -> dict[str, Any]:
    video_state_js = """
() => {
  const collect = (root, output) => {
    if (!root) {
      return;
    }
    const children = Array.from(root.children ?? []);
    for (const child of children) {
      output.push(child);
      if (child.shadowRoot) {
        collect(child.shadowRoot, output);
      }
      collect(child, output);
    }
  };

  const nodes = [];
  collect(document, nodes);
  const video = nodes.find((node) => node instanceof HTMLVideoElement);
  if (!(video instanceof HTMLVideoElement)) {
    return null;
  }
  return {
    currentSrc: video.currentSrc || video.src || null,
    paused: video.paused,
    readyState: video.readyState,
    currentTime: video.currentTime,
  };
}
""".strip()

    def video_ready() -> dict[str, Any] | None:
        state = chrome.evaluate(page.page_id, video_state_js, timeout=30)
        if not isinstance(state, dict):
            return None
        if not state.get("currentSrc"):
            return None
        if int(state.get("readyState", 0)) < 2:
            return None
        if float(state.get("currentTime", 0)) <= 0:
            return None
        return state

    return 等待("浏览器 B peer-only 续播", video_ready, timeout_seconds=timeout_seconds)


def 断言浏览器B没有偷回服务器媒体主链(
    chrome: ChromeDevTools客户端,
    page: 页面句柄,
    attachment_id: str,
) -> list[str]:
    bad_urls: list[str] = []
    for request in chrome.list_network_requests(page.page_id):
        url = str(request.get("url", ""))
        if not url:
            continue
        if f"/api/media/{attachment_id}/stream/hls/" in url:
            bad_urls.append(url)
        if f"/api/media/{attachment_id}/stream/dash/" in url:
            bad_urls.append(url)
        if (
            f"/api/attachments/{attachment_id}/content" in url
            and "variant=original" in url
        ):
            bad_urls.append(url)
    if bad_urls:
        raise RuntimeError(f"浏览器 B 仍然命中了服务器媒体主链: {bad_urls}")
    return bad_urls


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    args = 解析参数(repo_root)
    video_file = Path(args.video_file)

    chrome_command = 解析命令入口("chrome-devtools")
    psql_command = 解析命令入口("psql")
    断言文件存在(video_file)
    if not args.database_url:
        raise RuntimeError("DATABASE_URL 为空；请在 .env 或命令行里提供数据库连接串。")

    base_url = args.base_url.rstrip("/")
    run_id = int(time.time())
    message_text = f"peer-only smoke {run_id}"
    context_a = f"peer-only-a-{run_id}"
    context_b = f"peer-only-b-{run_id}"

    记录(f"Base URL: {base_url}")
    记录(f"房间号: {args.room_code}")
    记录(f"视频文件: {video_file}")
    记录(f"消息标记: {message_text}")

    http_json("GET", base_url, payload=None, expect_status=200)

    chrome = ChromeDevTools客户端(repo_root, chrome_command)
    pages_to_close: list[int] = []
    summary: dict[str, Any] = {
        "room_code": args.room_code,
        "video_file": str(video_file),
        "message_text": message_text,
    }

    try:
        记录("打开浏览器 A，并进入目标房间。")
        page_a = chrome.new_page(base_url, context_a)
        pages_to_close.append(page_a.page_id)
        进入房间(chrome, page_a, args.room_code, timeout_seconds=args.device_timeout)

        记录("浏览器 A 上传视频并发送带附件消息。")
        上传并发送消息(
            chrome,
            page_a,
            video_file,
            message_text,
            timeout_seconds=args.device_timeout,
        )

        记录("从浏览器 A 取回 device token，并复用官方 bootstrap 拿到同一条 session 真相。")
        device_token_a = 读取页面设备令牌(chrome, page_a)
        identity_a = 引导匿名身份(base_url, device_token_a)
        session_id_a = str(identity_a["session_id"])
        room_snapshot = 拉取房间快照(base_url, session_id_a, args.room_code)
        attachment_id = 从房间快照定位附件(room_snapshot, message_text=message_text)
        summary.update(
            {
                "device_token_a": device_token_a,
                "session_id_a": session_id_a,
                "attachment_id": attachment_id,
            }
        )

        记录("浏览器 A 打开查看器，并等待本地完整缓存成立。")
        打开视频查看器(
            chrome,
            page_a,
            attachment_id,
            timeout_seconds=args.device_timeout,
        )
        cache_record = 等待本地缓存完整(
            chrome,
            page_a,
            attachment_id,
            timeout_seconds=args.cache_timeout,
        )
        summary["cache_record_a"] = cache_record

        记录("把服务端语义切到 peer-only：退掉 web seed、manifest 和 original/mezzanine 冷源。")
        直接切到_peer_only(repo_root, psql_command, args.database_url, attachment_id)
        上报协作分发存活(base_url, session_id_a, attachment_id)
        peer_only_locator = 等待_peer_only定位(
            base_url,
            session_id_a,
            attachment_id,
            timeout_seconds=args.device_timeout,
        )
        断言服务端流媒体与冷源已退场(base_url, session_id_a, attachment_id)
        summary["peer_only_locator"] = peer_only_locator

        记录("打开浏览器 B，用隔离上下文验证它不能复用浏览器 A 的本地缓存。")
        page_b = chrome.new_page(base_url, context_b)
        pages_to_close.append(page_b.page_id)
        进入房间(chrome, page_b, args.room_code, timeout_seconds=args.device_timeout)

        记录("浏览器 B 点击同一条附件，验证只靠 peer-only swarm 继续播放。")
        打开视频查看器(
            chrome,
            page_b,
            attachment_id,
            timeout_seconds=args.device_timeout,
        )
        playback_state = 等待浏览器续播成功(
            chrome,
            page_b,
            timeout_seconds=args.peer_timeout,
        )
        断言浏览器B没有偷回服务器媒体主链(chrome, page_b, attachment_id)
        summary["playback_state_b"] = playback_state

        记录("peer-only 续播验证通过。")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    finally:
        if not args.keep_pages:
            for page_id in reversed(pages_to_close):
                try:
                    chrome.close_page(page_id)
                except Exception:  # noqa: BLE001
                    continue


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"FAILED: {exc}", file=sys.stderr)
        raise
