// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { 创建应用运行时 } from "../应用运行时";
import type { 媒体查看器打开请求 } from "../媒体";
import type { 媒体会话信号 } from "../媒体/媒体会话";

const 创建媒体打开请求 = (): 媒体查看器打开请求 => ({
  startAttachmentId: "att-1",
  items: [],
});

const 创建运行时依赖 = () => ({
  dispatch: vi.fn(),
});

describe("应用运行时", () => {
  it("媒体打开必须先进入应用事件入口，再翻成内核 command", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);
    const request = 创建媒体打开请求();

    runtime.dispatch({ type: "MEDIA_OPEN_REQUESTED", request });

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "MEDIA_OPEN_REQUESTED",
      request,
    });
  });

  it("滚动信号必须先进入应用运行时，再翻成滚动观察 command", () => {
    const scrollContainer = document.createElement("div");
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);

    runtime.dispatch({ type: "ROOM_SCROLL_OBSERVED", scrollContainer });

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "ROOM_SCROLL_OBSERVED",
      scrollContainer,
    });
  });

  it("被视口 owner 吸收的程序性滚动不会在运行时里再旁路出第二套阅读逻辑", () => {
    const scrollContainer = document.createElement("div");
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);

    runtime.dispatch({ type: "ROOM_SCROLL_OBSERVED", scrollContainer });

    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "ROOM_SCROLL_OBSERVED",
      scrollContainer,
    });
  });

  it("用户滚动意图和跳到最新都只分派给既有 owner，不在运行时里重写业务规则", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);

    runtime.dispatch({ type: "ROOM_SCROLL_INTENT" });
    runtime.dispatch({ type: "ROOM_JUMP_TO_LATEST_REQUESTED" });

    expect(deps.dispatch).toHaveBeenNthCalledWith(1, {
      type: "ROOM_SCROLL_INTENT",
    });
    expect(deps.dispatch).toHaveBeenNthCalledWith(2, {
      type: "ROOM_JUMP_TO_LATEST_REQUESTED",
    });
  });

  it("媒体会话运行时信号也必须先进入应用运行时，再翻成内核 command", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);
    const signal: 媒体会话信号 = { type: "PLAYER_WAITING" };

    runtime.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-1",
      signal,
    });

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-1",
      signal,
    });
  });
});
