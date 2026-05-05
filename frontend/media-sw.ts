// 不手搓 WebTorrent 浏览器侧 worker 协议，继续直接复用官方 sw 入口。
import "webtorrent/dist/sw.min.js";

/**
 * 2026-05-05 收尾裁决：
 * 1. 新附件正式图片/视频字节只认同一条 WebTorrent 主链；
 * 2. 因此前端不再额外接管 `/api/media/.../blob/canonical`，避免 CacheStorage 继续长成第二正式读取面；
 * 3. 历史图片若还需要冷备/迁移兼容，应由显式 legacy 路径承接，而不是偷偷复活这里的 fetch hook。
 *
 * 这里故意不注册自定义 `fetch` 监听：
 * - 正式媒体字节读取交给官方 WebTorrent worker；
 * - 非正式 legacy HTTP 读取由正常网络栈处理；
 * - 自定义媒体缓存逻辑在这一步先整体退场，避免继续制造“看起来更快、其实是第二主链”的假成功。
 */
