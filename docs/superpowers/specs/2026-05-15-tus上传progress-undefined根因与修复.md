# tus 上传 `progress` undefined — 根因分析与修复方案 V2

## 问题现象

万人万群实时群聊 IM（kokoqun.com），所有设备（手机/电脑/iPad）：
1. 发送图片/视频时**频繁出现** `Cannot read properties of undefined (reading 'progress')`
2. 上传到一半刷新页面后**永远卡在"上传中"**

## 期望体验

**选图/选视频 → 点发 → 完事。** 刷新/崩溃/切 app → 回来自动续传 → 用户无感。图片、视频、所有附件都走同一条链路，一套真相。

---

## 根因

### Golden Retriever 没有正确配置

提交 `c37c7ca8` 集成了 `@uppy/golden-retriever`，但**缺少 3 个关键配置**：

| 配置 | 官方推荐 | 我们的 | 后果 |
|---|---|---|---|
| `expires` | `24 * 60 * 60 * 1000` | ❌ 未设 | 旧条目永不过期，堆积冲突 |
| `serviceWorker` | `true` | ❌ 未设 | 无法恢复文件 blob 数据 |
| `restored` 事件 | 监听并自动续传 | ❌ 未监听 | 恢复了状态但不续传 → 卡住 |

没有 `expires` → 旧指纹永远留在 localStorage → 新上传和旧指纹冲突 → Tus 误恢复过期 URL → `progress` undefined。

没有 `serviceWorker` → 刷新后文件 blob 丢失 → Golden Retriever 恢复的是"幽灵文件"（有元数据无数据）→ Tus 无法续传。

没有 `restored` 事件 → 恢复后无人触发 `upload()` → 永远卡在"上传中"。

---

## 修复方案

### 核心：正确配置 Golden Retriever + 监听 restored 事件

**改动 1：配置 Golden Retriever**

```typescript
// 修改前
.use(GoldenRetriever)

// 修改后
.use(GoldenRetriever, {
  expires: 24 * 60 * 60 * 1000,
  serviceWorker: true,
  serviceWorkerPath: '/media-sw.js',
})
```

**改动 2：在 `确保媒体上传器` 中监听 `restored` 事件**

```typescript
nextUploader.on("restored", () => {
  const files = nextUploader.getFiles();
  if (files.length > 0) {
    void nextUploader.upload().catch(() => {});
  }
});
```

**改动 3：`media-sw.ts` 中加载 Golden Retriever Service Worker**

项目已有 `frontend/media-sw.ts`（媒体 Service Worker）。需要在其中导入 Golden Retriever 的 SW 模块：

```typescript
importScripts('@uppy/golden-retriever/lib/ServiceWorker');
```

或者如果 `media-sw.ts` 是 TypeScript + 构建的，用 import 方式集成。

**改动 4：`恢复未完成草稿` 不再假设 transporting 状态可保持**

Golden Retriever 负责 Uppy 层面的续传，我们的 `恢复未完成草稿` 负责 UI 草稿状态。两者协作：
- `ready` 草稿：直接恢复 UI
- `transporting` 草稿：恢复 UI 为 "上传中"，Golden Retriever + `restored` 事件自动续传
- `failed` 草稿：恢复 UI，用户可手动重试

**注意**：`sourceFile` 刷新后为 null。Golden Retriever 的 Service Worker 负责缓存文件 blob，恢复后 Uppy 内部能拿到数据。我们的草稿不需要持有 `sourceFile`。

### 不改什么

- 不改 Tus 配置（`retryDelays`、`chunkSize`、`limit`、`removeFingerprintOnSuccess` 等）
- 不改 `upload-stalled` 处理逻辑（已修的保留）
- 不改后端 tusd
- 不引入第二套上传真相——图片、视频、所有附件共用同一个 Uppy+Tus+GoldenRetriever 管线

---

## 验证标准

1. 选图/选视频 → 点发送 → 上传成功，无 `progress` undefined 错误
2. 上传到一半刷新 → 自动续传 → 用户无感
3. 旧的 Golden Retriever 条目 24 小时后自动过期
4. 全量前端测试通过

---

## 风险与边界

| 风险 | 缓解 |
|---|---|
| Service Worker 不支持的浏览器（极少） | 降级到 IndexedDB，5MB 以下文件仍可恢复 |
| `media-sw.ts` 已有逻辑可能冲突 | 需要检查现有 SW 代码，确保 Golden Retriever SW 模块不覆盖已有功能 |
| 续传时 tusd 已清理旧上传 | Tus `onShouldRetry` 检测 404/410 → 走重新上传链路 |
| `restored` 事件时 session 还没建立 | 延迟 `upload()` 到 session 就绪后 |
