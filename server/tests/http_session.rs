use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test(migrations = "../migrations")]
async fn 引导会话接口应返回会话与资料信息(pool: PgPool) {
    let app = koko_server::app::build_app(pool);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/session/bootstrap")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "device_key": "device-1",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert!(payload["session_id"].as_str().is_some());
    assert!(payload["profile_id"].as_str().is_some());
    assert_eq!(payload["display_name"], "访客-DEVICE-1");
}

#[sqlx::test(migrations = "../migrations")]
async fn 同一设备键重复引导应复用同一资料(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());

    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/session/bootstrap")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "device_key": "repeat-device",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let first_body = to_bytes(first.into_body(), usize::MAX).await.unwrap();
    let first_payload: Value = serde_json::from_slice(&first_body).unwrap();

    let second = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/session/bootstrap")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "device_key": "repeat-device",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let second_body = to_bytes(second.into_body(), usize::MAX).await.unwrap();
    let second_payload: Value = serde_json::from_slice(&second_body).unwrap();

    assert_eq!(first_payload["profile_id"], second_payload["profile_id"]);

    let profile_count = sqlx::query_scalar!(
        "SELECT COUNT(*) AS count FROM profiles WHERE device_key = $1",
        "repeat-device"
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();

    assert_eq!(profile_count, 1);
}
