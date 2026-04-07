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
    });

    滚动器.安排首屏定位();
    await Promise.resolve();

    expect(状态.initialUnreadSettled).toBe(false);
    expect(状态.scrollPhase).toBe("restoring_unread");
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
    });

    滚动器.处理滚动事件(容器);

    expect(已读采样).toHaveBeenCalledWith(7);
  });
});
