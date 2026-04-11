# 2026-04-11 Rust 集成测试与 TDD 组织实践笔记

适用范围：`koko` 的 Rust 后端测试目录与后续测试重构。  
目标：回答三件事：

1. Rust 官方到底有没有建议把几千行集成测试一直堆在一个文件里。
2. Rust 社区里长期做库、框架、Web API 的人，TDD 下通常怎么组织测试。
3. 这些经验放回 `koko`，下一步该怎么拆才不虚。

## 1. 先说结论

结论很直接：

1. Rust 官方没有建议把集成测试长期堆成一个 5000 行热点文件。
2. 官方建议的是按测试层次和职责组织；如果 integration test 太多，允许保留“单个 integration target + 多个 module”，这是编译/执行效率折中，不是继续把所有场景揉成一锅。
3. Rust 里靠谱的 TDD/测试实践，普遍是：
   - 领域规则贴近代码做 unit test；
   - 对外契约、路由、数据库、进程边界走 integration / black-box test；
   - helper / fixture 单独收口；
   - 按能力域或场景拆模块，而不是按“今天顺手加哪条测试”继续往同一文件尾部追加。

所以问题不在于“是不是只能有一个 integration test target”，而在于“这个 target 内部有没有按边界收口”。

## 2. 官方资料真正说了什么

### 2.1 Rust Book：unit 和 integration 本来就不是一个层次

Rust Book 对测试组织的基本建议是：

1. unit test 贴着被测代码放；
2. integration test 放在 `tests/` 目录；
3. 多个 integration test 需要共享代码时，用类似 `tests/common/mod.rs` 这样的公共模块。

重点不是目录形式，而是边界：

- unit test 可以碰私有实现；
- integration test 只该通过公开表面测试系统行为。

来源：  
- <https://doc.rust-lang.org/book/ch11-03-test-organization.html>

### 2.2 Cargo Book：如果集成测试很多，可以单 target + 多模块

Cargo Book 有一句特别关键：

- `tests/` 下每个文件都会被编译成单独 crate；
- 如果 integration tests 很多，这会带来编译和执行低效；
- 这时可以考虑创建一个单独的 integration test，再在里面拆成多个模块，让 `libtest` 统一发现并运行。

这句话的真实意思是：

1. 官方承认“单 target”是可行组织方式；
2. 但官方说的是“单 target + 多模块”，不是“单 target + 单热点大文件”。

来源：  
- <https://doc.rust-lang.org/cargo/reference/cargo-targets.html>

## 3. Rust 社区成熟项目怎么做

### 3.1 ripgrep：单入口，但按主题拆模块

`ripgrep` 的测试组织很典型：保留一个总入口 `tests/tests.rs`，里面只做模块汇总，例如：

- `binary`
- `feature`
- `json`
- `multiline`
- `regression`
- `util`

这正是 Cargo Book 那条建议的现实版本：  
保留单个 integration target，但把主题、回归、工具模块都拆开。

来源：  
- <https://raw.githubusercontent.com/BurntSushi/ripgrep/master/tests/tests.rs>

### 3.2 tokio：多文件 + support

`tokio` 走的是另一条路：大量 integration test 文件按能力拆开，例如文件系统、IO、进程、runtime 等，各自独立；公共支撑代码进 `tests/support/`。

这个做法适合：

1. 功能面很广；
2. 各测试组之间公共 helper 较少；
3. 愿意接受多 test crate 带来的编译成本。

来源：  
- <https://github.com/tokio-rs/tokio/tree/master/tokio/tests>

### 3.3 sqlx：按后端/主题分组，再配 fixtures 和隔离数据库

`sqlx` 的测试目录会按数据库类型和主题拆分，例如 `tests/postgres/` 下有：

- `migrate.rs`
- `macros.rs`
- `types.rs`
- `query_builder.rs`

还会把：

- `fixtures/`
- `migrations/`

单独收口。

更关键的是 `#[sqlx::test]`：

1. 每个测试可自动创建隔离数据库；
2. 自动应用迁移；
3. 可以按测试声明 fixtures；
4. 测试失败时保留现场。

这非常适合“很多测试本质上都在重复：建库、迁移、插入前置数据、断言结果”的项目。

来源：  
- <https://github.com/launchbadge/sqlx/tree/main/tests/postgres>
- <https://docs.rs/sqlx/latest/sqlx/attr.test.html>

### 3.4 Luca Palmieri：黑盒集成测试 + `spawn_app`

做 Rust Web API 的经典做法，是把 integration test 当成真正的黑盒契约测试：

1. 启动应用；
2. 用真实 HTTP client 发请求；
3. 断言状态码、响应体和外部行为；
4. 尽量不要把测试直接绑死在 handler 内部或框架内部。

这套思路的重点是：

- integration test 测对外 contract；
- 不直接测试内部私有实现；
- helper 要收口成 `spawn_app`、`api_client`、fixture builder，而不是让每个测试自己拼一遍样板。

来源：  
- <https://lpalmieri.com/posts/2020-08-09-zero-to-production-3-how-to-bootstrap-a-new-rust-web-api-from-scratch/>

## 4. 回看 `koko` 现在的问题

当前仓库里：

- `tests/集成测试.rs` 约 4888 行；
- 总测试数 72；
- `#[serial]` 64 个；
- 文件尾部同时承担了环境变量备份、端口等待、HTTP helper、二进制 helper、Rustus fixture、日志采集等多种责任。

更重要的是，这个文件混了几种不同层次：

1. 迁移文件存在性/结构断言；
2. 真实数据库持久化断言；
3. HTTP 路由级 contract；
4. 媒体上传运输链路；
5. 协作分发与 locator / torrent；
6. realtime / 并发；
7. 后台接口；
8. 启动与优雅停机。

这说明当前问题不是“用了单 integration target”，而是：

1. 单个热点文件吞了太多能力域；
2. helper 和测试场景耦在一起；
3. 大量 `serial` 暗示测试隔离做得不够，慢路径已经成默认路径。

`graphify` 这次也把 `send_json()`、`构造rustus_hook请求体()`、`写入rustus测试文件()` 标成了测试热点节点，进一步说明这个热点已经开始承载结构债。

## 5. 最适合 `koko` 的组织方式

结合 `koko` 当前体量、Cargo 官方建议和现有约束，最合适的不是“把一个大文件拆成几十个独立 test crate”，而是：

### 5.1 保留一个集成测试总入口，但把内部拆成能力模块

建议保留一个总入口，例如继续保留：

- `tests/集成测试.rs`

但它只做模块汇总，例如：

- `mod support;`
- `mod 启动与配置;`
- `mod 房间快照与历史;`
- `mod 阅读推进;`
- `mod 媒体上传;`
- `mod 协作分发;`
- `mod 内容读取;`
- `mod 后台与静态壳;`
- `mod realtime与并发;`

对应子模块可以落在：

- `tests/集成测试/support.rs`
- `tests/集成测试/媒体上传.rs`
- `tests/集成测试/阅读推进.rs`
- 其他同类文件

这样做的好处：

1. 保留单 test target，避免编译数暴涨；
2. 测试名字和能力边界能对齐；
3. helper 不再藏在 5000 行文件底部；
4. 后续只拆结构，不会先把测试机制也换掉。

### 5.2 helper / fixture 单独收口

应该单独收口的东西：

1. `send_json` / `send_bytes`
2. bootstrap / join room / admin login 这类常用前置动作
3. Rustus hook body 构造
4. ready 附件插入和协作分发元数据插入
5. 端口等待与优雅停机辅助
6. 日志采集上下文

它们的职责应该是“搭台”，不是继续参与业务断言。

### 5.3 继续维持三层测试分工

现在仓库已经有：

- `tests/领域测试.rs`
- `tests/用例测试.rs`
- `tests/集成测试.rs`

这个三层结构方向是对的，不该推翻。  
真正需要修的是集成层内部继续长胖的问题。

判断标准：

1. 纯业务规则进领域测试；
2. 应用编排、日志语义、契约输出进用例测试；
3. 只有跨 HTTP / realtime / 数据库 / 进程边界的，才留在集成测试。

### 5.4 逐步减少 `serial`

`serial` 不是原罪，但 64 个 `serial` 说明你们大多数测试都在共享环境、共享数据库或共享全局状态。

下一步最值得研究的不是“先改测试命名”，而是“哪些可以变成隔离测试”：

1. 数据库主导的测试，优先看 `#[sqlx::test]`；
2. 需要前置数据的测试，优先转 fixtures；
3. 只依赖 app state 的测试，尽量不要共享可变全局；
4. 真正必须串行的，只保留在端口、环境变量、进程生命周期这些测试上。

## 6. 适合 `koko` 的渐进重构顺序

别一口气“测试大重写”。更稳的顺序是：

### 第 1 步：只做结构收口，不改断言语义

先把当前 `tests/集成测试.rs` 拆成：

1. 总入口
2. `support`
3. 3 到 4 个最高频能力模块

比如先拆：

1. `媒体上传`
2. `阅读推进`
3. `房间快照与历史`
4. `后台与静态壳`

这一刀只改结构，不改测试逻辑和断言语义。

### 第 2 步：把重复前置动作变 fixture

例如：

1. bootstrap 会话
2. 建房 / 进房
3. 生成图片 / 视频附件
4. 完成 prepare -> hook -> complete 链路

让测试从“手动拼流程”变成“声明我需要哪个场景”。

### 第 3 步：评估 `sqlx::test`

如果后续仍然有大量数据库集成测试，就值得认真评估：

1. 是否给 `sqlx` 开 `macros` feature；
2. 是否用 `#[sqlx::test]` 替换“读配置 -> 手连 DB -> 追平迁移”样板；
3. 是否把重复前置数据沉进 fixtures。

### 第 4 步：把最少数真正端到端的测试留给进程级黑盒

像“启动 + 端口监听 + 优雅停机”这种，确实更接近真实进程级黑盒；  
但不是每条 API contract 都需要升级成完整进程测试。

## 7. 对这次问题的最终判断

“官方最佳实践是不是建议堆在一起”这件事，答案是：

不是。

更准确的说法是：

1. 官方允许单 integration target；
2. 官方也明确建议共享代码要进模块；
3. 成熟项目会按主题或能力拆测试；
4. 大家真正避免的是“测试 crate 过碎”，不是“测试内部边界清理”。

对 `koko` 来说，现在最合理的动作不是争论“一个文件还是多个文件”，而是：

1. 保留单个集成测试 target；
2. 立刻按能力域拆模块；
3. 把 helper / fixture 独立出来；
4. 后续再用数据库隔离和 fixtures 去削掉大部分 `serial`。

## 8. 这份笔记对应的外部资料

- Rust Book: Test Organization  
  <https://doc.rust-lang.org/book/ch11-03-test-organization.html>
- Cargo Book: Cargo Targets / Integration Tests  
  <https://doc.rust-lang.org/cargo/reference/cargo-targets.html>
- ripgrep tests layout  
  <https://raw.githubusercontent.com/BurntSushi/ripgrep/master/tests/tests.rs>
- tokio tests layout  
  <https://github.com/tokio-rs/tokio/tree/master/tokio/tests>
- sqlx postgres tests layout  
  <https://github.com/launchbadge/sqlx/tree/main/tests/postgres>
- `sqlx::test` 文档  
  <https://docs.rs/sqlx/latest/sqlx/attr.test.html>
- Luca Palmieri / Zero To Production  
  <https://lpalmieri.com/posts/2020-08-09-zero-to-production-3-how-to-bootstrap-a-new-rust-web-api-from-scratch/>
