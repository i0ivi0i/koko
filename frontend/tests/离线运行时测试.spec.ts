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

  it("在线状态变化会通过订阅面向上游发布，而不是要求平台轮询 snapshot", async () => {
    const windowSource = new 假窗口事件源();
    const navigatorSource = {
      onLine: true,
    };
    const runtime = 创建离线运行时({
      window: windowSource as unknown as Window,
      navigator: navigatorSource as unknown as Navigator,
    });
    const 快照记录: Array<{ online: boolean }> = [];

    runtime.订阅?.((snapshot) => {
      快照记录.push({ online: snapshot.online });
    });
    await runtime.就绪();

    navigatorSource.onLine = false;
    windowSource.触发("offline");
    navigatorSource.onLine = true;
    windowSource.触发("online");

    expect(快照记录).toEqual([{ online: false }, { online: true }]);
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

  it("会登记待补发任务、支持排空重放，并在可用时请求 Background Sync", async () => {
    const windowSource = new 假窗口事件源();
    const registerSync = vi.fn(async () => {});
    const 保存 = vi.fn(async () => true);
    const 列出到期任务 = vi.fn(async () => [
      {
        id: "task-1",
        kind: "create_message",
        payload: { roomId: "r-1", text: "hello" },
        createdAt: 1,
        retryAt: 1,
        dedupeKey: "dedupe-task-1",
      },
    ]);
    const 删除 = vi.fn(async () => {});
    const 标记重试 = vi.fn(async () => {});
    const runtime = 创建离线运行时({
      window: windowSource as unknown as Window,
      navigator: {
        onLine: true,
      } as unknown as Navigator,
      // 这里先通过扩展依赖注入假仓库，确保 runtime 行为可以被精确验证。
      仓库: {
        保存,
        列出到期任务,
        删除,
        标记重试,
      },
      now: () => 100,
    } as unknown as Parameters<typeof 创建离线运行时>[0]);
    const 扩展运行时 = runtime as unknown as {
      登记待补发任务(task: {
        id: string;
        kind: "create_message";
        payload: unknown;
        createdAt: number;
        retryAt: number;
        dedupeKey?: string;
      }): Promise<boolean>;
      排空到期任务(
        handler: (task: {
          id: string;
          kind: "create_message";
          payload: unknown;
          createdAt: number;
          retryAt: number;
          dedupeKey?: string;
        }) => Promise<"done" | "retry">
      ): Promise<void>;
      请求后台补发同步(tag: string): Promise<boolean>;
    };

    await runtime.就绪({
      已注册服务工作线程: [
        {
          sync: {
            register: registerSync,
          },
        },
      ],
    });
    const 入队结果 = await 扩展运行时.登记待补发任务({
      id: "task-1",
      kind: "create_message",
      payload: { roomId: "r-1", text: "hello" },
      createdAt: 1,
      retryAt: 1,
      dedupeKey: "dedupe-task-1",
    });
    await 扩展运行时.排空到期任务(async () => "done");
    const 同步结果 = await 扩展运行时.请求后台补发同步("koko-queue-main");

    expect(入队结果).toBe(true);
    expect(保存).toHaveBeenCalledTimes(1);
    expect(列出到期任务).toHaveBeenCalledWith(100);
    expect(删除).toHaveBeenCalledWith("task-1");
    expect(标记重试).not.toHaveBeenCalled();
    expect(同步结果).toBe(true);
    expect(registerSync).toHaveBeenCalledWith("koko-queue-main");
  });
});
