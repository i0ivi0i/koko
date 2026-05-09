# syntax=docker/dockerfile:1

# 前端构建阶段只负责产出浏览器正式静态资源。
# 这里保留完整前端依赖，是因为 `frontend/build.mjs` 需要 devDependencies。
FROM node:24-bookworm AS frontend-builder
WORKDIR /app

RUN corepack enable

COPY frontend/package.json frontend/pnpm-lock.yaml ./frontend/
RUN export PNPM_VERSION="$(node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync('./frontend/package.json', 'utf8')); if (!pkg.packageManager || !pkg.packageManager.startsWith('pnpm@')) { throw new Error('frontend/package.json 缺少 pnpm packageManager'); } process.stdout.write(pkg.packageManager.slice('pnpm@'.length));")" \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && pnpm --dir frontend install --frozen-lockfile

COPY scripts ./scripts
COPY frontend ./frontend
RUN cd frontend \
    && node ../scripts/check-frontend-browser-app-constitution.mjs \
    && node ../scripts/check-frontend-architecture-fitness.mjs \
    && pnpm typecheck \
    && node build.mjs

# Rust builder 只编后端二进制与嵌入式迁移，不接管前端产物。
FROM rust:1.92-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock build.rs ./
COPY src ./src
COPY koko-torrent-core ./koko-torrent-core
COPY migrations ./migrations
COPY assets ./assets

RUN cargo build --release

# 正式 app runtime 只保留：
# 1. Rust release 二进制；
# 2. 前端入口模板 `frontend/index.html`；
# 3. 已构建静态资源 `frontend/dist`。
# 运行时不带源码、不带测试、不带 pnpm/node_modules。
FROM debian:12-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/koko /app/koko
COPY --from=frontend-builder /app/frontend/index.html /app/frontend/index.html
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

EXPOSE 8080

CMD ["/app/koko"]

# Node sidecar runtime 专门给 tracker / seeder 共用：
# - tracker 复用成熟 `bittorrent-tracker`；
# - seeder 复用仓库当前真实 owner `frontend/dev-seeder.mjs`；
# - `bittorrent-tracker` 当前在 frontend/devDependencies，不能只装 `--prod`；
#   所以这里直接复用 frontend-builder 已安装好的完整 node_modules，
#   避免部署镜像和真实依赖表长出第二套真相。
FROM node:24-bookworm-slim AS sidecar-runtime
WORKDIR /app

COPY --from=frontend-builder /app/frontend/package.json /app/frontend/package.json
COPY --from=frontend-builder /app/frontend/dev-seeder.mjs /app/frontend/dev-seeder.mjs
COPY --from=frontend-builder /app/frontend/node_modules /app/frontend/node_modules

CMD ["node", "frontend/dev-seeder.mjs"]

# Caddy 正式环境需要接 Cloudflare DNS 插件，避免长期橙云下证书续期依赖灰云切换。
FROM caddy:2.10-builder AS caddy-builder
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2.10 AS caddy-runtime
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
