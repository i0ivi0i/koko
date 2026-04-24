import { describe, expect, it, vi } from "vitest";
import {
  计算源文件SHA256,
  计算源文件SHA256经Worker,
  type 源文件哈希WorkerLike,
} from "../媒体/源文件哈希";

describe("源文件 SHA-256 精确哈希", () => {
  it("会按分块把原始 File 字节送进注入的成熟 hasher", async () => {
    const update = vi.fn();
    const digest = vi.fn(() => "abc123");
    const file = new File([new Uint8Array([1, 2, 3])], "raw.bin");

    const hash = await 计算源文件SHA256(file, {
      chunkSize: 2,
      createHasher: async () => ({ update, digest }),
    });

    expect(hash).toBe("abc123");
    expect(update.mock.calls.map(([chunk]) => Array.from(chunk as Uint8Array))).toEqual([
      [1, 2],
      [3],
    ]);
  });

  it("Worker 失败时抛出 source_hash_failed，不能静默返回空 hash", async () => {
    class 失败Worker implements 源文件哈希WorkerLike {
      private listeners: Array<(event: MessageEvent) => void> = [];
      addEventListener(type: "message" | "error", listener: EventListener): void {
        if (type === "message") {
          this.listeners.push(listener as (event: MessageEvent) => void);
        }
      }
      removeEventListener(): void {}
      postMessage(message: unknown): void {
        const { requestId } = message as { requestId: string };
        queueMicrotask(() => {
          for (const listener of this.listeners) {
            listener({
              data: { requestId, ok: false, code: "source_hash_failed" },
            } as MessageEvent);
          }
        });
      }
      terminate(): void {}
    }

    await expect(
      计算源文件SHA256经Worker(new File([new Uint8Array([1])], "bad.bin"), {
        createWorker: () => new 失败Worker(),
      })
    ).rejects.toThrow("source_hash_failed");
  });
});
