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

build_release() {
  docker compose -f "${release_compose_file}" build
}

switch_current() {
  ln -sfn "${release_dir}" "${CURRENT_LINK}"
}

start_release() {
  docker compose -f "${compose_file}" up -d --remove-orphans
}

run_healthcheck() {
  "${healthcheck_script}"
}

main() {
  ensure_release_absent
  materialize_release
  assert_release_shape
  build_release
  switch_current
  start_release
  run_healthcheck
  echo "部署完成: ${version}"
}

main "$@"
