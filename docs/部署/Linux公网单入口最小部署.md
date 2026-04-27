# Linux 公网单入口最小部署

这份文档只回答一件事：未来把 `koko` 的源代码或二进制直接甩进 Linux `VPS` 后，怎样用**一套**网络真相稳定跑起来。

## 1. 总裁决

1. 浏览器公开入口只允许一个：`https://正式域名/`
2. 浏览器公开路径只允许两条主链：
   - `/files`
   - `/api/swarm/announce`
3. `tusd`、`tracker`、`seeder` 都是源站内部 sidecar，**禁止** 直接暴露给浏览器
4. 任何环境都**全面禁止严厉禁止** `cloudflared`
5. 公网只允许使用 `Cloudflare + 正式域名`，不允许再长第二条隧道入口

## 2. 最少环境变量

```dotenv
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/koko
ADMIN_PASSWORD=change-me
RUST_LOG=info
APP_PORT=8080

# 浏览器公开 contract
MEDIA_TUS_PUBLIC_ENDPOINT=/files
SWARM_TRACKER_PUBLIC_URL=/api/swarm/announce

# 内部 sidecar 通信
MEDIA_TUS_SERVER_PORT=1081
MEDIA_TUS_INTERNAL_BASE_URL=http://127.0.0.1:1081
SWARM_TRACKER_PORT=7072
SWARM_TRACKER_UPSTREAM_URL=ws://127.0.0.1:7072
SWARM_SEEDER_TRACKER_URL=ws://127.0.0.1:8080/api/swarm/announce

# 可选
SWARM_WEB_SEED_PUBLIC_ENDPOINT=
SWARM_TICKET_SECRET=change-me
SWARM_PEER_PRESENCE_STALE_SECONDS=180
```

## 3. 哪些属于公开入口，哪些属于内部 sidecar

公开入口：

1. `APP_PORT`
2. `MEDIA_TUS_PUBLIC_ENDPOINT=/files`
3. `SWARM_TRACKER_PUBLIC_URL=/api/swarm/announce`

内部 sidecar：

1. `MEDIA_TUS_SERVER_PORT`
2. `MEDIA_TUS_INTERNAL_BASE_URL`
3. `SWARM_TRACKER_PORT`
4. `SWARM_TRACKER_UPSTREAM_URL`
5. `SWARM_SEEDER_TRACKER_URL`

硬规则：

1. **禁止** 把内部 sidecar 地址返回给浏览器
2. **禁止** 把 `127.0.0.1`、`localhost`、`:1081`、`:7072`、`:7073` 暴露到浏览器 contract
3. **禁止** 出现“浏览器入口一套、上传下一跳一套、announce 下一跳再一套”的三份真相

## 4. 为什么正式部署不依赖 `run.ps1` / `https.ps1`

因为它们只是 Win11 本地开发适配层，不是产品网络真相 owner。

Linux 正式部署只需要保证：

1. 后端进程监听 `APP_PORT`
2. `tusd` 监听内部端口
3. `tracker` 监听内部端口
4. 反向代理把公网 `443` 收口到后端
5. 浏览器继续只走 `https://正式域名/`、`/files`、`/api/swarm/announce`

所以：

1. **禁止** 把 Windows 证书导入流程当成正式上线步骤
2. **禁止** 把 `run.ps1` / `https.ps1` 当成 Linux 必备组件
3. **禁止** 因为本地脚本好用，就把它们偷换成正式部署架构

## 5. 为什么任何环境都禁止 `cloudflared`

因为它会强行再长出第二套入口脑子：

1. 一套是 `Cloudflare CDN + 正式域名`
2. 另一套是本地隧道进程

这会直接制造：

1. 入口真相漂移
2. 调试链路漂移
3. 缓存平面漂移
4. 后续部署认知漂移

所以结论只有一句：

**本项目任何环境都禁止 `cloudflared`。**

## 6. Cloudflare CDN 公开平面裁决

Cloudflare CDN 负责：

1. 在 `443` 承接公网用户
2. 做边缘缓存
3. 做边缘加速

Cloudflare CDN 不负责：

1. 替你发明第二套源站入口
2. 替你掩盖内部 sidecar 地址泄漏
3. 替你兜住超出产品边界的大请求体

硬规则：

1. 浏览器公开主入口优先锁死 `443`
2. `80` 只允许跳转或兜底
3. **禁止** 把 `:2052`、`:2053`、`:2082`、`:2083`、`:2086`、`:2087`、`:2095`、`:2096`、`:8443`、`:8880` 当成免费 CDN 主平面
4. **禁止** 把“Cloudflare 能代理这个端口”偷换成“Cloudflare 免费 CDN 推荐缓存这个端口”

## 7. Cloudflare 免费缓存与上传现实

必须提前记住 4 件事：

1. 免费代理上传单请求体上限是 `100 MB`
2. 免费可缓存单文件上限是 `512 MB`
3. 默认缓存 key 会受完整 URL 和 query 影响
4. 带 `session_id`、token、一人一份 query 的媒体 URL 会把共享缓存命中率打碎

所以：

1. **禁止** 在无法证明单请求体低于 `100 MB` 之前，宣称上传链路已经适配 Cloudflare 免费代理
2. **禁止** 把 `512 MB` 以上视频默认宣传成“免费 CDN 可完整缓存”
3. **禁止** 把 `session_id`、用户 token、一人一份 query 混进希望全网共享缓存的媒体公开读路径

推荐公开读路径：

1. `/files/...jpg`
2. `/files/...webp`
3. `/files/...mp4`

## 8. 最小反向代理要求

无论你用 `Caddy`、`Nginx` 还是别的成熟代理，最终都必须满足：

1. `https://正式域名/` 进入后端
2. `/files` 也进入后端，再由后端代理到内部 `tusd`
3. `/api/swarm/announce` 进入后端，再由后端代理到内部 `tracker`
4. 源站内部 `tusd/tracker/seeder` 不直接对公网暴露

## 9. 上线前检查清单

1. 浏览器网络面板里不再出现 `127.0.0.1`、`localhost`、`:1081`、`:7072`、`:7073`
2. `prepare` 返回 `/files` 或同源 HTTPS 绝对地址
3. Tus `Location` 不再掉回 `http://` 或内部地址
4. announce 只走 `/api/swarm/announce`
5. 任何环境都没有再引入 `cloudflared`
6. Cloudflare 免费 CDN 主入口仍然锁在 `443`
7. 共享媒体 URL 不带 `session_id` 这类缓存污染 query
8. 上传如果继续走 Cloudflare 公开代理域名，已经有实证证明单请求体不超过 `100 MB`
