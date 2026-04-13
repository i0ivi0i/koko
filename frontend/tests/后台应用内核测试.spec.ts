import { describe, expect, it } from "vitest";
import { 创建后台应用内核 } from "../后台应用内核";
import { 创建后台查询编排 } from "../后台查询编排";
import type {
  匿名身份引导结果,
  增量事件快照,
  后台房间列表,
  后台房间详情,
  后台概览,
  后台登录结果,
  媒体附件上传结果,
  媒体定位结果,
  媒体上传准备结果,
  房间历史页,
  房间快照,
} from "../契约";
import type { 前端传输端口 } from "../传输";
import type { Socket } from "socket.io-client";

class 假后台内核传输 implements 前端传输端口 {
  readonly 调用记录: string[] = [];

  async bootstrapAnonymousIdentity(): Promise<匿名身份引导结果> {
    throw new Error("unused");
  }

  async joinOrCreateRoom(): Promise<房间快照> {
    throw new Error("unused");
  }

  async loadRoomSnapshot(): Promise<房间快照> {
    throw new Error("unused");
  }

  async prepareMediaUpload(): Promise<媒体上传准备结果> {
    throw new Error("unused");
  }

  async completeMediaUpload(): Promise<媒体附件上传结果> {
    throw new Error("unused");
  }

  async loadMediaLocator(): Promise<媒体定位结果> {
    throw new Error("unused");
  }

  buildAttachmentContentUrl(): string {
    throw new Error("unused");
  }

  async updateRoomReadAnchor(): Promise<void> {
    throw new Error("unused");
  }

  async loadRoomEvents(): Promise<增量事件快照> {
    throw new Error("unused");
  }

  async loadRoomHistory(): Promise<房间历史页> {
    throw new Error("unused");
  }

  async loadAdminOverview(token: string): Promise<后台概览> {
    this.调用记录.push(`overview:${token}`);
    return { room_count: 2, message_count: 9 };
  }

  async adminLogin(username: string, password: string): Promise<后台登录结果> {
    this.调用记录.push(`login:${username}:${password}`);
    return { token: "admin-token" };
  }

  async adminRooms(token: string): Promise<后台房间列表> {
    this.调用记录.push(`rooms:${token}`);
    return { rooms: ["room-A", "room-B", "ops-C"] };
  }

  async adminRoomDetail(token: string, roomId: string): Promise<后台房间详情> {
    this.调用记录.push(`detail:${token}:${roomId}`);
    return { room_id: roomId, latest_event_position: 12, message_count: 34 };
  }

  createSocket(): Socket {
    throw new Error("unused");
  }
}

describe("后台应用内核", () => {
  it("登录命令会刷新 token、概览和房间列表快照", async () => {
    const transport = new 假后台内核传输();
    const kernel = 创建后台应用内核({ transport });

    await kernel.dispatch({ type: "USERNAME_CHANGED", value: "ops-admin" });
    await kernel.dispatch({ type: "PASSWORD_CHANGED", value: "super-secret" });
    await kernel.dispatch({ type: "LOGIN_REQUESTED" });

    expect(kernel.snapshot()).toMatchObject({
      token: "admin-token",
      overview: { room_count: 2, message_count: 9 },
      roomIds: ["room-A", "room-B", "ops-C"],
      roomFilter: "",
      selectedRoomId: "",
      detail: null,
    });
    expect(kernel.snapshot()).not.toHaveProperty("overviewText");
    expect(kernel.snapshot()).not.toHaveProperty("detailText");
    expect(transport.调用记录).toEqual([
      "login:ops-admin:super-secret",
      "overview:admin-token",
      "rooms:admin-token",
    ]);
  });

  it("筛选和详情命令都只通过快照暴露给壳层", async () => {
    const transport = new 假后台内核传输();
    const kernel = 创建后台应用内核({ transport });

    await kernel.dispatch({ type: "LOGIN_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_FILTER_CHANGED", value: "ops" });
    await kernel.dispatch({ type: "ROOM_DETAIL_REQUESTED", roomId: "ops-C" });

    expect(kernel.snapshot()).toMatchObject({
      roomFilter: "ops",
      roomIds: ["ops-C"],
      selectedRoomId: "ops-C",
      detail: {
        room_id: "ops-C",
        latest_event_position: 12,
        message_count: 34,
      },
    });
    expect(transport.调用记录).toContain("detail:admin-token:ops-C");
  });

  it("后台查询编排快照不再承载壳层筛选词和选中项", () => {
    const 查询编排 = 创建后台查询编排({
      overview: { room_count: 2, message_count: 9 },
      roomIds: ["room-A", "ops-C"],
      detail: {
        room_id: "ops-C",
        latest_event_position: 12,
        message_count: 34,
      },
    });

    expect(查询编排.snapshot()).toEqual({
      overview: { room_count: 2, message_count: 9 },
      roomIds: ["room-A", "ops-C"],
      detail: {
        room_id: "ops-C",
        latest_event_position: 12,
        message_count: 34,
      },
    });
  });
});
