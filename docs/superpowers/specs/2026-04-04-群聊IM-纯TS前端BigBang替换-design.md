# 2026-04-04 群聊IM 纯TypeScript前端 Big Bang 替换设计

## 1. 背景与目标

当前仓库前端壳为 Dioxus Web（Rust/WASM），但本轮治理目标已明确：

1. 前端一次性切换为纯 TypeScript。
2. 后端继续保持纯 Rust（domain/application/contract/store/adapter 真相链不变）。
3. 业务实时链路 100% 走 `socket.io-client <-> socketioxide`。
4. HTTP 只保留静态资源、健康检查、管理入口等非实时职责。
5. 旧前端必须彻底移除，禁止双轨、禁止冗余、禁止历史残留回流。

这次是 Big Bang，不做双壳并行，不做兼容层。

## 2. 技术选型与复用结论

### 2.1 前端技术栈

- UI 壳：`Lit`（成熟 Web Components 方案）
- 实时通信：`socket.io-client`
- 构建：`esbuild`
- 类型检查：`tsc --noEmit`

### 2.2 复用判断

- 不手搓前端框架，不手搓实时协议层，不手搓构建器。
- 前端只做壳层体验态和协议消费，业务真相继续由 Rust application/domain 裁决。
- 该组合满足“纯 TS + 非臃肿 + 成熟生态复用 + 万人级实时链路优先”的约束。

## 3. 架构边界（重构后）

### 3.1 Rust 后端边界（保持）

- `domain/application/contract/store` 继续作为权威事实源。
- `http`：静态资源托管、健康检查、管理入口。
- `rt(socketioxide)`：业务命令与事件实时主通道。

### 3.2 TS 前端边界（新增）

- 只拥有壳层职责：意图表达、状态展示、草稿/pending/连接提示等体验态。
- 不承载权限真相、成员资格真相、消息成立真相。
- 只消费稳定 `contract`（snapshot/event/error_code），不发明后端之外第二真相。

### 3.3 实时/HTTP 分工红线

- 业务命令与事件：100% 实时通道。
- HTTP 不再承担业务 REST 主链。

## 4. 目录与模块设计

新增目录：`frontend/`

- `frontend/src/main.ts`：前端启动入口
- `frontend/src/app-shell.ts`：Lit 根组件
- `frontend/src/realtime/socket-client.ts`：socket.io-client 连接、重连、事件收发
- `frontend/src/contract/types.ts`：前端消费契约类型
- `frontend/src/state/chat-store.ts`：壳层体验态存储
- `frontend/src/views/*.ts`：会话列表/会话窗口/输入区等视图

产物输出：

- `dist/public/index.html`
- `dist/public/assets/app.js`
- 继续使用 `dist/public/assets/socket.io.min.js`

## 5. 构建与启动链路

### 5.1 新链路

1. `tsc --noEmit` 作为类型门禁。
2. `esbuild frontend/src/main.ts --bundle` 生成 `dist/public/assets/app.js`。
3. `index.html` 固定引入 `app.js` 与 `socket.io.min.js`。

### 5.2 Rust 启动守卫改造

- 将前端新鲜度检查从 Dioxus 输入链切换到 `frontend/src/**` 输入链。
- 启动前自动重建脚本改为 TS 打包脚本（替代 `dx-bundle-web.ps1`）。
- `run.ps1` 继续保持纯启动器，不复制业务构建判断。

## 6. 旧前端彻底移除清单（硬门禁）

以下项必须一次性清零，不允许留尾巴：

1. 删除 Dioxus Web 入口路径与 wasm 前端构建链。
2. 删除 Dioxus 前端相关脚本、配置、测试夹具与断言。
3. 从 `Cargo.toml` 移除前端专属 Dioxus 依赖（后端依赖不动）。
4. 清理 `Dioxus.toml` 与关联守卫逻辑。
5. CI/本地验证新增反回流检查：出现 `dx bundle` 或旧 wasm 前端引用即失败。

## 7. 验证门禁与 DoD

### 7.1 必跑门禁

- `cargo test --test app --test http --test rt`
- `tsc --noEmit`
- 前端构建产物校验（`app.js` 与 `index.html`）
- 集成冒烟：
  - 首页加载
  - Socket 连接成功
  - 进房成功
  - 发消息成功并收到 `message_created`

### 7.2 回归重点

- 重连与会话恢复
- `ack != message_created` 不回退
- 跨房间事件不串房
- pending 不冒充权威成立

### 7.3 完成定义（DoD）

全部满足才算完成：

1. 仓库内不存在旧前端可执行入口/构建路径。
2. 前端真相唯一：仅 `frontend/` + `dist/public` 产物链。
3. 业务命令/事件 100% 走实时通道。
4. `run.ps1` 启动后 UI 可用、实时链路可用。
5. 根因定位日志主键集保持完整可追踪。

## 8. 风险与治理

### 8.1 主要风险

1. 迁移初期事件映射错误导致“点击无响应”。
2. 旧断言/旧脚本残留导致假绿。
3. 前端壳层误吸业务真相导致边界退化。

### 8.2 控制策略

1. 先固定事件契约与命名，再做 UI 编排。
2. 反回流门禁前置，禁止旧链路残留。
3. 用例与集成测试同时覆盖“事件路径 + 体验态路径”。

## 9. 执行状态

- 方案状态：已确认
- 执行策略：Big Bang 一次性替换
- 迁移策略：允许破坏性调整，不保留双前端
