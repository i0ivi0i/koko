use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    http::{HeaderMap, HeaderValue, header::COOKIE},
    routing::get,
};
use chrono::{TimeZone, Utc};
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use koko::{
    app::{
        AppError, Clock, IdGenerator, MembershipPort, MessageStore, SendTextMessageInput,
        SessionPort, SubscribeRoomStreamInput,
    },
    contract::{
        MessageCreated, RoomStreamSubscribed, SendTextMessageCommand, SubscribeRoomStreamCommand,
    },
    domain::Message,
    rt::{
        AuthenticatedSession, RealtimeState, authenticate_realtime_session, install_realtime,
        send_text_message_input, subscribe_room_stream_input,
    },
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{self, Message as WsMessage, client::IntoClientRequest},
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
async fn subscribe_room_stream_input_uses_authenticated_session() {
    let input = subscribe_room_stream_input(
        AuthenticatedSession {
            session_id: Uuid::from_u128(2),
        },
        SubscribeRoomStreamCommand {
            room_id: Uuid::from_u128(1),
        },
    );

    assert_eq!(
        input,
        SubscribeRoomStreamInput {
            room_id: Uuid::from_u128(1),
            session_id: Uuid::from_u128(2),
        }
    );
}

#[tokio::test]
async fn send_text_message_input_uses_authenticated_session() {
    let input = send_text_message_input(
        AuthenticatedSession {
            session_id: Uuid::from_u128(2),
        },
        SendTextMessageCommand {
            room_id: Uuid::from_u128(1),
            body: "hello".to_string(),
            client_message_id: None,
        },
    );

    assert_eq!(
        input,
        SendTextMessageInput {
            room_id: Uuid::from_u128(1),
            session_id: Uuid::from_u128(2),
            body: "hello".to_string(),
            client_message_id: None,
        }
    );
}

#[tokio::test]
async fn sender_receives_message_accepted_but_not_message_created() {
    let room_id = Uuid::from_u128(11);
    let sender_session_id = Uuid::from_u128(12);
    let receiver_session_id = Uuid::from_u128(13);
    let client_message_id = Uuid::from_u128(14);
    let message_id = Uuid::from_u128(15);
    let harness = RealtimeHarness::spawn(
        RealtimeTestStore::new(
            [sender_session_id, receiver_session_id],
            [(room_id, sender_session_id), (room_id, receiver_session_id)],
        ),
        message_id,
    )
    .await;

    assert!(
        connect_error_text(harness.base_url())
            .await
            .contains("not active")
    );

    let mut sender_room_stream = mpsc::unbounded_channel();
    let mut sender_message_accepted = mpsc::unbounded_channel();
    let mut sender_message_created = mpsc::unbounded_channel();
    let mut sender_connected = mpsc::unbounded_channel();
    let mut sender = connect_client(
        harness.base_url(),
        sender_session_id,
        ClientChannels::new(
            sender_connected.0,
            sender_room_stream.0,
            sender_message_accepted.0,
            sender_message_created.0,
        ),
    )
    .await
    .unwrap();

    let mut receiver_room_stream = mpsc::unbounded_channel();
    let mut receiver_message_accepted = mpsc::unbounded_channel();
    let mut receiver_message_created = mpsc::unbounded_channel();
    let mut receiver_connected = mpsc::unbounded_channel();
    let mut receiver = connect_client(
        harness.base_url(),
        receiver_session_id,
        ClientChannels::new(
            receiver_connected.0,
            receiver_room_stream.0,
            receiver_message_accepted.0,
            receiver_message_created.0,
        ),
    )
    .await
    .unwrap();

    next_event("sender connected", &mut sender_connected.1).await;
    next_event("receiver connected", &mut receiver_connected.1).await;

    sender
        .emit("subscribe_room_stream", json!({ "room_id": room_id }))
        .await
        .unwrap();
    receiver
        .emit("subscribe_room_stream", json!({ "room_id": room_id }))
        .await
        .unwrap();

    assert_eq!(
        next_event("sender subscribed", &mut sender_room_stream.1).await,
        RoomStreamSubscribed { room_id }
    );
    assert_eq!(
        next_event("receiver subscribed", &mut receiver_room_stream.1).await,
        RoomStreamSubscribed { room_id }
    );

    sender
        .emit(
            "send_text_message",
            json!({
                "room_id": room_id,
                "body": " hello direct realtime ",
                "client_message_id": client_message_id,
            }),
        )
        .await
        .unwrap();

    let accepted = next_event("sender message_accepted", &mut sender_message_accepted.1).await;
    assert_eq!(
        accepted,
        MessageCreated {
            message_id,
            room_id,
            session_id: sender_session_id,
            body: "hello direct realtime".to_string(),
            created_at: fixed_time(),
            client_message_id: Some(client_message_id),
        }
    );

    assert_eq!(
        next_event("receiver message_created", &mut receiver_message_created.1).await,
        accepted.clone()
    );
    assert!(
        timeout(Duration::from_millis(300), sender_message_created.1.recv())
            .await
            .is_err()
    );
    assert!(receiver_message_accepted.1.try_recv().is_err());

    sender.disconnect().await.unwrap();
    receiver.disconnect().await.unwrap();
    harness.shutdown().await;
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
async fn authenticate_realtime_session_reads_quoted_koko_session_cookie_value() {
    let session_id = Uuid::from_u128(3);
    let mut headers = HeaderMap::new();
    headers.append(
        COOKIE,
        HeaderValue::from_str(&format!("theme=dark; koko_session=\"{session_id}\"")).unwrap(),
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
    assert_eq!(
        missing_cookie_error.code(),
        koko::contract::AppErrorCode::InvalidSession
    );

    let mut invalid_cookie = HeaderMap::new();
    invalid_cookie.append(COOKIE, HeaderValue::from_static("koko_session=not-a-uuid"));
    let invalid_cookie_error =
        authenticate_realtime_session(&FakeSessionPort::allow(), &invalid_cookie)
            .await
            .unwrap_err();
    assert_eq!(
        invalid_cookie_error.code(),
        koko::contract::AppErrorCode::InvalidSession
    );

    let mut inactive_cookie = HeaderMap::new();
    inactive_cookie.append(
        COOKIE,
        HeaderValue::from_str(&format!("koko_session={}", Uuid::from_u128(2))).unwrap(),
    );
    let inactive_cookie_error =
        authenticate_realtime_session(&FakeSessionPort::deny(), &inactive_cookie)
            .await
            .unwrap_err();
    assert_eq!(
        inactive_cookie_error.code(),
        koko::contract::AppErrorCode::InvalidSession
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

#[derive(Debug, Clone)]
struct RealtimeTestStore {
    active_sessions: Arc<HashSet<Uuid>>,
    memberships: Arc<HashSet<(Uuid, Uuid)>>,
    persisted_messages: Arc<Mutex<Vec<Message>>>,
}

impl RealtimeTestStore {
    fn new(
        active_sessions: impl IntoIterator<Item = Uuid>,
        memberships: impl IntoIterator<Item = (Uuid, Uuid)>,
    ) -> Self {
        Self {
            active_sessions: Arc::new(active_sessions.into_iter().collect()),
            memberships: Arc::new(memberships.into_iter().collect()),
            persisted_messages: Arc::default(),
        }
    }
}

impl SessionPort for RealtimeTestStore {
    async fn is_active_session(&self, session_id: Uuid) -> Result<bool, AppError> {
        Ok(self.active_sessions.contains(&session_id))
    }
}

impl MembershipPort for RealtimeTestStore {
    async fn is_room_member(&self, room_id: Uuid, session_id: Uuid) -> Result<bool, AppError> {
        Ok(self.memberships.contains(&(room_id, session_id)))
    }
}

impl MessageStore for RealtimeTestStore {
    async fn save_message(&self, message: Message) -> Result<Message, AppError> {
        self.persisted_messages
            .lock()
            .unwrap()
            .push(message.clone());
        Ok(message)
    }
}

#[derive(Debug, Clone, Copy)]
struct FixedIdGenerator(Uuid);

impl IdGenerator for FixedIdGenerator {
    fn next_message_id(&self) -> Uuid {
        self.0
    }
}

#[derive(Debug, Clone, Copy)]
struct FixedClock(chrono::DateTime<Utc>);

impl Clock for FixedClock {
    fn now(&self) -> chrono::DateTime<Utc> {
        self.0
    }
}

type ClientSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type ClientWriter = SplitSink<ClientSocket, WsMessage>;

#[derive(Debug)]
struct ClientChannels {
    connected: mpsc::UnboundedSender<()>,
    room_stream_subscribed: mpsc::UnboundedSender<RoomStreamSubscribed>,
    message_accepted: mpsc::UnboundedSender<MessageCreated>,
    message_created: mpsc::UnboundedSender<MessageCreated>,
}

impl ClientChannels {
    fn new(
        connected: mpsc::UnboundedSender<()>,
        room_stream_subscribed: mpsc::UnboundedSender<RoomStreamSubscribed>,
        message_accepted: mpsc::UnboundedSender<MessageCreated>,
        message_created: mpsc::UnboundedSender<MessageCreated>,
    ) -> Self {
        Self {
            connected,
            room_stream_subscribed,
            message_accepted,
            message_created,
        }
    }
}

struct RealtimeHarness {
    base_url: String,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: JoinHandle<()>,
}

impl RealtimeHarness {
    async fn spawn(store: RealtimeTestStore, message_id: Uuid) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (socket_layer, io) = socketioxide::SocketIo::new_layer();
        let realtime = Arc::new(RealtimeState::new(
            store,
            FixedIdGenerator(message_id),
            FixedClock(fixed_time()),
        ));
        install_realtime(&io, realtime);

        let router = Router::new()
            .route("/", get(|| async { "ok" }))
            .layer(socket_layer);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let server_task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .unwrap();
        });

        tokio::time::sleep(Duration::from_millis(50)).await;

        Self {
            base_url,
            shutdown_tx: Some(shutdown_tx),
            server_task,
        }
    }

    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn shutdown(mut self) {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
        self.server_task.await.unwrap();
    }
}

struct Client {
    writer: ClientWriter,
    read_task: JoinHandle<()>,
}

impl Client {
    async fn emit(&mut self, event: &str, payload: Value) -> Result<(), tungstenite::Error> {
        self.writer
            .send(WsMessage::Text(socket_io_event(event, payload).into()))
            .await
    }

    async fn disconnect(mut self) -> Result<(), tungstenite::Error> {
        self.writer.send(WsMessage::Text("41".into())).await?;
        self.writer.close().await?;
        self.read_task.await.unwrap();
        Ok(())
    }
}

async fn connect_error_text(base_url: &str) -> String {
    let request = socket_io_request(base_url, None);
    let (mut socket, _) = connect_async(request).await.unwrap();
    expect_engine_open(&mut socket).await.unwrap();
    socket.send(WsMessage::Text("40".into())).await.unwrap();

    loop {
        let frame = next_text_frame(&mut socket).await.unwrap();
        if frame.starts_with("44") || frame.contains("not active") {
            let _ = socket.send(WsMessage::Close(None)).await;
            return frame;
        }
    }
}

async fn connect_client(
    base_url: &str,
    session_id: Uuid,
    channels: ClientChannels,
) -> Result<Client, tungstenite::Error> {
    let ClientChannels {
        connected,
        room_stream_subscribed,
        message_accepted,
        message_created,
    } = channels;

    let request = socket_io_request(base_url, Some(session_id));
    let (mut socket, _) = connect_async(request).await?;
    expect_engine_open(&mut socket).await?;
    socket.send(WsMessage::Text("40".into())).await?;

    loop {
        let frame = next_text_frame(&mut socket).await?;
        if frame.starts_with("40") {
            let _ = connected.send(());
            break;
        }
    }

    let (writer, mut reader) = socket.split();
    let read_task = tokio::spawn(async move {
        while let Some(message) = reader.next().await {
            let Ok(WsMessage::Text(frame)) = message else {
                continue;
            };

            let Some((event, payload)) = parse_socket_io_event(frame.as_ref()) else {
                continue;
            };

            match event.as_str() {
                "room_stream_subscribed" => {
                    let _ = room_stream_subscribed.send(deserialize_payload(payload));
                }
                "message_accepted" => {
                    let _ = message_accepted.send(deserialize_payload(payload));
                }
                "message_created" => {
                    let _ = message_created.send(deserialize_payload(payload));
                }
                _ => {}
            }
        }
    });

    Ok(Client { writer, read_task })
}

async fn next_event<T>(label: &'static str, rx: &mut mpsc::UnboundedReceiver<T>) -> T {
    timeout(Duration::from_secs(3), rx.recv())
        .await
        .unwrap_or_else(|_| panic!("{label} timed out"))
        .unwrap_or_else(|| panic!("{label} channel closed"))
}

fn deserialize_payload<T>(payload: Value) -> T
where
    T: DeserializeOwned,
{
    serde_json::from_value(payload).unwrap()
}

fn socket_io_request(
    base_url: &str,
    session_id: Option<Uuid>,
) -> tungstenite::handshake::client::Request {
    let ws_url = base_url.replacen("http://", "ws://", 1) + "/socket.io/?EIO=4&transport=websocket";
    let mut request = ws_url.into_client_request().unwrap();
    if let Some(session_id) = session_id {
        request.headers_mut().insert(
            COOKIE,
            HeaderValue::from_str(&format!("koko_session={session_id}")).unwrap(),
        );
    }

    request
}

async fn expect_engine_open(socket: &mut ClientSocket) -> Result<(), tungstenite::Error> {
    let frame = next_text_frame(socket).await?;
    assert!(frame.starts_with('0'), "expected engine open frame, got {frame}");
    Ok(())
}

async fn next_text_frame(socket: &mut ClientSocket) -> Result<String, tungstenite::Error> {
    loop {
        match socket.next().await {
            Some(Ok(WsMessage::Text(text))) => return Ok(text.to_string()),
            Some(Ok(WsMessage::Ping(payload))) => {
                socket.send(WsMessage::Pong(payload)).await?;
            }
            Some(Ok(WsMessage::Close(_))) => return Ok(String::new()),
            Some(Ok(_)) => continue,
            Some(Err(error)) => return Err(error),
            None => return Ok(String::new()),
        }
    }
}

fn socket_io_event(event: &str, payload: Value) -> String {
    format!("42{}", json!([event, payload]))
}

fn parse_socket_io_event(frame: &str) -> Option<(String, Value)> {
    let payload = frame.strip_prefix("42")?;
    let Value::Array(mut values) = serde_json::from_str::<Value>(payload).ok()? else {
        return None;
    };
    if values.len() != 2 {
        return None;
    }

    let payload = values.pop()?;
    let Value::String(event) = values.pop()? else {
        return None;
    };

    Some((event, payload))
}

fn fixed_time() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()
}
