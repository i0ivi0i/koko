import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJoinTicketFilter } from "../dev-tracker.mjs";

const require = createRequire(import.meta.url);
const jsonwebtoken = require("jsonwebtoken") as {
  sign(
    payload: Record<string, unknown>,
    secret: string,
    options: { algorithm: "HS256"; expiresIn: string }
  ): string;
};

const 票据密钥 = "test-secret";
const 信息哈希 = "2fac1903a210aa9d28426a0d6dad1b8acd431336";
const peerId = Buffer.from("0011223344556677889900112233445566778899", "hex");

function 调用过滤器(
  filter: ReturnType<typeof createJoinTicketFilter>,
  params: Record<string, unknown>
): Promise<Error | null> {
  return new Promise((resolve) => {
    filter!(信息哈希, params, (error: Error | null) => {
      resolve(error ?? null);
    });
  });
}

describe("dev-tracker join_ticket 门禁", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("已持票入群的 peer 后续 answer 信令不再被误判成无票入群", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T00:00:00.000Z"));
    const filter = createJoinTicketFilter(票据密钥);
    const ticket = jsonwebtoken.sign(
      {
        sub: "session-a",
        aid: "att-a",
        ih: 信息哈希,
      },
      票据密钥,
      {
        algorithm: "HS256",
        expiresIn: "30s",
      }
    );

    await expect(
      调用过滤器(filter, {
        ticket,
        peer_id: peerId,
      })
    ).resolves.toBeNull();

    await expect(
      调用过滤器(filter, {
        answer: { type: "answer", sdp: "fake" },
        peer_id: peerId,
        to_peer_id: Buffer.from("8899001122334455667788990011223344556677", "hex"),
      })
    ).resolves.toBeNull();
  });

  it("未持票入群的 peer 不能伪造 answer 绕过门禁", async () => {
    const filter = createJoinTicketFilter(票据密钥);

    const error = await 调用过滤器(filter, {
      answer: { type: "answer", sdp: "fake" },
      peer_id: peerId,
      to_peer_id: Buffer.from("8899001122334455667788990011223344556677", "hex"),
    });

    expect(error?.message).toBe("join_ticket_invalid");
  });
});
