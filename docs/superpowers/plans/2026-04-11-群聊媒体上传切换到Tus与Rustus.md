# 群聊媒体上传切换到 Tus 与 Rustus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前群聊图片/视频上传从 `PUT + @uppy/aws-s3` 切到 `Tus + Rustus`，同时保住 `prepare -> complete -> create_message` 这条唯一业务主链。

**Architecture:** 后端继续让 `attachments` 表只承载 `prepared/ready` 附件真相，新增一层运输事实持久化来保存上传令牌与上传回执；`prepare` 返回 Tus 契约，`pre-create/post-finish` hook 只负责运输校验与回执登记，`complete` 才是升级 `ready` 的唯一入口。前端继续复用现有 `frontend/媒体/` 收口，不新造第二套上传器核心，只把 `@uppy/aws-s3` 切成 `@uppy/tus` 并改写契约、meta 和测试桩。

**Tech Stack:** Rust, Axum, Tokio, SQLx, object_store, reqwest, PowerShell, TypeScript, Vitest, Lit, Uppy Core, `@uppy/tus`, Rustus

---

## File Map

### Create

- `migrations/0005_媒体Tus上传运输记录.sql`
  新增运输事实表，最小持有 `attachment_id`、`upload_token`、`token_expires_at`、`transport_kind`、`transport_upload_id`、`storage_locator`、`byte_size`、`finished_at`；不把这些字段倒灌进 `attachments` 业务真相表。

### Modify

- `src/总装.rs`
  增加 Rustus 运行期配置读取，例如 public endpoint、sidecar 端口、shared data dir；配置只描述启动期真相，不混进业务语义。
- `src/外壳.rs`
  扩展 `应用状态` 持有 Rustus 运输配置；删除 `PUT` 上传 route，新增 Rustus hook route。
- `src/房间外壳.rs`
  改写 `prepare_media_upload` 返回 Tus 契约；删除 `upload_prepared_media_content`；新增 `pre-create` / `post-finish` hook handler；改写 `complete_media_upload` 从运输回执 + shared dir 消费原始文件。
- `src/用例.rs`
  补最小的运输授权/运输回执应用层入口，保持 `complete` 仍然是 prepared -> ready 的唯一升级点。
- `src/适配.rs`
  为运输记录表增加查询/写入/更新/消费接口，不把 Rustus upload id 变成业务主键。
- `tests/集成测试.rs`
  把现有 `PUT` 假设改成 Tus 契约、hook 回执和 `complete` gate 测试；删除旧 `/api/media/{attachment_id}/upload` 主链测试。
- `run.ps1`
  本地开发同时拉起后端、前端 watcher、Rustus sidecar；只做编排，不发明项目级退出真相。
- `tests/启动器脚本检查.ps1`
  新增对 `rustus` 启动参数、hook 参数、shared dir 参数的静态约束检查。
- `frontend/package.json`
  删 `@uppy/aws-s3`，加 `@uppy/tus`。
- `frontend/pnpm-lock.yaml`
  锁文件同步到 Tus 依赖。
- `frontend/契约.ts`
  `媒体上传准备结果` 从 `PUT` 契约切成 `tus_endpoint / tus_headers / tus_metadata`。
- `frontend/传输.ts`
  `prepareMediaUpload()` 改为只绝对化 `tus_endpoint`，不再处理 `upload_url`。
- `frontend/媒体/媒体发布.ts`
  默认上传器从 `AwsS3` 换成 `Tus`；媒体 meta 从 `upload_url/upload_headers_json` 改成 Tus 所需字段；保留上传成功后调 `completeMediaUpload()`。
- `frontend/媒体/媒体诊断.ts`
  诊断逻辑继续以 `attachment_id` 为锚点，适配 Tus 错误与 hook/complete 失败路径，不回退到 `rustus_upload_id`。
- `frontend/tests/传输测试.spec.ts`
  改为断言 `upload_method = "tus"`、`tus_endpoint` 绝对化和新契约字段。
- `frontend/tests/媒体发布测试.spec.ts`
  改为断言发布器把 Tus 契约喂给上传器，并继续锁住 `upload-success -> complete -> ready`、失败保草稿。
- `frontend/tests/common/聊天测试支架.ts`
  假传输和假 prepare 结果改成 Tus 契约。
- `frontend/tests/后台壳测试.spec.ts`
  后台壳的假 transport 改成 Tus 契约。
- `frontend/tests/端到端测试.spec.ts`
  端到端测试支架改成 Tus 契约。

## Task 1: 先锁启动编排与配置边界

**Files:**
- Modify: `tests/启动器脚本检查.ps1`
- Modify: `run.ps1`
- Modify: `src/总装.rs`

- [ ] **Step 1: 先写启动脚本红测，锁住 Rustus sidecar 必须被显式编排**

  在 [启动器脚本检查.ps1](/E:/koko/tests/启动器脚本检查.ps1) 增加断言：
  - `run.ps1` 必须显式查找 `rustus` 可执行文件
  - 必须带 `--hooks-http-urls`
  - 必须带 `--hooks-http-proxy-headers "Authorization"`
  - 必须带 `--url "/files"`
  - 必须带 `--data-dir` / `--info-dir`
  - 不能在 `run.ps1` 里偷偷安装 rustus 或伪造第二套启动主链

- [ ] **Step 2: 运行脚本检查，确认它先失败**

  Run: `pwsh -File tests/启动器脚本检查.ps1`

  Expected: FAIL，因为当前 [run.ps1](/E:/koko/run.ps1) 只拉起前端 watcher 和主后端。

- [ ] **Step 3: 给启动配置增加 Rustus 所需最小字段**

  在 [总装.rs](/E:/koko/src/总装.rs) 增加 `RUSTUS_PUBLIC_ENDPOINT`、`RUSTUS_SERVER_PORT`、`RUSTUS_DATA_DIR` 这类启动期配置读取：
  - `public endpoint` 给 `prepare` 返回给前端
  - `server port / data dir` 给本地脚本编排
  - 默认值保持本地可运行，例如 `http://127.0.0.1:1081/files`、`1081`、`data/rustus`

  约束：
  - 不把这些字段塞进 domain/usecase
  - 不要求生产部署必须走新分布式配置系统

- [ ] **Step 4: 改写 `run.ps1` 同时拉起 Rustus sidecar**

  具体要求：
  - 用现有 `New-ManagedProcess` 机制拉起 `rustus`
  - 日志与现有 `backend/build/typecheck` 一样进入 launcher 日志目录
  - 失败时和其他进程一样中止整条开发启动链
  - 不自动安装 rustus；缺失时给出明确报错

- [ ] **Step 5: 重新跑脚本检查**

  Run: `pwsh -File tests/启动器脚本检查.ps1`

  Expected: PASS

- [ ] **Step 6: 提交启动编排边界**

  Run:
  - `git add tests/启动器脚本检查.ps1 run.ps1 src/总装.rs`
  - `git commit -m "增加 Rustus sidecar 启动编排"`

## Task 2: 用失败测试锁住新的 Tus 契约与运输记录表

**Files:**
- Create: `migrations/0005_媒体Tus上传运输记录.sql`
- Modify: `src/外壳.rs`
- Modify: `src/房间外壳.rs`
- Modify: `src/适配.rs`
- Modify: `tests/集成测试.rs`

- [ ] **Step 1: 先把 `prepare` 新契约和 `complete` gate 写成红测**

  在 [集成测试.rs](/E:/koko/tests/集成测试.rs) 增加至少三类测试：
  - `prepare媒体上传会返回Tus契约()`
    - 断言 `upload_method = "tus"`
    - 断言存在 `tus_endpoint / tus_headers / tus_metadata / expires_at`
    - 不再断言 `upload_url / upload_headers`
  - `没有上传回执时complete媒体上传会返回attachment_not_ready()`
  - `prepare图片和视频都会返回统一Tus契约()`

- [ ] **Step 2: 运行集成测试，确认它先失败**

  Run: `cargo test --test 集成测试 prepare媒体上传会返回Tus契约 -- --exact`

  Expected: FAIL，因为当前后端仍返回 `PUT` 契约。

- [ ] **Step 3: 增加运输记录 migration，并在仓储里补最小读写接口**

  在新 migration 里创建运输记录表，字段建议：
  - `attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id)`
  - `transport_kind TEXT NOT NULL`
  - `upload_token TEXT NOT NULL`
  - `token_expires_at TIMESTAMPTZ NOT NULL`
  - `transport_upload_id TEXT NULL`
  - `storage_locator TEXT NULL`
  - `byte_size BIGINT NULL`
  - `finished_at TIMESTAMPTZ NULL`

  在 [适配.rs](/E:/koko/src/适配.rs) 增加：
  - prepare 时写入运输授权记录
  - hook `pre-create` 校验 token / prepared attachment / byte_size 时的查询接口
  - hook `post-finish` 更新上传回执接口
  - complete 前查询完整回执接口

- [ ] **Step 4: 把 `prepare_media_upload()` 改成返回 Tus 契约**

  在 [房间外壳.rs](/E:/koko/src/房间外壳.rs)：
  - 继续调用 `准备媒体附件上传`
  - 生成 opaque `upload_token` 并写入运输记录表
  - 返回：
    - `attachment_id`
    - `kind`
    - `upload_method: "tus"`
    - `tus_endpoint`
    - `tus_headers`
    - `tus_metadata`
    - `expires_at`

  约束：
  - `upload_token` 不进 domain
  - `attachment_id` 继续是唯一业务锚点
  - `tus_metadata` 至少带 `attachment_id/file_name/mime_type/byte_size`

- [ ] **Step 5: 更新状态与路由，让新契约可贯通**

  在 [外壳.rs](/E:/koko/src/外壳.rs)：
  - 给 `应用状态` 挂上 Rustus public endpoint / shared data dir 所需配置
  - 删除“前端该往哪儿 `PUT`”这段 `attachment_upload_mode` 分支逻辑
  - 保留 `attachments` canonical store，不让 Rustus 临时目录替代长期存储

- [ ] **Step 6: 运行集成测试和迁移**

  Run:
  - `cargo test --test 集成测试 prepare媒体上传会返回Tus契约 -- --exact`
  - `cargo test --test 集成测试 没有上传回执时complete媒体上传会返回attachment_not_ready -- --exact`

  Expected: PASS

- [ ] **Step 7: 提交 Tus 契约与运输记录表**

  Run:
  - `git add migrations/0005_媒体Tus上传运输记录.sql src/外壳.rs src/房间外壳.rs src/适配.rs tests/集成测试.rs`
  - `git commit -m "新增 Tus 上传契约与运输记录表"`

## Task 3: 接入 Rustus hooks，并把 `complete` 改成消费运输回执

**Files:**
- Modify: `src/外壳.rs`
- Modify: `src/房间外壳.rs`
- Modify: `src/用例.rs`
- Modify: `src/适配.rs`
- Modify: `tests/集成测试.rs`

- [ ] **Step 1: 先写 hook 与 complete 的红测**

  在 [集成测试.rs](/E:/koko/tests/集成测试.rs) 增加：
  - `rustus pre-create 非法token会被拒绝()`
  - `rustus post-finish 会登记上传回执()`
  - `有上传回执时complete图片上传会成功并写入缩略图()`
  - `有上传回执时complete视频上传会成功()`

  这一步可以直接通过 HTTP 调主服务 hook route，先不要求真的拉起 Rustus 子进程。

- [ ] **Step 2: 运行目标测试，确认它们先失败**

  Run:
  - `cargo test --test 集成测试 rustus\ pre-create\ 非法token会被拒绝 -- --exact`
  - `cargo test --test 集成测试 rustus\ post-finish\ 会登记上传回执 -- --exact`

  Expected: FAIL，因为当前主服务没有 hook route，也没有运输回执更新逻辑。

- [ ] **Step 3: 在 `src/房间外壳.rs` 增加 Rustus hook handler**

  在现有文件内新增最小 DTO 和 handler：
  - `handle_rustus_hook_pre_create`
  - `handle_rustus_hook_post_finish`

  行为要求：
  - 只接受 `Hook-Name = pre-create/post-finish`
  - 通过被代理过来的 `Authorization` 校验 `upload_token`
  - `pre-create` 校验 `attachment_id`、`byte_size`、prepared 附件仍有效
  - `post-finish` 只登记运输回执，不升级 ready

- [ ] **Step 4: 在 `complete_media_upload()` 里改成“回执 + shared file”驱动**

  具体改动：
  - 不再直接根据 `attachments.storage_key` 假设原图已经在 canonical store 可读
  - 先查询运输回执
  - 用 `storage_locator` 打开 Rustus shared dir 里的临时文件
  - 解析图片/视频，生成缩略图或最小元数据
  - 把 canonical 原图/缩略图写入 `attachment_store`
  - 之后再调用 `完成媒体附件上传()`

  约束：
  - `完成媒体附件上传()` 仍然只是 prepared -> ready 升级点
  - 不让 hook 直接写 ready

- [ ] **Step 5: 删除旧 `PUT` handler 和 route**

  从 [房间外壳.rs](/E:/koko/src/房间外壳.rs) 删除 `upload_prepared_media_content()`；
  从 [外壳.rs](/E:/koko/src/外壳.rs) 删除 `/api/media/{attachment_id}/upload` route。

- [ ] **Step 6: 运行后端媒体主链测试**

  Run: `cargo test --test 集成测试`

  Expected:
  - PASS
  - `prepare` 只返回 Tus 契约
  - hook 能校验/登记回执
  - `complete` 没回执拒绝，有回执成功
  - `ready视频附件可以进入create_message主链()` 继续通过

- [ ] **Step 7: 提交 hook 与 complete 收口**

  Run:
  - `git add src/外壳.rs src/房间外壳.rs src/用例.rs src/适配.rs tests/集成测试.rs`
  - `git commit -m "接入 Rustus hook 并改用上传回执驱动 complete"`

## Task 4: 前端契约切到 Tus，发布器改用 `@uppy/tus`

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Modify: `frontend/契约.ts`
- Modify: `frontend/传输.ts`
- Modify: `frontend/媒体/媒体发布.ts`
- Modify: `frontend/媒体/媒体诊断.ts`
- Modify: `frontend/tests/传输测试.spec.ts`
- Modify: `frontend/tests/媒体发布测试.spec.ts`
- Modify: `frontend/tests/common/聊天测试支架.ts`
- Modify: `frontend/tests/后台壳测试.spec.ts`
- Modify: `frontend/tests/端到端测试.spec.ts`

- [ ] **Step 1: 先写前端新契约红测**

  在 [传输测试.spec.ts](/E:/koko/frontend/tests/传输测试.spec.ts) 改写/新增：
  - `prepareMediaUpload 会返回 upload_method = "tus"`
  - `prepareMediaUpload 会把相对 tus_endpoint 收口成绝对地址`
  - 结果对象包含 `tus_headers / tus_metadata`

  在 [媒体发布测试.spec.ts](/E:/koko/frontend/tests/媒体发布测试.spec.ts) 改写/新增：
  - `媒体发布器 会把 tus_endpoint / tus_headers / tus_metadata 写进 uploader meta`
  - `upload-success 后仍然必须 complete 成功，草稿才变 ready`
  - `complete` 失败、`upload-error`、watchdog 失败后草稿仍保留

- [ ] **Step 2: 运行前端目标测试，确认它们先失败**

  Run:
  - `pnpm --dir frontend test -- tests/传输测试.spec.ts`
  - `pnpm --dir frontend test -- tests/媒体发布测试.spec.ts`

  Expected: FAIL，因为当前前端仍然锁在 `PUT + AwsS3`。

- [ ] **Step 3: 切依赖，从 `@uppy/aws-s3` 改到 `@uppy/tus`**

  具体改动：
  - [package.json](/E:/koko/frontend/package.json) 删 `@uppy/aws-s3`
  - 加 `@uppy/tus`
  - 更新 lockfile

- [ ] **Step 4: 改写 `frontend/契约.ts` 与 `frontend/传输.ts`**

  目标：
  - `媒体上传准备结果` 改成 Tus 契约
  - `HttpRealtime传输.prepareMediaUpload()` 只绝对化 `tus_endpoint`
  - 删除所有 `upload_url / upload_headers` 类型引用

- [ ] **Step 5: 改写 `frontend/媒体/媒体发布.ts`**

  具体要求：
  - 默认 uploader 改用 `Tus`
  - `媒体上传Meta` 改成 `tus_endpoint / tus_headers_json / tus_metadata_json`
  - 新 helper 只负责从 file meta 读取 Tus 所需配置
  - 仍保留现有 watchdog / retry / `upload-success -> complete` 主链

  约束：
  - 不新造私有上传器平台
  - 不把 Rustus upload id 暴露给壳层草稿

- [ ] **Step 6: 同步改测试支架与诊断**

  在 [聊天测试支架.ts](/E:/koko/frontend/tests/common/聊天测试支架.ts)、[后台壳测试.spec.ts](/E:/koko/frontend/tests/后台壳测试.spec.ts)、[端到端测试.spec.ts](/E:/koko/frontend/tests/端到端测试.spec.ts)：
  - 假 prepare 结果改成 Tus 契约
  - 继续让 `attachment_id` 做诊断与 complete 锚点

  在 [媒体诊断.ts](/E:/koko/frontend/媒体/媒体诊断.ts)：
  - 保持 `attachment_id` 为诊断主键
  - 不要求 `upload_url`
  - 对 Tus/complete 错误继续归一化稳定错误码

- [ ] **Step 7: 跑前端测试和类型检查**

  Run:
  - `pnpm --dir frontend test -- tests/传输测试.spec.ts tests/媒体发布测试.spec.ts tests/后台壳测试.spec.ts tests/端到端测试.spec.ts`
  - `pnpm --dir frontend typecheck`

  Expected: PASS

- [ ] **Step 8: 提交前端 Tus 切换**

  Run:
  - `git add frontend/package.json frontend/pnpm-lock.yaml frontend/契约.ts frontend/传输.ts frontend/媒体/媒体发布.ts frontend/媒体/媒体诊断.ts frontend/tests/传输测试.spec.ts frontend/tests/媒体发布测试.spec.ts frontend/tests/common/聊天测试支架.ts frontend/tests/后台壳测试.spec.ts frontend/tests/端到端测试.spec.ts`
  - `git commit -m "前端媒体上传切换到 Tus 契约"`

## Task 5: 删干净旧 `PUT/AwsS3` 残留，并做全量验证

**Files:**
- Modify: any remaining touched files from previous tasks
- Regenerate: `graphify-out/*`

- [ ] **Step 1: 搜索旧链残留，先写删除清单**

  Run:
  - `rg -n "@uppy/aws-s3|upload_url|upload_headers|upload_method: \\\"PUT\\\"|/api/media/.*/upload|AwsS3" frontend src tests`

  Expected:
  - 只剩待删除引用
  - 不再有任何业务主链仍依赖 `PUT`

- [ ] **Step 2: 删除旧链残留代码和注释**

  重点清理：
  - 旧 `AwsS3` import
  - `upload_url/upload_headers` 类型字段
  - `/api/media/{attachment_id}/upload` 相关说明
  - 任何把 `PUT` 当 canonical 上传主链的测试描述

- [ ] **Step 3: 运行后端全量测试**

  Run: `cargo test`

  Expected: PASS

- [ ] **Step 4: 运行前端全量测试**

  Run: `pnpm --dir frontend test`

  Expected: PASS

- [ ] **Step 5: 运行前端类型检查**

  Run: `pnpm --dir frontend typecheck`

  Expected: PASS

- [ ] **Step 6: 做一次本地启动 smoke**

  Run: `pwsh -File .\run.ps1`

  Expected:
  - 能看到 `backend`、`build`、`typecheck`、`rustus` 四个托管进程都启动
  - 主服务和 Rustus sidecar 都能访问

  Manual smoke:
  - 上传图片并中断一次，再恢复
  - 上传视频并中断一次，再恢复
  - `complete` 失败时草稿不消失

- [ ] **Step 7: 刷新代码图谱**

  Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

  Expected: `graphify-out/` 成功更新。

- [ ] **Step 8: 复核工作树**

  Run:
  - `git diff --check`
  - `git status --short`

  Expected:
  - 无格式化噪音
  - 无意外残留脏文件

- [ ] **Step 9: 提交收尾**

  Run:
  - `git add frontend src tests migrations run.ps1 graphify-out`
  - `git commit -m "完成媒体上传 Tus 与 Rustus 主链迁移"`

## Notes

- 这轮迁移里，`attachment_id` 继续是 canonical 业务锚点；`transport_upload_id` 只准待在运输记录表和诊断附加上下文里。
- 不要把 `upload_token`、Rustus 路径、offset、hook payload 塞进 `domain` 或共享前端契约。
- 如果实现过程中发现 `Rustus` 真实 CLI 参数与计划不同，先以官方文档为准更新计划，再动代码，不要凭印象编排 sidecar。
