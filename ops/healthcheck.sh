#!/usr/bin/env bash
set -euo pipefail

# 健康检查只验证正式主链是否真的活着：
# 1. 正式域名 HTTPS 根入口；
# 2. app 容器运行且内网可达；
# 3. postgres 能响应；
# 4. tusd / tracker 内网可达；
# 5. 不靠“看日志像没报错”这种假成功。

readonly COMPOSE_FILE="/opt/koko/current/ops/compose.yaml"
readonly ENV_FILE="${KOKO_ENV_FILE:-/opt/koko/env/production.env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # env 模板是受控的 key=value 文件，这里直接 source，保持脚本和 compose 共用一套环境真相。
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${KOKO_DOMAIN:?缺少 KOKO_DOMAIN，无法检查正式域名入口}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=koko}"

require_running_service() {
  local service_name="$1"
  if ! docker compose -f "${COMPOSE_FILE}" ps --services --status running | grep -qx "${service_name}"; then
    echo "服务未运行: ${service_name}" >&2
    exit 1
  fi
}

probe_with_seeder_node() {
  local url="$1"
  require_running_service "seeder"
  docker compose -f "${COMPOSE_FILE}" exec -T seeder \
    node -e "fetch(process.argv[1], { method: process.argv[2] || 'GET' }).then((response) => { process.exit(response.status < 500 ? 0 : 1); }).catch(() => process.exit(1));" \
    "${url}" "${2:-GET}"
}

check_public_domain() {
  curl -fsS "https://${KOKO_DOMAIN}/" >/dev/null
}

check_app_internal() {
  require_running_service "app"
  probe_with_seeder_node "http://app:8080/"
}

check_postgres() {
  require_running_service "postgres"
  docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null
}

check_tusd() {
  require_running_service "tusd"
  probe_with_seeder_node "http://tusd:1081/files" "OPTIONS"
}

check_tusd_storage_writable() {
  # 只看 tusd 端口活着还不够；
  # 目录权限错了时，公网 `/files` 仍会在真正写入时 500。
  require_running_service "tusd"
  docker compose -f "${COMPOSE_FILE}" exec -T tusd sh -lc "test -w /data/tus"
}

check_tracker() {
  require_running_service "tracker"
  probe_with_seeder_node "http://tracker:7072/stats"
}

check_seeder() {
  require_running_service "seeder"
}

main() {
  check_public_domain
  check_app_internal
  check_postgres
  check_tusd
  check_tusd_storage_writable
  check_tracker
  check_seeder
  echo "健康检查通过。"
}

main "$@"
