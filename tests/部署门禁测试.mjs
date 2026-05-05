import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { spawnSync } from "node:child_process";

const 仓库根目录 = resolve(import.meta.dirname, "..");
const 门禁脚本路径 = join(仓库根目录, "scripts", "check-deployment-architecture-fitness.mjs");

function 创建临时夹具目录() {
  return mkdtempSync(join(tmpdir(), "koko-deploy-gate-"));
}

function 写文件(rootDir, relativePath, content) {
  const fullPath = join(rootDir, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
}

function 创建最小运行主链夹具(rootDir, extra = {}) {
  写文件(rootDir, ".dockerignore", ".git\n");
  写文件(rootDir, "Dockerfile", extra.Dockerfile ?? "FROM node:22 AS builder\nRUN echo ok\n");
  写文件(rootDir, "ops/Caddyfile", extra.Caddyfile ?? ":443 {\n  respond /files 200\n  respond /api/swarm/announce 200\n}\n");
  写文件(
    rootDir,
    "ops/compose.yaml",
    extra.composeYaml ??
      [
        "services:",
        "  app: {}",
        "  postgres: {}",
        "  tusd: {}",
        "  tracker: {}",
        "  seeder: {}",
        "  caddy: {}",
        "",
      ].join("\n")
  );
}

function 创建合法运行主链夹具(rootDir, extra = {}) {
  写文件(
    rootDir,
    ".dockerignore",
    extra.dockerignore ??
      [
        ".git",
        "docs",
        "tests",
        "graphify-out",
        ".codex",
        "frontend/node_modules",
        "frontend/dist",
        "frontend/tests",
        "frontend/.tsbuildinfo",
        "target",
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    "Dockerfile",
    extra.Dockerfile ??
      [
        "FROM node:24-bookworm AS frontend-builder",
        "WORKDIR /app",
        "RUN corepack enable",
        "RUN pnpm --dir frontend build",
        "",
        "FROM rust:1.92-bookworm AS builder",
        "WORKDIR /app",
        "RUN cargo build --release",
        "",
        "FROM debian:12-slim AS runtime",
        "WORKDIR /app",
        "COPY --from=builder /app/target/release/koko /app/koko",
        "COPY --from=frontend-builder /app/frontend/index.html /app/frontend/index.html",
        "COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist",
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    "ops/Caddyfile",
    extra.Caddyfile ??
      [
        "{$KOKO_DOMAIN} {",
        "  encode zstd gzip",
        "  reverse_proxy /files* app:8080",
        "  reverse_proxy /api/swarm/announce* app:8080",
        "  reverse_proxy /api/* app:8080",
        "  reverse_proxy app:8080",
        "}",
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    "ops/compose.yaml",
    extra.composeYaml ??
      [
        "services:",
        "  app: {}",
        "  postgres: {}",
        "  tusd: {}",
        "  tracker: {}",
        "  seeder: {}",
        "  caddy: {}",
        "",
      ].join("\n")
  );
}

function 创建合法脚本主链夹具(rootDir, extra = {}) {
  写文件(rootDir, "ops/README.md", extra.readme ?? "# ops\n");
  写文件(
    rootDir,
    "ops/env.production.example",
    extra.envExample ??
      [
        "KOKO_DOMAIN=example.com",
        "DATABASE_URL=postgres://postgres:postgres@postgres:5432/koko",
        "ADMIN_PASSWORD=change-me",
        "POSTGRES_DB=koko",
        "POSTGRES_USER=postgres",
        "POSTGRES_PASSWORD=postgres",
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    "ops/package-release.sh",
    extra.packageReleaseSh ??
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'version="${1:?missing version}"',
        'archive_path="${2:-koko-${version}.tar.gz}"',
        'git archive --format=tar.gz --output "${archive_path}" HEAD \\',
        "  Dockerfile .dockerignore Cargo.toml Cargo.lock build.rs src migrations assets frontend scripts ops -- \\",
        "  ':(exclude)frontend/tests/**' \\",
        "  ':(exclude)frontend/vitest.config.ts'",
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    "ops/install.sh",
    extra.installSh ??
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'mkdir -p /opt/koko/releases /opt/koko/current /opt/koko/shared',
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    "ops/deploy.sh",
    extra.deploySh ??
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'version=\"${1:?missing version}\"',
        'release_dir=\"/opt/koko/releases/${version}\"',
        'ln -sfn \"$release_dir\" /opt/koko/current',
        'docker compose -f /opt/koko/current/ops/compose.yaml build',
        'docker compose -f /opt/koko/current/ops/compose.yaml up -d',
        '/opt/koko/current/ops/healthcheck.sh',
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    "ops/rollback.sh",
    extra.rollbackSh ??
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'target_version=\"${1:?missing target version}\"',
        'target_dir=\"/opt/koko/releases/${target_version}\"',
        'if [[ ! -d "${target_dir}" ]]; then exit 1; fi',
        'ln -sfn \"$target_dir\" /opt/koko/current',
        'docker compose -f /opt/koko/current/ops/compose.yaml up -d',
        '/opt/koko/current/ops/healthcheck.sh',
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    "ops/healthcheck.sh",
    extra.healthcheckSh ??
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'curl -fsS \"https://${KOKO_DOMAIN}/\" >/dev/null',
        'docker compose -f /opt/koko/current/ops/compose.yaml ps app >/dev/null',
        'docker compose -f /opt/koko/current/ops/compose.yaml exec -T postgres pg_isready >/dev/null',
        'curl -fsS http://tusd:1081/files >/dev/null || true',
        'curl -fsS http://tracker:7072/stats >/dev/null',
        "",
      ].join("\n")
  );
}

function 创建合法Workflow主链夹具(rootDir, extra = {}) {
  写文件(
    rootDir,
    ".github/workflows/initial-deploy.yml",
    extra.initialDeploy ??
      [
        "name: Initial Deploy",
        "on:",
        "  workflow_dispatch:",
        "jobs:",
        "  install:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: pnpm/action-setup@v6",
        "        with:",
        "          package_json_file: frontend/package.json",
        "      - uses: actions/setup-node@v4",
        "      - run: node scripts/check-deployment-architecture-fitness.mjs --enforce",
        "      - run: pnpm --dir frontend install --frozen-lockfile",
        "      - run: pnpm --dir frontend build",
        "      - run: bash ops/package-release.sh v0.1.0",
        "      - run: echo ${{ secrets.VPS_HOST }} ${{ secrets.VPS_USER }} ${{ secrets.VPS_SSH_KEY }}",
        "      - run: ./ops/healthcheck.sh || true",
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    ".github/workflows/deploy.yml",
    extra.deployWorkflow ??
      [
        "name: Deploy",
        "on:",
        "  push:",
        "    branches: [main]",
        "  workflow_dispatch:",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: pnpm/action-setup@v6",
        "        with:",
        "          package_json_file: frontend/package.json",
        "      - uses: actions/setup-node@v4",
        "      - run: node scripts/check-deployment-architecture-fitness.mjs --enforce",
        "      - run: pnpm --dir frontend install --frozen-lockfile",
        "      - run: pnpm --dir frontend build",
        "      - run: bash ops/package-release.sh v0.1.0",
        "      - run: echo ${{ secrets.VPS_HOST }} ${{ secrets.VPS_USER }} ${{ secrets.VPS_SSH_KEY }}",
        "      - run: ./ops/healthcheck.sh",
        "",
      ].join("\n")
  );
  写文件(
    rootDir,
    ".github/workflows/rollback.yml",
    extra.rollbackWorkflow ??
      [
        "name: Rollback",
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      target_version:",
        "        description: target version",
        "        required: true",
        "        type: string",
        "jobs:",
        "  rollback:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo ${{ inputs.target_version }} ${{ secrets.VPS_HOST }} ${{ secrets.VPS_USER }} ${{ secrets.VPS_SSH_KEY }}",
        "      - run: ./ops/healthcheck.sh",
        "",
      ].join("\n")
  );
}

function 运行部署门禁(rootDir, ...args) {
  const result = spawnSync(process.execPath, [门禁脚本路径, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

test("空目录在 runtime scope 会报缺少运行主链文件", () => {
  const fixtureDir = 创建临时夹具目录();
  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");

  assert.notEqual(result.status, 0);
  assert.match(result.output, /缺少\s+\.dockerignore/);
  assert.match(result.output, /缺少\s+Dockerfile/);
  assert.match(result.output, /缺少\s+ops\/Caddyfile/);
  assert.match(result.output, /缺少\s+ops\/compose\.yaml/);
});

test("空目录在 scripts scope 会报缺少 ops 脚本", () => {
  const fixtureDir = 创建临时夹具目录();
  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");

  assert.notEqual(result.status, 0);
  assert.match(result.output, /缺少\s+ops\/install\.sh/);
  assert.match(result.output, /缺少\s+ops\/deploy\.sh/);
  assert.match(result.output, /缺少\s+ops\/rollback\.sh/);
  assert.match(result.output, /缺少\s+ops\/healthcheck\.sh/);
});

test("空目录在 workflows scope 会报缺少 GitHub workflow", () => {
  const fixtureDir = 创建临时夹具目录();
  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "workflows");

  assert.notEqual(result.status, 0);
  assert.match(result.output, /缺少\s+\.github\/workflows\/initial-deploy\.yml/);
  assert.match(result.output, /缺少\s+\.github\/workflows\/deploy\.yml/);
  assert.match(result.output, /缺少\s+\.github\/workflows\/rollback\.yml/);
});

test("任意 runtime 夹具里出现 cloudflared 都必须失败", () => {
  const fixtureDir = 创建临时夹具目录();
  创建最小运行主链夹具(fixtureDir, {
    Dockerfile: "FROM alpine:3.21 AS builder\nRUN cloudflared --version\n",
  });
  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");

  assert.notEqual(result.status, 0);
  assert.match(result.output, /cloudflared/);
});

test("full scope 会合并 runtime scripts workflows 三类问题", () => {
  const fixtureDir = 创建临时夹具目录();
  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "full");

  assert.notEqual(result.status, 0);
  assert.match(result.output, /缺少\s+Dockerfile/);
  assert.match(result.output, /缺少\s+ops\/install\.sh/);
  assert.match(result.output, /缺少\s+\.github\/workflows\/deploy\.yml/);
});

test("enforce 模式会打印统一失败摘要", () => {
  const fixtureDir = 创建临时夹具目录();
  const result = 运行部署门禁(fixtureDir, "--enforce", "--scope", "runtime");

  assert.notEqual(result.status, 0);
  assert.match(result.output, /部署门禁失败/);
  assert.match(result.output, /缺少\s+Dockerfile/);
});

test("runtime 门禁会拦住没有多阶段 builder 的 Dockerfile", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Dockerfile: [
      "FROM debian:12-slim",
      "WORKDIR /app",
      "RUN cargo build --release",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Dockerfile 必须包含多阶段 builder 阶段/);
});

test("runtime 门禁会拦住缺少前端和 Rust 构建命令的 Dockerfile", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Dockerfile: [
      "FROM node:24-bookworm AS frontend-builder",
      "WORKDIR /app",
      "",
      "FROM rust:1.92-bookworm AS builder",
      "WORKDIR /app",
      "",
      "FROM debian:12-slim AS runtime",
      "WORKDIR /app",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Dockerfile 缺少前端正式构建主链/);
  assert.match(result.output, /Dockerfile 缺少 cargo build --release/);
});

test("runtime 门禁会拦住 Dockerfile 漏掉 frontend/index.html 运行时拷贝", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Dockerfile: [
      "FROM node:24-bookworm AS frontend-builder",
      "WORKDIR /app",
      "RUN pnpm --dir frontend build",
      "",
      "FROM rust:1.92-bookworm AS builder",
      "WORKDIR /app",
      "RUN cargo build --release",
      "",
      "FROM debian:12-slim AS runtime",
      "WORKDIR /app",
      "COPY --from=builder /app/target/release/koko /app/koko",
      "COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Dockerfile 缺少 frontend\/index\.html 运行时拷贝/);
});

test("runtime 门禁会拦住 tracker sidecar 只安装 prod 依赖", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Dockerfile: [
      "FROM node:24-bookworm AS frontend-builder",
      "WORKDIR /app",
      "RUN corepack enable",
      "COPY frontend/package.json frontend/pnpm-lock.yaml ./frontend/",
      "RUN pnpm --dir frontend install --frozen-lockfile",
      "RUN pnpm --dir frontend build",
      "",
      "FROM node:24-bookworm AS sidecar-builder",
      "WORKDIR /app",
      "RUN corepack enable",
      "COPY frontend/package.json frontend/pnpm-lock.yaml ./frontend/",
      "RUN pnpm --dir frontend install --frozen-lockfile --prod",
      "",
      "FROM rust:1.92-bookworm AS builder",
      "WORKDIR /app",
      "RUN cargo build --release",
      "",
      "FROM debian:12-slim AS runtime",
      "WORKDIR /app",
      "COPY --from=builder /app/target/release/koko /app/koko",
      "COPY --from=frontend-builder /app/frontend/index.html /app/frontend/index.html",
      "COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist",
      "",
    ].join("\n"),
    composeYaml: [
      "services:",
      "  app: {}",
      "  postgres: {}",
      "  tusd: {}",
      "  tracker:",
      "    command:",
      "      - node",
      "      - /app/frontend/node_modules/bittorrent-tracker/bin/cmd.js",
      "  seeder: {}",
      "  caddy: {}",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /tracker sidecar 禁止只装 --prod 依赖/);
});

test("runtime 门禁会放行显式 cd frontend 的拆分前端构建主链", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Dockerfile: [
      "FROM node:24-bookworm AS frontend-builder",
      "WORKDIR /app",
      "RUN corepack enable",
      "COPY frontend/package.json frontend/pnpm-lock.yaml ./frontend/",
      "RUN pnpm --dir frontend install --frozen-lockfile",
      "COPY scripts ./scripts",
      "COPY frontend ./frontend",
      "RUN cd frontend && node ../scripts/check-frontend-browser-app-constitution.mjs && node ../scripts/check-frontend-architecture-fitness.mjs && pnpm typecheck && node build.mjs",
      "",
      "FROM rust:1.92-bookworm AS builder",
      "WORKDIR /app",
      "COPY Cargo.toml Cargo.lock build.rs ./",
      "COPY src ./src",
      "COPY migrations ./migrations",
      "COPY assets ./assets",
      "RUN cargo build --release",
      "",
      "FROM debian:12-slim AS runtime",
      "WORKDIR /app",
      "COPY --from=builder /app/target/release/koko /app/koko",
      "COPY --from=frontend-builder /app/frontend/index.html /app/frontend/index.html",
      "COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.equal(result.status, 0);
});

test("runtime 门禁会拦住 Rust builder 漏掉 assets 静态目录", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Dockerfile: [
      "FROM node:24-bookworm AS frontend-builder",
      "WORKDIR /app",
      "RUN corepack enable",
      "RUN pnpm --dir frontend build",
      "",
      "FROM rust:1.92-bookworm AS builder",
      "WORKDIR /app",
      "COPY Cargo.toml Cargo.lock build.rs ./",
      "COPY src ./src",
      "COPY migrations ./migrations",
      "RUN cargo build --release",
      "",
      "FROM debian:12-slim AS runtime",
      "WORKDIR /app",
      "COPY --from=builder /app/target/release/koko /app/koko",
      "COPY --from=frontend-builder /app/frontend/index.html /app/frontend/index.html",
      "COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Dockerfile Rust builder 缺少 assets 静态目录拷贝/);
});

test("runtime 门禁会拦住 .dockerignore 漏掉关键打包排除项", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    dockerignore: [".git", "docs", ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /\.dockerignore 缺少关键排除项: tests/);
  assert.match(result.output, /\.dockerignore 缺少关键排除项: graphify-out/);
  assert.match(result.output, /\.dockerignore 缺少关键排除项: frontend\/node_modules/);
  assert.match(result.output, /\.dockerignore 缺少关键排除项: frontend\/dist/);
  assert.match(result.output, /\.dockerignore 缺少关键排除项: frontend\/tests/);
});

test("runtime 门禁会拦住 compose 缺少正式运行服务", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    composeYaml: ["services:", "  app: {}", "  postgres: {}", "  tusd: {}", "  tracker: {}", ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/compose\.yaml 缺少服务: seeder/);
  assert.match(result.output, /ops\/compose\.yaml 缺少服务: caddy/);
});

test("runtime 门禁会拦住 Caddyfile 漏掉同源 files 和 announce 路径", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Caddyfile: "{$KOKO_DOMAIN} {\n  reverse_proxy app:8080\n}\n",
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/Caddyfile 缺少同源路径: \/files/);
  assert.match(result.output, /ops\/Caddyfile 缺少同源路径: \/api\/swarm\/announce/);
});

test("runtime 门禁会拦住 Caddyfile 出现 Flexible 伪 TLS 模式", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Caddyfile: "{$KOKO_DOMAIN} {\n  Flexible\n  reverse_proxy /files* app:8080\n  reverse_proxy /api/swarm/announce* app:8080\n  reverse_proxy app:8080\n}\n",
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/Caddyfile 禁止出现 Flexible/);
});

test("runtime 门禁会拦住 Dockerfile 在 runtime 阶段拷贝 docs tests 或 .git", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法运行主链夹具(fixtureDir, {
    Dockerfile: [
      "FROM node:24-bookworm AS frontend-builder",
      "WORKDIR /app",
      "RUN pnpm --dir frontend build",
      "",
      "FROM rust:1.92-bookworm AS builder",
      "WORKDIR /app",
      "RUN cargo build --release",
      "",
      "FROM debian:12-slim AS runtime",
      "WORKDIR /app",
      "COPY --from=builder /app/target/release/koko /app/koko",
      "COPY docs /app/docs",
      "COPY tests /app/tests",
      "COPY .git /app/.git",
      "COPY --from=frontend-builder /app/frontend/index.html /app/frontend/index.html",
      "COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "runtime");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Dockerfile runtime 阶段禁止拷贝: docs/);
  assert.match(result.output, /Dockerfile runtime 阶段禁止拷贝: tests/);
  assert.match(result.output, /Dockerfile runtime 阶段禁止拷贝: \.git/);
});

test("scripts 门禁会拦住 install.sh 漏掉固定目录真相", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法脚本主链夹具(fixtureDir, {
    installSh: ["#!/usr/bin/env bash", "set -euo pipefail", "mkdir -p /tmp/koko", ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/install\.sh 缺少固定目录: \/opt\/koko\/releases/);
  assert.match(result.output, /ops\/install\.sh 缺少固定目录: \/opt\/koko\/current/);
  assert.match(result.output, /ops\/install\.sh 缺少固定目录: \/opt\/koko\/shared/);
});

test("scripts 门禁会拦住 deploy.sh 缺少 current 切换与健康检查", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法脚本主链夹具(fixtureDir, {
    deploySh: [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'version="${1:?missing version}"',
      'docker compose -f /opt/koko/releases/${version}/ops/compose.yaml build',
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/deploy\.sh 缺少版本目录与 current 切换/);
  assert.match(result.output, /ops\/deploy\.sh 缺少 healthcheck\.sh 调用/);
});

test("scripts 门禁会拦住 rollback.sh 没有目标版本参数", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法脚本主链夹具(fixtureDir, {
    rollbackSh: ["#!/usr/bin/env bash", "set -euo pipefail", "echo rollback", ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/rollback\.sh 必须接收目标版本参数/);
});

test("scripts 门禁会拦住 rollback.sh 没有目标版本目录存在校验", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法脚本主链夹具(fixtureDir, {
    rollbackSh: [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'target_version="${1:?missing target version}"',
      'target_dir="/opt/koko/releases/${target_version}"',
      'ln -sfn "$target_dir" /opt/koko/current',
      'docker compose -f /opt/koko/current/ops/compose.yaml up -d',
      '/opt/koko/current/ops/healthcheck.sh',
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/rollback\.sh 缺少目标版本目录存在校验/);
});

test("scripts 门禁会拦住 healthcheck.sh 漏掉关键探针", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法脚本主链夹具(fixtureDir, {
    healthcheckSh: ["#!/usr/bin/env bash", "set -euo pipefail", 'echo "ok"', ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/healthcheck\.sh 缺少检查目标: 正式域名/);
  assert.match(result.output, /ops\/healthcheck\.sh 缺少检查目标: app/);
  assert.match(result.output, /ops\/healthcheck\.sh 缺少检查目标: postgres/);
  assert.match(result.output, /ops\/healthcheck\.sh 缺少检查目标: tusd/);
  assert.match(result.output, /ops\/healthcheck\.sh 缺少检查目标: tracker/);
});

test("scripts 门禁会拦住 git pull 和 cloudflared 旁路", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法脚本主链夹具(fixtureDir, {
    deploySh: ["#!/usr/bin/env bash", "set -euo pipefail", "git pull", "cloudflared tunnel run", ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /禁止出现 git pull: ops\/deploy\.sh/);
  assert.match(result.output, /cloudflared/);
});

test("scripts 门禁会拦住 package-release.sh 缺少白名单与前端测试排除", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法脚本主链夹具(fixtureDir, {
    packageReleaseSh: [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'version="${1:?missing version}"',
      'archive_path="${2:-koko-${version}.tar.gz}"',
      'git archive --format=tar.gz --output "${archive_path}" HEAD',
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /ops\/package-release\.sh 缺少发布白名单路径: scripts/);
  assert.match(result.output, /ops\/package-release\.sh 缺少前端测试排除: frontend\/tests/);
  assert.match(result.output, /ops\/package-release\.sh 禁止直接整仓 git archive HEAD 打包/);
});

test("scripts 门禁不会误伤只出现在注释里的 git pull 和 cloudflared", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法脚本主链夹具(fixtureDir, {
    installSh: [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "# 禁止在正式部署里用 git pull 或 cloudflared 旁路",
      'mkdir -p /opt/koko/releases /opt/koko/current /opt/koko/shared',
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "scripts");
  assert.equal(result.status, 0);
});

test("workflows 门禁会拦住 initial-deploy 缺少 workflow_dispatch", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法Workflow主链夹具(fixtureDir, {
    initialDeploy: ["name: Initial Deploy", "on:", "  push:", "    branches: [main]", ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "workflows");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /initial-deploy\.yml 缺少 workflow_dispatch/);
});

test("workflows 门禁会拦住 deploy 缺少 push main 和 workflow_dispatch", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法Workflow主链夹具(fixtureDir, {
    deployWorkflow: ["name: Deploy", "on:", "  workflow_call:", ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "workflows");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /deploy\.yml 缺少 push 到 main/);
  assert.match(result.output, /deploy\.yml 缺少 workflow_dispatch/);
});

test("workflows 门禁会拦住 rollback 缺少 target_version 输入", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法Workflow主链夹具(fixtureDir, {
    rollbackWorkflow: ["name: Rollback", "on:", "  workflow_dispatch:", "jobs: {}", ""].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "workflows");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /rollback\.yml 缺少 target_version 输入/);
});

test("workflows 门禁会拦住漏掉 VPS Secrets 和 healthcheck 的 workflow", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法Workflow主链夹具(fixtureDir, {
    deployWorkflow: [
      "name: Deploy",
      "on:",
      "  push:",
      "    branches: [main]",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo deploy",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "workflows");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /deploy\.yml 缺少 VPS_HOST 引用/);
  assert.match(result.output, /deploy\.yml 缺少 VPS_USER 引用/);
  assert.match(result.output, /deploy\.yml 缺少 VPS_SSH_KEY 引用/);
  assert.match(result.output, /deploy\.yml 缺少 ops\/healthcheck\.sh 调用/);
  assert.match(result.output, /deploy\.yml 缺少 pnpm\/action-setup 安装步骤/);
  assert.match(result.output, /deploy\.yml 缺少 pnpm package_json_file 指向 frontend\/package\.json/);
  assert.match(result.output, /deploy\.yml 缺少 Node 安装步骤/);
  assert.match(result.output, /deploy\.yml 缺少 pnpm --dir frontend install --frozen-lockfile 预检/);
  assert.match(result.output, /deploy\.yml 缺少 pnpm --dir frontend build 预检/);
  assert.match(result.output, /deploy\.yml 缺少部署门禁预检/);
  assert.match(result.output, /deploy\.yml 缺少 ops\/package-release\.sh 调用/);
});

test("workflows 门禁会拦住 git pull 和 cloudflared 旁路", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法Workflow主链夹具(fixtureDir, {
    deployWorkflow: [
      "name: Deploy",
      "on:",
      "  push:",
      "    branches: [main]",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: git pull",
      "      - run: cloudflared tunnel run",
      "      - run: echo ${{ secrets.VPS_HOST }} ${{ secrets.VPS_USER }} ${{ secrets.VPS_SSH_KEY }}",
      "      - run: ./ops/healthcheck.sh",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "workflows");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /禁止出现 git pull: \.github\/workflows\/deploy\.yml/);
  assert.match(result.output, /cloudflared/);
});

test("workflows 门禁会拦住直接 git archive HEAD 整仓打包", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法Workflow主链夹具(fixtureDir, {
    deployWorkflow: [
      "name: Deploy",
      "on:",
      "  push:",
      "    branches: [main]",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: pnpm/action-setup@v6",
      "      - uses: actions/setup-node@v4",
      "      - run: node scripts/check-deployment-architecture-fitness.mjs --enforce",
      "      - run: pnpm --dir frontend install --frozen-lockfile",
      "      - run: pnpm --dir frontend build",
      "      - run: git archive --format=tar.gz --output koko.tar.gz HEAD",
      "      - run: echo ${{ secrets.VPS_HOST }} ${{ secrets.VPS_USER }} ${{ secrets.VPS_SSH_KEY }}",
      "      - run: ./ops/healthcheck.sh",
      "",
    ].join("\n"),
  });

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "workflows");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /deploy\.yml 缺少 ops\/package-release\.sh 调用/);
  assert.match(result.output, /deploy\.yml 禁止直接整仓 git archive HEAD 打包/);
});

test("workflows 门禁会放行合法的按钮主链", () => {
  const fixtureDir = 创建临时夹具目录();
  创建合法Workflow主链夹具(fixtureDir);

  const result = 运行部署门禁(fixtureDir, "--report", "--scope", "workflows");
  assert.equal(result.status, 0);
});
