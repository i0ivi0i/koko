#!/usr/bin/env bash

set -euo pipefail

REPO_OWNER="${KOKO_REPO_OWNER:-i0ivi0i}"
REPO_NAME="${KOKO_REPO_NAME:-koko}"
RELEASE_BASE="${KOKO_RELEASE_BASE:-https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download}"
KOKO_VERSION="${KOKO_VERSION:-latest}"

KOKO_DOMAIN="${KOKO_DOMAIN:-}"
KOKO_ADMIN_DOMAIN="${KOKO_ADMIN_DOMAIN:-}"
KOKO_ADMIN_USER="${KOKO_ADMIN_USER:-admin}"
KOKO_ADMIN_PASSWORD="${KOKO_ADMIN_PASSWORD:-Ee123456789+}"
KOKO_DB_NAME="${KOKO_DB_NAME:-koko}"
KOKO_DB_USER="${KOKO_DB_USER:-koko}"
KOKO_DB_PASSWORD="${KOKO_DB_PASSWORD:-}"
KOKO_BIND="${KOKO_BIND:-127.0.0.1:3000}"

INSTALL_ROOT="/opt/koko"
CONFIG_DIR="/etc/koko"
CONFIG_FILE="${CONFIG_DIR}/koko.env"
BIN_PATH="/usr/local/bin/koko-server"
SERVICE_PATH="/etc/systemd/system/koko-server.service"
CADDYFILE_PATH="/etc/caddy/Caddyfile"
BACKUP_ROOT="${INSTALL_ROOT}/backups"
TMP_ROOT=""

main() {
    require_linux
    require_root
    detect_supported_distro
    ensure_domains
    ensure_passwords
    derive_defaults
    install_packages
    ensure_user_and_dirs
    TMP_ROOT="$(mktemp -d)"
    trap cleanup EXIT

    local mode
    mode="$(detect_mode)"
    echo "koko ${mode}开始。"

    if [[ "${mode}" == "upgrade" ]]; then
        backup_current_release
    fi

    download_release_assets
    install_release_assets
    write_config_if_missing
    ensure_database
    apply_migrations
    install_service
    install_caddyfile
    systemctl daemon-reload
    systemctl enable --now koko-server
    systemctl reload caddy
    write_version
    print_summary "${mode}"
}

cleanup() {
    if [[ -n "${TMP_ROOT}" && -d "${TMP_ROOT}" ]]; then
        rm -rf "${TMP_ROOT}"
    fi
}

require_linux() {
    if [[ "$(uname -s)" != "Linux" ]]; then
        echo "只支持 Linux。" >&2
        exit 1
    fi
}

require_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        echo "请用 root 或 sudo 运行安装脚本。" >&2
        exit 1
    fi
}

detect_supported_distro() {
    if [[ ! -f /etc/os-release ]]; then
        echo "无法识别当前系统。" >&2
        exit 1
    fi

    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}" in
        ubuntu|debian) ;;
        *)
            echo "当前只支持 Ubuntu/Debian。" >&2
            exit 1
            ;;
    esac
}

ensure_domains() {
    if [[ -z "${KOKO_DOMAIN}" ]]; then
        echo "缺少 KOKO_DOMAIN。示例: env KOKO_DOMAIN=chat.example.com bash install.sh" >&2
        exit 1
    fi
}

ensure_passwords() {
    if [[ -z "${KOKO_DB_PASSWORD}" ]]; then
        KOKO_DB_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
    fi
}

derive_defaults() {
    if [[ -z "${KOKO_ADMIN_DOMAIN}" ]]; then
        KOKO_ADMIN_DOMAIN="admin.${KOKO_DOMAIN}"
    fi
}

install_packages() {
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y curl ca-certificates postgresql caddy
}

ensure_user_and_dirs() {
    id -u koko >/dev/null 2>&1 || useradd --system --home "${INSTALL_ROOT}" --shell /usr/sbin/nologin koko
    mkdir -p "${INSTALL_ROOT}/web" "${INSTALL_ROOT}/admin" "${INSTALL_ROOT}/migrations" "${CONFIG_DIR}" "${BACKUP_ROOT}"
    chown -R koko:koko "${INSTALL_ROOT}"
}

detect_mode() {
    if [[ -x "${BIN_PATH}" && -f "${CONFIG_FILE}" && -f "${SERVICE_PATH}" ]]; then
        printf 'upgrade'
    else
        printf 'install'
    fi
}

backup_current_release() {
    local backup_dir
    backup_dir="${BACKUP_ROOT}/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "${backup_dir}"

    [[ -x "${BIN_PATH}" ]] && cp "${BIN_PATH}" "${backup_dir}/koko-server"
    [[ -d "${INSTALL_ROOT}/web" ]] && cp -R "${INSTALL_ROOT}/web" "${backup_dir}/web"
    [[ -d "${INSTALL_ROOT}/admin" ]] && cp -R "${INSTALL_ROOT}/admin" "${backup_dir}/admin"
    [[ -d "${INSTALL_ROOT}/migrations" ]] && cp -R "${INSTALL_ROOT}/migrations" "${backup_dir}/migrations"
    [[ -f "${INSTALL_ROOT}/VERSION" ]] && cp "${INSTALL_ROOT}/VERSION" "${backup_dir}/VERSION"
}

download_release_assets() {
    fetch_asset "koko-server-linux-x86_64.tar.gz" "${TMP_ROOT}/server.tar.gz"
    fetch_asset "koko-web.tar.gz" "${TMP_ROOT}/web.tar.gz"
    fetch_asset "koko-admin.tar.gz" "${TMP_ROOT}/admin.tar.gz"
    fetch_asset "koko-migrations.tar.gz" "${TMP_ROOT}/migrations.tar.gz"
}

fetch_asset() {
    local asset_name="$1"
    local output_path="$2"
    local asset_url="${RELEASE_BASE}/${asset_name}"

    echo "下载 ${asset_name}"
    curl -fsSL "${asset_url}" -o "${output_path}"
}

install_release_assets() {
    rm -rf "${TMP_ROOT}/server" "${TMP_ROOT}/web" "${TMP_ROOT}/admin" "${TMP_ROOT}/migrations"
    mkdir -p "${TMP_ROOT}/server" "${TMP_ROOT}/web" "${TMP_ROOT}/admin" "${TMP_ROOT}/migrations"

    tar -xzf "${TMP_ROOT}/server.tar.gz" -C "${TMP_ROOT}/server"
    tar -xzf "${TMP_ROOT}/web.tar.gz" -C "${TMP_ROOT}/web"
    tar -xzf "${TMP_ROOT}/admin.tar.gz" -C "${TMP_ROOT}/admin"
    tar -xzf "${TMP_ROOT}/migrations.tar.gz" -C "${TMP_ROOT}/migrations"

    install -m 0755 "${TMP_ROOT}/server/koko-server" "${BIN_PATH}"
    rm -rf "${INSTALL_ROOT}/web" "${INSTALL_ROOT}/admin" "${INSTALL_ROOT}/migrations"
    mkdir -p "${INSTALL_ROOT}/web" "${INSTALL_ROOT}/admin" "${INSTALL_ROOT}/migrations"
    cp -R "${TMP_ROOT}/web/." "${INSTALL_ROOT}/web/"
    cp -R "${TMP_ROOT}/admin/." "${INSTALL_ROOT}/admin/"
    cp -R "${TMP_ROOT}/migrations/." "${INSTALL_ROOT}/migrations/"
    chown -R koko:koko "${INSTALL_ROOT}"
}

write_config_if_missing() {
    if [[ -f "${CONFIG_FILE}" ]]; then
        echo "保留现有配置 ${CONFIG_FILE}"
        return
    fi

    cat > "${CONFIG_FILE}" <<EOF
DATABASE_URL=postgresql://${KOKO_DB_USER}:${KOKO_DB_PASSWORD}@127.0.0.1:5432/${KOKO_DB_NAME}
SERVER_BIND=${KOKO_BIND}
KOKO_PUBLIC_BASE_URL=https://${KOKO_DOMAIN}
KOKO_ADMIN_BASE_URL=https://${KOKO_ADMIN_DOMAIN}
KOKO_ADMIN_USER=${KOKO_ADMIN_USER}
KOKO_ADMIN_PASSWORD=${KOKO_ADMIN_PASSWORD}
EOF
    chmod 600 "${CONFIG_FILE}"
}

ensure_database() {
    runuser -u postgres -- psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${KOKO_DB_USER}'" | grep -q 1 || \
        runuser -u postgres -- psql -c "CREATE USER ${KOKO_DB_USER} WITH PASSWORD '${KOKO_DB_PASSWORD}';"

    runuser -u postgres -- psql -tc "SELECT 1 FROM pg_database WHERE datname='${KOKO_DB_NAME}'" | grep -q 1 || \
        runuser -u postgres -- psql -c "CREATE DATABASE ${KOKO_DB_NAME} OWNER ${KOKO_DB_USER};"
}

apply_migrations() {
    local database_url
    database_url="$(grep '^DATABASE_URL=' "${CONFIG_FILE}" | cut -d= -f2-)"

    shopt -s nullglob
    for migration in "${INSTALL_ROOT}"/migrations/*.sql; do
        echo "执行迁移 $(basename "${migration}")"
        PGPASSWORD="${KOKO_DB_PASSWORD}" psql "${database_url}" -v ON_ERROR_STOP=1 -f "${migration}"
    done
    shopt -u nullglob
}

install_service() {
    render_service_template > "${SERVICE_PATH}"
    chmod 0644 "${SERVICE_PATH}"
}

install_caddyfile() {
    render_caddy_template > "${CADDYFILE_PATH}"
}

write_version() {
    printf '%s\n' "${KOKO_VERSION}" > "${INSTALL_ROOT}/VERSION"
    chown koko:koko "${INSTALL_ROOT}/VERSION"
}

render_service_template() {
    cat <<EOF
[Unit]
Description=Koko IM Server
After=network.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=koko
Group=koko
WorkingDirectory=/opt/koko
EnvironmentFile=/etc/koko/koko.env
ExecStart=/usr/local/bin/koko-server
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
}

render_caddy_template() {
    cat <<EOF
${KOKO_DOMAIN} {
    root * /opt/koko/web
    file_server

    reverse_proxy /session* 127.0.0.1:3000
    reverse_proxy /rooms* 127.0.0.1:3000
    reverse_proxy /ws* 127.0.0.1:3000
}

${KOKO_ADMIN_DOMAIN} {
    root * /opt/koko/admin
    file_server

    reverse_proxy /admin* 127.0.0.1:3000
}
EOF
}

print_summary() {
    local mode="$1"
    echo
    echo "koko ${mode}完成。"
    echo "聊天前台: https://${KOKO_DOMAIN}"
    echo "后台前端: https://${KOKO_ADMIN_DOMAIN}"
    echo "配置文件: ${CONFIG_FILE}"
    echo "服务状态: systemctl status koko-server"
    echo "服务日志: journalctl -u koko-server -f"
}

main "$@"
