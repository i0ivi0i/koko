use koko::shared::contract::{
    媒体冷源描述, 媒体冷源角色, 媒体分发描述, 媒体分发生存模式, 媒体资产种类
};
use koko::usecase::构造媒体冷源描述;

#[test]
fn 正式视频共享表面只保留单文件分发与冷源语义() {
    let distribution = 媒体分发描述 {
        swarm_id: "swarm_hash-video-1".into(),
        announce_urls: vec!["wss://swarm.example.com/announce".into()],
        web_seed_url: Some("https://cdn.example.com/media/asset-video-1".into()),
        join_ticket: None,
        ticket_expires_at: None,
        生存模式: 媒体分发生存模式::到期后仅peer存活,
    };
    let origin = 媒体冷源描述 {
        原始地址: Some("/api/attachments/asset-video-1/content?variant=original".into()),
        到期时间戳秒: 1_776_000_000,
        是否可用: true,
        角色: 媒体冷源角色::冷备引导,
    };

    assert_eq!(媒体资产种类::单文件视频, 媒体资产种类::单文件视频);
    assert_eq!(distribution.生存模式, 媒体分发生存模式::到期后仅peer存活);
    assert_eq!(origin.角色, 媒体冷源角色::冷备引导);
    assert!(
        distribution
            .announce_urls
            .iter()
            .any(|value| value.starts_with("wss://"))
    );
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
