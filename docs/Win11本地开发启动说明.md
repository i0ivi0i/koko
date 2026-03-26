# Win11 本地开发启动说明

## 前置条件

- 已安装 Rust 工具链
- 本机 PostgreSQL 正在运行
- 项目根目录存在 `.env.local`

## 本地配置

参考根目录 [`.env.example`](D:\100-工作\200-交易\量化交易\koko\.env.example)：

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/koko_local
KOKO_API_BASE=http://127.0.0.1:3000
```

开发环境实际只读取：

- `.env.local`

## 一键启动

在项目根目录执行：

```powershell
.\run.ps1
```

如果 PowerShell 执行策略拦截：

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

`run.ps1` 会自动执行：

- 检查 `DATABASE_URL`
- 自动安装缺失的开发工具：
  - `sqlx`
  - `cargo-watch`
  - `dx`
- 自动创建数据库
- 自动执行 migration
- 启动后端热更新
- 启动前端开发服务器

## 默认地址

- 后端：`http://127.0.0.1:3000`
- 前端：`http://127.0.0.1:8080`

## 当前约定

- 开发环境只使用 `.env.local`
- 生产环境不要依赖 `.env.local`
- 生产环境应改用系统环境变量或服务器 env file
