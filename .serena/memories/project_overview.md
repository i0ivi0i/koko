# koko 项目概览
- 目标：设备级花名匿名身份的最小群聊 MVP，核心是真实的房间、成员、消息、阅读锚点与图片附件主链。
- 主要能力：匿名身份 bootstrap、按短码进房/建房、房间快照与历史分页、实时消息、阅读推进、图片上传准备/直传/提交、后台房间统计与详情。
- 后端技术栈：Rust 2021、Tokio、Axum、SQLx(Postgres + migrate)、socketioxide、tower-http、object_store、image、infer、kamadak-exif、tracing。
- 前端技术栈：TypeScript、Lit、socket.io-client、xstate、@uppy/core、@uppy/aws-s3、heic2any、Vitest、esbuild。
- 当前开发环境：Windows 原生；仓库自带 `run.ps1` / `up.ps1` 作为开发启动入口。
- 代码总原则：DDD + 六边形边界，业务真相收口在 domain/usecase，contract 是多壳共享表面，adapter/shell 只做协议翻译与交互编排。