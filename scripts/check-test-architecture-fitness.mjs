import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const 当前脚本路径 = fileURLToPath(import.meta.url);
const 当前文件目录 = dirname(当前脚本路径);
const 仓库根目录 = resolve(当前文件目录, "..");
const 前端测试目录 = join(仓库根目录, "frontend", "tests");
const 后端测试目录 = join(仓库根目录, "tests");
const 报告模式 = process.argv.includes("--report");
const 强制模式 = process.argv.includes("--enforce");
const 输出最大文件数量 = 30;
const 完成态顶层文件硬上限 = 1000;

/**
 * 当前脚本同时承担两层职责：
 * 1. 第一阶段预算体检，继续提示需要持续治理的超大测试文件；
 * 2. spec 完成态门禁，直接拦住任何超过 1000 行的顶层测试文件。
 *
 * 这里故意不把 “缺失 repo-native e2e 包” 做成 fail，
 * 因为最新 spec 已经把真实浏览器主链裁定为
 * `run.ps1 + playwright-cli + trace`，而不是仓库内固定 Playwright 项目。
 *
 * 第一阶段仍然只把这些硬债务变成 fail：
 * 1. helper 超 800 行；
 * 2. 前端 spec 超 1000 行；
 * 3. Rust 顶层集成测试超 1200 行；
 * 4. Rust 嵌套集成测试模块超 987 行；
 * 5. `.only` 和无治理 `skip`。
 *
 * 第二阶段再把普通 Vitest spec 进一步收紧到 800 行。
 */
const 测试预算 = {
  前端测试支架硬上限: 800,
  前端Spec第一阶段硬上限: 1000,
  Rust顶层集成测试硬上限: 1200,
  Rust嵌套集成模块硬上限: 987,
};

const 测试文件类型标签 = {
  前端测试支架: "frontend helper",
  前端Spec: "frontend spec",
  Rust顶层集成测试: "rust top-level integration",
  Rust嵌套集成模块: "rust nested integration",
};

const only规则 = [
  { pattern: /\bdescribe\.only\s*\(/, label: "禁止 describe.only" },
  { pattern: /\bit\.only\s*\(/, label: "禁止 it.only" },
  { pattern: /\btest\.only\s*\(/, label: "禁止 test.only" },
];

function 枚举文件(dir, output = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!["node_modules", "dist", "target"].includes(entry)) {
        枚举文件(full, output);
      }
      continue;
    }
    output.push(full);
  }
  return output;
}

function 转成仓库相对路径(path) {
  return relative(仓库根目录, path).replace(/\\/g, "/");
}

function 读取源码(path) {
  return readFileSync(path, "utf8");
}

function 统计物理行数(text) {
  return text.split(/\r?\n/).length;
}

function 是前端测试文件(path) {
  return path.endsWith(".ts") && path.startsWith(前端测试目录);
}

function 是后端测试文件(path) {
  return path.endsWith(".rs") && path.startsWith(后端测试目录);
}

function 是前端测试支架(relativePath) {
  return relativePath.startsWith("frontend/tests/common/");
}

function 是Rust顶层集成测试(relativePath) {
  return /^tests\/[^/]+\.rs$/.test(relativePath);
}

function 是Rust嵌套集成模块(relativePath) {
  return /^tests\/.+\/[^/]+\.rs$/.test(relativePath);
}

function 读取文件类型(relativePath) {
  if (是前端测试支架(relativePath)) {
    return {
      label: 测试文件类型标签.前端测试支架,
      maxLines: 测试预算.前端测试支架硬上限,
    };
  }
  if (relativePath.startsWith("frontend/tests/")) {
    return {
      label: 测试文件类型标签.前端Spec,
      maxLines: 测试预算.前端Spec第一阶段硬上限,
    };
  }
  if (是Rust顶层集成测试(relativePath)) {
    return {
      label: 测试文件类型标签.Rust顶层集成测试,
      maxLines: 测试预算.Rust顶层集成测试硬上限,
    };
  }
  if (是Rust嵌套集成模块(relativePath)) {
    return {
      label: 测试文件类型标签.Rust嵌套集成模块,
      maxLines: 测试预算.Rust嵌套集成模块硬上限,
    };
  }
  return null;
}

function 收集测试文件() {
  return [...枚举文件(前端测试目录), ...枚举文件(后端测试目录)].filter(
    (path) => 是前端测试文件(path) || 是后端测试文件(path)
  );
}

function 收集only违规(relativePath, lines) {
  const violations = [];
  lines.forEach((line, index) => {
    for (const rule of only规则) {
      if (rule.pattern.test(line)) {
        violations.push({
          file: relativePath,
          label: rule.label,
          detail: `${relativePath}:${index + 1}`,
        });
      }
    }
  });
  return violations;
}

function 收集skip违规(relativePath, lines) {
  const violations = [];
  lines.forEach((line, index) => {
    if (!/\b(?:describe|it|test)\.skip\s*\(/.test(line)) {
      return;
    }
    const previous = index > 0 ? lines[index - 1] : "";
    if (line.includes("TODO(") || previous.includes("TODO(")) {
      return;
    }
    violations.push({
      file: relativePath,
      label: "禁止无治理 skip",
      detail: `${relativePath}:${index + 1}`,
    });
  });
  return violations;
}

function 收集行数违规(relativePath, lines) {
  const 类型 = 读取文件类型(relativePath);
  if (!类型) {
    return [];
  }
  if (lines.length <= 类型.maxLines) {
    return [];
  }
  return [
    {
      file: relativePath,
      label: "测试文件超出第一阶段硬预算",
      detail: `${relativePath}: ${lines.length} lines > ${类型.maxLines} (${类型.label})`,
    },
  ];
}

function 收集完成态顶层超限(relativePath, lines) {
  // spec 的最终完成态比第一阶段预算更严格：
  // 所有顶层测试文件都必须收敛到 1000 行以内，避免“体检通过但尚未彻底完成”。
  if (!是Rust顶层集成测试(relativePath) && !relativePath.startsWith("frontend/tests/")) {
    return [];
  }
  if (lines.length <= 完成态顶层文件硬上限) {
    return [];
  }
  return [
    {
      file: relativePath,
      label: "不满足 spec 完成态",
      detail: `${relativePath}: ${lines.length} lines > ${完成态顶层文件硬上限}`,
    },
  ];
}

function 统计测试规模(records) {
  const sums = {
    生产化前端测试文件数: 0,
    Rust测试文件数: 0,
    前端测试代码行数: 0,
    Rust测试代码行数: 0,
  };
  for (const record of records) {
    if (record.relativePath.startsWith("frontend/tests/")) {
      sums.生产化前端测试文件数 += 1;
      sums.前端测试代码行数 += record.lines;
    } else {
      sums.Rust测试文件数 += 1;
      sums.Rust测试代码行数 += record.lines;
    }
  }
  return sums;
}

function 打印规模(stats) {
  console.log("测试规模：");
  console.log(`- frontend tests: ${stats.生产化前端测试文件数} files / ${stats.前端测试代码行数} lines`);
  console.log(`- rust tests: ${stats.Rust测试文件数} files / ${stats.Rust测试代码行数} lines`);
}

function 打印最大文件(records) {
  console.log(`最大测试文件 Top ${Math.min(输出最大文件数量, records.length)}：`);
  for (const record of records.slice(0, 输出最大文件数量)) {
    const 类型 = 读取文件类型(record.relativePath);
    const label = 类型?.label ?? "unknown";
    console.log(`- ${record.lines}  ${record.relativePath}  [${label}]`);
  }
}

function 打印违规(violations) {
  console.log("发现测试架构违规：");
  for (const violation of violations) {
    console.log(`- ${violation.label}: ${violation.detail}`);
  }
}

const records = 收集测试文件()
  .map((path) => {
    const relativePath = 转成仓库相对路径(path);
    const text = 读取源码(path);
    return {
      path,
      relativePath,
      text,
      lines: 统计物理行数(text),
      lineArray: text.split(/\r?\n/),
    };
  })
  .sort((a, b) => b.lines - a.lines);

const violations = records.flatMap((record) => [
  ...收集行数违规(record.relativePath, record.lineArray),
  ...收集完成态顶层超限(record.relativePath, record.lineArray),
  ...收集only违规(record.relativePath, record.lineArray),
  ...收集skip违规(record.relativePath, record.lineArray),
]);

打印规模(统计测试规模(records));
console.log("");
打印最大文件(records);
console.log("");

if (violations.length > 0) {
  打印违规(violations);
  if (强制模式) {
    process.exitCode = 1;
  }
} else {
  console.log("测试架构体检通过。");
}

if (!报告模式 && !强制模式) {
  console.log("");
  console.log("用法：");
  console.log("- report 模式：node scripts/check-test-architecture-fitness.mjs --report");
  console.log("- enforce 模式：node scripts/check-test-architecture-fitness.mjs --enforce");
}
