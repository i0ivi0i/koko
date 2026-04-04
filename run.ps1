# 设计原则：run.ps1 只允许做“Win11 下 Rust 开发启动器”，不承载任何业务、配置和参数翻译逻辑。
# 为什么这样做：
# 1) 唯一启动真相必须收口到 Rust（cargo xtask dev），避免 PowerShell 维护第二套语义。
# 2) 脚本越“聪明”，越容易把 bug 藏在壳层分支里，导致定位时分不清是 Rust 逻辑还是脚本逻辑出错。
# 3) 参数原样透传给 xtask，可确保 IDE、终端、CI 的入口行为一致，减少“某入口好、某入口坏”的漂移。
# 这么做的好处：
# - 故障定位路径更短：先看 Rust 主链路，不需要先排查脚本特判。
# - 回归面更小：脚本几乎无状态、无分支，修改风险显著降低。
# - 长期演进更稳：启动规范集中在 xtask，一个地方收口即可影响所有入口。
Set-Location $PSScriptRoot
& cargo xtask dev @args
exit $LASTEXITCODE
