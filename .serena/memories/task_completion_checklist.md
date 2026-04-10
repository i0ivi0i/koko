# 完成任务前检查
- 先根据改动范围运行能直接证明结论的命令；至少优先考虑：`cargo test`、`pnpm --dir frontend test`、`pnpm --dir frontend typecheck`。
- 若改动触及启动器或脚本语义，补跑对应 PowerShell 检查，例如 `tests/启动器脚本检查.ps1` 相关路径。
- 若改动代码文件且使用了 graphify 约束，需要运行：`python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`。
- 结束前执行 `git status --short`，清掉自己造成的格式化/换行/导入顺序噪音。
- 按仓库规则，验证通过后默认需要 `git commit`，且提交信息必须是中文。