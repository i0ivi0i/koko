import { describe, expect, it } from "vitest";
import { 创建缓存更新运行时 } from "../平台/缓存更新运行时";

describe("缓存更新运行时", () => {
  it("service worker waiting 只会进入 update pending，而不会让旧 bundle 与新 bundle 长期混跑", () => {
    const runtime = 创建缓存更新运行时();

    runtime.send({
      type: "SERVICE_WORKER_UPDATE_READY",
      scope: "app",
    });

    expect(runtime.snapshot()).toMatchObject({
      updateState: "waiting_refresh",
      waitingScope: "app",
      controllerReadyPending: false,
      controllerReadyContextId: null,
    });
  });

  it("controllerchange 后只有主上下文允许推进应用刷新完成态", () => {
    const runtime = 创建缓存更新运行时();

    runtime.send({
      type: "SERVICE_WORKER_UPDATE_READY",
      scope: "media",
    });
    runtime.send({
      type: "SERVICE_WORKER_CONTROLLER_READY",
    });

    expect(runtime.snapshot()).toMatchObject({
      updateState: "waiting_refresh",
      controllerReadyPending: true,
      controllerReadyContextId: null,
    });

    runtime.send({
      type: "PRIMARY_CONTEXT_CHANGED",
      contextId: "tab-primary",
    });

    expect(runtime.snapshot()).toMatchObject({
      updateState: "idle",
      waitingScope: null,
      controllerReadyPending: false,
      controllerReadyContextId: "tab-primary",
    });
  });

  it("存储持久化失败或驱逐时，只会降级为 acceleration loss", () => {
    const runtime = 创建缓存更新运行时();

    runtime.send({
      type: "STORAGE_PERSISTENCE_RESULT",
      persisted: false,
    });
    expect(runtime.snapshot().accelerationState).toBe("acceleration_loss");

    runtime.send({
      type: "STORAGE_PERSISTENCE_RESULT",
      persisted: true,
    });
    expect(runtime.snapshot().accelerationState).toBe("persistent");

    runtime.send({
      type: "STORAGE_EVICTION_DETECTED",
    });
    expect(runtime.snapshot().accelerationState).toBe("acceleration_loss");
  });
});
