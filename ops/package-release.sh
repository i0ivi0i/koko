#!/usr/bin/env bash
set -euo pipefail

# 发布包只导出正式部署真相，不把 docs/学习/tests 等研究与测试材料上传到 VPS。
# 这里直接复用 git archive 的 tracked-files 语义，避免把本地生成的 frontend/dist、
# node_modules、.tsbuildinfo 等工作区脏东西混进正式发布包。

version="${1:?请传入发布版本号，例如 v0.1.0}"
archive_path="${2:-koko-${version}.tar.gz}"

readonly include_paths=(
  Dockerfile
  .dockerignore
  Cargo.toml
  Cargo.lock
  build.rs
  src
  migrations
  assets
  frontend
  scripts
  ops
)

readonly exclude_pathspecs=(
  ":(exclude)frontend/tests/**"
  ":(exclude)frontend/vitest.config.ts"
)

git archive --format=tar.gz --output "${archive_path}" HEAD \
  "${include_paths[@]}" -- \
  "${exclude_pathspecs[@]}"

echo "发布包已生成: ${archive_path}"
