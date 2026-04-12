// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { 创建服务工作线程运行时 } from "../平台/服务工作线程运行时";

describe("服务工作线程运行时", () => {
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
    expect(runtime.snapshot()).toEqual({
      appShellRegistered: true,
      mediaWorkerRegistered: true,
      persistentStorageRequested: true,
    });
  });
});
