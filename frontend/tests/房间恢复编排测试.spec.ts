// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  创建传输错误,
  创建房间快照,
  创建恢复编排测试场景,
  读取房间恢复编排工厂,
} from "./common/聊天测试支架";
describe("房间恢复编排", () => {
  it("根文件退成恢复壳层门面，真实实现收进恢复 owner", () => {
    const facadeSource = readFileSync(resolve(process.cwd(), "房间恢复编排.ts"), "utf8");
    const ownerSource = readFileSync(
      resolve(process.cwd(), "恢复/壳层/房间恢复编排.ts"),
      "utf8"
    );

    expect(facadeSource).toContain('export * from "./恢复/壳层/房间恢复编排.js"');
    expect(facadeSource).not.toContain("export function 创建房间恢复编排(");
    expect(ownerSource).toContain("export function 创建房间恢复编排(");
    expect(ownerSource).toContain('from "../应用.js"');
  });

  it("旧房间快照恢复壳层文件必须退成恢复应用门面", () => {
    const source = readFileSync(
      resolve(process.cwd(), "聊天恢复/壳层/房间快照恢复.ts"),
      "utf8"
    );

    expect(source).toContain('from "../../恢复/应用.js"');
    expect(source).toContain("创建恢复应用 as 创建房间快照恢复协作");
    expect(source).not.toContain("function 同步首页房间历史()");
    expect(source).not.toContain("function 进入房间快照(");
  });

  it("会把 invalid_session 恢复委托给 会话失效恢复 协作", () => {
    const source = readFileSync(resolve(process.cwd(), "恢复/壳层/房间恢复编排.ts"), "utf8");

    expect(source).toContain('from "../../聊天恢复/壳层/会话失效恢复.js"');
    expect(source).toContain("创建会话失效恢复协作(");
    expect(source).not.toContain("async function bootstrapFreshSession");
    expect(source).not.toContain("async function handleInvalidSessionTransport异常");
  });

  it("房间恢复编排和阅读推进只依赖聊天房间窄接口，而不再声明完整前端传输端口", () => {
    const recoverySource = readFileSync(
      resolve(process.cwd(), "恢复/壳层/房间恢复编排.ts"),
      "utf8"
    );
    const readSource = readFileSync(resolve(process.cwd(), "房间/壳层/阅读推进.ts"), "utf8");

    expect(recoverySource).toContain('from "../../聊天共享/适配/聊天房间传输端口.js"');
    expect(recoverySource).not.toContain("type 前端传输端口");
    expect(readSource).toContain('from "../../聊天共享/适配/聊天房间传输端口.js"');
    expect(readSource).not.toContain("type 前端传输端口");
  });

  it("会把 snapshot reload 与房间硬失败委托给 房间快照恢复 协作", () => {
    const source = readFileSync(resolve(process.cwd(), "恢复/壳层/房间恢复编排.ts"), "utf8");

    expect(source).toContain('from "../应用.js"');
    expect(source).toContain("创建恢复应用(");
    expect(source).not.toContain("async function reloadRoomFromSnapshot");
    expect(source).not.toContain("function resolveFallbackRoomCode");
  });

  it("收到 invalid_session transport 异常时会刷新会话并重拉当前房间", async () => {
    const 创建房间恢复编排 = await 读取房间恢复编排工厂();
    const 场景 = 创建恢复编排测试场景({
      roomId: "r-restore",
      roomCode: "ROOM01",
      sessionId: "s-stale",
    });
    场景.transport.bootstrapQueue = [
      {
        display_alias: "冷静的水獭",
        session_id: "s-refresh",
      },
    ];
    场景.transport.snapshotQueue = [创建房间快照("r-restore", 2)];
    场景.transport.eventsQueue = [
      {
        room_id: "r-restore",
        latest_event_position: 2,
        events: [],
      },
    ];

    const 编排 = 创建房间恢复编排(场景.deps) as {
      接收Transport异常(error: { kind: "invalid_session"; roomId?: string }): Promise<void>;
    };
    await 编排.接收Transport异常({ kind: "invalid_session" });

    expect(场景.transport.bootstrapTokens).toHaveLength(1);
    expect(场景.transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-refresh" },
    ]);
    expect(场景.transport.loadRoomEventsArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-refresh", from: 2 },
    ]);
    expect(场景.ensureRealtimeSocketCalls).toEqual(["s-refresh", "s-refresh"]);
    expect(场景.subscribeCalls).toEqual([2]);
    expect(场景.读取状态().sessionId).toBe("s-refresh");
    expect(场景.roomScroller.安排首屏定位).toHaveBeenCalledTimes(1);
  });

  it("收到 need_snapshot_reload transport 异常时会按 roomId 重拉快照", async () => {
    const 创建房间恢复编排 = await 读取房间恢复编排工厂();
    const 场景 = 创建恢复编排测试场景({
      roomId: "r-test",
      roomCode: "ROOM01",
      sessionId: "s-test",
    });
    场景.transport.snapshotQueue = [创建房间快照("r-test", 1)];
    场景.transport.eventsQueue = [
      {
        room_id: "r-test",
        latest_event_position: 1,
        events: [],
      },
    ];

    const 编排 = 创建房间恢复编排(场景.deps) as {
      接收Transport异常(error: { kind: "need_snapshot_reload"; roomId: string }): Promise<void>;
    };
    await 编排.接收Transport异常({
      kind: "need_snapshot_reload",
      roomId: "r-test",
    });

    expect(场景.transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-test", sessionId: "s-test" },
    ]);
    expect(场景.transport.loadRoomEventsArgs).toEqual([
      { roomId: "r-test", sessionId: "s-test", from: 1 },
    ]);
    expect(场景.subscribeCalls).toEqual([1]);
    expect(场景.roomScroller.安排首屏定位).toHaveBeenCalledTimes(1);
  });

  it("room_not_found 会删历史并退出房间", async () => {
    const 创建房间恢复编排 = await 读取房间恢复编排工厂();
    const 场景 = 创建恢复编排测试场景({
      roomId: "r-missing",
      roomCode: "ROOM01",
      homeSessionItems: [{ roomId: "r-missing", roomCode: "ROOM01", lastEnteredAt: 1 }],
    });
    场景.transport.snapshotQueue = [创建传输错误(404, "room_not_found")];

    const 编排 = 创建房间恢复编排(场景.deps) as {
      restoreCurrentRoomIfNeeded(): Promise<void>;
    };
    await 编排.restoreCurrentRoomIfNeeded();

    expect(场景.storage.读取当前房间标识()).toBe("");
    expect(场景.storage.读取首页房间历史()).toEqual([]);
    expect(场景.读取状态().roomId).toBe("");
  });

  it("membership_required 会保留历史但退出房间", async () => {
    const 创建房间恢复编排 = await 读取房间恢复编排工厂();
    const 场景 = 创建恢复编排测试场景({
      roomId: "r-private",
      roomCode: "ROOM02",
      homeSessionItems: [{ roomId: "r-private", roomCode: "ROOM02", lastEnteredAt: 2 }],
    });
    场景.transport.snapshotQueue = [创建传输错误(403, "membership_required")];

    const 编排 = 创建房间恢复编排(场景.deps) as {
      restoreCurrentRoomIfNeeded(): Promise<void>;
    };
    await 编排.restoreCurrentRoomIfNeeded();

    expect(场景.storage.读取当前房间标识()).toBe("");
    expect(场景.storage.读取首页房间历史()).toEqual([
      { roomId: "r-private", roomCode: "ROOM02", lastEnteredAt: 2 },
    ]);
    expect(场景.读取状态().roomId).toBe("");
  });

  it("本地恢复快照写入失败时，不能阻断已经成功拿到的房间快照", async () => {
    const 创建房间恢复编排 = await 读取房间恢复编排工厂();
    const 场景 = 创建恢复编排测试场景();
    const rawSetItem = 场景.rawStorage.setItem.bind(场景.rawStorage);
    rawSetItem(
      "koko_current_room_snapshot",
      JSON.stringify({ roomCode: "1234b", snapshot: 创建房间快照("r-old-1234b", 1) })
    );
    场景.rawStorage.setItem = (key: string, value: string): void => {
      if (key === "koko_current_room_snapshot") {
        throw new DOMException("localStorage quota exceeded", "QuotaExceededError");
      }
      rawSetItem(key, value);
    };
    场景.deps.写入恢复状态({ roomCodeInput: "1234b" });
    场景.transport.joinQueue = [创建房间快照("r-1234b", 7)];

    const 编排 = 创建房间恢复编排(场景.deps) as {
      joinRoom(): Promise<void>;
    };
    await 编排.joinRoom();

    expect(场景.transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "1234b" }]);
    expect(场景.读取状态().roomId).toBe("r-1234b");
    expect(场景.读取状态().roomDisplayTitle).toBe("1234b");
    expect(场景.读取状态().latestEventPosition).toBe(7);
    expect(场景.rawStorage.getItem("koko_current_room_snapshot")).toBeNull();
  });

  it("bootstrap 失败但本地还留着身份和当前房间快照时，会离线恢复当前房间而不是直接掉回失败页", async () => {
    const 创建房间恢复编排 = await 读取房间恢复编排工厂();
    const 场景 = 创建恢复编排测试场景({
      roomId: "r-offline",
      roomCode: "ROOM88",
      sessionId: "s-stale",
      displayAlias: "旧身份",
      skipInitialBootstrap: true,
    });
    场景.rawStorage.setItem(
      "koko_bootstrap_identity",
      JSON.stringify({
        sessionId: "s-cached",
        displayAlias: "离线海豚",
      })
    );
    场景.rawStorage.setItem(
      "koko_current_room_snapshot",
      JSON.stringify({
        roomCode: "ROOM88",
        snapshot: 创建房间快照("r-offline", 7, {
          snapshot_messages: [
            {
              type: "message_created",
              room_id: "r-offline",
              message_id: "m-offline-1",
              client_message_id: "c-offline-1",
              sender_session_id: "s-peer",
              sender_display_alias: "缓存同伴",
              text: "cached video",
              attachments: [
                {
                  kind: "video",
                  attachment_id: "att-video-offline-1",
                  width: 1280,
                  height: 720,
                },
              ],
              event_position: 7,
            },
          ],
        }),
      })
    );
    场景.transport.bootstrapQueue = [创建传输错误(0, "offline_unreachable")];
    场景.transport.snapshotQueue = [创建传输错误(0, "offline_unreachable")];

    const 编排 = 创建房间恢复编排(场景.deps) as {
      bootstrap(): Promise<void>;
    };
    await 编排.bootstrap();

    expect(场景.读取状态().sessionId).toBe("s-cached");
    expect(场景.读取状态().displayAlias).toBe("离线海豚");
    expect(场景.读取状态().roomId).toBe("r-offline");
    expect(场景.读取状态().messages).toHaveLength(1);
    expect(场景.读取状态().messages[0]?.attachments?.[0]?.attachment_id).toBe(
      "att-video-offline-1"
    );
  });
});


