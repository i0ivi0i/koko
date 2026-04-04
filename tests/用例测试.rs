use std::io;
use std::sync::{Arc, Mutex};

#[test]
fn 结构化日志字段存在() {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_writer(共享写入器(buffer.clone()))
        .with_target(false)
        .finish();

    tracing::subscriber::with_default(subscriber, || {
        koko::entry::记录命令失败("测试用例", "test_adapter", "bad_request", "示例错误");
    });

    let output = String::from_utf8(buffer.lock().expect("lock").clone()).expect("utf8");
    assert!(
        output.contains("usecase") && output.contains("测试用例"),
        "日志缺少 usecase 字段: {output}"
    );
    assert!(
        output.contains("adapter") && output.contains("test_adapter"),
        "日志缺少 adapter 字段: {output}"
    );
    assert!(
        output.contains("error_code") && output.contains("bad_request"),
        "日志缺少 error_code 字段: {output}"
    );
}

#[derive(Clone)]
struct 共享写入器(Arc<Mutex<Vec<u8>>>);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for 共享写入器 {
    type Writer = 缓冲写入器;

    fn make_writer(&'a self) -> Self::Writer {
        缓冲写入器(self.0.clone())
    }
}

struct 缓冲写入器(Arc<Mutex<Vec<u8>>>);

impl io::Write for 缓冲写入器 {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().expect("lock").extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
