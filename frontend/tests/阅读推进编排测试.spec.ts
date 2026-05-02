// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  创建阅读推进测试场景,
  读取阅读推进编排工厂,
} from "./common/聊天测试支架";
describe("阅读推进编排", () => {
  it("阅读推进 owner 直连生效，旧根入口已经删除", () => {
    const ownerSource = readFileSync(resolve(process.cwd(), "房间/壳层/阅读推进.ts"), "utf8");

    expect(existsSync(resolve(process.cwd(), "阅读推进编排.ts"))).toBe(false);
    expect(ownerSource).toContain("export function 创建阅读推进编排(");
    expect(ownerSource).not.toContain('type: "VIEWPORT_OBSERVED"');
    expect(ownerSource).not.toContain('type: "USER_JUMPED_TO_LATEST"');
    expect(ownerSource).not.toContain("function 读取阅读状态()");
    expect(ownerSource).not.toContain("function 写入阅读状态(");
    expect(ownerSource).not.toContain("function 接收时间线事实(");
  });

  it("首屏稳定完成后，已有候选已读才会进入正式待提交队列", async () => {
    const 创建阅读推进编排 = await 读取阅读推进编排工厂();
    const 场景 = 创建阅读推进测试场景({
      roomId: "r-test",
      latestEventPosition: 8,
      initialUnreadSettled: false,
      lastReadEventPosition: 1,
      firstUnreadEventPosition: 2,
    });
    const 编排 = 创建阅读推进编排(场景.deps) as {
      接收候选已读位置(position: number): void;
      接收首屏稳定完成(mode: "围绕未读阅读" | "贴底跟随"): void;
    };

    编排.接收候选已读位置(7);
    编排.接收首屏稳定完成("围绕未读阅读");

    expect(场景.读取状态().candidateReadAnchorPosition).toBe(7);
    expect(场景.读取状态().pendingReadAnchorPosition).toBe(7);
  });

  it("取消跟随最新采样时，不会顺手清掉已进入提交队列的阅读补锚", async () => {
    const 创建阅读推进编排 = await 读取阅读推进编排工厂();
    const 场景 = 创建阅读推进测试场景({
      roomId: "r-test",
      latestEventPosition: 8,
      initialUnreadSettled: true,
      lastReadEventPosition: 1,
      firstUnreadEventPosition: 2,
    });
    const 编排 = 创建阅读推进编排(场景.deps) as {
      接收候选已读位置(position: number): void;
      取消待跟随最新采样(): void;
      dispose(): void;
    };

    vi.useFakeTimers();
    try {
      编排.接收候选已读位置(7);
      编排.取消待跟随最新采样();
      await vi.advanceTimersByTimeAsync(401);

      expect(场景.transport.readAnchorUpdates).toEqual([
        {
          roomId: "r-test",
          sessionId: "s-test",
          lastReadEventPosition: 7,
        },
      ]);
      编排.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("取消待提交阅读补锚时，不会误伤贴底跟随后的采样窗口", async () => {
    const 创建阅读推进编排 = await 读取阅读推进编排工厂();
    const 场景 = 创建阅读推进测试场景({
      roomId: "r-test",
      latestEventPosition: 8,
      viewportMode: "离底浏览",
      initialUnreadSettled: true,
      lastReadEventPosition: 1,
      firstUnreadEventPosition: 2,
    });
    场景.roomScroller.读取当前可见阅读锚点.mockReturnValue(8);
    const 编排 = 创建阅读推进编排(场景.deps) as {
      请求跳到最新(): Promise<void>;
      取消待刷新已读锚点(): void;
      dispose(): void;
    };

    vi.useFakeTimers();
    try {
      await 编排.请求跳到最新();
      编排.取消待刷新已读锚点();
      await vi.advanceTimersByTimeAsync(1);

      expect(场景.读取状态().pendingReadAnchorPosition).toBe(8);
      编排.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("跳到最新后会进入贴底跟随并在需要时补读", async () => {
    const 创建阅读推进编排 = await 读取阅读推进编排工厂();
    const 场景 = 创建阅读推进测试场景({
      roomId: "r-test",
      latestEventPosition: 8,
      viewportMode: "离底浏览",
      initialUnreadSettled: true,
      lastReadEventPosition: 1,
      firstUnreadEventPosition: 2,
    });
    const 编排 = 创建阅读推进编排(场景.deps) as {
      请求跳到最新(): Promise<void>;
    };

    vi.useFakeTimers();
    try {
      场景.roomScroller.读取当前是否接近底部.mockReturnValue(true);
      await 编排.请求跳到最新();
      await vi.advanceTimersByTimeAsync(1);

      expect(场景.滚到最新调用).toHaveLength(1);
      expect(场景.读取状态().pendingReadAnchorPosition).toBe(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it("加载更早历史会合并消息、维持 hasMoreBefore，并保持当前视口不跳动", async () => {
    const 创建阅读推进编排 = await 读取阅读推进编排工厂();
    const 场景 = 创建阅读推进测试场景({
      roomId: "r-test",
      latestEventPosition: 3,
      hasMoreBefore: true,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-2",
          client_message_id: "c-2",
          sender_session_id: "s-test",
          sender_display_alias: "暴躁的企鹅",
          text: "现在消息",
          event_position: 2,
        },
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-3",
          client_message_id: "c-3",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "更新消息",
          event_position: 3,
        },
      ],
    });
    场景.transport.historyQueue = [
      {
        room_id: "r-test",
        messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "更早消息",
            event_position: 1,
          },
        ],
      },
    ];
    const 编排 = 创建阅读推进编排(场景.deps) as {
      请求加载更早历史(): Promise<void>;
    };

    await 编排.请求加载更早历史();

    expect(场景.读取状态().messages.map((message) => message.message_id)).toEqual([
      "m-1",
      "m-2",
      "m-3",
    ]);
    expect(场景.读取状态().hasMoreBefore).toBe(true);
    expect(场景.历史补偿调用).toEqual([
      {
        context: {
          旧滚动高度: 320,
          锚点消息位置: 2,
          锚点距容器顶部: 18,
        },
        inserted: true,
      },
    ]);
  });
});

