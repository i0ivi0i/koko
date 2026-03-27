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
winget install Mozilla.sccache
```

## 本地配置

`.env.local` 示例：

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/koko_local
KOKO_API_BASE=http://192.168.100.229:3000
SERVER_BIND=0.0.0.0:3000
WEB_BIND=0.0.0.0:8080
ADMIN_BIND=0.0.0.0:8081
# 可选，不写时开发模式默认使用 info,tower_http=info,sqlx=warn
RUST_LOG=info,tower_http=info,sqlx=warn
```

开发环境实际只读取 `.env.local`。

含义：

- `KOKO_API_BASE`
  前端编译时写入的后端地址。要给局域网其他设备访问时，这里应填你电脑的局域网 IP。
- `SERVER_BIND`
  后端监听地址。局域网联调建议用 `0.0.0.0:3000`。
- `WEB_BIND`
  前端开发服务器监听地址。局域网联调建议用 `0.0.0.0:8080`。
- `ADMIN_BIND`
  后台前端开发服务器监听地址。局域网联调建议用 `0.0.0.0:8081`。

## 命令模式

### 首次初始化

```bash
just init
```

会执行：

- 检查 `sqlx`、`cargo-watch`、`dx` 是否已安装
- 自动创建数据库
- 自动执行 migration

### 日常启动

```bash
just dev
```

会执行：

- 启动后端热更新
- 启动前端开发服务器
- 启动后台前端开发服务器
- 若本机已安装 `sccache`，会自动启用编译缓存
- 在当前终端聚合显示服务日志
- 按 `Ctrl+C` 时自动停止后端、前端、后台子进程

### 单独迁移

```bash
just migrate
```

### 运行检查

```bash
just check
just test
```

## 开发入口

- 本机前端：`http://127.0.0.1:8080`
- 局域网前端：`http://192.168.100.229:8080`
- 本机后台：`http://127.0.0.1:8081`
- 局域网后台：`http://192.168.100.229:8081`
- 本机后端：`http://127.0.0.1:3000`
- 局域网后端：`http://192.168.100.229:3000`

后台认证方式：

- 浏览器访问后台后，输入固定后台密码：`Ee123456789+`
- 后台请求仍然通过 HTTP Basic Auth 调用 `/admin/*`

如果你的局域网 IP 变化了，需要同步更新 `.env.local` 里的 `KOKO_API_BASE`。

如果局域网其他设备仍然打不开，请检查 Windows 防火墙是否拦截了 `3000`、`8080` 和 `8081` 端口。

## 当前约定

- 开发环境只使用 `.env.local`
- 生产环境不要依赖 `.env.local`
- 生产环境应改用系统环境变量或服务器 env file
- `just` 是开发入口
- `xtask` 负责环境读取、初始化和开发进程编排
- `sccache` 只用于开发态加速，不参与生产部署
