use std::fs;
use std::path::Path;

fn 读取(path: &str) -> String {
    fs::read_to_string(Path::new(path)).expect("应能读取架构边界目标文件")
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
