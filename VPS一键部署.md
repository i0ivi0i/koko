# Koko VPS 一键部署

## 目标

这份文档只解决一件事：

- 让 `Koko` 以后可以通过 **GitHub Releases + 一条安装命令**，在一台全新的 Linux VPS 上完成：
  - 安装发布包
  - 写入运行配置
  - 安装并启用 `systemd` 服务
  - 安装并启用反向代理
  - 通过域名直接访问

这份文档不讨论本地开发体验；本地开发继续走 [run.ps1](/E:/koko/run.ps1)。

---

## 结论先说

未来要做成“一键安装自动启用”，**正确方向不是上传一个裸二进制**，而是上传一个 **标准 Linux 发布包**，再让安装器消费它。

当前仓库现状决定了真正可部署的最小发布单元至少包含：

- `koko` Linux 服务端二进制
- `dist/public`
- `migrations/`
- 运行配置约定

原因很直接：

- 服务端启动时依赖 `KOKO_DATABASE_URL`、`KOKO_ADMIN_TOKEN`、`KOKO_BIND_ADDR`，见 [support.rs](/E:/koko/src/support.rs)
- 服务端运行时直接读取 `dist/public` 作为静态前端目录，见 [http.rs](/E:/koko/src/http.rs)
- 前端产物 `dist/` 当前并不在 git 里，见 [.gitignore](/E:/koko/.gitignore)
- 数据库迁移当前仍然是独立步骤，不是服务启动内建能力，见 [run.ps1](/E:/koko/run.ps1)

一句话收口：

- **Build**：Linux 环境产出标准发布包
- **Release**：GitHub Releases 托管版本化发布物
- **Install**：`install.sh` 下载、校验、解压、写配置、启服务
- **Run**：`systemd + Caddy + PostgreSQL`

这和 12-Factor 的 `build / release / run` 分离是一致的：

- [The Twelve-Factor App: Build, release, run](https://12factor.net/build-release-run)
- [The Twelve-Factor App: Config](https://12factor.net/config)

---

## 生产拓扑

建议的正式生产拓扑：

```text
公网用户
  -> https://your-domain
  -> Caddy :80 / :443
  -> reverse_proxy 127.0.0.1:8080
  -> koko (systemd)
  -> PostgreSQL
```

约束如下：

- `koko` 只监听 `127.0.0.1:8080`
- 只有 Caddy 对公网开放 `80/443`
- `koko` 不直接暴露公网端口
- 应用日志走 stdout/stderr，由 `systemd/journald` 收集
- secrets 只进环境文件，不进入发布包

为什么选择 Caddy：

- 自动 HTTPS
- 配置更短
- 对单机单服务起步阶段更省心
- 对 WebSocket / 反向代理支持直接

官方文档：

- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

---

## 发布包设计

建议的发布包命名：

- `koko-x86_64-unknown-linux-musl.tar.gz`
- 可选再补：
  - `koko-aarch64-unknown-linux-musl.tar.gz`

推荐优先发布 `musl` 版本，是为了减少不同 Linux 发行版之间的运行时依赖差异。

参考：

- [Rust Platform Support](https://doc.rust-lang.org/rustc/platform-support.html)
- [Cargo build](https://doc.rust-lang.org/cargo/commands/cargo-build.html)

建议的发布包结构：

```text
koko-<version>-x86_64-unknown-linux-musl/
  bin/
    koko
  dist/
    public/...
  migrations/
    *.sql
  packaging/
    koko.service
    Caddyfile
  VERSION
  checksums.txt
```

发布包必须保持干净：

- 不带源码仓库
- 不带 `.git/`
- 不带 `target/`
- 不带本地日志
- 不带 secrets
- 不带机器相关绝对路径
- 不依赖目标机现场编译

---

## 服务器目录布局

建议统一成这套目录：

```text
/opt/koko/
  releases/
    <version>/
      bin/koko
      dist/public/...
      migrations/...
      packaging/...
  current -> /opt/koko/releases/<version>

/etc/koko/
  koko.env

/var/lib/koko/
  data/
```

说明：

- `/opt/koko/releases/<version>/` 保存不可变版本
- `/opt/koko/current` 是稳定软链
- `/etc/koko/koko.env` 保存环境变量
- `/var/lib/koko/` 只预留给未来本地持久化，不默认滥用

这样升级和回滚都能保持干净：

- 升级：解压新版本 -> 更新 `current` -> 重启服务
- 回滚：把 `current` 指回旧版本 -> 重启服务

---

## 环境变量

生产环境统一走 `/etc/koko/koko.env`：

```bash
KOKO_DATABASE_URL=postgres://user:password@127.0.0.1:5432/koko
KOKO_ADMIN_TOKEN=replace-with-strong-secret
KOKO_BIND_ADDR=127.0.0.1:8080
RUST_LOG=info
```

要求：

- 文件权限 `0600`
- root 管理
- 不进入 git
- 不写进 release 包
- 不写死到 `systemd` unit 正文
- 不通过命令行参数传递

systemd 官方支持 `EnvironmentFile=`：

- [systemd.exec](https://www.freedesktop.org/software/systemd/man/253/systemd.exec.html)

---

## systemd 设计

建议的 `koko.service`：

```ini
[Unit]
Description=Koko Chat Service
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=koko
Group=koko
WorkingDirectory=/opt/koko/current
EnvironmentFile=/etc/koko/koko.env
ExecStart=/opt/koko/current/bin/koko
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

设计要点：

- `Type=exec`
- 固定 `WorkingDirectory=/opt/koko/current`
- 让相对路径 `dist/public` 仍然稳定可用
- 失败自动拉起
- 配置从 `EnvironmentFile` 注入

相关文档：

- [systemd.service](https://www.freedesktop.org/software/systemd/man/255/systemd.service.html)
- [systemd.exec](https://www.freedesktop.org/software/systemd/man/253/systemd.exec.html)

---

## Caddy 设计

建议的 `Caddyfile`：

```caddy
your-domain.com {
    encode gzip zstd

    reverse_proxy 127.0.0.1:8080
}
```

第一版不建议把静态资源和 API 再拆成两套发布逻辑。  
当前仓库已经在同一个 Rust 进程里承接：

- `/`
- `/api/*`
- `/assets/*`
- `/wasm/*`
- `/socket.io`

所以公网入口越薄越好，直接整站反代给 `koko` 最稳。

后续若确实需要 CDN、静态文件分流、缓存精细控制，再考虑前移静态资源。

---

## 数据库迁移

迁移不应长期混进正式服务启动主链路。

正确姿势：

1. 安装器先把版本解压到目标目录
2. 安装器执行迁移
3. 迁移成功后再 `systemctl restart koko` 或 `enable --now`

当前仓库阶段，迁移可以继续按 `migrations/*.sql` 的顺序执行。  
但长期建议收敛到正式迁移工具链，例如 `sqlx migrate run`，避免永远靠裸 `psql -f`。

原则：

- **迁移失败时不得启动新版本服务**
- **服务启动不负责偷偷迁移数据库**

---

## 一键安装器职责

安装器建议命名为 `install.sh`。

它只负责：

1. 检测受支持平台
2. 下载 GitHub Release 对应版本 tarball
3. 校验 checksum
4. 解压到 `/opt/koko/releases/<version>/`
5. 更新 `/opt/koko/current`
6. 创建 `koko` 系统用户（如不存在）
7. 写入 `/etc/koko/koko.env`（首次安装）
8. 安装 `koko.service`
9. 安装 Caddy 配置
10. 执行数据库迁移
11. `systemctl daemon-reload`
12. `systemctl enable --now koko`
13. `systemctl enable --now caddy`

它不应该做：

- 不在目标机 `cargo build`
- 不现场跑前端 bundle
- 不把大段配置 heredoc 写成脚本垃圾块
- 不把 secrets 硬编码进脚本
- 不把服务运行和构建绑在一起

---

## 一条命令安装的最终形态

最终想达到的是：

```bash
curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | sudo bash
```

但这条命令成立的前提是：

- GitHub Releases 已经有版本化 Linux 发布包
- `install.sh` 已经按版本下载正确的 tarball
- 目标机属于受支持平台

更准确地说，不是“任何 Linux 都可以”，而是：

- 任何 **受支持的 Linux 服务器**
- 例如：
  - `x86_64`
  - `systemd`
  - 可访问 GitHub
  - 已准备 PostgreSQL
  - 可开放 `80/443`

---

## GitHub Releases 规范

推荐每个 release 至少包含：

- `koko-x86_64-unknown-linux-musl.tar.gz`
- `checksums.txt`
- `install.sh`

最好再补：

- 版本说明
- 迁移注意事项
- 升级/回滚说明

GitHub 官方关于 release 和完整性校验的参考：

- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)
- [Verifying the integrity of a release](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/verifying-the-integrity-of-a-release)
- [Immutable releases](https://docs.github.com/en/enterprise-cloud@latest/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases)

---

## CI / 构建职责

当前仓库更合理的未来分工是：

**本地开发机**

- `run.ps1`
- 本地调试
- 本地验证

**Linux CI / Builder**

- 构建 Linux release 二进制
- 生成 `dist/public`
- 组装 tarball
- 生成 checksum
- 上传 GitHub Releases

**Linux VPS**

- 下载 release
- 安装
- 启用服务
- 对外提供 HTTPS

这三层必须分开，不要再混回“本机脚本做完所有事”。

---

## 升级与回滚

### 升级

1. 下载新版本 release
2. 校验
3. 解压到 `/opt/koko/releases/<new-version>/`
4. 执行迁移
5. 更新 `/opt/koko/current`
6. `systemctl restart koko`
7. 验证 `/`、`/api/*`、`/socket.io`

### 回滚

1. 把 `/opt/koko/current` 指回旧版本
2. `systemctl restart koko`
3. 观察日志与健康检查

注意：

- 若迁移是不可逆的，回滚策略必须额外定义
- 这就是为什么数据库迁移策略需要单独审慎设计

---

## 生产验证清单

每次安装或升级后至少验证：

1. `systemctl status koko`
2. `systemctl status caddy`
3. `journalctl -u koko -n 100`
4. 首页 `/` 可访问
5. `/api/session/bootstrap` 正常
6. `/socket.io` 正常建立连接
7. 两个浏览器会话可实时互发消息
8. HTTPS 证书正常
9. `KOKO_ADMIN_TOKEN` 未泄露到日志和命令行

---

## 当前仓库到目标态之间还缺什么

这份文档描述的是 **目标发布/部署设计**。  
按当前仓库状态，真正落地前还缺：

1. Linux CI / Linux builder 产物链
2. 正式的 GitHub Release 组包脚本
3. `install.sh`
4. `koko.service` 模板文件
5. `Caddyfile` 模板文件
6. 明确的迁移执行入口
7. 生产安装后的自动验收脚本

---

## 最终原则

未来公网部署必须长期坚持这三条：

1. **服务器不是构建机**
2. **发布包必须干净、可校验、可回滚**
3. **安装器只做安装和启用，不做构建和临时拼装**

一句话收口：

**Koko 的正确公网部署方向，是“Linux 原生发布包 + GitHub Releases + install.sh + systemd + Caddy”，而不是把本地启动脚本继续演化成生产部署工具。**
