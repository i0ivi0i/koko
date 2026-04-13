// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { 创建服务工作线程运行时 } from "../平台/服务工作线程运行时";

type 事件监听器 = (event?: unknown) => void;

const 创建事件目标 = () => {
  const listeners = new Map<string, Set<事件监听器>>();
  return {
    addEventListener(type: string, listener: 事件监听器) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(listener);
    },
    dispatch(type: string, event?: unknown) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };
};

describe("服务工作线程运行时", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("会统一注册 app shell 与 media 两个 worker，并 best-effort 申请持久化存储", async () => {
    const register = vi.fn().mockResolvedValue({});
    const persist = vi.fn().mockResolvedValue(true);
    const runtime = 创建服务工作线程运行时({
      navigator: {
        serviceWorker: { register },
        storage: { persist },
      } as unknown as Navigator,
    });

    await runtime.启动();

    expect(register).toHaveBeenCalledWith("/app-sw.js", { scope: "/" });
    expect(register).toHaveBeenCalledWith("/media-sw.js", { scope: "/" });
    expect(persist).toHaveBeenCalledTimes(1);
    expect((runtime as unknown as { 读取注册(kind: "app" | "media"): unknown }).读取注册("app")).toEqual(
      {}
    );
    expect((runtime as unknown as { 读取注册(kind: "app" | "media"): unknown }).读取注册("media")).toEqual(
      {}
    );
    expect(runtime.snapshot()).toEqual({
      appShellRegistered: true,
      mediaWorkerRegistered: true,
      persistentStorageRequested: true,
      controllerAttached: false,
      appShellWaiting: false,
      mediaWorkerWaiting: false,
      lastMessageType: null,
      lastMessage: null,
    });
  });

  it("会把 controller / waiting / message 状态收进 runtime 快照，并允许页面向当前 controller 发消息", async () => {
    const 容器事件 = 创建事件目标();
    const app注册事件 = 创建事件目标();
    const media注册事件 = 创建事件目标();
    const controller = {
      postMessage: vi.fn(),
    };
    const appRegistration = {
      waiting: null as unknown,
      addEventListener: app注册事件.addEventListener,
    };
    const mediaRegistration = {
      waiting: { scriptURL: "/media-sw.js" },
      addEventListener: media注册事件.addEventListener,
    };
    const serviceWorker = {
      controller,
      register: vi
        .fn()
        .mockResolvedValueOnce(appRegistration)
        .mockResolvedValueOnce(mediaRegistration),
      addEventListener: 容器事件.addEventListener,
    };
    const runtime = 创建服务工作线程运行时({
      navigator: {
        serviceWorker,
        storage: { persist: vi.fn().mockResolvedValue(true) },
      } as unknown as Navigator,
    });

    await runtime.启动();

    expect(runtime.snapshot()).toMatchObject({
      controllerAttached: true,
      appShellWaiting: false,
      mediaWorkerWaiting: true,
      lastMessageType: null,
      lastMessage: null,
    });

    appRegistration.waiting = { scriptURL: "/app-sw.js" };
    app注册事件.dispatch("updatefound");
    容器事件.dispatch("message", { data: { type: "SW_UPDATED", scope: "app" } });

    expect(runtime.发送消息?.({ type: "PING" }) ?? false).toBe(true);
    expect(controller.postMessage).toHaveBeenCalledWith({ type: "PING" });
    expect(
      (runtime as unknown as {
        读取注册(kind: "app" | "media"): unknown;
      }).读取注册("app")
    ).toBe(appRegistration);
    expect(
      (runtime as unknown as {
        读取注册(kind: "app" | "media"): unknown;
      }).读取注册("media")
    ).toBe(mediaRegistration);
    expect(runtime.snapshot()).toMatchObject({
      controllerAttached: true,
      appShellWaiting: true,
      mediaWorkerWaiting: true,
      lastMessageType: "SW_UPDATED",
      lastMessage: { type: "SW_UPDATED", scope: "app" },
    });
  });
});
