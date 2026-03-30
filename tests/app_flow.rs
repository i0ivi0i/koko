use std::{
    path::Path,
    str::FromStr,
    env,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

use chrono::{DateTime, TimeZone, Utc};
use koko::{
    app::{
        join_or_create_room_by_code, load_room_snapshot, send_text_message, AppError, Clock,
        IdGenerator, MembershipPort, MessageStore, RoomJoinPort, RoomSnapshotData,
        RoomSnapshotPort, SessionPort,
    },
    contract::{
        AppErrorCode, AppEvent, JoinOrCreateRoomByCodeCommand, LoadRoomSnapshotQuery, MessageView,
        RoomSnapshot, SendTextMessageCommand,
    },
    domain::{Message, MessageBody, MessageStatus, RoomCode},
    store::PgStore,
};
use sqlx::{
    Row,
    migrate::Migrator,
    postgres::{PgConnectOptions, PgPoolOptions},
    PgPool,
};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

#[test]
fn app_error_code_serializes_to_stable_wire_value() {
    assert_eq!(
        serde_json::to_string(&AppErrorCode::InvalidSession).unwrap(),
        "\"invalid_session\""
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
        SendTextMessageCommand {
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
        SendTextMessageCommand {
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
        SendTextMessageCommand {
            room_id,
            session_id,
            body: "hello".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::MembershipRequired);
    assert_eq!(error, AppError::NotRoomMember { room_id, session_id });
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
        SendTextMessageCommand {
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
        SendTextMessageCommand {
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
    let join_port = FakeRoomJoinPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        vec![sample_message(Uuid::from_u128(33), room_id, session_id, "hello")],
    ));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(join_port.requested_codes(), vec!["A1234".to_string()]);
    assert_eq!(join_port.requested_limits(), vec![50]);
    assert_eq!(snapshot, expected_snapshot(room_id, session_id, "hello"));
}

#[tokio::test]
async fn join_or_create_room_by_code_rejects_invalid_room_code() {
    let error = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &FakeRoomJoinPort::with_snapshot(sample_snapshot_data(
            Uuid::from_u128(36),
            "A1234",
            vec![],
        )),
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
        &FakeRoomJoinPort::with_snapshot(sample_snapshot_data(
            Uuid::from_u128(38),
            "B1234",
            vec![],
        )),
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
    let join_port = FakeRoomJoinPort::with_snapshot(sample_snapshot_data(
        Uuid::from_u128(35),
        "A1234",
        vec![],
    ));

    let error = join_or_create_room_by_code(
        &FakeSessionPort::deny(),
        &join_port,
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidSession);
    assert!(join_port.requested_codes().is_empty());
    assert!(join_port.requested_limits().is_empty());
}

#[tokio::test]
async fn load_room_snapshot_returns_messages_for_member() {
    let room_id = Uuid::from_u128(41);
    let session_id = Uuid::from_u128(42);
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        vec![sample_message(Uuid::from_u128(43), room_id, session_id, "hello again")],
    ));

    let snapshot = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery { room_id, session_id },
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
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        messages,
    ));

    let snapshot = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery { room_id, session_id },
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
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        vec![],
    ));

    let error = load_room_snapshot(
        &FakeSessionPort::deny(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery { room_id, session_id },
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
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        vec![],
    ));

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::deny(),
        &snapshot_port,
        LoadRoomSnapshotQuery { room_id, session_id },
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
        LoadRoomSnapshotQuery { room_id, session_id },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
    assert!(matches!(error, AppError::DependencyFailure));
}

#[test]
fn app_and_contract_source_stays_entrypoint_neutral() {
    for source in [include_str!("../src/app.rs"), include_str!("../src/contract.rs")] {
        let lowered = source.to_ascii_lowercase();
        assert!(!lowered.contains("axum::"));
        assert!(!lowered.contains("sqlx::"));
        assert!(!lowered.contains("socketioxide::"));
    }
}

#[tokio::test]
async fn join_or_create_persists_room_member_and_room_code() {
    let _guard = db_test_lock().lock().await;
    let harness = PgHarness::new().await;
    let session_id = Uuid::now_v7();
    let room_code = unique_room_code('a');
    harness.seed_active_session(session_id).await;

    let snapshot = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
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
}

#[tokio::test]
async fn send_text_message_persists_message_and_room_snapshot_reads_it() {
    let _guard = db_test_lock().lock().await;
    let harness = PgHarness::new().await;
    let session_id = Uuid::now_v7();
    let room_code = unique_room_code('b');
    let message_id = Uuid::now_v7();
    let now = fixed_time();
    harness.seed_active_session(session_id).await;

    let joined = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
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
        SendTextMessageCommand {
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
}

#[tokio::test]
async fn join_or_create_treats_room_code_as_case_insensitive() {
    let _guard = db_test_lock().lock().await;
    let harness = PgHarness::new().await;
    let first_session_id = Uuid::now_v7();
    let second_session_id = Uuid::now_v7();
    let room_code = unique_room_code('c');
    harness.seed_active_session(first_session_id).await;
    harness.seed_active_session(second_session_id).await;

    let first_snapshot = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
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
        JoinOrCreateRoomByCodeCommand {
            room_code: room_code.to_ascii_uppercase(),
            session_id: second_session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(first_snapshot.room_id, second_snapshot.room_id);
    assert_eq!(harness.member_count(first_snapshot.room_id, first_session_id).await, 1);
    assert_eq!(harness.member_count(first_snapshot.room_id, second_session_id).await, 1);
}

#[tokio::test]
async fn repeated_join_does_not_duplicate_member_in_same_room() {
    let _guard = db_test_lock().lock().await;
    let harness = PgHarness::new().await;
    let session_id = Uuid::now_v7();
    let room_code = unique_room_code('d');
    harness.seed_active_session(session_id).await;

    let first_snapshot = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
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
        JoinOrCreateRoomByCodeCommand {
            room_code: room_code.to_ascii_lowercase(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(first_snapshot.room_id, second_snapshot.room_id);
    assert_eq!(harness.member_count(first_snapshot.room_id, session_id).await, 1);
}

#[tokio::test]
async fn send_text_message_rejects_non_member_sender_via_database_truth() {
    let _guard = db_test_lock().lock().await;
    let harness = PgHarness::new().await;
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
        SendTextMessageCommand {
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
}

#[tokio::test]
async fn store_scopes_room_code_lookup_by_code_version_and_snapshot_round_trips_version() {
    let _guard = db_test_lock().lock().await;
    let harness = PgHarness::new().await;
    let session_id = Uuid::now_v7();
    let normalized_code = unique_room_code('f');
    let room_v1 = Uuid::now_v7();
    let room_v2 = Uuid::now_v7();
    harness.seed_active_session(session_id).await;
    harness.seed_room_with_code(room_v1, &normalized_code, 1).await;
    harness.seed_room_with_code(room_v2, &normalized_code, 2).await;

    let mut requested_room_code = RoomCode::new(&normalized_code).unwrap();
    requested_room_code.code_version = 2;
    let joined = harness
        .store
        .join_or_create_room_by_code(requested_room_code.clone(), 50, session_id)
        .await
        .unwrap();

    assert_eq!(joined.room_id, room_v2);
    assert_eq!(joined.room_code.code_version, 2);
    assert_eq!(harness.member_count(room_v2, session_id).await, 1);

    let snapshot = harness.store.load_room_snapshot(room_v2, 50).await.unwrap();

    assert_eq!(snapshot.room_id, room_v2);
    assert_eq!(snapshot.room_code.normalized(), normalized_code);
    assert_eq!(snapshot.room_code.code_version, 2);
}

#[test]
fn destructive_reset_rejects_non_test_database_names() {
    let error = validated_test_database_url(Some(
        "postgres://koko:koko_local@127.0.0.1:5432/koko_stage1",
    ))
    .unwrap_err();

    assert!(error.contains("_test"));
    assert_eq!(
        validated_test_database_url(Some(DEFAULT_TEST_DATABASE_URL)).unwrap(),
        DEFAULT_TEST_DATABASE_URL
    );
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

#[derive(Debug)]
struct FakeRoomJoinPort {
    snapshot: RoomSnapshotData,
    requested_codes: Mutex<Vec<String>>,
    requested_limits: Mutex<Vec<usize>>,
}

impl FakeRoomJoinPort {
    fn with_snapshot(snapshot: RoomSnapshotData) -> Self {
        Self {
            snapshot,
            requested_codes: Mutex::default(),
            requested_limits: Mutex::default(),
        }
    }

    fn requested_codes(&self) -> Vec<String> {
        self.requested_codes.lock().unwrap().clone()
    }

    fn requested_limits(&self) -> Vec<usize> {
        self.requested_limits.lock().unwrap().clone()
    }
}

impl RoomJoinPort for FakeRoomJoinPort {
    async fn join_or_create_room_by_code(
        &self,
        room_code: RoomCode,
        limit: usize,
        _session_id: Uuid,
    ) -> Result<RoomSnapshotData, AppError> {
        self.requested_codes
            .lock()
            .unwrap()
            .push(room_code.normalized().to_string());
        self.requested_limits.lock().unwrap().push(limit);
        Ok(self.snapshot.clone())
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
    next_id: Uuid,
}

impl FakeIdGenerator {
    fn new(next_id: Uuid) -> Self {
        Self { next_id }
    }
}

impl IdGenerator for FakeIdGenerator {
    fn next_message_id(&self) -> Uuid {
        self.next_id
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

fn sample_snapshot_data(room_id: Uuid, room_code: &str, messages: Vec<Message>) -> RoomSnapshotData {
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

fn fixed_time() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()
}

struct PgHarness {
    pool: PgPool,
    store: PgStore,
}

impl PgHarness {
    async fn new() -> Self {
        let database_url = validated_test_database_url(
            env::var("KOKO_TEST_DATABASE_URL").ok().as_deref(),
        )
        .unwrap();
        reset_test_database(&database_url).await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .unwrap();
        run_migrations(&pool).await;

        Self {
            store: PgStore::new(pool.clone()),
            pool,
        }
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

fn validated_test_database_url(raw_url: Option<&str>) -> Result<String, String> {
    let database_url = raw_url.unwrap_or(DEFAULT_TEST_DATABASE_URL).to_string();
    let options = PgConnectOptions::from_str(&database_url)
        .map_err(|error| format!("failed to parse test database url: {error}"))?;
    let database_name = options
        .get_database()
        .ok_or_else(|| "test database url must include a database name".to_string())?;

    if !database_name.ends_with("_test") {
        return Err(format!(
            "destructive test reset only allows databases ending with _test, got `{database_name}`"
        ));
    }

    if !database_name
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Err(format!(
            "test database name `{database_name}` must use lowercase ascii letters, digits, or underscores"
        ));
    }

    Ok(database_url)
}

async fn reset_test_database(database_url: &str) {
    let options = PgConnectOptions::from_str(database_url).unwrap();
    let database_name = options.get_database().unwrap().to_string();
    let database_user = options.get_username().to_string();
    let admin_url = env::var("KOKO_TEST_ADMIN_DATABASE_URL")
        .unwrap_or_else(|_| DEFAULT_TEST_ADMIN_DATABASE_URL.to_string());
    let admin_options = PgConnectOptions::from_str(&admin_url).unwrap();
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(admin_options.clone())
        .await
        .unwrap();

    sqlx::query(
        "SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1
           AND pid <> pg_backend_pid()",
    )
    .bind(&database_name)
    .execute(&admin_pool)
    .await
    .unwrap();

    sqlx::query(&format!("DROP DATABASE IF EXISTS \"{database_name}\""))
    .execute(&admin_pool)
    .await
    .unwrap();

    sqlx::query(&format!(
        "CREATE DATABASE \"{database_name}\" OWNER \"{database_user}\""
    ))
    .execute(&admin_pool)
    .await
    .unwrap();

    let test_database_admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(admin_options.database(&database_name))
        .await
        .unwrap();

    sqlx::query(&format!(
        "ALTER SCHEMA public OWNER TO \"{database_user}\""
    ))
    .execute(&test_database_admin_pool)
    .await
    .unwrap();

    sqlx::query(&format!(
        "GRANT ALL ON SCHEMA public TO \"{database_user}\""
    ))
    .execute(&test_database_admin_pool)
    .await
    .unwrap();
}

async fn run_migrations(pool: &PgPool) {
    let migration_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let migrator = Migrator::new(migration_dir.as_path()).await.unwrap();
    migrator.run(pool).await.unwrap();
}

fn unique_room_code(letter: char) -> String {
    let value = ROOM_CODE_SEQUENCE.fetch_add(1, Ordering::Relaxed) % 10_000;
    format!("{}{value:04}", letter.to_ascii_uppercase())
}

fn db_test_lock() -> &'static AsyncMutex<()> {
    DB_TEST_LOCK.get_or_init(|| AsyncMutex::new(()))
}

static DB_TEST_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
static ROOM_CODE_SEQUENCE: AtomicUsize = AtomicUsize::new(1_000);
const DEFAULT_TEST_DATABASE_URL: &str = "postgres://koko:koko_local@127.0.0.1:5432/koko_test";
const DEFAULT_TEST_ADMIN_DATABASE_URL: &str =
    "postgres://postgres:postgres@127.0.0.1:5432/postgres";
