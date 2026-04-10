# 常用命令
## Windows / PowerShell
- 查看目录：`Get-ChildItem -Force`
- 查看文件：`Get-Content <path>`
- 全局搜索：`rg -n "pattern" .`
- Git 状态：`git status --short`

## 后端 / Rust
- 运行后端测试：`cargo test`
- 运行指定测试：`cargo test --test 集成测试`
- 格式化：`cargo fmt`
- 静态检查：`cargo clippy --all-targets --all-features -- -D warnings`
- 直接运行后端：`cargo run`

## 前端 / TypeScript
- 安装依赖：`pnpm --dir frontend install`
- 运行测试：`pnpm --dir frontend test`
- 运行单测文件：`pnpm --dir frontend test -- tests/图片收发测试.spec.ts`
- 类型检查：`pnpm --dir frontend typecheck`
- 构建：`pnpm --dir frontend build`
- 增量构建：`pnpm --dir frontend run dev:watch:supervised`

## 项目启动器
- 正常开发启动：`powershell -ExecutionPolicy Bypass -File .\run.ps1`
- 显式升级依赖后再启动：`powershell -ExecutionPolicy Bypass -File .\up.ps1`

## Serena 备注
- `.serena/project.yml` 已配置为 `rust + typescript`。
- 如果 Serena 仍只显示 TypeScript 语言，请新开一个 Codex 会话，让 Serena 重新加载项目配置。