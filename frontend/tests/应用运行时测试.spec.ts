import { existsSync } from "node:fs";
import { resolve } from "node:path";
// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { 创建应用运行时 } from "../平台/应用运行时";
import type { 浏览器应用平台事件 } from "../平台";
import type { 媒体查看器打开请求 } from "../媒体";
import type { 媒体会话信号 } from "../媒体/媒体会话";
import type { 媒体播放位置 } from "../媒体/媒体播放";

const 创建媒体打开请求 = (): 媒体查看器打开请求 => ({
  startAttachmentId: "att-1",
  items: [],
});

const 创建运行时依赖 = () => ({
  dispatch: vi.fn(),
});

describe("应用运行时", () => {
  it("平台 owner 直接提供应用运行时，旧根门面已经删除", () => {
    expect(existsSync(resolve(process.cwd(), "应用运行时.ts"))).toBe(false);
  });

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
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);

    runtime.dispatch({ type: "ROOM_SCROLL_OBSERVED" });

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "ROOM_SCROLL_OBSERVED",
    });
  });

  it("被视口 owner 吸收的程序性滚动不会在运行时里再旁路出第二套阅读逻辑", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);

    runtime.dispatch({ type: "ROOM_SCROLL_OBSERVED" });

    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "ROOM_SCROLL_OBSERVED",
    });
  });

  it("房间媒体窗口观察结果也必须先进入应用运行时，再翻成媒体窗口 command", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);
    const attachmentIds = ["att-video-window-1", "att-video-window-2"];

    runtime.dispatch({
      type: "ROOM_MEDIA_WINDOW_OBSERVED",
      attachmentIds,
    });

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "ROOM_MEDIA_WINDOW_OBSERVED",
      attachmentIds,
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

  it("自动播候选观察结果也必须先进入应用运行时，再翻成内核 command", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);
    const candidates = [
      {
        attachmentId: "att-video-1",
        visibilityRatio: 0.78,
        distanceToViewportCenter: 18,
      },
    ];

    runtime.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates,
    });

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates,
    });
  });

  it("自动播播放位置也必须先进入应用运行时，再翻成媒体 owner command", () => {
    const deps = 创建运行时依赖();
    const runtime = 创建应用运行时(deps);
    const position: 媒体播放位置 = {
      src: "http://media.local/swarm-video-1",
      currentTime: 12.5,
      updatedAt: 1_000,
    };

    runtime.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED",
      attachmentId: "att-video-1",
      position,
    } as never);

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED",
      attachmentId: "att-video-1",
      position,
    });
  });

  it("平台生命周期变化会先进入应用运行时，再翻成内核 command", () => {
    const commands: unknown[] = [];
    let 平台事件监听器: ((event: 浏览器应用平台事件) => void) | null = null;

    const runtime = 创建应用运行时({
      dispatch: (command) => {
        commands.push(command);
      },
      subscribePlatformEvents: (listener) => {
        平台事件监听器 = listener;
        return () => {
          平台事件监听器 = null;
        };
      },
    });

    runtime.start();
    (
      平台事件监听器 as ((event: 浏览器应用平台事件) => void) | null
    )?.({
      type: "LIFECYCLE_CHANGED",
      snapshot: { visibility: "hidden", phase: "background" },
    });

    expect(commands).toContainEqual({
      type: "PLATFORM_LIFECYCLE_CHANGED",
      snapshot: { visibility: "hidden", phase: "background" },
    });
  });

  it("缓存更新与存储驱逐快照会先进入应用运行时，再翻成内核 command", () => {
    const commands: unknown[] = [];
    let 平台事件监听器: ((event: 浏览器应用平台事件) => void) | null = null;
    const cacheUpdateSnapshot = {
      updateState: "idle" as const,
      waitingScope: null,
      primaryContextId: "tab-a",
      controllerReadyPending: false,
      controllerReadyContextId: "tab-a",
      accelerationState: "acceleration_loss" as const,
    };

    const runtime = 创建应用运行时({
      dispatch: (command) => {
        commands.push(command);
      },
      subscribePlatformEvents: (listener) => {
        平台事件监听器 = listener;
        return () => {
          平台事件监听器 = null;
        };
      },
    });

    runtime.start();
    (
      平台事件监听器 as ((event: 浏览器应用平台事件) => void) | null
    )?.({
      type: "CACHE_UPDATE_CHANGED",
      snapshot: cacheUpdateSnapshot,
    });

    expect(commands).toContainEqual({
      type: "PLATFORM_CACHE_UPDATE_CHANGED",
      snapshot: cacheUpdateSnapshot,
    });
  });

  it("应用运行时销毁后会解除平台事件订阅", () => {
    let 已解除订阅 = false;
    const runtime = 创建应用运行时({
      dispatch: () => {},
      subscribePlatformEvents: () => () => {
        已解除订阅 = true;
      },
    });

    runtime.start();
    runtime.dispose();

    expect(已解除订阅).toBe(true);
  });
});
