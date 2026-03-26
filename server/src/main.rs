use sqlx::PgPool;

#[tokio::main]
async fn main() {
    let database_url = std::env::var("DATABASE_URL").expect("缺少 DATABASE_URL");
    let pool = PgPool::connect(&database_url)
        .await
        .expect("数据库连接失败");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .expect("服务端口绑定失败");

    axum::serve(listener, koko_server::app::build_app(pool))
        .await
        .expect("服务运行失败");
}
