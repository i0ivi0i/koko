# Rustus 高吞吐部署与参数专项（2026）

## 这份笔记只回答什么

只回答：

**在继续保留 Rustus 作为 Tus sidecar 的前提下，哪些官方参数和部署边界会直接影响吞吐、并发和扩容。**

## 结论先行

1. Rustus 官方现在已经把高吞吐相关的基础开关暴露得比较完整：
   - `workers`
   - `max-body-size`
   - `max-file-size`
   - `tus-extensions`
2. `workers` 默认等于**物理 CPU 核心数**，不是无限开；官方也明确提醒“要谨慎修改”。
3. Rustus 官方支持的 `tus` 扩展里，包含：
   - `creation-with-upload`
   - `concatenation`
   - `checksum`
4. 如果你要把**单文件并行上传**做起来，Rustus 这一侧最大的官方前提不是 body size，而是：
   - 必须保留 `concatenation`
   - 并且要意识到拼接过程本身也会变成服务端负担
5. 如果做多实例扩容，Rustus 官方讲得很明确：**所有实例必须访问同一份 data 和 info storage**。否则扩容会直接出错。
6. Rustus 官方自带 `/metrics`，这对后续判断“慢在网络、hooks、磁盘还是拼接”很关键。
7. Rustus 的同步 HTTP hooks 仍然在热路径上；如果 hook 做得太重，会直接拖慢创建和完成阶段。
8. 如果未来切到 Rustus 的 S3 / hybrid-s3 存储，`concatenation` 的代价会上升，因为官方明确写了：**会先把 partial files 下载回来再拼接**。

## 官方证据

### 1. 配置与并发

- Rustus 官方配置页明确写了：
  - `--workers`
  - `--max-body-size`
  - `--max-file-size`
  - `--url`
  - `--cors`
  都属于服务端基础配置。  
  来源：[Rustus configuration](https://s3rius.github.io/rustus/configuration/)
- 官方还明确写了：`workers` 默认值等于**物理 CPU cores**，并提醒“谨慎调整”。  
  来源：[Rustus configuration](https://s3rius.github.io/rustus/configuration/)

### 2. 支持的 Tus 扩展

- 官方配置页写得很明确：默认启用的 `tus` 扩展包含
  - `creation`
  - `termination`
  - `creation-with-upload`
  - `creation-defer-length`
  - `concatenation`
  - `checksum`  
  来源：[Rustus configuration](https://s3rius.github.io/rustus/configuration/)

### 3. Hooks 对热路径的影响

- Rustus 官方 hooks 文档说明：
  - `pre-create` 和 `pre-terminate` 是阻断型 hook
  - HTTP hooks 默认超时是 `2` 秒
  - AMQP / Kafka 这类异步 hooks 不会阻断当前上传  
  来源：[Rustus hooks](https://s3rius.github.io/rustus/hooks/)
- 官方也明确写了：如果用了 `concatenation`，创建 final upload 后收到的不是 `post-create`，而是 `post-finish`。  
  来源：[Rustus hooks](https://s3rius.github.io/rustus/hooks/)

### 4. 扩容与部署

- Rustus 官方部署页明确写了：  
  **多实例时，所有 rustus 实例必须访问同一份 data 和 info storages。**  
  来源：[Rustus deployment](https://s3rius.github.io/rustus/deploy/)
- 官方还写了：
  - `/metrics` 端点可直接给 Prometheus 用
  - Kubernetes / Helm 下要配持久卷才能 scale  
  来源：[Rustus deployment](https://s3rius.github.io/rustus/deploy/)

### 5. S3 / hybrid-s3 的吞吐边界

- Rustus 官方配置页说明：
  - `s3` storage 直接写 S3，不落本地临时文件
  - 但它要求 chunk 除最后一块外必须大于 `5MB`
  - 如果需要更小块，考虑 `hybrid-s3`  
  来源：[Rustus configuration](https://s3rius.github.io/rustus/configuration/)
- 官方还明确写了：
  当执行 `concatenation` 时，Rustus 会把 partial files 从 S3 下载回来再拼接；`s3-concat-concurrent-downloads` 控制并发下载数，默认 `10`。  
  来源：[Rustus configuration](https://s3rius.github.io/rustus/configuration/)

## 对 `koko` 的直接意义

### 1. 现在只是把门禁解锁了，还没有把 Rustus 调成吞吐优先

当前 `run.ps1` 已经补了：

- `--max-body-size`
- `--max-file-size`

见 [run.ps1](</E:/koko/run.ps1:383>) 和 [run.ps1](</E:/koko/run.ps1:391>)。

但还没显式接这些更偏吞吐/部署的参数：

- `RUSTUS_SERVER_WORKERS`
- `RUSTUS_TUS_EXTENSIONS`
- `RUSTUS_BEHIND_PROXY`
- `/metrics` 采集

所以现在更像：

**先别被 200MB 门禁拦死了。**

而不是：

**Rustus 这层已经按公网高吞吐部署最佳实践调完了。**

### 2. 如果要做单文件并行上传，不能只改前端

因为一旦前端开 `parallelUploads`，服务端就必须正确处理：

- `concatenation`
- final upload 的 hook 语义
- partial uploads 的存储与拼接成本

而 Rustus 官方已经明确告诉你：

- 它支持 `concatenation`
- 但拼接不是“零成本魔法”
- 尤其 S3 / hybrid-s3 下，拼接会产生额外下载与合并工作

所以后面如果 `koko` 真要用 `parallelUploads`，必须把：

- 前端参数
- Rustus 扩展
- hooks 语义
- complete 阶段日志

一起看，不能只动一边。

### 3. 多实例部署时，当前本地开发主链不能直接等价外推

Rustus 官方说得很清楚：

- 多实例共享数据卷
- 多实例共享 info storage

而你当前本地开发链默认还是项目内目录。  
所以本地“能跑”不等于公网 Linux “能高并发 scale”。

## 我现在对下一轮部署/优化的判断

### 优先补

1. 显式接 `RUSTUS_SERVER_WORKERS`
2. 打开或接入 `/metrics`
3. 明确 Linux 公网部署时的数据目录 / info storage 方案
4. 如果要测 `parallelUploads`，必须确认 `concatenation` 没被禁掉

### 暂时别做

1. 还没量化指标前，就盲目把 `workers` 暴力拉高
2. 多实例下继续依赖不共享的本地 info storage
3. 在同步 HTTP hooks 里塞重逻辑

## 参考来源

- [Rustus configuration](https://s3rius.github.io/rustus/configuration/)
- [Rustus hooks](https://s3rius.github.io/rustus/hooks/)
- [Rustus deployment](https://s3rius.github.io/rustus/deploy/)
- [Rustus welcome](https://s3rius.github.io/rustus/)
