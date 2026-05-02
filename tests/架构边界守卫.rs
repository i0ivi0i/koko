use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

fn 读取(path: &str) -> String {
    fs::read_to_string(Path::new(path)).expect("应能读取架构边界目标文件")
}

fn 统计物理行数(path: &str) -> usize {
    读取(path).lines().count()
}

// 这里直接枚举 src 根目录的 .rs 文件，防止后续有人往根目录偷偷加新的业务文件却没进矩阵和门禁。
fn 枚举后端根_rs文件() -> BTreeSet<String> {
    fs::read_dir("src")
        .expect("应能读取 src 根目录")
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            (path.extension().and_then(|ext| ext.to_str()) == Some("rs"))
                .then(|| entry.file_name().to_string_lossy().into_owned())
        })
        .collect()
}

fn 枚举后端生产_rs文件() -> BTreeSet<String> {
    fn walk(dir: &Path, output: &mut BTreeSet<String>) {
        for entry in fs::read_dir(dir).expect("应能读取后端源码目录") {
            let entry = entry.expect("应能读取后端源码项");
            let path = entry.path();
            if path.is_dir() {
                walk(&path, output);
                continue;
            }
            if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
                continue;
            }
            output.insert(path.to_string_lossy().replace('\\', "/"));
        }
    }

    let mut files = BTreeSet::new();
    walk(Path::new("src"), &mut files);
    files
}

#[test]
fn 后端恢复_owner_文件必须显式存在() {
    for path in ["src/恢复/mod.rs", "src/恢复/应用.rs"] {
        assert!(
            Path::new(path).exists(),
            "{path} 缺失，说明恢复 owner 仍然没有落回显式业务模块"
        );
    }
}

#[test]
fn crate_总索引必须显式挂载_recovery_模块() {
    let content = 读取("src/lib.rs");
    assert!(
        content.contains("pub mod recovery;"),
        "src/lib.rs 还没有显式挂载 recovery 模块，说明恢复 owner 仍停留在过渡态"
    );
    assert!(
        content.contains("#[path = \"恢复/mod.rs\"]"),
        "recovery 挂载必须继续映射到中文物理目录，禁止再长第二套外部公开入口"
    );
}

#[test]
fn 实时外壳根文件必须删除并直连实时_owner() {
    assert!(
        !Path::new("src/外壳.rs").exists(),
        "src/外壳.rs 必须删除；HTTP/socket 总壳 owner 只能进 src/外壳/mod.rs"
    );
    let shell = 读取("src/外壳/mod.rs");
    let owner = 读取("src/实时/外壳.rs");
    assert!(
        !Path::new("src/实时外壳.rs").exists(),
        "src/实时外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        !shell.contains("#[path = \"实时/外壳.rs\"]"),
        "src/外壳/mod.rs 不能再用 #[path] 二次引入 src/实时/外壳.rs；同一源码只能通过 crate::realtime::shell 一个模块身份进入编译"
    );
    assert!(
        shell.contains("realtime::shell") && shell.contains("as 实时外壳"),
        "src/外壳/mod.rs 应复用 crate::realtime::shell，避免实时外壳被编译成第二份模块身份"
    );
    assert!(
        owner.contains("crate::realtime::application"),
        "src/实时/外壳.rs 必须继续显式依赖 realtime 业务模块"
    );
}

#[test]
fn 旧房间快照实现必须只留在_recovery_owner() {
    let content = 读取("src/房间/应用.rs");
    assert!(
        !content.contains("pub use crate::recovery::application::加载房间快照;"),
        "src/房间/应用.rs 不得继续保留恢复用例的临时转发出口；调用方必须直连 recovery owner"
    );
    assert!(
        !content.contains("async fn 加载房间快照"),
        "src/房间/应用.rs 不应重新长回房间快照恢复实现"
    );
}

#[test]
fn 根用例文件必须删除且应用入口不得回灌外层实现() {
    assert!(
        !Path::new("src/用例.rs").exists(),
        "src/用例.rs 必须删除；不能再把旧根用例文件当成任何长期入口"
    );
    let content = 读取("src/应用/mod.rs");
    assert!(
        !content.contains("pub use crate::identity::application")
            && !content.contains("pub use crate::room::application")
            && !content.contains("pub use crate::message::application")
            && !content.contains("pub use crate::recovery::application")
            && !content.contains("pub use crate::media::upload::application")
            && !content.contains("pub use crate::media::distribution::application")
            && !content.contains("pub use crate::realtime::application"),
        "src/应用/mod.rs 不得继续充当跨业务总入口；调用方必须直连各自 owner"
    );
    for forbidden in ["axum", "sqlx", "socketioxide", "SocketRef", "StatusCode", "Router"] {
        assert!(
            !content.contains(forbidden),
            "src/应用/mod.rs 不应回灌外层实现或协议类型: {forbidden}"
        );
    }
    for forbidden in ["Ok(None)", "Ok(vec![])", "Err(contract::错误码::系统错误)"] {
        assert!(
            !content.contains(forbidden),
            "src/应用/mod.rs 不得继续用默认空实现掩盖缺能力: {forbidden}"
        );
    }
}

#[test]
fn 应用总入口不得重导出业务模型() {
    let content = 读取("src/应用/mod.rs");
    for forbidden in ["pub use crate::media::模型::*", "pub use crate::media::application"] {
        assert!(
            !content.contains(forbidden),
            "src/应用/mod.rs 只能保留跨上下文共享端口和校验函数，不得重导出业务 owner 模型: {forbidden}"
        );
    }
}

#[test]
fn 应用端口不得提供默认空实现() {
    for path in [
        "src/应用/mod.rs",
        "src/身份/应用.rs",
        "src/房间/应用.rs",
        "src/消息/应用.rs",
        "src/媒体/应用.rs",
        "src/媒体/上传/应用.rs",
        "src/媒体/协作分发/应用.rs",
        "src/恢复/应用.rs",
        "src/实时/应用.rs",
    ] {
        let content = 读取(path);
        for forbidden in [
            "Ok(None)",
            "Ok(vec![])",
            "Ok(Vec::new())",
            "Ok(Default::default())",
            "Err(contract::错误码::系统错误)",
            ".map_err(|_| contract::错误码::系统错误)",
        ] {
            assert!(
                !content.contains(forbidden),
                "{path} 不得用默认空结果或系统错误兜底伪装业务能力: {forbidden}"
            );
        }
    }
}

#[test]
fn 适配器不得横向借另一个适配器拼业务结果() {
    for (path, forbidden) in [
        ("src/房间/适配.rs", "消息事件适配::"),
        ("src/媒体/上传/外壳/媒体上传.rs", "crate::外壳::"),
    ] {
        let content = 读取(path);
        assert!(
            !content.contains(forbidden),
            "{path} 不得横向调用另一个适配器拼业务结果；业务裁决必须先回到 application/domain owner: {forbidden}"
        );
    }
}

#[test]
fn 后端生产文件不得使用兜底桶命名() {
    let forbidden_fragments = [
        "utils", "helper", "helpers", "misc", "facade", "compat", "legacy", "fallback", "wrapper",
        "shim", "temp", "old", "门面", "兼容", "兜底", "临时", "旧", "包装",
    ];
    for path in 枚举后端生产_rs文件() {
        let normalized = path.to_lowercase();
        for forbidden in forbidden_fragments {
            assert!(
                !normalized.contains(forbidden),
                "{path} 命中兜底桶/兼容命名 {forbidden}；生产代码文件名必须表达真实 owner，而不是留下垃圾桶或兼容层"
            );
        }
    }
}

#[test]
fn 根契约文件不得混入页面文案布局词或框架类型() {
    assert!(
        !Path::new("src/契约.rs").exists(),
        "src/契约.rs 必须删除；共享稳定契约只能进 src/共享/契约基础.rs，业务契约进各业务 owner"
    );
    let content = 读取("src/共享/契约基础.rs");
    for forbidden in [
        "HTMLElement",
        "window",
        "document",
        "localStorage",
        "Router",
        "SocketRef",
        "StatusCode",
        "Json<",
        "Query<",
        "State<",
    ] {
        assert!(
            !content.contains(forbidden),
            "src/共享/契约基础.rs 不应混入壳层/框架类型: {forbidden}"
        );
    }
}

#[test]
fn 后端根目录旧根文件必须登记为待删除债务() {
    let actual = 枚举后端根_rs文件();
    let permanent = ["lib.rs", "main.rs", "入口.rs", "总装.rs"]
        .into_iter()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    let temporary_old_roots = BTreeSet::<String>::new();
    let matrix = 读取("docs/superpowers/reports/2026-05-01-真DDD重构完成矩阵.md");

    for file in actual {
        if permanent.contains(&file) {
            continue;
        }
        assert!(
            temporary_old_roots.contains(&file),
            "src 根目录出现未登记业务文件 {file}；根目录只允许真实入口/总装，旧根文件必须单独登记为待删除债务"
        );
        let row_prefix = format!("| `src/{file}` | 待删除旧根文件");
        assert!(
            matrix.contains(&row_prefix),
            "{file} 仍在 src 根目录时，完成矩阵必须把它登记为“待删除旧根文件”，不能再写成合法长期入口"
        );
    }
}

#[test]
fn 后端旧根文件删除前只能变薄不能变厚() {
    let budgets: [(&str, usize); 0] = [];

    for (path, budget) in budgets {
        let lines = 统计物理行数(path);
        assert!(
            lines <= budget,
            "{path} 当前 {lines} 行，超过待删除旧根文件预算 {budget}；旧根文件删除前只允许变薄，不允许继续长胖"
        );
    }
}

#[test]
fn 外壳层前端静态入口必须下沉到中文子模块() {
    let shell = 读取("src/外壳/mod.rs");
    assert!(
        Path::new("src/外壳/前端静态入口.rs").exists(),
        "src/外壳/前端静态入口.rs 缺失，说明前端静态入口 owner 还没有从根外壳文件下沉"
    );
    assert!(
        shell.contains("#[path = \"前端静态入口.rs\"]"),
        "src/外壳/mod.rs 应显式挂载 src/外壳/前端静态入口.rs"
    );
    for forbidden in [
        "fn 构建前端静态资源路由()",
        "struct 前端静态资源清单",
        "fn 读取前端静态资源清单()",
        "fn 渲染前端入口_html()",
        "async fn load_frontend_index()",
    ] {
        assert!(
            !shell.contains(forbidden),
            "src/外壳/mod.rs 不应继续内嵌前端静态入口实现: {forbidden}"
        );
    }
}

#[test]
fn 外壳层协议响应必须下沉到中文子模块() {
    let shell = 读取("src/外壳/mod.rs");
    assert!(
        Path::new("src/外壳/协议响应.rs").exists(),
        "src/外壳/协议响应.rs 缺失，说明协议响应 owner 还没有从根外壳文件下沉"
    );
    assert!(
        shell.contains("#[path = \"协议响应.rs\"]"),
        "src/外壳/mod.rs 应显式挂载 src/外壳/协议响应.rs"
    );
    for forbidden in [
        "struct ApiError",
        "pub(crate) fn events_to_json(",
        "fn attachments_to_json(",
        "pub(crate) fn event_to_json(",
        "pub(crate) fn map_domain_err_tuple(",
        "fn err_resp(",
    ] {
        assert!(
            !shell.contains(forbidden),
            "src/外壳/mod.rs 不应继续内嵌协议响应实现: {forbidden}"
        );
    }
}

#[test]
fn 外壳层媒体清理必须下沉到中文子模块() {
    let shell = 读取("src/外壳/mod.rs");
    assert!(
        Path::new("src/外壳/媒体清理.rs").exists(),
        "src/外壳/媒体清理.rs 缺失，说明媒体后台清理 owner 还没有从总壳文件下沉"
    );
    assert!(
        shell.contains("#[path = \"媒体清理.rs\"]"),
        "src/外壳/mod.rs 应显式挂载 src/外壳/媒体清理.rs"
    );
    for forbidden in [
        "pub async fn 执行一次媒体冷源清理(",
        "fn 上传残留清理原因标签(",
        "async fn 执行一次媒体上传残留清理_按会话(",
        "pub async fn 执行一次媒体上传残留清理(",
    ] {
        assert!(
            !shell.contains(forbidden),
            "src/外壳/mod.rs 不应继续内嵌媒体清理实现: {forbidden}"
        );
    }
}

#[test]
fn 外壳层协作分发做种必须下沉到中文子模块() {
    let shell = 读取("src/外壳/mod.rs");
    assert!(
        Path::new("src/外壳/协作分发做种.rs").exists(),
        "src/外壳/协作分发做种.rs 缺失，说明做种 sidecar owner 还没有从总壳文件下沉"
    );
    assert!(
        shell.contains("#[path = \"协作分发做种.rs\"]"),
        "src/外壳/mod.rs 应显式挂载 src/外壳/协作分发做种.rs"
    );
    for forbidden in [
        "struct 协作分发做种启动命令",
        "fn 读取sidecar媒体基准地址(",
        "fn 归一化sidecar媒体地址(",
        "fn 从协作分发响应构造做种启动命令(",
        "async fn 尝试启动协作分发做种(",
        "pub async fn 执行一次协作分发做种对账(",
    ] {
        assert!(
            !shell.contains(forbidden),
            "src/外壳/mod.rs 不应继续内嵌协作分发做种实现: {forbidden}"
        );
    }
}

#[test]
fn 外壳层tracker代理必须下沉到媒体协作分发子模块() {
    let shell = 读取("src/外壳/mod.rs");
    assert!(
        Path::new("src/媒体/协作分发/tracker代理.rs").exists(),
        "src/媒体/协作分发/tracker代理.rs 缺失，说明 tracker 协议适配还没有回到媒体协作分发 owner"
    );
    let distribution = 读取("src/媒体/协作分发/mod.rs");
    assert!(
        distribution.contains("#[path = \"tracker代理.rs\"]"),
        "src/媒体/协作分发/mod.rs 应显式挂载 src/媒体/协作分发/tracker代理.rs"
    );
    for forbidden in [
        "async fn proxy_swarm_tracker_announce(",
        "enum Tracker代理错误",
        "async fn relay_swarm_tracker_socket(",
        "fn 拼接tracker上游查询(",
        "fn 校验tracker首帧门禁(",
        "fn 解析tracker首帧门禁字段(",
        "fn 归一化tracker_info_hash(",
        "fn axum_ws_message_to_tungstenite(",
        "fn tungstenite_message_to_axum_ws(",
    ] {
        assert!(
            !shell.contains(forbidden),
            "src/外壳/mod.rs 不应继续内嵌 tracker 代理实现: {forbidden}"
        );
    }
}

#[test]
fn 房间外壳必须收进房间子域() {
    let shell = 读取("src/外壳/mod.rs");
    let owner = 读取("src/房间/外壳.rs");
    assert!(
        !Path::new("src/房间外壳.rs").exists(),
        "src/房间外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"../房间/外壳.rs\"]"),
        "src/外壳/mod.rs 应直接把房间外壳路径指到 src/房间/外壳.rs"
    );
    assert!(
        owner.contains("crate::room::application"),
        "src/房间/外壳.rs 必须继续显式依赖 room 业务模块"
    );
}

#[test]
fn 房间阅读适配必须收进房间子域() {
    assert!(
        !Path::new("src/适配.rs").exists(),
        "src/适配.rs 必须删除；PostgreSQL 适配 owner 只能进 src/适配/mod.rs"
    );
    let adapter_root = 读取("src/适配/mod.rs");
    let owner = 读取("src/房间/适配.rs");
    assert!(
        !Path::new("src/房间阅读适配.rs").exists(),
        "src/房间阅读适配.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        adapter_root.contains("#[path = \"../房间/适配.rs\"]"),
        "src/适配/mod.rs 应直接把房间阅读适配路径指到 src/房间/适配.rs"
    );
    assert!(
        owner.contains("async fn 按短码进房或建房_异步("),
        "src/房间/适配.rs 必须继续承载房间阅读与恢复快照适配 owner"
    );
    for forbidden in [
        "super::消息事件适配::查询消息页",
        "super::消息事件适配::查询从位置开始的消息页",
        "super::消息事件适配::组装消息事件列表_异步",
    ] {
        assert!(
            !owner.contains(forbidden),
            "src/房间/适配.rs 不能继续跨到消息适配借道：{forbidden}"
        );
    }
}

#[test]
fn 消息事件适配必须收进消息子域() {
    assert!(
        !Path::new("src/适配.rs").exists(),
        "src/适配.rs 必须删除；PostgreSQL 适配 owner 只能进 src/适配/mod.rs"
    );
    let adapter_root = 读取("src/适配/mod.rs");
    let owner = 读取("src/消息/适配.rs");
    assert!(
        !Path::new("src/消息事件适配.rs").exists(),
        "src/消息事件适配.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        adapter_root.contains("#[path = \"../消息/适配.rs\"]"),
        "src/适配/mod.rs 应直接把消息事件适配路径指到 src/消息/适配.rs"
    );
    assert!(
        owner.contains("fn 行转消息事件(")
            && owner.contains("async fn 查询既有消息事件_异步(")
            && owner.contains("async fn 提交统一消息事件_异步("),
        "src/消息/适配.rs 必须继续承载消息事件投影、幂等回查与统一消息提交 owner"
    );
}

#[test]
fn 用户身份资料投影必须收进身份子域() {
    let crate_index = 读取("src/lib.rs");
    let owner = 读取("src/身份/资料投影.rs");
    assert!(
        !Path::new("src/用户身份.rs").exists(),
        "src/用户身份.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        crate_index.contains("#[path = \"身份/资料投影.rs\"]"),
        "src/lib.rs 应直接把 user_identity 路径指到 src/身份/资料投影.rs"
    );
    assert!(
        owner.contains("fn 生成内部身份(") && owner.contains("fn 随机分配资料投影("),
        "src/身份/资料投影.rs 必须继续承载身份资料投影 owner"
    );
}

#[test]
fn 后台外壳必须收进后台子域() {
    let shell = 读取("src/外壳/mod.rs");
    let owner = 读取("src/后台/外壳.rs");
    assert!(
        !Path::new("src/后台外壳.rs").exists(),
        "src/后台外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"../后台/外壳.rs\"]"),
        "src/外壳/mod.rs 应直接把后台外壳路径指到 src/后台/外壳.rs"
    );
    assert!(
        owner.contains("async fn admin_login(") && owner.contains("async fn admin_overview("),
        "src/后台/外壳.rs 必须继续承载后台冷路径外壳 owner"
    );
}

#[test]
fn 根目录热点尚未收口时_完成矩阵不得提前宣称已完成() {
    let matrix = 读取("docs/superpowers/reports/2026-05-01-真DDD重构完成矩阵.md");
    let 未收口热点 = [
        ("src/应用/mod.rs", 200usize),
        ("src/外壳/mod.rs", 200usize),
        ("src/适配/mod.rs", 120usize),
        ("frontend/总装/聊天应用内核.ts", 200usize),
        ("frontend/总装/聊天壳.ts", 200usize),
        ("frontend/媒体/播放会话/应用.ts", 200usize),
    ]
    .into_iter()
    .filter(|(path, budget)| 统计物理行数(path) > *budget)
    .map(|(path, _)| path)
    .collect::<Vec<_>>();

    assert!(
        !未收口热点.is_empty(),
        "这条守卫只在仍有热点根文件未收口时才有意义；如果这里为空，说明预算或测试前提需要一起更新"
    );
    assert!(
        !matrix.contains("状态：已完成"),
        "仍有热点根文件明显未收口：{:?}；完成矩阵不应提前写成已完成",
        未收口热点
    );
}

#[test]
fn 根目录业务文件必须逐个登记到完成矩阵() {
    let matrix = 读取("docs/superpowers/reports/2026-05-01-真DDD重构完成矩阵.md");
    let required_entries = [
        "src/媒体附件适配.rs",
        "src/媒体内容解析.rs",
        "src/媒体上传外壳.rs",
        "src/媒体资产外壳.rs",
        "src/媒体协作分发.rs",
        "src/tus_hook外壳.rs",
        "src/房间外壳.rs",
        "src/房间阅读适配.rs",
        "src/消息事件适配.rs",
        "src/用户身份.rs",
        "src/后台外壳.rs",
        "src/实时外壳.rs",
        "src/用例.rs",
        "src/契约.rs",
        "src/适配.rs",
        "src/外壳.rs",
        "frontend/总装/聊天应用内核.ts",
        "frontend/总装/聊天壳.ts",
        "frontend/媒体/播放会话/应用.ts",
        "frontend/房间消息窗.ts",
        "frontend/媒体运行时.ts",
        "frontend/房间内核.ts",
        "frontend/房间时间线.ts",
        "frontend/房间时间线运行时.ts",
        "frontend/房间视口运行时.ts",
        "frontend/房间滚动器.ts",
        "frontend/房间实时编排.ts",
        "frontend/房间恢复编排.ts",
        "frontend/实时会话运行时.ts",
        "frontend/传输.ts",
        "frontend/存储.ts",
        "frontend/调试兼容.ts",
        "frontend/契约.ts",
        "frontend/视图.ts",
        "frontend/文本布局.ts",
        "frontend/状态.ts",
        "frontend/阅读推进编排.ts",
        "frontend/聊天应用编排桥接.ts",
        "frontend/后台查询编排.ts",
        "frontend/后台会话编排.ts",
        "frontend/后台壳.ts",
        "frontend/后台壳编排.ts",
        "frontend/后台应用内核.ts",
        "frontend/应用运行时.ts",
        "frontend/应用生命周期.ts",
    ];

    for path in required_entries {
        assert!(
            matrix.contains(path),
            "完成矩阵缺少根目录业务文件登记: {path}"
        );
    }
}
