/**
 * 验证 subscribeRoom 在切换房间时：
 * 1. 首次 subscribe 不发 unsubscribe；
 * 2. 切换房间时先 emit unsubscribe_room_stream 旧房间，再 emit subscribe_room_stream 新房间。
 *
 * 守护 P0 房间订阅泄漏修复的前端侧契约。
 */
import { describe, it, expect } from "vitest";
import {
  创建实时编排测试场景,
  读取房间实时编排工厂,
} from "./common/实时编排支架.js";

describe("subscribeRoom 取消旧房间订阅", () => {
  it("首次 subscribe 不发 unsubscribe", async () => {
    const 工厂 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "room-A",
      sessionId: "s-1",
      latestEventPosition: 0,
    });
    const 编排 = 工厂(场景.deps) as {
      subscribeRoom(from: number): void;
      ensureRealtimeSocket(sessionId: string): void | Promise<void>;
    };
    await 编排.ensureRealtimeSocket("s-1");
    编排.subscribeRoom(0);

    const sent = 场景.transport.socket.sentEvents;
    const unsubEvents = sent.filter(
      (e) => e.event === "unsubscribe_room_stream"
    );
    expect(unsubEvents).toHaveLength(0);
  });

  it("切换房间时先 emit unsubscribe 旧房间再 subscribe 新房间", async () => {
    const 工厂 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "room-A",
      sessionId: "s-1",
      latestEventPosition: 5,
    });
    const 编排 = 工厂(场景.deps) as {
      subscribeRoom(from: number): void;
      ensureRealtimeSocket(sessionId: string): void | Promise<void>;
    };
    await 编排.ensureRealtimeSocket("s-1");

    // 第一次订阅 room-A
    编排.subscribeRoom(5);

    // 切换到 room-B
    场景.deps.写入实时状态({ roomId: "room-B" } as never);
    编排.subscribeRoom(0);

    const sent = 场景.transport.socket.sentEvents;
    const unsubEvents = sent.filter(
      (e) => e.event === "unsubscribe_room_stream"
    );
    expect(unsubEvents).toHaveLength(1);
    expect(unsubEvents[0]!.payload.room_id).toBe("room-A");

    // 验证 unsubscribe 在第二次 subscribe 之前
    const unsubIdx = sent.findIndex(
      (e) => e.event === "unsubscribe_room_stream"
    );
    const secondSubIdx = sent.findIndex(
      (e, i) =>
        i > 0 &&
        e.event === "subscribe_room_stream" &&
        e.payload.room_id === "room-B"
    );
    expect(unsubIdx).toBeLessThan(secondSubIdx);
  });

  it("同房间重复 subscribe 不发 unsubscribe", async () => {
    const 工厂 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "room-A",
      sessionId: "s-1",
      latestEventPosition: 5,
    });
    const 编排 = 工厂(场景.deps) as {
      subscribeRoom(from: number): void;
      ensureRealtimeSocket(sessionId: string): void | Promise<void>;
    };
    await 编排.ensureRealtimeSocket("s-1");

    编排.subscribeRoom(5);
    // 同房间再次订阅（断线重连等场景）
    编排.subscribeRoom(5);

    const sent = 场景.transport.socket.sentEvents;
    const unsubEvents = sent.filter(
      (e) => e.event === "unsubscribe_room_stream"
    );
    expect(unsubEvents).toHaveLength(0);
  });

  it("disconnect 清空追踪，再次 subscribe 不发残留 unsubscribe", async () => {
    const 工厂 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "room-A",
      sessionId: "s-1",
      latestEventPosition: 5,
    });
    const 编排 = 工厂(场景.deps) as {
      subscribeRoom(from: number): void;
      ensureRealtimeSocket(sessionId: string): void | Promise<void>;
      disconnect(): void;
    };
    await 编排.ensureRealtimeSocket("s-1");
    编排.subscribeRoom(5);

    // disconnect 清空
    编排.disconnect();

    // 重连后 subscribe room-B
    await 编排.ensureRealtimeSocket("s-1");
    场景.deps.写入实时状态({ roomId: "room-B" } as never);
    编排.subscribeRoom(0);

    const sent = 场景.transport.socket.sentEvents;
    const unsubEvents = sent.filter(
      (e) => e.event === "unsubscribe_room_stream"
    );
    // disconnect 后 上次订阅房间Id 已清空，不应发 unsubscribe
    expect(unsubEvents).toHaveLength(0);
  });
});
