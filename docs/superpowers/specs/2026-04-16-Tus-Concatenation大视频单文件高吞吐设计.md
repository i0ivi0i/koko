# Tus Concatenation 大视频单文件高吞吐设计

日期：2026-04-16  
状态：Draft  
适用范围：`koko` 当前 Web 媒体上传主链，覆盖前端 `Uppy + @uppy/tus`、sidecar `Rustus`、后端 `prepare / rustus hook / complete`、上传失败回收与 transport 真相建模。  
关联资料：

- `docs/superpowers/specs/2026-04-15-上传吞吐专项优化-design.md`
- `docs/superpowers/specs/2026-04-15-媒体上传重试回收与分发资产生命周期-design.md`
- `学习/整理笔记/群聊媒体上传-Uppy-Tus-Rustus-高吞吐增量研究-2026.md`
- `学习/整理笔记/Rustus-高吞吐部署与参数专项-2026.md`
- `学习/整理笔记/当前koko上传主链-高吞吐差距清单-2026.md`

参考官方资料：

- [Uppy Choosing the uploader](https://uppy.io/docs/guides/choosing-uploader/)
- [Uppy Tus](https://uppy.io/docs/tus/)
- [tus protocol 1.0.x](https://tus.io/protocols/resumable-upload)
- [tus-js-client API](https://raw.githubusercontent.com/tus/tus-js-client/main/docs/api.md)
- [Rustus configuration](https://s3rius.github.io/rustus/configuration/)
- [Rustus hooks](https://s3rius.github.io/rustus/hooks/)

## 1. 为什么要单独补这一份 spec

昨天的修复只做了一件正确但克制的事：

**把大视频 `parallelUploads` 收回去，堵住当前会炸的错误路径。**

那次修复解决的是：

1. 大视频选择后不再因为 `pre-create` 缺少 `metadata.attachment_id` 直接炸掉
2. 前端不再假装自己已经支持 Tus 并行分片
3. 后端 `pre-create/post-finish` 的单运输回执真相暂时不再被破坏

但它没有解决的事实也必须说清：

1. 单个大视频的高吞吐并没有真正做回来
2. 之前那条路径不是“参数太激进”，而是“协议真相不匹配”
3. 现在的上传链依旧只擅长：
   - 多文件并发
   - 单资源 resumable upload
4. 它还不擅长：
   - 单个大视频的真正并行分片上传

所以这份 spec 不是“继续调常量”，而是正式回答：

**在“暂时还没有正式对象存储”的前提下，如何继续站在 `Uppy + Tus + Rustus` 这套成熟轮子上，把单大视频文件的高吞吐上传真正做回来。**

## 2. 当前现场事实

### 2.1 当前前端已经承认的真实边界

当前前端上传链有这些事实：

1. 文件级并发仍然存在，上传器会复用 `tusEndpoint + profile`
2. 大视频仍然会被分到 `large-video` 档位
3. 但 `large-video` 现在只是独立 uploader profile，不再打开 `parallelUploads`
4. `resume` 和 `restart` 已经在壳层语义上被分开：
   - `继续上传失败草稿()` 只允许同一上传继续
   - `重新上传失败草稿()` 会先 `abandon` 再重新 `prepare`

这条链说明：

**前端壳层真相已经比之前干净，但 transport 真相仍然是“一个附件一次只对应一条最终上传回执”。**

### 2.2 当前后端 transport 模型的真实边界

当前后端 `attachment_upload_transports` 事实上仍是单行模型：

1. `写入媒体上传运输授权_异步()` 以 `attachment_id` 为唯一冲突键写入授权
2. `更新媒体上传运输回执_异步()` 也是按 `attachment_id` 更新
3. `post-finish` 只登记：
   - `transport_upload_id`
   - `storage_locator`
   - `byte_size`
   - `finished_at`
4. `complete` 只等待一条 transport receipt 就绪

这条链意味着：

**当前领域真相根本没有位置容纳“一次上传会话里存在多个 partial uploads，再组合成一个 final upload”。**

### 2.3 当前 Rustus hook 的真实边界

当前 `RustusHookBody` 只建模了：

1. `id`
2. `offset`
3. `length`
4. `path`
5. `metadata`

而 `handle_rustus_hook_pre_create()` 当前明确依赖：

1. `metadata.attachment_id` 必须存在
2. `offset == 0`
3. `body.upload.length == prepare.字节大小`

`handle_rustus_hook_post_finish()` 当前明确依赖：

1. `offset == length`
2. 当前这是整附件完成回执
3. 落库时只写一条最终 locator

所以问题不是某个 if 写错了，而是：

**整个 hook 设计默认“一个附件只会看到一个完整上传资源”。**

## 3. 官方资料给出的硬边界

### 3.1 Uppy / tus 官方真实建议

结合官方资料，可以把最关键的话压成 5 句：

1. `@uppy/tus` 适合 `client -> your server`
2. 单文件并行上传不是普通并发参数，而是 Tus 协议的 `Concatenation` 扩展
3. 开 `parallelUploads` 后，普通 `metadata` 不会自动带到 partial uploads
4. partial uploads 需要额外的 `metadataForPartialUploads`
5. `chunkSize` 默认不要乱设，官方明确说随便设通常会伤吞吐

### 3.2 为什么现在还不该走 multipart

官方路线里，对浏览器大文件上传最成熟的高吞吐方案其实是 `multipart`。  
但它真正成立的前提是：

1. 浏览器直传对象存储
2. 服务端主要负责签名和权限，不再充当大字节流中转

而用户已经明确当前前提：

**暂时没有正式对象存储，未来才会有。**

所以当前阶段不能设计成：

- 先写一套半成品 multipart
- 再用本地文件系统或自家 HTTP 入口去模拟对象存储

那样只会变成第三套 transport 真相。

### 3.3 当前阶段的唯一正路

在没有对象存储的前提下，想把单大视频高吞吐做回来，当前最合理的主路只有：

**继续 `Uppy + Tus + Rustus`，但把 `Tus Concatenation` 做完整。**

没有更值得押的黑马协议。

## 4. 方案比较与裁决

### 4.1 方案 A：继续保持单资源上传，只优化多文件并发

内容：

1. 保持当前 `large-video` 不开 `parallelUploads`
2. 继续优化文件级并发和 `complete`
3. 不引入 partial/final transport

优点：

1. 最稳
2. 不改当前领域真相
3. 不需要 migration

缺点：

1. 单大视频吞吐上限仍然明显受限
2. 目标只能停在“别炸”，到不了“暴力高吞吐”

### 4.2 方案 B：正式实现 Tus Concatenation

内容：

1. 引入上传会话真相 `upload_session_id`
2. transport 从单资源模型升级为：
   - `single`
   - `partial`
   - `final`
3. 前端只对大视频恢复 `parallelUploads`
4. Rustus hook 区分 partial / final
5. `complete` 只消费 final concat

优点：

1. 仍然站在成熟轮子上
2. 不依赖对象存储
3. 真正把单大视频高吞吐做回来

缺点：

1. 这是一整期工程，不是热修
2. migration、测试、回收、观测都要一起升级

### 4.3 方案 C：等待未来对象存储，再直接切 multipart

内容：

1. 现在不做 Tus Concatenation
2. 等对象存储到位后直接上 multipart

优点：

1. 长期方向更优
2. 不在当前栈上做重工程

缺点：

1. 当前阶段单大视频高吞吐问题无解
2. 和用户当前目标冲突

### 4.4 最终裁决

本次采用 **方案 B：正式实现 Tus Concatenation。**

原因：

1. 用户明确要求的是“现在就把单大视频高吞吐做回来”
2. 当前没有对象存储，multipart 不是立即可落地主路
3. 继续死守单资源上传只会把单大视频卡死在现有上限

## 5. 设计目标与非目标

## 5.1 本次目标

本次只做 7 件事：

1. 让单个大视频重新支持真正的并行分片上传
2. 保持前端 `resume / restart` 语义继续干净
3. 让后端 transport 真相可以表达：
   - 一次上传会话
   - 多个 partial
   - 一个 final concat
4. 让 `complete` 只吃 final concat，杜绝 partial locator 串入
5. 让废弃上传、迟到 hook、partial 残留都有统一回收路径
6. 保持当前“业务成功只能由 `complete` 裁决”的边界
7. 为未来迁移到 multipart 留稳定迁移切口

## 5.2 明确非目标

本次明确不做：

1. 不引入正式对象存储
2. 不新增第二套自研上传协议
3. 不把上传成功偷换成附件 ready
4. 不顺手重做视频打包与播放链
5. 不把 `chunkSize` 变成新的调参战场
6. 不把 transport 真相下放给前端或 Rustus 自己决定

## 6. 核心设计

### 6.1 领域真相：从“单运输记录”升级成“上传会话”

以后系统里的权威真相不再是：

- `attachment_id -> 一条 transport`

而是：

- `attachment_id -> 一个当前上传会话`
- `upload_session_id -> 多条 transport 记录`

其中：

1. `attachment_id`
   - 仍然代表业务附件本身
2. `upload_session_id`
   - 代表一次 prepare/restart 后的运输生命周期
3. transport role
   - `single`
   - `partial`
   - `final`

这层语义必须收在应用层，而不是散落在：

- 前端草稿
- Rustus hook
- 临时文件目录名

### 6.2 为什么必须引入 `upload_session_id`

只靠 `attachment_id` 不够，原因有 4 个：

1. 同一个附件可能会经历多次 restart
2. partial uploads 和 final upload 都属于同一个附件，但不是同一条 transport
3. 迟到的 `post-finish` 必须能知道自己属于哪个会话
4. 未来迁移到 multipart 时，会话真相仍然可复用

所以：

**`attachment_id` 是业务附件锚点，`upload_session_id` 是运输生命周期锚点。**

### 6.3 数据模型调整

为了不制造第二套上传核心，本次不新增“平行 transport 系统”。  
推荐做法是：

#### 6.3.1 新增 `attachment_upload_sessions`

字段建议：

1. `upload_session_id`
2. `attachment_id`
3. `transport_kind`
4. `upload_token`
5. `token_expires_at`
6. `abandoned_at`
7. `final_upload_id`
8. `final_storage_locator`
9. `final_byte_size`
10. `final_finished_at`
11. `created_at`

职责：

1. 它是一次上传生命周期的 canonical owner
2. 它持有当前会话级 token 和 final 结果
3. `complete` 只读取这里的 final 事实

#### 6.3.2 `attachment_upload_transports` 改成会话下的多记录表

字段建议：

1. `upload_session_id`
2. `attachment_id`
3. `transport_role`
   - `single`
   - `partial`
   - `final`
4. `transport_upload_id`
5. `declared_byte_size`
6. `storage_locator`
7. `finished_at`
8. `abandoned_at`
9. `concat_order`
10. `created_at`

职责：

1. 只留运输事实
2. 不直接裁决附件 ready
3. partial/final 都在这里表达，但 canonical final 真相只回写到 session

#### 6.3.3 为什么不继续强撑单表单行模型

因为当前模型天然表达不了：

1. 同一附件同一会话下有多个 partial
2. partial 和 final 是不同角色
3. restart 后旧 session 与新 session 并存但互不复活

继续强撑单表单行，只会把一堆语义塞进：

- JSON 字段
- 命名约定
- 目录猜测

这不符合 DDD，也不符合 Unix。

### 6.4 前端设计

#### 6.4.1 `large-video` 恢复 `parallelUploads`

本次恢复的不是“拍脑袋并发”，而是：

1. `large-video` 重新开启 `parallelUploads`
2. 普通图片和小视频仍然维持现有策略
3. `parallelUploads` 变成显式 deploy-time transport 参数，而不是散落常量

第一版建议：

1. 默认 `parallelUploads = 4`
2. 本地压测档可升到 `6`
3. 不直接默认 `8+`

原因：

1. 官方建议是测量驱动，不是盲目拧到最大
2. 当前还没有对象存储，sidecar 和后端仍会吃一部分热压

#### 6.4.2 增加 `metadataForPartialUploads`

对大视频，前端必须显式补这两组 metadata：

1. final upload metadata：
   - `attachment_id`
   - `upload_session_id`
   - `file_name`
   - `mime_type`
   - `byte_size`
2. partial upload metadata：
   - `attachment_id`
   - `upload_session_id`

这是协议硬边界，不是可选优化。

#### 6.4.3 `resume / restart` 继续保持现在的语义

前端现有拆分是对的，本次不回退：

1. `resume`
   - 只能在同一 `upload_session_id` 内继续
2. `restart`
   - 必须先 abandon 旧 session，再重新 prepare 新 session

改变的只是：

**restart 以后，旧 session 下面可能有一堆 partial / final 残留要统一回收。**

### 6.5 Rustus / hook 设计

### 6.5.1 Rustus 必须显式启用 concatenation

启动器必须显式校准：

1. `tus-extensions` 至少包含 `concatenation`
2. 如果支持 unfinished concat，也必须明确是否开启
3. 需要评估是否打开 partial 删除能力

这里不让前端猜，也不让运维靠默认值碰运气。

### 6.5.2 先扩展 adapter，不把字段名渗进领域

当前 `RustusUploadBody` 太薄，只够单资源模型。  
本次第一步必须是：

1. 抓一份真实 concatenation hook 负载
2. 明确 Rustus hook 里怎么表达：
   - partial
   - final
   - partial URL 列表
   - unfinished concat
3. 扩展 adapter 层模型，把它们翻译成领域能理解的统一 transport 角色

这里要特别守住：

- 领域层只认 `transport_role / upload_session_id / upload_id / locator / byte_size`
- 具体是 `Upload-Concat` 还是其他 Rustus payload 字段，属于 adapter 细节

### 6.5.3 `pre-create` 规则变化

以后 `pre-create` 不再一刀切要求：

- `length == prepared.byte_size`

而是改成：

1. `single`
   - 仍要求等于整文件大小
2. `partial`
   - 允许 `< prepared.byte_size`
   - 但必须绑定到同一个 `upload_session_id`
3. `final`
   - 不再用整文件 `Upload-Length` 去判断
   - 重点验证它属于同一个 session，且 partial 集合成立

### 6.5.4 `post-finish` 规则变化

以后 `post-finish` 必须区分：

1. partial 完成
   - 只登记 part 已完成
   - 不得把 session 推成可 complete
2. final concat 完成
   - 才把 session.final locator / final upload id / finished_at 写成 canonical final 事实

一句话：

**partial `post-finish` 不是业务完成，只是运输阶段事实。**

### 6.6 `complete` 设计

`complete_media_upload()` 的读取口必须从：

- “按 `attachment_id` 找那一条 transport receipt”

变成：

- “按 `attachment_id` 找当前活跃 `upload_session_id`”
- “只接受该 session 的 canonical final locator”

这样才不会再发生：

1. partial locator 被误当整附件
2. restart 后旧 session 的 late callback 把旧 locator 复活

### 6.7 回收与清理设计

本次要新增 3 类回收：

1. `abandoned session` 回收
   - 删除旧 session 下未完成 partial / final 临时文件
2. `finished final` 后 partial 清理
   - 如果 Rustus 可自动删，就用成熟能力
   - 不能自动删，则由后台清理器显式删
3. `expired unfinished session` 回收
   - 长时间未完成的会话整体废弃并回收残留

清理器依然不能凭目录猜，必须只消费：

- `attachment_upload_sessions`
- `attachment_upload_transports`

里的权威事实。

## 7. 观测与运维

本次必须补齐这几个可观测锚点：

1. `attachment_id`
2. `upload_session_id`
3. `transport_role`
4. `transport_upload_id`
5. `request_id`
6. `storage_locator`
7. `final_storage_locator`

任何一条日志都至少能回答：

1. 这是哪个附件
2. 属于哪次上传会话
3. 是 partial 还是 final
4. 是被 abandon 了，还是 finished 了，还是被清理了

没有这组锚点，后面调极限吞吐只会回到“靠猜”。

## 8. 测试与验证门禁

### 8.1 必须先补的红测

前端：

1. `large-video` 恢复 `parallelUploads`
2. `metadataForPartialUploads` 必须带 `attachment_id + upload_session_id`
3. restart 后新旧 session 不串味

后端：

1. partial `pre-create` 合法时放行
2. final `pre-create` 合法时放行
3. partial `post-finish` 不会让附件变 ready
4. final `post-finish` 才能让 session 进入可 complete
5. late `post-finish` 不会复活 abandoned session
6. `complete` 在只有 partial 没有 final 时必须拒绝

清理：

1. abandoned session 清理幂等
2. finished final 后 partial 清理幂等
3. expired unfinished session 清理幂等

### 8.2 压测门禁

这期如果没有最少一组压测，就不能宣布“高吞吐做回来了”。

至少要测：

1. 单个大视频
   - `parallelUploads = 1`
   - `parallelUploads = 4`
   - `parallelUploads = 6`
2. 多文件并发 + 大视频混跑
3. 中断后 resume
4. restart 后旧 session 清理

关注指标：

1. 传输耗时
2. 失败率
3. 重试率
4. Rustus CPU/内存
5. 后端 CPU/内存
6. 残留文件数

## 9. 风险与回滚

### 9.1 主要风险

1. Rustus hook 对 concatenation 的真实负载形状与预期不一致
2. migration 处理不好会污染现有 transport 数据
3. partial/final 判定错误会导致 complete 吃错 locator
4. aggressive `parallelUploads` 可能把开发机和公网 Linux 服务器都压爆

### 9.2 回滚策略

回滚必须可一键收回到昨天的稳定边界：

1. 前端关闭 `parallelUploads`
2. 仍保留 `upload_session_id` 数据结构，但不再创建 partial/final
3. hook 兼容旧单资源路径
4. `complete` 继续只吃 `single/final` 的 canonical locator

也就是说：

**新模型要能向前兼容“单资源上传”，不能一上来把旧路炸死。**

## 10. 最终裁决

这份 spec 的结论只有一句话：

**在没有正式对象存储的前提下，想把单大视频文件的高吞吐真正做回来，唯一值得做的主路就是：**

**继续站在 `Uppy + Tus + Rustus` 上，把 `Tus Concatenation` 作为一等公民完整建模，而不是继续调参或继续找黑马协议。**

这件事的本质不是“把 `parallelUploads` 再打开”，而是把系统从：

- `attachment_id -> 单运输记录`

升级成：

- `attachment_id -> 当前 upload_session`
- `upload_session_id -> partial* + final`

只有做到这一步，单大视频高吞吐才不再是假象。
