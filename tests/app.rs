use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

use chrono::{DateTime, TimeZone, Utc};
use koko::{
    app::{
        AdminOverviewPort, AdminRoomsPort, AdminSessionContext, AdminSessionPort, AppError, Clock,
        IdGenerator, JoinOrCreateRoomByCodeCommand, JoinedRoomsPort, ListJoinedRoomsQuery,
        LoadRoomSnapshotQuery, MembershipPort, MessageStore, PersistedMessageRecord, RoomEntryPort,
        RoomEntryTx, RoomEventPositionPort, RoomSearchPort, RoomSnapshotData, RoomSnapshotPort,
        RoomStreamSubscription, SearchRoomsByCodeQuery, SendTextMessageInput, SessionBootstrapPort,
        SessionPort, SubscribeRoomStreamInput, bootstrap_anonymous_session, get_admin_overview,
        join_or_create_room_by_code, list_admin_rooms, list_joined_rooms, load_room_snapshot,
        search_rooms_by_code, send_text_message, subscribe_room_stream,
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

#[path = "app_cases/application.rs"]
mod application;
#[path = "bigbang_cases/mod.rs"]
mod bigbang_cases;
#[path = "app_cases/contract.rs"]
mod contract;
#[path = "app_cases/domain.rs"]
mod domain;
#[path = "app_cases/store.rs"]
mod store;

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
struct FakeAdminSessionPort {
    state: koko::app::AdminSessionState,
}

impl FakeAdminSessionPort {
    fn required() -> Self {
        Self {
            state: koko::app::AdminSessionState::Required,
        }
    }
}

impl AdminSessionPort for FakeAdminSessionPort {
    async fn create_admin_session(&self) -> Result<AdminSessionContext, AppError> {
        panic!("overview/rooms test should not create admin session")
    }

    async fn read_admin_session(
        &self,
        _context: &AdminSessionContext,
    ) -> Result<koko::app::AdminSessionState, AppError> {
        Ok(self.state)
    }

    async fn revoke_admin_session(&self, _context: &AdminSessionContext) -> Result<(), AppError> {
        panic!("overview/rooms test should not revoke admin session")
    }
}

#[derive(Debug, Default)]
struct FakeAdminOverviewPort;

impl AdminOverviewPort for FakeAdminOverviewPort {
    async fn get_admin_overview(&self) -> Result<koko::contract::AdminOverview, AppError> {
        panic!("admin overview port should not be called when admin access is denied");
    }
}

#[derive(Debug, Default)]
struct FakeAdminRoomsPort;

impl AdminRoomsPort for FakeAdminRoomsPort {
    async fn list_admin_rooms(&self) -> Result<Vec<koko::contract::AdminRoomSummary>, AppError> {
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
    RewriteCreatedAt(DateTime<Utc>),
}

impl MessageStoreOutcome {
    fn same() -> Self {
        Self::Same
    }

    fn rewrite_body(body: &'static str) -> Self {
        Self::RewriteBody(body)
    }

    fn rewrite_created_at(created_at: DateTime<Utc>) -> Self {
        Self::RewriteCreatedAt(created_at)
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
    async fn save_message(&self, message: Message) -> Result<PersistedMessageRecord, AppError> {
        self.recorded.lock().unwrap().push(message.clone());

        let persisted = match self.outcome {
            MessageStoreOutcome::Same => PersistedMessageRecord {
                message_id: message.message_id,
                room_id: message.room_id,
                sender_session_id: message.sender_session_id,
                body: message.body.as_str().to_string(),
                created_at: message.created_at,
                event_position: 1,
            },
            MessageStoreOutcome::RewriteBody(body) => PersistedMessageRecord {
                message_id: message.message_id,
                room_id: message.room_id,
                sender_session_id: message.sender_session_id,
                body: MessageBody::new(body).unwrap().as_str().to_string(),
                created_at: message.created_at,
                event_position: 1,
            },
            MessageStoreOutcome::RewriteCreatedAt(created_at) => PersistedMessageRecord {
                message_id: message.message_id,
                room_id: message.room_id,
                sender_session_id: message.sender_session_id,
                body: message.body.as_str().to_string(),
                created_at,
                event_position: 1,
            },
        };

        Ok(persisted)
    }
}

#[derive(Debug)]
struct FakeRoomEventPositionPort {
    latest_event_position: i64,
}

impl FakeRoomEventPositionPort {
    fn with_latest(latest_event_position: i64) -> Self {
        Self {
            latest_event_position,
        }
    }
}

impl RoomEventPositionPort for FakeRoomEventPositionPort {
    async fn latest_room_event_position(&self, _room_id: Uuid) -> Result<i64, AppError> {
        Ok(self.latest_event_position)
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
    ) -> Result<Vec<PersistedMessageRecord>, AppError> {
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
        latest_event_position: 1,
        messages: vec![MessageView {
            message_id: Uuid::from_u128(33),
            session_id,
            body: body.to_string(),
            created_at: fixed_time(),
            event_position: 1,
        }],
    }
}

fn sample_snapshot_data(
    room_id: Uuid,
    room_code: &str,
    mut messages: Vec<Message>,
) -> RoomSnapshotData {
    messages.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then(left.message_id.cmp(&right.message_id))
    });
    let messages = messages
        .into_iter()
        .enumerate()
        .map(|(index, message)| PersistedMessageRecord {
            message_id: message.message_id,
            room_id: message.room_id,
            sender_session_id: message.sender_session_id,
            body: message.body.as_str().to_string(),
            created_at: message.created_at,
            event_position: i64::try_from(index + 1).unwrap(),
        })
        .collect::<Vec<_>>();
    let latest_event_position = messages
        .last()
        .map(|message| message.event_position)
        .unwrap_or(0);

    RoomSnapshotData {
        room_id,
        room_code: RoomCode::new(room_code).unwrap(),
        latest_event_position,
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
    fn new(pool: PgPool) -> Self {
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
