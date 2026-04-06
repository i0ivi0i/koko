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
    vi.restoreAllMocks();
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

  it("以 device_anonymous_token 调用 bootstrap_anonymous_identity", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          anonymous_identity_id: "a-1",
          display_alias: "暴躁的企鹅",
          session_id: "s-1",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");

    const result = await transport.bootstrapAnonymousIdentity("device-token-1");

    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:3000/api/session/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_anonymous_token: "device-token-1" }),
    });
    expect(result.anonymous_identity_id).toBe("a-1");
    expect(result.display_alias).toBe("暴躁的企鹅");
    expect(result.session_id).toBe("s-1");
  });
});
