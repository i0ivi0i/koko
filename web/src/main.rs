mod app;
mod chat;
mod member;
mod room;
mod theme;
mod ui;

fn main() {
    dioxus::launch(app::App);
}
