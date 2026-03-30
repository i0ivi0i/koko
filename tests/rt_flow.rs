use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use koko::{
    app::{AppError, Clock, IdGenerator, MembershipPort, MessageStore, SessionPort},
    contract::{
        CommandRejected, MessageCreated, SendTextMessageCommand, SubscribeRoomStreamCommand,
    },
    domain::Message,
    rt::{
        RealtimeResponder, RoomBroadcaster, RoomSubscriber, SendTextMessageDeps,
        SubscribeRoomStreamDeps, handle_send_text_message, handle_subscribe_room_stream,
    },
};
use uuid::Uuid;

#[tokio::test]
async fn subscribe_room_stream_joins_room_after_membership_check_and_notifies_client() {
    let room_id = Uuid::from_u128(1);
    let session_id = Uuid::from_u128(2);
    let subscriber = FakeSubscriber::default();
    let responder = FakeResponder::default();

    handle_subscribe_room_stream(
        SubscribeRoomStreamDeps {
            session_port: &FakeSessionPort::allow(),
            membership_port: &FakeMembershipPort::allow(),
            subscriber: &subscriber,
            responder: &responder,
        },
        SubscribeRoomStreamCommand { room_id, session_id },
    )
    .await
    .unwrap();

    assert_eq!(subscriber.joined_rooms(), vec![room_id.to_string()]);
    assert_eq!(responder.subscribed_room_ids(), vec![room_id]);
    assert!(responder.rejections().is_empty());
}

#[tokio::test]
async fn subscribe_room_stream_rejects_non_member_without_joining_and_emits_rejection() {
    let room_id = Uuid::from_u128(11);
    let session_id = Uuid::from_u128(12);
    let subscriber = FakeSubscriber::default();
    let responder = FakeResponder::default();

    let error = handle_subscribe_room_stream(
        SubscribeRoomStreamDeps {
            session_port: &FakeSessionPort::allow(),
            membership_port: &FakeMembershipPort::deny(),
            subscriber: &subscriber,
            responder: &responder,
        },
        SubscribeRoomStreamCommand { room_id, session_id },
    )
    .await
    .unwrap_err();

    assert_eq!(error, AppError::NotRoomMember { room_id, session_id });
    assert!(subscriber.joined_rooms().is_empty());
    assert_eq!(
        responder.rejections(),
        vec![CommandRejected {
            code: koko::contract::AppErrorCode::MembershipRequired,
        }]
    );
}

#[tokio::test]
async fn message_is_broadcast_only_after_persistence_and_sender_gets_feedback() {
    let room_id = Uuid::from_u128(21);
    let session_id = Uuid::from_u128(22);
    let message_id = Uuid::from_u128(23);
    let trace = TraceLog::default();
    let store = FakeMessageStore::new(trace.clone());
    let broadcaster = FakeBroadcaster::new(trace.clone());
    let responder = FakeResponder::default();

    let created = handle_send_text_message(
        SendTextMessageDeps {
            session_port: &FakeSessionPort::allow(),
            membership_port: &FakeMembershipPort::allow(),
            message_store: &store,
            broadcaster: &broadcaster,
            responder: &responder,
            id_generator: &FixedIdGenerator(message_id),
            clock: &FixedClock(Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()),
        },
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
    assert_eq!(responder.accepted_message_ids(), vec![message_id]);
    assert!(responder.rejections().is_empty());
}

#[tokio::test]
async fn send_text_message_failure_emits_rejection_without_broadcast() {
    let room_id = Uuid::from_u128(31);
    let session_id = Uuid::from_u128(32);
    let trace = TraceLog::default();
    let store = FakeMessageStore::new(trace.clone());
    let broadcaster = FakeBroadcaster::new(trace);
    let responder = FakeResponder::default();

    let error = handle_send_text_message(
        SendTextMessageDeps {
            session_port: &FakeSessionPort::allow(),
            membership_port: &FakeMembershipPort::deny(),
            message_store: &store,
            broadcaster: &broadcaster,
            responder: &responder,
            id_generator: &FixedIdGenerator(Uuid::from_u128(33)),
            clock: &FixedClock(Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()),
        },
        SendTextMessageCommand {
            room_id,
            session_id,
            body: "hello realtime".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error, AppError::NotRoomMember { room_id, session_id });
    assert!(broadcaster.broadcast_room_ids().is_empty());
    assert_eq!(
        responder.rejections(),
        vec![CommandRejected {
            code: koko::contract::AppErrorCode::MembershipRequired,
        }]
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

#[derive(Debug, Default)]
struct FakeResponder {
    subscribed_room_ids: Mutex<Vec<Uuid>>,
    accepted_message_ids: Mutex<Vec<Uuid>>,
    rejections: Mutex<Vec<CommandRejected>>,
}

impl FakeResponder {
    fn subscribed_room_ids(&self) -> Vec<Uuid> {
        self.subscribed_room_ids.lock().unwrap().clone()
    }

    fn accepted_message_ids(&self) -> Vec<Uuid> {
        self.accepted_message_ids.lock().unwrap().clone()
    }

    fn rejections(&self) -> Vec<CommandRejected> {
        self.rejections.lock().unwrap().clone()
    }
}

impl RealtimeResponder for FakeResponder {
    async fn emit_room_stream_subscribed(&self, room_id: Uuid) -> Result<(), AppError> {
        self.subscribed_room_ids.lock().unwrap().push(room_id);
        Ok(())
    }

    async fn emit_message_accepted(&self, payload: &MessageCreated) -> Result<(), AppError> {
        self.accepted_message_ids
            .lock()
            .unwrap()
            .push(payload.message_id);
        Ok(())
    }

    async fn emit_command_rejected(&self, payload: &CommandRejected) -> Result<(), AppError> {
        self.rejections.lock().unwrap().push(payload.clone());
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
