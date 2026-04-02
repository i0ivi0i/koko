# xtask 开发入口与 run 脚本薄壳化设计

日期：2026-04-02

## 背景

当前仓库的 Windows 开发入口仍然以 `run.ps1` 为中心：

- 数据库准备在 PowerShell 中完成
- 前端 bundle 与后端构建在 PowerShell 中编排
- Rust 子进程启动方式、stdout 落盘和浏览器 auto-open 也由 PowerShell 主导

虽然上一轮已经把“首页地址 / 管理入口 / 管理员口令 / ready 真相”收回了 Rust，但开发期编排真相仍然分散在 PowerShell。这样会继续带来三个问题：

1. Windows 开发入口和未来 Linux 运行入口仍然不是同一种编排思维
2. PowerShell 继续充当开发主入口，长期会诱发第二份流程真相和实现细节漂移
3. 团队对外推荐的命令面不统一，未来很难自然演进到 `cargo` 驱动的开发、发布和部署链路

因此本次目标不是“删掉 `run.ps1`”，而是把它降级成 Windows 兼容薄壳，让开发编排主入口回到 Rust / Cargo。

## 目标

建立 `cargo xtask dev` 作为唯一推荐的开发期启动入口，并让 `run.ps1` 退化成只负责转发参数的 Windows 薄壳。

本次只解决开发期启动编排，不实现 Linux 一键安装 / 自启部署；但设计必须为未来 Linux 公网部署保持正确方向。

## 非目标

- 本次不实现 Linux 安装器、systemd unit 或一键部署脚本
- 本次不改 Rust 主程序的启动横幅与 ready 真相
- 本次不改变 `/admin` 认证、数据库模型或配置文件真相位置
- 本次不引入新的跨进程协议、守护进程或本地服务管理器

## 核心原则

### 1. 开发编排主入口回到 Cargo / Rust

Windows 开发期真正推荐给人的入口必须是：

```text
cargo xtask dev
```

原因：

- `cargo` 是 Rust 项目天然命令面
- `xtask` 可以把项目自动化写成 Rust，而不是继续扩大脚本职责
- 未来无论扩展 `dev`、`check`、`dist`、`install-linux` 还是别的子命令，都可以沿同一条命令面演进

`run.ps1` 可以继续存在，但它只能成为：

- Windows 用户的便捷入口
- 旧习惯兼容层
- 对 `cargo xtask dev` 的参数转发器

而不能再是开发编排真相中心。

### 2. 服务真相仍然只在 Rust 主程序

这次新增 `xtask`，并不意味着把启动真相从 `run.ps1` 挪到 `xtask`。

三层边界必须明确：

- Rust 主程序：服务真相
- `xtask`：开发编排
- `run.ps1`：Windows 壳层转发

其中服务真相依旧只允许 Rust 主程序持有，包括：

- 首页地址
- 管理入口
- 当前管理员口令
- ready 时机
- 启动横幅与 tracing 技术日志

`xtask` 与 `run.ps1` 都只能消费 Rust 输出，不能重新推导或复制这些语义。

### 3. Linux 未来部署是架构约束，不是当前实现范围

未来项目会部署在 Linux 公网服务器上，因此今天的开发入口设计不能把系统绑死在 PowerShell。

这意味着：

- 开发编排尽量写在 Rust 中
- 命令面尽量走 `cargo`
- `run.ps1` 不持有 Linux 不可复用的核心语义

但本轮实现只把这种未来约束体现在边界设计里，不提前落 installer / systemd / 包分发。

### 4. 优先复用 Cargo 原生扩展机制，不再发明私有任务层

本次优先采用 Cargo 生态已成熟的模式：

- 新建 `xtask` crate
- 修改现有 `.cargo/config.toml` 的 `[alias]` 暴露 `cargo xtask`

不优先引入额外任务 DSL，也不继续扩大 PowerShell 编排。

## 方案比较

### 方案 A：`cargo xtask dev` 接管开发编排，`run.ps1` 仅做薄壳转发

优点：

- Rust / Cargo 成为唯一开发入口真相
- 与未来 Linux 路径一致
- `run.ps1` 维护成本最低

缺点：

- 需要新增 `xtask` crate 和少量命令转发测试

### 方案 B：继续以 `run.ps1` 为主入口，只把内部逻辑搬到 Rust 库函数

优点：

- 短期改动较小

缺点：

- PowerShell 仍是第一入口
- 边界长期仍然容易退化

### 方案 C：改用 `cargo-make` 一类任务系统

优点：

- 现成轮子成熟

缺点：

- 新增额外 DSL 和工具心智负担
- 对当前仓库来说不如 `xtask` 直接、贴边

本次选择方案 A。

## 目标架构

### 0. 先解决 `.rs` 文件总数约束

仓库当前非测试用途 `.rs` 文件正好是 13 个，因此不能直接新增 `xtask/src/main.rs` 就当作没有代价。

本轮在引入 `xtask` 前，必须先完成一个低风险收口：

- 将 `src/view.rs` 收口进 `src/web.rs`

原因：

- `view` 与 `web` 同属 Web 壳层，职责相邻，属于低风险整合
- 这不是无关重构，而是满足仓库 `.rs` 文件总数约束的必要前置动作
- 完成该收口后，再新增 `xtask/src/main.rs`，非测试 `.rs` 文件总数仍能维持在 13

### 1. 命令面

面向开发者的推荐入口统一为：

```text
cargo xtask dev
```

`run.ps1` 仍可保留，但行为应等价于：

```text
powershell -File run.ps1  =>  cargo xtask dev ...
```

也就是说，PowerShell 不再直接：

- 调 `psql`
- 调 `cargo build`
- 计算子进程二进制路径
- 管理 stdout tee / browser seam

这些编排动作都应交给 `xtask`。

### 2. 目录与模块

新增：

- `xtask/Cargo.toml`
- `xtask/src/main.rs`

修改：

- `Cargo.toml`
- `.cargo/config.toml`
- `run.ps1`
- `tests/http_flow.rs`
- `src/web.rs`
- `src/view.rs`（本轮会被收口并删除）

根 `Cargo.toml` 需要从“单包 manifest”升级为“根包 + workspace”共存形态，最小落地方式为：

- 保留现有 `[package]`
- 新增 `[workspace]`
- `members = ["xtask"]`

现有 `.cargo/config.toml` 不新建，只修改并保留已有 `jobs = 1` 稳定性设置；在此基础上追加别名，例如：

```toml
[alias]
xtask = "run -p xtask --"
```

如有必要，可新增一小组 `xtask` 测试文件；但要克制，避免把测试体系打散。

### 3. `xtask` 责任

`xtask dev` 应承担开发期编排动作：

- 校验依赖命令是否存在
- 准备数据库
- 可选执行前端 bundle
- 构建并启动 Rust 主程序
- 可选根据 Rust 首页行做浏览器 auto-open
- `--dry-run` 只预演编排动作

实现上优先把编排逻辑放进 `xtask` 内部的纯 Rust helper，再由 CLI 入口调用，这样测试不必继续污染正式用户参数面。

但它不承担：

- 输出首页地址、管理入口、管理员口令
- 判定服务 ready 真相
- 复制 Rust 启动横幅

### 4. `run.ps1` 责任

`run.ps1` 应退化成薄壳：

- 解析与现有用户习惯兼容的少量参数
- 调用 `cargo xtask dev`
- 透传退出码

它不再拥有自己的数据库准备逻辑、进程编排逻辑和测试 seam 逻辑。

如果后续保留 Windows 专属参数兼容，也必须只做“参数映射”，不能重新变成编排中心。

这意味着当前已经存在于 `run.ps1` 的测试专用 seam，后续都应迁出 PowerShell，而不是继续扩。

## 命令与参数设计

首轮只实现一个子命令：

```text
cargo xtask dev
```

参数面尽量与现有 `run.ps1` 保持平滑迁移：

- `--database-url`
- `--admin-token`
- `--bind-addr`
- `--skip-bundle`
- `--no-browser`
- `--dry-run`

设计要求：

- Rust 侧参数名保持清晰、稳定
- `run.ps1` 若继续保留 PowerShell 风格参数，也只做一一映射
- 不新增当前任务不需要的子命令和配置面

## 数据与控制流

### 正常启动

1. 用户执行 `cargo xtask dev`
2. `xtask` 校验 `cargo` / `psql` 等前置依赖
3. `xtask` 处理 bundle / database / build
4. `xtask` 启动主程序
5. 主程序自行输出启动横幅
6. `xtask` 仅在需要时从 stdout 中等待 Rust 首页地址行
7. 若拿到首页地址且未禁用浏览器，则执行 auto-open
8. 主程序退出后，`xtask` 透传退出码

### `run.ps1` 转发

1. 用户执行 `run.ps1`
2. PowerShell 只负责把参数转成 `cargo xtask dev` 调用
3. 标准输出 / 错误输出直接由 `cargo xtask dev` 与 Rust 主程序提供
4. PowerShell 透传退出码

## 测试策略

### 1. 先以 TDD 锁定 `xtask` 行为

最小测试应覆盖：

- `dev --dry-run` 只预演步骤，不伪造服务真相
- `dev` 能在假 toolchain 下完成数据库准备与子进程启动
- `dev` 的 auto-open 只消费 Rust 首页行
- 缺首页行只禁用 auto-open，不导致启动失败

这些测试的 seam 不再继续挂在 `run.ps1` 的公开参数上，而应采用二选一的克制方案：

- 方案一：把流程拆成可单测的 Rust helper，直接在单测里注入 fake runner / fake browser opener
- 方案二：保留少量 xtask 内部测试专用环境变量，仅在测试命令中设置，不暴露给正式 CLI 帮助

本次优先推荐方案一；如果为了快速迁移必须使用方案二，也只能限于 xtask 内部，不允许再把测试入口挂回 `run.ps1`。

### 2. `run.ps1` 测试收缩为薄壳断言

迁移后，`run.ps1` 测试重点只应剩下：

- 是否正确转发到 `cargo xtask dev`
- 是否透传参数
- 是否透传退出码

当前大量围绕 PowerShell 内部编排写的测试，应逐步迁移到 `xtask` 侧。

迁移完成后，`run.ps1` 测试不再关注：

- `psql` 调用细节
- `cargo build` 调用细节
- stdout tee 细节
- 浏览器打开等待逻辑

这些都应成为 `xtask` 的测试责任。

### 3. Rust 主程序边界测试继续保留

已有“启动真相只在 Rust”相关测试必须继续保留，防止 `xtask` 或 `run.ps1` 再次回声服务真相。

## 风险与约束

### 1. `.rs` 文件数量约束

仓库有“非测试用途 `.rs` 文件总数长期控制在 13 个以内”的约束，因此 `xtask` 必须保持极简：

- 优先单文件 `xtask/src/main.rs`
- 非必要不继续拆模块
- 必须以前置收口 `src/view.rs -> src/web.rs` 作为配额交换动作，不能先加了再说

### 2. Windows 与 Linux 行为漂移风险

如果 `run.ps1` 继续保留过多私有逻辑，未来 Linux 路径会再次分叉。

因此本次的真正成功标准不是“脚本还能跑”，而是：

- 开发主入口已切到 `cargo xtask dev`
- PowerShell 不再是编排真相中心

### 3. 迁移期兼容风险

现有开发者可能仍使用 `run.ps1`。因此迁移应允许：

- 短期保留 `run.ps1`
- 但其内部立即改成转发层
- 文档与帮助信息同步提示 `cargo xtask dev` 为首选入口

## 验收标准

本次设计落地后，应满足：

1. 开发者可以直接运行 `cargo xtask dev`
2. `run.ps1` 仍可用，但本质只是调用 `cargo xtask dev`
3. 根 `Cargo.toml` 已明确支持 workspace 中的 `xtask`
4. 现有 `.cargo/config.toml` 被保留并扩展 alias，而不是被覆盖重建
5. `src/view.rs` 已收口进 `src/web.rs`，新增 `xtask` 后非测试 `.rs` 总数仍不超过 13
6. 数据库准备、bundle、build、spawn 等开发编排动作已不再由 PowerShell 持有
7. 首页地址 / 管理入口 / 管理员口令 / ready 真相仍只由 Rust 主程序输出
8. auto-open 只消费 Rust 首页行
9. `--dry-run` 只预演准备动作，不伪造服务真相
10. 测试边界从 PowerShell 内部实现迁到 `xtask` 行为

## 结论

当前真正需要解决的是“Windows 开发 Rust 的优雅启动入口”，不是现在就实现 Linux 一键安装。

因此本次最正确的做法是：

- 用未来 Linux 部署规范约束今天的设计方向
- 但把当前实施严格收敛在 `cargo xtask dev + run.ps1 薄壳化`

这样既能立刻解决 Windows 开发入口不优雅的问题，也不会把未来 Linux 公网部署路线做歪。
