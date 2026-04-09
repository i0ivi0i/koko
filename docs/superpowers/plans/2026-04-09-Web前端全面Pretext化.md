# Web 前端全面 Pretext 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 Web 前端的消息正文、聊天气泡、输入区和 rich inline 文本链路一次性切换到 `Pretext` 唯一主权层，同时保持现有未读恢复、历史补偿、阅读推进和 realtime 语义不退化。

**Architecture:** 现有 `contract / transport / orchestrator` 边界保持不变，只在前端新增一个唯一的 `text layout core` 文件 [frontend/文本布局.ts](/E:/koko/frontend/文本布局.ts)，由它薄封装 `@chenglou/pretext` 与 `@chenglou/pretext/rich-inline`。`presenter` 负责绑定布局结果，`消息窗` 与 `聊天壳` 只表达布局结果，`房间滚动器` 继续只处理渲染后视口观测。

**Tech Stack:** TypeScript, Lit, Vitest, happy-dom, xstate, esbuild, `@chenglou/pretext@0.0.5`

---

## 0. 实施前总规则

### 0.1 不允许偏离的边界

1. 不改 [frontend/契约.ts](/E:/koko/frontend/契约.ts) 里的后端契约形状
2. 不改 Rust 后端、HTTP 协议、realtime 协议
3. 不保留回退闸门
4. 不保留兼容壳
5. 不允许消息正文和输入区出现两套并行文本主权
6. 前端运行时代码新增预算只允许 1 个文件：[frontend/文本布局.ts](/E:/koko/frontend/文本布局.ts)
7. 任何实现步骤都必须先有失败测试，再做最小实现，再跑绿，再提交

### 0.2 每个代码任务完成后的固定动作

1. 跑该任务对应最小测试
2. 跑 `pnpm typecheck`
3. 若触及前端运行时代码，执行：

```powershell
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

4. `git status --short` 确认没有无关噪音
5. 中文 commit，说明“改了什么 + 为什么 + 边界影响”

### 0.3 相关文件地图

**Create:**

1. [frontend/文本布局.ts](/E:/koko/frontend/文本布局.ts)
2. [frontend/tests/文本布局测试.spec.ts](/E:/koko/frontend/tests/%E6%96%87%E6%9C%AC%E5%B8%83%E5%B1%80%E6%B5%8B%E8%AF%95.spec.ts)
3. [frontend/tests/输入区布局测试.spec.ts](/E:/koko/frontend/tests/%E8%BE%93%E5%85%A5%E5%8C%BA%E5%B8%83%E5%B1%80%E6%B5%8B%E8%AF%95.spec.ts)

**Modify:**

1. [frontend/package.json](/E:/koko/frontend/package.json)
2. [frontend/视图.ts](/E:/koko/frontend/视图.ts)
3. [frontend/房间消息窗.ts](/E:/koko/frontend/房间消息窗.ts)
4. [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts)
5. [frontend/状态.ts](/E:/koko/frontend/状态.ts)
6. [frontend/tests/聊天壳测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E6%B5%8B%E8%AF%95.spec.ts)
7. [frontend/tests/聊天壳阅读与消息测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E9%98%85%E8%AF%BB%E4%B8%8E%E6%B6%88%E6%81%AF%E6%B5%8B%E8%AF%95.spec.ts)
8. [frontend/tests/聊天壳未读恢复测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E6%9C%AA%E8%AF%BB%E6%81%A2%E5%A4%8D%E6%B5%8B%E8%AF%95.spec.ts)
9. [frontend/tests/聊天壳恢复与分页测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E6%81%A2%E5%A4%8D%E4%B8%8E%E5%88%86%E9%A1%B5%E6%B5%8B%E8%AF%95.spec.ts)
10. [学习/整理笔记/pretext-调研记录.md](/E:/koko/%E5%AD%A6%E4%B9%A0/%E6%95%B4%E7%90%86%E7%AC%94%E8%AE%B0/pretext-%E8%B0%83%E7%A0%94%E8%AE%B0%E5%BD%95.md)

**Do Not Create:**

1. `frontend/消息布局.ts`
2. `frontend/输入布局.ts`
3. `frontend/rich-inline.ts`
4. 任意 `helper / manager / service` 文件

---

## 1. 执行顺序总览

1. 先接依赖和最小红测
2. 再实现唯一文本布局内核
3. 再升级 presenter
4. 再切消息窗
5. 再切输入区
6. 最后做滚动与回归收口

不能反过来做。  
特别禁止先改 [frontend/房间消息窗.ts](/E:/koko/frontend/房间消息窗.ts) 模板再临时拼数据，因为那会在过程中制造第二套文本主权。

---

### Task 1: 接入依赖并锁定最小红测

**Files:**
- Modify: [frontend/package.json](/E:/koko/frontend/package.json)
- Create: [frontend/tests/文本布局测试.spec.ts](/E:/koko/frontend/tests/%E6%96%87%E6%9C%AC%E5%B8%83%E5%B1%80%E6%B5%8B%E8%AF%95.spec.ts)

- [ ] **Step 1: 写失败测试，锁定文本布局核心最小接口**

```ts
import { describe, expect, it } from "vitest";
import { 创建文本布局器 } from "../文本布局";

describe("文本布局器", () => {
  it("会为同一段文本返回稳定的行数和高度", () => {
    const 布局器 = 创建文本布局器();
    const 结果 = 布局器.布局纯文本({
      text: "hello hello hello",
      width: 120,
      fontFamily: "Microsoft YaHei",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 22,
    });
    expect(结果.lineCount).toBeGreaterThan(0);
    expect(结果.height).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- 文本布局测试.spec.ts`  
Expected: FAIL，提示找不到 `../文本布局`

- [ ] **Step 3: 修改依赖清单**

在 [frontend/package.json](/E:/koko/frontend/package.json) 的 `dependencies` 中加入：

```json
"@chenglou/pretext": "0.0.5"
```

如果 `rich-inline` 是子路径导出，不额外装第二个包；如果官方实际发布为第二包，才补上明确版本号。

- [ ] **Step 4: 安装依赖**

Run: `pnpm install`  
Expected: lockfile 更新且无安装错误

- [ ] **Step 5: 提交**

```powershell
git add frontend/package.json frontend/pnpm-lock.yaml frontend/tests/文本布局测试.spec.ts
git commit -m "前端: 接入 Pretext 依赖并建立文本布局红测"
```

---

### Task 2: 实现唯一文本布局内核

**Files:**
- Create: [frontend/文本布局.ts](/E:/koko/frontend/文本布局.ts)
- Modify: [frontend/tests/文本布局测试.spec.ts](/E:/koko/frontend/tests/%E6%96%87%E6%9C%AC%E5%B8%83%E5%B1%80%E6%B5%8B%E8%AF%95.spec.ts)

- [ ] **Step 1: 扩展失败测试，锁定三类结果**

把 [frontend/tests/文本布局测试.spec.ts](/E:/koko/frontend/tests/%E6%96%87%E6%9C%AC%E5%B8%83%E5%B1%80%E6%B5%8B%E8%AF%95.spec.ts) 扩到至少覆盖：

1. 纯文本布局返回 `height / lineCount / naturalWidth / lines`
2. 同一 `prepare` 结果在不同 `width` 下可重复布局
3. rich inline 可返回片段化行结果

新增测试示例：

```ts
expect(结果.lines[0].segments.length).toBeGreaterThan(0);
expect(结果.naturalWidth).toBeGreaterThan(0);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- 文本布局测试.spec.ts`  
Expected: FAIL，提示接口未实现或结构不匹配

- [ ] **Step 3: 在 [frontend/文本布局.ts](/E:/koko/frontend/文本布局.ts) 写最小实现**

实现以下稳定接口，不要超设计：

```ts
export interface 文本布局环境 {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  whiteSpace?: "normal" | "pre-wrap";
  wordBreak?: "normal" | "keep-all";
}

export interface 纯文本布局输入 extends 文本布局环境 {
  text: string;
  width: number;
}

export interface 富文本片段输入 {
  kind: "text" | "code" | "chip" | "link";
  text: string;
}

export interface 文本布局结果 {
  height: number;
  lineCount: number;
  naturalWidth: number;
  lines: Array<{
    index: number;
    width: number;
    text: string;
    segments: Array<{
      kind: "text" | "code" | "chip" | "link";
      text: string;
    }>;
  }>;
}

export function 创建文本布局器() {
  return {
    布局纯文本(input: 纯文本布局输入): 文本布局结果 { /* ... */ },
    布局富文本(input: { segments: 富文本片段输入[]; width: number } & 文本布局环境): 文本布局结果 { /* ... */ },
  };
}
```

实现要求：

1. 统一封装 `prepare` / `prepareWithSegments`
2. 内部允许缓存 `prepare` 结果
3. 不引用 DOM 节点或 `getBoundingClientRect`
4. 不把 CSS 规则散落到调用方

- [ ] **Step 4: 跑测试确认转绿**

Run: `pnpm test -- 文本布局测试.spec.ts`  
Expected: PASS

- [ ] **Step 5: 跑类型检查**

Run: `pnpm typecheck`  
Expected: PASS

- [ ] **Step 6: 更新 graphify**

Run:

```powershell
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: graphify 正常重建，无异常

- [ ] **Step 7: 提交**

```powershell
git add frontend/文本布局.ts frontend/tests/文本布局测试.spec.ts graphify-out
git commit -m "前端: 新增唯一文本布局内核并接入 Pretext"
```

---

### Task 3: 升级 presenter，让消息展示项绑定布局结果

**Files:**
- Modify: [frontend/视图.ts](/E:/koko/frontend/视图.ts)
- Modify: [frontend/tests/聊天壳阅读与消息测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E9%98%85%E8%AF%BB%E4%B8%8E%E6%B6%88%E6%81%AF%E6%B5%8B%E8%AF%95.spec.ts)

- [ ] **Step 1: 写失败测试，锁定展示项不再只含 `body`**

新增断言示例：

```ts
expect(messageItem.layout.lineCount).toBeGreaterThan(0);
expect(messageItem.layout.lines.length).toBeGreaterThan(0);
expect("body" in messageItem && typeof messageItem.body === "string").toBe(true);
expect(messageItem.renderText).toBeUndefined();
```

这里要锁定的是：

1. 原始 `body` 仍保留作消息事实
2. 模板真正消费的新增字段是 `layout`

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- 聊天壳阅读与消息测试.spec.ts`  
Expected: FAIL，提示展示项字段不匹配

- [ ] **Step 3: 修改 [frontend/视图.ts](/E:/koko/frontend/视图.ts)**

把 `消息展示项` 收口为：

```ts
export interface 消息展示项 {
  kind: "message";
  id: string;
  owner: "mine" | "other";
  body: string;
  layout: 文本布局结果;
  bubbleWidth: number;
  senderDisplayAlias: string;
  showAlias: boolean;
  eventPosition: number;
}
```

并给 `派生聊天列表展示项` / `派生消息展示项` 注入布局器依赖。  
不要在 presenter 里重新实现布局算法，只能调 [frontend/文本布局.ts](/E:/koko/frontend/文本布局.ts)。

- [ ] **Step 4: 跑相关测试**

Run: `pnpm test -- 聊天壳阅读与消息测试.spec.ts`  
Expected: PASS

- [ ] **Step 5: 跑类型检查**

Run: `pnpm typecheck`  
Expected: PASS

- [ ] **Step 6: 更新 graphify 并提交**

```powershell
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
git add frontend/视图.ts frontend/tests/聊天壳阅读与消息测试.spec.ts graphify-out
git commit -m "前端: 让消息展示项绑定 Pretext 布局结果"
```

---

### Task 4: 切消息窗，让 DOM 只表达布局结果

**Files:**
- Modify: [frontend/房间消息窗.ts](/E:/koko/frontend/房间消息窗.ts)
- Modify: [frontend/tests/聊天壳测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E6%B5%8B%E8%AF%95.spec.ts)
- Modify: [frontend/tests/聊天壳阅读与消息测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E9%98%85%E8%AF%BB%E4%B8%8E%E6%B6%88%E6%81%AF%E6%B5%8B%E8%AF%95.spec.ts)

- [ ] **Step 1: 写失败测试，锁定消息窗不再直出 `${item.body}`**

新增断言示例：

```ts
const body = el.querySelector(".message-body");
expect(body?.children.length).toBeGreaterThan(0);
expect(body?.textContent).toContain("hello");
expect(body?.querySelector("[data-line-index='0']")).not.toBeNull();
```

测试目标是：

1. 消息窗仍保留 `.message-body`
2. 但内部结构变成逐行表达

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- 聊天壳测试.spec.ts 聊天壳阅读与消息测试.spec.ts`  
Expected: FAIL，提示模板结构未更新

- [ ] **Step 3: 修改 [frontend/房间消息窗.ts](/E:/koko/frontend/房间消息窗.ts)**

把：

```ts
<div class="message-body">${item.body}</div>
```

改成基于 `item.layout.lines` 渲染，例如：

```ts
<div class="message-body" style=${`width:${item.bubbleWidth}px`}>
  ${item.layout.lines.map((line) => html`
    <div class="message-line" data-line-index=${line.index}>
      ${line.segments.map((segment) => html`
        <span class=${`segment-${segment.kind}`}>${segment.text}</span>
      `)}
    </div>
  `)}
</div>
```

要求：

1. 保留 `data-event-position`
2. 不改滚动器依赖的 DOM 入口
3. 不临时保留“旧正文 + 新正文”双轨模板

- [ ] **Step 4: 跑消息窗相关测试**

Run: `pnpm test -- 聊天壳测试.spec.ts 聊天壳阅读与消息测试.spec.ts`  
Expected: PASS

- [ ] **Step 5: 跑类型检查并更新 graphify**

Run:

```powershell
pnpm typecheck
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: PASS

- [ ] **Step 6: 提交**

```powershell
git add frontend/房间消息窗.ts frontend/tests/聊天壳测试.spec.ts frontend/tests/聊天壳阅读与消息测试.spec.ts graphify-out
git commit -m "前端: 让消息窗口只表达 Pretext 布局结果"
```

---

### Task 5: 切输入区，让 composer 进入同一文本主权层

**Files:**
- Create: [frontend/tests/输入区布局测试.spec.ts](/E:/koko/frontend/tests/%E8%BE%93%E5%85%A5%E5%8C%BA%E5%B8%83%E5%B1%80%E6%B5%8B%E8%AF%95.spec.ts)
- Modify: [frontend/状态.ts](/E:/koko/frontend/状态.ts)
- Modify: [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts)
- Modify: [frontend/tests/聊天壳测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E6%B5%8B%E8%AF%95.spec.ts)

- [ ] **Step 1: 写失败测试，锁定输入区从单行 `input` 升级为多行宿主**

在 [frontend/tests/输入区布局测试.spec.ts](/E:/koko/frontend/tests/%E8%BE%93%E5%85%A5%E5%8C%BA%E5%B8%83%E5%B1%80%E6%B5%8B%E8%AF%95.spec.ts) 写最小红测：

```ts
expect(el.querySelector("textarea, [data-role='composer-editor']")).not.toBeNull();
expect(el.querySelector(".composer-line")).not.toBeNull();
```

并在 [frontend/tests/聊天壳测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E6%B5%8B%E8%AF%95.spec.ts) 加断言：

```ts
expect(el.querySelector("input.text-input")).toBeNull();
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- 输入区布局测试.spec.ts 聊天壳测试.spec.ts`  
Expected: FAIL

- [ ] **Step 3: 修改 [frontend/状态.ts](/E:/koko/frontend/状态.ts)**

只加最小布局环境字段，例如：

```ts
composerWidth: number;
composerHeight: number;
```

不要在这里塞富文本片段真相或第二份输入值真相。  
真正的输入文本值仍然只认 `messageInput`。

- [ ] **Step 4: 修改 [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts)**

把单行：

```ts
<input class="text-input" ... />
```

切成多行宿主表达。推荐保留原事件语义，但宿主形状改成：

1. `textarea`
2. 或一个显式 `data-role="composer-editor"` 的多行输入宿主

并用 [frontend/文本布局.ts](/E:/koko/frontend/文本布局.ts) 计算：

1. 当前输入区行数
2. 当前输入区高度
3. 富文本片段布局结果

明确禁止：

1. 消息正文走 `Pretext`，输入区仍靠原生单行 `input`
2. 新增第二套输入区布局 helper

- [ ] **Step 5: 跑输入区相关测试**

Run: `pnpm test -- 输入区布局测试.spec.ts 聊天壳测试.spec.ts`  
Expected: PASS

- [ ] **Step 6: 跑类型检查、更新 graphify 并提交**

```powershell
pnpm typecheck
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
git add frontend/状态.ts frontend/聊天壳.ts frontend/tests/输入区布局测试.spec.ts frontend/tests/聊天壳测试.spec.ts graphify-out
git commit -m "前端: 让输入区进入统一 Pretext 文本主权层"
```

---

### Task 6: 校准滚动器与恢复链路，确认块级表达切换后不退化

**Files:**
- Modify: [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts)
- Modify: [frontend/房间滚动器.ts](/E:/koko/frontend/房间滚动器.ts)
- Modify: [frontend/tests/聊天壳未读恢复测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E6%9C%AA%E8%AF%BB%E6%81%A2%E5%A4%8D%E6%B5%8B%E8%AF%95.spec.ts)
- Modify: [frontend/tests/聊天壳恢复与分页测试.spec.ts](/E:/koko/frontend/tests/%E8%81%8A%E5%A4%A9%E5%A3%B3%E6%81%A2%E5%A4%8D%E4%B8%8E%E5%88%86%E9%A1%B5%E6%B5%8B%E8%AF%95.spec.ts)

- [ ] **Step 1: 写失败测试，锁定三类回归**

最少补三类断言：

1. 历史前插后锚点仍稳定
2. 首屏围绕未读恢复不退化
3. 跳到最新后阅读推进仍可继续

示例：

```ts
expect(scrollTopAfterCompensation).toBe(scrollTopBeforeCompensation);
expect(latestReadAnchorCall).toEqual(expectedPosition);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- 聊天壳未读恢复测试.spec.ts 聊天壳恢复与分页测试.spec.ts`  
Expected: FAIL

- [ ] **Step 3: 最小修改 [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts) / [frontend/房间滚动器.ts](/E:/koko/frontend/房间滚动器.ts)**

目标不是改业务规则，而是确认新的块级表达下：

1. 仍能通过现有 `data-event-position` 找到锚点消息
2. 仍能从消息块读取稳定的容器相对位置
3. 不把逐行结构误当成新的消息节点集合

必要时只调整：

1. `查询消息节点()` 的选择器
2. 可见片段读取时面向块级节点而不是行级节点

禁止：

1. 为了过测试，把滚动器改成再次依赖文本自然高度
2. 把阅读推进规则改掉来掩盖布局切换问题

- [ ] **Step 4: 跑恢复与滚动相关测试**

Run: `pnpm test -- 聊天壳未读恢复测试.spec.ts 聊天壳恢复与分页测试.spec.ts 聊天壳阅读与消息测试.spec.ts`  
Expected: PASS

- [ ] **Step 5: 跑类型检查、更新 graphify 并提交**

```powershell
pnpm typecheck
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
git add frontend/聊天壳.ts frontend/房间滚动器.ts frontend/tests/聊天壳未读恢复测试.spec.ts frontend/tests/聊天壳恢复与分页测试.spec.ts frontend/tests/聊天壳阅读与消息测试.spec.ts graphify-out
git commit -m "前端: 校准滚动恢复链以适配 Pretext 块级表达"
```

---

### Task 7: 清理旧路径，防止双轨文本系统残留

**Files:**
- Modify: [frontend/房间消息窗.ts](/E:/koko/frontend/房间消息窗.ts)
- Modify: [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts)
- Modify: [frontend/视图.ts](/E:/koko/frontend/视图.ts)

- [ ] **Step 1: 搜索旧路径残留**

Run:

```powershell
rg -n "\$\{item\.body\}|input\\.text-input|measureText|getBoundingClientRect\\(\\).*message-body|fit-content" frontend
```

Expected: 不再命中旧的文本主权路径；允许命中滚动器的视口观测 `getBoundingClientRect()`，但不允许落在文本布局路径里

- [ ] **Step 2: 删除残留旧逻辑**

删除或改写任何仍在以下位置残留的旧语义：

1. 裸字符串正文模板
2. 单行 `input` 宿主
3. 依赖自然 `fit-content` 的气泡宽度裁决
4. 任意组件中的临时文本测量逻辑

- [ ] **Step 3: 跑针对性测试确认未破坏**

Run: `pnpm test -- 聊天壳测试.spec.ts 文本布局测试.spec.ts 输入区布局测试.spec.ts`  
Expected: PASS

- [ ] **Step 4: 提交**

```powershell
git add frontend/房间消息窗.ts frontend/聊天壳.ts frontend/视图.ts
git commit -m "前端: 删除旧文本主权路径并收口到 Pretext"
```

---

### Task 8: 全量验证与文档收口

**Files:**
- Modify: [学习/整理笔记/pretext-调研记录.md](/E:/koko/%E5%AD%A6%E4%B9%A0/%E6%95%B4%E7%90%86%E7%AC%94%E8%AE%B0/pretext-%E8%B0%83%E7%A0%94%E8%AE%B0%E5%BD%95.md)

- [ ] **Step 1: 跑完整验证**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Expected:

1. 全部 PASS
2. esbuild 正常产物更新
3. 无新增类型错误

- [ ] **Step 2: 更新学习笔记**

在 [学习/整理笔记/pretext-调研记录.md](/E:/koko/%E5%AD%A6%E4%B9%A0/%E6%95%B4%E7%90%86%E7%AC%94%E8%AE%B0/pretext-%E8%B0%83%E7%A0%94%E8%AE%B0%E5%BD%95.md) 补充一节：

1. 本仓库最终如何落实“全面 Pretext 化”
2. 哪些边界保留给宿主观测
3. 哪些旧路径已删除

- [ ] **Step 3: 更新 graphify**

Run:

```powershell
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

- [ ] **Step 4: 最终工作树复核**

Run: `git status --short`  
Expected: 只有本任务相关改动；无格式化噪音；无无关文件

- [ ] **Step 5: 最终提交**

```powershell
git add frontend 学习/整理笔记/pretext-调研记录.md graphify-out
git commit -m "前端: 完成 Web 文本链路全面 Pretext 化"
```

---

## 2. 任务完成定义

只有同时满足以下条件，这个计划才算完成：

1. Web 前端运行时代码中只存在一套文本布局主权层
2. [frontend/文本布局.ts](/E:/koko/frontend/文本布局.ts) 是唯一文本布局入口
3. [frontend/房间消息窗.ts](/E:/koko/frontend/房间消息窗.ts) 不再直出 `${item.body}`
4. [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts) 不再使用单行 `input` 作为最终输入宿主
5. 聊天气泡宽度由 `Pretext` 结果驱动
6. rich inline 能进入统一布局链路
7. 未读恢复、历史补偿、阅读推进、跳到最新全部测试通过
8. `pnpm test`、`pnpm typecheck`、`pnpm build` 全部通过

---

## 3. 执行提醒

1. 任何一步如果需要新增第二个运行时代码文件，先停下，回到 spec 重审
2. 任何一步如果想保留旧路径“先兼容一下”，直接视为偏离设计
3. 任何一步如果为了过测试而改业务语义，而不是修文本主权切换造成的问题，直接回退这一思路
4. 每个任务都必须是“红 -> 绿 -> 验证 -> graphify -> commit”的闭环
