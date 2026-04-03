use super::*;

#[sqlx::test]
async fn join_requires_bootstrapped_session(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/rooms/join")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "room_code": "C1234",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    Ok(())
}

#[sqlx::test]
async fn bootstrap_session_sets_cookie_and_reuses_it_on_followup_request(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

    let first_response = bootstrap_session_response(&harness, None).await;
    assert_eq!(first_response.status(), StatusCode::CREATED);

    let first_set_cookie = first_response
        .headers()
        .get(SET_COOKIE)
        .expect("bootstrap should return Set-Cookie for a reusable anonymous session")
        .to_str()
        .unwrap()
        .to_string();
    let first_session: BootstrapSession = serde_json::from_slice(
        &to_bytes(first_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let cookie_value = first_set_cookie
        .split(';')
        .next()
        .expect("Set-Cookie should contain a cookie pair")
        .to_string();
    let second_response = bootstrap_session_response(&harness, Some(cookie_value.as_str())).await;
    assert_eq!(second_response.status(), StatusCode::CREATED);

    let second_session: BootstrapSession = serde_json::from_slice(
        &to_bytes(second_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(second_session.session_id, first_session.session_id);
    Ok(())
}

#[sqlx::test]
async fn bootstrap_session_tolerates_invalid_existing_koko_session_cookie(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

    let response = bootstrap_session_response(&harness, Some("koko_session=not-a-uuid")).await;

    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(response.headers().get(SET_COOKIE).is_some());
    Ok(())
}

#[test]
fn bootstrap_session_cookie_path_does_not_apply_admin_cookie_secure_yet() {
    let http_source =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/http.rs")).unwrap();
    assert!(!http_source.contains(".secure("));
}

