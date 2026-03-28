use dioxus::prelude::*;

use crate::{
    chat::ChatScreen,
    client::{self, MemberAction},
    member::MemberSheet,
    room::RoomEntryScreen,
    state::{self, ActiveRoom},
    theme::APP_STYLE,
};

#[component]
pub fn App() -> Element {
    let mut members_open = use_signal(|| false);
    let mut room_state = use_signal(|| None::<ActiveRoom>);
    let mut room_client = use_signal(|| None::<client::JoinedRoomClient>);
    let loading = use_signal(|| false);
    let mut loading_older_messages = use_signal(|| false);
    let mut error_message = use_signal(|| None::<String>);

    rsx! {
        document::Title { "Koko" }
        document::Style { "{APP_STYLE}" }

        div { class: "app-shell",
            if let Some(room) = room_state() {
                ChatScreen {
                    room_code: room.room_code.clone(),
                    profile_id: room.profile_id.clone(),
                    display_name: room.display_name.clone(),
                    messages: room.messages.clone(),
                    member_count: room.members.len(),
                    on_back: move |_| {
                        if let Some(client) = room_client() {
                            client.close();
                        }
                        room_state.with_mut(state::leave_room);
                        room_client.set(None);
                        members_open.set(false);
                        loading_older_messages.set(false);
                        error_message.set(None);
                    },
                    on_open_members: move |_| members_open.set(true),
                    has_more_messages: room.has_more_messages,
                    loading_more_messages: loading_older_messages(),
                    on_load_older: move |_| {
                        if loading_older_messages() {
                            return;
                        }
                        if let Some(current_room) = room_state() {
                            let Some(before_message_id) = state::earliest_message_id(&current_room) else {
                                return;
                            };
                            let room_id = current_room.room_id.clone();
                            let mut room_state = room_state;
                            let mut loading_older_messages = loading_older_messages;

                            spawn(async move {
                                loading_older_messages.set(true);

                                if let Ok(response) = client::fetch_room_messages(
                                    &room_id,
                                    &current_room.session_id,
                                    Some(&before_message_id),
                                )
                                .await
                                {
                                    room_state.with_mut(|state| {
                                        state::prepend_messages_if_room_matches(
                                            state,
                                            &room_id,
                                            response.items,
                                            response.has_more,
                                        );
                                    });
                                }

                                loading_older_messages.set(false);
                            });
                        }
                    },
                    on_send: move |content: String| {
                        if let Some(current_room) = room_state() {
                            send_room_message(
                                room_state,
                                room_client,
                                current_room,
                                content,
                            );
                        }
                    },
                }
                MemberSheet {
                    open: members_open(),
                    current_role: room.role.clone(),
                    current_profile_id: room.profile_id.clone(),
                    members: room.members.clone(),
                    on_promote: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            spawn_member_action(room_state, room, target_profile_id, MemberAction::Promote);
                        }
                    },
                    on_mute: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            spawn_member_action(room_state, room, target_profile_id, MemberAction::Mute);
                        }
                    },
                    on_remove: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            spawn_member_action(room_state, room, target_profile_id, MemberAction::Remove);
                        }
                    },
                    on_close: move |_| members_open.set(false),
                }
            } else {
                RoomEntryScreen {
                    loading: loading(),
                    error_message: error_message(),
                    on_enter: move |code: String| {
                        let mut room_state = room_state;
                        let mut loading = loading;
                        let mut error_message = error_message;

                        spawn(async move {
                            loading.set(true);
                            error_message.set(None);

                            match client::join_room(&code).await {
                                Ok(snapshot) => {
                                    let room = state::apply_joined_room(snapshot);
                                    let room_id = room.room_id.clone();
                                    let session_id = room.session_id.clone();
                                    loading_older_messages.set(false);
                                    room_state.set(Some(room));
                                    let connection = client::connect_joined_room(
                                        room_id.clone(),
                                        session_id,
                                        move |message| {
                                            room_state.with_mut(|state| {
                                                state::append_message_if_room_matches(
                                                    state,
                                                    &room_id,
                                                    message,
                                                );
                                            });
                                        },
                                    );
                                    room_client.set(Some(connection));
                                }
                                Err(error) => error_message.set(Some(error)),
                            }

                            loading.set(false);
                        });
                    },
                }
            }
        }
    }
}

fn send_room_message(
    mut room_state: Signal<Option<ActiveRoom>>,
    room_client: Signal<Option<client::JoinedRoomClient>>,
    room: ActiveRoom,
    content: String,
) {
    if let Some(client) = room_client() {
        let _ = client.send_message(&content);
        return;
    }

    let room_id = room.room_id.clone();
    spawn(async move {
        if let Ok(message) = client::send_message(&room.room_id, &room.session_id, &content).await {
            room_state.with_mut(|state| {
                state::append_message_if_room_matches(state, &room_id, message);
            });
        }
    });
}

fn spawn_member_action(
    mut room_state: Signal<Option<ActiveRoom>>,
    room: ActiveRoom,
    target_profile_id: String,
    action: MemberAction,
) {
    spawn(async move {
        let _ =
            client::run_member_action(action, &room.room_id, &room.session_id, &target_profile_id)
                .await;
        if let Ok(members) = client::fetch_room_members(&room.room_id, &room.session_id).await {
            room_state.with_mut(|state| {
                if let Some(current) = state.as_mut() {
                    state::replace_members(current, members);
                }
            });
        }
    });
}
