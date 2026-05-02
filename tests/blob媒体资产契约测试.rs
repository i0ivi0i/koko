use koko::shared::contract::{
    Blob媒体资产描述, 变体描述, 媒体冷源描述, 媒体冷源角色, 媒体分发描述, 媒体分发生存模式,
    媒体资产种类,
};

#[test]
fn 图片资产描述只暴露canonical而不是服务端派生多版本() {
    let asset = Blob媒体资产描述 {
        资产标识: "asset-image-1".into(),
        内容哈希: "hash-image-1".into(),
        种类: 媒体资产种类::图片Blob,
        canonical: Some(变体描述 {
            标识: "canonical".into(),
            mime_type: "image/webp".into(),
            地址: "/api/media/asset-image-1/blob/canonical?session_id=s-1".into(),
            宽: Some(1920),
            高: Some(1280),
        }),
        分发: Some(媒体分发描述 {
            swarm_id: "swarm_hash-image-1".into(),
            announce_urls: vec!["wss://swarm.example.com/announce".into()],
            web_seed_url: Some("https://cdn.example.com/media/asset-image-1".into()),
            join_ticket: None,
            ticket_expires_at: None,
            生存模式: 媒体分发生存模式::到期后仅peer存活,
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
        asset.canonical.as_ref().map(|value| value.标识.as_str()),
        Some("canonical")
    );
    assert!(
        asset
            .canonical
            .as_ref()
            .is_some_and(|value| value.地址.contains("/blob/canonical")),
        "blob 资产正式主链只能暴露 canonical 受控地址"
    );
    assert_eq!(
        asset.分发.as_ref().map(|value| value.生存模式),
        Some(媒体分发生存模式::到期后仅peer存活)
    );
    assert_eq!(asset.冷源.角色, 媒体冷源角色::冷备引导);
}
