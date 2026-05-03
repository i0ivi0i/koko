import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 当前脚本路径 = fileURLToPath(import.meta.url);
const 当前文件目录 = dirname(当前脚本路径);
const 仓库根目录 = resolve(当前文件目录, "..");

const 转相对路径 = (path) => relative(仓库根目录, path).replaceAll("\\", "/");
const 读取源码 = (path) => readFileSync(path, "utf8");
const 统计物理行数 = (source) => source.split(/\r?\n/).length;

const 枚举文件 = (dir, skip = new Set()) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...枚举文件(full, skip));
      continue;
    }
    out.push(full);
  }
  return out;
};

const 生产Rust文件 = 枚举文件(join(仓库根目录, "src"))
  .filter((path) => extname(path) === ".rs");

const 前端生产文件 = 枚举文件(
  join(仓库根目录, "frontend"),
  new Set(["tests", "dist", "node_modules"])
).filter((path) => {
  const ext = extname(path);
  return [".ts", ".js", ".mjs"].includes(ext) && !path.endsWith(".d.ts");
});

const 生产源码文件 = [...生产Rust文件, ...前端生产文件];

const 超预算文件 = 生产源码文件
  .map((path) => {
    const source = 读取源码(path);
    return {
      path: 转相对路径(path),
      lines: 统计物理行数(source),
    };
  })
  .filter((item) => item.lines > 987);

const 内层外层类型正则 =
  /axum::|sqlx::|socketioxide|tower::|reqwest::|HeaderMap|StatusCode|Uri|Json<|State<|Extension<|SocketRef/;

const 是后端内层候选文件 = (relativePath) =>
  relativePath.startsWith("src/领域/") ||
  relativePath.startsWith("src/应用/") ||
  relativePath.startsWith("src/共享/") ||
  /\/(应用|契约|模型|共享语义)\.rs$/.test(relativePath);

const 内层泄漏文件 = 生产Rust文件
  .map((path) => ({ path, relativePath: 转相对路径(path), source: 读取源码(path) }))
  .filter((item) => 是后端内层候选文件(item.relativePath) && 内层外层类型正则.test(item.source))
  .map((item) => item.relativePath);

const 兜底命名正则 =
  /(^|\/)[^/]*(helper|helpers|utils|misc|facade|compat|legacy|fallback|wrapper|shim|temp|old|门面|兼容|兜底|临时|旧|包装)[^/]*(\.|\/)/i;

const 兜底命中文件 = 生产源码文件
  .map(转相对路径)
  .filter((relativePath) => 兜底命名正则.test(relativePath));

const 转发表面命中 = 生产源码文件
  .map((path) => ({ path: 转相对路径(path), source: 读取源码(path) }))
  .flatMap(({ path, source }) =>
    source
      .split(/\r?\n/)
      .map((line, index) => ({ path, line: index + 1, text: line.trim() }))
      .filter((item) => /\bpub use\b|export \* from|export \{.*\} from/.test(item.text))
  );

const 高风险汇聚点 = [];

const 消息应用源码 = 读取源码(join(仓库根目录, "src", "消息", "应用.rs"));
const 重复规则片段 = [
  "let mut attachments = Vec::with_capacity(附件标识列表.len());",
  "if snapshot.所属匿名身份标识 != 发送者身份 {",
  "if snapshot.状态 != 附件状态读取结果::就绪 {",
  "let attachment = match snapshot.种类 {",
];
const 规则复制命中 = 重复规则片段.filter(
  (fragment) => 消息应用源码.split(fragment).length - 1 > 1
);
if (规则复制命中.length > 0) {
  高风险汇聚点.push({
    file: "src/消息/应用.rs",
    kind: "duplicate message rule chain",
    detail: `仍有同步/异步业务规则复制片段: ${规则复制命中.join("、")}`,
  });
}

const 适配源码 = 读取源码(join(仓库根目录, "src", "适配", "mod.rs"));
const pg仓储Impl命中 = [
  "impl 仓储端口 for Pg仓储",
  "impl media::application::媒体仓储端口 for Pg仓储",
  "impl application::Realtime仓储端口 for Pg仓储",
].filter((fragment) => 适配源码.includes(fragment));
if (pg仓储Impl命中.length > 1) {
  高风险汇聚点.push({
    file: "src/适配/mod.rs",
    kind: "total repository shell",
    detail: `Pg仓储 仍挂着多个上下文 impl: ${pg仓储Impl命中.join("、")}`,
  });
}

const 总装内核源码 = 读取源码(join(仓库根目录, "frontend", "总装", "聊天应用内核.ts"));
const 编排吸附片段 = [
  "恢复编排端口",
  "实时编排端口",
  "阅读推进编排端口",
  "处理平台桥接命令(",
  "应用本地状态折叠(",
  "同步实时会话快照并执行副作用(",
];
const 编排命中 = 编排吸附片段.filter((fragment) => 总装内核源码.includes(fragment));
if (编排命中.length >= 4) {
  高风险汇聚点.push({
    file: "frontend/总装/聊天应用内核.ts",
    kind: "total orchestration shell",
    detail: `仍吸附过多跨子域职责: ${编排命中.join("、")}`,
  });
}

const 图谱报告 = 读取源码(join(仓库根目录, "graphify-out", "GRAPH_REPORT.md"));
const 图谱摘要 =
  图谱报告.match(/## God Nodes[\s\S]*?## Surprising Connections/)?.[0] ??
  "未能提取 graphify 摘要";

const 输出 = {
  overBudget: 超预算文件,
  innerLeaks: 内层泄漏文件,
  fallbackNames: 兜底命中文件,
  reexports: 转发表面命中,
  highRiskConvergencePoints: 高风险汇聚点,
  graphifySummary: 图谱摘要,
};

console.log(JSON.stringify(输出, null, 2));

if (
  超预算文件.length > 0 ||
  内层泄漏文件.length > 0 ||
  兜底命中文件.length > 0 ||
  高风险汇聚点.length > 0
) {
  process.exitCode = 1;
}
