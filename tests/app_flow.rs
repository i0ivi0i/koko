use std::sync::Mutex;

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
};
use uuid::Uuid;

#[test]
fn app_error_code_serializes_to_stable_wire_value() {
    assert_eq!(
        serde_json::to_string(&AppErrorCode::InvalidSession).unwrap(),
        "\"invalid_session\""
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
    let join_port = FakeRoomJoinPort::new(room_id);
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        vec![sample_message(Uuid::from_u128(33), room_id, session_id, "hello")],
    ));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &snapshot_port,
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(join_port.requested_codes(), vec!["A1234".to_string()]);
    assert_eq!(snapshot_port.requested_limits(), vec![50]);
    assert_eq!(snapshot, expected_snapshot(room_id, session_id, "hello"));
}

#[tokio::test]
async fn join_or_create_room_by_code_rejects_invalid_room_code() {
    let error = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &FakeRoomJoinPort::new(Uuid::from_u128(36)),
        &FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
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
async fn join_or_create_room_by_code_rejects_inactive_session() {
    let session_id = Uuid::from_u128(34);
    let join_port = FakeRoomJoinPort::new(Uuid::from_u128(35));
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        Uuid::from_u128(35),
        "A1234",
        vec![],
    ));

    let error = join_or_create_room_by_code(
        &FakeSessionPort::deny(),
        &join_port,
        &snapshot_port,
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidSession);
    assert!(join_port.requested_codes().is_empty());
    assert!(snapshot_port.requested_limits().is_empty());
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
async fn load_room_snapshot_truncates_to_latest_fifty_messages() {
    let room_id = Uuid::from_u128(430);
    let session_id = Uuid::from_u128(431);
    let messages = (0..55)
        .map(|index| {
            sample_message(
                Uuid::from_u128(500 + index),
                room_id,
                session_id,
                &format!("message {index}"),
            )
        })
        .collect();
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
    room_id: Uuid,
    requested_codes: Mutex<Vec<String>>,
}

impl FakeRoomJoinPort {
    fn new(room_id: Uuid) -> Self {
        Self {
            room_id,
            requested_codes: Mutex::default(),
        }
    }

    fn requested_codes(&self) -> Vec<String> {
        self.requested_codes.lock().unwrap().clone()
    }
}

impl RoomJoinPort for FakeRoomJoinPort {
    async fn join_or_create_room_by_code(
        &self,
        room_code: RoomCode,
        _session_id: Uuid,
    ) -> Result<Uuid, AppError> {
        self.requested_codes
            .lock()
            .unwrap()
            .push(room_code.normalized().to_string());
        Ok(self.room_id)
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
    Message {
        message_id,
        room_id,
        sender_session_id: session_id,
        body: MessageBody::new(body).unwrap(),
        created_at: fixed_time(),
        status: MessageStatus::Active,
    }
}

fn fixed_time() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()
}
