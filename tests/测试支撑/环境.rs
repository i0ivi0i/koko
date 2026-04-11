use std::env;
use std::net::TcpListener;
use tokio::time::{sleep, Duration};

/// 先备份再清空，确保测试结束后能完整恢复本机环境，避免污染开发机。
pub fn 备份并清空环境变量(keys: &[&str]) -> Vec<(String, Option<String>)> {
    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
        out.push(((*key).to_string(), env::var(key).ok()));
        env::remove_var(key);
    }
    out
}

/// 按备份回放：有值就恢复、无值就移除，保持测试前后的环境一致性。
pub fn 恢复环境变量(backup: Vec<(String, Option<String>)>) {
    for (key, value) in backup {
        match value {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
    }
}

/// 申请一个当前空闲的本地端口，专门服务需要真实监听套接字的测试。
pub fn 分配测试端口() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("应能申请临时端口");
    let port = listener.local_addr().expect("应能读取本地地址").port();
    drop(listener);
    port
}

/// 等待服务真正开始监听，避免测试在 server 尚未 ready 时就先发请求。
pub async fn 等待端口开始监听(port: u16) {
    for _ in 0..40 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return;
        }
        sleep(Duration::from_millis(200)).await;
    }
    panic!("服务未在预期时间内开始监听端口: {port}");
}

/// 等待服务释放监听端口，确认优雅停机没有留下僵尸监听器。
pub async fn 等待端口停止监听(port: u16) {
    for _ in 0..40 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err()
        {
            return;
        }
        sleep(Duration::from_millis(200)).await;
    }
    panic!("服务收到关闭信号后仍未释放端口: {port}");
}
