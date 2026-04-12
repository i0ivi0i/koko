// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../聊天壳.js", () => ({}));
vi.mock("../后台壳.js", () => ({}));

describe("前端入口", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("入口会注册 app shell 和 media 两个 worker，并 best-effort 申请持久化存储", async () => {
    const register = vi.fn().mockResolvedValue({});
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { persist },
      configurable: true,
    });

    await import("../入口");

    expect(register).toHaveBeenCalledWith("/app-sw.js", { scope: "/" });
    expect(register).toHaveBeenCalledWith("/media-sw.js", { scope: "/" });
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
