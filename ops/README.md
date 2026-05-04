# ops 目录说明

这一个目录只负责正式部署资产，不负责业务逻辑。

- `compose.yaml`
  正式运行主链。告诉 Docker 该怎么一起跑 `app / postgres / tusd / tracker / seeder / caddy`。

- `Caddyfile`
  正式公网入口。只让浏览器认识正式域名、`/files`、`/api/swarm/announce`。

- `env.production.example`
  生产环境变量模板。告诉你正式上线前哪些值必须填。

- `install.sh`
  首次安装脚本。空白 Debian 12 VPS 第一次准备目录和基础运行环境时用。

- `deploy.sh`
  日常部署脚本。升级版本时用。

- `rollback.sh`
  回滚脚本。新版本有问题时切回旧版本用。

- `healthcheck.sh`
  健康检查脚本。检查服务是不是真的活着，不靠猜。
