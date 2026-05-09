//! koko-torrent-core — 纯确定性 torrent 元信息生成器
//!
//! 本 crate 的唯一职责：给定文件字节，生成与 `bip_metainfo` 完全一致的 `.torrent` 信息。
//! 设计约束：
//! - **零 IO / 零线程 / 零文件系统** —— 可编译到 `wasm32-unknown-unknown`
//! - **纯函数** —— 同一输入永远产出同一 `info_hash`
//! - **后端 + WASM 前端共享** —— 消除跨端 torrent 不一致风险
//!
//! # 架构层级
//! 本 crate 属于 **基础设施/共享语义** 层，不含业务逻辑。
//! domain/application 不应直接依赖本 crate；
//! adapter 层负责在需要时调用本 crate 并将结果投影到业务模型。

#![allow(non_snake_case)]

use sha1::Sha1;
use sha2::{Digest, Sha256};

// ============================================================================
// 常量：精确复制自 bip_metainfo 0.12 源码 builder/mod.rs
// ============================================================================

/// SHA-1 摘要长度（20 字节），BitTorrent piece hash 固定使用 SHA-1。
const SHA1_HASH_LEN: usize = 20;

/// OptBalanced 模式的全局最大 piece length（16 MiB）。
/// 超过此值一律钳位，避免单块过大导致校验粒度过粗。
const ALL_OPT_MAX_PIECE_LENGTH: usize = 16 * 1024 * 1024;

/// OptBalanced 模式的最大 pieces 字段字节数（40000 字节 ÷ 20 = 2000 块）。
/// pieces 字段是所有 piece SHA-1 的拼接，每 20 字节一块。
const BALANCED_MAX_PIECES_SIZE: usize = 40_000;

/// OptBalanced 模式的最小 piece length（512 KiB）。
/// 文件太小时钳位到此值，避免 piece 数量爆炸。
const BALANCED_MIN_PIECE_LENGTH: usize = 512 * 1024;

// ============================================================================
// 公开接口
// ============================================================================

/// torrent 生成结果，包含完整 `.torrent` 文件字节和元信息摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TorrentResult {
    /// 完整的 `.torrent` 文件字节（bencode 编码的根字典）
    pub torrent_bytes: Vec<u8>,
    /// info 字典的 SHA-1 摘要（40 位十六进制小写字符串）
    pub torrent_info_hash: String,
    /// 实际使用的 piece 长度（字节）
    pub piece_length_bytes: usize,
}

/// 计算文件字节的 SHA-256 内容哈希（十六进制小写字符串）。
///
/// 这是协作分发的内容寻址标识：
/// - 同内容 → 同哈希 → 可去重 / 可跨房复用
/// - torrent 内文件名固定格式 `content-{hash}{ext}`
pub fn 生成内容哈希(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

/// 计算 OptBalanced 模式的 piece length（字节）。
///
/// 算法完全复制自 `bip_metainfo::PieceLength::OptBalanced`：
/// 1. 目标块数 = `BALANCED_MAX_PIECES_SIZE / SHA1_HASH_LEN` = 2000
/// 2. 原始块长 = `⌈file_size / 目标块数⌉`（带 +0.5 取整）
/// 3. 对齐到 2 的幂次（`next_power_of_two`）
/// 4. 钳位到 `[BALANCED_MIN_PIECE_LENGTH, ALL_OPT_MAX_PIECE_LENGTH]`
pub fn 计算OptBalanced分块长度(total_file_size: u64) -> usize {
    let num_pieces = (BALANCED_MAX_PIECES_SIZE as f64) / (SHA1_HASH_LEN as f64);
    let piece_length = ((total_file_size as f64) / num_pieces + 0.5) as usize;
    let pot_piece_length = piece_length.next_power_of_two();
    match (
        pot_piece_length > BALANCED_MIN_PIECE_LENGTH,
        pot_piece_length < ALL_OPT_MAX_PIECE_LENGTH,
    ) {
        (true, true) => pot_piece_length,
        (false, _) => BALANCED_MIN_PIECE_LENGTH,
        (_, false) => ALL_OPT_MAX_PIECE_LENGTH,
    }
}

/// 生成完整的 `.torrent` 文件，包括 bencode 编码的根字典和 info_hash。
///
/// 参数：
/// - `content_hash`：文件的 SHA-256 十六进制字符串（由 `生成内容哈希` 产出）
/// - `extension`：文件扩展名（含前导点，如 `".mp4"`）
/// - `bytes`：文件的完整字节切片
///
/// 返回值与后端 `bip_metainfo` 生成的 torrent 具有相同的 `info_hash`，
/// 保证前后端 swarm 身份一致。
pub fn 生成torrent(
    content_hash: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<TorrentResult, String> {
    // torrent 内的文件名格式与后端保持一致
    let file_name = format!("content-{content_hash}{extension}");
    let piece_length = 计算OptBalanced分块长度(bytes.len() as u64);

    // 逐块计算 SHA-1 piece hash（BEP-3 协议要求）
    let mut pieces_concat: Vec<u8> = Vec::new();
    if bytes.is_empty() {
        // 空文件仍需一个 piece hash（SHA-1 of empty）
        let hash = Sha1::digest(b"");
        pieces_concat.extend_from_slice(&hash);
    } else {
        for chunk in bytes.chunks(piece_length) {
            let hash = Sha1::digest(chunk);
            pieces_concat.extend_from_slice(&hash);
        }
    }

    // 构造 info 字典（bencode 要求字典键按字节序排列）
    //
    // 注意：后端 `MetainfoBuilder::new().set_private_flag(Some(true))` 实际上
    // 由于 bip_metainfo 0.12 的 and_then/or_else 链路 bug，private 标志
    // 在新建 builder 上会被静默丢弃（insert 返回 None → and_then 传播 None
    // → or_else 触发 remove）。为保证 info_hash 一致，这里同样不写入 private。
    // 后续如需真正启用 private flag，需要前后端同步变更。
    let info_bytes = bencode_dict(&mut [
        (b"length" as &[u8], bencode_int(bytes.len() as i64)),
        (b"name", bencode_byte_string(file_name.as_bytes())),
        (b"piece length", bencode_int(piece_length as i64)),
        (b"pieces", bencode_byte_string(&pieces_concat)),
    ]);

    // info_hash = SHA-1(bencoded info dict)，是 BitTorrent swarm 的唯一身份
    let info_hash = hex::encode(Sha1::digest(&info_bytes));

    // 构造根字典（只包含 info 键，与后端 MetainfoBuilder::new() 无额外字段一致）
    let torrent_bytes = bencode_dict(&mut [(b"info" as &[u8], info_bytes)]);

    Ok(TorrentResult {
        torrent_bytes,
        torrent_info_hash: info_hash,
        piece_length_bytes: piece_length,
    })
}

// ============================================================================
// Bencode 最小编码器（仅支持 integer / byte string / dictionary）
// ============================================================================

/// bencode 整数编码：`i{value}e`
fn bencode_int(value: i64) -> Vec<u8> {
    format!("i{value}e").into_bytes()
}

/// bencode 字节串编码：`{length}:{bytes}`
fn bencode_byte_string(bytes: &[u8]) -> Vec<u8> {
    let mut result = format!("{}:", bytes.len()).into_bytes();
    result.extend_from_slice(bytes);
    result
}

/// bencode 字典编码：`d{sorted key-value pairs}e`
///
/// BEP-3 规范要求字典键必须按字节序（lexicographic order）排列。
/// 本函数会原地排序 entries，确保输出符合规范。
fn bencode_dict(entries: &mut [(&[u8], Vec<u8>)]) -> Vec<u8> {
    entries.sort_by(|a, b| a.0.cmp(b.0));
    let mut result = vec![b'd'];
    for (key, value) in entries.iter() {
        result.extend_from_slice(&bencode_byte_string(key));
        result.extend_from_slice(value);
    }
    result.push(b'e');
    result
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- 内容哈希 ----

    #[test]
    fn content_hash_输出为64位十六进制() {
        let hash = 生成内容哈希(b"koko-valid-media");
        assert_eq!(hash.len(), 64, "SHA-256 hex 应为 64 字符");
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn content_hash_确定性() {
        let bytes = b"hello-world-test";
        assert_eq!(生成内容哈希(bytes), 生成内容哈希(bytes));
    }

    #[test]
    fn content_hash_不同输入不同输出() {
        assert_ne!(生成内容哈希(b"aaa"), 生成内容哈希(b"bbb"));
    }

    // ---- 分块长度 ----

    #[test]
    fn piece_length_小文件钳位到最小值() {
        // 1 KB → (1024/2000 + 0.5) = 1 → next_pow2 = 1 → < 512KiB → 钳位
        assert_eq!(计算OptBalanced分块长度(1024), 512 * 1024);
    }

    #[test]
    fn piece_length_1mb_钳位到最小值() {
        // 1 MB → (1048576/2000 + 0.5) = 524 → next_pow2 = 1024 → < 512KiB → 钳位
        assert_eq!(计算OptBalanced分块长度(1_048_576), 512 * 1024);
    }

    #[test]
    fn piece_length_50mb_钳位到最小值() {
        // 50 MB → (52428800/2000 + 0.5) = 26214 → next_pow2 = 32768 → < 512KiB → 钳位
        assert_eq!(计算OptBalanced分块长度(52_428_800), 512 * 1024);
    }

    #[test]
    fn piece_length_200mb_钳位到最小值() {
        // 200 MB → (209715200/2000 + 0.5) = 104857 → next_pow2 = 131072 → < 512KiB → 钳位
        assert_eq!(计算OptBalanced分块长度(209_715_200), 512 * 1024);
    }

    #[test]
    fn piece_length_2gb_正常计算() {
        // 2 GB → (2147483648/2000 + 0.5) = 1073741 → next_pow2 = 2097152 (2 MiB)
        // 2 MiB > 512 KiB && < 16 MiB → 使用计算值
        assert_eq!(计算OptBalanced分块长度(2_147_483_648), 2 * 1024 * 1024);
    }

    #[test]
    fn piece_length_超大文件钳位到最大值() {
        // 64 GB → (68719476736/2000 + 0.5) = 34359738 → next_pow2 = 67108864 (64 MiB)
        // 64 MiB > 16 MiB → 钳位到最大值
        assert_eq!(计算OptBalanced分块长度(68_719_476_736), 16 * 1024 * 1024);
    }

    // ---- bencode 编码器 ----

    #[test]
    fn bencode_int_编码正确() {
        assert_eq!(bencode_int(42), b"i42e");
        assert_eq!(bencode_int(0), b"i0e");
        assert_eq!(bencode_int(-1), b"i-1e");
    }

    #[test]
    fn bencode_byte_string_编码正确() {
        assert_eq!(bencode_byte_string(b"hello"), b"5:hello");
        assert_eq!(bencode_byte_string(b""), b"0:");
    }

    #[test]
    fn bencode_dict_按键排序() {
        let mut entries: Vec<(&[u8], Vec<u8>)> =
            vec![(b"z", bencode_int(2)), (b"a", bencode_int(1))];
        let encoded = bencode_dict(&mut entries);
        assert_eq!(encoded, b"d1:ai1e1:zi2ee");
    }

    // ---- torrent 生成 ----

    #[test]
    fn torrent_生成有效结果() {
        let bytes = b"koko-valid-media";
        let hash = 生成内容哈希(bytes);
        let result = 生成torrent(&hash, ".mp4", bytes).expect("应成功生成");
        assert!(!result.torrent_bytes.is_empty());
        assert_eq!(result.torrent_info_hash.len(), 40, "info_hash 应为 40 位 hex");
        assert!(result.torrent_info_hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(result.piece_length_bytes > 0);
    }

    #[test]
    fn torrent_确定性() {
        let bytes = b"deterministic-test-payload-1234567890";
        let hash = 生成内容哈希(bytes);
        let a = 生成torrent(&hash, ".mp4", bytes).unwrap();
        let b = 生成torrent(&hash, ".mp4", bytes).unwrap();
        assert_eq!(a.torrent_bytes, b.torrent_bytes);
        assert_eq!(a.torrent_info_hash, b.torrent_info_hash);
    }

    #[test]
    fn torrent_不同内容不同哈希() {
        let a = 生成torrent(&生成内容哈希(b"aaa"), ".mp4", b"aaa").unwrap();
        let b = 生成torrent(&生成内容哈希(b"bbb"), ".mp4", b"bbb").unwrap();
        assert_ne!(a.torrent_info_hash, b.torrent_info_hash);
    }

    #[test]
    fn torrent_包含必需bencode键() {
        let bytes = b"test-media-content";
        let hash = 生成内容哈希(bytes);
        let result = 生成torrent(&hash, ".mp4", bytes).unwrap();
        let s = String::from_utf8_lossy(&result.torrent_bytes);
        assert!(s.contains("4:info"), "应包含 info 键");
        assert!(s.contains("6:length"), "应包含 length 键");
        assert!(s.contains("4:name"), "应包含 name 键");
        assert!(s.contains("12:piece length"), "应包含 piece length 键");
        assert!(s.contains("6:pieces"), "应包含 pieces 键");
        // 注意：private 键因 bip_metainfo 0.12 bug 不包含，见 生成torrent 内注释
    }

    #[test]
    fn torrent_文件名格式正确() {
        let bytes = b"naming-test";
        let hash = 生成内容哈希(bytes);
        let result = 生成torrent(&hash, ".webm", bytes).unwrap();
        let expected = format!("content-{hash}.webm");
        let s = String::from_utf8_lossy(&result.torrent_bytes);
        assert!(s.contains(&expected), "应包含文件名 'content-{{hash}}.webm'");
    }
}
