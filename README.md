# Koko

`Koko` 是一个纯 Rust 的群聊 / IM 项目，目标不是一次性做完一个聊天应用，而是打出一套**可长期演进、可开源复用、前后台共用一个业务内核**的 Rust IM 基础。

当前仓库已经具备这些核心部分：

- 聊天前台：`web`
- 独立后台前端：`admin`
- 后端服务：`server`
- 共享契约：`contract`
- 业务内核：`core`
- 开发工具壳：`xtask`

## 核心原则

- 前台和后台都只是壳，业务内核只有一套
- 能复用成熟轮子就不重复造轮子
- 技术栈可以迭代，业务语义不能分叉
- 新功能先判断属于 `core / contract / adapter / shell` 哪一层

## 当前能力

- 房间短码入房 / 建房
- 文本消息发送
- WebSocket 实时广播
- 成员治理：
  - 提升管理员
  - 降级管理员
  - 禁言
  - 移除
- 后台管理：
  - 概览统计
  - 全局消息长度策略
  - 房间临时封禁 / 解封

## 项目结构

```text
admin/       后台前端壳（Dioxus Web）
contract/    前后端共享 DTO / 事件契约
core/        业务内核与领域规则
deploy/      部署模板（Caddy / systemd）
docs/        设计文档与实现计划
migrations/  PostgreSQL 迁移脚本
server/      后端服务（axum + sqlx）
web/         聊天前台（Dioxus Web）
xtask/       开发期任务编排
install.sh   Linux 一键安装入口
package-release.ps1  发布打包脚本
```

## 本地开发

环境要求：

- Rust stable
- PostgreSQL
- Dioxus CLI

常用命令：

```bash
just init
just dev
just check
just test
```

Win11 本地开发说明见：

- [Win11本地开发启动说明](docs/Win11本地开发启动说明.md)

## 一键安装

当前提供 Ubuntu / Debian 的原生一键安装入口：

```bash
curl -fsSL https://raw.githubusercontent.com/i0ivi0i/koko/main/install.sh | sudo bash
```

安装脚本会自动：

- 安装 `PostgreSQL`
- 安装 `Caddy`
- 下载 GitHub Release 产物
- 创建数据库和数据库用户
- 执行 `migrations/`
- 写入 `systemd` 服务
- 启动 `koko-server`

安装时脚本会交互询问：

- 聊天入口（域名或公网 IPv4）
- 后台密码（可留空自动生成）

访问规则：

- 如果输入的是域名：
  - 聊天前台：`https://你的域名`
  - 后台前端：`https://admin.你的域名`
- 如果输入的是公网 IPv4：
  - 聊天前台：`http://你的IPv4`
  - 后台前端：`http://你的IPv4:8081`

后台默认用户名：

- 用户名：`admin`
- 密码：安装时设置；如果留空，脚本会自动生成一次强密码并在安装完成时显示一次

安装后可在这里修改：

- `/etc/koko/koko.env`

## Release

当前首个版本：

- [v0.1.0](https://github.com/i0ivi0i/koko/releases/tag/v0.1.0)

Release 产物包含：

- `koko-server-linux-x86_64.tar.gz`
- `koko-web.tar.gz`
- `koko-admin.tar.gz`
- `koko-migrations.tar.gz`

## 后台管理

后台前端和聊天前台是两套壳，但共用同一个业务内核。

后台接口当前走 HTTP Basic Auth，服务端入口在：

- [server/src/app.rs](server/src/app.rs)
- [server/src/http.rs](server/src/http.rs)

## 设计文档

关键文档：

- [纯Rust群聊项目架构设计](docs/superpowers/specs/2026-03-26-纯Rust群聊项目架构设计.md)
- [原生一键安装部署设计](docs/superpowers/specs/2026-03-28-原生一键安装部署设计.md)
- [GitHub Releases自动发布设计](docs/superpowers/specs/2026-03-28-GitHub-Releases自动发布设计.md)

## 说明

这个项目现在已经能开发、打包、发布，也已经有第一版原生安装骨架。  
但如果你要把它直接放到公网长期运营，仍然建议先在一台干净的 Ubuntu / Debian VPS 上做一次完整安装验收。
