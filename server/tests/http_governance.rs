use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use tower::ServiceExt;
use uuid::Uuid;

const TEST_ADMIN_PASSWORD: &str = "test-admin-password";
const TEST_ADMIN_AUTHORIZATION: &str = "Basic YWRtaW46dGVzdC1hZG1pbi1wYXNzd29yZA==";

fn build_admin_app(pool: PgPool) -> axum::Router {
    koko_server::app::build_app_with_admin_auth(
        pool,
        koko_server::app::AdminAuthConfig::configured("admin", TEST_ADMIN_PASSWORD),
    )
}

fn with_admin(request: Request<Body>) -> Request<Body> {
    let (mut parts, body) = request.into_parts();
    parts.headers.insert(
        "authorization",
        TEST_ADMIN_AUTHORIZATION
            .parse()
            .expect("测试 Basic Auth 头应合法"),
    );
    Request::from_parts(parts, body)
}

#[sqlx::test(migrations = "../migrations")]
async fn 管理接口缺少管理令牌时应拒绝访问(pool: PgPool) {
    let app = build_admin_app(pool.clone());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/admin/policy")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "max_message_length": 4,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../migrations")]
async fn 后台密码未配置时管理接口应返回五零三(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());

    let response = app
        .oneshot(with_admin(
            Request::builder()
                .method("POST")
                .uri("/admin/policy")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "max_message_length": 4,
                    })
                    .to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[sqlx::test(migrations = "../migrations")]
async fn 提升管理员接口应更新成员角色(pool: PgPool) {
    let app = build_admin_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    let response = app
        .oneshot(with_admin(
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
        ))
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
    let app = build_admin_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    let mute = app
        .clone()
        .oneshot(with_admin(
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
        ))
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
    let app = build_admin_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    let response = app
        .oneshot(with_admin(
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
        ))
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

#[sqlx::test(migrations = "../migrations")]
async fn 更新全局消息长度后超长消息应被拒绝(pool: PgPool) {
    let app = build_admin_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    let update_policy = app
        .clone()
        .oneshot(with_admin(
            Request::builder()
                .method("POST")
                .uri("/admin/policy")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "max_message_length": 4,
                    })
                    .to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();

    assert_eq!(update_policy.status(), StatusCode::OK);

    let send = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "sender_id": member_id.to_string(),
                        "content": "hello",
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
async fn 房间被封禁后应拒绝新入房和发言但保留已有成员查看权限(
    pool: PgPool,
) {
    let app = build_admin_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let joiner_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;
    insert_profile(&pool, joiner_id, "joiner-device").await;

    let banned_until = (OffsetDateTime::now_utc() + Duration::hours(1))
        .format(&Rfc3339)
        .unwrap();

    let ban = app
        .clone()
        .oneshot(with_admin(
            Request::builder()
                .method("POST")
                .uri(format!("/admin/rooms/{room_id}/ban"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "banned_until": banned_until,
                        "ban_reason": "spam cleanup",
                    })
                    .to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();

    assert_eq!(ban.status(), StatusCode::OK);

    let existing_member_join = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/rooms/join-or-create")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "profile_id": member_id.to_string(),
                        "code": "8H901",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(existing_member_join.status(), StatusCode::OK);

    let join = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/rooms/join-or-create")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "profile_id": joiner_id.to_string(),
                        "code": "8H901",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(join.status(), StatusCode::FORBIDDEN);

    let send = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "sender_id": owner_id.to_string(),
                        "content": "still talking",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(send.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../migrations")]
async fn 封禁不存在的房间应返回四零四(pool: PgPool) {
    let app = build_admin_app(pool.clone());
    let room_id = Uuid::new_v4();
    let banned_until = (OffsetDateTime::now_utc() + Duration::hours(1))
        .format(&Rfc3339)
        .unwrap();

    let response = app
        .oneshot(with_admin(
            Request::builder()
                .method("POST")
                .uri(format!("/admin/rooms/{room_id}/ban"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "banned_until": banned_until,
                        "ban_reason": "missing room",
                    })
                    .to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "../migrations")]
async fn 后台概览接口应返回核心统计(pool: PgPool) {
    let app = build_admin_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    sqlx::query!(
        r#"
        INSERT INTO messages (id, room_id, sender_id, content, created_at)
        VALUES ($1, $2, $3, $4, NOW() - INTERVAL '1 hour')
        "#,
        Uuid::new_v4(),
        room_id,
        owner_id,
        "overview message",
    )
    .execute(&pool)
    .await
    .unwrap();

    let response = app
        .oneshot(with_admin(
            Request::builder()
                .method("GET")
                .uri("/admin/overview")
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(payload["total_rooms"], 1);
    assert_eq!(payload["total_memberships"], 2);
    assert_eq!(payload["active_rooms_24h"], 1);
    assert_eq!(payload["messages_24h"], 1);
    assert_eq!(payload["online_connections"], 0);
}

#[sqlx::test(migrations = "../migrations")]
async fn 后台房间列表与详情接口应返回封禁和最近消息信息(pool: PgPool) {
    let app = build_admin_app(pool.clone());
    let room_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    seed_room(&pool, room_id, owner_id, member_id).await;

    sqlx::query!(
        r#"
        INSERT INTO messages (id, room_id, sender_id, content, created_at)
        VALUES ($1, $2, $3, $4, NOW() - INTERVAL '5 minute')
        "#,
        Uuid::new_v4(),
        room_id,
        owner_id,
        "detail message",
    )
    .execute(&pool)
    .await
    .unwrap();

    let banned_until = (OffsetDateTime::now_utc() + Duration::hours(1))
        .format(&Rfc3339)
        .unwrap();

    let ban = app
        .clone()
        .oneshot(with_admin(
            Request::builder()
                .method("POST")
                .uri(format!("/admin/rooms/{room_id}/ban"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "banned_until": banned_until,
                        "ban_reason": "ops freeze",
                    })
                    .to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();

    assert_eq!(ban.status(), StatusCode::OK);

    let list = app
        .clone()
        .oneshot(with_admin(
            Request::builder()
                .method("GET")
                .uri("/admin/rooms?code=8H901")
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();

    assert_eq!(list.status(), StatusCode::OK);
    let list_body = to_bytes(list.into_body(), usize::MAX).await.unwrap();
    let list_payload: Value = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_payload["items"].as_array().unwrap().len(), 1);
    assert_eq!(list_payload["items"][0]["room_id"], room_id.to_string());
    assert_eq!(list_payload["items"][0]["code"], "8H901");
    assert_eq!(list_payload["items"][0]["member_count"], 2);
    assert_eq!(list_payload["items"][0]["ban_reason"], "ops freeze");
    assert!(list_payload["items"][0]["last_message_at"].as_str().is_some());
    assert!(list_payload["items"][0]["banned_until"].as_str().is_some());

    let detail = app
        .oneshot(with_admin(
            Request::builder()
                .method("GET")
                .uri(format!("/admin/rooms/{room_id}"))
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();

    assert_eq!(detail.status(), StatusCode::OK);
    let detail_body = to_bytes(detail.into_body(), usize::MAX).await.unwrap();
    let detail_payload: Value = serde_json::from_slice(&detail_body).unwrap();
    assert_eq!(detail_payload["room_id"], room_id.to_string());
    assert_eq!(detail_payload["code"], "8H901");
    assert_eq!(detail_payload["member_count"], 2);
    assert_eq!(detail_payload["ban_reason"], "ops freeze");
    assert!(detail_payload["last_message_at"].as_str().is_some());
    assert!(detail_payload["banned_until"].as_str().is_some());
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

async fn insert_profile(pool: &PgPool, profile_id: Uuid, device_key: &str) {
    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        profile_id,
        device_key
    )
    .execute(pool)
    .await
    .unwrap();
}
