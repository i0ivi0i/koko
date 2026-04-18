use koko::contract::{
    媒体冷源描述, 媒体冷源角色, 媒体分发描述, 媒体分发生存模式, 媒体清单描述, 媒体资产种类,
    流媒体生命周期描述, 流媒体资产描述,
};
use koko::usecase::构造媒体冷源描述;

#[test]
fn 视频资产描述包含_manifest_swarm_origin_而不是原始附件主链() {
    let asset = 流媒体资产描述 {
        资产标识: "asset-video-1".into(),
        内容哈希: "hash-video-1".into(),
        种类: 媒体资产种类::流媒体视频,
        清单: 媒体清单描述 {
            hls主清单地址: Some("/media/asset-video-1/master.m3u8".into()),
            dash主清单地址: Some("/media/asset-video-1/stream.mpd".into()),
        },
        生命周期: 流媒体生命周期描述 {
            streaming到期时间戳秒: Some("1776000000".into()),
            streaming删除时间戳秒: None,
        },
        分发: 媒体分发描述 {
            swarm_id: "swarm_hash-video-1".into(),
            announce_urls: vec!["wss://swarm.example.com/announce".into()],
            web_seed_url: Some("https://cdn.example.com/media/asset-video-1".into()),
            join_ticket: None,
            ticket_expires_at: None,
            生存模式: 媒体分发生存模式::到期后仅peer存活,
        },
        冷源: 媒体冷源描述 {
            原始地址: Some("/api/media/asset-video-1/original".into()),
            到期时间戳秒: 1_776_000_000,
            是否可用: true,
            角色: 媒体冷源角色::冷备引导,
        },
    };

    assert_eq!(asset.种类, 媒体资产种类::流媒体视频);
    assert_eq!(
        asset.清单.hls主清单地址.as_deref(),
        Some("/media/asset-video-1/master.m3u8")
    );
    assert_eq!(
        asset.生命周期.streaming到期时间戳秒.as_deref(),
        Some("1776000000")
    );
    assert_eq!(asset.分发.生存模式, 媒体分发生存模式::到期后仅peer存活);
    assert_eq!(asset.冷源.角色, 媒体冷源角色::冷备引导);
    assert!(asset
        .分发
        .announce_urls
        .iter()
        .any(|value| value.starts_with("wss://")));
}

#[test]
fn 超过24小时的原始冷源不会再被标成正式主读取入口() {
    let 冷源 = 构造媒体冷源描述(
        Some("/api/media/asset-video-1/original".into()),
        Some(1_000),
        None,
        1_001,
    );
    assert_eq!(冷源.角色, 媒体冷源角色::冷备引导);
    assert!(!冷源.是否可用);
}
