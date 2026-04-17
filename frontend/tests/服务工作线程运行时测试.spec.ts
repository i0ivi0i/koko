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

  it("会只注册一个根 scope worker 来同时承载 app shell 与 media 能力，持久化申请改由存储运行时统一托管", async () => {
    const registration = {};
    const register = vi.fn().mockResolvedValue(registration);
    const runtime = 创建服务工作线程运行时({
      navigator: {
        serviceWorker: { register },
      } as unknown as Navigator,
    });

    await runtime.启动();

    expect(register).toHaveBeenCalledWith("/app-sw.js", { scope: "/" });
    expect(register).toHaveBeenCalledTimes(1);
    expect((runtime as unknown as { 读取注册(kind: "app" | "media"): unknown }).读取注册("app")).toBe(
      registration
    );
    expect((runtime as unknown as { 读取注册(kind: "app" | "media"): unknown }).读取注册("media")).toBe(
      registration
    );
    expect(runtime.snapshot()).toEqual({
      appShellRegistered: true,
      mediaWorkerRegistered: true,
      persistentStorageRequested: false,
      controllerAttached: false,
      appShellWaiting: false,
      mediaWorkerWaiting: false,
      lastMessageType: null,
      lastMessage: null,
    });

    runtime.写入持久化存储结果?.(true);
    expect(runtime.snapshot().persistentStorageRequested).toBe(true);
  });

  it("会把 controller / waiting / message 状态收进 runtime 快照，并允许页面向当前 controller 发消息", async () => {
    const 容器事件 = 创建事件目标();
    const app注册事件 = 创建事件目标();
    const controller = {
      postMessage: vi.fn(),
    };
    const appRegistration = {
      waiting: null as unknown,
      addEventListener: app注册事件.addEventListener,
    };
    const serviceWorker = {
      controller,
      register: vi.fn().mockResolvedValue(appRegistration),
      addEventListener: 容器事件.addEventListener,
    };
    const runtime = 创建服务工作线程运行时({
      navigator: {
        serviceWorker,
      } as unknown as Navigator,
    });

    await runtime.启动();

    expect(runtime.snapshot()).toMatchObject({
      controllerAttached: true,
      appShellWaiting: false,
      mediaWorkerWaiting: false,
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
    ).toBe(appRegistration);
    expect(runtime.snapshot()).toMatchObject({
      controllerAttached: true,
      appShellWaiting: true,
      mediaWorkerWaiting: true,
      lastMessageType: "SW_UPDATED",
      lastMessage: { type: "SW_UPDATED", scope: "app" },
    });
  });

  it("等待中的 worker 更新与后台唤醒会发出平台事件，并且只在显式接受后才会 skip waiting", async () => {
    const 容器事件 = 创建事件目标();
    const app注册事件 = 创建事件目标();
    const 等待中的AppWorker = {
      postMessage: vi.fn(),
    };
    const appRegistration = {
      waiting: 等待中的AppWorker,
      addEventListener: app注册事件.addEventListener,
    };
    const serviceWorker = {
      controller: null as { postMessage: (message: unknown) => void } | null,
      register: vi.fn().mockResolvedValue(appRegistration),
      addEventListener: 容器事件.addEventListener,
    };
    const runtime = 创建服务工作线程运行时({
      navigator: {
        serviceWorker,
      } as unknown as Navigator,
    });
    const 新增能力端口 = runtime as unknown as {
      订阅事件?(listener: (event: unknown) => void): () => void;
      接受更新?(): boolean;
    };
    const 事件列表: unknown[] = [];
    新增能力端口.订阅事件?.((event) => {
      事件列表.push(event);
    });

    await runtime.启动();

    // 这里先触发 updatefound，再手动接受更新，避免退化为“自动 skip waiting”。
    app注册事件.dispatch("updatefound");
    const 接受结果 = 新增能力端口.接受更新?.() ?? false;
    // 模拟更新后的 controller 已接管页面，再触发 controllerchange。
    serviceWorker.controller = {
      postMessage: vi.fn(),
    };
    容器事件.dispatch("controllerchange");
    容器事件.dispatch("message", { data: { type: "BACKGROUND_DRAIN_REQUESTED" } });

    expect(接受结果).toBe(true);
    expect(等待中的AppWorker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(事件列表).toEqual(
      expect.arrayContaining([
        { type: "SERVICE_WORKER_UPDATE_READY", scope: "app" },
        { type: "SERVICE_WORKER_CONTROLLER_READY" },
        { type: "BACKGROUND_DRAIN_REQUESTED" },
      ])
    );
  });
});
