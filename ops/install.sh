#!/usr/bin/env bash
set -euo pipefail

# 这份脚本只做“空白 Debian 12 VPS 的一次性准备”：
# 1. 安装 Docker Engine + Compose plugin；
# 2. 创建 /opt/koko 单一目录真相；
# 3. 准备 shared/env/current/release 等长期结构；
# 4. 绝不在这里偷偷 git clone / git pull。

readonly KOKO_ROOT="/opt/koko"
readonly ENV_DIR="/opt/koko/env"
readonly RELEASES_DIR="/opt/koko/releases"
readonly SHARED_DIR="/opt/koko/shared"
readonly CURRENT_LINK="/opt/koko/current"
readonly SHARED_POSTGRES_DIR="/opt/koko/shared/postgres"
readonly SHARED_TUS_DIR="/opt/koko/shared/tus"
readonly SHARED_ATTACHMENTS_DIR="/opt/koko/shared/attachments"
readonly SHARED_CADDY_DATA_DIR="/opt/koko/shared/caddy/data"
readonly SHARED_CADDY_CONFIG_DIR="/opt/koko/shared/caddy/config"
readonly SHARED_INCOMING_DIR="/opt/koko/shared/incoming"
readonly BOOTSTRAP_RELEASE_DIR="/opt/koko/releases/__bootstrap__"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_TEMPLATE_PATH="${SCRIPT_DIR}/env.production.example"
TARGET_ENV_PATH="${ENV_DIR}/production.env"

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "install.sh 必须用 root 执行。" >&2
    exit 1
  fi
}

ensure_docker() {
  # 优先复用官方 apt 仓库安装路径。
  # 如果 docker 与 compose plugin 已经可用，这里直接复用，不重复折腾机器。
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  export DEBIAN_FRONTEND=noninteractive

  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "${VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

prepare_layout() {
  # `/opt/koko/releases` 是不可变版本目录；
  # `/opt/koko/current` 是唯一活动版本指针；
  # `/opt/koko/shared` 只放持久化数据，不混发布包。
  mkdir -p "${ENV_DIR}"
  mkdir -p "${RELEASES_DIR}"
  mkdir -p "${SHARED_DIR}"
  mkdir -p "${SHARED_POSTGRES_DIR}"
  mkdir -p "${SHARED_TUS_DIR}"
  mkdir -p "${SHARED_ATTACHMENTS_DIR}"
  mkdir -p "${SHARED_CADDY_DATA_DIR}"
  mkdir -p "${SHARED_CADDY_CONFIG_DIR}"
  mkdir -p "${SHARED_INCOMING_DIR}"
  mkdir -p "${BOOTSTRAP_RELEASE_DIR}"
}

prepare_tusd_storage() {
  # `tusd` 官方镜像默认用 uid/gid 1000 运行。
  # 这里必须在宿主机把 shared/tus 目录直接准备成 1000:1000 可写，
  # 否则公网上传会在 `/files` 创建阶段直接 500。
  chown 1000:1000 "${SHARED_TUS_DIR}"
  chmod 0775 "${SHARED_TUS_DIR}"
}

ensure_current_link() {
  # install.sh 可以重复执行，但不能把已经在跑的正式版本重新拨回 bootstrap 占位目录。
  # 这里只有两种合法情况：
  # 1. current 还不存在：首次安装，创建受控占位；
  # 2. current 已经是符号链接：说明正式链路已经接管，直接复用。
  if [[ -L "${CURRENT_LINK}" ]]; then
    return
  fi

  if [[ -e "${CURRENT_LINK}" ]]; then
    echo "current 已存在且不是符号链接，拒绝覆盖: ${CURRENT_LINK}" >&2
    exit 1
  fi

  ln -sfnT "${BOOTSTRAP_RELEASE_DIR}" "${CURRENT_LINK}"
}

prepare_env_template() {
  # 这里不生成真密钥，只在缺文件时放模板，提醒操作者先填值再跑 deploy。
  if [[ -f "${ENV_TEMPLATE_PATH}" && ! -f "${TARGET_ENV_PATH}" ]]; then
    cp "${ENV_TEMPLATE_PATH}" "${TARGET_ENV_PATH}"
  fi
}

main() {
  need_root
  ensure_docker
  prepare_layout
  prepare_tusd_storage
  ensure_current_link
  prepare_env_template
  echo "Debian 12 首次安装准备完成。"
}

main "$@"
