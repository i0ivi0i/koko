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
fn tus回调根文件必须直连_上传_owner() {
    let shell = 读取("src/外壳.rs");
    let owner = 读取("src/媒体/上传/外壳/tus回调.rs");
    assert!(
        !Path::new("src/tus_hook外壳.rs").exists(),
        "src/tus_hook外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"媒体/上传/外壳/tus回调.rs\"]"),
        "src/外壳.rs 应直接把 tus 回调模块路径指到 src/媒体/上传/外壳/tus回调.rs"
    );
    assert!(
        !shell.contains("#[path = \"tus_hook外壳.rs\"]"),
        "src/外壳.rs 不应继续指向已删除的根目录 tus_hook 文件"
    );
    assert!(
        owner.contains("async fn handle_tus_hook("),
        "真实 tus 回调 owner 应落在 src/媒体/上传/外壳/tus回调.rs"
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

#[test]
fn 协作分发共享语义必须收进_协作分发_子域() {
    let crate_index = 读取("src/lib.rs");
    let owner = 读取("src/媒体/协作分发/共享语义.rs");
    assert!(
        !Path::new("src/媒体协作分发.rs").exists(),
        "src/媒体协作分发.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        crate_index.contains("#[path = \"媒体/协作分发/共享语义.rs\"]"),
        "src/lib.rs 应直接把 media_distribution 模块路径指到 src/媒体/协作分发/共享语义.rs"
    );
    assert!(
        owner.contains("fn 协作分发快照转响应值(")
            && owner.contains("fn 诊断协作分发join_ticket("),
        "协作分发稳定语义 owner 应落在 src/媒体/协作分发/共享语义.rs"
    );
}

#[test]
fn 媒体定位正式表面守卫_禁止顶层original_url回流并锁定资产外壳新路径() {
    let shell = 读取("src/外壳.rs");
    let content = 读取("src/媒体/资产/外壳.rs");
    assert!(
        !Path::new("src/媒体资产外壳.rs").exists(),
        "src/媒体资产外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"媒体/资产/外壳.rs\"]"),
        "src/外壳.rs 应直接把媒体资产外壳模块路径指到 src/媒体/资产/外壳.rs"
    );
    assert!(
        !content.contains("\"original_url\": original_url"),
        "顶层 locator 已禁止继续暴露 original_url；冷源锚点必须留在 nested asset/origin 正式表面"
    );
}

#[test]
fn 实时外壳必须显式依赖实时业务门面而不是继续偷连统一用例细节() {
    let content = 读取("src/实时/外壳.rs");
    assert!(
        content.contains("crate::realtime"),
        "实时外壳尚未切到 realtime 业务门面，热路径 owner 仍会被统一用例反向绑住"
    );
}

#[test]
fn 媒体上传与媒体资产外壳必须显式依赖媒体业务门面() {
    let shell = 读取("src/外壳.rs");
    let upload_owner = 读取("src/媒体/上传/外壳/媒体上传.rs");
    let asset_owner = 读取("src/媒体/资产/外壳.rs");
    assert!(
        !Path::new("src/媒体上传外壳.rs").exists(),
        "src/媒体上传外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"媒体/上传/外壳/媒体上传.rs\"]"),
        "src/外壳.rs 应直接把媒体上传模块路径指到 src/媒体/上传/外壳/媒体上传.rs"
    );
    for (path, content) in [
        ("src/媒体/上传/外壳/媒体上传.rs", upload_owner),
        ("src/媒体/资产/外壳.rs", asset_owner),
    ] {
        assert!(
            content.contains("crate::media"),
            "{path} 尚未切到媒体业务门面，媒体 owner 仍会被统一用例反向绑住"
        );
    }
}

#[test]
fn 媒体附件适配必须收进_媒体_子域() {
    let adapter_root = 读取("src/适配.rs");
    let owner = 读取("src/媒体/适配.rs");
    assert!(
        !Path::new("src/媒体附件适配.rs").exists(),
        "src/媒体附件适配.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        adapter_root.contains("#[path = \"媒体/适配.rs\"]"),
        "src/适配.rs 应直接把媒体附件适配模块路径指到 src/媒体/适配.rs"
    );
    assert!(
        owner.contains("fn 查询附件快照(")
            && owner.contains("fn 写入协作分发元数据(")
            && owner.contains("fn 写入媒体上传会话授权("),
        "媒体适配真实 owner 应落在 src/媒体/适配.rs"
    );
}

#[test]
fn 媒体内容解析必须收进_上传_子域() {
    let shell = 读取("src/外壳.rs");
    let owner = 读取("src/媒体/上传/内容解析.rs");
    assert!(
        !Path::new("src/媒体内容解析.rs").exists(),
        "src/媒体内容解析.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"媒体/上传/内容解析.rs\"]"),
        "src/外壳.rs 应直接把媒体内容解析模块路径指到 src/媒体/上传/内容解析.rs"
    );
    assert!(
        owner.contains("fn 校验canonical图片内容(")
            && owner.contains("fn 解析视频内容("),
        "媒体内容解析真实 owner 应落在 src/媒体/上传/内容解析.rs"
    );
}
