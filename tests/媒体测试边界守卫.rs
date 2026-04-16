use std::fs;
use std::path::Path;

fn 读取(path: &str) -> String {
    fs::read_to_string(Path::new(path)).expect("应能读取边界守卫目标文件")
}

#[test]
fn 媒体上传与后台测试顶层必须保持薄_manifest() {
    for path in ["tests/媒体上传测试.rs", "tests/媒体后台测试.rs"] {
        let content = 读取(path);
        assert!(
            !content.contains("#[tokio::test]"),
            "{path} 只应保留模块挂载和共享 imports，不应再直接堆具体测试"
        );
    }
}

#[test]
fn 媒体测试支撑顶层只应保留稳定出口() {
    let content = 读取("tests/测试支撑/媒体.rs");
    assert!(
        !content.contains("pub fn ") && !content.contains("pub async fn "),
        "tests/测试支撑/媒体.rs 应只保留 re-export，不应重新长出实现体"
    );
}

#[test]
fn 协作分发顶层不应回灌已迁走的_owner() {
    let content = 读取("tests/协作分发测试.rs");
    for migrated_name in [
        "ready附件会落协作分发元数据",
        "相同内容的不同附件可以共享同一swarm_id",
        "视频locator与房间快照会共享同一套preview_asset",
        "查询附件快照会带出图片真实资产与冷源生命周期字段",
        "presence上报会让web_seed过期但最近peer仍存活的locator保持available",
        "web_seed过期且最近没有peer存活时locator会裁决expired",
        "原图内容接口支持标准range读取",
    ] {
        assert!(
            !content.contains(migrated_name),
            "协作分发顶层不应回灌已迁走的测试 owner: {migrated_name}"
        );
    }
}
