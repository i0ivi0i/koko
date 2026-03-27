mod app;
mod chat;
mod client;
mod member;
mod room;
mod state;
mod theme;
mod ui;

fn main() {
    dioxus::launch(app::App);
}
