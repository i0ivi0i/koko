# Graph Report - frontend/  (2026-04-13)

## Corpus Check
- 95 files · ~59,947 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 144 nodes · 179 edges · 18 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_媒体选择类型|媒体选择类型]]
- [[_COMMUNITY_壳层组件交互|壳层组件交互]]
- [[_COMMUNITY_HTTP实时传输|HTTP实时传输]]
- [[_COMMUNITY_测试支架接口|测试支架接口]]
- [[_COMMUNITY_前端测试替身|前端测试替身]]
- [[_COMMUNITY_真实链路测试|真实链路测试]]
- [[_COMMUNITY_媒体预处理上传|媒体预处理上传]]
- [[_COMMUNITY_聊天应用内核|聊天应用内核]]
- [[_COMMUNITY_Socket测试替身|Socket测试替身]]
- [[_COMMUNITY_消息渲染|消息渲染]]
- [[_COMMUNITY_应用Service Worker|应用Service Worker]]
- [[_COMMUNITY_滚动意图分发|滚动意图分发]]
- [[_COMMUNITY_浏览器应用平台|浏览器应用平台]]
- [[_COMMUNITY_HTTP接口错误|HTTP接口错误]]
- [[_COMMUNITY_控制台渲染|控制台渲染]]
- [[_COMMUNITY_CSS类型声明|CSS类型声明]]
- [[_COMMUNITY_媒体Service Worker|媒体Service Worker]]
- [[_COMMUNITY_WebTorrent类型声明|WebTorrent类型声明]]

## God Nodes (most connected - your core abstractions)
1. `读取媒体文件选择类型集合()` - 27 edges
2. `HttpRealtime传输` - 23 edges
3. `构造统一媒体文件选择配置()` - 11 edges
4. `假Socket` - 6 edges
5. `假Socket` - 5 edges
6. `dispatch()` - 4 edges
7. `snapshot()` - 3 edges
8. `renderVirtualMessageItem()` - 3 edges
9. `dispose()` - 3 edges
10. `exitCurrentRoomView()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `构造统一媒体文件选择配置()` --calls--> `revokeDraftPreviewUrl()`  [EXTRACTED]
  frontend\操作台\附件入口\附件能力注册.ts → frontend\聊天壳.ts
- `构造统一媒体文件选择配置()` --calls--> `snapshot()`  [EXTRACTED]
  frontend\操作台\附件入口\附件能力注册.ts → frontend\聊天应用内核.ts
- `构造统一媒体文件选择配置()` --calls--> `dispatch()`  [EXTRACTED]
  frontend\操作台\附件入口\附件能力注册.ts → frontend\聊天应用内核.ts
- `构造统一媒体文件选择配置()` --calls--> `createFakeStorage()`  [EXTRACTED]
  frontend\操作台\附件入口\附件能力注册.ts → frontend\tests\common\聊天测试支架.ts
- `构造统一媒体文件选择配置()` --calls--> `推导图片Mime类型()`  [EXTRACTED]
  frontend\操作台\附件入口\附件能力注册.ts → frontend\媒体\图片预处理.ts

## Communities

### Community 0 - "媒体选择类型"
Cohesion: 0.09
Nodes (1): 读取媒体文件选择类型集合()

### Community 1 - "壳层组件交互"
Cohesion: 0.1
Nodes (0): 

### Community 2 - "HTTP实时传输"
Cohesion: 0.16
Nodes (1): HttpRealtime传输

### Community 3 - "测试支架接口"
Cohesion: 0.13
Nodes (2): buildAttachmentContentUrl(), loadMediaLocator()

### Community 4 - "前端测试替身"
Cohesion: 0.15
Nodes (2): FakeWebTorrent, 假Socket

### Community 5 - "真实链路测试"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 6 - "媒体预处理上传"
Cohesion: 0.25
Nodes (8): 构造统一媒体文件选择配置(), 构造统一媒体文件Accept(), createFakeStorage(), 转码手机图片为标准Jpeg(), 推导图片Mime类型(), revokeDraftPreviewUrl(), 拉取受控Torrent字节(), 从Tus原始响应归一化失败响应()

### Community 7 - "聊天应用内核"
Cohesion: 0.33
Nodes (6): dispatch(), dispose(), exitCurrentRoomView(), leaveCurrentRoomView(), setTransportForTest(), snapshot()

### Community 8 - "Socket测试替身"
Cohesion: 0.47
Nodes (1): 假Socket

### Community 9 - "消息渲染"
Cohesion: 0.67
Nodes (3): renderMessageAttachments(), renderMessageBody(), renderVirtualMessageItem()

### Community 10 - "应用Service Worker"
Cohesion: 1.0
Nodes (0): 

### Community 11 - "滚动意图分发"
Cohesion: 1.0
Nodes (2): dispatchPointerScrollIntent(), dispatchScrollIntent()

### Community 12 - "浏览器应用平台"
Cohesion: 1.0
Nodes (0): 

### Community 13 - "HTTP接口错误"
Cohesion: 1.0
Nodes (1): Http接口错误

### Community 14 - "控制台渲染"
Cohesion: 1.0
Nodes (2): render(), renderShellConsole()

### Community 15 - "CSS类型声明"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "媒体Service Worker"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "WebTorrent类型声明"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `应用Service Worker`** (2 nodes): `向受控页面广播后台补发请求()`, `app-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `滚动意图分发`** (2 nodes): `dispatchPointerScrollIntent()`, `dispatchScrollIntent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `浏览器应用平台`** (2 nodes): `index.ts`, `获取默认浏览器应用平台()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `HTTP接口错误`** (2 nodes): `Http接口错误`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `控制台渲染`** (2 nodes): `render()`, `renderShellConsole()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `CSS类型声明`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `媒体Service Worker`** (1 nodes): `media-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `WebTorrent类型声明`** (1 nodes): `webtorrent.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `HTTP实时传输` to `壳层组件交互`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._
- **Why does `构造统一媒体文件选择配置()` connect `媒体预处理上传` to `壳层组件交互`, `测试支架接口`, `聊天应用内核`?**
  _High betweenness centrality (0.151) - this node is a cross-community bridge._
- **Why does `读取媒体文件选择类型集合()` connect `媒体选择类型` to `前端测试替身`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Should `媒体选择类型` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `壳层组件交互` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `测试支架接口` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._