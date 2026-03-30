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

pub trait RealtimePort {
    fn join_room(&self, room_id: Uuid) -> impl Future<Output = Result<(), AppError>> + Send;

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

    fn broadcast_message_created(
        &self,
        room_id: Uuid,
        payload: &MessageCreated,
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

fn warn_handler_failure(handler: &str, error: &AppError) {
    warn!(
        handler,
        code = crate::support::app_error_code(error),
        ?error,
        "realtime handler failed"
    );
}

pub struct SubscribeRoomStreamDeps<'a, S, M, R> {
    pub session_port: &'a S,
    pub membership_port: &'a M,
    pub realtime: &'a R,
}

pub struct SendTextMessageDeps<'a, S, M, Store, R, I, C> {
    pub session_port: &'a S,
    pub membership_port: &'a M,
    pub message_store: &'a Store,
    pub realtime: &'a R,
    pub id_generator: &'a I,
    pub clock: &'a C,
}

pub async fn handle_subscribe_room_stream<S, M, R>(
    deps: SubscribeRoomStreamDeps<'_, S, M, R>,
    command: SubscribeRoomStreamCommand,
) -> Result<(), AppError>
where
    S: SessionPort,
    M: app::MembershipPort,
    R: RealtimePort,
{
    match app::subscribe_room_stream(deps.session_port, deps.membership_port, command.clone()).await
    {
        Ok(()) => {
            deps.realtime.join_room(command.room_id).await?;
            deps.realtime
                .emit_room_stream_subscribed(command.room_id)
                .await?;
            Ok(())
        }
        Err(error) => {
            deps.realtime
                .emit_command_rejected(&CommandRejected { code: error.code() })
                .await?;
            Err(error)
        }
    }
}

pub async fn handle_send_text_message<S, M, Store, R, I, C>(
    deps: SendTextMessageDeps<'_, S, M, Store, R, I, C>,
    command: SendTextMessageCommand,
) -> Result<MessageCreated, AppError>
where
    S: SessionPort,
    M: MembershipPort,
    Store: MessageStore,
    R: RealtimePort,
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
            deps.realtime
                .emit_command_rejected(&CommandRejected { code: error.code() })
                .await?;
            return Err(error);
        }
    };

    match event {
        crate::contract::AppEvent::MessageCreated(payload) => {
            deps.realtime.emit_message_accepted(&payload).await?;
            deps.realtime
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
            let io_for_subscribe = io_for_events.clone();

            socket.on("subscribe_room_stream", {
                let state = state.clone();
                move |socket: SocketRef, Data(command): Data<SubscribeRoomStreamCommand>| {
                    let state = state.clone();
                    let io = io_for_subscribe.clone();
                    async move {
                        let realtime = SocketRealtimePort::new(socket, io);
                        if let Err(error) = handle_subscribe_room_stream(
                            SubscribeRoomStreamDeps {
                                session_port: &state.store,
                                membership_port: &state.store,
                                realtime: &realtime,
                            },
                            command,
                        )
                        .await
                        {
                            warn_handler_failure("subscribe_room_stream", &error);
                        }
                    }
                }
            });

            socket.on("send_text_message", {
                let state = state.clone();
                let io = io_for_events.clone();
                move |socket: SocketRef, Data(command): Data<SendTextMessageCommand>| {
                    let state = state.clone();
                    let realtime = SocketRealtimePort::new(socket, io.clone());
                    async move {
                        if let Err(error) = handle_send_text_message(
                            SendTextMessageDeps {
                                session_port: &state.store,
                                membership_port: &state.store,
                                message_store: &state.store,
                                realtime: &realtime,
                                id_generator: &state.id_generator,
                                clock: &state.clock,
                            },
                            command,
                        )
                        .await
                        {
                            warn_handler_failure("send_text_message", &error);
                        }
                    }
                }
            });
        }
    });
}

#[derive(Clone)]
struct SocketRealtimePort {
    socket: SocketRef,
    io: SocketIo,
}

impl SocketRealtimePort {
    fn new(socket: SocketRef, io: SocketIo) -> Self {
        Self { socket, io }
    }
}

impl RealtimePort for SocketRealtimePort {
    async fn join_room(&self, room_id: Uuid) -> Result<(), AppError> {
        self.socket.join(room_id.to_string());
        Ok(())
    }

    async fn emit_room_stream_subscribed(&self, room_id: Uuid) -> Result<(), AppError> {
        self.socket
            .emit("room_stream_subscribed", &RoomStreamSubscribed { room_id })
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
