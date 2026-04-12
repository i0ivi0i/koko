# Graph Report - src/  (2026-04-13)

## Corpus Check
- Corpus is ~20,004 words - fits in a single context window. You may not need a graph.

## Summary
- 75 nodes · 98 edges · 12 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_后台房间接口|后台房间接口]]
- [[_COMMUNITY_系统装配支撑|系统装配支撑]]
- [[_COMMUNITY_媒体内容读取|媒体内容读取]]
- [[_COMMUNITY_Rustus Hook|Rustus Hook]]
- [[_COMMUNITY_媒体上传准备|媒体上传准备]]
- [[_COMMUNITY_前端入口响应|前端入口响应]]
- [[_COMMUNITY_Postgres仓储|Postgres仓储]]
- [[_COMMUNITY_上传完成闭环|上传完成闭环]]
- [[_COMMUNITY_房间历史查询|房间历史查询]]
- [[_COMMUNITY_程序启动入口|程序启动入口]]
- [[_COMMUNITY_房间事件查询|房间事件查询]]
- [[_COMMUNITY_库导出入口|库导出入口]]

## God Nodes (most connected - your core abstractions)
1. `领域错误` - 9 edges
2. `parse_attachment_content_query()` - 5 edges
3. `Pg仓储` - 5 edges
4. `handle_rustus_hook()` - 4 edges
5. `load_frontend_index()` - 3 edges
6. `推导rustus对外入口()` - 3 edges
7. `读取rustus_metadata字段()` - 3 edges
8. `读取媒体_tus对外地址()` - 3 edges
9. `handle_rustus_hook_pre_create()` - 3 edges
10. `handle_rustus_hook_post_finish()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `领域错误` --calls--> `require_admin()`  [EXTRACTED]
  src\领域\错误.rs → src\后台外壳.rs
- `领域错误` --calls--> `构建_s3客户端()`  [EXTRACTED]
  src\领域\错误.rs → src\外壳.rs
- `领域错误` --calls--> `Realtime仓储端口`  [EXTRACTED]
  src\领域\错误.rs → src\用例.rs
- `领域错误` --calls--> `尝试加载dotenv()`  [EXTRACTED]
  src\领域\错误.rs → src\总装.rs
- `领域错误` --calls--> `安装panic日志钩子()`  [EXTRACTED]
  src\领域\错误.rs → src\总装.rs

## Communities

### Community 0 - "后台房间接口"
Cohesion: 0.06
Nodes (18): AdminLoginBody, AdminLoginResp, ApiError, BootstrapBody, CompleteMediaUploadBody, JoinBody, ParsedAttachmentContentQuery, ParsedEventsQuery (+10 more)

### Community 1 - "系统装配支撑"
Cohesion: 0.22
Nodes (8): 领域错误, 尝试加载dotenv(), 读取exif方向(), 应用mp4展示方向到视频宽高(), 安装panic日志钩子(), Realtime仓储端口, require_admin(), 构建_s3客户端()

### Community 2 - "媒体内容读取"
Cohesion: 0.33
Nodes (6): 构造content_range值(), load_attachment_content(), load_media_locator(), load_media_torrent(), parse_attachment_content_query(), update_media_distribution_presence()

### Community 3 - "Rustus Hook"
Cohesion: 0.5
Nodes (5): handle_rustus_hook(), handle_rustus_hook_post_finish(), handle_rustus_hook_pre_create(), 读取rustus_hook名称(), 读取rustus_metadata字段()

### Community 4 - "媒体上传准备"
Cohesion: 0.5
Nodes (4): prepare_media_upload(), 推导rustus对外入口(), 读取媒体_tus对外地址(), 包装url主机()

### Community 5 - "前端入口响应"
Cohesion: 0.67
Nodes (3): err_resp(), 渲染前端入口_html(), load_frontend_index()

### Community 6 - "Postgres仓储"
Cohesion: 1.0
Nodes (1): Pg仓储

### Community 7 - "上传完成闭环"
Cohesion: 1.0
Nodes (2): 等待complete所需运输回执(), complete_media_upload()

### Community 8 - "房间历史查询"
Cohesion: 1.0
Nodes (2): load_room_history(), parse_history_query()

### Community 9 - "程序启动入口"
Cohesion: 1.0
Nodes (0): 

### Community 10 - "房间事件查询"
Cohesion: 1.0
Nodes (2): load_room_events(), parse_events_query()

### Community 11 - "库导出入口"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **18 isolated node(s):** `AdminLoginBody`, `AdminLoginResp`, `ApiError`, `协作分发torrent元信息写入请求`, `RealtimeConnectAuth` (+13 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `上传完成闭环`** (2 nodes): `等待complete所需运输回执()`, `complete_media_upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `房间历史查询`** (2 nodes): `load_room_history()`, `parse_history_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `程序启动入口`** (2 nodes): `main()`, `main.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `房间事件查询`** (2 nodes): `load_room_events()`, `parse_events_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `库导出入口`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Pg仓储` connect `Postgres仓储` to `后台房间接口`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `领域错误` connect `系统装配支撑` to `后台房间接口`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `parse_attachment_content_query()` connect `媒体内容读取` to `后台房间接口`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `AdminLoginBody`, `AdminLoginResp`, `ApiError` to the rest of the system?**
  _18 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `后台房间接口` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._