use super::应用状态;
use crate::usecase;
use axum::http::StatusCode;
use object_store::{buffered::BufWriter, path::Path as ObjectPath, ObjectStore};
use serde::Deserialize;
use std::{
    path::{Path as StdPath, PathBuf},
    process::Command,
    sync::Arc,
};
use tokio::{
    fs,
    io::{AsyncWriteExt, BufReader},
    task::JoinSet,
};
use uuid::Uuid;

/// `BufWriter` 小于这个阈值会退回单次 put，大于它会自动走 multipart。
/// 这里故意选 8MiB，让 10MB+ 的视频主链和打包产物都尽早进入流式上传，而不是继续整块驻留内存。
const 附件对象流式写入缓冲字节数: usize = 8 * 1024 * 1024;
/// object_store 自带 writer 已经内建 part 并发；这里显式钉住上限，避免吞吐策略继续藏在上游默认值里。
const 附件对象流式写入最大并发: usize = 8;
/// 本地磁盘读取也走一层小缓冲，减少大文件 copy 时的 syscall 抖动。
const 附件对象流式读取缓冲字节数: usize = 1024 * 1024;
/// 打包文件、静态封面和 mezzanine 回退母本彼此独立，应该在 complete 热路径里并发上传，
/// 否则会把本可并行的 object_store 写入白白串成一条长链。
const 流媒体打包产物上传最大并发: usize = 4;

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
    高质量回退母本本地路径: PathBuf,
    文件列表: Vec<流媒体打包文件>,
}

/// 视频打包上传返回两类稳定事实：
/// 1. 正式流媒体清单写入请求；
/// 2. 与附件同锚点的静态封面与 24 小时 mezzanine 回退层存储键。
pub(super) struct 流媒体打包上传结果 {
    pub 清单写入请求: usecase::流媒体清单写入请求,
    pub 静态封面存储键: String,
    pub 回退母本存储键: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum 视频打包策略 {
    直接包装原始文件 { 有音轨: bool },
    转码后打包 { 有音轨: bool },
}

#[derive(Debug, Deserialize)]
struct Ffprobe流信息 {
    codec_type: Option<String>,
    codec_name: Option<String>,
    pix_fmt: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Ffprobe格式信息 {
    format_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Ffprobe探测结果 {
    streams: Vec<Ffprobe流信息>,
    format: Option<Ffprobe格式信息>,
}

/// 这里的上传任务只描述“哪一个本地文件写到哪个稳定键”，
/// 不承载任何业务真相，避免 complete 热路径继续散落 tuple 胶水。
struct 待上传本地资产 {
    本地路径: PathBuf,
    存储键: String,
    资产标签: &'static str,
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

/// Shell 层统一负责“本地文件 -> 附件对象存储”的 IO 搬运，
/// 这样 complete 原视频和流媒体打包产物都能复用同一套高吞吐写入策略。
pub(super) async fn 上传本地文件到附件对象存储(
    store: Arc<dyn ObjectStore>,
    local_path: &StdPath,
    storage_key: &str,
    资产标签: &'static str,
) -> Result<(), (StatusCode, &'static str, String)> {
    let local_file = fs::File::open(local_path).await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("读取{资产标签}失败: {err}"),
        )
    })?;
    let mut reader = BufReader::with_capacity(附件对象流式读取缓冲字节数, local_file);
    let mut writer = BufWriter::with_capacity(
        store,
        ObjectPath::from(storage_key),
        附件对象流式写入缓冲字节数,
    )
    .with_max_concurrency(附件对象流式写入最大并发);
    tokio::io::copy(&mut reader, &mut writer)
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("流式写入{资产标签}失败: {err}"),
            )
        })?;
    writer.shutdown().await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("提交{资产标签}失败: {err}"),
        )
    })?;
    Ok(())
}

/// 打包产物上传如果串行执行，会把 HLS/DASH 分片、静态封面和 mezzanine 的 object_store 写入
/// 变成 complete 热路径里的纯等待；这里显式限流并发上传，既缩短总耗时，也避免一次性放飞过多任务。
async fn 并发上传本地资产到附件对象存储(
    store: Arc<dyn ObjectStore>,
    待上传资产: Vec<待上传本地资产>,
) -> Result<(), (StatusCode, &'static str, String)> {
    if 待上传资产.is_empty() {
        return Ok(());
    }

    let mut uploads = JoinSet::new();
    for 资产 in 待上传资产 {
        while uploads.len() >= 流媒体打包产物上传最大并发 {
            match uploads.join_next().await {
                Some(Ok(Ok(()))) => {}
                Some(Ok(Err(err))) => {
                    uploads.abort_all();
                    return Err(err);
                }
                Some(Err(err)) => {
                    uploads.abort_all();
                    return Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        format!("流媒体并发上传任务失败: {err}"),
                    ));
                }
                None => break,
            }
        }

        let store_for_task = store.clone();
        uploads.spawn(async move {
            上传本地文件到附件对象存储(
                store_for_task,
                资产.本地路径.as_path(),
                资产.存储键.as_str(),
                资产.资产标签,
            )
            .await
        });
    }

    while let Some(result) = uploads.join_next().await {
        match result {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                uploads.abort_all();
                return Err(err);
            }
            Err(err) => {
                uploads.abort_all();
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("流媒体并发上传任务失败: {err}"),
                ));
            }
        }
    }

    Ok(())
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

fn 解析ffprobe视频打包策略(
    输入文件: &StdPath,
    stdout: &[u8],
) -> Result<视频打包策略, (StatusCode, &'static str, String)> {
    let 探测结果: Ffprobe探测结果 = serde_json::from_slice(stdout).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("解析 ffprobe 输出失败: {err}"),
        )
    })?;
    let 视频流 = 探测结果
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"))
        .ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "ffprobe 未返回视频轨道信息".to_string(),
        ))?;
    let 有音轨 = 探测结果
        .streams
        .iter()
        .any(|stream| stream.codec_type.as_deref() == Some("audio"));
    let 音轨全部可直包 = 探测结果
        .streams
        .iter()
        .filter(|stream| stream.codec_type.as_deref() == Some("audio"))
        .all(|stream| stream.codec_name.as_deref() == Some("aac"));
    let 扩展名允许直包 = 输入文件
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("mp4"));
    let ffprobe格式允许直包 = 探测结果
        .format
        .as_ref()
        .and_then(|format| format.format_name.as_deref())
        .is_some_and(|format_name| {
            format_name
                .split(',')
                .any(|name| name.trim().eq_ignore_ascii_case("mp4"))
        });
    let 可直接包装原始文件 = (ffprobe格式允许直包 || 扩展名允许直包)
        && 视频流.codec_name.as_deref() == Some("h264")
        && 视频流.pix_fmt.as_deref() == Some("yuv420p")
        && 音轨全部可直包;
    Ok(if 可直接包装原始文件 {
        视频打包策略::直接包装原始文件 { 有音轨 }
    } else {
        视频打包策略::转码后打包 { 有音轨 }
    })
}

fn ffprobe检测视频打包策略(
    ffprobe_bin: &str,
    输入文件: &StdPath,
) -> Result<视频打包策略, (StatusCode, &'static str, String)> {
    let output = Command::new(ffprobe_bin)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,pix_fmt:format=format_name",
            "-of",
            "json",
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
    解析ffprobe视频打包策略(输入文件, &output.stdout)
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

    let 静态封面文件 = workdir.join("thumbnail.png");
    let 打包策略 = ffprobe检测视频打包策略(ffprobe_bin, 输入文件)?;
    let (视频打包输入文件, 音频打包输入文件, 高质量回退母本本地路径, 有音轨) = match 打包策略
    {
        视频打包策略::直接包装原始文件 { 有音轨 } => (
            输入文件.to_path_buf(),
            有音轨.then(|| 输入文件.to_path_buf()),
            输入文件.to_path_buf(),
            有音轨,
        ),
        视频打包策略::转码后打包 { 有音轨 } => {
            let 视频轨道文件 = workdir.join("video.mp4");
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

            let 音频打包输入文件 = if 有音轨 {
                std::fs::create_dir_all(hls_audio_dir.as_path()).map_err(|err| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        format!("创建 HLS 音频目录失败: {err}"),
                    )
                })?;
                let 音频轨道文件 = workdir.join("audio.mp4");
                let mut 转码音频 = Command::new(ffmpeg_bin);
                转码音频.args(["-y", "-i"]);
                转码音频.arg(输入文件);
                转码音频.args(["-map", "0:a:0", "-c:a", "aac", "-b:a", "128k", "-vn"]);
                转码音频.arg(音频轨道文件.as_os_str());
                执行外部命令(&mut 转码音频, "FFmpeg 音频转码")?;
                Some(音频轨道文件)
            } else {
                None
            };
            (
                视频轨道文件.clone(),
                音频打包输入文件,
                视频轨道文件,
                有音轨,
            )
        }
    };

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
    if 有音轨 {
        std::fs::create_dir_all(hls_audio_dir.as_path()).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("创建 HLS 音频目录失败: {err}"),
            )
        })?;
    }

    let mut 打包命令 = Command::new(shaka_packager_bin);
    打包命令.arg(format!(
        "in={},stream=video,init_segment={},segment_template={},playlist_name={}",
        视频打包输入文件.display(),
        hls_video_dir.join("init.mp4").display(),
        hls_video_dir.join("$Number$.m4s").display(),
        hls_video_dir.join("main.m3u8").display()
    ));
    if let Some(音频打包输入文件) = 音频打包输入文件.as_ref() {
        打包命令.arg(format!(
            "in={},stream=audio,init_segment={},segment_template={},playlist_name={},hls_group_id=audio,hls_name=audio",
            音频打包输入文件.display(),
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
        高质量回退母本本地路径,
        文件列表,
    })
}

/// 打包产物上传也放在这一层，保证“本地产物 -> object_store 稳定键”的责任只有一个 owner。
pub(super) async fn 上传流媒体打包产物(
    state: &应用状态,
    attachment_id: &str,
    打包结果: 流媒体打包结果,
) -> Result<流媒体打包上传结果, (StatusCode, &'static str, String)> {
    let 静态封面存储键 = format!("videos/{attachment_id}/thumbnail.png");
    let 回退母本存储键 = format!("videos/{attachment_id}/mezzanine.mp4");
    let mut 待上传资产 = Vec::with_capacity(打包结果.文件列表.len() + 2);
    for file in &打包结果.文件列表 {
        待上传资产.push(待上传本地资产 {
            本地路径: file.本地路径.clone(),
            存储键: 推导流媒体对象存储键(attachment_id, file.相对路径.as_str()),
            资产标签: "流媒体打包产物",
        });
    }
    待上传资产.push(待上传本地资产 {
        本地路径: 打包结果.静态封面本地路径.clone(),
        存储键: 静态封面存储键.clone(),
        资产标签: "视频静态封面",
    });
    待上传资产.push(待上传本地资产 {
        本地路径: 打包结果.高质量回退母本本地路径.clone(),
        存储键: 回退母本存储键.clone(),
        资产标签: "视频 mezzanine 回退母本",
    });
    并发上传本地资产到附件对象存储(state.attachment_store.clone(), 待上传资产).await?;

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
        回退母本存储键,
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
                            let absolute = 构造流媒体受控地址(
                                attachment_id,
                                session_id,
                                resolved.as_str(),
                            );
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

#[cfg(test)]
mod tests {
    use super::{
        上传本地文件到附件对象存储, 并发上传本地资产到附件对象存储,
        生成流媒体打包产物, 解析ffprobe视频打包策略, 待上传本地资产, 视频打包策略,
    };
    use object_store::{
        memory::InMemory, path::Path as ObjectPath, throttle::ThrottleConfig,
        throttle::ThrottledStore, ObjectStore, ObjectStoreExt,
    };
    use std::{path::PathBuf, sync::Arc, time::Duration};
    use tokio::time::Instant;
    use uuid::Uuid;

    #[tokio::test]
    async fn 流式写入本地文件会保留超过缓冲阈值的原始字节() {
        let 原始字节 = vec![0x5a; 16 * 1024 * 1024 + 321];
        let 临时文件路径 =
            std::env::temp_dir().join(format!("koko-stream-upload-test-{}.bin", Uuid::new_v4()));
        std::fs::write(&临时文件路径, &原始字节).expect("应能写入测试临时文件");

        let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
        上传本地文件到附件对象存储(
            store.clone(),
            临时文件路径.as_path(),
            "tests/stream-upload.bin",
            "测试流式对象",
        )
        .await
        .expect("流式 helper 应能把本地文件写进 object_store");

        let 已写入字节 = store
            .get(&ObjectPath::from("tests/stream-upload.bin"))
            .await
            .expect("应能读取已写入对象")
            .bytes()
            .await
            .expect("应能读出对象字节");
        assert_eq!(已写入字节.as_ref(), 原始字节.as_slice());

        let _ = std::fs::remove_file(临时文件路径);
    }

    #[tokio::test]
    async fn 打包产物上传会并发执行而不是串行阻塞complete热路径() {
        let 临时目录 =
            std::env::temp_dir().join(format!("koko-stream-upload-batch-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&临时目录).expect("应能创建测试目录");

        let mut 待上传资产 = Vec::new();
        for index in 0..6 {
            let 文件路径 = 临时目录.join(format!("asset-{index}.bin"));
            std::fs::write(&文件路径, vec![index as u8; 1024]).expect("应能写入测试文件");
            待上传资产.push(待上传本地资产 {
                本地路径: 文件路径,
                存储键: format!("tests/concurrent-upload-{index}.bin"),
                资产标签: "测试打包产物",
            });
        }

        let throttled = ThrottledStore::new(
            InMemory::new(),
            ThrottleConfig {
                wait_put_per_call: Duration::from_millis(180),
                ..Default::default()
            },
        );
        let store: Arc<dyn ObjectStore> = Arc::new(throttled);
        let started_at = Instant::now();
        并发上传本地资产到附件对象存储(store.clone(), 待上传资产)
            .await
            .expect("并发上传 helper 应能把全部打包资产写进 object_store");
        let elapsed = started_at.elapsed();

        // 6 个对象若串行上传，180ms * 6 至少接近 1 秒；
        // 当前 helper 限流并发上限是 4，正常应在两个波次内完成。
        assert!(
            elapsed < Duration::from_millis(750),
            "打包产物上传不应继续串行阻塞 complete 热路径，实际耗时: {elapsed:?}"
        );

        for index in 0..6 {
            let 已写入字节 = store
                .get(&ObjectPath::from(format!("tests/concurrent-upload-{index}.bin")))
                .await
                .expect("应能读取已写入对象")
                .bytes()
                .await
                .expect("应能读出对象字节");
            assert_eq!(已写入字节.len(), 1024);
            assert!(已写入字节.iter().all(|value| *value == index as u8));
        }

        let _ = std::fs::remove_dir_all(临时目录);
    }

    #[test]
    fn ffprobe探测会把h264_aac_mp4判定为可直接包装原始文件() {
        let 输入文件 = std::path::Path::new("sample.mp4");
        let stdout = br#"{
  "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" },
  "streams": [
    { "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p" },
    { "codec_type": "audio", "codec_name": "aac" }
  ]
}"#;

        let 策略 = 解析ffprobe视频打包策略(输入文件, stdout)
            .expect("应能解析 ffprobe 探测结果");
        assert_eq!(策略, 视频打包策略::直接包装原始文件 { 有音轨: true });
    }

    #[test]
    fn ffprobe探测会把无扩展名的mp4临时文件仍判定为可直接包装原始文件() {
        let 输入文件 = std::path::Path::new("E:/tmp/tus-upload-without-extension");
        let stdout = br#"{
  "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" },
  "streams": [
    { "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p" },
    { "codec_type": "audio", "codec_name": "aac" }
  ]
}"#;

        let 策略 = 解析ffprobe视频打包策略(输入文件, stdout)
            .expect("应能解析 ffprobe 探测结果");
        assert_eq!(策略, 视频打包策略::直接包装原始文件 { 有音轨: true });
    }

    #[test]
    fn ffprobe探测会把非h264视频回落到转码链路() {
        let 输入文件 = std::path::Path::new("sample.mp4");
        let stdout = br#"{
  "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" },
  "streams": [
    { "codec_type": "video", "codec_name": "hevc", "pix_fmt": "yuv420p" },
    { "codec_type": "audio", "codec_name": "aac" }
  ]
}"#;

        let 策略 = 解析ffprobe视频打包策略(输入文件, stdout)
            .expect("应能解析 ffprobe 探测结果");
        assert_eq!(策略, 视频打包策略::转码后打包 { 有音轨: true });
    }

    #[test]
    fn 直包路径不会再触发视频和音频重转码() {
        let 临时目录 =
            std::env::temp_dir().join(format!("koko-stream-direct-pack-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&临时目录).expect("应能创建测试目录");
        // tusd 落盘的临时文件默认没有扩展名；这里用真实形态守住“无后缀也要直包”的回归。
        let 输入文件 = 临时目录.join("input");
        std::fs::write(&输入文件, b"fake mp4 bytes").expect("应能写入输入文件");

        let python = PathBuf::from(std::env::var("LOCALAPPDATA").expect("应有 LOCALAPPDATA"))
            .join("Programs")
            .join("Python")
            .join("Python314")
            .join("python.exe");
        assert!(python.exists(), "测试需要本机 python 可用");

        let ffprobe_py = 临时目录.join("fake_ffprobe.py");
        std::fs::write(
            &ffprobe_py,
            r#"import json
print(json.dumps({
  "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2"},
  "streams": [
    {"codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p"},
    {"codec_type": "audio", "codec_name": "aac"}
  ]
}))
"#,
        )
        .expect("应能写入 fake ffprobe");
        let ffprobe_cmd = 临时目录.join("ffprobe.cmd");
        std::fs::write(
            &ffprobe_cmd,
            format!(
                "@echo off\r\n\"{}\" \"%~dp0fake_ffprobe.py\" %*\r\n",
                python.display()
            ),
        )
        .expect("应能写入 ffprobe wrapper");

        let ffmpeg_py = 临时目录.join("fake_ffmpeg.py");
        std::fs::write(
            &ffmpeg_py,
            r#"import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent
with (root / "ffmpeg.log").open("a", encoding="utf-8") as handle:
    handle.write(" ".join(sys.argv[1:]) + "\n")
output_path = pathlib.Path(sys.argv[-1])
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_bytes(b"fake ffmpeg output")
"#,
        )
        .expect("应能写入 fake ffmpeg");
        let ffmpeg_cmd = 临时目录.join("ffmpeg.cmd");
        std::fs::write(
            &ffmpeg_cmd,
            format!(
                "@echo off\r\n\"{}\" \"%~dp0fake_ffmpeg.py\" %*\r\n",
                python.display()
            ),
        )
        .expect("应能写入 ffmpeg wrapper");

        let shaka_py = 临时目录.join("fake_shaka.py");
        std::fs::write(
            &shaka_py,
            r##"import pathlib
import sys

def ensure_file(path_str: str, content: bytes) -> None:
    path = pathlib.Path(path_str)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)

args = sys.argv[1:]
for index, arg in enumerate(args):
    if arg.startswith("in="):
        for piece in arg.split(","):
            if piece.startswith("init_segment="):
                ensure_file(piece.split("=", 1)[1], b"init")
            elif piece.startswith("segment_template="):
                ensure_file(piece.split("=", 1)[1].replace("$Number$", "1"), b"segment")
            elif piece.startswith("playlist_name="):
                ensure_file(piece.split("=", 1)[1], b"#EXTM3U\n")
    elif arg == "--mpd_output":
        ensure_file(args[index + 1], b"<MPD/>")
    elif arg == "--hls_master_playlist_output":
        ensure_file(args[index + 1], b"#EXTM3U\n")
"##,
        )
        .expect("应能写入 fake shaka");
        let shaka_cmd = 临时目录.join("shaka.cmd");
        std::fs::write(
            &shaka_cmd,
            format!(
                "@echo off\r\n\"{}\" \"%~dp0fake_shaka.py\" %*\r\n",
                python.display()
            ),
        )
        .expect("应能写入 shaka wrapper");

        let 结果 = 生成流媒体打包产物(
            ffmpeg_cmd.to_str().expect("ffmpeg wrapper 路径应可转字符串"),
            ffprobe_cmd.to_str().expect("ffprobe wrapper 路径应可转字符串"),
            shaka_cmd.to_str().expect("shaka wrapper 路径应可转字符串"),
            "att-direct-pack",
            输入文件.as_path(),
        )
        .expect("直包策略应能生成流媒体打包结果");

        let ffmpeg_log = std::fs::read_to_string(临时目录.join("ffmpeg.log"))
            .expect("应能读取 ffmpeg 调用日志");
        assert_eq!(
            ffmpeg_log.lines().count(),
            1,
            "可直包的 H264/AAC MP4 不应再额外触发视频/音频重转码"
        );
        assert_eq!(
            结果.高质量回退母本本地路径,
            输入文件,
            "可直包视频应直接复用原始上传文件作为 mezzanine 回退层"
        );

        let _ = std::fs::remove_dir_all(临时目录);
    }
}
