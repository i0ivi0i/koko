use std::{future::Future, sync::Arc};

use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use uuid::Uuid;

use crate::{
    app::{self, AppError, Clock, IdGenerator, MembershipPort, MessageStore, SessionPort},
    contract::{MessageCreated, SendTextMessageCommand, SubscribeRoomStreamCommand},
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

pub async fn subscribe_room_stream<S, M, R>(
    session_port: &S,
    membership_port: &M,
    subscriber: &R,
    command: SubscribeRoomStreamCommand,
) -> Result<(), AppError>
where
    S: SessionPort,
    M: MembershipPort,
    R: RoomSubscriber,
{
    if !session_port.is_active_session(command.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: command.session_id,
        });
    }

    if !membership_port
        .is_room_member(command.room_id, command.session_id)
        .await?
    {
        return Err(AppError::NotRoomMember {
            room_id: command.room_id,
            session_id: command.session_id,
        });
    }

    subscriber.join_room(&command.room_id.to_string()).await
}

pub async fn send_text_message_and_broadcast<S, M, Store, B, I, C>(
    session_port: &S,
    membership_port: &M,
    message_store: &Store,
    broadcaster: &B,
    id_generator: &I,
    clock: &C,
    command: SendTextMessageCommand,
) -> Result<MessageCreated, AppError>
where
    S: SessionPort,
    M: MembershipPort,
    Store: MessageStore,
    B: RoomBroadcaster,
    I: IdGenerator,
    C: Clock,
{
    let room_id = command.room_id;
    let event = app::send_text_message(
        session_port,
        membership_port,
        message_store,
        id_generator,
        clock,
        command,
    )
    .await?;

    match event {
        crate::contract::AppEvent::MessageCreated(payload) => {
            broadcaster
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
                        let _ = subscribe_room_stream(
                            &state.store,
                            &state.store,
                            &subscriber,
                            command,
                        )
                        .await;
                    }
                }
            });

            socket.on("send_text_message", {
                let state = state.clone();
                let io = io_for_events.clone();
                move |Data(command): Data<SendTextMessageCommand>| {
                    let state = state.clone();
                    let broadcaster = SocketRoomBroadcaster::new(io.clone());
                    async move {
                        let _ = send_text_message_and_broadcast(
                            &state.store,
                            &state.store,
                            &state.store,
                            &broadcaster,
                            &state.id_generator,
                            &state.clock,
                            command,
                        )
                        .await;
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
