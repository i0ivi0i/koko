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
});
