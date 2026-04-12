// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createFakeStorage } from "./common/聊天测试支架";
import { 创建存储运行时 } from "../平台/存储运行时";

describe("存储运行时", () => {
  it("会统一托管壳层本地记忆端口，不让调用方自己散落 localStorage 细节", () => {
    const storage = createFakeStorage();
    const runtime = 创建存储运行时({ storage });
    const memory = runtime.壳层记忆();

    memory.写入当前房间标识("r-platform");
    memory.写入当前房间短码("ROOM99");

    expect(memory.读取当前房间标识()).toBe("r-platform");
    expect(memory.读取当前房间短码()).toBe("ROOM99");
  });

  it("默认存储源会在取端口时读取当前 localStorage，而不是把第一次启动时的句柄永久抓死", () => {
    const firstStorage = createFakeStorage();
    const secondStorage = createFakeStorage();
    Object.defineProperty(window, "localStorage", {
      value: firstStorage,
      configurable: true,
    });

    const runtime = 创建存储运行时();
    runtime.壳层记忆().写入当前房间标识("r-first");

    Object.defineProperty(window, "localStorage", {
      value: secondStorage,
      configurable: true,
    });

    runtime.壳层记忆().写入当前房间标识("r-second");

    expect(firstStorage.getItem("koko_current_room_id")).toBe("r-first");
    expect(secondStorage.getItem("koko_current_room_id")).toBe("r-second");
  });
});
