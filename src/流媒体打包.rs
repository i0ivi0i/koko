use super::应用状态;
use crate::usecase;
use axum::http::StatusCode;
use object_store::{path::Path as ObjectPath, ObjectStoreExt};
use std::{
    path::{Path as StdPath, PathBuf},
    process::Command,
};
use tokio::fs;
use uuid::Uuid;

/// 打包阶段先把本地产物清单和最终入库键分开：
/// 1. 本地产物路径只活在当前 complete 调度里；
/// 2. object_store 存储键才是后续 locator/stream 路由共享的稳定真相。
struct 流媒体打包文件 {
    相对路径: String,
    本地路径: PathBuf,
}

/// `complete` 只关心打包完产生了哪些文件，以及主清单相对路径是什么。
pub(super) struct 流媒体打包结果 {
    hls主清单相对路径: String,
    dash主清单相对路径: String,
    静态封面本地路径: PathBuf,
    文件列表: Vec<流媒体打包文件>,
}

/// 视频打包上传返回两类稳定事实：
/// 1. 正式流媒体清单写入请求；
/// 2. 与附件同锚点的静态封面存储键。
pub(super) struct 流媒体打包上传结果 {
    pub 清单写入请求: usecase::流媒体清单写入请求,
    pub 静态封面存储键: String,
}

/// 受控流媒体地址是浏览器唯一允许看到的正式播放入口。
pub(super) fn 构造流媒体受控地址(
    attachment_id: &str,
    session_id: &str,
    asset_path: &str,
) -> String {
    format!("/api/media/{attachment_id}/stream/{asset_path}?session_id={session_id}")
}

pub(super) fn 推导流媒体对象前缀(attachment_id: &str) -> String {
    format!("streams/{attachment_id}/")
}

pub(super) fn 流媒体存储键转受控路径<'a>(
    attachment_id: &str,
    storage_key: &'a str,
) -> &'a str {
    storage_key
        .strip_prefix(推导流媒体对象前缀(attachment_id).as_str())
        .unwrap_or(storage_key)
}

pub(super) fn 推导流媒体对象存储键(attachment_id: &str, asset_path: &str) -> String {
    format!("streams/{attachment_id}/{asset_path}")
}

pub(super) fn 推导流媒体内容类型(asset_path: &str) -> &'static str {
    match StdPath::new(asset_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
    {
        "m3u8" => "application/vnd.apple.mpegurl",
        "mpd" => "application/dash+xml",
        "m4s" => "video/iso.segment",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn 执行外部命令(
    command: &mut Command,
    step: &str,
) -> Result<(), (StatusCode, &'static str, String)> {
    let output = command.output().map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("{step} 启动失败: {err}"),
        )
    })?;
    if output.status.success() {
        return Ok(());
    }
    Err((
        StatusCode::INTERNAL_SERVER_ERROR,
        "system_error",
        format!(
            "{step} 失败: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout).trim(),
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    ))
}

fn ffprobe检测首音轨是否存在(
    ffprobe_bin: &str,
    输入文件: &StdPath,
) -> Result<bool, (StatusCode, &'static str, String)> {
    let output = Command::new(ffprobe_bin)
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
        ])
        .arg(输入文件)
        .output()
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("ffprobe 启动失败: {err}"),
            )
        })?;
    if !output.status.success() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!(
                "ffprobe 失败: stdout={} stderr={}",
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }
    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

fn 收集目录文件(
    root: &StdPath,
    prefix: &str,
    files: &mut Vec<流媒体打包文件>,
) -> Result<(), (StatusCode, &'static str, String)> {
    let entries = std::fs::read_dir(root).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("读取打包产物目录失败: {err}"),
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("遍历打包产物目录失败: {err}"),
            )
        })?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if path.is_dir() {
            收集目录文件(path.as_path(), relative.as_str(), files)?;
        } else {
            files.push(流媒体打包文件 {
                相对路径: relative,
                本地路径: path,
            });
        }
    }
    Ok(())
}

/// 这里继续复用 ffmpeg / ffprobe / shaka-packager 三个成熟轮子；
/// 模块自己只负责组织输入输出，不再让房间壳知道打包细节。
pub(super) fn 生成流媒体打包产物(
    ffmpeg_bin: &str,
    ffprobe_bin: &str,
    shaka_packager_bin: &str,
    attachment_id: &str,
    输入文件: &StdPath,
) -> Result<流媒体打包结果, (StatusCode, &'static str, String)> {
    let workdir =
        std::env::temp_dir().join(format!("koko-stream-{attachment_id}-{}", Uuid::new_v4()));
    std::fs::create_dir_all(workdir.as_path()).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("创建流媒体打包工作目录失败: {err}"),
        )
    })?;
    let hls_video_dir = workdir.join("hls").join("video");
    let hls_audio_dir = workdir.join("hls").join("audio");
    let dash_dir = workdir.join("dash");
    std::fs::create_dir_all(hls_video_dir.as_path()).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("创建 HLS 视频目录失败: {err}"),
        )
    })?;
    std::fs::create_dir_all(dash_dir.as_path()).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("创建 DASH 目录失败: {err}"),
        )
    })?;

    let 视频轨道文件 = workdir.join("video.mp4");
    let 静态封面文件 = workdir.join("thumbnail.png");
    let mut 转码视频 = Command::new(ffmpeg_bin);
    转码视频.args(["-y", "-i"]);
    转码视频.arg(输入文件);
    转码视频.args([
        "-map",
        "0:v:0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-g",
        "48",
        "-keyint_min",
        "48",
        "-sc_threshold",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-an",
    ]);
    转码视频.arg(视频轨道文件.as_os_str());
    执行外部命令(&mut 转码视频, "FFmpeg 视频转码")?;

    let mut 抽帧命令 = Command::new(ffmpeg_bin);
    抽帧命令.args(["-y", "-ss", "1", "-i"]);
    抽帧命令.arg(输入文件);
    抽帧命令.args([
        "-frames:v",
        "1",
        "-vf",
        "scale=512:-2:force_original_aspect_ratio=decrease",
    ]);
    抽帧命令.arg(静态封面文件.as_os_str());
    执行外部命令(&mut 抽帧命令, "FFmpeg 抽取视频静态封面")?;

    let 有音轨 = ffprobe检测首音轨是否存在(ffprobe_bin, 输入文件)?;
    let 音频轨道文件 = workdir.join("audio.mp4");
    if 有音轨 {
        std::fs::create_dir_all(hls_audio_dir.as_path()).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("创建 HLS 音频目录失败: {err}"),
            )
        })?;
        let mut 转码音频 = Command::new(ffmpeg_bin);
        转码音频.args(["-y", "-i"]);
        转码音频.arg(输入文件);
        转码音频.args(["-map", "0:a:0", "-c:a", "aac", "-b:a", "128k", "-vn"]);
        转码音频.arg(音频轨道文件.as_os_str());
        执行外部命令(&mut 转码音频, "FFmpeg 音频转码")?;
    }

    let mut 打包命令 = Command::new(shaka_packager_bin);
    打包命令.arg(format!(
        "in={},stream=video,init_segment={},segment_template={},playlist_name={}",
        视频轨道文件.display(),
        hls_video_dir.join("init.mp4").display(),
        hls_video_dir.join("$Number$.m4s").display(),
        hls_video_dir.join("main.m3u8").display()
    ));
    if 有音轨 {
        打包命令.arg(format!(
            "in={},stream=audio,init_segment={},segment_template={},playlist_name={},hls_group_id=audio,hls_name=audio",
            音频轨道文件.display(),
            hls_audio_dir.join("init.mp4").display(),
            hls_audio_dir.join("$Number$.m4s").display(),
            hls_audio_dir.join("main.m3u8").display()
        ));
    }
    打包命令.arg("--mpd_output");
    打包命令.arg(dash_dir.join("stream.mpd").as_os_str());
    打包命令.arg("--hls_master_playlist_output");
    打包命令.arg(workdir.join("hls").join("master.m3u8").as_os_str());
    执行外部命令(&mut 打包命令, "Shaka Packager 打包")?;

    let mut 文件列表 = Vec::new();
    收集目录文件(workdir.join("hls").as_path(), "hls", &mut 文件列表)?;
    收集目录文件(workdir.join("dash").as_path(), "dash", &mut 文件列表)?;
    Ok(流媒体打包结果 {
        hls主清单相对路径: "hls/master.m3u8".to_string(),
        dash主清单相对路径: "dash/stream.mpd".to_string(),
        静态封面本地路径: 静态封面文件,
        文件列表,
    })
}

/// 打包产物上传也放在这一层，保证“本地产物 -> object_store 稳定键”的责任只有一个 owner。
pub(super) async fn 上传流媒体打包产物(
    state: &应用状态,
    attachment_id: &str,
    打包结果: 流媒体打包结果,
) -> Result<流媒体打包上传结果, (StatusCode, &'static str, String)> {
    for file in &打包结果.文件列表 {
        let storage_key = 推导流媒体对象存储键(attachment_id, file.相对路径.as_str());
        let bytes = fs::read(file.本地路径.as_path()).await.map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("读取流媒体打包产物失败: {err}"),
            )
        })?;
        state
            .attachment_store
            .put(&ObjectPath::from(storage_key), bytes.into())
            .await
            .map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("写入流媒体打包产物失败: {err}"),
                )
            })?;
    }

    let 静态封面存储键 = format!("videos/{attachment_id}/thumbnail.png");
    let 静态封面字节 = fs::read(打包结果.静态封面本地路径.as_path())
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("读取视频静态封面失败: {err}"),
            )
        })?;
    state
        .attachment_store
        .put(&ObjectPath::from(静态封面存储键.as_str()), 静态封面字节.into())
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("写入视频静态封面失败: {err}"),
            )
        })?;

    Ok(流媒体打包上传结果 {
        清单写入请求: usecase::流媒体清单写入请求 {
            附件标识: attachment_id.to_string(),
            hls主清单存储键: 推导流媒体对象存储键(
                attachment_id,
                打包结果.hls主清单相对路径.as_str(),
            ),
            dash主清单存储键: 推导流媒体对象存储键(
                attachment_id,
                打包结果.dash主清单相对路径.as_str(),
            ),
        },
        静态封面存储键,
    })
}

fn 解析流媒体相对路径(base_asset_path: &str, referenced_path: &str) -> String {
    if referenced_path.starts_with("http://") || referenced_path.starts_with("https://") {
        return referenced_path.to_string();
    }
    let mut parts = base_asset_path
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if !parts.is_empty() {
        parts.pop();
    }
    for part in referenced_path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part.to_string()),
        }
    }
    parts.join("/")
}

pub(super) fn 重写_hls清单内容(
    attachment_id: &str,
    session_id: &str,
    asset_path: &str,
    content: &str,
) -> String {
    content
        .lines()
        .map(|line| {
            if let Some(prefix) = line.split("URI=\"").next() {
                if prefix.len() != line.len() {
                    let mut rewritten = line.to_string();
                    if let Some(start) = line.find("URI=\"") {
                        let value_start = start + 5;
                        if let Some(end_rel) = line[value_start..].find('"') {
                            let value_end = value_start + end_rel;
                            let raw = &line[value_start..value_end];
                            let resolved = 解析流媒体相对路径(asset_path, raw);
                            let absolute =
                                构造流媒体受控地址(attachment_id, session_id, resolved.as_str());
                            rewritten.replace_range(value_start..value_end, absolute.as_str());
                            return rewritten;
                        }
                    }
                }
            }
            if line.starts_with('#') || line.trim().is_empty() {
                return line.to_string();
            }
            let resolved = 解析流媒体相对路径(asset_path, line.trim());
            构造流媒体受控地址(attachment_id, session_id, resolved.as_str())
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn 重写_xml属性路径(
    content: String,
    attribute_name: &str,
    attachment_id: &str,
    session_id: &str,
    asset_path: &str,
) -> String {
    let needle = format!(r#"{attribute_name}=""#);
    let mut current = content;
    let mut search_from = 0;
    while let Some(start_rel) = current[search_from..].find(needle.as_str()) {
        let start = search_from + start_rel;
        let value_start = start + needle.len();
        let Some(end_rel) = current[value_start..].find('"') else {
            break;
        };
        let value_end = value_start + end_rel;
        let raw = current[value_start..value_end].to_string();
        let resolved = 解析流媒体相对路径(asset_path, raw.as_str());
        let absolute = 构造流媒体受控地址(attachment_id, session_id, resolved.as_str());
        current.replace_range(value_start..value_end, absolute.as_str());
        // 必须把扫描游标推进到本次替换之后；
        // 否则下一轮又会命中同一个属性，MPD 重写会在原地自旋。
        search_from = value_start + absolute.len();
    }
    current
}

pub(super) fn 重写_dash清单内容(
    attachment_id: &str,
    session_id: &str,
    asset_path: &str,
    content: &str,
) -> String {
    let rewritten = 重写_xml属性路径(
        content.to_string(),
        "initialization",
        attachment_id,
        session_id,
        asset_path,
    );
    重写_xml属性路径(rewritten, "media", attachment_id, session_id, asset_path)
}
