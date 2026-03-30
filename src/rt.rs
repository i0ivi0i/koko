use std::{future::Future, sync::Arc};

use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tracing::warn;
use uuid::Uuid;

use crate::{
    app::{self, AppError, Clock, IdGenerator, MembershipPort, MessageStore, SessionPort},
    contract::{
        CommandRejected, MessageCreated, RoomStreamSubscribed, SendTextMessageCommand,
        SubscribeRoomStreamCommand,
    },
};

#[derive(Debug, Clone, Copy)]
pub struct Module;

pub trait RoomSubscriber {
    fn join_room(&self, room: &str) -> impl Future<Output = Result<(), AppError>> + Send;
}

pub trait RoomBroadcaster {
    fn broadcast_message_created(
        &self,
        room_id: Uuid,
        payload: &MessageCreated,
    ) -> impl Future<Output = Result<(), AppError>> + Send;
}

pub trait RealtimeResponder {
    fn emit_room_stream_subscribed(
        &self,
        room_id: Uuid,
    ) -> impl Future<Output = Result<(), AppError>> + Send;

    fn emit_message_accepted(
        &self,
        payload: &MessageCreated,
    ) -> impl Future<Output = Result<(), AppError>> + Send;

    fn emit_command_rejected(
        &self,
        payload: &CommandRejected,
    ) -> impl Future<Output = Result<(), AppError>> + Send;
}

#[derive(Clone)]
pub struct RealtimeState<Store, IdGen, AppClock> {
    store: Store,
    id_generator: IdGen,
    clock: AppClock,
}

impl<Store, IdGen, AppClock> RealtimeState<Store, IdGen, AppClock> {
    pub fn new(store: Store, id_generator: IdGen, clock: AppClock) -> Self {
        Self {
            store,
            id_generator,
            clock,
        }
    }
}

pub struct SubscribeRoomStreamDeps<'a, S, M, R, N> {
    pub session_port: &'a S,
    pub membership_port: &'a M,
    pub subscriber: &'a R,
    pub responder: &'a N,
}

pub struct SendTextMessageDeps<'a, S, M, Store, B, N, I, C> {
    pub session_port: &'a S,
    pub membership_port: &'a M,
    pub message_store: &'a Store,
    pub broadcaster: &'a B,
    pub responder: &'a N,
    pub id_generator: &'a I,
    pub clock: &'a C,
}

pub async fn handle_subscribe_room_stream<S, M, R, N>(
    deps: SubscribeRoomStreamDeps<'_, S, M, R, N>,
    command: SubscribeRoomStreamCommand,
) -> Result<(), AppError>
where
    S: SessionPort,
    M: app::MembershipPort,
    R: RoomSubscriber,
    N: RealtimeResponder,
{
    match app::subscribe_room_stream(deps.session_port, deps.membership_port, command.clone()).await
    {
        Ok(()) => {
            deps.subscriber.join_room(&command.room_id.to_string()).await?;
            deps.responder
                .emit_room_stream_subscribed(command.room_id)
                .await?;
            Ok(())
        }
        Err(error) => {
            deps.responder
                .emit_command_rejected(&CommandRejected { code: error.code() })
                .await?;
            Err(error)
        }
    }
}

pub async fn handle_send_text_message<S, M, Store, B, N, I, C>(
    deps: SendTextMessageDeps<'_, S, M, Store, B, N, I, C>,
    command: SendTextMessageCommand,
) -> Result<MessageCreated, AppError>
where
    S: SessionPort,
    M: MembershipPort,
    Store: MessageStore,
    B: RoomBroadcaster,
    N: RealtimeResponder,
    I: IdGenerator,
    C: Clock,
{
    let room_id = command.room_id;
    let event = match app::send_text_message(
        deps.session_port,
        deps.membership_port,
        deps.message_store,
        deps.id_generator,
        deps.clock,
        command,
    )
    .await
    {
        Ok(event) => event,
        Err(error) => {
            deps.responder
                .emit_command_rejected(&CommandRejected { code: error.code() })
                .await?;
            return Err(error);
        }
    };

    match event {
        crate::contract::AppEvent::MessageCreated(payload) => {
            deps.responder.emit_message_accepted(&payload).await?;
            deps.broadcaster
                .broadcast_message_created(room_id, &payload)
                .await?;
            Ok(payload)
        }
    }
}

pub fn install_realtime<Store, IdGen, AppClock>(
    io: &SocketIo,
    state: Arc<RealtimeState<Store, IdGen, AppClock>>,
) where
    Store: SessionPort + MembershipPort + MessageStore + Clone + Send + Sync + 'static,
    IdGen: IdGenerator + Clone + Send + Sync + 'static,
    AppClock: Clock + Clone + Send + Sync + 'static,
{
    io.ns("/", move |socket: SocketRef, io: SocketIo| {
        let state = state.clone();
        async move {
            let io_for_events = io.clone();

            socket.on("subscribe_room_stream", {
                let state = state.clone();
                move |socket: SocketRef, Data(command): Data<SubscribeRoomStreamCommand>| {
                    let state = state.clone();
                    async move {
                        let subscriber = SocketRoomSubscriber::new(socket);
                        let responder = SocketRealtimeResponder::new(subscriber.socket.clone());
                        if let Err(error) = handle_subscribe_room_stream(
                            SubscribeRoomStreamDeps {
                                session_port: &state.store,
                                membership_port: &state.store,
                                subscriber: &subscriber,
                                responder: &responder,
                            },
                            command,
                        )
                        .await
                        {
                            warn!(?error, "subscribe_room_stream handler failed");
                        }
                    }
                }
            });

            socket.on("send_text_message", {
                let state = state.clone();
                let io = io_for_events.clone();
                move |socket: SocketRef, Data(command): Data<SendTextMessageCommand>| {
                    let state = state.clone();
                    let broadcaster = SocketRoomBroadcaster::new(io.clone());
                    let responder = SocketRealtimeResponder::new(socket);
                    async move {
                        if let Err(error) = handle_send_text_message(
                            SendTextMessageDeps {
                                session_port: &state.store,
                                membership_port: &state.store,
                                message_store: &state.store,
                                broadcaster: &broadcaster,
                                responder: &responder,
                                id_generator: &state.id_generator,
                                clock: &state.clock,
                            },
                            command,
                        )
                        .await
                        {
                            warn!(?error, "send_text_message handler failed");
                        }
                    }
                }
            });
        }
    });
}

#[derive(Clone)]
struct SocketRoomSubscriber {
    socket: SocketRef,
}

impl SocketRoomSubscriber {
    fn new(socket: SocketRef) -> Self {
        Self { socket }
    }
}

impl RoomSubscriber for SocketRoomSubscriber {
    async fn join_room(&self, room: &str) -> Result<(), AppError> {
        self.socket.join(room.to_string());
        Ok(())
    }
}

#[derive(Clone)]
struct SocketRoomBroadcaster {
    io: SocketIo,
}

impl SocketRoomBroadcaster {
    fn new(io: SocketIo) -> Self {
        Self { io }
    }
}

impl RoomBroadcaster for SocketRoomBroadcaster {
    async fn broadcast_message_created(
        &self,
        room_id: Uuid,
        payload: &MessageCreated,
    ) -> Result<(), AppError> {
        self.io
            .to(room_id.to_string())
            .emit("message_created", payload)
            .await
            .map_err(|_| AppError::DependencyFailure)
    }
}

#[derive(Clone)]
struct SocketRealtimeResponder {
    socket: SocketRef,
}

impl SocketRealtimeResponder {
    fn new(socket: SocketRef) -> Self {
        Self { socket }
    }
}

impl RealtimeResponder for SocketRealtimeResponder {
    async fn emit_room_stream_subscribed(&self, room_id: Uuid) -> Result<(), AppError> {
        self.socket
            .emit(
                "room_stream_subscribed",
                &RoomStreamSubscribed { room_id },
            )
            .map_err(|_| AppError::DependencyFailure)
    }

    async fn emit_message_accepted(&self, payload: &MessageCreated) -> Result<(), AppError> {
        self.socket
            .emit("message_accepted", payload)
            .map_err(|_| AppError::DependencyFailure)
    }

    async fn emit_command_rejected(&self, payload: &CommandRejected) -> Result<(), AppError> {
        self.socket
            .emit("command_rejected", payload)
            .map_err(|_| AppError::DependencyFailure)
    }
}
