# 本地盘阶段切换 tusd 承载大视频高吞吐上传设计

日期：2026-04-16  
状态：Draft  
适用范围：`koko` 当前 Web 媒体上传主链，覆盖前端 `Uppy + @uppy/tus`、上传 sidecar、后端 `prepare / hook / complete / abandon / gc`、开发启动器与本地盘部署约束；本期不引入正式对象存储，但必须为未来对象存储直传迁移保留稳定边界。  

关联文档：

- `docs/superpowers/specs/2026-04-15-上传吞吐专项优化-design.md`
- `docs/superpowers/specs/2026-04-15-媒体上传链路增强与并发治理-design.md`
- `docs/superpowers/specs/2026-04-16-Tus-Concatenation大视频单文件高吞吐设计.md`

参考官方资料：

- [Uppy Choosing the uploader](https://uppy.io/docs/guides/choosing-uploader/)
- [Uppy Tus](https://uppy.io/docs/tus/)
- [Uppy AWS S3](https://uppy.io/docs/aws-s3/)
- [tus protocol 1.0.x](https://tus.io/protocols/resumable-upload)
- [tusd Configuration](https://tus.github.io/tusd/getting-started/configuration/)
- [tusd Hooks](https://tus.github.io/tusd/advanced-topics/hooks/)
- [tusd Upload locks](https://tus.github.io/tusd/advanced-topics/locks/)
- [tusd Local Disk](https://tus.github.io/tusd/storage-backends/local-disk/)
- [Rustus Configuration](https://s3rius.github.io/rustus/configuration/)
- [Rustus Hooks](https://s3rius.github.io/rustus/hooks/)

## 1. 为什么要补这一份 spec

这不是“把上传 sidecar 从 A 改成 B”这么简单。  
这份 spec 要解决的是三个经常被混在一起、但 owner 完全不同的问题：

1. **当前就要把单大视频高吞吐上传做回来**
2. **当前还没有正式对象存储**
3. **不能为了赶进度把业务真相、基础设施语义和未来迁移边界搅成一锅**

前一轮路线是继续站在 `Uppy + Tus + Rustus` 上，把 `Tus Concatenation` 自己补齐。  
这条路不是方向错误，而是成本开始失控。最近暴露出来的问题越来越不像“业务模型不够”，而更像：

- sidecar hook payload 细节越来越重
- final concat 与 partial/final 角色兼容越来越脆
- 清理、恢复、幂等和本地路径解析越来越依赖供应商细节
- 代码越来越容易长成“围着某个 sidecar 打补丁”的结构

如果继续沿这条路补，很容易出现四层并存：

1. 业务真相一套
2. `Rustus` 兼容补丁一套
3. 清理/恢复补丁一套
4. 为未来对象存储再补一套过渡抽象

这不符合 DDD，也不符合 Unix。

这份 spec 因此不再回答：

**“要不要继续补 `Rustus` 兼容代码？”**

而是回答：

**“在当前没有正式对象存储、但现在就要把大视频高吞吐做回来、同时不能制造第二个上传内核的前提下，什么成熟轮子组合最优雅？”**

## 2. 当前现场事实

### 2.1 当前主链已经有清楚的业务真相

当前上传主链已经明确区分了三件事：

1. `prepare` 成功  
   只代表业务允许开始上传，并下发上传会话所需最小契约。
2. transport 上传成功  
   只代表字节被上传侧车接收完成。
3. `complete` 成功  
   才代表附件业务上真正 `ready`。

这条边界是对的，不能因为切 sidecar 或追吞吐就被打破。  
如果后面把 transport 成功、文件删除、hook 回调这些基础设施事件直接当成业务成功或业务取消，系统就会出现双真相。

### 2.2 当前项目并不是完全没有存储抽象

后端已经存在媒体存储配置和统一存储装配方向：

1. `local` 与 `s3` 驱动配置已经存在
2. 上传、读取、删除已经在围绕统一对象存储抽象工作

这说明两件事：

1. 现在不该为了“以后也许要对象存储”再造一层厚重私有上传核心
2. 但允许谨慎定义**极薄的** `S3兼容层.rs`，前提是它立刻吸收现有散点职责，而不是空壳占坑

### 2.3 当前前端真实路径仍然是 client -> upload server

前端当前真实在跑的是：

1. `Uppy + @uppy/tus`
2. 浏览器到 sidecar 的 resumable upload
3. 后端通过 `prepare / hook / complete / abandon / gc` 完成业务闭环

这意味着本期不能假装前端已经是：

- 直传对象存储
- multipart 主路
- presign 驱动上传

本期前端仍然是 `client -> upload server` 路线，只是 upload server 从 `Rustus` 切到更成熟的 `tusd v2`。

### 2.4 当前真正需要被替换的是上传 sidecar

如果目标是：

- 单个大视频高吞吐
- 并行分片
- 强恢复
- 少手搓
- 不引入第二套上传核心

那当前最值得替换的，不是前端 uploader，也不是业务真相模型，而是：

**上传 sidecar 的成熟度与生态质量。**

## 3. 官方最佳实践给出的硬边界

这一节不是资料罗列，而是把当前阶段必须服从的几条硬结论压清楚。

### 3.1 Uppy 官方路线

Uppy 官方路线很清楚：

1. `@uppy/tus` 是 **client -> upload server** 的正路
2. `@uppy/aws-s3 multipart` 是 **client -> object storage** 的正路

这意味着：

- **未来**有正式对象存储时，大视频主路应迁移到 multipart
- **现在**没有正式对象存储时，不该为了追求“看起来统一”去手搓 multipart 或私有 presign 上传协议

### 3.2 tus / tusd 官方路线

tus 官方协议和 tusd 官方文档给出的边界也很清楚：

1. Concatenation 是正式协议能力，不是私有魔法
2. partial 与 final 是 transport 语义，不是业务语义
3. `tusd v2` 已经成熟提供：
   - resumable upload
   - concatenation
   - termination
   - 本地盘持久化
   - hooks
   - 上传锁与恢复
4. `tusd` behind proxy 时，必须显式处理：
   - `-behind-proxy`
   - 代理层关闭 request buffering
   - 代理层大小限制与上传需求一致

这说明本期应该尽量把运输能力交给 `tusd` 官方能力，而不是在项目里复刻：

- transport 删除
- partial/final 文件生命周期
- 上传锁
- resumable transport 协议细节

### 3.3 当前阶段不应该碰的东西

根据官方资料和当前前提，本期明确不应该做：

1. 手搓 multipart
2. 手搓新的 uploader
3. 自己重写 transport termination 逻辑
4. 把 `chunkSize` 变成新的性能调参战场
5. 为“未来也许会用”先造一层厚重 S3 抽象核心

## 4. 方案比较

### 4.1 方案 A：继续沿用 Rustus，持续补协议细节

内容：

1. 保留 `Rustus`
2. 继续补 `partial/final`
3. 继续补 hook body 兼容
4. 继续补路径清理与幂等细节

优点：

1. 改动集中在当前链路
2. 不需要切 sidecar

缺点：

1. 继续把工程时间投入在较薄生态的协议细节上
2. 未来还会继续遇到 payload、hook、清理、兼容性这类边角坑
3. 代码层面会越来越像“围着 sidecar 补洞”

### 4.2 方案 B：切到 `tusd v2 + local disk`，并允许极薄 S3 兼容 seam

内容：

1. 前端继续 `Uppy + @uppy/tus`
2. 上传 sidecar 从 `Rustus` 一次性切到 `tusd v2`
3. 当前存储继续使用本地盘
4. 后端继续掌握业务真相：
   - `prepare`
   - hook 翻译
   - `complete`
   - `abandon`
   - `gc`
5. 允许定义**极薄** `S3兼容层.ts/.rs`，但只作为未来对象存储迁移 seam，不允许成为第二套上传内核

优点：

1. transport 能力直接站到更成熟的 tus server 轮子上
2. 当前阶段不引入对象存储，也不需要手搓 multipart
3. 为未来迁移到对象存储直传保留稳定 adapter seam
4. 可以一次性切掉 `Rustus` 补丁债，避免双轨

缺点：

1. 需要做一轮 sidecar 切换
2. hook payload、启动器、测试、运维脚本都要一起调整
3. 如果 `S3兼容层.ts/.rs` 不够克制，很容易长成新的私有核心

### 4.3 方案 C：现在就把主路改造成对象存储 multipart

内容：

1. 提前把前端切到 `@uppy/aws-s3 multipart`
2. 提前把后端切到 presign / multipart complete
3. 现在就把对象存储直传当主路

优点：

1. 理论上长期主路更贴近终态

缺点：

1. 当前基础设施前提不成立
2. 会把本期任务扩大成上传架构重做
3. 容易为了“未来”手搓过渡协议、过渡 SDK、过渡状态机

## 5. 最终裁决

本次采用 **方案 B：本地盘阶段切到 `tusd v2 + local disk`，同时只允许极薄 `S3兼容层.ts/.rs` 作为未来对象存储迁移 seam。**

一句话：

**当前阶段最优雅的路线不是继续围着 `Rustus` 补洞，也不是提前手搓 multipart 或厚重 S3 核心，而是切到 `tusd v2 + local disk`，继续让 `Uppy + @uppy/tus` 承担浏览器侧上传，并把未来对象存储迁移收敛到极薄的 `S3兼容层.ts/.rs`。**

## 6. 本次设计目标

本次设计只回答下面这些问题：

1. 当前阶段的大视频高吞吐主路如何切到 `tusd v2 + local disk`
2. 如何保持 `prepare / complete / abandon` 仍然是业务真相 owner
3. `termination` 应该如何使用，才能站在官方能力上但不把基础设施提升成业务裁决者
4. `S3兼容层.ts/.rs` 在当前阶段允许做到什么程度、禁止做到什么程度
5. 如何一次性退场 `Rustus`，避免双轨、冗余文件和历史垃圾残留
6. 如何把验证门禁写清，避免实施时因文档漂移引入新 bug

## 7. 明确非目标

本次明确不做：

1. 不引入正式对象存储
2. 不把大视频主路直接改成 multipart
3. 不手搓 multipart 协议
4. 不手搓新的 uploader
5. 不手搓 transport termination 删除逻辑
6. 不重做媒体读取、分发和播放链
7. 不保留 `Rustus` 与 `tusd` 双轨活路径
8. 不允许 `S3兼容层.ts/.rs` 承载重试、分片、状态机、缓存或业务真相

## 8. DDD 与 Unix 的裁决

### 8.1 真相 owner

这期必须明确：

- `prepare`、`complete`、`abandon` 是业务真相 owner
- `tusd` 是 transport owner
- `S3兼容层.ts/.rs` 是 adapter seam，不是业务 owner

也就是说：

1. transport 上传成功  
   不是业务成功
2. transport 删除成功  
   不是业务取消成立
3. hook 到达  
   不是业务 ready

业务语义仍然必须回到后端应用层裁决。

### 8.2 边界裁决

从 DDD 和 Unix 两个角度，这期都必须做到：

1. 领域层只持有业务事实
2. adapter 层只做协议/IO/供应商翻译
3. shell 层只做编排与启动
4. 任何新加的层都必须压缩旧复杂度，而不是叠加新复杂度

因此禁止：

1. 把 `tusd` 语义漏进领域模型
2. 把 `termination` 写成业务取消真相
3. 把 `S3兼容层.ts/.rs` 长成大而全上传门面

## 9. 核心系统形态

### 9.1 当前阶段

系统形态应变成：

1. 浏览器：
   - `Uppy + @uppy/tus`
2. 上传 sidecar：
   - `tusd v2`
   - `local disk`
3. 后端主服务：
   - `prepare`
   - hook
   - `complete`
   - `abandon`
   - `gc`

### 9.2 未来阶段

未来正式对象存储到位后，再切：

1. 浏览器：
   - `@uppy/aws-s3 multipart`
2. 直传目标：
   - `MinIO / S3-compatible`
3. 后端主服务：
   - 签名
   - 完成裁决

也就是说，未来迁移点是：

**`tusd local disk` -> `multipart + object storage`**

而不是：

**先做一套厚重私有 `S3兼容层`，再慢慢猜未来怎么迁。**

## 10. 文件边界与命名裁决

### 10.1 协议边界命名

不建议让文件名长期携带供应商历史。

如果这期需要保留 hook adapter，命名应逐步从 vendor 导向收口到协议导向。  
推荐方向是：

- `rustus_hook外壳.rs` 逐步退场
- 统一到协议或能力导向命名，例如 `tus_hook外壳.rs`

原因很简单：

1. 领域并不关心现在是 `Rustus` 还是 `tusd`
2. 协议语义比供应商语义稳定
3. 不让供应商名称漏进长期边界

### 10.2 `S3兼容层.ts/.rs` 的文件裁决

允许这期落真实文件，但只有在同时满足下面两个条件时才允许：

1. 一落地就能吸收当前已经散落的存储接线职责
2. 落地后能同步删除旧散点胶水，而不是空壳占坑

如果某一侧当前没有立即可吸收的散点职责，则宁可暂时不落该侧文件，也不能为了对称性制造空文件。

## 11. `S3兼容层.ts/.rs` 的允许范围与禁止范围

### 11.1 允许范围

`S3兼容层.rs` 允许：

1. 映射现有存储配置到官方 S3-compatible 能力
2. 承接 endpoint / bucket / region / path-style / 凭证这类基础设施翻译
3. 为未来 presign / multipart complete 保留稳定契约边界

`S3兼容层.ts` 允许：

1. 承接前端与未来对象存储直传契约的极薄映射
2. 承接官方 uploader / presign 契约边界
3. 承接必要的请求/响应形状转换

### 11.2 禁止范围

这两层都明确禁止：

1. 分片策略
2. 重试策略
3. 上传状态机
4. 缓存层
5. 业务判断
6. `ready / failed / abandoned` 之类业务状态语义
7. 复制 `Uppy`、`@uppy/tus`、未来 `@uppy/aws-s3` 已有能力
8. 把 `tusd`、multipart、对象存储三套语义揉成一个大一统私有上传门面

建议写成硬句子：

**`S3兼容层.ts/.rs` 只允许作为未来对象存储迁移的极薄 adapter seam 存在；不得承载上传协议、状态机、重试、分片、缓存或任何业务真相。`**

## 12. 鉴权语义与 capability URL 裁决

### 12.1 当前阶段的鉴权真相

当前阶段 `pre-create` 是唯一强业务准入点。  
它负责判断：

1. 当前会话是否允许开始上传
2. 当前上传会话是否应被创建
3. 当前附件与上传会话的绑定是否成立

### 12.2 创建后的 upload URL 语义

这期必须明确写成：

**创建成功后的 upload URL 是短期 capability URL。**

也就是说：

1. `pre-create` 做强业务准入
2. 创建后的 URL 靠随机性和时效性提供后续 resume 能力
3. 不再为了“看起来更安全”手搓第二套重复业务认证桥，把所有 PATCH/HEAD 再变成一次全业务鉴权

### 12.3 风险控制方式

当前阶段风险控制依赖：

1. 随机 upload URL
2. 过期时间 TTL
3. `abandon`
4. `termination`
5. `gc`
6. 部署边界与网络边界

这不是终态安全模型，而是当前阶段在官方能力和本地盘现实下最克制、最真实的裁决。

## 13. 取消语义、`abandon` 与 `termination` 的真相边界

这是整份 spec 最容易漂的地方，必须写死。

### 13.1 业务取消的唯一 owner

业务上的“取消上传”唯一由后端 `abandon` 裁决。

这意味着：

1. 普通前端用户表达的是“取消上传”意图
2. 业务上这次取消是否成立，由后端 `abandon` 决定
3. `tusd termination` 只是 transport 资源删除机制，不是业务取消真相

### 13.2 为什么不能把 `termination` 当业务真相

`termination` 知道的是：

- 某个 upload resource 被删除了

它不知道的是：

- 这是用户主动取消
- 还是超时清理
- 还是运维修复
- 还是会话切换后的旧资源退场
- 这次取消是否应把业务附件状态推进到 `abandoned`

所以：

**`termination != 业务取消成立`**

### 13.3 正确链路

正确链路是：

1. 前端表达取消上传意图
2. 后端 `abandon` 裁决业务取消成立
3. 后端驱动或协调官方 `tusd termination`
4. 后端统一收口：
   - 上传会话状态
   - 附件状态
   - 残留清理
   - 迟到回调拒绝

建议写成硬句子：

**`termination 是官方 transport 删除机制，不是业务取消真相；业务取消唯一由后端 abandon 裁决。`**

## 14. `complete`、迟到事件与恢复语义

### 14.1 `complete` 的业务边界

`complete` 仍然是业务 `ready` 的唯一入口。  
即使 transport 成功、hook 到达、文件存在，也不能提前把附件判成 `ready`。

### 14.2 迟到事件

spec 必须写清：

1. `abandon` 之后晚到的 hook / complete / resume 必须被拒绝或视为无效
2. 已切换会话后的旧 transport 资源不能复活当前业务状态
3. 旧 upload URL 只能作为旧 capability 退场，不能重新变成当前活跃会话

### 14.3 恢复语义

恢复、重试、resume 都必须服从一个规则：

**transport 可以恢复，但业务真相只能由当前活跃上传会话与后端用例裁决。**

## 15. 部署与运行时边界

### 15.1 当前阶段的部署前提

本期必须明确写死：

**`tusd v2 + local disk` 当前阶段按单机 / 单卷优先设计，不承诺多节点共享写入。**

原因：

1. 当前阶段的真实前提就是本地盘
2. `tusd` 本地盘模式不该在 spec 里被描述成天然无脑横扩
3. 如果未来需要多节点共享写入，必须进入对象存储阶段再重新裁决

### 15.2 behind proxy 要求

如果部署在反向代理后，必须在 spec 中显式要求：

1. `tusd` 开启 `-behind-proxy`
2. 代理层关闭 request buffering
3. 代理层上传大小限制与业务限制一致
4. 代理层转发 host / proto 等必要头

这不是运维琐事，而是 resumable upload 能否成立的基础前提。

## 16. 一次性切换与退场顺序

### 16.1 一次性切换

这期明确采用一次性切换：

1. `Rustus` 退场
2. `tusd` 上位
3. 不保留双轨活路径

原因不是激进，而是为了防止：

1. 双套启动器参数
2. 双套 hook payload 兼容
3. 双套测试夹具
4. 双套失败恢复与清理语义

这类双轨只会制造冗余和垃圾，不会带来真实安全感。

### 16.2 退场顺序

退场顺序必须写清：

1. 先定义稳定 owner：
   - `prepare / complete / abandon` 仍是业务真相 owner
   - `tusd` 是 transport owner
2. 再切启动器、hook adapter、测试夹具到 `tusd`
3. 同一批次删除：
   - `Rustus` 配置
   - `Rustus` 启动器参数
   - `Rustus` 测试依赖
   - 文档中的 `Rustus` 主叙述
4. 新 thin seam 一旦落地，必须同步删除旧散点胶水

不接受“新层先加上去，旧代码以后再删”的 add-only 迁移。

## 17. 验证门禁与回归保护

### 17.1 总原则

这期不是普通重构，而是上传 sidecar 更换。  
因此必须先表征现状，再切换实现，再用同一组不变量回归证明业务功能没坏。

### 17.2 必须保住的业务不变量

spec 必须明确这些不变量：

1. `prepare` 成功不等于附件 `ready`
2. transport 成功不等于业务成功
3. 只有 `complete` 成功才代表附件 `ready`
4. 取消上传后，旧会话不能被迟到 hook / complete 复活
5. 图片上传、视频上传、消息发送、现有媒体读取链都不能因 sidecar 切换而行为漂移
6. 当前 200MB 视频上限、现有草稿语义、现有消息主链不能被顺手打坏

### 17.3 三层验证

这期验证必须拆成三层：

1. **Characterization tests**  
   先锁当前必须保住的用户语义：
   - prepare / complete / abandon
   - 图片上传
   - 视频上传
   - 取消上传
   - 迟到回调
   - 残留清理
2. **Migration tests**  
   新增 `tusd` 相关专项验证：
   - hook payload
   - termination
   - capability URL
   - local disk
   - 启动器参数
3. **Regression sweep**  
   统一跑前端、Rust、启动器、类型检查、编译检查与工作树复核

### 17.4 验收要求

每一个完成声明都必须建立在新鲜验证上。  
不能只跑 happy path，也不能只证明“上传成功”，还要证明：

1. 取消路径
2. 迟到事件
3. 残留清理
4. 旧会话失效
5. 启动器配置

建议写成硬句子：

**`所有 sidecar 切换都必须建立在现有上传业务语义的 characterization tests 之上；没有失败路径和迟到事件保护测试的切换，一律视为未完成。`**

## 18. 预期收益

如果按这条路实施，收益不是“代码看起来更现代”，而是：

1. 大视频高吞吐直接站到更成熟的 tus server 轮子上
2. hook / concatenation / termination / resumability 少手搓
3. `Rustus` 补丁债一次性退场，不再围着供应商边角细节补洞
4. 未来对象存储迁移不再需要推倒当前业务真相，只需要替换 adapter seam
5. `S3兼容层.ts/.rs` 被约束在极薄边界内，不会反向长成第二个上传内核

## 19. 最终结论

这份 spec 的最终结论可以压成五句话：

1. 当前阶段的大视频高吞吐主路改为 `Uppy + @uppy/tus -> tusd v2 + local disk -> prepare / hook / complete`
2. `Rustus` 一次性退场，不保留双轨
3. `termination` 使用官方能力，但只作为 transport 删除机制；业务取消唯一由后端 `abandon` 裁决
4. 允许极薄 `S3兼容层.ts/.rs`，但它只能是未来对象存储迁移 seam，不能成为第二套上传核心
5. 所有切换都必须建立在 characterization + migration + regression 三层验证之上；未通过验证不得宣称完成

一句话收口：

**在“当前没有正式对象存储，但现在就要把大视频高吞吐上传做回来，同时不制造屎山、不重复手搓轮子和代码”的前提下，最优雅的路线是切到 `tusd v2 + local disk`，保住 `prepare / complete / abandon` 的业务真相 owner，并把未来对象存储迁移收敛到极薄、可替换、不可长胖的 `S3兼容层.ts/.rs`。**
