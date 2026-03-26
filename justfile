set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default:
    @just --list

init:
    cargo run -p xtask -- init

dev:
    cargo run -p xtask -- dev

migrate:
    cargo run -p xtask -- migrate

test:
    cargo run -p xtask -- test

check:
    cargo run -p xtask -- check
