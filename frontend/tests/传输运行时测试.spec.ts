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

  it("接收生命周期变化时只记录浏览器运行时状态，不越权解释聊天业务语义", () => {
    const runtime = 创建传输运行时({
      baseUrl: "http://platform.local",
      createTransport: () => ({}) as 前端传输端口,
    });
    const hiddenSnapshot: 生命周期快照 = {
      visibility: "hidden",
      phase: "page_hidden",
    };

    runtime.接收生命周期变化(hiddenSnapshot);

    expect(runtime.snapshot()).toEqual({
      lastLifecycle: hiddenSnapshot,
    });
  });
});
