# Telegram 媒体查看器交互与轮子选型

- 整理日期：2026-04-12
- 结论用途：给群聊图片、视频、附件查看体验定方向，避免继续手搓媒体查看器轮子。

## Telegram 方向

Telegram 的关键逻辑不是“把播放器塞进聊天列表”，而是：

- 聊天流里的图片和视频只是入口。
- 点开图片或视频后，进入独立 media viewer。
- media viewer 里负责左右切换同一聊天的媒体、缩放、平移、保存、转发、删除等动作。
- GIF 才更偏向在聊天流里点按播放/停止；普通视频不应该按 GIF 逻辑塞进消息单元里长期播放。

参考来源：

- https://core.telegram.org/blackberry/chat-media-view
- https://telegram.org/blog/shared-media-join-requests-and-more/fr

落到本项目就是一句话：消息列表只展示预览和打开意图，真正观看交给独立媒体查看器。

## 我们的边界

当前前端是 Lit + TypeScript，不是 React / Vue；媒体查看器轮子优先级应该是：

1. 框架无关，能直接被 Lit 壳层薄适配。
2. 图片和视频都能进同一个 viewer，而不是图片一套、视频一套。
3. 支持移动端触摸、键盘导航、图片缩放、视频播放、动态数据源。
4. MIT 或足够清晰的开源许可证，避免 GPL / 商业授权先卡住项目。
5. 壳层只做适配和状态桥接，不把查看器能力重新手搓一遍。

## 候选轮子

### GLightbox

- npm：`glightbox@3.3.1`
- 许可证：MIT
- 体积：npm `dist.unpackedSize` 约 401 KB
- 形态：纯 JavaScript lightbox，无运行时框架绑定。
- 能力：图片、自托管视频、YouTube/Vimeo、iframe、inline content、键盘导航、触摸导航、图片缩放、动态 elements、可定制皮肤。
- 官方 README 直接支持 `elements` 动态数组和 `setElements()`，适合我们从消息展示项投影成 viewer slides。
- 初步判断：优先 POC。它最符合“不要为 Lit 项目引入 React 壳，也不要继续手搓”的方向。

参考来源：

- https://github.com/biati-digital/glightbox
- https://www.npmjs.com/package/glightbox

### Bigger Picture

- npm：`bigger-picture@1.1.20`
- 许可证：MIT
- 体积：npm `dist.unpackedSize` 约 328 KB
- 形态：JavaScript photo / video / iframe / HTML lightbox gallery。
- 能力方向很贴近“媒体查看器”，比旧包 `bigpicture` 更接近完整 gallery。
- 初步判断：第二候选。需要再做真实 POC 验证维护活跃度、API 稳定性和 TypeScript 接入质量。

参考来源：

- https://github.com/henrygd/bigger-picture
- https://www.npmjs.com/package/bigger-picture

### PhotoSwipe

- npm：`photoswipe@5.4.4`
- 许可证：MIT
- 体积：npm `dist.unpackedSize` 约 1.2 MB
- 优点：图片体验强，ESM、动态 import、手势和缩放成熟。
- 风险：官方文档明确说它主要为 photos 设计，视频/其他内容要通过 custom content、filters 或插件扩展；视频插件本身也标注仍在开发中且只支持 `<video>`。
- 初步判断：如果我们只做图片 viewer，它很强；如果要图片+视频统一 viewer，它不是第一选择。

参考来源：

- https://photoswipe.com/
- https://photoswipe.com/custom-content/
- https://github.com/dimsemenov/photoswipe-video-plugin
- https://www.npmjs.com/package/photoswipe

### lightGallery

- npm：`lightgallery@2.9.0`
- 许可证：GPLv3；商业项目需要商业许可。
- 体积：npm `dist.unpackedSize` 约 7.97 MB
- 优点：功能最全，图片、HTML5 视频、缩放、缩略图、全屏、旋转、触摸、键盘、插件体系都成熟。
- 风险：授权边界重；如果项目不是 GPLv3 兼容开源应用，就不能当普通 MIT 依赖随手引入。
- 初步判断：功能上强，许可证上谨慎；除非明确接受 GPLv3 或购买商业许可，否则不作为默认路线。

参考来源：

- https://www.lightgalleryjs.com/docs/settings/
- https://www.lightgalleryjs.com/license/
- https://www.npmjs.com/package/lightgallery

## 推荐下一步

先做 GLightbox 小步 POC，不直接大改主流程：

1. 增加一个极薄的 `媒体查看器适配器`，输入是当前房间的媒体展示项数组和起始 attachment id。
2. 把图片/视频映射成 GLightbox `elements`，图片走原图 URL，视频走原视频 URL。
3. 保留当前消息列表“只预览、不播放”的边界。
4. 用测试锁住：点击图片/视频时打开 viewer；viewer 关闭后回到聊天；列表中不出现可播放的 `controls` 视频。
5. POC 只验证一条竖切：一张图片 + 一个自托管视频 + 左右切换 + 关闭清理实例。

不建议下一步继续做的事：

- 不要继续给当前手搓 viewer 加更多按钮、缩放、拖拽和手势。
- 不要把视频播放重新塞回消息列表。
- 不要为了一个 viewer 引入 React/Vue 运行时。
- 不要在许可证没定清楚前引入 GPLv3 / 商业授权库。
