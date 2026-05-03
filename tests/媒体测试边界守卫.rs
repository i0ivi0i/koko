use std::fs;
use std::mem::size_of;
use std::path::Path;

fn 读取(path: &str) -> String {
    fs::read_to_string(Path::new(path)).expect("应能读取边界守卫目标文件")
}

fn 统计物理行数(path: &str) -> usize {
    读取(path).lines().count()
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
fn source_hash复用结果枚举不得把大快照塞进枚举本体() {
    let actual_size = size_of::<koko::media::模型::SourceHash媒体复用结果>();
    let pointer_budget = size_of::<usize>() * 4;
    assert!(
        actual_size <= pointer_budget,
        "SourceHash 媒体复用结果当前 {actual_size} 字节，超过 {pointer_budget} 字节；Miss/Reused 控制流不应把 ready 附件和分发快照直接塞进枚举本体"
    );
}

#[test]
fn tus回调根文件必须直连_上传_owner() {
    let shell = 读取("src/外壳/mod.rs");
    let owner = 读取("src/媒体/上传/外壳/tus回调.rs");
    assert!(
        !Path::new("src/tus_hook外壳.rs").exists(),
        "src/tus_hook外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"../媒体/上传/外壳/tus回调.rs\"]"),
        "src/外壳/mod.rs 应直接把 tus 回调模块路径指到 src/媒体/上传/外壳/tus回调.rs"
    );
    assert!(
        !shell.contains("#[path = \"tus_hook外壳.rs\"]"),
        "src/外壳/mod.rs 不应继续指向已删除的根目录 tus_hook 文件"
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
        owner.contains("fn 协作分发快照转响应值(") && owner.contains("fn 诊断协作分发join_ticket("),
        "协作分发稳定语义 owner 应落在 src/媒体/协作分发/共享语义.rs"
    );
}

#[test]
fn 协作分发共享语义不得泄漏外层协议类型() {
    let owner = 读取("src/媒体/协作分发/共享语义.rs");
    for forbidden in ["axum::http", "HeaderMap", "Uri"] {
        assert!(
            !owner.contains(forbidden),
            "src/媒体/协作分发/共享语义.rs 是跨壳稳定语义入口，不能泄漏 shell/adapter 协议类型：{forbidden}"
        );
    }
}

#[test]
fn 媒体定位正式表面守卫_禁止顶层original_url回流并锁定资产外壳新路径() {
    let shell = 读取("src/外壳/mod.rs");
    let content = 读取("src/媒体/资产/外壳.rs");
    assert!(
        !Path::new("src/媒体资产外壳.rs").exists(),
        "src/媒体资产外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"../媒体/资产/外壳.rs\"]"),
        "src/外壳/mod.rs 应直接把媒体资产外壳模块路径指到 src/媒体/资产/外壳.rs"
    );
    assert!(
        !content.contains("\"original_url\": original_url"),
        "顶层 locator 已禁止继续暴露 original_url；冷源锚点必须留在 nested asset/origin 正式表面"
    );
}

#[test]
fn 实时外壳必须显式依赖实时业务入口而不是继续偷连统一用例细节() {
    let content = 读取("src/实时/外壳.rs");
    assert!(
        content.contains("crate::realtime"),
        "实时外壳尚未切到 realtime 业务入口，热路径 owner 仍会被统一用例反向绑住"
    );
}

#[test]
fn 媒体上传与媒体资产外壳必须显式依赖媒体业务入口() {
    let shell = 读取("src/外壳/mod.rs");
    let upload_shared = 读取("src/媒体/上传/外壳/媒体上传.rs");
    let asset_owner = 读取("src/媒体/资产/外壳.rs");
    assert!(
        !Path::new("src/媒体上传外壳.rs").exists(),
        "src/媒体上传外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    for path_fragment in [
        "#[path = \"../媒体/上传/外壳/媒体上传.rs\"]",
        "#[path = \"../媒体/上传/外壳/准备上传.rs\"]",
        "#[path = \"../媒体/上传/外壳/source_hash复用.rs\"]",
        "#[path = \"../媒体/上传/外壳/转发附件.rs\"]",
        "#[path = \"../媒体/上传/外壳/完成上传.rs\"]",
        "#[path = \"../媒体/上传/外壳/放弃上传.rs\"]",
        "#[path = \"../媒体/上传/外壳/tus代理.rs\"]",
    ] {
        assert!(
            shell.contains(path_fragment),
            "src/外壳/mod.rs 应直接把媒体上传端点 owner 模块路径挂出来: {path_fragment}"
        );
    }
    assert!(
        upload_shared.contains("它不承载 HTTP 路由"),
        "src/媒体/上传/外壳/媒体上传.rs 现在只能是共享协议小函数，不得继续承载端点"
    );
    for path in [
        "src/媒体/上传/外壳/准备上传.rs",
        "src/媒体/上传/外壳/source_hash复用.rs",
        "src/媒体/上传/外壳/转发附件.rs",
        "src/媒体/上传/外壳/完成上传.rs",
        "src/媒体/上传/外壳/放弃上传.rs",
    ] {
        let content = 读取(path);
        assert!(
            content.contains("crate::media"),
            "{path} 尚未切到媒体业务入口，媒体上传端点 owner 仍会被统一用例反向绑住"
        );
    }
    assert!(
        asset_owner.contains("crate::media"),
        "src/媒体/资产/外壳.rs 尚未切到媒体业务入口，媒体 owner 仍会被统一用例反向绑住"
    );
}

#[test]
fn 媒体附件适配必须收进_媒体_子域() {
    assert!(
        !Path::new("src/适配.rs").exists(),
        "src/适配.rs 必须删除；PostgreSQL 适配 owner 只能进 src/适配/mod.rs"
    );
    let adapter_root = 读取("src/适配/mod.rs");
    let owner = 读取("src/媒体/适配.rs");
    let upload_owner = 读取("src/媒体/上传/适配.rs");
    let distribution_owner = 读取("src/媒体/协作分发/适配.rs");
    assert!(
        !Path::new("src/媒体附件适配.rs").exists(),
        "src/媒体附件适配.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        adapter_root.contains("#[path = \"../媒体/适配.rs\"]"),
        "src/适配/mod.rs 应直接把媒体附件适配模块路径指到 src/媒体/适配.rs"
    );
    assert!(
        adapter_root.contains("#[path = \"../媒体/上传/适配.rs\"]")
            && adapter_root.contains("#[path = \"../媒体/协作分发/适配.rs\"]"),
        "src/适配/mod.rs 应显式挂载上传运输适配和协作分发适配 owner"
    );
    assert!(
        owner.contains("fn 查询附件快照(") && owner.contains("fn 查询附件可读内容("),
        "附件/内容读取适配真实 owner 应落在 src/媒体/适配.rs"
    );
    assert!(
        upload_owner.contains("fn 写入媒体上传会话授权(")
            && upload_owner.contains("fn 登记媒体上传运输回执("),
        "上传运输适配真实 owner 应落在 src/媒体/上传/适配.rs"
    );
    assert!(
        distribution_owner.contains("fn 写入协作分发元数据(")
            && distribution_owner.contains("fn 列出待做种协作分发项("),
        "协作分发适配真实 owner 应落在 src/媒体/协作分发/适配.rs"
    );
}

#[test]
fn 媒体附件适配不得继续混住上传运输和协作分发owner() {
    let owner = 读取("src/媒体/适配.rs");
    assert!(
        Path::new("src/媒体/上传/适配.rs").exists(),
        "上传运输仓储适配必须落到 src/媒体/上传/适配.rs，而不是继续堆在媒体附件总适配"
    );
    assert!(
        Path::new("src/媒体/协作分发/适配.rs").exists(),
        "协作分发仓储适配必须落到 src/媒体/协作分发/适配.rs，而不是继续堆在媒体附件总适配"
    );
    for forbidden in [
        "写入媒体上传会话授权_异步",
        "登记媒体上传运输回执_异步",
        "写入协作分发元数据_异步",
        "列出待做种协作分发项_异步",
    ] {
        assert!(
            !owner.contains(forbidden),
            "src/媒体/适配.rs 不应继续混住上传运输/协作分发 owner: {forbidden}"
        );
    }
}

#[test]
fn 后端媒体适配热点必须持续变薄() {
    let lines = 统计物理行数("src/媒体/适配.rs");
    assert!(
        lines <= 1200,
        "src/媒体/适配.rs 当前 {lines} 行，媒体适配必须继续变薄"
    );
}

#[test]
fn 媒体内容解析必须收进_上传_子域() {
    let shell = 读取("src/外壳/mod.rs");
    let owner = 读取("src/媒体/上传/内容解析.rs");
    assert!(
        !Path::new("src/媒体内容解析.rs").exists(),
        "src/媒体内容解析.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"../媒体/上传/内容解析.rs\"]"),
        "src/外壳/mod.rs 应直接把媒体内容解析模块路径指到 src/媒体/上传/内容解析.rs"
    );
    assert!(
        owner.contains("fn 校验canonical图片内容(") && owner.contains("fn 解析视频内容("),
        "媒体内容解析真实 owner 应落在 src/媒体/上传/内容解析.rs"
    );
}
