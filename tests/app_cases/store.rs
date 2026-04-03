use super::*;

#[sqlx::test]
async fn join_or_create_persists_room_member_and_room_code(pool: PgPool) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let session_id = Uuid::now_v7();
    let room_code = unique_room_code('a');
    harness.seed_active_session(session_id).await;

    let snapshot = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: room_code.clone(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.room_code, room_code.to_ascii_uppercase());
    assert!(snapshot.messages.is_empty());
    let persisted_room_id = harness.room_id_by_code(&room_code).await;
    assert_eq!(snapshot.room_id, persisted_room_id);
    assert_eq!(harness.member_count(snapshot.room_id, session_id).await, 1);
    Ok(())
}

#[sqlx::test]
async fn send_text_message_persists_message_and_room_snapshot_reads_it(
    pool: PgPool,
) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let session_id = Uuid::now_v7();
    let room_code = unique_room_code('b');
    let message_id = Uuid::now_v7();
    let now = fixed_time();
    harness.seed_active_session(session_id).await;

    let joined = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code,
            session_id,
        },
    )
    .await
    .unwrap();

    let event = send_text_message(
        &harness.store,
        &harness.store,
        &harness.store,
        &FakeIdGenerator::new(message_id),
        &FakeClock::new(now),
        SendTextMessageInput {
            room_id: joined.room_id,
            session_id,
            body: "  persisted hello  ".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap();

    assert!(matches!(
        event,
        AppEvent::MessageCreated(message_created)
            if message_created.message_id == message_id
                && message_created.room_id == joined.room_id
                && message_created.session_id == session_id
                && message_created.body == "persisted hello"
                && message_created.created_at == now
    ));

    let snapshot = load_room_snapshot(
        &harness.store,
        &harness.store,
        &harness.store,
        LoadRoomSnapshotQuery {
            room_id: joined.room_id,
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.messages[0].message_id, message_id);
    assert_eq!(snapshot.messages[0].body, "persisted hello");
    assert_eq!(
        harness.message_bodies(joined.room_id).await,
        vec!["persisted hello".to_string()]
    );
    Ok(())
}

#[sqlx::test]
async fn join_or_create_treats_room_code_as_case_insensitive(pool: PgPool) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let first_session_id = Uuid::now_v7();
    let second_session_id = Uuid::now_v7();
    let room_code = unique_room_code('c');
    harness.seed_active_session(first_session_id).await;
    harness.seed_active_session(second_session_id).await;

    let first_snapshot = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: room_code.to_ascii_lowercase(),
            session_id: first_session_id,
        },
    )
    .await
    .unwrap();

    let second_snapshot = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: room_code.to_ascii_uppercase(),
            session_id: second_session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(first_snapshot.room_id, second_snapshot.room_id);
    assert_eq!(
        harness
            .member_count(first_snapshot.room_id, first_session_id)
            .await,
        1
    );
    assert_eq!(
        harness
            .member_count(first_snapshot.room_id, second_session_id)
            .await,
        1
    );
    Ok(())
}

#[sqlx::test]
async fn repeated_join_does_not_duplicate_member_in_same_room(pool: PgPool) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let session_id = Uuid::now_v7();
    let room_code = unique_room_code('d');
    harness.seed_active_session(session_id).await;

    let first_snapshot = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: room_code.clone(),
            session_id,
        },
    )
    .await
    .unwrap();

    let second_snapshot = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: room_code.to_ascii_lowercase(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(first_snapshot.room_id, second_snapshot.room_id);
    assert_eq!(
        harness
            .member_count(first_snapshot.room_id, session_id)
            .await,
        1
    );
    Ok(())
}

#[sqlx::test]
async fn pg_store_lists_joined_rooms_with_latest_preview(pool: PgPool) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let session_id = Uuid::now_v7();
    let first_room_code = "A1234".to_string();
    let second_room_code = "B1234".to_string();
    harness.seed_active_session(session_id).await;

    let first_joined = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: first_room_code.clone(),
            session_id,
        },
    )
    .await
    .unwrap();
    let second_joined = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: second_room_code.clone(),
            session_id,
        },
    )
    .await
    .unwrap();

    let _ = send_text_message(
        &harness.store,
        &harness.store,
        &harness.store,
        &FakeIdGenerator::new(Uuid::from_u128(2001)),
        &FakeClock::new(minute_time(1)),
        SendTextMessageInput {
            room_id: second_joined.room_id,
            session_id,
            body: "older preview".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap();
    let _ = send_text_message(
        &harness.store,
        &harness.store,
        &harness.store,
        &FakeIdGenerator::new(Uuid::from_u128(2002)),
        &FakeClock::new(minute_time(2)),
        SendTextMessageInput {
            room_id: first_joined.room_id,
            session_id,
            body: "newer preview".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap();

    let rooms = list_joined_rooms(
        &harness.store,
        &harness.store,
        ListJoinedRoomsQuery { session_id },
    )
    .await
    .unwrap();

    assert_eq!(rooms.len(), 2);
    assert_eq!(rooms[0].room_id, first_joined.room_id);
    assert_eq!(rooms[0].room_code, first_room_code);
    assert_eq!(rooms[0].latest_preview, "newer preview");
    assert_eq!(rooms[1].room_id, second_joined.room_id);
    assert_eq!(rooms[1].room_code, second_room_code);
    assert_eq!(rooms[1].latest_preview, "older preview");
    Ok(())
}

#[sqlx::test]
async fn pg_store_searches_rooms_by_normalized_code_prefix(pool: PgPool) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let joined_session_id = Uuid::now_v7();
    let other_session_id = Uuid::now_v7();
    harness.seed_active_session(joined_session_id).await;
    harness.seed_active_session(other_session_id).await;

    let joined = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id: joined_session_id,
        },
    )
    .await
    .unwrap();
    let discoverable = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1299".to_string(),
            session_id: other_session_id,
        },
    )
    .await
    .unwrap();

    let results = search_rooms_by_code(
        &harness.store,
        &harness.store,
        SearchRoomsByCodeQuery {
            session_id: joined_session_id,
            input: "a12".to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].room_id, joined.room_id);
    assert_eq!(results[0].room_code, "A1234");
    assert!(results[0].is_joined);
    assert_eq!(results[1].room_id, discoverable.room_id);
    assert_eq!(results[1].room_code, "A1299");
    assert!(!results[1].is_joined);
    Ok(())
}

#[sqlx::test]
async fn send_text_message_rejects_non_member_sender_via_database_truth(
    pool: PgPool,
) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let session_id = Uuid::now_v7();
    let room_id = Uuid::now_v7();
    let room_code = unique_room_code('e');
    harness.seed_active_session(session_id).await;
    harness.seed_room_with_code(room_id, &room_code, 1).await;

    let error = send_text_message(
        &harness.store,
        &FakeMembershipPort::allow(),
        &harness.store,
        &FakeIdGenerator::new(Uuid::now_v7()),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "database truth".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
    assert_eq!(harness.message_count(room_id).await, 0);
    Ok(())
}

#[sqlx::test]
async fn store_scopes_room_code_lookup_by_code_version_and_snapshot_round_trips_version(
    pool: PgPool,
) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let session_id = Uuid::now_v7();
    let normalized_code = unique_room_code('f');
    let room_v1 = Uuid::now_v7();
    let room_v2 = Uuid::now_v7();
    harness.seed_active_session(session_id).await;
    harness
        .seed_room_with_code(room_v1, &normalized_code, 1)
        .await;
    harness
        .seed_room_with_code(room_v2, &normalized_code, 2)
        .await;

    let mut requested_room_code = RoomCode::new(&normalized_code).unwrap();
    requested_room_code.code_version = 2;
    let mut room_entry = harness
        .store
        .begin_room_entry(&requested_room_code)
        .await
        .unwrap();
    let joined_room_id = room_entry
        .find_room_by_code(&requested_room_code)
        .await
        .unwrap()
        .unwrap();
    room_entry
        .ensure_room_member(&NewMemberRecord {
            member_id: Uuid::now_v7(),
            room_id: joined_room_id,
            session_id,
            joined_at: fixed_time(),
        })
        .await
        .unwrap();
    let messages = room_entry
        .load_recent_messages(joined_room_id, 50)
        .await
        .unwrap();
    room_entry.commit().await.unwrap();

    assert_eq!(joined_room_id, room_v2);
    assert!(messages.is_empty());
    assert_eq!(harness.member_count(room_v2, session_id).await, 1);

    let snapshot = harness.store.load_room_snapshot(room_v2, 50).await.unwrap();

    assert_eq!(snapshot.room_id, room_v2);
    assert_eq!(snapshot.room_code.normalized(), normalized_code);
    assert_eq!(snapshot.room_code.code_version, 2);
    Ok(())
}

#[sqlx::test]
async fn deleting_truth_rows_is_blocked_in_stage_one(pool: PgPool) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool);
    let session_id = Uuid::now_v7();
    let room_code = unique_room_code('g');
    harness.seed_active_session(session_id).await;

    let joined = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code,
            session_id,
        },
    )
    .await
    .unwrap();

    let _ = send_text_message(
        &harness.store,
        &harness.store,
        &harness.store,
        &FakeIdGenerator::new(Uuid::now_v7()),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id: joined.room_id,
            session_id,
            body: "history".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap();

    let room_delete = sqlx::query("DELETE FROM rooms WHERE room_id = $1")
        .bind(joined.room_id)
        .execute(&harness.pool)
        .await;
    let session_delete = sqlx::query("DELETE FROM anonymous_sessions WHERE session_id = $1")
        .bind(session_id)
        .execute(&harness.pool)
        .await;

    assert!(room_delete.is_err());
    assert!(session_delete.is_err());
    Ok(())
}

