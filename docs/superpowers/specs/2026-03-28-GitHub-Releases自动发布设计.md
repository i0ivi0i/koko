# Koko GitHub Releases 自动发布设计

**目标**

让 `koko` 在打出版本标签后，自动构建并发布原生安装所需的 release 产物到 GitHub Releases，供现有 [install.sh](D:/100-工作/200-交易/量化交易/koko/install.sh) 下载和安装。

## 设计原则

- 不改业务内核，只补发布壳层
- 发布产物必须稳定、可预测、可直接被安装脚本消费
- 不现场编译源码到服务器
- 不引入 Docker
- 不把前台、后台、迁移、后端二进制打成一个大包

## 发布触发方式

第一版采用：

- GitHub Actions
- 触发条件：`push tags v*`

例如：

- `v0.1.0`
- `v0.2.3`

## Release 产物规范

每次发布上传 4 个资产：

1. `koko-server-linux-x86_64.tar.gz`
   - 内容：
     - `koko-server`

2. `koko-web.tar.gz`
   - 内容：
     - `index.html`
     - `assets/`
     - Dioxus web 构建产物

3. `koko-admin.tar.gz`
   - 内容：
     - 后台前端静态产物

4. `koko-migrations.tar.gz`
   - 内容：
     - `migrations/*.sql`

这些名字必须和 [install.sh](D:/100-工作/200-交易/量化交易/koko/install.sh) 里当前下载逻辑保持一致。

## 构建策略

### 后端

使用：

- `cargo build --release -p koko-server`

输出：

- `target/release/koko-server`

### 聊天前台

使用 Dioxus 官方 CLI：

- `dx build --platform web --release --package koko-web`

发布层直接采用 Dioxus 默认 release 产物目录：

- `target/dx/koko-web/release/web/public`

### 后台前端

同样使用：

- `dx build --platform web --release --package koko-admin`

后台静态产物目录为：

- `target/dx/koko-admin/release/web/public`

### 迁移

直接打包现有：

- [migrations](D:/100-工作/200-交易/量化交易/koko/migrations)

## 推荐仓库变更

第一版建议增加这些非业务文件：

- `.github/workflows/release.yml`
- `package-release.ps1`

职责：

- `release.yml`
  - 安装 Rust
  - 安装 Dioxus CLI
  - 构建 server/web/admin
  - 调用打包脚本
  - 创建并上传 Release 资产

- `package-release.ps1`
  - 统一打包四类产物
  - 让本地和 CI 复用同一套打包逻辑

## GitHub Actions 责任边界

工作流只负责：

- 构建
- 打包
- 上传 release 资产

工作流不负责：

- 部署到 VPS
- 修改服务器配置
- 安装 PostgreSQL/Caddy

这些继续由现有安装脚本和未来运维步骤负责。

## 与 install.sh 的关系

当前 [install.sh](D:/100-工作/200-交易/量化交易/koko/install.sh) 已经依赖：

- `koko-server-linux-x86_64.tar.gz`
- `koko-web.tar.gz`
- `koko-admin.tar.gz`
- `koko-migrations.tar.gz`

所以自动发布层的核心任务不是重新设计安装器，而是保证：

- GitHub Releases 上稳定产出这 4 个资产
- 命名不漂移
- 目录结构不漂移

## 验证策略

第一版最小验证：

- 本地能跑打包脚本
- GitHub Actions workflow 语法正确
- 产物文件名符合 `install.sh`
- release 工作流只在 `v*` 标签触发

第二阶段再补：

- 草稿发布验证
- 端到端 VPS 安装验证

## 当前范围

这轮只做：

- 自动发布工作流
- 本地/CI 共用打包脚本

这轮不做：

- 多架构发布
- `.deb` 打包
- 自动回滚发布
- 自动部署到服务器
