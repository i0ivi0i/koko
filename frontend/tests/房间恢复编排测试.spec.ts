// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  创建传输错误,
  创建房间快照,
  创建恢复编排测试场景,
  读取房间恢复编排工厂,
} from "./common/聊天测试支架";
describe("房间恢复编排", () => {
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
              body: "cached video",
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


