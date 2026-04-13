import { describe, expect, it } from "vitest";
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
});
