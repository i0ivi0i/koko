# Koko 会话连续性说明

如果你是后续进入这个仓库的 Codex，请先读 `AGENTS.md` 和本文件，再开始工作。

## 仓库迁移

- 原路径：`D:\100-工作\200-交易\量化交易\koko`
- 目标路径：`C:\Users\home\koko`
- 如果你发现当前仓库已经不在原路径，这是预期，不是异常。

## 当前基线

- 本文件写入时的提交：`cbc95e8ac6a5af6a23ed33386d66a0bc48f57ea4`
- 本轮工作已经提交，提交信息：`修复: 收回房间身份边界并移除公开解析接口`

## 主人明确要求

- `Koko` 是纯 Rust 群聊系统，但不要重复造轮子。
- 优先站在现有成熟项目肩膀上，尤其参考 `学习/` 目录中的实现与架构智慧。
- 业务语义自己掌握，通用基础设施优先复用成熟轮子。
- 默认中文沟通、中文说明、中文提交信息。

## 已吸收的参考智慧

### `学习/socketioxide`

- 连接先过认证/会话恢复，再进入实时房间。
- realtime 负责连接和 fan-out，不负责业务真相。
- 典型参考：`学习/socketioxide/examples/private-messaging`

### `学习/continuwuity`

- 房间不是一张表，而是一组职责拆开的子系统。
- `membership/state_cache/timeline/event_handler` 这类边界很清楚。
- 房间访问关系和可见性应该当成一等结构来维护。

### `学习/tuwunel`

- `membership` 应独立成层，不要散在 handler 和字符串判断里。
- 正确性要写进结构，而不是写进“调用者自觉”。

## 最近已经完成的修复

### 1. 收回身份边界

- 公共 HTTP/WS 接口不再信前端自己上报的 `profile_id / sender_id / actor_profile_id`
- 后端统一从 `session` 恢复身份
- 相关文件：
  - `server/src/http.rs`
  - `server/src/ws.rs`
  - `server/src/session.rs`
  - `web/src/client.rs`
  - `web/src/app.rs`
  - `contract/src/lib.rs`

### 2. 补齐房间读取权限

- `get_room`
- `list_room_messages`
- `list_room_members`

这些读取接口现在要求调用者必须是房间成员，不能再匿名探测。

### 3. 删除公开 `resolve_room`

- 公开 `POST /rooms/resolve` 已删除
- 不再向前端泄漏“房间码是否存在、对应哪个 `room_id`”
- 这是按成熟 IM 的边界原则做的删除，不是缺功能

### 4. 修正治理语义错误

- 之前治理链路里，`actor` 不在房间内会被错判成 `target` 不存在
- 已在 `core/src/room.rs` 修正
- 已有回归测试 `core/tests/room_governance.rs`

## 当前契约状态

- HTTP 使用请求头：`x-koko-session-id`
- WS 使用查询参数：`session_id`
- 公共请求体里不再放调用者身份字段

## 已验证

写本文件前，以下命令都已通过：

```powershell
cargo test -p koko-contract
cargo test -p koko-web
cargo test -p koko-core --test room_governance
$env:DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/koko_local'; cargo test -p koko-server --tests
```

## 下一步最值得继续做的事

把房间访问控制从 handler 里继续上提，做一个轻量的 `RoomAccess` / `Membership` 层，至少明确：

- 谁能读房间
- 谁能发消息
- 谁能治理成员
- 哪些规则属于 realtime，哪些规则属于领域真相

目标不是做大，而是把边界继续拉直。

## 恢复工作时的建议顺序

1. 先确认仓库已从旧路径移动到新路径。
2. 先读 `AGENTS.md`。
3. 再读本文件。
4. 再看最近提交：`git log -5 --oneline`
5. 再决定下一步，不要直接开改。

## 额外提醒

- 如果将来发现仓库里还残留旧绝对路径 `D:\100-工作\200-交易\量化交易\koko`，应优先清理。
- 不要把 `Matrix` 的完整复杂度搬进来；学它们的拆分和 correctness discipline，不是复刻它们全部协议栈。
