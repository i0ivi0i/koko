use sqlx::PgPool;
use tracing::info;

#[tokio::main]
async fn main() {
    koko_server::logging::init_tracing();

    let database_url = std::env::var("DATABASE_URL").expect("缺少 DATABASE_URL");
    info!("正在连接数据库");
    let pool = PgPool::connect(&database_url)
        .await
        .expect("数据库连接失败");
    info!("数据库连接已建立");

    let bind_addr = server_bind_addr();
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("服务端口绑定失败");
    info!(bind = bind_addr, "服务开始监听");

    axum::serve(listener, koko_server::app::build_app(pool))
        .await
        .expect("服务运行失败");
}

fn server_bind_addr() -> String {
    std::env::var("SERVER_BIND").unwrap_or_else(|_| "0.0.0.0:3000".to_owned())
}

#[cfg(test)]
mod tests {
    use super::server_bind_addr;

    #[test]
    fn server_bind_addr_should_default_to_lan_friendly_bind() {
        unsafe {
            std::env::remove_var("SERVER_BIND");
        }

        assert_eq!(server_bind_addr(), "0.0.0.0:3000");
    }

    #[test]
    fn server_bind_addr_should_use_environment_override() {
        unsafe {
            std::env::set_var("SERVER_BIND", "127.0.0.1:3900");
        }

        assert_eq!(server_bind_addr(), "127.0.0.1:3900");

        unsafe {
            std::env::remove_var("SERVER_BIND");
        }
    }
}
