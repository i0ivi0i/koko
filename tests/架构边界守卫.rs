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
    let shell = 读取("src/外壳.rs");
    let owner = 读取("src/实时/外壳.rs");
    assert!(
        !Path::new("src/实时外壳.rs").exists(),
        "src/实时外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        !shell.contains("#[path = \"实时/外壳.rs\"]"),
        "src/外壳.rs 不能再用 #[path] 二次引入 src/实时/外壳.rs；同一源码只能通过 crate::realtime::shell 一个模块身份进入编译"
    );
    assert!(
        shell.contains("realtime::shell") && shell.contains("as 实时外壳"),
        "src/外壳.rs 应复用 crate::realtime::shell，避免实时外壳被编译成第二份模块身份"
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
        content.contains("pub use crate::recovery::application::加载房间快照;"),
        "src/房间/应用.rs 只能暴露 recovery owner 的加载房间快照能力，不能重建房间侧实现"
    );
    assert!(
        !content.contains("async fn 加载房间快照"),
        "src/房间/应用.rs 不应重新长回房间快照恢复实现"
    );
}

#[test]
fn 根用例文件只能指向业务_owner且不得回灌外层实现() {
    let content = 读取("src/用例.rs");
    assert!(
        content.contains("crate::identity")
            && content.contains("crate::room")
            && content.contains("crate::recovery"),
        "src/用例.rs 删除前必须显式指向业务 owner，不能把恢复 owner 漏回旧总文件"
    );
    for forbidden in ["axum", "sqlx", "socketioxide", "SocketRef", "StatusCode", "Router"] {
        assert!(
            !content.contains(forbidden),
            "src/用例.rs 不应回灌外层实现或协议类型: {forbidden}"
        );
    }
}

#[test]
fn 根契约文件不得混入页面文案布局词或框架类型() {
    let content = 读取("src/契约.rs");
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
            "src/契约.rs 不应混入壳层/框架类型: {forbidden}"
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
    let temporary_old_roots = ["契约.rs", "用例.rs", "适配.rs", "外壳.rs"]
        .into_iter()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
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
    let budgets = [
        ("src/契约.rs", 328usize),
        ("src/用例.rs", 960usize),
        ("src/适配.rs", 790usize),
        ("src/外壳.rs", 1585usize),
    ];

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
    let shell = 读取("src/外壳.rs");
    assert!(
        Path::new("src/外壳/前端静态入口.rs").exists(),
        "src/外壳/前端静态入口.rs 缺失，说明前端静态入口 owner 还没有从根外壳文件下沉"
    );
    assert!(
        shell.contains("#[path = \"外壳/前端静态入口.rs\"]"),
        "src/外壳.rs 应显式挂载 src/外壳/前端静态入口.rs"
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
            "src/外壳.rs 不应继续内嵌前端静态入口实现: {forbidden}"
        );
    }
}

#[test]
fn 外壳层协议响应必须下沉到中文子模块() {
    let shell = 读取("src/外壳.rs");
    assert!(
        Path::new("src/外壳/协议响应.rs").exists(),
        "src/外壳/协议响应.rs 缺失，说明协议响应 owner 还没有从根外壳文件下沉"
    );
    assert!(
        shell.contains("#[path = \"外壳/协议响应.rs\"]"),
        "src/外壳.rs 应显式挂载 src/外壳/协议响应.rs"
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
            "src/外壳.rs 不应继续内嵌协议响应实现: {forbidden}"
        );
    }
}

#[test]
fn 房间外壳必须收进房间子域() {
    let shell = 读取("src/外壳.rs");
    let owner = 读取("src/房间/外壳.rs");
    assert!(
        !Path::new("src/房间外壳.rs").exists(),
        "src/房间外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"房间/外壳.rs\"]"),
        "src/外壳.rs 应直接把房间外壳路径指到 src/房间/外壳.rs"
    );
    assert!(
        owner.contains("crate::room::application"),
        "src/房间/外壳.rs 必须继续显式依赖 room 业务模块"
    );
}

#[test]
fn 房间阅读适配必须收进房间子域() {
    let adapter_root = 读取("src/适配.rs");
    let owner = 读取("src/房间/适配.rs");
    assert!(
        !Path::new("src/房间阅读适配.rs").exists(),
        "src/房间阅读适配.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        adapter_root.contains("#[path = \"房间/适配.rs\"]"),
        "src/适配.rs 应直接把房间阅读适配路径指到 src/房间/适配.rs"
    );
    assert!(
        owner.contains("async fn 按短码进房或建房_异步(")
            && owner.contains("super::消息事件适配::查询消息页"),
        "src/房间/适配.rs 必须继续承载房间阅读与恢复快照适配 owner"
    );
}

#[test]
fn 消息事件适配必须收进消息子域() {
    let adapter_root = 读取("src/适配.rs");
    let owner = 读取("src/消息/适配.rs");
    assert!(
        !Path::new("src/消息事件适配.rs").exists(),
        "src/消息事件适配.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        adapter_root.contains("#[path = \"消息/适配.rs\"]"),
        "src/适配.rs 应直接把消息事件适配路径指到 src/消息/适配.rs"
    );
    assert!(
        owner.contains("fn 行转消息事件(") && owner.contains("async fn 查询消息页("),
        "src/消息/适配.rs 必须继续承载消息事件投影与分页装配 owner"
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
    let shell = 读取("src/外壳.rs");
    let owner = 读取("src/后台/外壳.rs");
    assert!(
        !Path::new("src/后台外壳.rs").exists(),
        "src/后台外壳.rs 应该已经删除，不能继续保留根目录旧入口"
    );
    assert!(
        shell.contains("#[path = \"后台/外壳.rs\"]"),
        "src/外壳.rs 应直接把后台外壳路径指到 src/后台/外壳.rs"
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
        ("src/用例.rs", 200usize),
        ("src/外壳.rs", 200usize),
        ("src/适配.rs", 120usize),
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
