#!/usr/bin/env bash
set -euo pipefail

# 这份脚本只承认一条正式发布主链：
# 1. 发布包进入 /opt/koko/releases/<version>；
# 2. current 只指向一个活动版本；
# 3. build + up 后必须立刻跑 healthcheck；
# 4. 禁止 git pull，禁止把 VPS 当成第二套源码真相。

readonly KOKO_ROOT="/opt/koko"
readonly RELEASES_DIR="/opt/koko/releases"
readonly CURRENT_LINK="/opt/koko/current"
readonly DEFAULT_BUNDLE_DIR="/opt/koko/shared/incoming"
readonly SHARED_TUS_DIR="/opt/koko/shared/tus"
readonly ENV_FILE="${KOKO_ENV_FILE:-/opt/koko/env/production.env}"

version="${1:?请传入部署版本号，例如 v0.1.0}"
bundle_input="${2:-${DEFAULT_BUNDLE_DIR}/${version}.tar.gz}"
release_dir="${RELEASES_DIR}/${version}"
compose_file="${CURRENT_LINK}/ops/compose.yaml"
release_compose_file="${release_dir}/ops/compose.yaml"
healthcheck_script="${CURRENT_LINK}/ops/healthcheck.sh"

ensure_release_absent() {
  if [[ -e "${release_dir}" ]]; then
    echo "目标版本目录已存在，拒绝覆盖: ${release_dir}" >&2
    exit 1
  fi
}

materialize_release() {
  mkdir -p "${release_dir}"

  # 支持两种输入：
  # 1. 版本发布包 tar.gz；
  # 2. 已准备好的发布目录。
  if [[ -f "${bundle_input}" ]]; then
    tar -xzf "${bundle_input}" -C "${release_dir}"
    return
  fi

  if [[ -d "${bundle_input}" ]]; then
    cp -a "${bundle_input}/." "${release_dir}/"
    return
  fi

  echo "找不到发布包或发布目录: ${bundle_input}" >&2
  exit 1
}

assert_release_shape() {
  for required_path in \
    "${release_dir}/Dockerfile" \
    "${release_dir}/scripts/check-frontend-browser-app-constitution.mjs" \
    "${release_dir}/scripts/check-frontend-architecture-fitness.mjs" \
    "${release_dir}/ops/compose.yaml" \
    "${release_dir}/ops/healthcheck.sh"; do
    if [[ ! -e "${required_path}" ]]; then
      echo "发布目录缺少关键文件: ${required_path}" >&2
      exit 1
    fi
  done
}

prepare_tusd_storage() {
  # install.sh 只覆盖首次安装；deploy.sh 还要负责把历史 root:root 目录纠正回来。
  # 这样老机器在下一次正式部署时就会自动修好，不需要再手工进 VPS 救火。
  mkdir -p "${SHARED_TUS_DIR}"
  chown 1000:1000 "${SHARED_TUS_DIR}"
  chmod 0775 "${SHARED_TUS_DIR}"
}

upsert_env_value() {
  local key="$1"
  local value="$2"
  local tmp_file

  mkdir -p "$(dirname "${ENV_FILE}")"
  touch "${ENV_FILE}"
  tmp_file="$(mktemp)"
  awk -F= -v key="${key}" '$1 != key { print }' "${ENV_FILE}" > "${tmp_file}"
  printf '%s=%s\n' "${key}" "${value}" >> "${tmp_file}"
  install -m 600 "${tmp_file}" "${ENV_FILE}"
  rm -f "${tmp_file}"
}

generate_pow_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

ensure_pow_defaults() {
  local enabled="${KOKO_POW_ENABLED:-true}"
  upsert_env_value "KOKO_POW_ENABLED" "${enabled}"
  upsert_env_value "KOKO_TRUSTED_PROXY" "true"
  if [[ "${enabled}" == "false" || "${enabled}" == "0" || "${enabled}" == "off" ]]; then
    return
  fi
  if ! grep -q '^KOKO_POW_SECRET=' "${ENV_FILE}"; then
    upsert_env_value "KOKO_POW_SECRET" "$(generate_pow_secret)"
  fi
}

cleanup_stale_compose_replacements() {
  # Docker Compose 在 recreate 中断时会留下 `<hash>_koko-<service>-1` 这种 replacement 容器。
  # 下次再升级时，如果不先清掉这些 `Created` 残留，`up -d` 会直接因为重名冲突失败。
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

build_release() {
  docker compose -f "${release_compose_file}" build
}

switch_current() {
  ln -sfnT "${release_dir}" "${CURRENT_LINK}"
}

start_release() {
  cleanup_stale_compose_replacements
  docker compose -f "${compose_file}" up -d --remove-orphans
}

run_healthcheck() {
  bash "${healthcheck_script}"
}

main() {
  ensure_release_absent
  materialize_release
  assert_release_shape
  prepare_tusd_storage
  ensure_pow_defaults
  build_release
  switch_current
  start_release
  run_healthcheck
  echo "部署完成: ${version}"
}

main "$@"
