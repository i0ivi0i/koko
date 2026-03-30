use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use koko::{
    app::{AppError, Clock, IdGenerator, MembershipPort, MessageStore, SessionPort},
    contract::{MessageCreated, SendTextMessageCommand, SubscribeRoomStreamCommand},
    domain::Message,
    rt::{RoomBroadcaster, RoomSubscriber, send_text_message_and_broadcast, subscribe_room_stream},
};
use uuid::Uuid;

#[tokio::test]
async fn subscribe_room_stream_joins_room_after_membership_check() {
    let room_id = Uuid::from_u128(1);
    let session_id = Uuid::from_u128(2);
    let subscriber = FakeSubscriber::default();

    subscribe_room_stream(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &subscriber,
        SubscribeRoomStreamCommand { room_id, session_id },
    )
    .await
    .unwrap();

    assert_eq!(subscriber.joined_rooms(), vec![room_id.to_string()]);
}

#[tokio::test]
async fn subscribe_room_stream_rejects_non_member_without_joining() {
    let room_id = Uuid::from_u128(11);
    let session_id = Uuid::from_u128(12);
    let subscriber = FakeSubscriber::default();

    let error = subscribe_room_stream(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::deny(),
        &subscriber,
        SubscribeRoomStreamCommand { room_id, session_id },
    )
    .await
    .unwrap_err();

    assert_eq!(error, AppError::NotRoomMember { room_id, session_id });
    assert!(subscriber.joined_rooms().is_empty());
}

#[tokio::test]
async fn message_is_broadcast_only_after_persistence() {
    let room_id = Uuid::from_u128(21);
    let session_id = Uuid::from_u128(22);
    let message_id = Uuid::from_u128(23);
    let trace = TraceLog::default();
    let store = FakeMessageStore::new(trace.clone());
    let broadcaster = FakeBroadcaster::new(trace.clone());

    let created = send_text_message_and_broadcast(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &store,
        &broadcaster,
        &FixedIdGenerator(message_id),
        &FixedClock(Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()),
        SendTextMessageCommand {
            room_id,
            session_id,
            body: " hello realtime ".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(created.message_id, message_id);
    assert_eq!(created.body, "hello realtime");
    assert_eq!(trace.events(), vec!["persist", "broadcast"]);
    assert_eq!(broadcaster.broadcast_room_ids(), vec![room_id]);
}

#[test]
fn rt_source_registers_default_namespace_and_events() {
    let source = include_str!("../src/rt.rs");

    assert!(source.contains("io.ns(\"/\""));
    assert!(source.contains("\"subscribe_room_stream\""));
    assert!(source.contains("\"send_text_message\""));
}

#[derive(Debug)]
struct FakeSessionPort {
    allowed: bool,
}

impl FakeSessionPort {
    fn allow() -> Self {
        Self { allowed: true }
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
struct FakeSubscriber {
    joined_rooms: Mutex<Vec<String>>,
}

impl FakeSubscriber {
    fn joined_rooms(&self) -> Vec<String> {
        self.joined_rooms.lock().unwrap().clone()
    }
}

impl RoomSubscriber for FakeSubscriber {
    async fn join_room(&self, room: &str) -> Result<(), AppError> {
        self.joined_rooms.lock().unwrap().push(room.to_string());
        Ok(())
    }
}

#[derive(Debug, Default, Clone)]
struct TraceLog(std::sync::Arc<Mutex<Vec<&'static str>>>);

impl TraceLog {
    fn events(&self) -> Vec<&'static str> {
        self.0.lock().unwrap().clone()
    }

    fn push(&self, event: &'static str) {
        self.0.lock().unwrap().push(event);
    }
}

#[derive(Debug)]
struct FakeMessageStore {
    trace: TraceLog,
}

impl FakeMessageStore {
    fn new(trace: TraceLog) -> Self {
        Self { trace }
    }
}

impl MessageStore for FakeMessageStore {
    async fn save_message(&self, message: Message) -> Result<Message, AppError> {
        self.trace.push("persist");
        Ok(message)
    }
}

#[derive(Debug)]
struct FakeBroadcaster {
    trace: TraceLog,
    room_ids: Mutex<Vec<Uuid>>,
}

impl FakeBroadcaster {
    fn new(trace: TraceLog) -> Self {
        Self {
            trace,
            room_ids: Mutex::default(),
        }
    }

    fn broadcast_room_ids(&self) -> Vec<Uuid> {
        self.room_ids.lock().unwrap().clone()
    }
}

impl RoomBroadcaster for FakeBroadcaster {
    async fn broadcast_message_created(
        &self,
        room_id: Uuid,
        _payload: &MessageCreated,
    ) -> Result<(), AppError> {
        self.trace.push("broadcast");
        self.room_ids.lock().unwrap().push(room_id);
        Ok(())
    }
}

struct FixedIdGenerator(Uuid);

impl IdGenerator for FixedIdGenerator {
    fn next_message_id(&self) -> Uuid {
        self.0
    }
}

struct FixedClock(chrono::DateTime<Utc>);

impl Clock for FixedClock {
    fn now(&self) -> chrono::DateTime<Utc> {
        self.0
    }
}
