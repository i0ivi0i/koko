use memmap2::{Mmap, MmapOptions};
use nom_exif::{MediaParser, MediaSource, TrackInfo, TrackInfoTag};
use std::{fs::File as StdFile, io::Cursor, path::Path};

/// 单文件图片主链只需要校验 canonical.webp 的展示事实。
#[derive(Debug)]
pub(super) struct Canonical图片校验结果 {
    pub(super) mime_type: String,
    pub(super) 宽: i32,
    pub(super) 高: i32,
}

/// 视频字节被权威解析后的最小稳定结果。
#[derive(Debug)]
pub(super) struct 视频内容解析结果 {
    pub(super) mime_type: String,
    pub(super) 宽: i32,
    pub(super) 高: i32,
}

/// 解析失败只区分“调用方应改输入”还是“系统实现失败”。
#[derive(Debug)]
pub(super) enum 媒体内容解析错误 {
    类型不允许(&'static str),
    系统错误(&'static str),
}

/// 后端只验证客户端已经预制好的 canonical WebP。
/// 不在这里生成缩略图、完整图或长期原图派生，避免服务器重新成为图片加工 owner。
pub(super) fn 校验canonical图片内容(
    bytes: &[u8],
) -> Result<Canonical图片校验结果, 媒体内容解析错误> {
    let Some(kind) = infer::get(bytes) else {
        return Err(媒体内容解析错误::类型不允许(
            "只允许上传 canonical WebP 图片",
        ));
    };
    if kind.mime_type() != "image/webp" {
        return Err(媒体内容解析错误::类型不允许(
            "图片必须先在客户端预制成 canonical.webp",
        ));
    }
    let decoded = image::load_from_memory(bytes)
        .map_err(|_| 媒体内容解析错误::类型不允许("canonical.webp 内容非法"))?;
    Ok(Canonical图片校验结果 {
        mime_type: "image/webp".to_string(),
        宽: decoded.width() as i32,
        高: decoded.height() as i32,
    })
}

/// 视频元数据探测继续复用成熟纯 Rust 轮子：
/// 1. 真 MIME 仍以后端探测为准；
/// 2. 宽高从容器元数据读取，不靠前端 file.type 或文件后缀冒充；
/// 3. 当前只收口 ready 所需的最小事实，不在后端手搓转码或截图链。
pub(super) fn 解析视频内容(
    bytes: &[u8],
) -> Result<视频内容解析结果, 媒体内容解析错误> {
    let Some(kind) = infer::get(bytes) else {
        return Err(媒体内容解析错误::类型不允许("只允许上传视频"));
    };
    if !kind.mime_type().starts_with("video/") {
        return Err(媒体内容解析错误::类型不允许("只允许上传视频"));
    }
    // 主路径继续优先复用 `nom-exif`：
    // - 统一沿用现有解析能力；
    // - 保持类型判断与元数据提取语义不漂移。
    //
    // 但线上存在 `iso5` 等 brand 的 BMFF 输入会触发 `nom-exif` 源构建失败。
    // 这类失败不是业务系统错误，而是解析器能力边界；此处必须做容器级降级，
    // 避免把可播放视频误报成 500。
    let (宽, 高) = match 尝试用nom_exif解析视频宽高(bytes) {
        Ok(size) => size,
        Err(err) => match 尝试用mp4头解析视频宽高(bytes) {
            Some(size) => size,
            None => {
                return Err(match err {
                    // 解析器吃不下输入时统一回落到“输入非法”语义，
                    // complete 阶段应返回 4xx，而不是把用户输入问题扩散成 5xx。
                    媒体内容解析错误::系统错误(_) => 媒体内容解析错误::类型不允许("视频内容非法"),
                    other => other,
                })
            }
        },
    };
    let (宽, 高) = 应用mp4展示方向到视频宽高(bytes, 宽, 高);
    Ok(视频内容解析结果 {
        mime_type: kind.mime_type().to_string(),
        宽: 宽 as i32,
        高: 高 as i32,
    })
}

fn 尝试用nom_exif解析视频宽高(bytes: &[u8]) -> Result<(u64, u64), 媒体内容解析错误> {
    let mut parser = MediaParser::new();
    let media_source = MediaSource::seekable(Cursor::new(bytes))
        .map_err(|_| 媒体内容解析错误::系统错误("构建视频元数据数据源失败"))?;
    if !media_source.has_track() {
        return Err(媒体内容解析错误::类型不允许("视频内容非法"));
    }
    let info: TrackInfo = parser
        .parse(media_source)
        .map_err(|_| 媒体内容解析错误::类型不允许("视频内容非法"))?;
    let 宽 = info
        .get(TrackInfoTag::ImageWidth)
        .and_then(解析视频轨道整数)
        .filter(|value| *value > 0)
        .ok_or(媒体内容解析错误::类型不允许(
            "视频缺少宽度元数据",
        ))?;
    let 高 = info
        .get(TrackInfoTag::ImageHeight)
        .and_then(解析视频轨道整数)
        .filter(|value| *value > 0)
        .ok_or(媒体内容解析错误::类型不允许(
            "视频缺少高度元数据",
        ))?;
    Ok((宽, 高))
}

fn 尝试用mp4头解析视频宽高(bytes: &[u8]) -> Option<(u64, u64)> {
    let mut reader = Cursor::new(bytes);
    let mp4 = mp4::Mp4Reader::read_header(&mut reader, bytes.len() as u64).ok()?;
    mp4.tracks().values().find_map(|track| {
        if !matches!(track.track_type(), Ok(mp4::TrackType::Video)) {
            return None;
        }
        let 宽 = u64::from(track.width());
        let 高 = u64::from(track.height());
        if 宽 > 0 && 高 > 0 {
            Some((宽, 高))
        } else {
            None
        }
    })
}

fn 映射只读视频文件(path: &Path) -> Result<Mmap, 媒体内容解析错误> {
    let file = StdFile::open(path)
        .map_err(|_| 媒体内容解析错误::系统错误("打开视频临时文件失败"))?;
    // 安全性：complete 阶段拿到的 Tus 临时文件已经封口，只做只读消费；
    // 这里既不修改文件，也不暴露可变别名，因此把它映射成只读字节视图是安全的。
    unsafe { MmapOptions::new().map(&file) }
        .map_err(|_| 媒体内容解析错误::系统错误("映射视频临时文件失败"))
}

/// 大视频 complete 热路径优先复用操作系统只读映射，
/// 避免先 `fs::read` 整块进内存再交给同一套解析器重复消费。
pub(super) fn 解析视频文件内容(
    path: &Path,
) -> Result<视频内容解析结果, 媒体内容解析错误> {
    let mapped = 映射只读视频文件(path)?;
    解析视频内容(mapped.as_ref())
}

/// 单文件视频主链只接收客户端已经预制好的 canonical.mp4。
/// 后端继续负责轻量探测和拒绝非法输入，但不再做 faststart、remux、转码或 HLS/DASH 打包补偿。
pub(super) fn 校验canonical视频文件内容(
    path: &Path,
) -> Result<视频内容解析结果, 媒体内容解析错误> {
    let parsed = 解析视频文件内容(path)?;
    if parsed.mime_type != "video/mp4" {
        return Err(媒体内容解析错误::类型不允许(
            "视频必须先在客户端预制成 canonical.mp4",
        ));
    }
    Ok(parsed)
}

fn 解析视频轨道整数(value: &nom_exif::EntryValue) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_u32().map(u64::from))
        .or_else(|| value.as_u16().map(u64::from))
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<u64>().ok()))
}

fn 应用mp4展示方向到视频宽高(bytes: &[u8], 宽: u64, 高: u64) -> (u64, u64) {
    if !mp4视频轨道矩阵需要交换宽高(bytes) {
        return (宽, 高);
    }
    (高, 宽)
}

/// 手机竖拍 MP4 常把编码宽高写成横屏，再用 tkhd 矩阵声明展示方向。
/// `nom-exif` 负责主元数据解析，这里只补齐它尚未暴露的展示矩阵，不另造视频解析核心。
fn mp4视频轨道矩阵需要交换宽高(bytes: &[u8]) -> bool {
    let mut reader = Cursor::new(bytes);
    let Ok(mp4) = mp4::Mp4Reader::read_header(&mut reader, bytes.len() as u64) else {
        return false;
    };
    mp4.tracks().values().any(|track| {
        matches!(track.track_type(), Ok(mp4::TrackType::Video)) && {
            let matrix = &track.trak.tkhd.matrix;
            mp4矩阵表示直角竖屏旋转(matrix.a, matrix.b, matrix.c, matrix.d)
        }
    })
}

fn mp4矩阵表示直角竖屏旋转(a: i32, b: i32, c: i32, d: i32) -> bool {
    const MP4矩阵_一: i32 = 0x0001_0000;
    a == 0
        && d == 0
        && ((b == MP4矩阵_一 && c == -MP4矩阵_一) || (b == -MP4矩阵_一 && c == MP4矩阵_一))
}

#[cfg(test)]
mod tests {
    use super::{解析视频内容, 解析视频文件内容};
    use std::path::Path;

    #[test]
    fn 文件级视频解析会保持与字节级解析相同的展示尺寸() {
        let 字节级结果 = 解析视频内容(include_bytes!("../tests/fixtures/minimal.mp4"))
            .expect("最小 mp4 应该能被字节级解析");
        let 文件级结果 = 解析视频文件内容(Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/minimal.mp4"
        )))
        .expect("最小 mp4 应该能被文件级解析");

        assert_eq!(文件级结果.mime_type, 字节级结果.mime_type);
        assert_eq!(文件级结果.宽, 字节级结果.宽);
        assert_eq!(文件级结果.高, 字节级结果.高);
    }

    #[test]
    fn iso5_brand_mp4仍应被解析为合法视频元数据() {
        let mut iso5字节 = include_bytes!("../tests/fixtures/minimal.mp4").to_vec();
        iso5字节[8..12].copy_from_slice(b"iso5");

        let 结果 = 解析视频内容(&iso5字节);
        assert!(
            结果.is_ok(),
            "major brand=iso5 的 mp4 属于协议内合法容器，解析不应再误判为系统错误: {结果:?}"
        );
    }
}
