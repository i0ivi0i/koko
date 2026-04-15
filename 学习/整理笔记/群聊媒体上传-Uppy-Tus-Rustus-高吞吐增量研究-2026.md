# 群聊媒体上传 Uppy Tus Rustus 高吞吐增量研究（2026）

## 这份笔记只记什么

这不是旧笔记的重写版。  
这份只记录一件事：

**在继续保留 `Uppy + Tus + Rustus` 主链的前提下，单大文件上传和多文件并发上传的吞吐上限，到底卡在哪里。**

## 结论先行

1. `@uppy/tus` 里的 `limit` 只是在管“同时有多少个上传任务在跑”，不是自动帮你把**单个大文件**拆成并行上传。
2. `tus` 协议核心路径本来就偏向“**尽量一次大 PATCH 发完剩余字节**”，不是鼓励你默认切很多小块。
3. `tus-js-client` 官方明确说：`chunkSize` 默认应保持 `Infinity`，除非你**被请求体上限或输入流类型强迫**，否则不要主动设置；小块会明显伤吞吐。
4. `tus-js-client` 确实支持 `parallelUploads`，但它依赖 **concatenation extension**；而且维护方明确提醒：**在普通浏览器场景里，他们没看到对平均用户有明显收益**。
5. 如果想用当前栈继续榨吞吐，最有价值的不是乱调 `chunkSize`，而是：
   - 先把“**单文件并行分片**”和“**多文件并发**”区别开
   - 再基于服务端是否支持 `concatenation` 做 A/B 测试
6. `creation-with-upload` 可以少一次单独的 `PATCH` 往返；如果服务端支持，它是当前栈里少数明确可能改善首包到首进度时间的官方能力。
7. `addRequestId` 对纯吞吐没帮助，但对排查“到底慢在浏览器、代理、Rustus 还是后端 complete”非常有价值，适合尽快打开。

## 官方证据

### 1. Uppy 对 Tus 的官方说法

- `@uppy/tus` 官方文档明确写了：**所有选项都会透传给 `tus-js-client`**，只是在 Uppy 文档里只重点写它认为必需或有差异的部分。  
  来源：[Uppy Tus docs](https://uppy.io/docs/tus/)
- `limit` 的官方含义是：**限制同时进行的 upload 数量**。  
  来源：[Uppy Tus docs](https://uppy.io/docs/tus/)
- `chunkSize` 的官方默认值是 `Infinity`，并且 Uppy 直接警告：**不要设置，除非被强迫**。  
  来源：[Uppy Tus docs](https://uppy.io/docs/tus/)
- `retryDelays` 官方默认仍是 `[0, 1000, 3000, 5000]`。  
  来源：[Uppy Tus docs](https://uppy.io/docs/tus/)

### 2. tus 协议对 PATCH 的官方倾向

- `tus` 协议规范明确写了：客户端**应该把剩余字节尽量放进单个 PATCH 请求**；只有在某些明确需要的场景下，才会连续发多个较小 PATCH。  
  来源：[tus protocol 1.0.0](https://tus.io/protocols/resumable-upload)
- 协议同时明确写了：如果你要实现**并行上传同一文件**，应使用 **Concatenation** 扩展。  
  来源：[tus protocol 1.0.0](https://tus.io/protocols/resumable-upload)

### 3. tus-js-client 对吞吐参数的官方说法

- `chunkSize` 默认值是 `Infinity`，表示客户端会尝试**一次 PATCH 发完整文件剩余部分**。  
  来源：[tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)
- 官方明确写了：`chunkSize` 只有两类正当理由：
  - 输入是 reader / stream
  - 服务器或代理限制了请求体大小  
  来源：[tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)
- 官方还直接提醒：**小 chunk 会显著伤性能**，因为 HTTP 请求数会增加，额外开销会放大。  
  来源：[tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)
- `parallelUploads` 默认值是 `1`。如果大于 `1`，客户端会把输入文件拆成多个部分并行上传，最后依赖 **concatenation** 在服务端拼回。  
  来源：[tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)
- 维护方同时写得很直白：**请在真实环境下评估它是否真的带来吞吐收益，因为他们在普通浏览器会话里没有观察到平均用户性能提升。**  
  来源：[tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)
- `uploadDataDuringCreation` 如果为 `true`，在创建 upload 的 `POST` 里就会带上首段字节，能少一次额外 `PATCH`。  
  来源：[tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)
- `addRequestId` 会给每个 HTTP 请求加 `X-Request-ID`，用于把客户端错误和服务端日志对起来。  
  来源：[tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)

## 对 `koko` 的直接意义

### 1. 当前主链的吞吐瓶颈，先别怪到硬件上

当前 `koko` 代码里，前端只显式设置了：

- `limit = 3`
- `retryDelays = [0, 1000, 3000, 5000]`

见 [媒体发布.ts](</E:/koko/frontend/媒体/媒体发布.ts:80>) 和 [媒体发布.ts](</E:/koko/frontend/媒体/媒体发布.ts:207>)。

这说明现在做的只是：

- 控多文件并发数量
- 保持默认重试策略

**还没有启用单文件并行上传**，也没有根据大文件 / 多文件分别走不同上传策略。

### 2. 当前栈仍然有一条可实验但不能盲信的官方路径

因为 Uppy 官方写了“所有选项透传 tus-js-client”，而 tus-js-client 官方又提供了 `parallelUploads`，所以：

**可以推断 `@uppy/tus` 主链具备挂 `parallelUploads` 做实验的可能。**

但这里必须加边界：

- 这不是 Uppy 文档显式主推的高吞吐方案
- tus-js-client 官方自己都提醒了“平均浏览器用户不一定变快”
- 服务端还必须支持 `concatenation`

所以这更像：

**一条值得做 A/B 实测的通路，不是默认就稳赢的银弹。**

### 3. 现在最不该做的是“手痒就把 chunkSize 改小”

如果未来不是被这些硬约束逼着改：

- 代理 body limit
- sidecar body limit
- 输入源是 stream

那就**不要因为看起来更像分片上传**，就主动把 `chunkSize` 切小。  
按官方文档，这么做大概率只会：

- 增加 PATCH 请求数
- 放大 HTTP 开销
- 进一步拖慢单大文件吞吐

## 我现在对下一轮优化的判断

### 值得优先做

1. 把 UI 状态拆成“传输中 / 处理中”，先把**传字节慢**和**complete 慢**剥开。
2. 给 Tus 请求链加 `X-Request-ID`，让前端、Rustus、后端日志能串起来。
3. 在当前主链上做一次受控实验：
   - 仅对大视频启用 `parallelUploads`
   - 保持普通文件仍走默认单流上传
4. 保持 `chunkSize` 默认，除非后续真实链路证明代理/sidecar 限制逼着改。

### 暂时不该做

1. 为了“看起来更先进”直接把 `chunkSize` 改成固定小块
2. 把 `parallelUploads` 当成默认全量策略
3. 还没拆清楚“上传慢”和“complete 慢”之前，就草率重做整个传输层

## 参考来源

- [Uppy Tus docs](https://uppy.io/docs/tus/)
- [Uppy migration guides](https://uppy.io/docs/guides/migration-guides/)
- [tus protocol 1.0.0](https://tus.io/protocols/resumable-upload)
- [tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)
