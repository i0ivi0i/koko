import { beforeEach, describe, expect, it, vi } from "vitest";

const { ioSpy } = vi.hoisted(() => ({
  ioSpy: vi.fn(() => ({}) as never),
}));

vi.mock("socket.io-client", () => ({
  io: ioSpy,
}));

import { HttpRealtime传输 } from "../传输";
import type { 匿名身份快照 } from "../契约";

describe("传输", () => {
  beforeEach(() => {
    ioSpy.mockClear();
  });

  it("用auth.session_id建立socket连接", () => {
    const transport = new HttpRealtime传输("http://localhost:3000");

    transport.createSocket("s-auth");

    expect(ioSpy).toHaveBeenCalledWith("http://localhost:3000", {
      transports: ["websocket"],
      auth: { session_id: "s-auth" },
    });
  });

  it("bootstrap_anonymous_identity returns internal identity and display alias separately", () => {
    const snapshot: 匿名身份快照 = {
      anonymous_identity_id: "a-1",
      display_alias: "暴躁的企鹅",
    };

    expect(snapshot.anonymous_identity_id).toBe("a-1");
    expect(snapshot.display_alias).toBe("暴躁的企鹅");
    expect(snapshot.anonymous_identity_id).not.toBe(snapshot.display_alias);
  });
});
