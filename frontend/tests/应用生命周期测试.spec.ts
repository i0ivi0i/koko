import { describe, expect, it } from "vitest";
import { 创建应用生命周期Actor } from "../平台/应用生命周期";

describe("应用生命周期Actor", () => {
  it("hidden/background 会把重型工作意图降到 reduced", () => {
    const actor = 创建应用生命周期Actor();

    actor.send({
      type: "LIFECYCLE_SNAPSHOT_CHANGED",
      snapshot: { visibility: "hidden", phase: "background" },
    });

    expect(actor.snapshot()).toMatchObject({
      visibility: "hidden",
      phase: "background",
      heavyWorkPolicy: "reduced",
    });
  });

  it("page_hidden/frozen 会把重型工作意图降到 suspended", () => {
    const actor = 创建应用生命周期Actor();

    actor.send({
      type: "LIFECYCLE_SNAPSHOT_CHANGED",
      snapshot: { visibility: "hidden", phase: "frozen" },
    });

    expect(actor.snapshot()).toMatchObject({
      heavyWorkPolicy: "suspended",
    });
  });

  it("更新已就绪后会进入 waiting_refresh，直到 controller ready 才回到 idle", () => {
    const actor = 创建应用生命周期Actor();

    actor.send({ type: "SERVICE_WORKER_UPDATE_READY", scope: "app" });
    expect(actor.snapshot().updateState).toBe("waiting_refresh");

    actor.send({ type: "SERVICE_WORKER_CONTROLLER_READY" });
    expect(actor.snapshot().updateState).toBe("idle");
  });
});
