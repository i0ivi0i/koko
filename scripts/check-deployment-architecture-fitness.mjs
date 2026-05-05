#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const 允许的检查范围 = new Set(["runtime", "scripts", "workflows", "full"]);

const 运行主链必需文件 = [
  ".dockerignore",
  "Dockerfile",
  "ops/Caddyfile",
  "ops/compose.yaml",
];

const 脚本主链必需文件 = [
  "ops/README.md",
  "ops/env.production.example",
  "ops/package-release.sh",
  "ops/install.sh",
  "ops/deploy.sh",
  "ops/rollback.sh",
  "ops/healthcheck.sh",
];

const Workflow主链必需文件 = [
  ".github/workflows/initial-deploy.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/rollback.yml",
];

const 需要扫描禁词的部署文件 = [
  ".dockerignore",
  "Dockerfile",
  "ops/Caddyfile",
  "ops/compose.yaml",
  "ops/env.production.example",
  "ops/package-release.sh",
  "ops/install.sh",
  "ops/deploy.sh",
  "ops/rollback.sh",
  "ops/healthcheck.sh",
  ".github/workflows/initial-deploy.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/rollback.yml",
];

const Dockerignore关键排除项 = [
  [".git"],
  ["docs"],
  ["tests"],
  ["graphify-out"],
  [".codex-*.log", ".codex"],
  ["frontend/node_modules", "frontend/node_modules/"],
  ["frontend/dist", "frontend/dist/"],
  ["frontend/tests", "frontend/tests/"],
];

function 读取命令行参数(argv) {
  let scope = "full";
  let rootDir = process.cwd();
  let reportMode = false;
  let enforceMode = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") {
      reportMode = true;
      continue;
    }
    if (arg === "--enforce") {
      enforceMode = true;
      continue;
    }
    if (arg === "--scope") {
      scope = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--root") {
      rootDir = resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
  }

  return { scope, rootDir, reportMode, enforceMode };
}

function 收集缺失文件问题(rootDir, files) {
  return files
    .filter((relativePath) => !existsSync(join(rootDir, relativePath)))
    .map((relativePath) => `缺少 ${relativePath}`);
}

function 收集禁词问题(rootDir, files) {
  const issues = [];
  for (const relativePath of files) {
    const fullPath = join(rootDir, relativePath);
    if (!existsSync(fullPath)) {
      continue;
    }
    const source = 读取非注释文本(relativePath, readFileSync(fullPath, "utf8"));
    if (/cloudflared/i.test(source)) {
      issues.push(`禁止出现 cloudflared: ${relativePath}`);
    }
  }
  return issues;
}

function 读取文本文件(rootDir, relativePath) {
  return readFileSync(join(rootDir, relativePath), "utf8");
}

function 读取非注释文本(relativePath, source) {
  const 使用井号注释 =
    relativePath.endsWith(".sh") ||
    relativePath.endsWith(".yaml") ||
    relativePath.endsWith(".yml") ||
    relativePath.endsWith(".dockerignore") ||
    relativePath.endsWith("Dockerfile") ||
    relativePath.endsWith("Caddyfile");

  if (!使用井号注释) {
    return source;
  }

  return source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

function 收集运行主链内容问题(rootDir) {
  const issues = [];
  let composeSource = "";

  const dockerfilePath = join(rootDir, "Dockerfile");
  if (existsSync(dockerfilePath)) {
    const source = 读取非注释文本("Dockerfile", 读取文本文件(rootDir, "Dockerfile"));
    if (!/^FROM\s+.+\s+AS\s+builder\b/im.test(source)) {
      issues.push("Dockerfile 必须包含多阶段 builder 阶段");
    }
    const 使用统一前端构建命令 = /pnpm\s+--dir\s+frontend\s+build\b/.test(source);
    const 使用拆分前端构建主链 =
      /(?:cd\s+frontend\s+&&\s+)?node\s+(?:\.\.\/)?scripts\/check-frontend-browser-app-constitution\.mjs\b/.test(source) &&
      /node\s+(?:\.\.\/)?scripts\/check-frontend-architecture-fitness\.mjs\b/.test(source) &&
      /(?:pnpm\s+--dir\s+frontend|pnpm)\s+typecheck\b/.test(source) &&
      /node\s+(?:frontend\/)?build\.mjs\b/.test(source);
    if (!使用统一前端构建命令 && !使用拆分前端构建主链) {
      issues.push("Dockerfile 缺少前端正式构建主链");
    }
    if (使用拆分前端构建主链 && !/COPY\s+scripts\s+\.\/scripts\b/.test(source)) {
      issues.push("Dockerfile 缺少 scripts 构建脚本目录拷贝");
    }
    if (!/cargo\s+build\s+--release\b/.test(source)) {
      issues.push("Dockerfile 缺少 cargo build --release");
    }
    if (!/COPY\s+assets\s+\.\/assets\b/.test(source)) {
      issues.push("Dockerfile Rust builder 缺少 assets 静态目录拷贝");
    }
    if (
      !/COPY\s+--from=.+\s+\/app\/frontend\/index\.html\s+\/app\/frontend\/index\.html\b/.test(source)
    ) {
      issues.push("Dockerfile 缺少 frontend/index.html 运行时拷贝");
    }
    const runtimeStageStart = source.search(/^FROM\s+.+\s+AS\s+runtime\b/im);
    if (runtimeStageStart >= 0) {
      const runtimeStageSource = source.slice(runtimeStageStart);
      for (const forbiddenPath of ["docs", "tests", ".git"]) {
        const copyPattern = new RegExp(`COPY\\s+${forbiddenPath.replace(".", "\\.")}\\b`, "m");
        if (copyPattern.test(runtimeStageSource)) {
          issues.push(`Dockerfile runtime 阶段禁止拷贝: ${forbiddenPath}`);
        }
      }
    }

  }

  const dockerignorePath = join(rootDir, ".dockerignore");
  if (existsSync(dockerignorePath)) {
    const lines = 读取非注释文本(".dockerignore", 读取文本文件(rootDir, ".dockerignore"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line);
    for (const acceptedPatterns of Dockerignore关键排除项) {
      const matched = acceptedPatterns.some((pattern) => lines.includes(pattern));
      if (!matched) {
        issues.push(`.dockerignore 缺少关键排除项: ${acceptedPatterns[0]}`);
      }
    }
  }

  const composePath = join(rootDir, "ops", "compose.yaml");
  if (existsSync(composePath)) {
    composeSource = 读取非注释文本("ops/compose.yaml", 读取文本文件(rootDir, "ops/compose.yaml"));
    for (const serviceName of ["app", "postgres", "tusd", "tracker", "seeder", "caddy"]) {
      const servicePattern = new RegExp(`^\\s{2}${serviceName}:\\s*`, "m");
      if (!servicePattern.test(composeSource)) {
        issues.push(`ops/compose.yaml 缺少服务: ${serviceName}`);
      }
    }
  }

  if (existsSync(dockerfilePath)) {
    const source = 读取非注释文本("Dockerfile", 读取文本文件(rootDir, "Dockerfile"));
    if (
      /bittorrent-tracker/.test(composeSource) &&
      /pnpm\s+--dir\s+frontend\s+install\s+--frozen-lockfile\s+--prod\b/.test(source)
    ) {
      issues.push("tracker sidecar 禁止只装 --prod 依赖，否则 bittorrent-tracker 无法进入正式镜像");
    }
  }

  const caddyfilePath = join(rootDir, "ops", "Caddyfile");
  if (existsSync(caddyfilePath)) {
    const source = 读取非注释文本("ops/Caddyfile", 读取文本文件(rootDir, "ops/Caddyfile"));
    for (const routePath of ["/files", "/api/swarm/announce"]) {
      if (!source.includes(routePath)) {
        issues.push(`ops/Caddyfile 缺少同源路径: ${routePath}`);
      }
    }
    if (/\bFlexible\b/.test(source)) {
      issues.push("ops/Caddyfile 禁止出现 Flexible");
    }
  }

  return issues;
}

function 收集脚本主链内容问题(rootDir) {
  const issues = [];

  const packageReleasePath = join(rootDir, "ops", "package-release.sh");
  if (existsSync(packageReleasePath)) {
    const source = 读取非注释文本("ops/package-release.sh", 读取文本文件(rootDir, "ops/package-release.sh"));
    const requiredWhitelistPaths = [
      "Dockerfile",
      ".dockerignore",
      "Cargo.toml",
      "Cargo.lock",
      "build.rs",
      "src",
      "migrations",
      "assets",
      "frontend",
      "scripts",
      "ops",
    ];
    for (const requiredPath of [
      ...requiredWhitelistPaths,
    ]) {
      if (!source.includes(requiredPath)) {
        issues.push(`ops/package-release.sh 缺少发布白名单路径: ${requiredPath}`);
      }
    }
    if (!source.includes(":(exclude)frontend/tests/**")) {
      issues.push("ops/package-release.sh 缺少前端测试排除: frontend/tests");
    }
    if (!source.includes(":(exclude)frontend/vitest.config.ts")) {
      issues.push("ops/package-release.sh 缺少前端测试配置排除: frontend/vitest.config.ts");
    }
    const 使用GitArchive = /git\s+archive\b/.test(source) && /\bHEAD\b/.test(source);
    const 白名单看起来齐全 =
      requiredWhitelistPaths.every((path) => source.includes(path)) &&
      source.includes(":(exclude)frontend/tests/**") &&
      source.includes(":(exclude)frontend/vitest.config.ts") &&
      source.includes("--");
    if (使用GitArchive && !白名单看起来齐全) {
      issues.push("ops/package-release.sh 禁止直接整仓 git archive HEAD 打包");
    }
    if (/git\s+pull\b/.test(source)) {
      issues.push("禁止出现 git pull: ops/package-release.sh");
    }
  }

  const installPath = join(rootDir, "ops", "install.sh");
  if (existsSync(installPath)) {
    const source = 读取非注释文本("ops/install.sh", 读取文本文件(rootDir, "ops/install.sh"));
    for (const fixedDir of ["/opt/koko/releases", "/opt/koko/current", "/opt/koko/shared"]) {
      if (!source.includes(fixedDir)) {
        issues.push(`ops/install.sh 缺少固定目录: ${fixedDir}`);
      }
    }
    if (/git\s+pull\b/.test(source)) {
      issues.push("禁止出现 git pull: ops/install.sh");
    }
  }

  const deployPath = join(rootDir, "ops", "deploy.sh");
  if (existsSync(deployPath)) {
    const source = 读取非注释文本("ops/deploy.sh", 读取文本文件(rootDir, "ops/deploy.sh"));
    if (!source.includes("/opt/koko/releases") || !source.includes("/opt/koko/current") || !/ln\s+-sfn\b/.test(source)) {
      issues.push("ops/deploy.sh 缺少版本目录与 current 切换");
    }
    if (!/healthcheck\.sh\b/.test(source)) {
      issues.push("ops/deploy.sh 缺少 healthcheck.sh 调用");
    }
    if (!/bash\s+["']?\$\{healthcheck_script\}["']?/.test(source) && !/bash\s+\/opt\/koko\/current\/ops\/healthcheck\.sh/.test(source)) {
      issues.push("ops/deploy.sh 必须通过 bash 调用 healthcheck.sh");
    }
    if (/git\s+pull\b/.test(source)) {
      issues.push("禁止出现 git pull: ops/deploy.sh");
    }
  }

  const rollbackPath = join(rootDir, "ops", "rollback.sh");
  if (existsSync(rollbackPath)) {
    const source = 读取非注释文本("ops/rollback.sh", 读取文本文件(rootDir, "ops/rollback.sh"));
    if (!/\$\{1:\?/.test(source) && !/\$1\b/.test(source)) {
      issues.push("ops/rollback.sh 必须接收目标版本参数");
    }
    if (!/\-d\s+"?\$\{?target_dir\}?"?/.test(source)) {
      issues.push("ops/rollback.sh 缺少目标版本目录存在校验");
    }
    if (!/bash\s+["']?\$\{healthcheck_script\}["']?/.test(source) && !/bash\s+\/opt\/koko\/current\/ops\/healthcheck\.sh/.test(source)) {
      issues.push("ops/rollback.sh 必须通过 bash 调用 healthcheck.sh");
    }
    if (/git\s+pull\b/.test(source)) {
      issues.push("禁止出现 git pull: ops/rollback.sh");
    }
  }

  const healthcheckPath = join(rootDir, "ops", "healthcheck.sh");
  if (existsSync(healthcheckPath)) {
    const source = 读取非注释文本("ops/healthcheck.sh", 读取文本文件(rootDir, "ops/healthcheck.sh"));
    const probeRules = [
      { label: "正式域名", patterns: ["https://${KOKO_DOMAIN}/", 'https://"$KOKO_DOMAIN"/', 'https://${KOKO_DOMAIN}'] },
      { label: "app", patterns: [" app", "ps app", "http://app:8080"] },
      { label: "postgres", patterns: ["postgres", "pg_isready"] },
      { label: "tusd", patterns: ["tusd", "1081"] },
      { label: "tracker", patterns: ["tracker", "7072"] },
    ];
    for (const probeRule of probeRules) {
      const matched = probeRule.patterns.some((pattern) => source.includes(pattern));
      if (!matched) {
        issues.push(`ops/healthcheck.sh 缺少检查目标: ${probeRule.label}`);
      }
    }
    if (/git\s+pull\b/.test(source)) {
      issues.push("禁止出现 git pull: ops/healthcheck.sh");
    }
  }

  return issues;
}

function 收集Workflow主链内容问题(rootDir) {
  const issues = [];

  const initialDeployPath = join(rootDir, ".github", "workflows", "initial-deploy.yml");
  if (existsSync(initialDeployPath)) {
    const source = 读取非注释文本(
      ".github/workflows/initial-deploy.yml",
      读取文本文件(rootDir, ".github/workflows/initial-deploy.yml")
    );
    if (!/\bworkflow_dispatch\b/.test(source)) {
      issues.push("initial-deploy.yml 缺少 workflow_dispatch");
    }
    for (const secretName of ["VPS_HOST", "VPS_USER", "VPS_SSH_KEY"]) {
      if (!source.includes(secretName)) {
        issues.push(`initial-deploy.yml 缺少 ${secretName} 引用`);
      }
    }
    if (!/pnpm\/action-setup@v\d+/.test(source)) {
      issues.push("initial-deploy.yml 缺少 pnpm/action-setup 安装步骤");
    }
    if (!/package_json_file:\s*frontend\/package\.json/.test(source)) {
      issues.push("initial-deploy.yml 缺少 pnpm package_json_file 指向 frontend/package.json");
    }
    if (!/ops\/healthcheck\.sh\b/.test(source)) {
      issues.push("initial-deploy.yml 缺少 ops/healthcheck.sh 调用");
    }
    if (!/actions\/setup-node@v4/.test(source)) {
      issues.push("initial-deploy.yml 缺少 Node 安装步骤");
    }
    if (!/pnpm\s+--dir\s+frontend\s+install\s+--frozen-lockfile\b/.test(source)) {
      issues.push("initial-deploy.yml 缺少 pnpm --dir frontend install --frozen-lockfile 预检");
    }
    if (!/pnpm\s+--dir\s+frontend\s+build\b/.test(source)) {
      issues.push("initial-deploy.yml 缺少 pnpm --dir frontend build 预检");
    }
    if (!/check-deployment-architecture-fitness\.mjs\s+--enforce\b/.test(source)) {
      issues.push("initial-deploy.yml 缺少部署门禁预检");
    }
    if (!/ops\/package-release\.sh\b/.test(source)) {
      issues.push("initial-deploy.yml 缺少 ops/package-release.sh 调用");
    }
    if (/git\s+archive(?:.|\n)*\bHEAD\b/m.test(source)) {
      issues.push("initial-deploy.yml 禁止直接整仓 git archive HEAD 打包");
    }
    if (/git\s+pull\b/.test(source)) {
      issues.push("禁止出现 git pull: .github/workflows/initial-deploy.yml");
    }
  }

  const deployPath = join(rootDir, ".github", "workflows", "deploy.yml");
  if (existsSync(deployPath)) {
    const source = 读取非注释文本(
      ".github/workflows/deploy.yml",
      读取文本文件(rootDir, ".github/workflows/deploy.yml")
    );
    if (!/\bworkflow_dispatch\b/.test(source)) {
      issues.push("deploy.yml 缺少 workflow_dispatch");
    }
    if (
      !/^\s*push:\s*$/m.test(source) ||
      !(
        /^\s*branches:\s*\[\s*main\s*\]\s*$/m.test(source) ||
        /^\s*-\s*main\s*$/m.test(source)
      )
    ) {
      issues.push("deploy.yml 缺少 push 到 main");
    }
    for (const secretName of ["VPS_HOST", "VPS_USER", "VPS_SSH_KEY"]) {
      if (!source.includes(secretName)) {
        issues.push(`deploy.yml 缺少 ${secretName} 引用`);
      }
    }
    if (!/pnpm\/action-setup@v\d+/.test(source)) {
      issues.push("deploy.yml 缺少 pnpm/action-setup 安装步骤");
    }
    if (!/package_json_file:\s*frontend\/package\.json/.test(source)) {
      issues.push("deploy.yml 缺少 pnpm package_json_file 指向 frontend/package.json");
    }
    if (!/ops\/healthcheck\.sh\b/.test(source)) {
      issues.push("deploy.yml 缺少 ops/healthcheck.sh 调用");
    }
    if (!/actions\/setup-node@v4/.test(source)) {
      issues.push("deploy.yml 缺少 Node 安装步骤");
    }
    if (!/pnpm\s+--dir\s+frontend\s+install\s+--frozen-lockfile\b/.test(source)) {
      issues.push("deploy.yml 缺少 pnpm --dir frontend install --frozen-lockfile 预检");
    }
    if (!/pnpm\s+--dir\s+frontend\s+build\b/.test(source)) {
      issues.push("deploy.yml 缺少 pnpm --dir frontend build 预检");
    }
    if (!/check-deployment-architecture-fitness\.mjs\s+--enforce\b/.test(source)) {
      issues.push("deploy.yml 缺少部署门禁预检");
    }
    if (!/ops\/package-release\.sh\b/.test(source)) {
      issues.push("deploy.yml 缺少 ops/package-release.sh 调用");
    }
    if (/git\s+archive(?:.|\n)*\bHEAD\b/m.test(source)) {
      issues.push("deploy.yml 禁止直接整仓 git archive HEAD 打包");
    }
    if (/git\s+pull\b/.test(source)) {
      issues.push("禁止出现 git pull: .github/workflows/deploy.yml");
    }
  }

  const rollbackPath = join(rootDir, ".github", "workflows", "rollback.yml");
  if (existsSync(rollbackPath)) {
    const source = 读取非注释文本(
      ".github/workflows/rollback.yml",
      读取文本文件(rootDir, ".github/workflows/rollback.yml")
    );
    if (!/\bworkflow_dispatch\b/.test(source)) {
      issues.push("rollback.yml 缺少 workflow_dispatch");
    }
    if (!/^\s*target_version:\s*$/m.test(source)) {
      issues.push("rollback.yml 缺少 target_version 输入");
    }
    for (const secretName of ["VPS_HOST", "VPS_USER", "VPS_SSH_KEY"]) {
      if (!source.includes(secretName)) {
        issues.push(`rollback.yml 缺少 ${secretName} 引用`);
      }
    }
    if (!/ops\/healthcheck\.sh\b/.test(source)) {
      issues.push("rollback.yml 缺少 ops/healthcheck.sh 调用");
    }
    if (/git\s+pull\b/.test(source)) {
      issues.push("禁止出现 git pull: .github/workflows/rollback.yml");
    }
  }

  return issues;
}

/**
 * 这份部署门禁只盯“正式部署主链”本身：
 * 1. 先看文件是否齐全，避免边执行边猜；
 * 2. 再看部署资产里有没有被明令禁止的旧旁路；
 * 3. 不扫描 docs/学习/历史报告，避免把文档里的 Cloudflare 讨论误判成正式部署实现。
 */
export function collectIssues(rootDir, scope = "full") {
  const issues = [];
  if (!允许的检查范围.has(scope)) {
    return [`不支持的 scope: ${scope}`];
  }

  if (scope === "runtime" || scope === "full") {
    issues.push(...收集缺失文件问题(rootDir, 运行主链必需文件));
    issues.push(...收集运行主链内容问题(rootDir));
  }
  if (scope === "scripts" || scope === "full") {
    issues.push(...收集缺失文件问题(rootDir, 脚本主链必需文件));
    issues.push(...收集脚本主链内容问题(rootDir));
  }
  if (scope === "workflows" || scope === "full") {
    issues.push(...收集缺失文件问题(rootDir, Workflow主链必需文件));
    issues.push(...收集Workflow主链内容问题(rootDir));
  }

  issues.push(...收集禁词问题(rootDir, 需要扫描禁词的部署文件));
  return issues;
}

function 打印结果(issues, { enforceMode }) {
  if (issues.length === 0) {
    console.log("部署门禁通过");
    return 0;
  }

  if (enforceMode) {
    console.error("部署门禁失败");
  }
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  return 1;
}

const { scope, rootDir, reportMode, enforceMode } = 读取命令行参数(process.argv.slice(2));
const issues = collectIssues(rootDir, scope);

if (reportMode || enforceMode) {
  process.exitCode = 打印结果(issues, { enforceMode });
} else {
  process.exitCode = 打印结果(issues, { enforceMode: true });
}
