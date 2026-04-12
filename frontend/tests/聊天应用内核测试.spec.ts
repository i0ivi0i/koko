import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../存储";
import { createFakeStorage, 假传输 } from "./common/聊天测试支架";
import { 创建聊天应用内核 } from "../聊天应用内核";

const 创建内核宿主 = () => ({
  addController: vi.fn(),
  removeController: vi.fn(),
  requestUpdate: vi.fn(),
  updateComplete: Promise.resolve(true),
});

describe("聊天应用内核", () => {
  it("只通过 dispatch / snapshot 暴露聊天业务入口，壳层不再自己拼 join/send/leave 过程", async () => {
    const transport = new 假传输();
    const kernel = 创建聊天应用内核({
      host: 创建内核宿主(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });

    const snapshot = kernel.snapshot();

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);
    expect(snapshot.roomId).toBe("r-test");
    expect(snapshot.roomDisplayTitle).toBe("ROOM01");
  });

  it("发送命令也通过内核 dispatch 统一进入，而不是壳层自己保留 sendCurrentMessage 业务入口", async () => {
    const transport = new 假传输();
    const kernel = 创建聊天应用内核({
      host: 创建内核宿主(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await kernel.dispatch({ type: "MESSAGE_INPUT_CHANGED", value: "hello kernel" });
    await kernel.dispatch({ type: "SEND_MESSAGE_REQUESTED" });

    expect(
      transport.socket.sentEvents.some(
        ({ event, payload }) => event === "create_message" && payload.text === "hello kernel"
      )
    ).toBe(true);
  });
});
