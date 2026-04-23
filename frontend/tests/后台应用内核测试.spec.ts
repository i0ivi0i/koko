import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { 创建后台应用内核 } from "../后台应用内核";
import { 创建后台查询编排 } from "../后台查询编排";
import type {
  后台房间列表,
  后台房间详情,
  后台概览,
  后台登录结果,
} from "../契约";
import type {
  后台会话传输端口,
  后台查询传输端口,
} from "../传输";

class 假后台内核传输 implements 后台查询传输端口, 后台会话传输端口 {
  readonly 调用记录: string[] = [];

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
}

describe("后台应用内核", () => {
  it("后台查询和会话编排分别只依赖各自后台窄接口", () => {
    const querySource = readFileSync(resolve(process.cwd(), "后台查询编排.ts"), "utf8");
    const sessionSource = readFileSync(resolve(process.cwd(), "后台会话编排.ts"), "utf8");
    const kernelSource = readFileSync(resolve(process.cwd(), "后台应用内核.ts"), "utf8");

    expect(querySource).toContain('import type { 后台查询传输端口 } from "./传输.js";');
    expect(querySource).not.toContain("type 前端传输端口");
    expect(sessionSource).toContain('import type { 后台会话传输端口 } from "./传输.js";');
    expect(sessionSource).not.toContain("type 前端传输端口");
    expect(kernelSource).toContain("后台查询传输?: 后台查询传输端口;");
    expect(kernelSource).toContain("后台会话传输?: 后台会话传输端口;");
    expect(kernelSource).not.toContain("transport?: 前端传输端口;");
    expect(kernelSource).not.toContain("this.platform.transport.transport()");
    expect(kernelSource).not.toContain("setTransportForTest(transport: 前端传输端口)");
  });

  it("登录命令会刷新 token、概览和房间列表快照", async () => {
    const transport = new 假后台内核传输();
    const kernel = 创建后台应用内核({
      后台查询传输: transport,
      后台会话传输: transport,
    });

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
    const kernel = 创建后台应用内核({
      后台查询传输: transport,
      后台会话传输: transport,
    });

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
