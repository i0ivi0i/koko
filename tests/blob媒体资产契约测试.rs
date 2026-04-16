use koko::contract::{
    Blob媒体资产描述, 变体描述, 媒体冷源描述, 媒体冷源角色, 媒体分发描述, 媒体资产种类,
};

#[test]
fn 图片资产描述包含_preview_full_original_而不是普通附件直链() {
    let asset = Blob媒体资产描述 {
        资产标识: "asset-image-1".into(),
        内容哈希: "hash-image-1".into(),
        种类: 媒体资产种类::图片Blob,
        preview: Some(变体描述 {
            标识: "preview".into(),
            mime_type: "image/jpeg".into(),
            地址: "/api/media/asset-image-1/blob/preview?session_id=s-1".into(),
            宽: Some(480),
            高: Some(320),
        }),
        full: Some(变体描述 {
            标识: "full".into(),
            mime_type: "image/jpeg".into(),
            地址: "/api/media/asset-image-1/blob/full?session_id=s-1".into(),
            宽: Some(1920),
            高: Some(1280),
        }),
        original: Some(变体描述 {
            标识: "original".into(),
            mime_type: "image/png".into(),
            地址: "/api/media/asset-image-1/blob/original?session_id=s-1".into(),
            宽: Some(1920),
            高: Some(1280),
        }),
        分发: Some(媒体分发描述 {
            swarm_id: "swarm_hash-image-1".into(),
            announce_urls: vec!["wss://swarm.example.com/announce".into()],
            web_seed_url: Some("https://cdn.example.com/media/asset-image-1".into()),
            join_ticket: None,
        }),
        冷源: 媒体冷源描述 {
            原始地址: Some(
                "/api/attachments/asset-image-1/content?session_id=s-1&variant=original".into(),
            ),
            到期时间戳秒: 1_776_000_000,
            是否可用: true,
            角色: 媒体冷源角色::冷备引导,
        },
    };

    assert_eq!(asset.种类, 媒体资产种类::图片Blob);
    assert_eq!(
        asset.preview.as_ref().map(|value| value.标识.as_str()),
        Some("preview")
    );
    assert_eq!(
        asset.full.as_ref().map(|value| value.标识.as_str()),
        Some("full")
    );
    assert_eq!(
        asset.original.as_ref().map(|value| value.标识.as_str()),
        Some("original")
    );
    assert!(
        asset.full.as_ref().map(|value| value.地址.as_str())
            != asset.original.as_ref().map(|value| value.地址.as_str()),
        "full 和 original 必须是可区分的稳定资产地址"
    );
    assert!(
        asset
            .full
            .as_ref()
            .is_some_and(|value| !value.地址.contains("/api/attachments/"))
            && asset
                .original
                .as_ref()
                .is_some_and(|value| !value.地址.contains("/api/attachments/")),
        "blob 资产正式主链不能继续暴露旧附件内容直链"
    );
    assert_eq!(asset.冷源.角色, 媒体冷源角色::冷备引导);
}
