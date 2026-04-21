import { describe, expect, it, vi } from "vitest";
import { 派生视频预览 } from "../媒体/视频预览.js";

describe("视频预览", () => {
  it("命中 embedded hint 时会立刻返回 preview，不再等待 playback owner", async () => {
    const deriveEarlyFrame = vi.fn(async () => null);
    const captureDecodedFrame = vi.fn(async () => null);

    const result = await 派生视频预览({
      attachmentId: "att-video-preview-1",
      contentHash: "hash-video-preview-1",
      embeddedHint: {
        objectUrl: "blob:embedded-preview-1",
        width: 320,
        height: 180,
      },
      canDecode: async () => true,
      deriveEarlyFrame,
      captureDecodedFrame,
    });

    expect(result).toMatchObject({
      source: "embedded_hint",
      objectUrl: "blob:embedded-preview-1",
      width: 320,
      height: 180,
    });
    expect(deriveEarlyFrame).not.toHaveBeenCalled();
    expect(captureDecodedFrame).not.toHaveBeenCalled();
  });

  it("没有任何 source bytes 时会明确返回 none，而不是偷读 original", async () => {
    const result = await 派生视频预览({
      attachmentId: "att-video-preview-2",
      contentHash: "hash-video-preview-2",
      embeddedHint: null,
      canDecode: async () => false,
      deriveEarlyFrame: vi.fn(async () => null),
      captureDecodedFrame: vi.fn(async () => null),
    });

    expect(result).toMatchObject({
      source: "none",
      objectUrl: null,
    });
  });
});
