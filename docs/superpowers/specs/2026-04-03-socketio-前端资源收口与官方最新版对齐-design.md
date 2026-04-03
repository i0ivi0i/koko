# socket.io 前端资源收口与官方最新版对齐设计

日期：2026-04-03

## 背景

当前仓库的 Web 实时通道已经建立在 Rust 侧的 `socketioxide` 上，但浏览器侧 `socket.io` 客户端接入还存在三处不优雅的事实分叉：

- 源资源目录使用根目录 `assets/`
- 运行时静态资源默认读取 `dist/public/assets`
- 浏览器侧在 [src/web.rs](/E:/koko/src/web.rs) 中通过 `dynamic import("/assets/socket.io.esm.min.js")` 直接加载 ESM 文件

这会带来三个具体问题：

1. `socket.io` 客户端资源并未完全沿着 Dioxus 资源主路径被清晰管理，测试、开发、运行时容易说不同的话
2. 当前接入方式不是 Socket.IO 4.x 官方浏览器主推荐路径，长期升级成本和认知成本都偏高
3. 如果继续围绕这套 `eval + dynamic import + 私有桥接` 叠逻辑，很容易把外围胶水长成 repo 私有 runtime，偏离“不能重造轮子、不能手搓成熟轮子”的项目原则

因此这次目标不是重做实时协议，也不是改掉 `socketioxide`，而是把浏览器侧 `socket.io` 客户端接入收口到**官方最新版、官方主路径、纯 Rust 工程可接受、目录更克制**的状态。

## 目标

本次只解决 `socket.io` 浏览器客户端资源与接入路径的问题：

- 使用 **Socket.IO 官方最新版浏览器生产 bundle**
- 不引入 `npm/pnpm` 等新的前端工具链
- 不手搓新的 `socket.io` 包装层、资源复制层或私有前端 runtime
- 让源资源、构建产物、测试验证围绕同一套静态资源真相收口
- 在必要位置补上克制但有价值的中文注释，说明边界与原因

## 非目标

- 本次不升级 Rust 侧其他依赖
- 本次不改 `socketioxide` 服务端整体架构
- 本次不把实时桥接整体重写成新的前端抽象层
- 本次不引入 npm、pnpm、vite、webpack 或额外 JS 包管理
- 本次不为“目录更少”而扭曲 Dioxus / Cargo 的正常产物结构

## 外部依据

### 1. Socket.IO 官方浏览器分发主路径

根据 Socket.IO 4.x 官方安装文档，浏览器直接使用时主推荐产物是：

- `socket.io.js`：开发版
- `socket.io.min.js`：生产版
- `socket.io.msgpack.min.js`：生产版 + msgpack parser

当前官方文档更新时间为 **2026-02-16**，结合官方 CDN 目录，到 **2026-04-03** 可见的 4.x 最新版本是 **4.8.3**。

因此本次浏览器侧目标资源固定为：

```text
socket.io.min.js@4.8.3
```

### 2. Dioxus 官方资源管理路径

Dioxus 官方在 [Configure Project](https://dioxuslabs.com/learn/0.7/guides/tools/configure/) 中提供了：

- `[web.resource].script`
- `[web.resource.dev].script`

用于把 JavaScript 资源直接纳入页面入口。官方示例明确使用相对 `Cargo.toml` 的路径，例如：

```toml
[web.resource]
script = ["./public/index.js"]
```

这说明对“必须先于 wasm bootstrap 出现在页面里的第三方脚本”，官方正路是**入口资源配置层**，不是把 `<script>` 临时塞进组件树里碰时序。

### 3. 项目法约束

根据 [AGENTS.md](/E:/koko/AGENTS.md)：

- 不允许重复造轮子、手搓成熟轮子
- 优先复用成熟生态
- 前后端、开发与运行时要围绕同一份真相收口
- 代码应有清晰中文注释，解释边界和为什么这样做

## 方案比较

### 方案 A：保留纯 Rust 工程，vendor 官方 `socket.io.min.js`

做法：

- 在仓库 `assets/` 中保留一份官方最新版 `socket.io.min.js`
- 通过 [Dioxus.toml](/E:/koko/Dioxus.toml) 的 `[web.resource].script` 把它接入页面入口
- 浏览器通过全局 `io` 接入
- 运行时仍由现有 Dioxus/Axum 静态资源链路提供

优点：

- 不引入 JS 工具链
- 完全站在官方客户端 bundle 路径上
- 完全复用 Dioxus 官方入口资源能力
- 目录增长最少
- 版本、来源、升级点清晰可控

缺点：

- 升级 `socket.io` 客户端版本时需要手动替换 vendor 文件

### 方案 B：CDN 外链 `socket.io.min.js`

优点：

- 仓库更少一个 vendor 文件

缺点：

- 运行时依赖公网
- 本地开发、内网环境、部署稳定性都会变差
- 和当前“本地可控优先”的项目方向相悖

### 方案 C：引入 `npm/pnpm` + `socket.io-client`

优点：

- 走前端世界最主流的依赖管理方式

缺点：

- 会把当前纯 Rust 工程拉入新工具链
- 目录、缓存、命令面、维护面明显增厚
- 对当前需求来说收益不够大

本次选择 **方案 A**。

## 核心原则

### 1. 不重造轮子，只消费官方客户端产物

本次不允许：

- 手搓 `socket.io` 浏览器客户端协议实现
- 手搓 `socket.io` 的最小兼容封装
- 自己写“复制到 dist 的资源同步脚本”
- 再包一层 repo 私有 JS runtime，只为了绕开官方浏览器 bundle

可接受的唯一方向是：

- 直接使用 Socket.IO 官方浏览器生产 bundle
- 直接使用 Dioxus 官方入口资源机制把它放进页面
- Rust 项目只负责把它当普通静态资源稳定提供出来

### 2. 源资源与产物分离，但真相必须统一

本次明确：

- `assets/` 是唯一手改静态资源源目录
- `dist/` 是唯一构建产物目录
- `dist/public/assets` 是运行时对外提供的静态资源目录

这三者不是“多余目录”，而是不同层级；真正的问题不是目录个数，而是它们不能说不同的话。

因此本次不追求删除 `dist/`，而是追求：

- 浏览器代码引用的资源路径
- Dioxus 入口页面生成出来的资源路径
- 服务器静态资源挂载路径
- 测试断言的资源路径

四者保持一致。

### 3. 浏览器接入回到官方主路径

当前的 ESM 动态导入方式不是本次首选。  
本次改成：

- 使用 `socket.io.min.js`
- 通过浏览器全局 `io` 建立连接
- 由 [Dioxus.toml](/E:/koko/Dioxus.toml) 的 `[web.resource].script` 把官方 bundle 注入页面入口

这样更贴近官方浏览器直接接入路径，也更符合 Dioxus 官方资源配置方式。

### 4. 不借这次改动继续膨胀私有桥接层

当前 [src/web.rs](/E:/koko/src/web.rs) 里已经有一层实时桥接逻辑。  
这次只做“资源与接入方式收口”，不借机再抽新框架、造新中间层、发明新的 JS helper 文件，也不自定义新的页面模板，除非官方 `Dioxus.toml` 入口资源机制被实证证明不够用。

原则是：

- 改到最少能让路径变真、资源变稳、升级点变清楚
- 不趁机做大范围前端 runtime 改造

## 目标结构

### 1. 资源文件

根目录 `assets/` 保持为手工资源源目录，但其中的 Socket.IO 客户端文件收口为：

- [assets/socket.io.min.js](/E:/koko/assets/socket.io.min.js)

同时删除旧的：

- `assets/socket.io.esm.min.js`

来源、版本和维护说明不直接写进 vendor bundle 本体，避免破坏“官方原始产物”这一事实。

这类信息应写在：

- 邻近设计/实施文档
- 引用该资源的 Rust 宿主文件中文注释中

要求至少写清：

- 它是 Socket.IO 官方浏览器生产 bundle
- 当前固定版本是 `4.8.3`
- 仓库不引入 npm，本文件作为受控 vendor 资产维护

### 2. 浏览器代码与页面入口

[Dioxus.toml](/E:/koko/Dioxus.toml) 中新增：

```toml
[web.resource]
script = ["./assets/socket.io.min.js"]
```

职责是让 Dioxus 在生成的 `index.html` 入口里显式插入官方 `socket.io.min.js`，而不是依赖组件树渲染时机。

[src/web.rs](/E:/koko/src/web.rs) 中：

- 删除 `dynamic import("/assets/socket.io.esm.min.js")`
- 改成直接使用浏览器全局 `io`
- 增补中文注释，说明这里消费的是已由页面入口预加载的官方 vendor bundle，而非 Rust 侧自己实现的实时客户端

本次明确拒绝两条路：

- 继续依赖运行时碰运气的隐式加载顺序
- 在 `App()` 组件树里临时插 `<script>` 再假设它一定早于 wasm bootstrap

### 3. 静态资源挂载

[src/http.rs](/E:/koko/src/http.rs) 继续保留：

- `dist/public` 作为前端产物目录
- `dist/public/assets` 作为运行时静态资源目录
- `dist/public/wasm` 作为 wasm/js 产物目录

这里不改目录结构，只补中文注释，写清：

- 服务端永远面向产物目录提供静态文件
- `assets/` 只是源资源，不是运行时直接真相

## 代码改动范围

本次允许修改的文件范围收敛为：

- [Dioxus.toml](/E:/koko/Dioxus.toml)
- [assets/socket.io.min.js](/E:/koko/assets/socket.io.min.js)（新增或替换）
- [src/web.rs](/E:/koko/src/web.rs)
- [src/http.rs](/E:/koko/src/http.rs)（仅必要注释和边界说明）
- [tests/http_support/mod.rs](/E:/koko/tests/http_support/mod.rs)
- [tests/http_flow.rs](/E:/koko/tests/http_flow.rs)

如无必要，不扩散到其他模块。

## 测试策略

### 1. 静态资源协议面验证

`http_flow` 相关测试继续验证：

- `/assets/socket.io.min.js` 可访问
- `/assets/theme.css` 可访问
- `/wasm/...` 可访问
- 未知静态资源保持 404

同时把旧的 `socket.io.esm.min.js` 断言替换成新版 `socket.io.min.js`，并增加旧资源已下线的断言。

### 2. 测试表意要收紧

[tests/http_support/mod.rs](/E:/koko/tests/http_support/mod.rs) 当前为了静态壳测试直接喂根目录 `assets/`。  
这次不能再满足于“说明它只是协议面测试”，而要把验证朝运行时真相再推近一步。

最小收口要求：

- 保留现有前端 fixture 作为路由/fallback 测试壳
- 静态资源断言明确对齐最终运行时资源名 `socket.io.min.js`
- 真实 bundle 验证不能只看文件存在，还要验证生成的入口页面顺序与默认运行时静态资源目录

如果当前测试辅助层继续直接喂根目录 `assets/`，也必须在测试命名和中文注释里明确：

- 这里是在验证静态路由协议面
- 这里不是生产产物总装测试

同时新增一条更靠近生产的验证，证明 bundle 后的 `index.html` 确实先注入 `socket.io.min.js`，再加载 `/wasm/koko.js`。

### 3. bundle 验证

完成代码改动后，必须跑仓库标准 web bundle 流程，确认：

- `dist/public/assets/socket.io.min.js` 实际存在
- `dist/public/index.html` 中实际出现 `socket.io.min.js`
- `socket.io.min.js` 在 `/wasm/koko.js` 之前被插入入口页面
- 默认运行时静态资源目录仍然指向 `dist/public/assets`

如果 bundle 后文件未进入产物目录，则说明资源真相仍未收口，不能宣布完成。

### 4. 最小兼容性 smoke

除了静态资源与 bundle 存在性，本次还必须至少证明一次“官方最新版客户端资源 + 当前 Rust 服务端”可以完成最小接入。

最小可接受证明二选一：

- 方案一：现有测试体系中新增或调整一条最小实时 smoke，证明浏览器侧接入方式不会因全局 `io` 改造而直接失效
- 方案二：在标准验证命令之外，补一条受控的最小集成验证，证明加载后的客户端能够对当前 `socketioxide` 服务端完成基本连接

核心要求不是把完整 IM 流程重测一遍，而是避免只验证“文件在”，却没有验证“最新版官方客户端真的能连”。

## 注释策略

本次新增中文注释必须克制，但要有信息量，优先解释：

- 为什么选择官方 vendor bundle 而不是 npm
- 为什么服务端读 `dist/public/assets` 而不是根目录 `assets`
- 为什么浏览器侧依赖全局 `io`
- 为什么入口脚本声明放在 `Dioxus.toml` 而不是组件树

禁止写这种无价值注释：

- “这里连接 socket”
- “这里加载 js 文件”

注释要解释边界和原因，而不是重复代码动作。

## 风险与控制

### 1. 资源升级风险

把 `socket.io` 客户端升级到最新版 `4.8.3` 后，必须注意与当前 Rust 侧 `socketioxide` 的兼容性。  
本次先不升级 `socketioxide`，只做浏览器 bundle 升级，因此需要依赖现有回归测试与实际 bundle 验证来控风险。

### 2. 运行时路径失配风险

如果浏览器侧改了资源文件名，但 `Dioxus.toml`、测试、bundle、服务端挂载未同步，最容易出现“开发看起来正常、真实产物缺文件”的假绿。
所以这轮的关键不是简单改字符串，而是把资源文件名、入口页面、静态路由、bundle 产物四者一起验证。

### 3. 私有桥接膨胀风险

如果在修改 [src/web.rs](/E:/koko/src/web.rs) 时顺手再引入更多私有 JS helper、私有包装 API 或新的前端资源同步脚本，会直接违背本次“不能手搓轮子”的目标。  
因此本次必须坚持最小改动原则。

## 验收标准

本次设计落地后，应满足：

1. 仓库中不再保留 `assets/socket.io.esm.min.js`
2. 仓库中存在官方最新版 `socket.io.min.js@4.8.3`
3. 浏览器侧不再使用 `dynamic import("/assets/socket.io.esm.min.js")`
4. [Dioxus.toml](/E:/koko/Dioxus.toml) 已通过 `[web.resource].script` 显式声明 `./assets/socket.io.min.js`
5. 浏览器侧改为通过全局 `io` 接入 Socket.IO
6. `/assets/socket.io.min.js` 静态资源测试通过
7. 仓库标准 web bundle 流程后，`dist/public/assets/socket.io.min.js` 实际存在
8. `dist/public/index.html` 中 `socket.io.min.js` 先于 `/wasm/koko.js` 出现
9. 默认运行时静态资源目录仍明确指向 `dist/public/assets`
10. 至少有一条最小兼容性 smoke 能证明最新版官方客户端接入当前 Rust 服务端不会直接失效
11. 关键边界处已补上简洁、有效的中文注释
12. 本次没有引入 npm/pnpm 或新的前端工具链
13. 本次没有引入新的私有 `socket.io` 包装层、资源复制轮子或预加载引导器

## 结论

这次正确的方向不是为了“少一个目录”去扭曲 Dioxus 的资源/产物边界，也不是为了“更像前端项目”去引入 npm。  
真正优雅的做法是：

- 继续保持纯 Rust 工程
- 直接复用 Socket.IO 官方最新版浏览器生产 bundle
- 直接复用 Dioxus 官方入口资源能力
- 把 `socket.io` 资源、入口页面、运行时路径、测试断言收口成一份真相

这样既不重造轮子，也能让目录、升级点、维护成本都更克制。
