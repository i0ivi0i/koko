import { describe, expect, it, vi } from "vitest";
import type { 前端传输端口 } from "../传输";
import type { 生命周期快照 } from "../平台";
import { 创建传输运行时 } from "../平台/传输运行时";

describe("传输运行时", () => {
  it("会统一创建并复用同一个 transport 端口，不让壳层各自 new 一份", () => {
    const createTransport = vi.fn(
      () =>
        ({
          marker: "runtime-owned",
        }) as unknown as 前端传输端口
    );
    const runtime = 创建传输运行时({
      baseUrl: "http://platform.local",
      createTransport,
    });

    const first = runtime.transport();
    const second = runtime.transport();

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith("http://platform.local");
    expect(first).toBe(second);
  });

  it("接收生命周期变化时会把浏览器可见性翻成传输策略，并统一交给 transport 适配器", () => {
    const 接收运行时策略 = vi.fn();
    const runtime = 创建传输运行时({
      baseUrl: "http://platform.local",
      createTransport: () =>
        ({
          接收运行时策略,
        }) as unknown as 前端传输端口,
    });
    const hiddenSnapshot: 生命周期快照 = {
      visibility: "hidden",
      phase: "page_hidden",
    };

    runtime.接收生命周期变化(hiddenSnapshot);

    expect(runtime.snapshot()).toEqual({
      lastLifecycle: hiddenSnapshot,
      realtimePolicy: {
        intent: "suspend",
        reconnection: false,
        reason: "page_hidden",
      },
    });
    expect(接收运行时策略).toHaveBeenCalledWith({
      intent: "suspend",
      reconnection: false,
      reason: "page_hidden",
    });
  });
});
