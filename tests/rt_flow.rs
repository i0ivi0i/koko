use std::sync::Mutex;

use axum::http::{
    HeaderMap,
    HeaderValue,
    header::COOKIE,
};
use chrono::{TimeZone, Utc};
use koko::{
    app::{
        AppError, Clock, IdGenerator, MembershipPort, MessageStore, SendTextMessageInput,
        SessionPort, SubscribeRoomStreamInput,
    },
    contract::CommandRejected,
    domain::Message,
    rt::{
        RealtimeEffect, SendTextMessageDeps, SubscribeRoomStreamDeps, authenticate_realtime_session,
        plan_send_text_message, plan_subscribe_room_stream,
    },
};
use uuid::Uuid;

#[test]
fn init_tracing_is_idempotent() {
    let first = koko::support::init_tracing("info").unwrap();
    let second = koko::support::init_tracing("debug").unwrap();

    assert!(matches!(
        first,
        koko::support::TracingInit::Initialized | koko::support::TracingInit::AlreadyInitialized
    ));
    assert_eq!(second, koko::support::TracingInit::AlreadyInitialized);
}

#[tokio::test]
async fn subscribe_room_stream_joins_room_after_membership_check_and_notifies_client() {
    let room_id = Uuid::from_u128(1);
    let session_id = Uuid::from_u128(2);

    let plan = plan_subscribe_room_stream(
        SubscribeRoomStreamDeps {
            session_port: &FakeSessionPort::allow(),
            membership_port: &FakeMembershipPort::allow(),
        },
        SubscribeRoomStreamInput {
            room_id,
            session_id,
        },
    )
    .await;

    assert_eq!(plan.result, Ok(()));
    assert_eq!(
        plan.effects,
        vec![
            RealtimeEffect::JoinRoom { room_id },
            RealtimeEffect::EmitRoomStreamSubscribed { room_id },
        ]
    );
}

#[tokio::test]
async fn subscribe_room_stream_rejects_non_member_without_joining_and_emits_rejection() {
    let room_id = Uuid::from_u128(11);
    let session_id = Uuid::from_u128(12);

    let plan = plan_subscribe_room_stream(
        SubscribeRoomStreamDeps {
            session_port: &FakeSessionPort::allow(),
            membership_port: &FakeMembershipPort::deny(),
        },
        SubscribeRoomStreamInput {
            room_id,
            session_id,
        },
    )
    .await;

    assert_eq!(
        plan.result,
        Err(AppError::NotRoomMember {
            room_id,
            session_id
        })
    );
    assert_eq!(
        plan.effects,
        vec![RealtimeEffect::EmitCommandRejected(CommandRejected {
            code: koko::contract::AppErrorCode::MembershipRequired
        })]
    );
}

#[tokio::test]
async fn message_is_broadcast_only_after_persistence_and_sender_gets_feedback() {
    let room_id = Uuid::from_u128(21);
    let session_id = Uuid::from_u128(22);
    let message_id = Uuid::from_u128(23);
    let trace = TraceLog::default();
    let store = FakeMessageStore::new(trace.clone());

    let plan = plan_send_text_message(
        SendTextMessageDeps {
            session_port: &FakeSessionPort::allow(),
            membership_port: &FakeMembershipPort::allow(),
            message_store: &store,
            id_generator: &FixedIdGenerator(message_id),
            clock: &FixedClock(Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()),
        },
        SendTextMessageInput {
            room_id,
            session_id,
            body: " hello realtime ".to_string(),
            client_message_id: None,
        },
    )
    .await;

    let created = plan.result.unwrap();
    assert_eq!(created.message_id, message_id);
    assert_eq!(created.body, "hello realtime");
    assert_eq!(trace.events(), vec!["persist"]);
    assert_eq!(
        plan.effects,
        vec![
            RealtimeEffect::EmitMessageAccepted(created.clone()),
            RealtimeEffect::BroadcastMessageCreated {
                room_id,
                payload: created.clone(),
            },
        ]
    );
}

#[tokio::test]
async fn send_text_message_failure_emits_rejection_without_broadcast() {
    let room_id = Uuid::from_u128(31);
    let session_id = Uuid::from_u128(32);
    let trace = TraceLog::default();
    let store = FakeMessageStore::new(trace.clone());

    let plan = plan_send_text_message(
        SendTextMessageDeps {
            session_port: &FakeSessionPort::allow(),
            membership_port: &FakeMembershipPort::deny(),
            message_store: &store,
            id_generator: &FixedIdGenerator(Uuid::from_u128(33)),
            clock: &FixedClock(Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()),
        },
        SendTextMessageInput {
            room_id,
            session_id,
            body: "hello realtime".to_string(),
            client_message_id: None,
        },
    )
    .await;

    assert_eq!(
        plan.result,
        Err(AppError::NotRoomMember {
            room_id,
            session_id
        })
    );
    assert_eq!(
        plan.effects,
        vec![RealtimeEffect::EmitCommandRejected(CommandRejected {
            code: koko::contract::AppErrorCode::MembershipRequired
        })]
    );
}

#[tokio::test]
async fn authenticate_realtime_session_reads_koko_session_from_multi_cookie_header() {
    let session_id = Uuid::from_u128(1);
    let mut headers = HeaderMap::new();
    headers.append(COOKIE, HeaderValue::from_static("theme=dark; other=value"));
    headers.append(
        COOKIE,
        HeaderValue::from_str(&format!("tracking=on; koko_session={session_id}")).unwrap(),
    );

    let authenticated = authenticate_realtime_session(&FakeSessionPort::allow(), &headers)
        .await
        .unwrap();

    assert_eq!(authenticated.session_id, session_id);
}

#[tokio::test]
async fn authenticate_realtime_session_rejects_missing_or_invalid_cookie() {
    let missing_cookie = HeaderMap::new();
    let missing_cookie_error =
        authenticate_realtime_session(&FakeSessionPort::allow(), &missing_cookie)
            .await
            .unwrap_err();
    assert_eq!(missing_cookie_error.code(), koko::contract::AppErrorCode::InvalidSession);

    let mut invalid_cookie = HeaderMap::new();
    invalid_cookie.append(COOKIE, HeaderValue::from_static("koko_session=not-a-uuid"));
    let invalid_cookie_error = authenticate_realtime_session(&FakeSessionPort::allow(), &invalid_cookie)
        .await
        .unwrap_err();
    assert_eq!(invalid_cookie_error.code(), koko::contract::AppErrorCode::InvalidSession);

    let mut inactive_cookie = HeaderMap::new();
    inactive_cookie.append(
        COOKIE,
        HeaderValue::from_str(&format!("koko_session={}", Uuid::from_u128(2))).unwrap(),
    );
    let inactive_cookie_error = authenticate_realtime_session(&FakeSessionPort::deny(), &inactive_cookie)
        .await
        .unwrap_err();
    assert_eq!(inactive_cookie_error.code(), koko::contract::AppErrorCode::InvalidSession);
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
