# 本地盘阶段切换 tusd 承载大视频高吞吐上传设计

日期：2026-04-16  
状态：Draft  
适用范围：`koko` 当前 Web 媒体上传主链，覆盖前端 `Uppy + @uppy/tus`、上传 sidecar、后端 `prepare / hook / complete / abandon / gc`，不涉及正式对象存储落地。  

关联文档：

- `docs/superpowers/specs/2026-04-15-上传吞吐专项优化-design.md`
- `docs/superpowers/specs/2026-04-16-Tus-Concatenation大视频单文件高吞吐设计.md`

参考官方资料：

- [Uppy Tus](https://uppy.io/docs/tus/)
- [Uppy AWS S3](https://uppy.io/docs/aws-s3/)
- [tus protocol 1.0.x](https://tus.io/protocols/resumable-upload)
- [tusd hooks](https://tus.github.io/tusd/advanced-topics/hooks/)
- [tusd local disk](https://tus.github.io/tusd/storage-backends/local-disk/)

## 1. 为什么要补这份 spec

当前项目已经明确两件事：

1. **现在不用正式对象存储**
2. **现在就需要把单大视频文件的高吞吐并行上传真正做回来**

之前的路线是继续站在 `Uppy + Tus + Rustus` 上，把 `Tus Concatenation` 自己补齐。  
这条路并不是完全错误，但最近已经暴露出一个更本质的信号：

- 我们现在踩到的问题越来越像 **sidecar 协议细节和 hook 负载细节**，而不是业务模型本身。
- 例如：
  - final concat 的 `upload.length = null`
  - hook body 结构和 `partial/final` 角色细节
  - 残留文件清理与本地路径解析幂等

这说明继续深挖 `Rustus` 的代价正在上升。  
如果还坚持在这条链上补，很容易演变成：

- 业务真相是一套
- `Rustus` 的协议兼容补丁是一套
- 清理、回收、观测再各补一套

这不符合 DDD，也不符合 Unix。

所以这份 spec 要回答的问题不是：

**“要不要再补一层兼容代码？”**

而是：

**“在现在不用对象存储的前提下，什么现成轮子组合，能最少手搓、最优雅地把大视频高吞吐上传做回来？”**

## 2. 当前现场事实

### 2.1 当前项目并不是完全没有存储抽象

后端现在已经有媒体存储配置与 `attachment_store` 装配方向：

1. `local` 与 `s3` 驱动配置已经存在
2. 上传、读取、删除已经在围绕统一对象存储抽象工作

这意味着：

**现在再额外新建一个 `S3兼容层.rs`，大概率是在现有抽象外面再包第二层私有轮子。**

### 2.2 前端现在也没有对象存储直传真实需求

前端当前真实在跑的是：

1. `Uppy + @uppy/tus`
2. 浏览器到 sidecar 的 resumable upload
3. 后端再通过 hook / complete 完成业务闭环

也就是说，当前前端没有必要提前造一个：

- `S3兼容层.ts`
- multipart 私有封装
- presign 私有 SDK

因为这些都不是当前真实路径。

### 2.3 当前真正需要被优化的是上传 sidecar 本身

如果目标是：

- 单个大视频高吞吐
- 并行分片
- 强恢复
- 少手搓

那当前最值得替换的，不是前端 uploader，也不是后端领域模型，而是：

**上传 sidecar 的成熟度与生态质量。**

## 3. 官方路线给出的硬结论

官方资料的方向其实很清楚：

1. `@uppy/tus` 是 **client -> upload server** 的正路
2. `@uppy/aws-s3` + multipart 是 **client -> object storage** 的正路
3. 现在没有对象存储时，不能假装 multipart 已经是当前主路
4. `tusd v2` 是 tus 生态里更成熟、更主流、文档更厚、生产经验更多的 server 实现

这意味着：

- **未来**：对象存储到位后，大视频主路应该转向 multipart
- **现在**：没有对象存储时，最优雅的高吞吐路径不是“补一层 S3 兼容层”，而是“切到更成熟的 tus server 实现”

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

### 4.2 方案 B：现在切到 `tusd v2 + local disk`

内容：

1. 前端继续 `Uppy + @uppy/tus`
2. 上传 sidecar 从 `Rustus` 换成 `tusd v2`
3. 存储先用 `tusd` 本地盘后端
4. 后端主服务继续只负责：
   - `prepare`
   - 鉴权
   - hook 裁决
   - `complete`
   - `abandon / gc`

优点：

1. 继续站在 tus 这条成熟协议上
2. 不需要现在引入对象存储
3. 能减少自己围着 sidecar 补协议细节的手搓代码
4. 为未来迁移到 multipart 留下更干净的路径

缺点：

1. 需要做一轮 sidecar 切换
2. 需要重新适配 hook payload
3. 启动器、测试、运维脚本都要跟着调整

### 4.3 方案 C：现在就造 `S3兼容层.ts + S3兼容层.rs`

内容：

1. 提前抽象一层前后端 S3 兼容接口
2. 试图先统一未来对象存储形状

优点：

1. 看起来统一
2. 看起来像在为未来铺路

缺点：

1. 当前没有对象存储，这层抽象没有真实 owner
2. 很容易长成私有轮子
3. 会把当前问题从“上传侧”错误地转移成“抽象设计侧”
4. 并不能直接解决现在的大视频高吞吐问题

## 5. 最终裁决

本次采用 **方案 B：本地盘阶段切到 `tusd v2 + local disk`**。

一句话：

**现在最优雅的不是发明 `S3兼容层.ts/.rs`，而是把上传 sidecar 换成更成熟的 `tusd v2`，继续用本地盘，把真正的大视频高吞吐能力先站到成熟轮子上。**

## 6. 为什么不是 `S3兼容层.ts/.rs`

因为它不回答当前最真实的问题。

当前最真实的问题是：

1. 怎么让单大视频并行分片上传更稳、更快
2. 怎么减少我们自己补 sidecar 协议细节
3. 怎么在没有对象存储时也把这件事做成

而 `S3兼容层.ts/.rs` 回答的是另一个问题：

1. 如果未来有对象存储，前后端怎样统一接入接口

这是未来问题，不是现在问题。

更关键的是，仓库里后端已经有对象存储配置与 `attachment_store` 装配方向。  
再额外新建一层 `S3兼容层.rs`，很容易形成：

- 现有存储抽象一层
- 你新建的 S3 兼容层一层
- 真实 uploader / sidecar 适配再一层

这不是优雅，这是层数膨胀。

## 7. 本次设计目标

本次只回答这 4 件事：

1. 现在阶段的大视频高吞吐主路，改成 `tusd v2 + local disk`
2. 前端继续沿用 `Uppy + @uppy/tus`
3. 后端业务真相继续保持 `prepare / hook / complete / abandon / gc`
4. 未来对象存储到位后，再切到 multipart，而不是现在先造私有 S3 层

## 8. 明确非目标

本次明确不做：

1. 不引入正式对象存储
2. 不做 `S3兼容层.ts`
3. 不做 `S3兼容层.rs`
4. 不手搓 multipart 协议
5. 不自己造第二套 uploader
6. 不顺手重做媒体读取和分发链

## 9. 设计边界

### 9.1 前端边界

前端继续使用：

1. `Uppy`
2. `@uppy/tus`

前端不拥有：

1. 对象存储协议细节
2. S3 签名细节
3. 私有 S3 兼容 SDK

### 9.2 后端边界

后端主服务继续拥有：

1. 附件占位与授权
2. 上传会话真相
3. partial/final completion 裁决
4. `complete` 后的业务 ready 真相
5. abandon / gc

后端不应该继续拥有太多：

1. sidecar 私有协议补丁
2. 一堆围着某个 sidecar 特性的历史兼容代码

### 9.3 sidecar 边界

上传 sidecar 只做：

1. resumable upload
2. concatenation / locks / resumability
3. 本地盘持久化
4. hook 对接主服务

这正是 `tusd v2` 已经成熟覆盖的能力。

## 10. 迁移后的系统形态

### 当前阶段

系统形态应变成：

1. 浏览器：
   - `Uppy + @uppy/tus`
2. 上传 sidecar：
   - `tusd v2`
   - `local disk`
3. 主服务：
   - `prepare`
   - hook
   - `complete`
   - `abandon / gc`

### 未来阶段

未来对象存储到位后，再切：

1. 大视频：
   - `@uppy/aws-s3 multipart`
2. 直传目标：
   - `MinIO / S3-compatible`
3. 主服务：
   - 签名与完成裁决

也就是说，未来迁移点是：

**`tusd local disk` -> `multipart + object storage`**

而不是：

**先做一套私有 `S3兼容层`，再慢慢猜以后怎么迁。**

## 11. 预期收益

如果按这条路走，收益是：

1. 大视频高吞吐站到更成熟的 tus server 轮子上
2. hook / concatenation / locks / 恢复这类能力少手搓
3. 代码不再继续围着 `Rustus` 边角细节补洞
4. 未来切 multipart 的边界更清楚

## 12. 最终结论

这份 spec 的最终结论只有一句话：

**在“现在不用对象存储，但现在就要大视频高吞吐上传”的前提下，最优雅的路线不是新增 `S3兼容层.ts/.rs`，而是切到 `tusd v2 + local disk`，继续让 `Uppy + Tus` 这条成熟主链承担当前阶段的大视频并行上传。**

