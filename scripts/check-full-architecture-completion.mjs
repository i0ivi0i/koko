import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 当前脚本路径 = fileURLToPath(import.meta.url);
const 当前文件目录 = dirname(当前脚本路径);
const 仓库根目录 = resolve(当前文件目录, "..");

const 转相对路径 = (path) => relative(仓库根目录, path).replaceAll("\\", "/");
const 读取源码 = (path) => readFileSync(path, "utf8");
const 统计有效代码行数 = (source) => {
  let inBlockComment = false;
  let count = 0;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (inBlockComment) {
      const commentEnd = line.indexOf("*/");
      if (commentEnd === -1) {
        continue;
      }
      const trailing = line.slice(commentEnd + 2).trim();
      inBlockComment = false;
      if (!trailing || trailing.startsWith("//")) {
        continue;
      }
      count += 1;
      continue;
    }
    if (
      line.startsWith("//") ||
      line.startsWith("///") ||
      line.startsWith("//!") ||
      line === "/*" ||
      line.startsWith("*") ||
      line === "*/"
    ) {
      continue;
    }
    if (line.startsWith("/*")) {
      const commentEnd = line.indexOf("*/");
      if (commentEnd === -1) {
        inBlockComment = true;
        continue;
      }
      const trailing = line.slice(commentEnd + 2).trim();
      if (!trailing || trailing.startsWith("//")) {
        continue;
      }
      count += 1;
      continue;
    }
    count += 1;
  }
  return count;
};

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
      lines: 统计有效代码行数(source),
    };
  })
  .filter((item) => item.lines > 1597);

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

const 计算起始行号 = (source, index) => source.slice(0, index).split(/\r?\n/).length;

const 收集转发表面 = (path, source) => {
  const 命中 = [];
  const patterns = [
    /\bpub\s+use[\s\S]*?;/g,
    /\bexport\s+\*[\s\S]*?\sfrom\s*["'][^"']+["'];?/g,
    /\bexport\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];?/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const text = match[0]?.trim();
      if (!text) {
        continue;
      }
      命中.push({
        path,
        line: 计算起始行号(source, match.index ?? 0),
        text,
      });
    }
  }

  return 命中.sort((left, right) => left.line - right.line || left.text.localeCompare(right.text));
};

const 转发表面命中 = 生产源码文件
  .map((path) => ({ path: 转相对路径(path), source: 读取源码(path) }))
  .flatMap(({ path, source }) => 收集转发表面(path, source));

const 高风险汇聚点 = [];

const 迁移壳契约清单 = [
  "src/实时/契约.rs",
  "src/房间/契约.rs",
  "src/消息/契约.rs",
  "src/身份/契约.rs",
]
  .map((relativePath) => ({
    path: relativePath,
    source: 读取源码(join(仓库根目录, ...relativePath.split("/"))),
  }))
  .filter(
    ({ source }) =>
      source.includes("pub use crate::shared::contract") ||
      source.includes("第一阶段") ||
      source.includes("先复用")
  )
  .map(({ path }) => path);

const 遗留装配词 = "总" + "装";

const 遗留装配命名残留清单 = [
  "src/lib.rs",
  "src/main.rs",
  "scripts/check-frontend-architecture-fitness.mjs",
  "scripts/check-deployment-architecture-fitness.mjs",
  "scripts/check-full-architecture-completion.mjs",
  "frontend/入口.ts",
]
  .map((relativePath) => ({
    path: relativePath,
    source: 读取源码(join(仓库根目录, ...relativePath.split("/"))),
  }))
  .filter(({ source }) => source.includes(遗留装配词))
  .map(({ path }) => path);

const 宽公开表面清单 = [];
const 媒体聚合表面路径 = join(仓库根目录, "frontend", "媒体", "index.ts");
if (statSync(dirname(媒体聚合表面路径)).isDirectory()) {
  try {
    读取源码(媒体聚合表面路径);
    宽公开表面清单.push({
      file: "frontend/媒体/index.ts",
      kind: "media barrel second entry",
      detail: "媒体子域第二入口仍然存在；满分态必须删除 barrel，并让生产 owner 直连真实媒体 owner 文件",
    });
  } catch {}
}

// 这里要拦的不是“测试存在”，而是“测试 seam 直接活在生产公开表面里”。
// 一旦生产源码自己暴露 `forTest/供测试` setter，测试就会自然绕开真实 owner，
// 壳层和会话 owner 也会被迫长期背着一套假 API。
for (const { file, fragments, kind } of [
  {
    file: "frontend/应用根/聊天壳.ts",
    kind: "chat shell prod test seam",
    fragments: ["setTransportForTest("],
  },
  {
    file: "frontend/应用根/聊天应用内核.ts",
    kind: "chat kernel prod test seam",
    fragments: [
      "setTransportForTest(",
      "读取房间滚动器供测试(",
      "写入视口调试状态供测试(",
    ],
  },
  {
    file: "frontend/后台/应用内核.ts",
    kind: "admin kernel prod test seam",
    fragments: ["setTransportForTest("],
  },
  {
    file: "frontend/后台/壳.ts",
    kind: "admin shell prod test seam",
    fragments: ["setTransportForTest(", "setKernelForTest("],
  },
  {
    file: "frontend/媒体/播放会话/应用.ts",
    kind: "media session prod test seam",
    fragments: [
      "设置媒体播放器供测试(",
      "设置媒体查看器供测试(",
      "关闭媒体查看器供测试(",
      "设置媒体发布器供测试(",
      "写入媒体草稿列表供测试(",
      '["设置", "媒体播放器", "供测试"].join("")',
      '["设置", "媒体查看器", "供测试"].join("")',
      '["关闭", "媒体查看器", "供测试"].join("")',
      '["设置", "媒体发布器", "供测试"].join("")',
      '["写入", "媒体草稿列表", "供测试"].join("")',
      "Object.defineProperty(应用端口 as unknown as object, name, { value, configurable: true });",
    ],
  },
]) {
  const source = 读取源码(join(仓库根目录, ...file.split("/")));
  const hits = fragments.filter((fragment) => source.includes(fragment));
  if (hits.length > 0) {
    宽公开表面清单.push({
      file,
      kind,
      detail: `生产公开表面仍暴露测试 seam：${hits.join("、")}`,
    });
  }
}

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
const 共享适配impl命中 = [
  "impl identity::application::会话身份读取端口 for Pg媒体仓储",
  "impl room::application::会话房间校验仓储端口 for Pg媒体仓储",
  "impl message::application::消息仓储端口 for Pg媒体仓储",
  "impl media::application::媒体仓储端口 for Pg媒体仓储",
  "impl realtime::application::实时会话房间校验仓储端口 for PgRealtime仓储",
  "impl realtime::application::实时房间仓储端口 for PgRealtime仓储",
  "impl message::application::Realtime消息仓储端口 for PgRealtime仓储",
].filter((fragment) => 适配源码.includes(fragment));
const 共享适配转发命中次数 = [
  "房间阅读适配::查询会话所属匿名身份(&self.repo, 会话标识)",
  "媒体附件适配::创建预备媒体附件记录(&mut self.repo",
  "媒体附件适配::创建媒体附件记录(&mut self.repo",
].filter((fragment) => 适配源码.includes(fragment)).length;
if (共享适配impl命中.length > 0 || 共享适配转发命中次数 > 0) {
  高风险汇聚点.push({
    file: "src/适配/mod.rs",
    kind: "shared adapter hub",
    detail: `共享基座文件仍承载跨上下文 impl/转发：impl=${共享适配impl命中.join("、") || "0"}，forward=${共享适配转发命中次数}`,
  });
}

const 身份应用源码 = 读取源码(join(仓库根目录, "src", "身份", "应用.rs"));
const 身份bootstrap应用命中 = [
  "真正的业务真相仍在仓储端口后面",
  "仓储.引导匿名身份(设备匿名凭证)",
].filter((fragment) => 身份应用源码.includes(fragment));
const 身份bootstrap适配命中 = [
  "fn 生成匿名身份标识() -> String",
  "fn 生成会话标识() -> String",
  "user_identity::生成内部身份()",
  "user_identity::随机分配资料投影()",
  "impl identity::application::身份仓储端口 for Pg仓储",
].filter((fragment) => 适配源码.includes(fragment));
if (身份bootstrap应用命中.length > 0 || 身份bootstrap适配命中.length > 0) {
  高风险汇聚点.push({
    file: "src/身份/应用.rs",
    kind: "identity bootstrap truth still persistence-owned",
    detail: `身份 bootstrap 真相仍未回到身份上下文 owner：应用层命中=${身份bootstrap应用命中.join("、") || "0"}；适配层命中=${身份bootstrap适配命中.join("、") || "0"}`,
  });
}

const 应用共享入口源码 = 读取源码(join(仓库根目录, "src", "应用", "mod.rs"));
const 共享应用端口命中 = [
  "pub trait 仓储端口",
  "pub trait Realtime仓储端口",
  "fn 引导匿名身份(",
  "fn 拉取房间快照(",
  "fn 创建统一消息事件(",
  "fn 推进房间阅读位置(",
  "async fn 检查会话存在(",
  "async fn 创建统一消息事件(",
].filter((fragment) => 应用共享入口源码.includes(fragment));
if (共享应用端口命中.length > 0) {
  高风险汇聚点.push({
    file: "src/应用/mod.rs",
    kind: "shared application port hub",
    detail: `共享应用入口仍保留跨上下文总仓储口信号：${共享应用端口命中.join("、")}`,
  });
}

const 应用根内核源码 = 读取源码(
  join(仓库根目录, "frontend", "应用根", "聊天应用内核.ts")
);
const 编排吸附片段 = [
  "new 聊天应用编排协调器({",
  "创建恢复编排依赖: () => ({",
  "创建实时编排依赖: () => ({",
  "创建阅读推进依赖: () => ({",
  "this.媒体编排 = 创建媒体播放会话应用({",
  "async dispatch(command: 聊天应用命令): Promise<void> {",
  "private exitCurrentRoomView(",
  "处理平台桥接命令(",
  "应用本地状态折叠(",
  "写入恢复状态补丁(",
  "写入实时状态补丁(",
  "写入阅读状态补丁(",
];
const 编排命中 = 编排吸附片段.filter((fragment) => 应用根内核源码.includes(fragment));
if (编排命中.length >= 4) {
  高风险汇聚点.push({
    file: "frontend/应用根/聊天应用内核.ts",
    kind: "frontend total coordination shell",
    detail: `仍吸附过多跨子域职责: ${编排命中.join("、")}`,
  });
}

const 媒体发布源码 = 读取源码(join(仓库根目录, "frontend", "媒体", "媒体发布.ts"));
const 媒体发布厨房水槽片段 = [
  "const handleMediaUploadAdded =",
  "const handleMediaUploadSuccess =",
  "const handleMediaUploadError =",
  "const ensureUploader =",
  "const 尝试计算源文件SourceHash =",
  "const 尝试复用SourceHash媒体资产 =",
  "const 继续上传失败草稿 =",
  "const 重新上传失败草稿 =",
  "async 处理选择媒体文件(files: Iterable<File>): Promise<void> {",
];
const 媒体发布厨房水槽命中 = 媒体发布厨房水槽片段.filter((fragment) =>
  媒体发布源码.includes(fragment)
);
if (媒体发布厨房水槽命中.length >= 6) {
  高风险汇聚点.push({
    file: "frontend/媒体/媒体发布.ts",
    kind: "media publisher kitchen-sink factory",
    detail: `同一发布器函数仍同时承载多条局部子系统：${媒体发布厨房水槽命中.join("、")}`,
  });
}

const 时间线媒体基类路径 = join(
  仓库根目录,
  "frontend",
  "房间消息窗",
  "时间线媒体基类.ts"
);
const 时间线媒体基类源码 = 读取源码(时间线媒体基类路径);
const 时间线媒体大桶片段 = [
  "export abstract class 房间消息窗时间线媒体基类 extends LitElement",
  "new 自动播候选观察Owner({",
  "new 媒体窗口观察Owner(",
  "new 时间线播放器宿主Owner({",
  "new 时间线画面缓存Owner({",
  "protected 读取即将渲染的时间线视频表面期望(",
  "protected 同步即将退场Owner底板预览(",
  "protected 打开媒体查看器(",
  "protected 广播媒体会话信号(",
];
const 时间线媒体大桶命中 = 时间线媒体大桶片段.filter((fragment) =>
  时间线媒体基类源码.includes(fragment)
);
if (
  时间线媒体大桶命中.length >= 6 ||
  统计有效代码行数(时间线媒体基类源码) > 1597
) {
  高风险汇聚点.push({
    file: "frontend/房间消息窗/时间线媒体基类.ts",
    kind: "timeline media inheritance bucket",
    detail: `时间线媒体基类仍是继承大桶：命中 ${时间线媒体大桶命中.length} 个结构片段，有效代码行 ${统计有效代码行数(
      时间线媒体基类源码
    )}`,
  });
}

const 图谱报告 = 读取源码(join(仓库根目录, "graphify-out", "GRAPH_REPORT.md"));
const 图谱摘要 =
  图谱报告.match(/## God Nodes[\s\S]*?## Surprising Connections/)?.[0] ??
  "未能提取 graphify 摘要";

let 部署门禁结果 = { ok: true, output: "部署门禁通过" };
try {
  const output = execFileSync(
    process.execPath,
    [join(仓库根目录, "scripts", "check-deployment-architecture-fitness.mjs"), "--enforce"],
    {
      cwd: 仓库根目录,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  部署门禁结果 = { ok: true, output: output.trim() || "部署门禁通过" };
} catch (error) {
  部署门禁结果 = {
    ok: false,
    output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error),
  };
}

const 输出 = {
  overBudget: 超预算文件,
  innerLeaks: 内层泄漏文件,
  fallbackNames: 兜底命中文件,
  reexports: 转发表面命中,
  migrationContractShells: 迁移壳契约清单,
  assemblyNamingResiduals: 遗留装配命名残留清单,
  widePublicSurfaces: 宽公开表面清单,
  highRiskConvergencePoints: 高风险汇聚点,
  deploymentGate: 部署门禁结果,
  graphifySummary: 图谱摘要,
};

console.log(JSON.stringify(输出, null, 2));

if (
  超预算文件.length > 0 ||
  内层泄漏文件.length > 0 ||
  兜底命中文件.length > 0 ||
  迁移壳契约清单.length > 0 ||
  遗留装配命名残留清单.length > 0 ||
  宽公开表面清单.length > 0 ||
  高风险汇聚点.length > 0 ||
  !部署门禁结果.ok
) {
  process.exitCode = 1;
}
