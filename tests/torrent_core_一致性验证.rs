//! 一致性验证：koko-torrent-core vs bip_metainfo vs 后端现有函数
//!
//! 这是 Phase 0 的核心保证：
//! 前端 WASM 和后端 native 共享同一份 torrent 生成逻辑，
//! 任意一端对同一字节输入都产出相同的 info_hash。
//!
//! 测试分两组：
//! 1. **vs bip_metainfo** —— 证明 koko-torrent-core 的 bencode + piece hash
//!    与上游 `bip_metainfo` 字面一致
//! 2. **vs 后端 `生成附件torrent元信息`** —— 证明切换到 koko-torrent-core 后
//!    后端行为不变，info_hash / piece_length / content_hash 全部一致

use bip_metainfo::{DirectAccessor, Metainfo, MetainfoBuilder, PieceLength};

// ============================================================================
// 辅助函数
// ============================================================================

/// 用 bip_metainfo（上游库）生成 torrent 并返回 info_hash（hex 小写）。
/// 参数和行为完全复制自后端 `生成附件torrent元信息`。
fn bip_metainfo_info_hash(content_hash: &str, extension: &str, bytes: &[u8]) -> String {
    let file_name = format!("content-{content_hash}{extension}");
    let accessor = DirectAccessor::new(&file_name, bytes);
    let torrent_bytes = MetainfoBuilder::new()
        .set_private_flag(Some(true))
        .set_piece_length(PieceLength::OptBalanced)
        .build(1, accessor, |_| ())
        .expect("bip_metainfo 应可生成 torrent");
    let metainfo =
        Metainfo::from_bytes(&torrent_bytes).expect("bip_metainfo 应可解析自身产出");
    hex::encode(metainfo.info().info_hash().as_ref())
}

/// 用 koko-torrent-core 生成 torrent 并返回 info_hash。
fn core_info_hash(content_hash: &str, extension: &str, bytes: &[u8]) -> String {
    koko_torrent_core::生成torrent(content_hash, extension, bytes)
        .expect("koko-torrent-core 应可生成 torrent")
        .torrent_info_hash
}

/// 断言 koko-torrent-core 与 bip_metainfo 对同一输入产出相同 info_hash。
fn assert_info_hash_identical(label: &str, bytes: &[u8]) {
    let content_hash = koko_torrent_core::生成内容哈希(bytes);
    let ext = ".mp4";
    let bip = bip_metainfo_info_hash(&content_hash, ext, bytes);
    let core = core_info_hash(&content_hash, ext, bytes);
    assert_eq!(
        bip, core,
        "{label}: info_hash 不一致 — bip_metainfo={bip}, koko-torrent-core={core}"
    );
}

// ============================================================================
// vs bip_metainfo：不同文件大小的 info_hash 一致性
// ============================================================================

#[test]
fn 一致性_16字节() {
    assert_info_hash_identical("16 bytes", b"koko-valid-media");
}

#[test]
fn 一致性_1kb() {
    let bytes = vec![0xABu8; 1024];
    assert_info_hash_identical("1 KB", &bytes);
}

#[test]
fn 一致性_1mb() {
    let bytes = vec![0x42u8; 1_048_576];
    assert_info_hash_identical("1 MB", &bytes);
}

#[test]
fn 一致性_5mb() {
    let bytes: Vec<u8> = (0u8..=255).cycle().take(5 * 1024 * 1024).collect();
    assert_info_hash_identical("5 MB", &bytes);
}

/// 50 MB 和 200 MB 测试标记 `#[ignore]`，避免 CI 常规执行时内存/时间压力过大。
/// 手动验证：`cargo test -p koko --test torrent_core_一致性验证 -- --ignored`
#[test]
#[ignore]
fn 一致性_50mb() {
    let bytes: Vec<u8> = (0u8..=255).cycle().take(50 * 1024 * 1024).collect();
    assert_info_hash_identical("50 MB", &bytes);
}

#[test]
#[ignore]
fn 一致性_200mb() {
    let bytes: Vec<u8> = (0u8..=255).cycle().take(200 * 1024 * 1024).collect();
    assert_info_hash_identical("200 MB", &bytes);
}

// ============================================================================
// vs 后端现有函数：验证 koko-torrent-core 可无损替代后端 bip_metainfo 调用
// ============================================================================

/// 验证 koko-torrent-core 与后端现有 `生成附件torrent元信息` 产出相同 info_hash。
/// 后端模块路径：`koko::media_distribution`（src/lib.rs 导出自 `媒体/协作分发/共享语义.rs`）。
#[test]
fn 后端一致性_与生成附件torrent元信息一致() {
    let bytes = b"koko-valid-media";
    let content_hash = koko_torrent_core::生成内容哈希(bytes);

    // 后端现有函数（bip_metainfo 驱动）
    let backend = koko::media_distribution::生成附件torrent元信息(&content_hash, ".mp4", bytes)
        .expect("后端函数应可生成");

    // koko-torrent-core（纯 RustCrypto 驱动）
    let core =
        koko_torrent_core::生成torrent(&content_hash, ".mp4", bytes).expect("core 应可生成");

    assert_eq!(
        backend.torrent_info_hash, core.torrent_info_hash,
        "info_hash 必须一致"
    );
    assert_eq!(
        backend.piece_length_bytes as usize, core.piece_length_bytes,
        "piece_length 必须一致"
    );
}

/// 验证 content_hash 计算一致：后端 `生成内容哈希` vs koko-torrent-core `生成内容哈希`。
#[test]
fn 后端一致性_content_hash一致() {
    let bytes = b"koko-valid-media";
    let core_hash = koko_torrent_core::生成内容哈希(bytes);
    let backend_hash = koko::media_distribution::生成内容哈希(bytes);
    assert_eq!(core_hash, backend_hash, "content_hash 必须一致");
}

/// 用更大的测试数据验证后端一致性（5 MB 循环模式）。
#[test]
fn 后端一致性_5mb数据() {
    let bytes: Vec<u8> = (0u8..=255).cycle().take(5 * 1024 * 1024).collect();
    let content_hash = koko_torrent_core::生成内容哈希(&bytes);

    let backend =
        koko::media_distribution::生成附件torrent元信息(&content_hash, ".webm", &bytes)
            .expect("后端函数应可生成");
    let core = koko_torrent_core::生成torrent(&content_hash, ".webm", &bytes)
        .expect("core 应可生成");

    assert_eq!(backend.torrent_info_hash, core.torrent_info_hash);
    assert_eq!(backend.piece_length_bytes as usize, core.piece_length_bytes);
}
