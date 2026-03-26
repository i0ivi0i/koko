# Win11 本地开发启动说明

## 前置条件

- 已安装 Rust 工具链
- 本机 PostgreSQL 正在运行
- 项目根目录存在 `.env.local`

## 本地配置

`.env.local` 示例：

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/koko_local
KOKO_API_BASE=http://127.0.0.1:3000
```

开发环境实际只读取 `.env.local`。

## 命令模式

### 首次初始化

```powershell
.\run.ps1 -Init
```

会执行：

- 自动安装缺失的开发工具：
  - `sqlx`
  - `cargo-watch`
  - `dx`
- 自动创建数据库
- 自动执行 migration

### 日常启动

```powershell
.\run.ps1
```

会执行：

- 启动后端热更新
- 启动前端开发服务器
- 在当前终端聚合显示前后端日志
- 按 `Ctrl+C` 时自动停止前后端子进程

### 单独迁移

```powershell
.\run.ps1 -Migrate
```

如果 PowerShell 执行策略拦截：

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

## 默认地址

- 后端：`http://127.0.0.1:3000`
- 前端：`http://127.0.0.1:8080`

## 当前约定

- 开发环境只使用 `.env.local`
- 生产环境不要依赖 `.env.local`
- 生产环境应改用系统环境变量或服务器 env file
- `run.ps1` 默认是开发启动器，不再承担每次初始化职责
