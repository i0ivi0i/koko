// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("实时会话运行时", () => {
  it("实时会话 owner 直连生效，旧根门面已经删除", () => {
    const ownerSource = 读取前端源码("实时/会话运行时.ts");
    const kernelSource = 读取前端源码("聊天应用内核.ts");
    const realtimeSource = 读取前端源码("实时/应用.ts");
    const controlSource = 读取前端源码("聊天实时/壳层/实时控制面协作.ts");

    expect(existsSync(resolve(process.cwd(), "实时会话运行时.ts"))).toBe(false);
    expect(ownerSource).toContain("const 实时会话机 = createMachine(");
    expect(ownerSource).toContain("export function 创建实时会话Actor()");
    expect(kernelSource).toContain('from "./实时/会话运行时.js"');
    expect(kernelSource).not.toContain('from "./实时会话运行时.js"');
    expect(realtimeSource).toContain('from "./会话运行时.js"');
    expect(realtimeSource).not.toContain('from "../实时会话运行时.js"');
    expect(controlSource).toContain('from "../../实时/会话运行时.js"');
    expect(controlSource).not.toContain('from "../../实时会话运行时.js"');
  });

  it("平台 lifecycle hidden/background 后 realtime 会进入 reduced，而不是继续当 active", async () => {
    const { 创建实时会话Actor } = await import("../实时/会话运行时");

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
    const { 创建实时会话Actor } = await import("../实时/会话运行时");

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
    const { 创建实时会话Actor } = await import("../实时/会话运行时");

    const actor = 创建实时会话Actor();

    actor.send({ type: "BACKGROUND_DRAIN_REQUESTED" });
    actor.send({ type: "BACKGROUND_DRAIN_REQUESTED" });

    expect(actor.getSnapshot().context.backgroundDrainPending).toBe(true);

    actor.send({ type: "BACKGROUND_DRAIN_FINISHED" });

    expect(actor.getSnapshot().context.backgroundDrainPending).toBe(false);
  });

  it("socket 断开不会直接改聊天快照，而是先把 realtime 会话推进到 reconnecting", async () => {
    const { 创建实时会话Actor } = await import("../实时/会话运行时");

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
