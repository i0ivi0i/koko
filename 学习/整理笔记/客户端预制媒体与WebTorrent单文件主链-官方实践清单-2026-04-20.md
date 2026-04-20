# 客户端预制媒体与 WebTorrent 单文件主链官方实践清单（2026-04-20）

## 1. 目标

这份清单只服务当前设计：`客户端预制媒体 -> 后端轻校验单文件入库 -> WebTorrent 单文件分发`。  
重点是避免手搓轮子、避免误用 API、避免把高成本转码继续堆到后端。

## 2. 官方事实（和本项目直接相关）

### 2.1 WebTorrent 官方边界

1. 浏览器端 WebTorrent 只能连 WebRTC-capable peer；普通 BT/TCP peer 不能直接互通。  
来源：WebTorrent FAQ。
2. 浏览器端 web seed 必须满足 CORS；否则跨域拉分片会失败。  
来源：WebTorrent docs `torrent.addWebSeed()`。
3. `client.createServer()` 支持 Range 请求，并有 Service Worker 集成示例。  
来源：WebTorrent docs `client.createServer([opts], force)`。

这三条直接决定：我们的“秒开/秒播”不能只依赖磁链，还要保证可用 WebRTC 做种与 CORS 正确的 web seed。

### 2.2 Uppy + Tus 官方边界

1. `@uppy/tus` 是 resumable 上传的官方路径，默认就带重试能力。  
2. `chunkSize` 默认 `Infinity`，官方明确提示“除非被迫，不要随便改”。  
3. `retryDelays` 默认 `[0, 1000, 3000, 5000]`。  
来源：Uppy Tus 文档。

这决定了：上传层应保持“少参数、稳默认”，不要为“看起来高性能”乱调导致兼容回退。

### 2.3 客户端图片预处理官方边界

1. `@uppy/compressor` 官方能力是“上传前浏览器端压图”（默认用 Compressor.js）。  
2. 文档强调移动端场景可以明显省流量和加速上传。  
来源：Uppy Compressor 文档。

这支持“图片预制前移到客户端”的方向，但质量参数需要我们自己收口成“高清优先”。

### 2.4 WebCodecs 官方边界

1. `VideoEncoder` 是 Secure Context 特性（HTTPS），且“非 Baseline”，并非所有主流浏览器都稳定可用。  
来源：MDN VideoEncoder。
2. WebCodecs 没有容器 demux API，官方建议配合第三方 demux（例如 MP4Box.js / jswebm）。  
来源：MDN WebCodecs API。
3. Chrome 官方建议用 DevTools Media Panel 调试 WebCodecs 链路。  
来源：Chrome WebCodecs Best Practices。

这决定了：视频预制必须做能力探测和多级 fallback，不能把 WebCodecs 当无条件主路径。

### 2.5 ffmpeg.wasm 官方边界

1. 官方明确：ffmpeg.wasm 显著慢于原生 FFmpeg。  
2. FAQ 明确输入文件上限是 2GB（当前 WebAssembly 硬限制）。  
3. 多线程 core 通常更快，但会吃更多 CPU 和内存。  
来源：ffmpeg.wasm Performance / FAQ / Overview。

这决定了：ffmpeg.wasm 适合“兼容兜底”，不适合被当成唯一成功路径。

### 2.6 浏览器持久化存储边界

1. `navigator.storage.persist()` 也是 Secure Context 能力。  
2. 返回 `true` 才是持久化授权成功；`false` 很常见，不能当失败异常。  
来源：MDN StorageManager.persist。

这决定了：WebTorrent 长留只能 best-effort，不可承诺“浏览器一定永久保存”。

### 2.7 Secure Context 官方边界

1. 资源要被视为安全上下文，原则上应走 `https://`。  
2. `http://127.0.0.1` / `http://localhost` 属于“potentially trustworthy origin”开发特例。  
来源：MDN Secure Contexts。

这解释了：本机能跑不等于局域网设备也能跑，手机/异机调试必须走 HTTPS。

### 2.8 Rust WASM 打包官方边界

1. `wasm-pack build` 的 `target`（`bundler` / `web` / `nodejs`）决定产物加载模型。  
来源：wasm-pack docs。
2. 前端 Rust/WASM 集成应复用 wasm-bindgen/wasm-pack 规范路径，避免手搓 JS 胶水。  
来源：wasm-bindgen deployment + wasm-pack docs。

## 3. 高性能实现路线（可执行，不手搓）

### 3.1 客户端视频预制三段式

1. **直通/轻处理优先**：原始文件已是浏览器友好编码时，优先保真直通（最多做 faststart/封装归一化）。
2. **WebCodecs 路径**：仅在能力探测通过时启用。
3. **ffmpeg.wasm 兜底**：只做兜底，不承诺所有设备都快。

### 3.2 图片策略

1. 主文件只保留一份 canonical（WebP 为主）。
2. 质量默认高档，截图/文字图优先 lossless 或 near-lossless。
3. 不再后端派生 `thumbnail/full/original` 多副本长期存储。

### 3.3 上传与发布门禁

1. 本地预制失败：禁止进入 prepare/upload/complete。
2. 预制超时（15 分钟）只提醒，不自动放行半成品。
3. 进入群聊的文件必须已是“可播可种”的 canonical 成品。

### 3.4 WebTorrent 分发门禁

1. 单文件 payload 就是 canonical 文件。
2. 查看器、自动播、下载、做种都绑定同一 `content_hash/info_hash`。
3. 后端只做 24h 冷启动种子，之后删除源文件，长期依赖 swarm。

## 4. 对 `koko` 的直接裁决

1. 后端 `流媒体打包.rs` 不再是主链；改成可移除/可旁路的历史兼容路径。
2. `src/媒体上传外壳.rs` 的 complete 热路径要删掉“图片三份写入 + 视频打包上传”。
3. 前端新增独立视频预处理模块，和 `图片预处理.ts` 并列；`媒体发布.ts` 只编排，不承载转码细节。
4. 播放入口统一消费单文件协作分发，禁止再把“消息流自动播”和“查看器全屏播”拆成两套来源真相。

## 5. 资料链接（本轮使用）

1. [WebTorrent Docs](https://webtorrent.io/docs)
2. [WebTorrent FAQ](https://webtorrent.io/faq)
3. [Uppy Tus](https://uppy.io/docs/tus/)
4. [Uppy Compressor](https://uppy.io/docs/compressor/)
5. [MDN VideoEncoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder)
6. [MDN WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
7. [Chrome WebCodecs Best Practices](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)
8. [ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/)
9. [ffmpeg.wasm Performance](https://ffmpegwasm.netlify.app/docs/performance/)
10. [ffmpeg.wasm Overview](https://ffmpegwasm.netlify.app/docs/overview/)
11. [MDN StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
12. [MDN Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)
13. [wasm-pack build](https://rustwasm.github.io/docs/wasm-pack/commands/build.html)
14. [wasm-pack docs](https://rustwasm.github.io/docs/wasm-pack/)
15. [wasm-bindgen deployment](https://rustwasm.github.io/docs/wasm-bindgen/reference/deployment.html)

