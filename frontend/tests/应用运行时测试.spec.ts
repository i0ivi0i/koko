// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { 创建应用运行时 } from "../应用运行时";
import type { 媒体查看器打开请求 } from "../媒体";

const 创建媒体打开请求 = (): 媒体查看器打开请求 => ({
  startAttachmentId: "att-1",
  items: [],
});

const 创建运行时依赖 = () => ({
  标记用户滚动意图: vi.fn(),
  处理聊天视口滚动: vi.fn(),
  请求跳到最新: vi.fn(() => Promise.resolve()),
  登记程序滚动来源: vi.fn(),
  打开媒体: vi.fn(),
});

describe("应用运行时", () => {
  it("媒体打开必须先进入应用事件入口，再通知视口占用并打开查看器", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);
    const request = 创建媒体打开请求();

    runtime.dispatch({ type: "MEDIA_OPEN_REQUESTED", request });

    expect(deps.登记程序滚动来源).toHaveBeenCalledWith("media_viewer_open");
    expect(deps.打开媒体).toHaveBeenCalledWith(request);
    const 视口登记顺序 = deps.登记程序滚动来源.mock.invocationCallOrder[0];
    const 查看器打开顺序 = deps.打开媒体.mock.invocationCallOrder[0];
    expect(视口登记顺序).toBeDefined();
    expect(查看器打开顺序).toBeDefined();
    expect(视口登记顺序!).toBeLessThan(查看器打开顺序!);
  });

  it("滚动信号必须先由视口 owner 裁决，只有真实用户视口滚动才推进阅读编排", () => {
    const scrollContainer = document.createElement("div");
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);

    runtime.dispatch({ type: "ROOM_SCROLL_OBSERVED", scrollContainer });

    expect(deps.处理聊天视口滚动).toHaveBeenCalledWith(scrollContainer);
  });

  it("被视口 owner 吸收的程序性滚动不会在运行时里再旁路出第二套阅读逻辑", () => {
    const scrollContainer = document.createElement("div");
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);

    runtime.dispatch({ type: "ROOM_SCROLL_OBSERVED", scrollContainer });

    expect(deps.处理聊天视口滚动).toHaveBeenCalledWith(scrollContainer);
    expect(deps.请求跳到最新).not.toHaveBeenCalled();
    expect(deps.标记用户滚动意图).not.toHaveBeenCalled();
  });

  it("用户滚动意图和跳到最新都只分派给既有 owner，不在运行时里重写业务规则", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);

    runtime.dispatch({ type: "ROOM_SCROLL_INTENT" });
    runtime.dispatch({ type: "ROOM_JUMP_TO_LATEST_REQUESTED" });

    expect(deps.标记用户滚动意图).toHaveBeenCalledOnce();
    expect(deps.请求跳到最新).toHaveBeenCalledOnce();
  });
});
