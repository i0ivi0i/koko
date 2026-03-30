use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use koko::{
    app::{
        join_or_create_room_by_code, load_room_snapshot, send_text_message, AppError, Clock,
        IdGenerator, MembershipPort, MessageStore, RoomEntryPort, RoomSnapshotData,
        RoomSnapshotPort, SessionPort,
    },
    contract::{
        AppEvent, JoinOrCreateRoomByCodeCommand, LoadRoomSnapshotQuery, RoomSnapshot,
        SendTextMessageCommand,
    },
    domain::{Message, MessageBody, MessageStatus, RoomCode},
};
use uuid::Uuid;

#[tokio::test]
async fn send_text_message_returns_message_created_event() {
    let room_id = Uuid::from_u128(1);
    let session_id = Uuid::from_u128(2);
    let client_message_id = Uuid::from_u128(3);
    let message_id = Uuid::from_u128(4);
    let now = fixed_time();
    let store = FakeMessageStore::default();

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
    let store = FakeMessageStore::default();

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

    assert_eq!(error, AppError::SessionNotActive { session_id });
    assert!(store.recorded_bodies().is_empty());
}

#[tokio::test]
async fn send_text_message_rejects_non_member() {
    let room_id = Uuid::from_u128(21);
    let session_id = Uuid::from_u128(22);
    let store = FakeMessageStore::default();

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

    assert_eq!(error, AppError::NotRoomMember { room_id, session_id });
    assert!(store.recorded_bodies().is_empty());
}

#[tokio::test]
async fn join_or_create_room_by_code_returns_snapshot() {
    let session_id = Uuid::from_u128(31);
    let room_id = Uuid::from_u128(32);
    let room_entry = FakeRoomEntryPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        vec![sample_message(Uuid::from_u128(33), room_id, session_id, "hello")],
    ));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &room_entry,
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        room_entry.requested_codes(),
        vec!["A1234".to_string()]
    );
    assert_eq!(
        snapshot,
        RoomSnapshot {
            room_id,
            room_code: "A1234".to_string(),
            messages: vec![koko::contract::MessageView {
                message_id: Uuid::from_u128(33),
                session_id,
                body: "hello".to_string(),
                created_at: fixed_time(),
            }],
        }
    );
}

#[tokio::test]
async fn load_room_snapshot_returns_messages_for_member() {
    let room_id = Uuid::from_u128(41);
    let session_id = Uuid::from_u128(42);

    let snapshot = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
            room_id,
            "A1234",
            vec![sample_message(Uuid::from_u128(43), room_id, session_id, "hello again")],
        )),
        LoadRoomSnapshotQuery { room_id, session_id },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.room_id, room_id);
    assert_eq!(snapshot.room_code, "A1234");
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.messages[0].body, "hello again");
}

#[tokio::test]
async fn load_room_snapshot_propagates_dependency_failure() {
    let room_id = Uuid::from_u128(51);
    let session_id = Uuid::from_u128(52);

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &FakeRoomSnapshotPort::fail(AppError::DependencyFailure {
            dependency: "snapshot_port",
        }),
        LoadRoomSnapshotQuery { room_id, session_id },
    )
    .await
    .unwrap_err();

    assert_eq!(
        error,
        AppError::DependencyFailure {
            dependency: "snapshot_port",
        }
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

#[derive(Debug, Default)]
struct FakeMessageStore {
    recorded: Mutex<Vec<Message>>,
}

impl FakeMessageStore {
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
    async fn save_message(&self, message: Message) -> Result<(), AppError> {
        self.recorded.lock().unwrap().push(message);
        Ok(())
    }
}

#[derive(Debug)]
struct FakeRoomEntryPort {
    snapshot: RoomSnapshotData,
    requested_codes: Mutex<Vec<String>>,
}

impl FakeRoomEntryPort {
    fn with_snapshot(snapshot: RoomSnapshotData) -> Self {
        Self {
            snapshot,
            requested_codes: Mutex::default(),
        }
    }

    fn requested_codes(&self) -> Vec<String> {
        self.requested_codes.lock().unwrap().clone()
    }
}

impl RoomEntryPort for FakeRoomEntryPort {
    async fn join_or_create_room_by_code(
        &self,
        room_code: RoomCode,
        _session_id: Uuid,
    ) -> Result<RoomSnapshotData, AppError> {
        self.requested_codes
            .lock()
            .unwrap()
            .push(room_code.normalized().to_string());
        Ok(self.snapshot.clone())
    }
}

#[derive(Debug)]
struct FakeRoomSnapshotPort {
    snapshot: Option<RoomSnapshotData>,
    failure: Option<&'static str>,
}

impl FakeRoomSnapshotPort {
    fn with_snapshot(snapshot: RoomSnapshotData) -> Self {
        Self {
            snapshot: Some(snapshot),
            failure: None,
        }
    }

    fn fail(error: AppError) -> Self {
        let AppError::DependencyFailure { dependency } = error else {
            panic!("test only supports dependency failures here");
        };

        Self {
            snapshot: None,
            failure: Some(dependency),
        }
    }
}

impl RoomSnapshotPort for FakeRoomSnapshotPort {
    async fn load_room_snapshot(&self, _room_id: Uuid) -> Result<RoomSnapshotData, AppError> {
        if let Some(dependency) = self.failure {
            return Err(AppError::DependencyFailure { dependency });
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
