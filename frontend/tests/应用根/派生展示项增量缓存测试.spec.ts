// @vitest-environment happy-dom
/**
 * 聊天列表展示项缓存 - 增量派生 单测
 *
 * 验证按 message_id 单条增量缓存的行为，修复 plan v2 §B 漏洞：
 * - xstate 每次 send 都返回新 messages 数组引用 → 引用相等缓存永远 miss → 每次 REALTIME 全量 O(N) 重派生（含文本布局测量）
 * - 改为按 (message_id, 内容指纹) 缓存单条派生结果，新增/变更才重派生
 *
 * 测试通过 `创建聊天列表展示项缓存` 暴露的 `派生统计` 内部接口观察派生次数，
 * 比 spy ES 模块级函数更可靠（不依赖 vitest live-binding 实现细节）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  默认消息文本布局环境,
  type 聊天列表展示项,
  type 消息文本布局环境,
} from "../../房间消息窗/视图.js";
import { 创建聊天列表展示项缓存 } from "../../应用根/聊天列表展示项缓存.js";
import { 安装测试文本测量画布 } from "../common/测试文本测量.js";
import type { 消息事件 } from "../../聊天共享/契约.js";

// `派生消息展示项` 内部跑 Pretext 文本布局测量，需要 OffscreenCanvas 上下文。
// 复用项目内已有的最小测量画布 shim，与其他文本测量测试保持一致。
beforeAll(() => {
  安装测试文本测量画布();
});

const 制造 = (event_position: number, message_id?: string): 消息事件 => ({
  type: "message_created",
  room_id: "r-1",
  message_id: message_id ?? `m-${event_position}`,
  client_message_id: `c-${event_position}`,
  sender_session_id: "s",
  sender_display_alias: "u",
  text: `t-${event_position}`,
  attachments: [],
  event_position,
});

const 默认输入 = (overrides: Partial<{
  messages: 消息事件[];
  currentSessionId: string;
  firstUnreadEventPosition: number | null;
  layoutEnv: 消息文本布局环境;
  附件预览地址表: Record<string, { previewSrc: string }>;
}>) => ({
  messages: overrides.messages ?? [],
  currentSessionId: overrides.currentSessionId ?? "s",
  firstUnreadEventPosition: overrides.firstUnreadEventPosition ?? null,
  layoutEnv: overrides.layoutEnv ?? 默认消息文本布局环境,
  附件预览地址表: overrides.附件预览地址表 ?? {},
});

describe("聊天列表展示项缓存 - 增量派生", () => {
  it("首次派生：所有消息都调用单条派生", () => {
    const 缓存 = 创建聊天列表展示项缓存();
    const messages = [制造(1), 制造(2), 制造(3)];
    const items = 缓存.派生(默认输入({ messages }));
    expect(items.filter((it: 聊天列表展示项) => it.kind === "message")).toHaveLength(3);
    expect(缓存.派生统计().本次派生次数).toBe(3);
  });

  it("第二次派生（无变化）：全 cache hit，派生次数 = 0", () => {
    const 缓存 = 创建聊天列表展示项缓存();
    const messages = [制造(1), 制造(2), 制造(3)];
    缓存.派生(默认输入({ messages }));
    // 模拟 xstate 新数组引用同内容
    const 第二次 = 缓存.派生(默认输入({ messages: [...messages] }));
    expect(第二次.filter((it: 聊天列表展示项) => it.kind === "message")).toHaveLength(3);
    expect(缓存.派生统计().本次派生次数).toBe(0);
  });

  it("新增 1 条消息：仅对新条调用派生", () => {
    const 缓存 = 创建聊天列表展示项缓存();
    const base = [制造(1), 制造(2), 制造(3)];
    缓存.派生(默认输入({ messages: base }));
    缓存.派生(默认输入({ messages: [...base, 制造(4)] }));
    expect(缓存.派生统计().本次派生次数).toBe(1);
  });

  it("修改 1 条（附件预览地址变更）：仅对变条重派生", () => {
    const 缓存 = 创建聊天列表展示项缓存();
    const msg: 消息事件 = {
      ...制造(1),
      attachments: [
        {
          kind: "image",
          attachment_id: "a-1",
          width: 100,
          height: 100,
        },
      ],
    };
    const messages = [msg, 制造(2)];
    缓存.派生(默认输入({ messages }));
    缓存.派生(
      默认输入({
        messages,
        附件预览地址表: { "a-1": { previewSrc: "https://cdn/x.png" } },
      })
    );
    expect(缓存.派生统计().本次派生次数).toBe(1);
  });

  it("layoutEnv 变更（宽度变化）：全部失效重派生", () => {
    const 缓存 = 创建聊天列表展示项缓存();
    const messages = [制造(1), 制造(2), 制造(3)];
    缓存.派生(默认输入({ messages }));
    const 宽布局: 消息文本布局环境 = {
      ...默认消息文本布局环境,
      maxContentWidth: 800,
    };
    缓存.派生(默认输入({ messages, layoutEnv: 宽布局 }));
    expect(缓存.派生统计().本次派生次数).toBe(3);
  });

  it("sessionId 变更：全部失效重派生（左右分边可能变了）", () => {
    const 缓存 = 创建聊天列表展示项缓存();
    const messages = [制造(1), 制造(2)];
    缓存.派生(默认输入({ messages, currentSessionId: "s-1" }));
    缓存.派生(默认输入({ messages, currentSessionId: "s-2" }));
    expect(缓存.派生统计().本次派生次数).toBe(2);
  });

  it("message_id 被裁掉：缓存自动驱逐（Map 不长期增长）", () => {
    const 缓存 = 创建聊天列表展示项缓存();
    const initial = [制造(1), 制造(2), 制造(3)];
    缓存.派生(默认输入({ messages: initial }));
    缓存.派生(默认输入({ messages: [制造(2), 制造(3)] }));
    // 派生函数返回类型暴露 单条缓存大小: 仅剩 m-2 / m-3
    expect(缓存.派生统计().单条缓存大小).toBe(2);
  });

  it("firstUnreadEventPosition 触发未读分隔条插入", () => {
    const 缓存 = 创建聊天列表展示项缓存();
    const items = 缓存.派生(
      默认输入({
        messages: [制造(1), 制造(2), 制造(3)],
        firstUnreadEventPosition: 2,
      })
    );
    expect(items.map((it: 聊天列表展示项) => it.kind)).toEqual([
      "message",
      "unread-divider",
      "message",
      "message",
    ]);
  });

  it("长跑契约：3000 起点 + 1万次新增 1 条，单条派生总数恰为 13000", () => {
    /**
     * 核心性能不变量：每次新增只派生 M（=1）条，不应再退化为 O(N) 全量。
     * 命中 1 万次 = 总派生 = 3000（首屏） + 10000（每次新增 1）= 13000
     */
    const 缓存 = 创建聊天列表展示项缓存();
    let messages = Array.from({ length: 3000 }, (_, i) => 制造(i + 1));
    缓存.派生(默认输入({ messages }));
    let 累计派生次数 = 缓存.派生统计().本次派生次数;
    for (let i = 0; i < 10_000; i++) {
      messages = [...messages, 制造(3001 + i)];
      缓存.派生(默认输入({ messages }));
      累计派生次数 += 缓存.派生统计().本次派生次数;
    }
    expect(累计派生次数).toBe(13_000);
  }, 120_000);
});
