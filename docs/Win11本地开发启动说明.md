# Win11 本地开发启动说明

## 前置条件

- 已安装 Rust 工具链
- 已安装 `just`
- 本机 PostgreSQL 正在运行
- 项目根目录存在 `.env.local`

可选但推荐：

- 安装 `sccache` 作为开发态编译缓存

如果未安装 `just`：

```bash
cargo install just
```

如果要启用编译缓存：

```bash
cargo install sccache
```

## 本地配置

`.env.local` 示例：

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/koko_local
KOKO_API_BASE=http://127.0.0.1:3000
# 可选，不写时开发模式默认使用 info,tower_http=info,sqlx=warn
RUST_LOG=info,tower_http=info,sqlx=warn
```

开发环境实际只读取 `.env.local`。

## 命令模式

### 首次初始化

```bash
just init
```

会执行：

- 自动安装缺失的开发工具：
  - `sqlx`
  - `cargo-watch`
  - `dx`
- 自动创建数据库
- 自动执行 migration

### 日常启动

```bash
just dev
```

会执行：

- 启动后端热更新
- 启动前端开发服务器
- 前端默认开启 Dioxus `hot-patch`
- 若本机已安装 `sccache`，会自动启用编译缓存
- 在当前终端聚合显示前后端日志
- 按 `Ctrl+C` 时自动停止前后端子进程

### 单独迁移

```bash
just migrate
```

### 运行检查

```bash
just check
just test
```

## 默认地址

- 后端：`http://127.0.0.1:3000`
- 前端：`http://127.0.0.1:8080`

## 当前约定

- 开发环境只使用 `.env.local`
- 生产环境不要依赖 `.env.local`
- 生产环境应改用系统环境变量或服务器 env file
- `just` 是开发入口
- `xtask` 负责环境读取、初始化和开发进程编排
- `sccache` 只用于开发态加速，不参与生产部署
