# 2026-04-15 群聊媒体上传 Uppy / Tus / Rustus 2026 新实践

适用范围：`koko` 的图片 / 视频上传链路，以及后续 Linux 公网部署前的上传边界设计。  
目标：只记 2026 年还值得信的官方建议，避免继续沿用旧心智。

## 1. 先说结论

这一轮最该记死的结论有八条：

1. 浏览器大文件续传主链，继续优先站在 `Uppy + tus` 上，不手搓分片协议。
2. `@uppy/tus` 现在官方页面写的默认并发上限是 `20`，不是很多人脑子里的旧默认值；高并发场景必须自己显式钉值。
3. `chunkSize` 依然不是“越显式越专业”，官方仍然明确说除非被迫不要设。
4. 上传过载时，优先用 `429 + onShouldRetry` 这条官方退避路，不要先手搓本地 watchdog 把慢网大文件误杀。
5. 如果未来走直传对象存储，Uppy 官方对 `AWS S3 multipart` 的口径很明确：`100 MiB+` 才明显值，且不要盲目把并发开很高。
6. `Rustus` 生产上真正关键的不是“能跑起来”，而是 `workers / max-file-size / behind-proxy / hook-timeout / shared storage` 这些门禁要显式落地。
7. `Rustus hybrid-s3` 官方自己就提醒“不适合大文件”；如果以后你们大视频变常态，不能把它当成无限扩容方案。
8. 如果切 `Rustus s3 storage`，Tus 客户端分块大小必须一起重审，因为官方要求块大小至少 `5,000,000` 字节。

## 2. Uppy 官方现在真正强调什么

### 2.1 `@uppy/tus`

官方 2026 文档里几个最关键的点：

- `@uppy/tus` 本质是对 `tus-js-client` 的包装，绝大多数底层能力都能继续透传。
- `headers` 可以按文件动态生成，这很适合 `prepare -> per-file token`。
- `chunkSize` 默认是 `Infinity`，官方仍明确说“除非被迫，否则不要设”。
- `retryDelays` 默认是 `[0, 1000, 3000, 5000]`。
- `onShouldRetry` 默认会在 `HTTP 429` 上走指数退避。
- `allowedMetaFields` 应显式收口，不要把壳层杂字段全塞进 Tus metadata。
- 当前 Tus 页面写的 `limit` 默认值是 `20`，`0` 代表不限制，而且官方直接说不推荐。

对 `koko` 的直接约束：

1. 你们如果要支持 `200MB` 视频上传，应该显式设置 `limit`，不要继续吃默认值。
2. 本地“15 秒失活 watchdog”这类壳层私货可以删，但不能删完什么都不补；至少要决定是否显式保留 `retryDelays` / `onShouldRetry`。
3. `allowedMetaFields` 继续保持最小集是对的，别把页面态和展示态带进上传协议。

### 2.2 `@uppy/aws-s3`

官方 2026 文档里更有价值的不是“能直传 S3”，而是这些边界：

- 这个插件明确支持客户端直传 `S3` 或兼容对象存储。
- 官方说 multipart 上传在 `100 MiB+` 的大文件上才开始明显值。
- 默认 `shouldUseMultipart` 就是只在大文件时启用 multipart，官方建议保留这个默认判断。
- `limit` 默认是 `6` 个文件并行，但文档明确提醒不要随便调高，因为 `S3` 走 `HTTP/1.1`，高并发连接和签名 URL 过期都会变成问题。
- `getChunkSize()` 需要兼顾请求次数和失败重传成本；`S3` 要求最小 part 至少 `5 MiB`，总 part 数最多 `10,000`。
- 官方还特别提醒：如果不是已经必须用 `Companion`，通常更建议接你自己的后端签名服务，这样访问控制、观测和扩展更稳。

对 `koko` 的直接约束：

1. 如果未来改成浏览器直传对象存储，不要一上来就把 multipart 并发开大。
2. 你们当前视频上限如果只是 `200MB`，Tus 仍然是很合理的主线；不是一超过 `50MB` 就必须改成直传 S3。
3. 如果未来上限继续往上提，`Uppy AwsS3 multipart` 才会变得更有吸引力。

## 3. `tus-js-client` / tus 协议 2026 仍然值得记的点

### 3.1 `tus-js-client`

当前官方 API 文档里这几个点容易被忽略：

- `storeFingerprintForResuming` 默认开着，跨会话恢复仍然是默认能力。
- `removeFingerprintOnSuccess` 默认关着；如果打开，同一文件再次上传会新建上传资源，而不是复用旧记录。
- `uploadLengthDeferred` 适合未知总大小流式上传，但这时 `chunkSize` 必须是有限值。
- `uploadDataDuringCreation` 依赖服务器支持 `creation-with-upload` 扩展。

对 `koko` 的直接约束：

1. 你们已经踩过“旧 fingerprint 误复用旧上传 URL”的坑，这类问题未来仍要防。
2. 如果以后做浏览器内转码后边转边传，才需要认真评估 `uploadLengthDeferred`；现在不用提前复杂化。

### 3.2 tus 协议本身

协议层现在仍然稳定，几个关键事实没变：

- 核心恢复机制仍然是 `HEAD` 读 offset，再 `PATCH` 从断点继续。
- `Upload-Defer-Length` 适合未知总长流。
- `Creation-With-Upload` 能减少一次往返，但要服务端明确支持。
- `Tus-Max-Size`、扩展列表等能力应通过服务端能力面明确暴露。

对 `koko` 的直接约束：

1. 上传控制面要继续只认权威回执，不要把 transport 成功偷换成业务成功。
2. 真要做“正式部署门禁”，应该把服务端暴露的 tus 扩展和上限纳入验收，而不是靠脑内设定。

## 4. Rustus 官方 2026 给出的生产边界

### 4.1 服务层

`Rustus` 官方配置页里明确写了：

- `workers` 默认等于物理 CPU 核数，改它要谨慎。
- `max-body-size` 只限制单次请求体。
- `max-file-size` 才是整文件级别硬上限。
- `cors` 可以配白名单，默认不是你公网生产想要的长期姿势。

### 4.2 Hooks

官方 hooks 页里几个最关键的生产事实：

- 如果 `Rustus` 放在 nginx / 反代后面，要显式开 `--behind-proxy`。
- `HTTP hook timeout` 默认只有 `2` 秒。
- hooks 格式里 `v2` 是官方明确标成 preferred 的格式。

### 4.3 Storage / Deployment

官方部署与存储页里几个容易出事故的点：

- 多实例部署时，所有实例必须共享同一份 data/info storage。
- `hybrid-s3` 没有 chunk size 限制，但官方明确说它“不适合大文件”，因为最终还是在最后一次请求里上传到 S3。
- `s3 storage` 直传对象存储时，Tus 客户端 chunk size 必须至少 `5,000,000` 字节。
- Helm / Kubernetes 生产扩容时，官方明确要求挂 `PersistentVolumeClaim`。
- `Rustus` 暴露 `/metrics`，可以直接接 Prometheus。

对 `koko` 的直接约束：

1. 当前如果要把视频上限抬到 `200MB`，只改前端和业务后端还不够，`Rustus max-file-size` 也必须同步抬。
2. Linux 公网反代部署时，`RUSTUS_BEHIND_PROXY=true` 不该再拖。
3. 如果以后视频大文件越来越多，别把 `hybrid-s3` 当终局方案。
4. 你们如果最终多副本扩展，Rustus 的共享存储不是“可选优化”，而是生死线。

## 5. 对 `koko` 最有价值的设计裁决

### 5.1 现在就该定下来的

1. 继续以 `Uppy + Tus + Rustus hook` 作为浏览器媒体上传主链。
2. 删除前端本地 15 秒上传 watchdog，但保留或显式化官方重试策略。
3. 视频上限如果升到 `200MB`，同步改：
   - 前端视频大小校验
   - 后端 prepare 校验
   - Axum `DefaultBodyLimit`
   - `Rustus max-file-size`
   - `Rustus max-body-size`（如果仍有大请求经过它）
4. 显式设置 Uppy Tus `limit`，不要继续依赖默认 `20`。

### 5.2 现在先别乱动的

1. 不要为了“可控”就手动设置 `chunkSize`。
2. 不要把上传链突然改成浏览器直传对象存储，除非你们已经准备好签名、回调、生命周期治理和更完整的失败恢复。
3. 不要把 `hybrid-s3` 想象成“天然大文件友好”。

## 6. 给未来正式公网部署的最小建议

最小稳妥方案：

1. 业务后端继续做控制面：`prepare / hook / complete / auth / 业务状态升级`。
2. 大字节上传继续交给 `Rustus`，不要让主应用自己吃大文件流。
3. `Rustus` 显式配置：
   - `workers`
   - `max-body-size`
   - `max-file-size`
   - `behind-proxy`
   - `http-hook-timeout`
   - `cors`
4. 上传状态的真相仍由业务后端裁决，不由 Tus 成功代替。

## 7. 官方来源

- Uppy Docs: <https://uppy.io/docs/>
- Uppy Tus: <https://uppy.io/docs/tus/>
- Uppy AWS S3: <https://uppy.io/docs/aws-s3/>
- tus-js-client API: <https://github.com/tus/tus-js-client/blob/main/docs/api.md>
- tus Protocol: <https://tus.io/protocols/resumable-upload>
- Rustus Configuration: <https://s3rius.github.io/rustus/configuration/>
- Rustus Hooks: <https://s3rius.github.io/rustus/hooks/>
- Rustus Deployment: <https://s3rius.github.io/rustus/deploy/>
