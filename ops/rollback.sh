#!/usr/bin/env bash
set -euo pipefail

# 回滚脚本只做一件事：把 current 从当前版本切回目标版本，
# 然后重新 build + up + healthcheck，不在这里夹带别的发布脑子。

readonly KOKO_ROOT="/opt/koko"
readonly RELEASES_DIR="/opt/koko/releases"
readonly CURRENT_LINK="/opt/koko/current"

target_version="${1:?请传入要回滚到的版本号}"
target_dir="${RELEASES_DIR}/${target_version}"
compose_file="${CURRENT_LINK}/ops/compose.yaml"
healthcheck_script="${CURRENT_LINK}/ops/healthcheck.sh"

ensure_target_exists() {
  if [[ ! -d "${target_dir}" ]]; then
    echo "目标回滚版本不存在: ${target_dir}" >&2
    exit 1
  fi
  if [[ ! -f "${target_dir}/ops/compose.yaml" ]]; then
    echo "目标回滚版本缺少 compose 文件: ${target_dir}/ops/compose.yaml" >&2
    exit 1
  fi
}

switch_current() {
  ln -sfnT "${target_dir}" "${CURRENT_LINK}"
}

cleanup_stale_compose_replacements() {
  # 回滚和升级都会走容器 recreate；
  # 上次失败残留的 replacement 容器如果不先清掉，会把这次回滚也一起卡死。
  mapfile -t stale_replace_ids < <(
    docker ps -aq \
      --filter "label=com.docker.compose.project=koko" \
      --filter "label=com.docker.compose.replace" \
      --filter "status=created"
  )
  if (( ${#stale_replace_ids[@]} > 0 )); then
    docker rm -f "${stale_replace_ids[@]}"
  fi
}

restart_release() {
  cleanup_stale_compose_replacements
  docker compose -f "${compose_file}" build
  docker compose -f "${compose_file}" up -d --remove-orphans
}

run_healthcheck() {
  bash "${healthcheck_script}"
}

main() {
  ensure_target_exists
  switch_current
  restart_release
  run_healthcheck
  echo "回滚完成: ${target_version}"
}

main "$@"
