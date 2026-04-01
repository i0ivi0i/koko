use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

use chrono::{DateTime, TimeZone, Utc};
use koko::{
    app::{
        AdminAccessPort, AdminOverviewPort, AdminQueryContext, AdminRoomsPort, AppError, Clock,
        IdGenerator, JoinOrCreateRoomByCodeCommand, JoinedRoomsPort, ListJoinedRoomsQuery,
        LoadRoomSnapshotQuery, MembershipPort, MessageStore, RoomEntryPort, RoomEntryTx,
        RoomSearchPort, RoomSnapshotData, RoomSnapshotPort, SearchRoomsByCodeQuery,
        SendTextMessageInput, SessionBootstrapPort, SessionPort, SubscribeRoomStreamInput,
        bootstrap_anonymous_session, get_admin_overview, join_or_create_room_by_code,
        list_admin_rooms, list_joined_rooms, load_room_snapshot, search_rooms_by_code,
        send_text_message, subscribe_room_stream,
    },
    contract::{
        AppErrorCode, AppEvent, JoinedRoomSummary, MessageView, RoomSearchResult, RoomSnapshot,
        SendTextMessageCommand, SubscribeRoomStreamCommand,
    },
    domain::{
        AnonymousSession, Message, MessageBody, MessageStatus, NewMemberRecord, NewRoomCodeRecord,
        NewRoomRecord, RoomCode, SessionStatus,
    },
    store::PgStore,
    support::{SystemClock, SystemIdGenerator},
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[test]
fn app_error_code_serializes_to_stable_wire_value() {
    assert_eq!(
        serde_json::to_string(&AppErrorCode::InvalidSession).unwrap(),
        "\"invalid_session\""
    );
    assert_eq!(
        serde_json::to_string(&AppErrorCode::InvalidAdminToken).unwrap(),
        "\"invalid_admin_token\""
    );
}

#[test]
fn app_event_serializes_to_tagged_wire_format() {
    let json = serde_json::to_string(&AppEvent::MessageCreated(koko::contract::MessageCreated {
        message_id: Uuid::from_u128(1),
        room_id: Uuid::from_u128(2),
        session_id: Uuid::from_u128(3),
        body: "hello".to_string(),
        created_at: fixed_time(),
        client_message_id: Some(Uuid::from_u128(4)),
    }))
    .unwrap();

    assert_eq!(
        json,
        "{\"type\":\"message_created\",\"payload\":{\"message_id\":\"00000000-0000-0000-0000-000000000001\",\"room_id\":\"00000000-0000-0000-0000-000000000002\",\"session_id\":\"00000000-0000-0000-0000-000000000003\",\"body\":\"hello\",\"created_at\":\"2026-03-30T12:00:00Z\",\"client_message_id\":\"00000000-0000-0000-0000-000000000004\"}}"
    );
}

#[test]
fn subscribe_room_stream_command_serializes_without_session_id() {
    let json = serde_json::to_string(&SubscribeRoomStreamCommand {
        room_id: Uuid::from_u128(1),
    })
    .unwrap();

    assert_eq!(
        json,
        "{\"room_id\":\"00000000-0000-0000-0000-000000000001\"}"
    );
}

#[test]
fn send_text_message_command_serializes_without_session_id() {
    let json = serde_json::to_string(&SendTextMessageCommand {
        room_id: Uuid::from_u128(2),
        body: "hello".to_string(),
        client_message_id: Some(Uuid::from_u128(3)),
    })
    .unwrap();

    assert_eq!(
        json,
        "{\"room_id\":\"00000000-0000-0000-0000-000000000002\",\"body\":\"hello\",\"client_message_id\":\"00000000-0000-0000-0000-000000000003\"}"
    );
}

#[test]
fn joined_room_queries_live_in_contract_with_stable_wire_shape() {
    let list_json = serde_json::to_string(&koko::contract::ListJoinedRoomsQuery {
        session_id: Uuid::from_u128(10),
    })
    .unwrap();
    let search_json = serde_json::to_string(&koko::contract::SearchRoomsByCodeQuery {
        session_id: Uuid::from_u128(11),
        input: " a1234 ".to_string(),
    })
    .unwrap();

    assert_eq!(
        list_json,
        "{\"session_id\":\"00000000-0000-0000-0000-00000000000a\"}"
    );
    assert_eq!(
        search_json,
        "{\"session_id\":\"00000000-0000-0000-0000-00000000000b\",\"input\":\" a1234 \"}"
    );
}

#[tokio::test]
async fn admin_overview_requires_authorized_admin_context() {
    let error = get_admin_overview(
        &FakeAdminAccessPort::deny(),
        &FakeAdminOverviewPort::default(),
        AdminQueryContext::new("wrong-token".to_string()),
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidAdminToken);
}

#[tokio::test]
async fn admin_rooms_requires_authorized_admin_context() {
    let error = list_admin_rooms(
        &FakeAdminAccessPort::deny(),
        &FakeAdminRoomsPort::default(),
        AdminQueryContext::new("wrong-token".to_string()),
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidAdminToken);
}

#[tokio::test]
async fn bootstrap_anonymous_session_reuses_existing_session_when_present() {
    let existing_session_id = Uuid::from_u128(100);
    let now = fixed_time();
    let existing_session = AnonymousSession {
        session_id: existing_session_id,
        issued_at: now,
        last_seen_at: now,
        status: SessionStatus::Active,
    };
    let bootstrap_port = FakeSessionBootstrapPort::with_existing(existing_session.clone());

    let session = bootstrap_anonymous_session(
        &bootstrap_port,
        &FakeClock::new(now),
        Some(existing_session_id),
        Uuid::from_u128(101),
    )
    .await
    .unwrap();

    assert_eq!(session.session_id, existing_session_id);
    assert_eq!(bootstrap_port.loaded_session_ids(), vec![existing_session_id]);
}

#[tokio::test]
async fn bootstrap_anonymous_session_refreshes_existing_session_state_when_reused() {
    let existing_session_id = Uuid::from_u128(102);
    let original_time = Utc.with_ymd_and_hms(2026, 3, 30, 11, 55, 0).unwrap();
    let reuse_time = fixed_time();
    let existing_session = AnonymousSession {
        session_id: existing_session_id,
        issued_at: original_time,
        last_seen_at: original_time,
        status: SessionStatus::Active,
    };
    let bootstrap_port = FakeSessionBootstrapPort::with_existing(existing_session.clone());

    let session = bootstrap_anonymous_session(
        &bootstrap_port,
        &FakeClock::new(reuse_time),
        Some(existing_session_id),
        Uuid::from_u128(103),
    )
    .await
    .unwrap();

    assert_eq!(session.session_id, existing_session_id);
    assert_eq!(session.issued_at, original_time);
    assert_eq!(session.last_seen_at, reuse_time);
    assert_eq!(bootstrap_port.loaded_session_ids(), vec![existing_session_id]);
    assert_eq!(bootstrap_port.saved_sessions().len(), 1);
    assert_eq!(bootstrap_port.saved_sessions()[0].session_id, existing_session_id);
    assert_eq!(bootstrap_port.saved_sessions()[0].last_seen_at, reuse_time);
}

#[tokio::test]
async fn send_text_message_returns_message_created_event() {
    let room_id = Uuid::from_u128(1);
    let session_id = Uuid::from_u128(2);
    let client_message_id = Uuid::from_u128(3);
    let message_id = Uuid::from_u128(4);
    let now = fixed_time();
    let store = FakeMessageStore::persisting(MessageStoreOutcome::same());

    let event = send_text_message(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &store,
        &FakeIdGenerator::new(message_id),
        &FakeClock::new(now),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "  hello koko  ".to_string(),
            client_message_id: Some(client_message_id),
        },
    )
    .await
    .unwrap();

    assert_eq!(store.recorded_bodies(), vec!["hello koko".to_string()]);
    assert!(matches!(
        event,
        AppEvent::MessageCreated(message_created)
            if message_created.message_id == message_id
                && message_created.room_id == room_id
                && message_created.session_id == session_id
                && message_created.body == "hello koko"
                && message_created.created_at == now
                && message_created.client_message_id == Some(client_message_id)
    ));
}

#[tokio::test]
async fn send_text_message_rejects_inactive_session() {
    let room_id = Uuid::from_u128(11);
    let session_id = Uuid::from_u128(12);
    let store = FakeMessageStore::persisting(MessageStoreOutcome::same());

    let error = send_text_message(
        &FakeSessionPort::deny(),
        &FakeMembershipPort::allow(),
        &store,
        &FakeIdGenerator::new(Uuid::from_u128(13)),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "hello".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidSession);
    assert_eq!(error, AppError::SessionNotActive { session_id });
    assert!(store.recorded_bodies().is_empty());
}

#[tokio::test]
async fn send_text_message_rejects_non_member() {
    let room_id = Uuid::from_u128(21);
    let session_id = Uuid::from_u128(22);
    let store = FakeMessageStore::persisting(MessageStoreOutcome::same());

    let error = send_text_message(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::deny(),
        &store,
        &FakeIdGenerator::new(Uuid::from_u128(23)),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "hello".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::MembershipRequired);
    assert_eq!(
        error,
        AppError::NotRoomMember {
            room_id,
            session_id
        }
    );
    assert!(store.recorded_bodies().is_empty());
}

#[tokio::test]
async fn send_text_message_rejects_persisted_message_drift() {
    let room_id = Uuid::from_u128(24);
    let session_id = Uuid::from_u128(25);

    let error = send_text_message(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &FakeMessageStore::persisting(MessageStoreOutcome::rewrite_body("drifted")),
        &FakeIdGenerator::new(Uuid::from_u128(26)),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "hello".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
}

#[tokio::test]
async fn send_text_message_rejects_empty_body() {
    let error = send_text_message(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &FakeMessageStore::persisting(MessageStoreOutcome::same()),
        &FakeIdGenerator::new(Uuid::from_u128(27)),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id: Uuid::from_u128(28),
            session_id: Uuid::from_u128(29),
            body: "   ".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidMessageBody);
}

#[tokio::test]
async fn join_or_create_room_by_code_returns_snapshot_after_join() {
    let session_id = Uuid::from_u128(31);
    let room_id = Uuid::from_u128(32);
    let join_port = FakeRoomEntryPort::missing_room(sample_snapshot_data(
        room_id,
        "A1234",
        vec![sample_message(
            Uuid::from_u128(33),
            room_id,
            session_id,
            "hello",
        )],
    ));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &FakeIdGenerator::new_room_entry(room_id, Uuid::from_u128(3201), Uuid::from_u128(3202), Uuid::from_u128(3203)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        join_port.operations(),
        vec![
            "find_room_by_code",
            "create_room",
            "ensure_room_member",
            "load_recent_messages",
            "commit",
        ]
    );
    assert_eq!(snapshot, expected_snapshot(room_id, session_id, "hello"));
}

#[tokio::test]
async fn join_or_create_room_by_code_generates_room_and_member_facts_in_application() {
    let now = fixed_time();
    let join_port = FakeRoomEntryPort::missing_room(sample_snapshot_data(
        Uuid::from_u128(11),
        "A1234",
        vec![],
    ));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &FakeIdGenerator::new_room_entry(
            Uuid::from_u128(11),
            Uuid::from_u128(12),
            Uuid::from_u128(13),
            Uuid::from_u128(14),
        ),
        &FakeClock::new(now),
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id: Uuid::from_u128(99),
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.room_id, Uuid::from_u128(11));
    assert_eq!(join_port.recorded_room_code_id(), Some(Uuid::from_u128(12)));
    assert_eq!(join_port.recorded_member_id(), Some(Uuid::from_u128(13)));
    assert_eq!(join_port.recorded_room_created_at(), Some(now));
    assert_eq!(join_port.recorded_room_code_created_at(), Some(now));
    assert_eq!(join_port.recorded_member_joined_at(), Some(now));
}

#[tokio::test]
async fn join_or_create_room_by_code_reuses_existing_room_without_recreating_it() {
    let session_id = Uuid::from_u128(34);
    let room_id = Uuid::from_u128(35);
    let join_port =
        FakeRoomEntryPort::existing_room(sample_snapshot_data(room_id, "A1234", vec![]));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(3401), Uuid::from_u128(3402), Uuid::from_u128(3403), Uuid::from_u128(3404)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.room_id, room_id);
    assert_eq!(
        join_port.operations(),
        vec![
            "find_room_by_code",
            "ensure_room_member",
            "load_recent_messages",
            "commit",
        ]
    );
}

#[tokio::test]
async fn join_or_create_room_by_code_rejects_invalid_room_code() {
    let error = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &FakeRoomEntryPort::existing_room(sample_snapshot_data(
            Uuid::from_u128(36),
            "A1234",
            vec![],
        )),
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(3601), Uuid::from_u128(3602), Uuid::from_u128(3603), Uuid::from_u128(3604)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "ABCDE".to_string(),
            session_id: Uuid::from_u128(37),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidRoomCode);
}

#[tokio::test]
async fn join_or_create_room_by_code_rejects_mismatched_room_code_snapshot() {
    let error = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &FakeRoomEntryPort::existing_room(sample_snapshot_data(
            Uuid::from_u128(38),
            "B1234",
            vec![],
        )),
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(3801), Uuid::from_u128(3802), Uuid::from_u128(3803), Uuid::from_u128(3804)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id: Uuid::from_u128(39),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
}

#[tokio::test]
async fn join_or_create_room_by_code_rejects_inactive_session() {
    let session_id = Uuid::from_u128(34);
    let join_port = FakeRoomEntryPort::existing_room(sample_snapshot_data(
        Uuid::from_u128(35),
        "A1234",
        vec![],
    ));

    let error = join_or_create_room_by_code(
        &FakeSessionPort::deny(),
        &join_port,
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(3901), Uuid::from_u128(3902), Uuid::from_u128(3903), Uuid::from_u128(3904)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidSession);
    assert!(join_port.operations().is_empty());
}

#[tokio::test]
async fn join_or_create_room_by_code_skips_commit_when_member_write_fails() {
    let session_id = Uuid::from_u128(40);
    let join_port = FakeRoomEntryPort::member_failure(sample_snapshot_data(
        Uuid::from_u128(41),
        "A1234",
        vec![],
    ));

    let error = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(4001), Uuid::from_u128(4002), Uuid::from_u128(4003), Uuid::from_u128(4004)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
    assert_eq!(
        join_port.operations(),
        vec!["find_room_by_code", "ensure_room_member"]
    );
}

#[tokio::test]
async fn list_joined_rooms_returns_member_rooms_sorted_by_latest_message() {
    let session_id = Uuid::from_u128(540);
    let rooms_port = FakeJoinedRoomsPort::with_rooms(vec![
        joined_room_summary(Uuid::from_u128(541), "C1234", "third", None),
        joined_room_summary(
            Uuid::from_u128(542),
            "A1234",
            "first",
            Some(minute_time(2)),
        ),
        joined_room_summary(
            Uuid::from_u128(543),
            "B1234",
            "second",
            Some(minute_time(1)),
        ),
    ]);

    let rooms = list_joined_rooms(
        &FakeSessionPort::allow(),
        &rooms_port,
        ListJoinedRoomsQuery { session_id },
    )
    .await
    .unwrap();

    assert_eq!(rooms_port.requested_session_ids(), vec![session_id]);
    assert_eq!(
        rooms.into_iter().map(|room| room.room_code).collect::<Vec<_>>(),
        vec!["A1234".to_string(), "B1234".to_string(), "C1234".to_string()]
    );
}

#[tokio::test]
async fn list_joined_rooms_returns_empty_for_session_with_no_rooms() {
    let session_id = Uuid::from_u128(544);
    let rooms_port = FakeJoinedRoomsPort::with_rooms(vec![]);

    let rooms = list_joined_rooms(
        &FakeSessionPort::allow(),
        &rooms_port,
        ListJoinedRoomsQuery { session_id },
    )
    .await
    .unwrap();

    assert!(rooms.is_empty());
    assert_eq!(rooms_port.requested_session_ids(), vec![session_id]);
}

#[tokio::test]
async fn search_rooms_by_code_matches_case_insensitive_prefix_and_marks_membership() {
    let session_id = Uuid::from_u128(545);
    let search_port = FakeRoomSearchPort::with_results(vec![
        room_search_result(
            Uuid::from_u128(546),
            "A1234",
            "joined room",
            Some(minute_time(1)),
            true,
        ),
        room_search_result(
            Uuid::from_u128(547),
            "A1299",
            "candidate room",
            None,
            false,
        ),
    ]);

    let results = search_rooms_by_code(
        &FakeSessionPort::allow(),
        &search_port,
        SearchRoomsByCodeQuery {
            session_id,
            input: "a12".to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(search_port.requested_session_ids(), vec![session_id]);
    assert_eq!(search_port.requested_inputs(), vec!["a12".to_string()]);
    assert_eq!(
        results
            .into_iter()
            .map(|room| (room.room_code, room.is_joined))
            .collect::<Vec<_>>(),
        vec![
            ("A1234".to_string(), true),
            ("A1299".to_string(), false),
        ]
    );
}

#[tokio::test]
async fn search_rooms_by_code_prioritizes_exact_hit_then_joined_rooms() {
    let session_id = Uuid::from_u128(548);
    let search_port = FakeRoomSearchPort::with_results(vec![
        room_search_result(
            Uuid::from_u128(549),
            "A1200",
            "joined newer",
            Some(minute_time(3)),
            true,
        ),
        room_search_result(
            Uuid::from_u128(550),
            "A1234",
            "exact hit",
            Some(minute_time(2)),
            false,
        ),
        room_search_result(
            Uuid::from_u128(551),
            "A1299",
            "not joined",
            Some(minute_time(4)),
            false,
        ),
    ]);

    let results = search_rooms_by_code(
        &FakeSessionPort::allow(),
        &search_port,
        SearchRoomsByCodeQuery {
            session_id,
            input: "a1234".to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        results.into_iter().map(|room| room.room_code).collect::<Vec<_>>(),
        vec![
            "A1234".to_string(),
            "A1200".to_string(),
            "A1299".to_string(),
        ]
    );
}

#[tokio::test]
async fn load_room_snapshot_returns_messages_for_member() {
    let room_id = Uuid::from_u128(41);
    let session_id = Uuid::from_u128(42);
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        vec![sample_message(
            Uuid::from_u128(43),
            room_id,
            session_id,
            "hello again",
        )],
    ));

    let snapshot = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot_port.requested_limits(), vec![50]);
    assert_eq!(snapshot.room_id, room_id);
    assert_eq!(snapshot.room_code, "A1234");
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.messages[0].body, "hello again");
}

#[tokio::test]
async fn load_room_snapshot_sorts_and_truncates_to_latest_fifty_messages() {
    let room_id = Uuid::from_u128(430);
    let session_id = Uuid::from_u128(431);
    let mut messages: Vec<_> = (0..55)
        .map(|index| {
            sample_message_at(
                Uuid::from_u128(500 + index),
                room_id,
                session_id,
                &format!("message {index}"),
                index,
            )
        })
        .collect();
    messages.reverse();
    let snapshot_port =
        FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(room_id, "A1234", messages));

    let snapshot = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.messages.len(), 50);
    assert_eq!(snapshot.messages.first().unwrap().body, "message 5");
    assert_eq!(snapshot.messages.last().unwrap().body, "message 54");
}

#[tokio::test]
async fn load_room_snapshot_rejects_inactive_session() {
    let room_id = Uuid::from_u128(44);
    let session_id = Uuid::from_u128(45);
    let snapshot_port =
        FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(room_id, "A1234", vec![]));

    let error = load_room_snapshot(
        &FakeSessionPort::deny(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidSession);
    assert!(snapshot_port.requested_limits().is_empty());
}

#[tokio::test]
async fn load_room_snapshot_rejects_non_member() {
    let room_id = Uuid::from_u128(46);
    let session_id = Uuid::from_u128(47);
    let snapshot_port =
        FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(room_id, "A1234", vec![]));

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::deny(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::MembershipRequired);
    assert!(snapshot_port.requested_limits().is_empty());
}

#[tokio::test]
async fn load_room_snapshot_rejects_mismatched_room_snapshot() {
    let requested_room_id = Uuid::from_u128(48);
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        Uuid::from_u128(49),
        "A1234",
        vec![],
    ));

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id: requested_room_id,
            session_id: Uuid::from_u128(50),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
}

#[tokio::test]
async fn load_room_snapshot_rejects_snapshot_with_foreign_room_messages() {
    let requested_room_id = Uuid::from_u128(53);
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        requested_room_id,
        "A1234",
        vec![sample_message(
            Uuid::from_u128(54),
            Uuid::from_u128(55),
            Uuid::from_u128(56),
            "foreign",
        )],
    ));

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id: requested_room_id,
            session_id: Uuid::from_u128(57),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
}

#[tokio::test]
async fn load_room_snapshot_propagates_internal_error_code_for_dependency_failure() {
    let room_id = Uuid::from_u128(51);
    let session_id = Uuid::from_u128(52);

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &FakeRoomSnapshotPort::failing(),
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
    assert!(matches!(error, AppError::DependencyFailure));
}

#[tokio::test]
async fn subscribe_room_stream_accepts_active_member() {
    subscribe_room_stream(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        SubscribeRoomStreamInput {
            room_id: Uuid::from_u128(58),
            session_id: Uuid::from_u128(59),
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn subscribe_room_stream_rejects_non_member() {
    let room_id = Uuid::from_u128(60);
    let session_id = Uuid::from_u128(61);

    let error = subscribe_room_stream(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::deny(),
        SubscribeRoomStreamInput {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(
        error,
        AppError::NotRoomMember {
            room_id,
            session_id
        }
    );
    assert_eq!(error.code(), AppErrorCode::MembershipRequired);
}

#[sqlx::test]
async fn join_or_create_persists_room_member_and_room_code(pool: PgPool) -> sqlx::Result<()> {
    let harness = PgHarness::new(pool).await;
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
    let harness = PgHarness::new(pool).await;
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
    let harness = PgHarness::new(pool).await;
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
    let harness = PgHarness::new(pool).await;
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
    let harness = PgHarness::new(pool).await;
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
    let harness = PgHarness::new(pool).await;
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
    let harness = PgHarness::new(pool).await;
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
    let harness = PgHarness::new(pool).await;
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
    let harness = PgHarness::new(pool).await;
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

#[derive(Debug)]
struct FakeSessionPort {
    allowed: bool,
}

impl FakeSessionPort {
    fn allow() -> Self {
        Self { allowed: true }
    }

    fn deny() -> Self {
        Self { allowed: false }
    }
}

impl SessionPort for FakeSessionPort {
    async fn is_active_session(&self, _session_id: Uuid) -> Result<bool, AppError> {
        Ok(self.allowed)
    }
}

#[derive(Debug)]
struct FakeAdminAccessPort {
    authorized: bool,
}

impl FakeAdminAccessPort {
    fn deny() -> Self {
        Self { authorized: false }
    }
}

impl AdminAccessPort for FakeAdminAccessPort {
    async fn is_authorized_admin(
        &self,
        _context: &AdminQueryContext,
    ) -> Result<bool, AppError> {
        Ok(self.authorized)
    }
}

#[derive(Debug, Default)]
struct FakeAdminOverviewPort;

impl AdminOverviewPort for FakeAdminOverviewPort {
    async fn get_admin_overview(
        &self,
    ) -> Result<koko::contract::AdminOverview, AppError> {
        panic!("admin overview port should not be called when admin access is denied");
    }
}

#[derive(Debug, Default)]
struct FakeAdminRoomsPort;

impl AdminRoomsPort for FakeAdminRoomsPort {
    async fn list_admin_rooms(
        &self,
    ) -> Result<Vec<koko::contract::AdminRoomSummary>, AppError> {
        panic!("admin rooms port should not be called when admin access is denied");
    }
}

#[derive(Debug)]
struct FakeMembershipPort {
    allowed: bool,
}

impl FakeMembershipPort {
    fn allow() -> Self {
        Self { allowed: true }
    }

    fn deny() -> Self {
        Self { allowed: false }
    }
}

impl MembershipPort for FakeMembershipPort {
    async fn is_room_member(&self, _room_id: Uuid, _session_id: Uuid) -> Result<bool, AppError> {
        Ok(self.allowed)
    }
}

#[derive(Debug)]
struct FakeJoinedRoomsPort {
    rooms: Vec<JoinedRoomSummary>,
    requested_session_ids: Mutex<Vec<Uuid>>,
}

impl FakeJoinedRoomsPort {
    fn with_rooms(rooms: Vec<JoinedRoomSummary>) -> Self {
        Self {
            rooms,
            requested_session_ids: Mutex::default(),
        }
    }

    fn requested_session_ids(&self) -> Vec<Uuid> {
        self.requested_session_ids.lock().unwrap().clone()
    }
}

impl JoinedRoomsPort for FakeJoinedRoomsPort {
    async fn list_joined_rooms(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<JoinedRoomSummary>, AppError> {
        self.requested_session_ids.lock().unwrap().push(session_id);
        Ok(self.rooms.clone())
    }
}

#[derive(Debug)]
struct FakeRoomSearchPort {
    results: Vec<RoomSearchResult>,
    requested_session_ids: Mutex<Vec<Uuid>>,
    requested_inputs: Mutex<Vec<String>>,
}

impl FakeRoomSearchPort {
    fn with_results(results: Vec<RoomSearchResult>) -> Self {
        Self {
            results,
            requested_session_ids: Mutex::default(),
            requested_inputs: Mutex::default(),
        }
    }

    fn requested_session_ids(&self) -> Vec<Uuid> {
        self.requested_session_ids.lock().unwrap().clone()
    }

    fn requested_inputs(&self) -> Vec<String> {
        self.requested_inputs.lock().unwrap().clone()
    }
}

impl RoomSearchPort for FakeRoomSearchPort {
    async fn search_rooms_by_code(
        &self,
        session_id: Uuid,
        input: &str,
    ) -> Result<Vec<RoomSearchResult>, AppError> {
        self.requested_session_ids.lock().unwrap().push(session_id);
        self.requested_inputs
            .lock()
            .unwrap()
            .push(input.to_string());
        Ok(self.results.clone())
    }
}

#[derive(Debug)]
enum MessageStoreOutcome {
    Same,
    RewriteBody(&'static str),
}

impl MessageStoreOutcome {
    fn same() -> Self {
        Self::Same
    }

    fn rewrite_body(body: &'static str) -> Self {
        Self::RewriteBody(body)
    }
}

#[derive(Debug)]
struct FakeMessageStore {
    recorded: Mutex<Vec<Message>>,
    outcome: MessageStoreOutcome,
}

impl FakeMessageStore {
    fn persisting(outcome: MessageStoreOutcome) -> Self {
        Self {
            recorded: Mutex::default(),
            outcome,
        }
    }

    fn recorded_bodies(&self) -> Vec<String> {
        self.recorded
            .lock()
            .unwrap()
            .iter()
            .map(|message| message.body.as_str().to_string())
            .collect()
    }
}

impl MessageStore for FakeMessageStore {
    async fn save_message(&self, message: Message) -> Result<Message, AppError> {
        self.recorded.lock().unwrap().push(message.clone());

        let persisted = match self.outcome {
            MessageStoreOutcome::Same => message,
            MessageStoreOutcome::RewriteBody(body) => Message {
                body: MessageBody::new(body).unwrap(),
                ..message
            },
        };

        Ok(persisted)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RoomPresence {
    Existing,
    Missing,
}

#[derive(Debug, Default)]
struct FakeRoomEntryState {
    operations: Vec<&'static str>,
    requested_codes: Vec<String>,
    requested_limits: Vec<usize>,
    recorded_room_code_id: Option<Uuid>,
    recorded_member_id: Option<Uuid>,
    recorded_room_created_at: Option<DateTime<Utc>>,
    recorded_room_code_created_at: Option<DateTime<Utc>>,
    recorded_member_joined_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct FakeRoomEntryPort {
    snapshot: RoomSnapshotData,
    room_presence: RoomPresence,
    fail_member_write: bool,
    state: std::sync::Arc<Mutex<FakeRoomEntryState>>,
}

impl FakeRoomEntryPort {
    fn existing_room(snapshot: RoomSnapshotData) -> Self {
        Self {
            snapshot,
            room_presence: RoomPresence::Existing,
            fail_member_write: false,
            state: std::sync::Arc::new(Mutex::new(FakeRoomEntryState::default())),
        }
    }

    fn missing_room(snapshot: RoomSnapshotData) -> Self {
        Self {
            snapshot,
            room_presence: RoomPresence::Missing,
            fail_member_write: false,
            state: std::sync::Arc::new(Mutex::new(FakeRoomEntryState::default())),
        }
    }

    fn member_failure(snapshot: RoomSnapshotData) -> Self {
        Self {
            snapshot,
            room_presence: RoomPresence::Existing,
            fail_member_write: true,
            state: std::sync::Arc::new(Mutex::new(FakeRoomEntryState::default())),
        }
    }

    fn operations(&self) -> Vec<&'static str> {
        self.state.lock().unwrap().operations.clone()
    }

    fn recorded_room_code_id(&self) -> Option<Uuid> {
        self.state.lock().unwrap().recorded_room_code_id
    }

    fn recorded_member_id(&self) -> Option<Uuid> {
        self.state.lock().unwrap().recorded_member_id
    }

    fn recorded_room_created_at(&self) -> Option<DateTime<Utc>> {
        self.state.lock().unwrap().recorded_room_created_at
    }

    fn recorded_room_code_created_at(&self) -> Option<DateTime<Utc>> {
        self.state.lock().unwrap().recorded_room_code_created_at
    }

    fn recorded_member_joined_at(&self) -> Option<DateTime<Utc>> {
        self.state.lock().unwrap().recorded_member_joined_at
    }
}

impl RoomEntryPort for FakeRoomEntryPort {
    type Tx<'a>
        = FakeRoomEntryTx
    where
        Self: 'a;

    async fn begin_room_entry(&self, _room_code: &RoomCode) -> Result<Self::Tx<'_>, AppError> {
        Ok(FakeRoomEntryTx {
            snapshot: self.snapshot.clone(),
            room_presence: self.room_presence,
            fail_member_write: self.fail_member_write,
            state: self.state.clone(),
        })
    }
}

struct FakeRoomEntryTx {
    snapshot: RoomSnapshotData,
    room_presence: RoomPresence,
    fail_member_write: bool,
    state: std::sync::Arc<Mutex<FakeRoomEntryState>>,
}

impl FakeRoomEntryTx {
    fn push(&self, operation: &'static str) {
        self.state.lock().unwrap().operations.push(operation);
    }
}

impl RoomEntryTx for FakeRoomEntryTx {
    async fn find_room_by_code(&mut self, room_code: &RoomCode) -> Result<Option<Uuid>, AppError> {
        self.push("find_room_by_code");
        self.state
            .lock()
            .unwrap()
            .requested_codes
            .push(room_code.normalized().to_string());
        if room_code.normalized() != self.snapshot.room_code.normalized() {
            return Ok(None);
        }

        Ok(match self.room_presence {
            RoomPresence::Existing => Some(self.snapshot.room_id),
            RoomPresence::Missing => None,
        })
    }

    async fn create_room(
        &mut self,
        room: &NewRoomRecord,
        room_code: &NewRoomCodeRecord,
    ) -> Result<(), AppError> {
        self.push("create_room");
        if room.room_id != self.snapshot.room_id
            || room_code.room_id != self.snapshot.room_id
            || room_code.normalized_code != self.snapshot.room_code.normalized()
        {
            return Err(AppError::DependencyFailure);
        }
        let mut state = self.state.lock().unwrap();
        state.recorded_room_code_id = Some(room_code.room_code_id);
        state.recorded_room_created_at = Some(room.created_at);
        state.recorded_room_code_created_at = Some(room_code.created_at);

        Ok(())
    }

    async fn ensure_room_member(&mut self, member: &NewMemberRecord) -> Result<(), AppError> {
        self.push("ensure_room_member");
        if self.fail_member_write {
            return Err(AppError::DependencyFailure);
        }
        let mut state = self.state.lock().unwrap();
        state.recorded_member_id = Some(member.member_id);
        state.recorded_member_joined_at = Some(member.joined_at);
        if member.room_id == self.snapshot.room_id {
            Ok(())
        } else {
            Err(AppError::DependencyFailure)
        }
    }

    async fn load_recent_messages(
        &mut self,
        room_id: Uuid,
        limit: usize,
    ) -> Result<Vec<Message>, AppError> {
        self.push("load_recent_messages");
        self.state.lock().unwrap().requested_limits.push(limit);
        if room_id != self.snapshot.room_id || limit != 50 {
            return Err(AppError::DependencyFailure);
        }

        Ok(self.snapshot.messages.clone())
    }

    async fn commit(self) -> Result<(), AppError> {
        self.push("commit");
        Ok(())
    }
}

#[derive(Debug)]
struct FakeRoomSnapshotPort {
    snapshot: Option<RoomSnapshotData>,
    fail: bool,
    requested_limits: Mutex<Vec<usize>>,
}

impl FakeRoomSnapshotPort {
    fn with_snapshot(snapshot: RoomSnapshotData) -> Self {
        Self {
            snapshot: Some(snapshot),
            fail: false,
            requested_limits: Mutex::default(),
        }
    }

    fn failing() -> Self {
        Self {
            snapshot: None,
            fail: true,
            requested_limits: Mutex::default(),
        }
    }

    fn requested_limits(&self) -> Vec<usize> {
        self.requested_limits.lock().unwrap().clone()
    }
}

impl RoomSnapshotPort for FakeRoomSnapshotPort {
    async fn load_room_snapshot(
        &self,
        _room_id: Uuid,
        limit: usize,
    ) -> Result<RoomSnapshotData, AppError> {
        self.requested_limits.lock().unwrap().push(limit);

        if self.fail {
            return Err(AppError::DependencyFailure);
        }

        Ok(self.snapshot.clone().unwrap())
    }
}

#[derive(Debug)]
struct FakeIdGenerator {
    next_message_id: Uuid,
    next_room_id: Uuid,
    next_room_code_id: Uuid,
    next_member_id: Uuid,
}

impl FakeIdGenerator {
    fn new(next_id: Uuid) -> Self {
        Self {
            next_message_id: next_id,
            next_room_id: next_id,
            next_room_code_id: next_id,
            next_member_id: next_id,
        }
    }

    fn new_room_entry(
        next_room_id: Uuid,
        next_room_code_id: Uuid,
        next_member_id: Uuid,
        next_message_id: Uuid,
    ) -> Self {
        Self {
            next_message_id,
            next_room_id,
            next_room_code_id,
            next_member_id,
        }
    }
}

impl IdGenerator for FakeIdGenerator {
    fn next_message_id(&self) -> Uuid {
        self.next_message_id
    }

    fn next_room_id(&self) -> Uuid {
        self.next_room_id
    }

    fn next_room_code_id(&self) -> Uuid {
        self.next_room_code_id
    }

    fn next_member_id(&self) -> Uuid {
        self.next_member_id
    }
}

#[derive(Debug)]
struct FakeClock {
    now: DateTime<Utc>,
}

impl FakeClock {
    fn new(now: DateTime<Utc>) -> Self {
        Self { now }
    }
}

impl Clock for FakeClock {
    fn now(&self) -> DateTime<Utc> {
        self.now
    }
}

#[derive(Debug)]
struct FakeSessionBootstrapPort {
    existing_session: Option<AnonymousSession>,
    saved_sessions: Mutex<Vec<AnonymousSession>>,
    loaded_session_ids: Mutex<Vec<Uuid>>,
}

impl FakeSessionBootstrapPort {
    fn with_existing(existing_session: AnonymousSession) -> Self {
        Self {
            existing_session: Some(existing_session),
            saved_sessions: Mutex::default(),
            loaded_session_ids: Mutex::default(),
        }
    }

    fn saved_sessions(&self) -> Vec<AnonymousSession> {
        self.saved_sessions.lock().unwrap().clone()
    }

    fn loaded_session_ids(&self) -> Vec<Uuid> {
        self.loaded_session_ids.lock().unwrap().clone()
    }
}

impl SessionBootstrapPort for FakeSessionBootstrapPort {
    async fn load_session(&self, session_id: Uuid) -> Result<Option<AnonymousSession>, AppError> {
        self.loaded_session_ids.lock().unwrap().push(session_id);
        Ok(self.existing_session.clone())
    }

    async fn save_session(&self, session: AnonymousSession) -> Result<AnonymousSession, AppError> {
        self.saved_sessions.lock().unwrap().push(session.clone());
        Ok(session)
    }
}

fn expected_snapshot(room_id: Uuid, session_id: Uuid, body: &str) -> RoomSnapshot {
    RoomSnapshot {
        room_id,
        room_code: "A1234".to_string(),
        messages: vec![MessageView {
            message_id: Uuid::from_u128(33),
            session_id,
            body: body.to_string(),
            created_at: fixed_time(),
        }],
    }
}

fn sample_snapshot_data(
    room_id: Uuid,
    room_code: &str,
    messages: Vec<Message>,
) -> RoomSnapshotData {
    RoomSnapshotData {
        room_id,
        room_code: RoomCode::new(room_code).unwrap(),
        messages,
    }
}

fn sample_message(message_id: Uuid, room_id: Uuid, session_id: Uuid, body: &str) -> Message {
    sample_message_at(message_id, room_id, session_id, body, 0)
}

fn sample_message_at(
    message_id: Uuid,
    room_id: Uuid,
    session_id: Uuid,
    body: &str,
    minute_offset: u128,
) -> Message {
    Message {
        message_id,
        room_id,
        sender_session_id: session_id,
        body: MessageBody::new(body).unwrap(),
        created_at: Utc
            .timestamp_opt(fixed_time().timestamp() + minute_offset as i64, 0)
            .unwrap(),
        status: MessageStatus::Active,
    }
}

fn joined_room_summary(
    room_id: Uuid,
    room_code: &str,
    latest_preview: &str,
    latest_message_at: Option<DateTime<Utc>>,
) -> JoinedRoomSummary {
    JoinedRoomSummary {
        room_id,
        room_code: room_code.to_string(),
        display_title: room_code.to_string(),
        latest_preview: latest_preview.to_string(),
        latest_message_at,
    }
}

fn room_search_result(
    room_id: Uuid,
    room_code: &str,
    latest_preview: &str,
    latest_message_at: Option<DateTime<Utc>>,
    is_joined: bool,
) -> RoomSearchResult {
    RoomSearchResult {
        room_id,
        room_code: room_code.to_string(),
        display_title: room_code.to_string(),
        latest_preview: latest_preview.to_string(),
        latest_message_at,
        is_joined,
    }
}

fn minute_time(minute_offset: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(fixed_time().timestamp() + minute_offset * 60, 0)
        .unwrap()
}

fn fixed_time() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()
}

struct PgHarness {
    pool: PgPool,
    store: PgStore,
}

impl PgHarness {
    async fn new(pool: PgPool) -> Self {
        let store = PgStore::new(pool.clone());
        Self { pool, store }
    }

    async fn seed_active_session(&self, session_id: Uuid) {
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO anonymous_sessions (session_id, issued_at, last_seen_at, status)
             VALUES ($1, $2, $3, 'active')",
        )
        .bind(session_id)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    async fn seed_room_with_code(&self, room_id: Uuid, room_code: &str, code_version: u16) {
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO rooms (room_id, created_at, status)
             VALUES ($1, $2, 'active')",
        )
        .bind(room_id)
        .bind(now)
        .execute(&self.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO room_codes (
                 room_code_id,
                 room_id,
                 original_code,
                 normalized_code,
                 code_version,
                 created_at
             )
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::now_v7())
        .bind(room_id)
        .bind(room_code)
        .bind(RoomCode::new(room_code).unwrap().normalized())
        .bind(i16::try_from(code_version).unwrap())
        .bind(now)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    async fn room_id_by_code(&self, room_code: &str) -> Uuid {
        let room_code = RoomCode::new(room_code).unwrap();
        sqlx::query(
            "SELECT room_id
             FROM room_codes
             WHERE normalized_code = $1
               AND code_version = $2",
        )
        .bind(room_code.normalized())
        .bind(i16::try_from(room_code.code_version).unwrap())
        .fetch_one(&self.pool)
        .await
        .unwrap()
        .get("room_id")
    }

    async fn member_count(&self, room_id: Uuid, session_id: Uuid) -> i64 {
        sqlx::query(
            "SELECT COUNT(*) AS member_count
             FROM members
             WHERE room_id = $1 AND session_id = $2",
        )
        .bind(room_id)
        .bind(session_id)
        .fetch_one(&self.pool)
        .await
        .unwrap()
        .get("member_count")
    }

    async fn message_count(&self, room_id: Uuid) -> i64 {
        sqlx::query(
            "SELECT COUNT(*) AS message_count
             FROM messages
             WHERE room_id = $1",
        )
        .bind(room_id)
        .fetch_one(&self.pool)
        .await
        .unwrap()
        .get("message_count")
    }

    async fn message_bodies(&self, room_id: Uuid) -> Vec<String> {
        sqlx::query(
            "SELECT body
             FROM messages
             WHERE room_id = $1
             ORDER BY created_at ASC, message_id ASC",
        )
        .bind(room_id)
        .fetch_all(&self.pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.get("body"))
        .collect()
    }
}

fn unique_room_code(letter: char) -> String {
    let value = ROOM_CODE_SEQUENCE.fetch_add(1, Ordering::Relaxed) % 10_000;
    format!("{}{value:04}", letter.to_ascii_uppercase())
}
static ROOM_CODE_SEQUENCE: AtomicUsize = AtomicUsize::new(1_000);
