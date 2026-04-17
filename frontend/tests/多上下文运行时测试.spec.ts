import { describe, expect, it, vi } from "vitest";
import { 创建多上下文运行时 } from "../平台/多上下文运行时";

type 多上下文消息处理器 = (event: { data: unknown }) => void;

class 假广播信道中枢 {
  private readonly handlers = new Map<string, Set<多上下文消息处理器>>();

  创建信道(name: string) {
    return {
      addEventListener: (_type: string, handler: 多上下文消息处理器) => {
        const list = this.handlers.get(name) ?? new Set<多上下文消息处理器>();
        list.add(handler);
        this.handlers.set(name, list);
      },
      postMessage: (data: unknown) => {
        for (const handler of this.handlers.get(name) ?? []) {
          handler({ data });
        }
      },
      close: () => {},
    };
  }
}

describe("多上下文运行时", () => {
  it("只负责主窗口声明和通知去重，不夹带聊天业务语义", () => {
    const hub = new 假广播信道中枢();
    const runtimeA = 创建多上下文运行时({
      contextId: "tab-a",
      createChannel: (name) => hub.创建信道(name),
    });
    const runtimeB = 创建多上下文运行时({
      contextId: "tab-b",
      createChannel: (name) => hub.创建信道(name),
    });

    runtimeA.声明主上下文();

    expect(runtimeA.snapshot()).toMatchObject({
      contextId: "tab-a",
      isPrimaryContext: true,
    });
    expect(runtimeB.snapshot()).toMatchObject({
      contextId: "tab-b",
      isPrimaryContext: false,
    });

    runtimeB.声明主上下文();
    expect(runtimeA.snapshot().isPrimaryContext).toBe(false);
    expect(runtimeB.snapshot().isPrimaryContext).toBe(true);

    expect(runtimeA.通知已展示("message-1")).toBe(false);
    expect(runtimeA.登记通知已展示("message-1")).toBe(true);
    expect(runtimeA.通知已展示("message-1")).toBe(true);
    expect(runtimeB.登记通知已展示("message-1")).toBe(false);

    runtimeB.请求聚焦当前上下文();

    expect(runtimeA.snapshot()).toMatchObject({
      lastFocusedContextId: "tab-b",
    });
    expect(runtimeB.snapshot()).toMatchObject({
      lastFocusedContextId: "tab-b",
    });
  });

  it("主上下文切换会发出稳定平台事件，避免多个标签页同时宣布自己是 primary", () => {
    const hub = new 假广播信道中枢();
    const runtimeA = 创建多上下文运行时({
      contextId: "tab-a",
      createChannel: (name) => hub.创建信道(name),
    });
    const runtimeB = 创建多上下文运行时({
      contextId: "tab-b",
      createChannel: (name) => hub.创建信道(name),
    });
    const eventsA: Array<{ type: string; contextId: string; isPrimaryContext?: boolean }> = [];
    const eventsB: Array<{ type: string; contextId: string; isPrimaryContext?: boolean }> = [];

    runtimeA.订阅事件?.((event) => {
      eventsA.push(event);
    });
    runtimeB.订阅事件?.((event) => {
      eventsB.push(event);
    });

    runtimeA.声明主上下文();
    runtimeB.声明主上下文();

    expect(eventsA).toEqual(
      expect.arrayContaining([
        {
          type: "PRIMARY_CONTEXT_CHANGED",
          contextId: "tab-a",
          isPrimaryContext: true,
        },
        {
          type: "PRIMARY_CONTEXT_CHANGED",
          contextId: "tab-b",
          isPrimaryContext: false,
        },
      ])
    );
    expect(eventsB.at(-1)).toEqual({
      type: "PRIMARY_CONTEXT_CHANGED",
      contextId: "tab-b",
      isPrimaryContext: true,
    });
  });

  it("请求回到应用前台会先尝试 focus/open，失败时才广播接管消息", async () => {
    const hub = new 假广播信道中枢();
    const focusSelf = vi
      .fn<() => boolean | Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const openSelf = vi
      .fn<() => boolean | Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const runtimeA = 创建多上下文运行时({
      contextId: "tab-a",
      createChannel: (name) => hub.创建信道(name),
      focusSelf,
      openSelf,
    });
    const runtimeB = 创建多上下文运行时({
      contextId: "tab-b",
      createChannel: (name) => hub.创建信道(name),
    });

    const 第一次恢复结果 = await runtimeA.请求回到应用前台?.();
    expect(第一次恢复结果).toBe(true);
    expect(runtimeA.snapshot().lastFocusedContextId).toBe("tab-a");

    const 第二次恢复结果 = await runtimeA.请求回到应用前台?.();
    expect(第二次恢复结果).toBe(false);
    // 第二次 focus/open 都失败后，运行时会退化成广播，让其它上下文收到接管信号。
    expect(runtimeB.snapshot().lastFocusedContextId).toBe("tab-a");
    expect(focusSelf).toHaveBeenCalledTimes(2);
    expect(openSelf).toHaveBeenCalledTimes(2);
  });
});
