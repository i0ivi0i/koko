# WebTorrent 存储层 OPFS 迁移设计

## 背景

koko 当前使用 `idb-chunk-store@1.0.1` 将 WebTorrent piece 字节存储在 IndexedDB。
WebTorrent 官方 v2.5.0（2024.08）已弃用 IndexedDB，内置 `fs-access-chunk-store`（OPFS），
理由："waaaaaay more storage capacity, way better speeds and way smaller bundle sizes"（PR #2851）。

koko 的平台层已经探测了 `webTorrent默认OPFSStore可用`，但业务代码从未使用——
`读取协作分发持久ChunkStore选项()` 永远注入 `idb-chunk-store`，覆盖了 WebTorrent 更好的默认行为。

## 目标

删除 `idb-chunk-store` 及其全部胶水代码，让 WebTorrent v2.8.5 使用内置 OPFS 存储。
净效果：删多于加，存储性能提升，跟随官方主线。

## 不变量

- `.torrent` 描述缓存（`协作分发Torrent缓存`）不受影响，它用的是平台层 `idb`，不是 idb-chunk-store
- `destroyStoreOnDestroy: false` 保留——确保 OPFS 字节不随 session 销毁而删除
- `storeCacheSlots: 150` 保留——这是 WebTorrent 内存缓存配置，与底层 store 无关
- `maxConns: 128`、`private: true`、`maxWebConns: 4` 等 swarm 配置不变
- 后端强种子、presence 心跳、join_ticket 门禁等业务逻辑不变
- 浏览器不支持 OPFS 时（~6%），WebTorrent 内部自动回退内存 store，无需 koko 额外处理

## 改动清单

### 1. `frontend/媒体/媒体协作分发.ts`

**删除：**
- `import IndexedDBChunkStore from "idb-chunk-store"`
- `import { Buffer } from "buffer"`
- `type 可挂Buffer的全局对象`
- `规范化协作分发Store名称()` 函数
- `补齐IndexedDBChunkStoreBuffer全局()` 函数
- `创建协作分发IndexedDBChunkStore()` 函数
- `读取协作分发持久ChunkStore选项()` 函数
- `WebTorrentChunkStore构造器` 类型

**修改：**
- `接入协作分发种子()` 中删除 `...读取协作分发持久ChunkStore选项(distribution)` 展开

### 2. 依赖

- `package.json` 删除 `idb-chunk-store` 依赖
- `package.json` 删除 `buffer` 依赖（仅被 IDB chunk store 使用）

### 3. 类型声明

- 删除 `frontend/idb-chunk-store.d.ts`

### 4. 平台能力层

- `存储运行时.ts` 中 `读取协作分发字节Store能力()` 删除 `indexedDBStore可用` 字段
  （如无其他调用者则考虑简化整个函数）

### 5. 测试

- 架构边界测试中移除对 `IndexedDBChunkStore` / `idb-chunk-store` 的断言
- 存储运行时测试中更新 `读取协作分发字节Store能力` 的期望

## 迁移影响

- 现有用户 IndexedDB 中的 piece 缓存在迁移后不会被自动读取
- 首次刷新后 WebTorrent 会从 swarm 重新拉取 piece，存入 OPFS
- 后端强种子保底，对用户体验无感知影响
- 旧 IndexedDB 数据不会自动清理，由浏览器存储管理自然回收

## 验证标准

1. `pnpm typecheck` 通过
2. `pnpm test` 全绿
3. 冒烟测试：视频发送→群友自动播放→WebTorrent swarm 连接→piece 字节存储在 OPFS（Chrome DevTools → Application → Storage → Origin private file system 可见）
4. 页面刷新后再次播放同一视频→秒开（OPFS 缓存命中）
