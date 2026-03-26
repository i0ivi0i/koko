use std::net::SocketAddr;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

#[sqlx::test(migrations = "../migrations")]
async fn 房间成员发送消息后其他成员应收到广播(pool: PgPool) {
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2), ($3, $4)",
        owner_id,
        "owner-device",
        member_id,
        "member-device"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO rooms (id, owner_profile_id) VALUES ($1, $2)",
        room_id,
        owner_id
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_codes (room_id, code) VALUES ($1, $2)",
        room_id,
        "1A234"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_members (room_id, profile_id, role) VALUES ($1, $2, $3), ($1, $4, $5)",
        room_id,
        owner_id,
        "owner",
        member_id,
        "member"
    )
    .execute(&pool)
    .await
    .unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let owner_url = ws_url(address, room_id, owner_id);
    let member_url = ws_url(address, room_id, member_id);

    let (mut owner_socket, _) = connect_async(owner_url).await.unwrap();
    let (mut member_socket, _) = connect_async(member_url).await.unwrap();

    owner_socket
        .send(Message::Text(
            json!({
                "type": "send_message",
                "content": "hello",
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let message = member_socket.next().await.unwrap().unwrap();
    let Message::Text(text) = message else {
        panic!("expected text message");
    };
    let payload: Value = serde_json::from_str(&text).unwrap();

    assert_eq!(payload["type"], "message_created");
    assert_eq!(payload["room_id"], room_id.to_string());
    assert_eq!(payload["sender_id"], owner_id.to_string());
    assert_eq!(payload["content"], "hello");

    server.abort();
}

fn ws_url(address: SocketAddr, room_id: Uuid, profile_id: Uuid) -> String {
    format!("ws://{address}/ws/rooms/{room_id}?profile_id={profile_id}")
}
