default:
    @just --list

init:
    cargo run -p xtask -- init

dev:
    cargo run -p xtask -- dev

migrate:
    cargo run -p xtask -- migrate

test:
    cargo test

check:
    cargo check -p koko-server
    cargo check -p koko-web --target wasm32-unknown-unknown
