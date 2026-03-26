use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = "../migrations")]
async fn 提升管理员接口应更新成员角色(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/roles/promote"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "actor_profile_id": owner_id.to_string(),
                        "target_profile_id": member_id.to_string(),
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let role = sqlx::query_scalar!(
        "SELECT role FROM room_members WHERE room_id = $1 AND profile_id = $2",
        room_id,
        member_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(role, "admin");
}

#[sqlx::test(migrations = "../migrations")]
async fn 禁言后发送消息应失败(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    let mute = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/members/{member_id}/mute"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "actor_profile_id": owner_id.to_string(),
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(mute.status(), StatusCode::OK);

    let send = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "sender_id": member_id.to_string(),
                        "content": "still talking",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(send.status(), StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrations = "../migrations")]
async fn 移除成员接口应删除成员关系(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/members/{member_id}/remove"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "actor_profile_id": owner_id.to_string(),
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) AS count FROM room_members WHERE room_id = $1 AND profile_id = $2",
        room_id,
        member_id
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();

    assert_eq!(count, 0);
}

async fn seed_room(pool: &PgPool, room_id: Uuid, owner_id: Uuid, member_id: Uuid) {
    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2), ($3, $4)",
        owner_id,
        "owner-device",
        member_id,
        "member-device"
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO rooms (id, owner_profile_id) VALUES ($1, $2)",
        room_id,
        owner_id
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_codes (room_id, code) VALUES ($1, $2)",
        room_id,
        "8H901"
    )
    .execute(pool)
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
    .execute(pool)
    .await
    .unwrap();
}
