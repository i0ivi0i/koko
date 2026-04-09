# socketioxide 0.18.2 - Docs.rs

- 来源：https://docs.rs/crate/socketioxide/latest
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

DOCS.RS
 socketioxide-0.18.2
 平台 
 功能标志
docs.rs
锈
 
socketioxide 0.18.2 
使用 Rust 语言实现的 Tower Service Socket IO 服务器。
 箱
 
 来源
 
 构建
 
 功能标志
文档
覆盖范围
100%

已记录的157项全部完成
105 个项目中有58 个有示例
尺寸
源代码大小：361.25 kB 
文档大小：32.59 MB 
Ø 构建持续时间
本次发布：1分13秒 
所有版本：1分23秒 
链接
首页
 Totodore/socketioxide
1579 75 10
crates.io
依赖关系
字节 ^1.11
发动机氧化物 ^0.17
期货核心 ^0.3
期货实用值^0.3
http ^1.4
http-body ^1.0
超 ^1.8
matchit ^0.9
pin-project-lite ^0.2
serde ^1.0
socketioxide-core ^0.17
socketioxide-parser-common ^0.17
socketioxide-parser-msgpack ^0.17 可选
状态 ^0.6.0 可选
thiserror ^2.0
东京 ^1.49
塔层 ^0.3
塔台服务 ^0.3
跟踪 ^0.1 可选
axum ^0.8 开发版
codspeed-criterion-compat ^4 开发版
http-body-util ^0.1 开发版
随机数 ^0.10 偏差
serde_json ^1.0 开发版
tokio ^1.49 开发版
tokio-stream ^0.1 开发版
tokio-tungstenite ^0.28 开发版
tokio-util ^0.7 开发版
tracing-subscriber ^0.3 开发版
版本
0.18.2 (2026-02-15)
0.18.1 (2026-01-24)
0.18.0 (2025-10-25)
0.17.2 (2025-06-09)
0.17.1 (2025-05-17)
0.17.0 (2025-05-04)
0.16.3 (2025-06-09)
0.16.2 (2025-03-21)
0.16.1 (2025-01-29)
0.16.0 (2025-01-17)
0.15.2 (2025-06-09)
0.15.1 (2024-11-02)
0.15.0 (2024-10-20)
0.14.1 (2024-08-14)
0.14.0 (2024-06-26)
0.13.1 (2024-05-08)
0.13.0 (2024-05-06)
0.12.0 (2024-03-20)
0.11.1 (2024-03-20)
0.11.0 (2024-03-06)
0.10.2 (2024-01-22)
0.10.1 (2024-01-18)
0.10.0 (2024-01-02)
0.9.1 (2023-12-21)
0.9.0 (2023-12-15)
0.8.0 (2023-12-11)
0.7.3 (2023-12-05)
0.7.2 (2023-11-22)
0.7.1 (2023-11-12)
0.7.0 (2023-11-12)
0.6.0 (2023-10-18)
0.5.1 (2023-10-10)
0.5.0 (2023-09-27)
0.4.1 (2023-08-20)
0.4.0 (2023-08-20)
0.3.0 (2023-06-17)
0.2.0 (2023-05-29)
0.1.0 (2023-05-24)
业主
Socketioxide🚀🦀

这是一个socket.io用 Rust 编写的服务器实现，它与Tower生态系统和 Socketioxide集成Tokio stack。它可以与任何基于 Tower 的服务器框架（例如 Socketioxide、Socket.io、Socket.io 或 Socket.io）集成Axum。Warp您Salvo还Viz可以Hyper使用 Socketioxide 添加任何其他基于 Tower 的中间件，例如 CORS、授权、压缩等tower-http。

  

特征
集成于：
Axum：🏓回声示例
Warp：🏓回声示例
Hyper：🏓回声示例
Salvo：🏓回声示例
Viz：🏓回声示例
开箱即用，支持基于 Tower 的任何其他中间件：
🔓CORS
📁压缩
🔐授权
使用可插拔适配器，轻松实现水平扩展：
Redis / Valkey
MongoDB
更多内容敬请期待……
与Socketioxide 发射器进行远程集群通信
命名空间和动态命名空间
房间
确认并发出确认信息
二进制数据包
轮询和 WebSocket 传输
通用（默认）和 Msgpack 解析器
用于向套接字添加自定义数据的扩展
使用流进行内存高效的HTTP有效负载解析
灵活的类Axum API，用于处理事件。带有提取器，可从处理程序中提取数据。
已通过官方端到端测试套件的充分测试
支持所有 Socket.io 版本：
🔌协议 v5：socket.io.js 从 v3.0.0 到最新版本，默认启用。
🔌协议 v4：基于 engine.io v3，在功能标志下v4（socket.io js 从 v1.0.3 到最新版本）
示例
io.ns("/", |s: SocketRef| {
    s.on("new message", |s: SocketRef, Data::<String>(msg)| {
        let username = s.extensions.get::<Username>().unwrap().clone();
        let msg = Res::Message {
            username,
            message: msg,
        };
        s.broadcast().emit("new message", msg).ok();
    });

    s.on(
        "add user",
        |s: SocketRef, Data::<String>(username), user_cnt: State<UserCnt>| {
            if s.extensions.get::<Username>().is_some() {
                return;
            }
            let num_users = user_cnt.add_user();
            s.extensions.insert(Username(username.clone()));
            s.emit("login", Res::Login { num_users }).ok();

            let res = Res::UserEvent {
                num_users,
                username: Username(username),
            };
            s.broadcast().emit("user joined", res).ok();
        },
    );

    s.on("typing", |s: SocketRef| {
        let username = s.extensions.get::<Username>().unwrap().clone();
        s.broadcast()
            .emit("typing", Res::Username { username })
            .ok();
    });

    s.on("stop typing", |s: SocketRef| {
        let username = s.extensions.get::<Username>().unwrap().clone();
        s.broadcast()
            .emit("stop typing", Res::Username { username })
            .ok();
    });

    s.on_disconnect(|s: SocketRef, user_cnt: State<UserCnt>| {
        if let Some(username) = s.extensions.get::<Username>() {
            let num_users = user_cnt.remove_user();
            let res = Res::UserEvent {
                num_users,
                username: username.clone(),
            };
            s.broadcast().emit("user left", res).ok();
        }
    });
});

use axum::routing::get;
use serde_json::Value;
use socketioxide::{
    extract::{AckSender, Bin, Data, SocketRef},
    SocketIo,
};
use tracing::info;
use tracing_subscriber::FmtSubscriber;

fn on_connect(socket: SocketRef, Data(data): Data<Value>) {
    info!("Socket.IO connected: {:?} {:?}", socket.ns(), socket.id);
    socket.emit("auth", data).ok();

    socket.on(
        "message",
        |socket: SocketRef, Data::<Value>(data), Bin(bin)| {
            info!("Received event: {:?} {:?}", data, bin);
            socket.bin(bin).emit("message-back", data).ok();
        },
    );

    socket.on(
        "message-with-ack",
        |Data::<Value>(data), ack: AckSender, Bin(bin)| {
            info!("Received event: {:?} {:?}", data, bin);
            ack.bin(bin).send(data).ok();
        },
    );
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing::subscriber::set_global_default(FmtSubscriber::default())?;

    let (layer, io) = SocketIo::new_layer();

    io.ns("/", on_connect);
    io.ns("/custom", on_connect);

    let app = axum::Router::new()
        .route("/", get(|| async { "Hello, World!" }))
        .layer(layer);

    info!("Starting server");

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();

    Ok(())
}

投稿与反馈/问题

欢迎任何形式的贡献，请随时提交 issue 或 PR。如果您想贡献代码但不知道从何入手，可以查看issues 列表。

如果您有任何问题或反馈意见，请在讨论页面开帖。

许可证🔐

本项目采用MIT 许可证。

