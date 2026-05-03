// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../平台/存储";
import type { 匿名身份引导结果 } from "../../聊天共享/契约";
import { 聊天壳 } from "../../应用根/聊天壳";
import {
  createFakeStorage,
  假传输,
  等待组件稳定,
  输入房间短码到操作台,
  读取操作台主动作,
  读取操作台主输入,
} from "../common/聊天测试支架";
import { 注册聊天壳集成测试基线 } from "./测试支撑";

describe("聊天壳集成 / 房间恢复与首页历史", () => {
  注册聊天壳集成测试基线();

  it("启动恢复房间时在 bootstrap 完成前不会先闪出空态首页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    vi.spyOn(transport, "bootstrapAnonymousIdentity").mockImplementation(
      () => new Promise<匿名身份引导结果>(() => {})
    );
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("#bootView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#homeView")).toBeNull();
    el.remove();
  });

  it("没有当前房间恢复锚点时会默认进入空态首页占位并保留最小进房控制台", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")).toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsole")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsoleForm")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsolePrimaryInput")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsolePrimaryAction")).not.toBeNull();
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>("#shellConsolePrimaryAction")?.textContent?.trim()).toBe(
      "进房"
    );
    el.remove();
  });

  it("浏览器存储会按 roomCode 去重、按 lastEnteredAt 倒序读取首页房间历史", () => {
    const rawStorage = createFakeStorage();
    const browserStorage = 创建浏览器存储(rawStorage) as unknown as {
      读取首页房间历史(): Array<{
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }>;
      写入或更新首页房间历史条目(entry: {
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }): void;
    };

    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-old",
      roomCode: "ROOM01",
      lastEnteredAt: 100,
    });
    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-2",
      roomCode: "ROOM02",
      lastEnteredAt: 200,
    });
    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-new",
      roomCode: "ROOM01",
      lastEnteredAt: 300,
    });

    expect(browserStorage.读取首页房间历史()).toEqual([
      { roomId: "r-new", roomCode: "ROOM01", lastEnteredAt: 300 },
      { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
    ]);
  });

  it("浏览器存储支持按房间标识删除首页房间历史条目", () => {
    const rawStorage = createFakeStorage();
    const browserStorage = 创建浏览器存储(rawStorage) as unknown as {
      读取首页房间历史(): Array<{
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }>;
      写入或更新首页房间历史条目(entry: {
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }): void;
      按房间标识删除首页房间历史条目(roomId: string): void;
    };

    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-1",
      roomCode: "ROOM01",
      lastEnteredAt: 100,
    });
    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-2",
      roomCode: "ROOM02",
      lastEnteredAt: 200,
    });

    browserStorage.按房间标识删除首页房间历史条目("r-1");

    expect(browserStorage.读取首页房间历史()).toEqual([
      { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
    ]);
  });

  it("浏览器存储在 JSON 损坏时会安全回退为空列表", () => {
    const rawStorage = createFakeStorage();
    rawStorage.setItem("koko_home_sessions", "{broken-json");

    const browserStorage = 创建浏览器存储(rawStorage) as unknown as {
      读取首页房间历史(): Array<{
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }>;
    };

    expect(browserStorage.读取首页房间历史()).toEqual([]);
  });

  it("浏览器存储读取旧脏首页历史时，会把同 roomCode 的重复项自动合并并回写", () => {
    const rawStorage = createFakeStorage();
    rawStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([
        { roomId: "r-old", roomCode: "ROOM01", lastEnteredAt: 100 },
        { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
        { roomId: "r-new", roomCode: "ROOM01", lastEnteredAt: 300 },
      ])
    );

    const browserStorage = 创建浏览器存储(rawStorage) as unknown as {
      读取首页房间历史(): Array<{
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }>;
    };

    const normalized = [
      { roomId: "r-new", roomCode: "ROOM01", lastEnteredAt: 300 },
      { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
    ];

    expect(browserStorage.读取首页房间历史()).toEqual(normalized);
    expect(JSON.parse(rawStorage.getItem("koko_home_sessions") ?? "null")).toEqual(normalized);
  });

  it("有当前房间恢复锚点时会优先恢复房间而不是退回首页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.loadRoomSnapshotArgs).toEqual([{ roomId: "r-restore", sessionId: "s-test" }]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#homeView")).toBeNull();
    expect(el.shadowRoot!.querySelector("#joinView")).toBeNull();
    el.remove();
  });

  it("启动时会把本地恢复的历史房间列表渲染到首页", async () => {
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([
        { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
        { roomId: "r-1", roomCode: "ROOM01", lastEnteredAt: 300 },
      ])
    );
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const list = el.shadowRoot!.querySelector("#homeRoomList");
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain("ROOM01");
    expect(list?.textContent).toContain("ROOM02");
    expect(list?.querySelectorAll("[data-room-id]").length).toBe(2);
    expect(list?.querySelectorAll("[data-room-id]")[0]?.textContent).toContain("ROOM01");
    el.remove();
  });

  it("启动时若本地历史里有重复 roomCode，也只会渲染最新那一条首页会话", async () => {
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([
        { roomId: "r-old", roomCode: "ROOM01", lastEnteredAt: 100 },
        { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
        { roomId: "r-new", roomCode: "ROOM01", lastEnteredAt: 300 },
      ])
    );
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const list = el.shadowRoot!.querySelector("#homeRoomList");
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll("[data-room-id]").length).toBe(2);
    expect(list?.querySelector('[data-room-id="r-new"]')?.textContent).toContain("ROOM01");
    expect(list?.querySelector('[data-room-id="r-old"]')).toBeNull();
    expect(
      Array.from(list?.querySelectorAll("[data-room-id]") ?? []).filter((item) =>
        item.textContent?.includes("ROOM01")
      )
    ).toHaveLength(1);
    el.remove();
  });

  it("点击首页历史房间会直接进房并沿用既有进房主链", async () => {
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([{ roomId: "r-1", roomCode: "ROOM01", lastEnteredAt: 300 }])
    );
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const historyEntry = el.shadowRoot!.querySelector('[data-room-id="r-1"]') as HTMLElement | null;
    expect(historyEntry).not.toBeNull();

    historyEntry!.click();
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    el.remove();
  });

  it("底部控制台在首页和房间内都存在同一锚点容器", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const homeConsole = el.shadowRoot!.querySelector("#shellConsole");
    expect(homeConsole).not.toBeNull();

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    const roomConsole = el.shadowRoot!.querySelector("#shellConsole");
    expect(roomConsole).not.toBeNull();
    expect(homeConsole?.id).toBe(roomConsole?.id);
    el.remove();
  });

  it("从房间返回首页后控制台会切回进房语义", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    (el.shadowRoot!.querySelector("#backBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsole")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsolePrimaryInput")).not.toBeNull();
    expect(读取操作台主输入(el).getAttribute("placeholder")).toBe("房间短码");
    expect(读取操作台主动作(el).textContent).toContain("进房");
    el.remove();
  });
});
