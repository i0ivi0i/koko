use image::{DynamicImage, ImageFormat};
use memmap2::{Mmap, MmapOptions};
use nom_exif::{MediaParser, MediaSource, TrackInfo, TrackInfoTag};
use std::{fs::File as StdFile, io::Cursor, path::Path};

/// 图片字节被权威解析后的稳定结果。
///
/// 这里故意只保留 complete 链路真正需要的事实：
/// 1. 真 MIME；
/// 2. 展示宽高；
/// 3. 缩略图字节；
/// 4. full 资产字节。
///
/// 这样房间壳只消费“已解析事实”，不再自己理解图片细节。
#[derive(Debug)]
pub(super) struct 图片内容解析结果 {
    pub(super) mime_type: String,
    pub(super) 宽: i32,
    pub(super) 高: i32,
    pub(super) 缩略图字节: Vec<u8>,
    pub(super) 完整图字节: Vec<u8>,
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

fn 读取exif方向(bytes: &[u8]) -> u32 {
    let mut cursor = Cursor::new(bytes);
    exif::Reader::new()
        .read_from_container(&mut cursor)
        .ok()
        .and_then(|reader| {
            reader
                .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .and_then(|field| field.value.get_uint(0))
        })
        .unwrap_or(1)
}

fn 应用exif方向(image: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => image.fliph(),
        3 => image.rotate180(),
        4 => image.flipv(),
        5 => image.rotate90().fliph(),
        6 => image.rotate90(),
        7 => image.rotate270().fliph(),
        8 => image.rotate270(),
        _ => image,
    }
}

fn 生成缩略图字节(image: &DynamicImage) -> Result<Vec<u8>, image::ImageError> {
    let thumbnail = image.thumbnail(512, 512);
    let mut cursor = Cursor::new(Vec::new());
    thumbnail.write_to(&mut cursor, ImageFormat::Png)?;
    Ok(cursor.into_inner())
}

fn 生成完整图字节(image: &DynamicImage) -> Result<Vec<u8>, image::ImageError> {
    // full 资产仍然是完整查看主链，但不再等同于冷源原图：
    // 它会被统一压到更适合查看器的 WebP 形态，同时给超大图一个稳定上限。
    let full = if image.width() > 2048 || image.height() > 2048 {
        image.thumbnail(2048, 2048)
    } else {
        image.clone()
    };
    let mut cursor = Cursor::new(Vec::new());
    full.write_to(&mut cursor, ImageFormat::WebP)?;
    Ok(cursor.into_inner())
}

/// 旧直传和新 complete 都必须走同一条图片解析链：
/// 1. 真 MIME 以后端探测为准；
/// 2. 宽高和缩略图以后端解码结果为准；
/// 3. 不把“文件后缀/前端 mime”冒充成权威事实。
pub(super) fn 解析图片内容(bytes: &[u8]) -> Result<图片内容解析结果, 媒体内容解析错误> {
    let Some(kind) = infer::get(bytes) else {
        return Err(媒体内容解析错误::类型不允许("只允许上传图片"));
    };
    if !kind.mime_type().starts_with("image/") {
        return Err(媒体内容解析错误::类型不允许("只允许上传图片"));
    }
    let decoded = image::load_from_memory(bytes)
        .map_err(|_| 媒体内容解析错误::类型不允许("图片内容非法"))?;
    let normalized_image = 应用exif方向(decoded, 读取exif方向(bytes));
    let 缩略图字节 = 生成缩略图字节(&normalized_image)
        .map_err(|_| 媒体内容解析错误::系统错误("生成图片缩略图失败"))?;
    let 完整图字节 = 生成完整图字节(&normalized_image)
        .map_err(|_| 媒体内容解析错误::系统错误("生成图片完整图失败"))?;
    Ok(图片内容解析结果 {
        mime_type: kind.mime_type().to_string(),
        宽: normalized_image.width() as i32,
        高: normalized_image.height() as i32,
        缩略图字节,
        完整图字节,
    })
}

/// 视频元数据探测继续复用成熟纯 Rust 轮子：
/// 1. 真 MIME 仍以后端探测为准；
/// 2. 宽高从容器元数据读取，不靠前端 file.type 或文件后缀冒充；
/// 3. 当前只收口 ready 所需的最小事实，不在后端手搓转码或截图链。
pub(super) fn 解析视频内容(bytes: &[u8]) -> Result<视频内容解析结果, 媒体内容解析错误> {
    let Some(kind) = infer::get(bytes) else {
        return Err(媒体内容解析错误::类型不允许("只允许上传视频"));
    };
    if !kind.mime_type().starts_with("video/") {
        return Err(媒体内容解析错误::类型不允许("只允许上传视频"));
    }
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
        .ok_or(媒体内容解析错误::类型不允许("视频缺少宽度元数据"))?;
    let 高 = info
        .get(TrackInfoTag::ImageHeight)
        .and_then(解析视频轨道整数)
        .filter(|value| *value > 0)
        .ok_or(媒体内容解析错误::类型不允许("视频缺少高度元数据"))?;
    let (宽, 高) = 应用mp4展示方向到视频宽高(bytes, 宽, 高);
    Ok(视频内容解析结果 {
        mime_type: kind.mime_type().to_string(),
        宽: 宽 as i32,
        高: 高 as i32,
    })
}

fn 映射只读视频文件(path: &Path) -> Result<Mmap, 媒体内容解析错误> {
    let file =
        StdFile::open(path).map_err(|_| 媒体内容解析错误::系统错误("打开视频临时文件失败"))?;
    // 安全性：complete 阶段拿到的 Rustus 临时文件已经封口，只做只读消费；
    // 这里既不修改文件，也不暴露可变别名，因此把它映射成只读字节视图是安全的。
    unsafe { MmapOptions::new().map(&file) }
        .map_err(|_| 媒体内容解析错误::系统错误("映射视频临时文件失败"))
}

/// 大视频 complete 热路径优先复用操作系统只读映射，
/// 避免先 `fs::read` 整块进内存再交给同一套解析器重复消费。
pub(super) fn 解析视频文件内容(path: &Path) -> Result<视频内容解析结果, 媒体内容解析错误> {
    let mapped = 映射只读视频文件(path)?;
    解析视频内容(mapped.as_ref())
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
        let 字节级结果 =
            解析视频内容(include_bytes!("../tests/fixtures/minimal.mp4")).expect("最小 mp4 应该能被字节级解析");
        let 文件级结果 = 解析视频文件内容(Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/minimal.mp4"
        )))
        .expect("最小 mp4 应该能被文件级解析");

        assert_eq!(文件级结果.mime_type, 字节级结果.mime_type);
        assert_eq!(文件级结果.宽, 字节级结果.宽);
        assert_eq!(文件级结果.高, 字节级结果.高);
    }
}
