// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach,describe,expect,it,vi } from "vitest";
import { 聊天壳 } from "../总装/聊天壳";
import {
createFakeStorage,
假传输,
创建传输错误,
创建房间快照,
等待组件稳定,
读取操作台主动作,
读取操作台主输入,
输入房间短码到操作台
} from "./common/聊天测试支架";

describe("聊天壳集成 / 恢复失败与会话刷新", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("聊天壳恢复入口仍只通过内核 dispatch，不自己触发 bootstrap 或 snapshot 恢复", () => {
    const source = readFileSync(resolve(process.cwd(), "总装/聊天壳.ts"), "utf8");

    expect(source).toContain('this.kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" })');
    expect(source).not.toContain("bootstrapAnonymousIdentity(");
    expect(source).not.toContain("loadRoomSnapshot(");
    expect(source).not.toContain("joinOrCreateRoom(");
  });
  it("room_not_found 会清掉 current_room_id、删除对应历史并回到首页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-missing");
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([{ roomId: "r-missing", roomCode: "ROOM01", lastEnteredAt: 100 }])
    );
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(404, "room_not_found")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBeNull();
    expect(window.localStorage.getItem("koko_home_sessions")).toBe("[]");
    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("恢复失败");
    el.remove();
  });
  it("room_not_found 回首页后仍保留上一间房短码，允许直接重新进房", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-missing");
    window.localStorage.setItem("koko_current_room_code", "ROOM01");
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([{ roomId: "r-missing", roomCode: "ROOM01", lastEnteredAt: 100 }])
    );
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(404, "room_not_found")];
    transport.joinQueue = [创建房间快照("r-recreated")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(读取操作台主输入(el).value).toBe("ROOM01");
    expect(读取操作台主动作(el).disabled).toBe(false);
    expect(el.shadowRoot!.textContent).not.toContain("恢复失败");

    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    el.remove();
  });
  it("membership_required 会清掉 current_room_id、但保留历史并回到首页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-blocked");
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([{ roomId: "r-blocked", roomCode: "ROOM02", lastEnteredAt: 100 }])
    );
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(403, "membership_required")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBeNull();
    expect(window.localStorage.getItem("koko_home_sessions")).toContain("ROOM02");
    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("恢复失败");
    el.remove();
  });
  it("1234b 这类重房间的本地恢复快照写入失败时，仍应进入房间而不是显示恢复失败", async () => {
    const storage = createFakeStorage();
    const rawSetItem = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string): void => {
      if (key === "koko_current_room_snapshot") {
        throw new DOMException("localStorage quota exceeded", "QuotaExceededError");
      }
      rawSetItem(key, value);
    };
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
    });
    const transport = new 假传输();
    transport.joinQueue = [创建房间快照("r-1234b", 7)];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "1234b");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "1234b" }]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain("1234b");
    expect(el.shadowRoot!.textContent).not.toContain("恢复失败");
    el.remove();
  });
  it("invalid_session 会重新 bootstrap 再决定恢复分支", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.bootstrapQueue = [
      {
        display_alias: "暴躁的企鹅",
        session_id: "s-stale",
      },
      {
        display_alias: "冷静的水獭",
        session_id: "s-refresh",
      },
    ];
    transport.snapshotQueue = [
      创建传输错误(401, "invalid_session"),
      创建房间快照("r-restore", 2),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.bootstrapTokens).toHaveLength(2);
    expect(transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-stale" },
      { roomId: "r-restore", sessionId: "s-refresh" },
    ]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    el.remove();
  });
  it("connect_error invalid_session 会重新 bootstrap 并重拉当前房间", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.bootstrapQueue = [
      {
        display_alias: "暴躁的企鹅",
        session_id: "s-stale",
      },
      {
        display_alias: "冷静的水獭",
        session_id: "s-refresh",
      },
    ];
    transport.snapshotQueue = [
      创建房间快照("r-restore", 1),
      创建房间快照("r-restore", 2),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    transport.socket.trigger("connect_error", 创建传输错误(401, "invalid_session"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.bootstrapTokens).toHaveLength(2);
    expect(transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-stale" },
      { roomId: "r-restore", sessionId: "s-refresh" },
    ]);
    expect(transport.socketSessionIds).toEqual(["s-stale", "s-refresh"]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    el.remove();
  });
  it("connect_error invalid_session 会重新 bootstrap 并通过恢复链刷新当前房间", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.bootstrapQueue = [
      {
        display_alias: "暴躁的企鹅",
        session_id: "s-stale",
      },
      {
        display_alias: "冷静的水獭",
        session_id: "s-refresh",
      },
    ];
    transport.snapshotQueue = [
      创建房间快照("r-restore", 1),
      创建房间快照("r-restore", 2),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    transport.socket.trigger("connect_error", 创建传输错误(401, "invalid_session"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.bootstrapTokens).toHaveLength(2);
    expect(transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-stale" },
      { roomId: "r-restore", sessionId: "s-refresh" },
    ]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    el.remove();
  });
  it("恢复超时或5xx不会清掉 current_room_id", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-retry");
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(503, "system_error", "backend busy")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBe("r-retry");
    expect(el.shadowRoot!.textContent).toContain("恢复失败");
    el.remove();
  });
});

