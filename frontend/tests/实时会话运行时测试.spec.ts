// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

describe("实时会话运行时", () => {
  it("平台 lifecycle hidden/background 后 realtime 会进入 reduced，而不是继续当 active", async () => {
    const { 创建实时会话Actor } = await import("../实时会话运行时");

    const actor = 创建实时会话Actor();

    actor.send({
      type: "CONNECT_REQUESTED",
      roomId: "r-test",
      sessionId: "s-test",
      latestEventPosition: 8,
    });
    actor.send({
      type: "SUBSCRIPTION_ESTABLISHED",
      latestEventPosition: 8,
    });
    actor.send({
      type: "LIFECYCLE_POLICY_CHANGED",
      heavyWorkPolicy: "reduced",
    });

    expect(actor.getSnapshot().context).toMatchObject({
      connectionState: "reduced",
      heavyWorkPolicy: "reduced",
      roomId: "r-test",
      sessionId: "s-test",
    });
  });

  it("offline -> online 会进入 reconnecting，并标记需要统一重建订阅", async () => {
    const { 创建实时会话Actor } = await import("../实时会话运行时");

    const actor = 创建实时会话Actor();

    actor.send({
      type: "CONNECT_REQUESTED",
      roomId: "r-test",
      sessionId: "s-test",
      latestEventPosition: 8,
    });
    actor.send({
      type: "SUBSCRIPTION_ESTABLISHED",
      latestEventPosition: 8,
    });
    actor.send({
      type: "OFFLINE_STATUS_CHANGED",
      online: false,
    });
    actor.send({
      type: "OFFLINE_STATUS_CHANGED",
      online: true,
    });

    expect(actor.getSnapshot().context).toMatchObject({
      connectionState: "reconnecting",
      online: true,
      needsResubscribe: true,
    });
  });

  it("controller ready 之前挂起的后台排空请求只会保留一份 pending", async () => {
    const { 创建实时会话Actor } = await import("../实时会话运行时");

    const actor = 创建实时会话Actor();

    actor.send({ type: "BACKGROUND_DRAIN_REQUESTED" });
    actor.send({ type: "BACKGROUND_DRAIN_REQUESTED" });

    expect(actor.getSnapshot().context.backgroundDrainPending).toBe(true);

    actor.send({ type: "BACKGROUND_DRAIN_FINISHED" });

    expect(actor.getSnapshot().context.backgroundDrainPending).toBe(false);
  });

  it("socket 断开不会直接改聊天快照，而是先把 realtime 会话推进到 reconnecting", async () => {
    const { 创建实时会话Actor } = await import("../实时会话运行时");

    const actor = 创建实时会话Actor();

    actor.send({
      type: "CONNECT_REQUESTED",
      roomId: "r-test",
      sessionId: "s-test",
      latestEventPosition: 8,
    });
    actor.send({
      type: "SUBSCRIPTION_ESTABLISHED",
      latestEventPosition: 8,
    });
    actor.send({
      type: "SOCKET_DISCONNECTED",
      code: "transport_lost",
    });

    expect(actor.getSnapshot().context).toMatchObject({
      connectionState: "reconnecting",
      lastDisconnectCode: "transport_lost",
      needsResubscribe: true,
    });
  });
});
