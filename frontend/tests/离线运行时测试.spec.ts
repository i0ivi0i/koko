import { describe, expect, it, vi } from "vitest";
import { 创建离线运行时 } from "../平台/离线运行时";

type 假事件处理器 = () => void;

class 假窗口事件源 {
  private readonly handlers = new Map<string, 假事件处理器[]>();

  addEventListener(type: string, handler: 假事件处理器): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  触发(type: string): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler();
    }
  }
}

describe("离线运行时", () => {
  it("只翻译浏览器在线状态和 Background Sync 可用性，不碰消息成立语义", async () => {
    const windowSource = new 假窗口事件源();
    const navigatorSource = {
      onLine: true,
      serviceWorker: {
        ready: Promise.resolve({
          sync: {
            register: async () => {},
          },
        }),
      },
    };
    const runtime = 创建离线运行时({
      window: windowSource as unknown as Window,
      navigator: navigatorSource as unknown as Navigator,
    });

    await runtime.就绪({
      已注册服务工作线程: [
        {
          sync: {
            register: async () => {},
          },
        },
      ],
    });
    expect(runtime.snapshot()).toEqual({
      online: true,
      backgroundSyncSupported: true,
      queuedTaskCapability: "background-sync",
    });

    navigatorSource.onLine = false;
    windowSource.触发("offline");
    expect(runtime.snapshot()).toEqual({
      online: false,
      backgroundSyncSupported: true,
      queuedTaskCapability: "background-sync",
    });
  });

  it("就绪不会卡死在 pending 的 serviceWorker.ready 上，而是先给出当前已知运行时事实", async () => {
    vi.useFakeTimers();
    const windowSource = new 假窗口事件源();
    const runtime = 创建离线运行时({
      window: windowSource as unknown as Window,
      navigator: {
        onLine: true,
        serviceWorker: {
          ready: new Promise(() => {}),
        },
      } as unknown as Navigator,
    });

    const 就绪结果 = Promise.race([
      runtime.就绪().then(() => "ready"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1)),
    ]);

    await vi.advanceTimersByTimeAsync(1);

    expect(await 就绪结果).toBe("ready");
    expect(runtime.snapshot()).toEqual({
      online: true,
      backgroundSyncSupported: false,
      queuedTaskCapability: "none",
    });

    vi.useRealTimers();
  });
});
