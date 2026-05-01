import { describe, expect, it, vi } from "vitest";

import { 处理发送消息请求, 处理消息输入变更 } from "../输入框/应用.js";

describe("输入框应用", () => {
  it("消息输入变化只负责写入输入 owner，不顺手发送消息", () => {
    const 写入消息输入 = vi.fn();

    处理消息输入变更({
      value: "hello kernel",
      写入消息输入,
    });

    expect(写入消息输入).toHaveBeenCalledWith("hello kernel");
  });

  it("发送成功后只有全 ready 草稿才会清空，避免阻塞草稿被误删", async () => {
    const 触发发送 = vi.fn().mockResolvedValue(undefined);
    const 清空媒体草稿 = vi.fn();

    await 处理发送消息请求({
      读取媒体草稿: () => [
        { localId: "draft-1", status: "ready" },
        { localId: "draft-2", status: "ready" },
      ],
      触发发送,
      清空媒体草稿,
    });

    expect(触发发送).toHaveBeenCalledTimes(1);
    expect(清空媒体草稿).toHaveBeenCalledTimes(1);
  });

  it("存在非 ready 草稿时即使发送成功也不能提前清空草稿", async () => {
    const 触发发送 = vi.fn().mockResolvedValue(undefined);
    const 清空媒体草稿 = vi.fn();

    await 处理发送消息请求({
      读取媒体草稿: () => [
        { localId: "draft-1", status: "ready" },
        { localId: "draft-2", status: "transporting" },
      ],
      触发发送,
      清空媒体草稿,
    });

    expect(触发发送).toHaveBeenCalledTimes(1);
    expect(清空媒体草稿).not.toHaveBeenCalled();
  });
});
