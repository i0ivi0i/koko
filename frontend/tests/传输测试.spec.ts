import { beforeEach, describe, expect, it, vi } from "vitest";

const { ioSpy } = vi.hoisted(() => ({
  ioSpy: vi.fn(() => ({}) as never),
}));

vi.mock("socket.io-client", () => ({
  io: ioSpy,
}));

import { HttpRealtime传输 } from "../传输";

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
});
