# 2026-04-11 群聊媒体上传 Uppy / Tus / Rustus 官方实践清单

适用范围：`koko` 群聊里图片 / 视频上传链路。  
目标：把 `Uppy`、`tus` 协议、`Rustus` 官方建议和当前仓库真实配置对齐，分清哪些已经配对了，哪些只是“现在能跑”，哪些在 Linux 公网部署前必须补齐。

## 1. 先说结论

当前这条链路已经跨过了最危险的几个坑：

- 前端不再把 `upload-success` 偷换成 `ready`。
- 后端只认 `post-finish` 回执，不认 transport 成功等于业务成功。
- `attachment_id` 已经进入 Uppy 本地文件身份，避免新一轮 `prepare` 复用旧 Tus upload URL。
- Rustus 只开 `pre-create,post-finish` 两类 hook，没有再让 `post-create/post-receive` 反向长成业务裁决层。

但还没彻底“配完”的地方也很明确，主要集中在生产部署和运维边界：

1. `RUSTUS_PUBLIC_ENDPOINT` 现在开发默认还是 `127.0.0.1`，公网部署必须显式改成外部可访问地址。  
2. 反向代理场景还没显式启用 `RUSTUS_BEHIND_PROXY=true`。  
3. Rustus 只配了 `max-body-size`，还没显式配 `max-file-size` 去卡死整个上传总大小。  
4. CORS、hook timeout、shared storage、多副本规则还没沉成正式部署门禁。  
5. 未来如果把 Rustus 从 `file-storage` 切到纯 `s3`，前端 `chunkSize` 不能继续保持默认无限大心智，必须一起重审。  

## 2. 当前项目真实配置

### 2.1 前端 `Uppy + Tus`

当前实现见：

- `frontend/媒体/媒体发布.ts`

已经对齐的点：

- `endpoint` 不再前置写死，而是从 `prepare` 权威返回里读取。
- `headers` 用函数按文件读取，符合 Uppy 官方给的 per-file header 用法。
- `allowedMetaFields` 已收口为 `attachment_id/file_name/mime_type/byte_size`，没有把壳层临时字段透传给 Rustus。
- 没有手动设置 `chunkSize`，这符合 Uppy 官方“除非被迫，否则不要设”的建议。
- `relativePath = attachment_id` 已经补上，用来驱动 Uppy 本地文件 id 变化，避免 Tus resume 复用旧 upload URL。

当前还只是“默认值可用”，但没有显式钉死的点：

- 没有显式设置 `limit`，现在依赖 Uppy 默认并发上限。
- 没有显式设置 `retryDelays` / `onShouldRetry` / `onAfterResponse`，现在依赖默认重试和默认 429 行为。
- 没有显式设置 `withCredentials`，当前更偏向“Bearer header + 同源/反代路径”模式。

### 2.2 Rustus sidecar

当前实现见：

- `run.ps1`
- `src/总装.rs`
- `src/房间外壳.rs`

已经对齐的点：

- 启动器显式设置了 `--url /files`、`--hooks pre-create,post-finish`、`--max-body-size`、`file-storage`、`file-info-storage`。
- `Authorization` 会通过 `--hooks-http-proxy-headers` 透传给主服务 hook。
- 主服务 `pre-create` 只做上传创建门禁，`post-finish` 只落运输回执，`complete` 只消费回执后升级业务状态。
- `complete` 已经有短暂轮询窗口，吸收 `upload-success` 与 `post-finish` 的正常竞态。

还没显式配好的点：

- `RUSTUS_MAX_FILE_SIZE` 还没配。
- `RUSTUS_CORS` 还没配。
- `RUSTUS_HTTP_HOOK_TIMEOUT` 还没配。
- `RUSTUS_BEHIND_PROXY` 还没配。
- 多实例 shared storage 规则还没沉成部署文档。

## 3. 官方建议和 `koko` 对照

### 3.1 Uppy 官方建议

官方文档要点：

- `@uppy/tus` 会把配置继续透传给 `tus-js-client`，包括 `headers`、`retryDelays`、`onBeforeRequest`、`onShouldRetry` 等能力。  
  来源：<https://uppy.io/docs/tus/>
- `chunkSize` 默认是 `Infinity`，官方明确说除非被迫，不要设置。  
  来源：<https://uppy.io/docs/tus/>
- `retryDelays` 默认是 `[0, 1000, 3000, 5000]`。  
  来源：<https://uppy.io/docs/tus/>
- Uppy 2 起 Tus 会默认尝试恢复过去开始过的上传，并把状态存进本地存储。  
  来源：<https://uppy.io/docs/guides/migration-guides/>
- `@uppy/tus` / `@uppy/xhr-upload` 默认并发限制改成了 `5`。  
  来源：<https://uppy.io/docs/guides/migration-guides/>

对 `koko` 的判断：

- `allowedMetaFields` 最小化是对的，应该保持。
- `chunkSize` 现在不设是对的，别为了“看起来可控”乱加。
- `headers(file)` 也是对的，适合 `prepare -> per-file token` 这条链路。
- 真正还没显式配的是：
  - 要不要把 `limit` 钉成一个明确值；
  - 要不要把 `retryDelays` / `onShouldRetry` 钉成你能接受的行为；
  - 如果以后上传 token 会在大文件中途过期，要不要加 401 刷新逻辑。

### 3.2 tus 协议官方建议

官方协议要点：

- 核心协议靠 `HEAD` 看 offset，再用 `PATCH` 从该 offset 继续上传。  
  来源：<https://tus.io/protocols/resumable-upload>
- `OPTIONS` 可以暴露 `Tus-Version`、`Tus-Extension`、`Tus-Max-Size`。  
  来源：<https://tus.io/protocols/resumable-upload>
- Creation 扩展是推荐实现的，客户端用 `POST` 创建 upload resource。  
  来源：<https://tus.io/protocols/resumable-upload>
- Checksum 是可选扩展；Termination 也是可选扩展。  
  来源：<https://tus.io/protocols/resumable-upload>
- Expiration 扩展如果存在，客户端应该根据 `Upload-Expires` 判断旧上传是否还能继续恢复。  
  来源：<https://tus.io/protocols/resumable-upload>

对 `koko` 的判断：

- 现在确实是 `prepare -> POST /files -> HEAD/PATCH -> post-finish -> complete`，主线对了。
- 还缺一个协议层验收动作：把 `OPTIONS /files` 的结果纳入测试，确认线上实际启用了哪些扩展、最大尺寸是多少。
- `tus` 协议里有 Expiration，但 Rustus 当前公开文档列出来的可配置扩展里没有 `expiration`。  
  我的推断：不能指望 Rustus 用 `Upload-Expires` 自动替你清 unfinished upload，遗留半上传文件的清理仍然要靠运维策略或额外后台任务，而不是前端心智。

### 3.3 Rustus 官方建议

官方文档要点：

- Rustus 后面如果挂 nginx / 反向代理，建议显式开 `--behind-proxy`。  
  来源：<https://s3rius.github.io/rustus/hooks/>
- HTTP hooks 默认 timeout 是 2 秒。  
  来源：<https://s3rius.github.io/rustus/hooks/>
- Rustus 可以显式配置 `--max-body-size`、`--max-file-size`、`--cors`。  
  来源：<https://s3rius.github.io/rustus/configuration/>
- 多实例部署时，所有 Rustus 实例必须共享同一份 data/info storage。  
  来源：<https://s3rius.github.io/rustus/deploy/>
- Rustus 默认支持的 tus 扩展里包含 `termination`、`creation-with-upload`、`creation-defer-length`、`concatenation`、`checksum` 等；默认全开。  
  来源：<https://s3rius.github.io/rustus/configuration/>
- 如果切到纯 `s3` storage，官方要求所有 Tus 客户端把 chunk size 设到至少 `5,000,000` 字节。  
  来源：<https://s3rius.github.io/rustus/configuration/>

对 `koko` 的判断：

- 只开 `pre-create,post-finish` 是合理收口，不是遗漏。
- `Authorization` 透传 hook listener 也是合理配置。
- `max-body-size` 已经补了，但 `max-file-size` 还没补，当前更像“限制单次 PATCH 体积”，还不是“限制整文件大小”。
- 当前 Rustus 用的是 `file-storage`，所以前端不设置 `chunkSize` 没问题；但如果以后切纯 `s3`，前端和 Rustus 要一起改，不能只改一边。

## 4. 现在还没配好的清单

### 4.1 生产前必须补

1. 显式设置 `RUSTUS_PUBLIC_ENDPOINT`  
   当前 `src/总装.rs` 默认会回落到 `http://127.0.0.1:{port}/files`。这只适合本机开发，不适合 Linux 公网部署。

2. 反向代理部署时显式设置 `RUSTUS_BEHIND_PROXY=true`  
   如果公网入口前面有 nginx / caddy / ingress，这个不该继续靠“默认 false”混过去。

3. 显式设置 `RUSTUS_MAX_FILE_SIZE`  
   现在只有限 `max-body-size` 还不够。建议把它钉到和业务上传上限一致，至少先对齐当前 50 MiB 视频上限。

4. 明确 shared storage 规则  
   只要不是单实例，就必须让所有 Rustus 副本共享同一份 data/info storage。这个要写进部署文档，不是靠记忆。

### 4.2 建议尽快显式化

5. `RUSTUS_HTTP_HOOK_TIMEOUT`  
   官方默认 2 秒。现在没显式配置，建议按你的主服务 SLA 明确写死，避免之后某次默认行为变化或环境差异把 hook 卡死。

6. `RUSTUS_CORS`  
   如果未来走“同源反代 `/files`”可以继续不配；如果前端和 Rustus 分域，就必须显式白名单。

7. 前端 Tus `limit`  
   现在依赖默认值。默认不是错，但对群聊上传这种“最多 9 个附件”的场景，建议最终明确一下要不要固定成 `3~5`，把浏览器并发、磁盘压力、hook 时序都收得更稳。

8. 前端 Tus 重试策略  
   现在依赖默认 `retryDelays` 和默认 429 行为。  
   如果未来要支持：
   - 401 token 刷新
   - 蜂窝网络更激进重试
   - 代理层 502/504 的自定义退避  
   就该把 `onShouldRetry` / `onAfterResponse` 显式写出来。

### 4.3 现在先不要乱动

9. 不要为了“可控”去手动加 `chunkSize`  
   Uppy 官方明确说除非被迫，否则不要设。当前 `file-storage` 模式没有强制理由。

10. 不要打开 `post-create` / `post-receive` 再让主服务消费  
   这会把 transport 事件重新放大成业务主链，和我们当前“只认 `pre-create/post-finish`”的边界冲突。

## 5. Linux 公网部署最小建议

最小可行方案：

1. `koko` 和 `Rustus` 分两个进程或两个容器。  
2. 外层 nginx / caddy 统一对外域名。  
3. 对外暴露：
   - `/api` -> `koko`
   - `/files` -> `Rustus`
4. 环境变量至少显式配：
   - `RUSTUS_PUBLIC_ENDPOINT=https://你的域名/files`
   - `RUSTUS_BEHIND_PROXY=true`
   - `RUSTUS_MAX_BODY_SIZE=52428800`
   - `RUSTUS_MAX_FILE_SIZE=52428800`
   - `RUSTUS_DATA_DIR=...`
   - `RUSTUS_INFO_DIR=...`
5. 多副本时，`data-dir` 和 `info-dir` 必须是共享存储。

## 6. 给 `koko` 的下一步建议

1. 先补一份正式部署文档，把上面 4.1 的四项写成门禁。  
2. 再补一个 `OPTIONS /files` 集成验收，记录线上 Tus-Version / Extensions / Max-Size。  
3. 再决定是否显式钉死前端 `limit` 和 `retryDelays`。  
4. 如果未来要切对象存储，优先评估 `hybrid-s3`，不要直接把当前前端配置硬切到纯 `s3`。  

## 7. 原始来源（官方优先）

- Uppy Tus 文档：<https://uppy.io/docs/tus/>
- Uppy Migration Guides：<https://uppy.io/docs/guides/migration-guides/>
- tus 协议 1.0：<https://tus.io/protocols/resumable-upload>
- tus-js-client v3 发布说明：<https://tus.io/blog/2022/08/03/tus-js-client-300>
- Rustus Configuration：<https://s3rius.github.io/rustus/configuration/>
- Rustus Hooks：<https://s3rius.github.io/rustus/hooks/>
- Rustus Deployment：<https://s3rius.github.io/rustus/deploy/>
