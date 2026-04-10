# 群聊媒体上传切换到 Tus 与 Rustus 设计

日期：2026-04-11  
状态：Draft  
适用范围：`koko` 前端 TypeScript / 后端 Rust 的图片、视频上传主链  
关联文档：

- `docs/superpowers/specs/2026-04-10-群聊图片发送单链收口与复杂度清理-design.md`
- `docs/superpowers/specs/2026-04-10-群聊媒体P2P热分发与锚点持久化-design.md`

## 1. 背景

项目前一轮已经把“消息真相”和“附件真相”分开，主链收口成：

`prepare -> upload -> complete -> create_message`

这条方向本身是对的，因为：

- 上传字节成功，不等于附件 ready
- 附件 ready，不等于消息成立
- 消息是否成立，必须继续由应用层和领域层裁决，而不是由前端上传器自说自话

但是，当前运输层实现仍然存在根本性错位：

1. 前端上传器还在使用 `@uppy/aws-s3`
2. 当前和未来一段时间内，系统并不会真正使用 S3 / 对象存储直传
3. 本地与近期开 Linux 公网服务器阶段，实际仍然是自有服务接收上传字节
4. 业务又明确需要更稳的上传体验，尤其是图片/视频的中断恢复能力

这导致系统现在承担了一套“不属于当前阶段”的复杂度：

- 用 S3 风格插件去模拟本地上传
- 为了兼容 S3 风格回包而修一连串边缘契约
- 仍然得不到真正的断点续传

用户实测也已经暴露了这个方向的问题：

- 视频上传曾出现 `Failed to construct 'URL': Invalid URL`
- 修掉相对地址后，又出现 `This looks like a network error...`
- 这些症状并不代表网络设备有问题，而是说明当前 `AwsS3 + 本地回环 PUT` 主链和真实部署阶段不贴合

一句话：

**现在的问题不在 DDD 主链本身，而在运输层选错了成熟轮子。**

## 2. 为什么要改

### 2.1 当前 `AwsS3` 方案为什么不再适合

`@uppy/aws-s3` 的官方定位是：

- 浏览器直接上传到 S3 / S3 兼容对象存储
- 希望减少应用服务经手媒体字节
- 以对象存储直传为前提

这和当前阶段不匹配：

- 当前没有对象存储
- 近期开 Linux 公网阶段仍然没有对象存储
- 现在是应用服务和本地/共享磁盘接收上传
- 用户又想要断点续传

继续保留 `AwsS3`，就会出现两个结构性问题：

1. **协议错位**  
   代码继续假装“当前就是对象存储直传”，但真实环境并不是

2. **能力错位**  
   `shouldUseMultipart: false` 的单段 PUT 不是官方推荐的可恢复上传主路线，无法满足“中断后继续传”的目标

### 2.2 官方最佳实践为什么指向 Tus

根据 Uppy 官方文档：

- 如果要“可靠、可恢复、断点续传”，推荐使用 `@uppy/tus`
- `resumeAll()` 这类恢复行为只对可恢复上传器有效，例如 Tus
- `GoldenRetriever` 只能帮助浏览器意外关闭后的本地恢复，不等于真正的服务端断点续传

对应官方文档：

- `Choosing the uploader you need`
- `Tus`
- `Golden Retriever`

所以，对当前项目而言，正确问题不是：

“怎么继续把 `AwsS3` 改得像本地上传一样”

而是：

**“既然现在和近期开 Linux 公网阶段都不是对象存储直传，那为什么不直接切回官方更匹配的 `Tus`？”**

## 3. 目标

本设计要达成以下目标：

1. 把当前图片/视频上传主链从 `AwsS3` 切换到 `Tus`
2. 保留现有 `prepare -> complete -> create_message` DDD 主链
3. 让运输层真正具备断点续传能力
4. 不手搓 tus 协议端点、不手搓断点续传记录器、不手搓 offset 恢复逻辑
5. 保持前端图片和视频共用同一条 canonical 上传链
6. 让当前本地开发和未来一段时间内的 Linux 公网部署，都能用同一套上传主链

## 4. 非目标

本设计明确不做以下事情：

1. 不改动“消息只引用 ready 附件”的业务规则
2. 不把 Rustus 变成业务系统的一部分
3. 不在本轮同时落地对象存储直传
4. 不把 `GoldenRetriever` 当作主链真相
5. 不在本轮同时落地媒体查看侧的 P2P / WebTorrent 逻辑
6. 不用这次迁移顺手手搓一个私有 Tus server

这份文档只解决：

**群聊图片/视频上传主链如何从错误的 `AwsS3` 仿真切回到更真实、更稳的 `Tus + Rustus`。**

## 5. 候选方案与裁决

### 5.1 方案 A：继续 `AwsS3 + 本地回环 PUT`

不推荐。

优点：

- 现有代码改动看起来最少

缺点：

- 继续背负和当前阶段不匹配的对象存储心智
- 仍然没有真正的断点续传
- 还会继续踩浏览器预检、S3 风格回包、相对地址/绝对地址之类的边缘坑

### 5.2 方案 B：退回 `XHRUpload`

部分可行，但不是推荐答案。

优点：

- 比 `AwsS3` 更贴近当前“自有服务接收上传”的现实
- 实现复杂度低

缺点：

- 不是官方推荐的 resumable 方案
- 无法从根上解决“大文件/弱网/中断恢复”问题
- 对图片还能凑合，对视频不够稳

### 5.3 方案 C：前端 `@uppy/tus` + 后端 `Rustus` sidecar

推荐。

优点：

- 符合 Uppy 官方对 resumable uploads 的最佳实践
- Rust 生态内有成熟的 `Rustus`
- 不需要自己实现 tus 协议
- 可以保留现有 `prepare -> complete -> create_message`
- 对本地开发和近期开 Linux 公网部署都适用

缺点：

- 需要新增一个 sidecar 进程
- 需要重新定义 `prepare` 的返回契约
- 需要在主服务与 Rustus 之间增加 hook / shared storage 接线

### 5.4 最终裁决

本项目上传运输层固定切换到：

**前端 `@uppy/tus` + 后端 `Rustus` sidecar**

同时保留：

**`prepare -> complete -> create_message`**

这条决定有两个核心含义：

1. Tus 只替换运输层，不替换领域主链
2. Rustus 只是 sidecar 基础设施，不是业务真相拥有者

## 6. 分层裁决

这一节是防止实现漂移的核心约束。

### 6.1 Domain

领域层继续只拥有这些真相：

- 附件是否存在
- 附件属于谁
- 附件当前业务状态是否为 `prepared / ready / degraded / deleted`
- 哪些附件允许进入消息
- 哪些会话有权查看附件

领域层绝不拥有：

- Tus upload id
- upload offset
- PATCH 已经传了多少字节
- Rustus 临时存储路径
- 浏览器当前是否 pause / resume

### 6.2 Application

应用层继续负责：

- `prepare`
- `complete`
- `create_message`
- 查询媒体 locator

应用层可以使用“上传回执”来判断某个 prepared 附件是否已经有完整字节可供 `complete` 使用，  
但这个上传回执只是运输层事实，不直接等于附件 ready。

### 6.3 Adapter

adapter 负责：

- `Rustus` sidecar 接入
- Rustus hooks
- 共享上传目录读取
- 前端 `@uppy/tus`
- 开发启动器如何同时拉起主服务和 Rustus

adapter 不负责：

- 消息成立
- 附件 ready 判定
- 权限裁决

### 6.4 Shell / Frontend

前端壳层继续只负责：

- 文件选择
- 本地预览
- 进度展示
- 失败重试
- watchdog / stalled 体验态
- 在上传成功后调用 `complete`

前端不拥有：

- ready 真相
- 消息成立真相
- Rustus upload id 真相

## 7. Rustus 的角色

### 7.1 Rustus 是什么

`Rustus` 是成熟的 Rust Tus server，实现的是：

- `POST`
- `HEAD`
- `PATCH`
- 断点续传
- Upload Metadata
- Hook 机制

也就是说：

**Rustus 是“字节运输服务”，不是“聊天附件服务”。**

### 7.2 Rustus 负责什么

Rustus 只负责：

- 接收浏览器的 tus 上传请求
- 维护 upload offset
- 在中断后继续上传
- 把原始字节写入自己的上传目录
- 通过 hooks 把运输层事件通知主服务

### 7.3 Rustus 不负责什么

Rustus 不负责：

- 建立附件真相
- 决定附件 ready
- 解码图片
- 校验视频业务元数据
- 创建消息
- 裁决谁能发消息

## 8. Canonical 上传主链

最终 canonical 上传主链固定为：

1. 前端选图/选视频
2. 前端做本地预处理
3. 前端调用主服务 `prepareMediaUpload`
4. 主服务创建 `prepared attachment`
5. 主服务返回 tus 上传参数
6. 前端把文件交给 `@uppy/tus`
7. `@uppy/tus` 与 `Rustus` 完成 `POST/HEAD/PATCH` 断点续传
8. Rustus `post-finish` hook 通知主服务“这个附件的原始字节已经完整上传”
9. 前端收到 `upload-success` 后调用 `completeMediaUpload`
10. 主服务校验运输回执 + 读取共享上传目录里的文件
11. 主服务解码图片 / 校验视频 / 生成缩略图或封面
12. 主服务把 prepared 升级成 ready
13. 前端只在 ready 后允许进入 `create_message`

关键裁决：

**上传完成 ≠ ready**  
**ready ≠ 消息成立**

## 9. `prepare` 契约设计

### 9.1 旧契约

当前 `prepare` 返回的是 `AwsS3` 风格：

- `attachment_id`
- `upload_method: "PUT"`
- `upload_url`
- `upload_headers`
- `expires_at`

### 9.2 新契约

切到 Tus 后，`prepare` 返回契约改为：

- `attachment_id`
- `kind`
- `upload_method: "tus"`
- `tus_endpoint`
- `tus_headers`
- `tus_metadata`
- `expires_at`

### 9.3 字段含义

- `attachment_id`
  业务主键，后续 `complete/create_message/diagnostics` 都继续用它

- `tus_endpoint`
  Rustus 的上传入口基础地址，例如 `http://127.0.0.1:1081/files`

- `tus_headers`
  给 `@uppy/tus` 使用的请求头，至少包含上传令牌

- `tus_metadata`
  发给 Rustus 的 Upload Metadata，至少包含：
  - `attachment_id`
  - `file_name`
  - `mime_type`
  - `byte_size`

- `expires_at`
  仍然保留，用于控制 upload token 的时效与前端超时诊断

### 9.4 为什么还需要 `prepare`

因为 `prepare` 不是为了生成一个 URL，而是为了建立 prepared 附件真相。  
即便运输层换成 Tus，这件事也不能消失。

## 10. 上传令牌与元数据设计

### 10.1 为什么不能直接裸开 Rustus

如果浏览器直接裸连 Rustus，不经过主服务签发的上传令牌，就会失去：

- 会话约束
- 附件归属约束
- 上传大小约束
- 上传目标和业务附件的稳定关联

这会让运输层反客为主，属于边界退化。

### 10.2 设计裁决

主服务在 `prepare` 时签发 `upload_token`，前端不需要理解内部结构，只负责原样带给 `@uppy/tus`。

推荐形态：

- `Authorization: Bearer <upload_token>`

Rustus 通过 hook 把这个头透传给主服务校验。

### 10.3 metadata 与 token 的分工

- `token`
  证明“这个浏览器确实被允许上传这个附件”

- `metadata`
  负责描述“这次上传在运输层是什么”

不要把这两者混成一个随便拼接的私有协议。

## 11. Rustus Hooks 设计

根据 Rustus 官方文档，`pre-create`、`post-create`、`post-receive`、`pre-terminate`、`post-terminate`、`post-finish`
都是内建 hook 事件；同时 Rustus 支持通过 `--hooks-http-proxy-headers` 把指定请求头代理给 hook 接收方。  
本项目只使用：

- `pre-create`
- `post-finish`

并要求至少代理：

- `Authorization`

这样主服务才能验证上传令牌，而不需要手搓额外旁路协议。  
本项目必须用 hook 做接线，不能手搓旁路扫描器或目录轮询器。

### 11.1 `pre-create`

用途：

- 校验 `upload_token`
- 校验 `attachment_id`
- 校验 `metadata.byte_size`
- 校验是否对应一个当前仍有效的 `prepared attachment`

若校验失败，必须阻止 upload creation。

### 11.2 `post-finish`

用途：

- 把“运输层已收到完整文件”记录成一条**上传回执**
- 记录字段至少包括：
  - `attachment_id`
  - `rustus_upload_id`
  - `storage_locator`
  - `byte_size`
  - `finished_at`

这条回执不是 ready 真相，只是供 `complete` 使用的运输层事实。

### 11.3 为什么不用 `post-receive` 当业务成功

`post-receive` 只能说明收到一段字节，不说明上传完成。  
把它当成功语义属于假成功，必须禁止。

## 12. 上传回执

### 12.1 为什么需要上传回执

如果不显式记录“这个 prepared 附件已经有完整原始字节”，`complete` 就只能：

- 直接猜测 Rustus 文件是否存在
- 或者把 Rustus upload id 当业务主键

这两条都不优雅。

### 12.2 设计要求

上传回执属于 adapter/application 边界上的运输事实，  
它不是 domain 的 ready 状态，也不应该塞进壳层。

推荐最小字段：

- `attachment_id`
- `transport_kind = "tus"`
- `transport_upload_id`
- `storage_locator`
- `finished_at`
- `byte_size`

### 12.3 状态关系

- `prepared + 没有回执`
  不能 complete

- `prepared + 有完整上传回执`
  可以 complete

- `ready`
  只有 complete 成功后才能进入

## 13. `complete` 设计

`complete` 继续是附件真相升级点，不能被删除。

### 13.1 `complete` 要做什么

- 读取 prepared 附件
- 读取上传回执
- 打开 Rustus shared upload dir 中的原始文件
- 按媒体种类处理：
  - 图片：校验图片、宽高、缩略图
  - 视频：校验视频 MIME、元数据、封面图或最小可渲染事实
- 写入 canonical 附件存储
- 删除或标记已消费的 Rustus 临时上传对象
- 把附件升级成 ready

### 13.2 `complete` 不做什么

- 不重新上传
- 不让前端直接传 ready 快照
- 不直接创建消息

## 14. 前端设计

### 14.1 `frontend/媒体/媒体发布.ts`

从：

- `@uppy/aws-s3`

切到：

- `@uppy/tus`

职责不变：

- 还是只负责媒体草稿体验态与上传编排
- 继续在上传成功后调用 `completeMediaUpload`

### 14.2 `frontend/传输.ts`

`prepareMediaUpload` 返回值从 `PUT` 契约改成 `Tus` 契约。  
这一层继续负责：

- 地址绝对化
- 契约收口
- 不让壳层知道 sidecar 细节

### 14.3 `frontend/媒体/媒体诊断.ts`

继续以 `attachment_id` 为主诊断锚点，不改成以 `rustus_upload_id` 为主。  
这是为了防止运输层 id 反客为主。

### 14.4 `GoldenRetriever`

本轮不作为必选主链能力，只作为第二阶段增强项。  
原因：

- 它不是断点续传真相
- 它解决的是“浏览器意外关闭/刷新后的本地恢复”
- 先把 Tus 主链跑稳，再决定要不要加它

## 15. 文件与模块边界

### 15.1 前端

继续使用：

- `frontend/媒体/媒体草稿.ts`
- `frontend/媒体/媒体发布.ts`
- `frontend/媒体/媒体诊断.ts`
- `frontend/媒体/图片预处理.ts`
- `frontend/媒体/视频元数据.ts`

不为了接入 Tus 再拆更多碎文件。  
本轮应优先在现有 `媒体` 目录里收口，而不是制造新的碎片化层次。

### 15.2 后端

主服务继续保持现有 Rust 文件边界，不为 Tus 迁移随意新增一堆 `.rs` 文件。  
新增内容优先收口在：

- `外壳.rs`
- `房间外壳.rs`
- `用例.rs`
- 现有仓储与适配文件

只有在共享上传回执确实需要独立抽象，且现有文件边界已经明显过载时，才允许小心新增文件。

## 16. 开发与部署编排

### 16.1 本地开发

`run.ps1` 需要同时拉起：

- 主 Rust 服务
- Rustus sidecar
- 前端 watcher

Rustus sidecar 的最小运行约束写死为：

- 使用官方 `pre-create,post-finish` hooks
- 使用 HTTP hooks 回调主服务
- 代理 `Authorization` 请求头给 hook 处理器
- 使用独立上传目录
- 该上传目录对主服务可读，以便 `complete` 消费原始上传结果

### 16.2 近期开 Linux 公网部署

仍然采用：

- 主服务进程
- Rustus sidecar
- 同机共享上传目录

这是为了减少当前阶段的部署变量。  
等未来真的要上对象存储，再决定 Rustus 存储后端是否切到 S3 兼容模式。

主服务与 Rustus 的边界也写死：

- Rustus 目录是运输层临时目录，不是 canonical 附件存储
- `complete` 成功后，主服务要把需要长期保留的附件内容迁入自己的 canonical 附件存储
- 不允许让消息长期直接引用 Rustus 临时上传目录

## 17. 可观测性与诊断

### 17.1 统一诊断锚点

继续统一以：

- `attachment_id`

作为前后端诊断主键。

### 17.2 必须记录的事件

- `prepare succeeded / failed`
- `rustus pre-create allowed / denied`
- `rustus post-finish received`
- `complete succeeded / failed`
- `create_message rejected because attachment not ready`

### 17.3 明确禁止

禁止把这些当成功：

- 浏览器已开始上传
- Tus 已创建 upload id
- post-receive 收到部分字节
- 前端本地显示 `upload-success` 但 `complete` 还没成功

## 18. 测试策略

### 18.1 TDD 顺序

必须先写失败测试，再改实现。

### 18.2 后端测试

至少要覆盖：

- `prepare` 返回 Tus 契约
- `pre-create` 非法 token 被拒绝
- `post-finish` 会写上传回执
- 没有上传回执时 `complete` 被拒绝
- 有上传回执时图片 `complete` 成功
- 有上传回执时视频 `complete` 成功
- ready 附件才能 `create_message`

### 18.3 前端测试

至少要覆盖：

- `prepareMediaUpload` 收到 `upload_method = "tus"`
- `媒体发布器` 能把 `tus_endpoint / tus_headers / tus_metadata` 交给 Uppy Tus
- 图片上传成功后触发 `complete`
- 视频上传成功后触发 `complete`
- 失败后草稿不消失
- 旧 `AwsS3` 主链被彻底删除

### 18.4 集成测试

至少要覆盖：

- 图片上传中断后可继续
- 视频上传中断后可继续
- 上传完成前不能 `complete`
- `complete` 失败不会让草稿凭空消失
- `run.ps1` 启动后能同时访问主服务与 Rustus

## 19. 迁移顺序

迁移必须小步走，顺序固定如下：

1. 引入 Rustus sidecar 与本地启动编排
2. 定义新的 `prepare` Tus 契约
3. 主服务接入 Rustus hooks
4. 建立上传回执最小模型
5. 前端从 `@uppy/aws-s3` 切到 `@uppy/tus`
6. 打通图片主链
7. 打通视频主链
8. 删除旧 `AwsS3` 上传链
9. 最后再评估是否引入 `GoldenRetriever`

这个顺序不能反。  
尤其不能先加 `GoldenRetriever`，也不能先让前端切 Tus 却没有后端 hook / 回执模型。

## 20. 明确删除项

本轮完成后，以下内容必须被删除：

- `@uppy/aws-s3`
- 现有 `PUT upload_url + upload_headers` 作为 canonical 上传契约的主链
- 围绕 `AwsS3` 单段 PUT 的特殊错误补丁
- 任何“为本地仿真对象存储”而存在的第二套上传判断

如果实现完成后 `AwsS3` 和 `Tus` 还双活，就说明这轮迁移失败了。

## 21. 风险与缓解

### 21.1 风险：sidecar 增加部署复杂度

缓解：

- 先只做同机 sidecar
- 不在本轮引入额外分布式存储变量

### 21.2 风险：上传完成与 ready 语义混淆

缓解：

- 明确引入“上传回执”而不是直接把 post-finish 视为 ready

### 21.3 风险：Tus id 反客为主

缓解：

- 所有业务日志、诊断、complete/create_message 继续以 `attachment_id` 为主键

### 21.4 风险：为接入 Rustus 再长私有胶水层

缓解：

- 只允许 hook + transport 适配
- 禁止私有 Tus 协议核心

## 22. 完成标准

只有同时满足以下条件，才算迁移完成：

1. 图片和视频都走 `Tus + Rustus`
2. 前端不再使用 `@uppy/aws-s3`
3. `prepare -> complete -> create_message` 主链未被破坏
4. 上传中断后能继续
5. `complete` 失败时草稿不会消失
6. 旧上传链彻底删除
7. 本地开发和近期开 Linux 公网部署都能使用同一套主链

## 23. 总结

这次迁移不是“推翻原来的 DDD 设计”，而是把上传运输层从错误的轮子切回到更贴合当前阶段的成熟轮子。

应该保留的东西：

- `prepare -> complete -> create_message`
- 附件真相和消息真相分离
- 诊断主键继续以 `attachment_id` 为核心

应该删除的东西：

- `AwsS3` 仿真本地上传主链
- 因为假装对象存储直传而长出来的额外契约复杂度

最终目标不是“技术上更酷”，而是：

**让群聊图片/视频上传在当前现实阶段更稳、更真、更容易维护，并且不再重复造轮子。**
