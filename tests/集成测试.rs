use serial_test::serial;
use std::env;

#[test]
#[serial]
fn 启动缺配置即失败() {
    let keys = ["DATABASE_URL", "ADMIN_PASSWORD", "APP_PORT", "RUST_LOG"];
    let backup = 备份并清空环境变量(&keys);

    let result = koko::assembly::读取配置();
    assert!(result.is_err(), "缺关键配置时必须失败");

    恢复环境变量(backup);
}

fn 备份并清空环境变量(keys: &[&str]) -> Vec<(String, Option<String>)> {
    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
        out.push(((*key).to_string(), env::var(key).ok()));
        env::remove_var(key);
    }
    out
}

fn 恢复环境变量(backup: Vec<(String, Option<String>)>) {
    for (key, value) in backup {
        match value {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
    }
}
