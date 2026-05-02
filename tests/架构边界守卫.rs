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
fn 旧实时外壳必须退成显式门面并委托新_owner() {
    let content = 读取("src/实时外壳.rs");
    assert!(
        Path::new("src/实时/外壳.rs").exists(),
        "src/实时/外壳.rs 缺失，说明 realtime 新外壳 owner 还没落位"
    );
    assert!(
        content.contains("crate::realtime::shell"),
        "旧 src/实时外壳.rs 还没退成门面，realtime 热路径 owner 仍卡在旧总文件里"
    );
}

#[test]
fn 旧房间快照入口必须退成_recovery_owner_门面() {
    let content = 读取("src/房间/应用.rs");
    assert!(
        content.contains("pub use crate::recovery::application::加载房间快照;"),
        "src/房间/应用.rs 还没把快照恢复入口退成 recovery owner 门面"
    );
    assert!(
        !content.contains("async fn 加载房间快照"),
        "src/房间/应用.rs 不应重新长回房间快照恢复实现"
    );
}

#[test]
fn 统一用例门面必须继续转发到业务模块且不得回灌外层实现() {
    let content = 读取("src/用例.rs");
    assert!(
        content.contains("crate::identity")
            && content.contains("crate::room")
            && content.contains("crate::recovery"),
        "统一用例门面必须继续显式转发到业务模块，不能把恢复 owner 漏回旧总文件"
    );
    for forbidden in ["axum", "sqlx", "socketioxide", "SocketRef", "StatusCode", "Router"] {
        assert!(
            !content.contains(forbidden),
            "src/用例.rs 不应回灌外层实现或协议类型: {forbidden}"
        );
    }
}

#[test]
fn 统一契约门面不得混入页面文案布局词或框架类型() {
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
fn 后端根目录只允许合法入口_迁移门面或已登记散落_owner() {
    let actual = 枚举后端根_rs文件();
    let expected = [
        "lib.rs",
        "main.rs",
        "入口.rs",
        "总装.rs",
        "契约.rs",
        "用例.rs",
        "适配.rs",
        "外壳.rs",
        "实时外壳.rs",
        "媒体附件适配.rs",
        "媒体内容解析.rs",
        "媒体上传外壳.rs",
        "媒体资产外壳.rs",
        "媒体协作分发.rs",
        "tus_hook外壳.rs",
        "房间外壳.rs",
        "房间阅读适配.rs",
        "消息事件适配.rs",
        "用户身份.rs",
        "后台外壳.rs",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect::<BTreeSet<_>>();

    assert_eq!(
        actual, expected,
        "src 根目录 .rs 文件集合发生变化；新增或删除根文件前必须先更新完成矩阵、门禁和迁移裁决"
    );
}

#[test]
fn 后端迁移门面只能变薄不能变厚() {
    let budgets = [
        ("src/契约.rs", 328usize),
        ("src/用例.rs", 1445usize),
        ("src/适配.rs", 861usize),
        ("src/外壳.rs", 1676usize),
        ("src/实时外壳.rs", 7usize),
    ];

    for (path, budget) in budgets {
        let lines = 统计物理行数(path);
        assert!(
            lines <= budget,
            "{path} 当前 {lines} 行，超过迁移门面预算 {budget}；迁移门面只允许变薄，不允许继续长胖"
        );
    }
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
