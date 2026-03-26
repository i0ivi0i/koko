# 纯 Rust 群聊项目架构设计

## 目标

构建一个前后端解耦、纯 Rust、可高性能演进的群聊系统。

核心目标：

- 前端可以长期替换和演进，而不破坏后端。
- 后端可以替换具体框架和基础设施，而不破坏领域规则。
- Win11 上可以一键顺畅开发。
- Linux 服务器上可以一键优雅部署、升级、回滚。
- 第一版只做文本群聊，但后续媒体、推送、搜索、私聊等能力可平滑扩展。

## 业务约束

- 房间模型偏 QQ 群思维。
- 房间短码格式固定为 `4 个数字 + 1 个英文字母`，字母位置可变。
- 房间短码全局唯一，永久不可复用。
- 用户输入短码时：
  - 若房间存在，则进入已有房间。
  - 若房间不存在，则自动创建房间。
- 第一个进入并创建该房间的用户自动成为群主。
- 当前用户身份为匿名本地身份：
  - 客户端本地生成并持久化。
  - 同设备可认作同一身份。
  - 换设备视为新身份。
- 角色体系固定为：
  - 群主
  - 管理员
  - 成员
- 群主长期失联后，允许按规则接管。
- 第一版只做群聊，但架构上预留私聊。

## 架构原则

本项目采用以下组合思路：

- Domain-first
- Contract-first
- Hexagonal Architecture
- Clean boundaries

设计原则如下：

- 前端只依赖稳定契约，不依赖后端内部实现。
- 后端业务规则只存在于领域层，不散落在接口层或数据库层。
- WebSocket、数据库、框架、缓存都只是基础设施实现。
- 浏览器只是当前宿主，不是系统核心。
- 性能优化只能污染基础设施层，不能污染领域边界。

## 总体技术选型

### 前端

- `Dioxus`

理由：

- 纯 Rust。
- Win11 开发顺手。
- 当前适合 Web 起步。
- 后期迁移 iOS/Android 时，能较高复用契约与业务层思路。

### 后端

- `axum`
- `tokio`

理由：

- Rust 生态成熟。
- 适合做清晰分层。
- 对 WebSocket、HTTP、中间件、异步任务支持良好。

### 数据存储

- `PostgreSQL`
- `sqlx`

约束：

- 当前优先标准 PostgreSQL。
- 架构上为未来接入 Supabase Postgres 做准备。
- 不将业务强绑定到 Supabase 特有能力。

### 基础库

- `serde`
- `uuid`
- `time`
- `thiserror`
- `anyhow`
- `tracing`
- `tracing-subscriber`

## 目录结构

前期采用根目录平铺，避免过度设计：

- `web`
- `server`
- `contracts`
- `domain`
- `platform`

## 目录职责

### `web`

前端入口。

负责：

- 页面
- 组件
- 路由
- UI 状态
- 调用后端契约

不负责：

- 领域规则
- 数据库存取
- 协议细节

### `server`

后端入口。

负责：

- HTTP 路由
- WebSocket 路由
- 请求组装
- 服务启动
- 依赖装配

不负责：

- 核心业务规则
- SQL 细节

### `contracts`

前后端稳定边界。

负责：

- DTO
- 事件结构
- 错误码
- 请求/响应模型

约束：

- 不依赖 `web`
- 不依赖 `server`
- 不依赖 `platform`

### `domain`

系统核心。

负责：

- 领域模型
- 用例
- 规则
- 抽象 port

约束：

- 不依赖 `axum`
- 不依赖 `sqlx`
- 不依赖 `Dioxus`

### `platform`

基础设施实现层。

负责：

- PostgreSQL 持久化
- WebSocket 实现
- 配置
- 日志
- 时间、ID、外部资源对接

## 依赖规则

- `web` 只能依赖 `contracts`
- `server` 可以依赖 `contracts`、`domain`、`platform`
- `domain` 只能依赖少量通用库
- `platform` 可以依赖 `domain`
- `contracts` 不依赖其他本项目模块

核心原则：

- 前端不直接依赖领域层
- 领域层不依赖框架层
- 基础设施不能反向决定业务规则

## 前端分层

Web 第一版前端内部建议分为：

- `pages`
- `components`
- `features`
- `application`
- `platform`

职责：

- `pages`：页面装配与路由
- `components`：纯展示组件
- `features`：按业务模块组合 UI
- `application`：前端用例、状态协调
- `platform`：HTTP、WebSocket、本地存储、浏览器适配

规则：

- 页面不写业务规则
- 组件不直接发请求
- 浏览器能力全部封到前端 `platform`

## 后端分层

后端第一版采用：

- `api`
- `application`
- `domain`
- `platform`

职责：

- `api`：参数解析、路由、输入输出映射
- `application`：用例编排
- `domain`：规则与模型
- `platform`：数据库、实时连接、配置、日志

规则：

- `api` 不写业务规则
- `application` 不直接写 SQL
- `domain` 不依赖框架

## 核心领域模型

- `Session`
- `Profile`
- `RoomCode`
- `Room`
- `RoomMember`
- `Role`
- `Message`
- `MuteState`
- `GovernanceRule`

关键领域行为：

- `JoinOrCreateRoom`

关键约束：

- `RoomCode` 一经绑定永不回收
- 首次创建房间者成为 `Owner`
- 群主失联时可按规则转移所有权

## 第一版核心用例

- `bootstrap_session`
- `resolve_room_code`
- `join_or_create_room`
- `load_room`
- `load_room_messages`
- `send_text_message`
- `list_room_members`
- `promote_admin`
- `demote_admin`
- `mute_member`
- `remove_member`
- `transfer_ownership_if_needed`

## 最小接口契约

### HTTP

- `POST /session/bootstrap`
- `POST /rooms/resolve`
- `POST /rooms/join-or-create`
- `GET /rooms/{room_id}`
- `GET /rooms/{room_id}/members`
- `GET /rooms/{room_id}/messages`
- `POST /rooms/{room_id}/messages`
- `POST /rooms/{room_id}/roles/promote`
- `POST /rooms/{room_id}/roles/demote`
- `POST /rooms/{room_id}/members/{member_id}/mute`
- `POST /rooms/{room_id}/members/{member_id}/remove`

### 实时事件

- `session_ready`
- `room_joined`
- `message_created`
- `member_joined`
- `member_left`
- `member_muted`
- `role_changed`
- `room_state_changed`
- `ownership_transferred`

原则：

- 前端永远只认这些业务事件
- 不暴露底层传输或数据库语义

## 数据库最小表设计

- `sessions`
- `profiles`
- `rooms`
- `room_codes`
- `room_members`
- `messages`
- `room_governance_logs`

关键约束：

- `room_codes.code` 唯一
- `room_codes` 永不复用
- `room_members(room_id, profile_id)` 唯一
- `messages` 需支持按 `room_id + created_at` 高效分页
- 权限变更必须记录审计日志

## 消息与实时模型

第一版消息只支持文本。

消息字段：

- `message_id`
- `room_id`
- `sender_id`
- `content`
- `created_at`

实时设计原则：

- 数据库存消息真相
- 实时通道只负责分发
- 断线重连后通过 HTTP 拉历史补齐

## 扩展位

以下能力第一版不实现，但必须预留接口位：

- `MediaPort`
- `NotificationPort`
- `PresencePort`
- `SearchPort`
- `ModerationPort`
- `AuditPort`
- `InvitePort`
- `SyncPort`
- `ProfilePort`
- `DiscoveryPort`
- `StoragePort`
- `RealtimePort`

## 第一版范围

### 纳入

- 匿名本地身份
- 房间短码输入
- 不存在则建房，存在则入房
- 文本消息收发
- 消息历史
- 成员列表
- 群主 / 管理员 / 成员
- 管理员提升/降级
- 移除成员
- 禁言
- 群主失联接管
- Web 端可用
- Win11 一键开发
- Linux 一键部署

### 不纳入

- 图片
- 文件
- 语音
- 视频
- 私聊
- 搜索
- 推送
- 多端复杂同步
- 审计后台

## 性能设计原则

本项目追求 Rust 高性能，但不为性能牺牲结构。

原则如下：

- 热点路径尽量少拷贝
- 不把“零拷贝”当教条
- 写消息先落库，再广播
- 房间是天然分片键
- 历史消息走分页，不走全量加载
- 高频状态先轻量实现，后期再专项提速
- 性能优化集中在基础设施层

### 预期热点

- `join_or_create_room`
- `send_text_message`
- `load_room_messages`
- 房间级广播 fan-out
- 长连接管理
- 权限状态一致性

### 性能约束

- 短码唯一性依赖数据库约束，不依赖内存判断
- WebSocket 连接层尽量轻状态
- 连接管理与业务规则分离
- 查询优先使用索引和游标分页

## Win11 开发方案

目标是“一键启动、即时反馈”。

开发入口：

- `run.ps1`

能力：

- 一键启动前端热更新
- 一键启动后端热更新
- 一键检查数据库连接与 migration
- 集中查看日志

建议工具：

- `cargo-watch`
- `sqlx-cli`
- `run.ps1`

可后补：

- `just`

## Linux 部署方案

目标是“一键构建、一键发布、一键升级、一键回滚”。

运行方式：

- `server` 使用 `systemd`
- `web` 构建为静态资源，由 `Caddy` 或 `Nginx` 提供
- `PostgreSQL` 独立运行

运维动作：

- 一键构建
- 一键发布
- 一键迁移
- 一键重启
- 一键回滚
- 一键升级

### 一键升级要求

升级流程应包含：

1. 获取指定版本
2. 构建新版本
3. 执行 migration
4. 切换静态资源
5. 重启服务
6. 健康检查
7. 失败自动回滚

## 最终结论

这是一个面向长期演进的纯 Rust 群聊架构。

它不把任何具体框架当核心，而是把以下内容固定为系统骨架：

- 领域模型
- 用例
- 稳定契约
- 清晰边界

最终结果应当是：

- 前端未来可替换
- 后端未来可演进
- 高性能 Rust 轮子可持续接入
- Win11 开发体验与 Linux 部署体验都保持优雅
