// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 聊天状态 } from "../状态";

function 创建滚动容器(): HTMLElement {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 240,
  });
  Object.defineProperty(container, "scrollHeight", {
    configurable: true,
    value: 640,
  });
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    writable: true,
    value: 120,
  });
  Object.defineProperty(container, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 240,
      width: 320,
      height: 240,
      toJSON: () => ({}),
    }),
  });
  return container;
}

function 创建消息节点(eventPosition: number, top: number, bottom: number): HTMLElement {
  const row = document.createElement("li");
  row.dataset.eventPosition = String(eventPosition);
  Object.defineProperty(row, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: top,
      top,
      left: 0,
      right: 320,
      bottom,
      width: 320,
      height: bottom - top,
      toJSON: () => ({}),
    }),
  });
  return row;
}

describe("房间滚动器", () => {
  it("首屏恢复期间的程序滚动不会立刻采样成用户已读", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: 5,
      initialUnreadSettled: false,
      scrollPhase: "restoring_unread",
      historyLoading: false,
      hasMoreBefore: true,
      hasUserScrollIntent: false,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    const 已读采样 = vi.fn();
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };

    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => [],
      请求更早历史: vi.fn(),
      采样阅读锚点: 已读采样,
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    });

    滚动器.安排首屏定位();
    await Promise.resolve();
    滚动器.处理滚动事件(容器);

    expect(已读采样).not.toHaveBeenCalled();
  });

  it("首条未读节点本轮还没出现时，不会把首屏定位直接标记为完成", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: 5,
      initialUnreadSettled: false,
      scrollPhase: "restoring_unread",
      historyLoading: false,
      hasMoreBefore: true,
      hasUserScrollIntent: false,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };

    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => [],
      请求更早历史: vi.fn(),
      采样阅读锚点: vi.fn(),
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    });

    滚动器.安排首屏定位();
    await Promise.resolve();

    expect(状态.initialUnreadSettled).toBe(false);
    expect(状态.scrollPhase).toBe("restoring_unread");
  });

  it("围绕首条未读稳定落位后，会显式上报首屏完成事件", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    vi.useFakeTimers();
    try {
      const 状态: Pick<
        聊天状态,
        | "roomId"
        | "firstUnreadEventPosition"
        | "initialUnreadSettled"
        | "scrollPhase"
        | "historyLoading"
        | "hasMoreBefore"
        | "hasUserScrollIntent"
        | "historyLoadThrottleUntil"
      > = {
        roomId: "r-test",
        firstUnreadEventPosition: 5,
        initialUnreadSettled: false,
        scrollPhase: "restoring_unread",
        historyLoading: false,
        hasMoreBefore: true,
        hasUserScrollIntent: false,
        historyLoadThrottleUntil: 0,
      };
      const 容器 = 创建滚动容器();
      const 首屏完成 = vi.fn();
      const 未读节点 = document.createElement("div");
      未读节点.dataset.eventPosition = "5";
      未读节点.scrollIntoView = vi.fn();
      Object.defineProperty(未读节点, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          x: 0,
          y: 60,
          top: 60,
          left: 0,
          right: 320,
          bottom: 100,
          width: 320,
          height: 40,
          toJSON: () => ({}),
        }),
      });
      const 主机 = {
        addController() {},
        removeController() {},
        requestUpdate() {},
        updateComplete: Promise.resolve(true),
      };

      const 滚动器 = new 房间滚动器(主机, {
        读取状态: () => 状态,
        更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
        查询滚动容器: () => 容器,
        查询消息节点: () => [未读节点],
        请求更早历史: vi.fn(),
        采样阅读锚点: vi.fn(),
        读取是否需要恢复补锚: () => false,
        消耗恢复补锚标记: () => {},
        报告首屏稳定完成: 首屏完成,
      } as ConstructorParameters<typeof 房间滚动器>[1]);

      滚动器.安排首屏定位();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(首屏完成).toHaveBeenCalledWith("围绕未读阅读");
    } finally {
      vi.useRealTimers();
    }
  });

  it("无未读时落到底部后，会显式上报贴底跟随的首屏完成事件", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: null,
      initialUnreadSettled: false,
      scrollPhase: "idle",
      historyLoading: false,
      hasMoreBefore: true,
      hasUserScrollIntent: false,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    const 首屏完成 = vi.fn();
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };

    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => [],
      请求更早历史: vi.fn(),
      采样阅读锚点: vi.fn(),
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: 首屏完成,
    } as ConstructorParameters<typeof 房间滚动器>[1]);

    滚动器.安排首屏定位();
    await Promise.resolve();
    await Promise.resolve();

    expect(首屏完成).toHaveBeenCalledWith("贴底跟随");
  });

  it("跳到最新由视口 owner 落到底部，并吸收随后的程序性滚动尾波", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: null,
      initialUnreadSettled: true,
      scrollPhase: "idle",
      historyLoading: false,
      hasMoreBefore: true,
      hasUserScrollIntent: true,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    容器.scrollTop = 24;
    const 请求更早历史 = vi.fn();
    const 已读采样 = vi.fn();
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };

    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => [创建消息节点(8, 180, 230)],
      请求更早历史,
      采样阅读锚点: 已读采样,
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    } as ConstructorParameters<typeof 房间滚动器>[1]);

    await (滚动器 as unknown as { 滚到最新位置(): Promise<void> }).滚到最新位置();

    expect(容器.scrollTop).toBe(400);
    expect(滚动器.处理滚动事件(容器)).toBe(false);
    expect(请求更早历史).not.toHaveBeenCalled();
    expect(已读采样).not.toHaveBeenCalled();

    滚动器.标记用户滚动意图();
    expect(滚动器.处理滚动事件(容器)).toBe(true);
  });

  it("长消息达到稳定可读阈值时，也会被采样成候选已读锚点", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: null,
      initialUnreadSettled: true,
      scrollPhase: "idle",
      historyLoading: false,
      hasMoreBefore: true,
      hasUserScrollIntent: true,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    const 已读采样 = vi.fn();
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };

    const 长消息节点 = document.createElement("div");
    长消息节点.dataset.eventPosition = "7";
    Object.defineProperty(长消息节点, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 40,
        top: 40,
        left: 0,
        right: 320,
        bottom: 320,
        width: 320,
        height: 280,
        toJSON: () => ({}),
      }),
    });

    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => [长消息节点],
      请求更早历史: vi.fn(),
      采样阅读锚点: 已读采样,
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    });

    滚动器.处理滚动事件(容器);

    expect(已读采样).toHaveBeenCalledWith(7);
  });

  it("历史补偿会优先守住最靠近顶部的稳定可读消息锚点", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: null,
      initialUnreadSettled: true,
      scrollPhase: "compensating_history",
      historyLoading: true,
      hasMoreBefore: true,
      hasUserScrollIntent: true,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    let 消息节点 = [
      创建消息节点(1, -20, 20),
      创建消息节点(2, 12, 92),
      创建消息节点(3, 108, 188),
    ];
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };
    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => 消息节点,
      请求更早历史: vi.fn(),
      采样阅读锚点: vi.fn(),
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    });

    const 补偿上下文 = 滚动器.读取历史补偿上下文();
    Object.defineProperty(容器, "scrollHeight", {
      configurable: true,
      value: 790,
    });
    消息节点 = [
      创建消息节点(-1, -120, -40),
      创建消息节点(0, -32, 48),
      创建消息节点(1, 100, 140),
      创建消息节点(2, 132, 212),
      创建消息节点(3, 228, 308),
    ];

    await 滚动器.应用历史补偿(补偿上下文, true);

    expect(容器.scrollTop).toBe(240);
  });

  it("历史补偿在没有稳定可读消息时，会退回到最靠近顶部的重叠消息锚点", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: null,
      initialUnreadSettled: true,
      scrollPhase: "compensating_history",
      historyLoading: true,
      hasMoreBefore: true,
      hasUserScrollIntent: true,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    let 消息节点 = [
      创建消息节点(1, -70, 30),
      创建消息节点(2, 220, 320),
      创建消息节点(3, 320, 420),
    ];
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };
    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => 消息节点,
      请求更早历史: vi.fn(),
      采样阅读锚点: vi.fn(),
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    });

    const 补偿上下文 = 滚动器.读取历史补偿上下文();
    Object.defineProperty(容器, "scrollHeight", {
      configurable: true,
      value: 800,
    });
    消息节点 = [
      创建消息节点(-1, -160, -80),
      创建消息节点(0, -60, 20),
      创建消息节点(1, 50, 150),
      创建消息节点(2, 340, 440),
      创建消息节点(3, 440, 540),
    ];

    await 滚动器.应用历史补偿(补偿上下文, true);

    expect(容器.scrollTop).toBe(240);
  });

  it("历史补偿在找不回旧锚点时，会退回到 scrollHeight 差值补偿", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: null,
      initialUnreadSettled: true,
      scrollPhase: "compensating_history",
      historyLoading: true,
      hasMoreBefore: true,
      hasUserScrollIntent: true,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    let 消息节点 = [创建消息节点(2, 16, 96)];
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };
    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => 消息节点,
      请求更早历史: vi.fn(),
      采样阅读锚点: vi.fn(),
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    });

    const 补偿上下文 = 滚动器.读取历史补偿上下文();
    Object.defineProperty(容器, "scrollHeight", {
      configurable: true,
      value: 780,
    });
    消息节点 = [创建消息节点(-1, -120, -40)];

    await 滚动器.应用历史补偿(补偿上下文, true);

    expect(容器.scrollTop).toBe(260);
  });

  it("显式登记的程序滚动来源不会继续上报成用户视口滚动", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: null,
      initialUnreadSettled: true,
      scrollPhase: "idle",
      historyLoading: false,
      hasMoreBefore: true,
      hasUserScrollIntent: true,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    容器.scrollTop = 0;
    const 请求更早历史 = vi.fn();
    const 已读采样 = vi.fn();
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };

    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => [创建消息节点(3, 24, 96)],
      请求更早历史,
      采样阅读锚点: 已读采样,
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    });

    (
      滚动器 as unknown as {
        登记程序滚动来源: (source: string) => void;
      }
    ).登记程序滚动来源("media_viewer_open");
    const 应继续观察视口 = (
      滚动器 as unknown as {
        处理滚动事件: (container: HTMLElement) => boolean;
      }
    ).处理滚动事件(容器);

    expect(应继续观察视口).toBe(false);
    expect(请求更早历史).not.toHaveBeenCalled();
    expect(已读采样).not.toHaveBeenCalled();
  });

  it("媒体查看器释放后的无意图滚动尾波不会误触发历史分页", async () => {
    const { 房间滚动器 } = await import("../房间滚动器");

    const 状态: Pick<
      聊天状态,
      | "roomId"
      | "firstUnreadEventPosition"
      | "initialUnreadSettled"
      | "scrollPhase"
      | "historyLoading"
      | "hasMoreBefore"
      | "hasUserScrollIntent"
      | "historyLoadThrottleUntil"
    > = {
      roomId: "r-test",
      firstUnreadEventPosition: null,
      initialUnreadSettled: true,
      scrollPhase: "idle",
      historyLoading: false,
      hasMoreBefore: true,
      hasUserScrollIntent: true,
      historyLoadThrottleUntil: 0,
    };
    const 容器 = 创建滚动容器();
    容器.scrollTop = 0;
    const 请求更早历史 = vi.fn();
    const 已读采样 = vi.fn();
    const 主机 = {
      addController() {},
      removeController() {},
      requestUpdate() {},
      updateComplete: Promise.resolve(true),
    };

    const 滚动器 = new 房间滚动器(主机, {
      读取状态: () => 状态,
      更新状态: (patch: Partial<聊天状态>) => Object.assign(状态, patch),
      查询滚动容器: () => 容器,
      查询消息节点: () => [创建消息节点(3, 24, 96)],
      请求更早历史,
      采样阅读锚点: 已读采样,
      读取是否需要恢复补锚: () => false,
      消耗恢复补锚标记: () => {},
      报告首屏稳定完成: vi.fn(),
    });

    滚动器.登记程序滚动来源("media_viewer_open");
    滚动器.清除程序滚动来源("media_viewer_open");

    const 尾波滚动应继续观察视口 = 滚动器.处理滚动事件(容器);

    expect(尾波滚动应继续观察视口).toBe(false);
    expect(请求更早历史).not.toHaveBeenCalled();
    expect(已读采样).not.toHaveBeenCalled();

    滚动器.标记用户滚动意图();
    const 用户滚动应继续观察视口 = 滚动器.处理滚动事件(容器);

    expect(用户滚动应继续观察视口).toBe(true);
    expect(请求更早历史).toHaveBeenCalledTimes(1);
  });
});
