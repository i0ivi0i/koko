import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { 创建媒体运行时Actor } from "../媒体运行时.js";

const 创建视频查看器请求 = (attachmentId: string) => ({
  startAttachmentId: attachmentId,
  items: [
    {
      kind: "video" as const,
      attachmentId,
      src: `http://media.local/original-${attachmentId}`,
      posterSrc: `http://media.local/poster-${attachmentId}`,
      width: 1280,
      height: 720,
    },
  ],
});

describe("媒体运行时", () => {
  it("正式查看器打开后，inline autoplay owner 会立即退场", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-1",
          visibilityRatio: 0.84,
          distanceToViewportCenter: 18,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-1"
    );

    actor.send({
      type: "VIEWER_OPEN_REQUESTED",
      request: 创建视频查看器请求("att-video-inline-1"),
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.currentViewerRequest).toMatchObject({
      startAttachmentId: "att-video-inline-1",
    });
  });

  it("hidden/background 时会释放自动播 owner，但不会误清正式查看器会话真相", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-2",
          visibilityRatio: 0.9,
          distanceToViewportCenter: 12,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "VIEWER_OPEN_REQUESTED",
      request: 创建视频查看器请求("att-video-viewer-1"),
    });
    actor.send({ type: "VIEWER_OPEN_CONFIRMED" });
    actor.send({
      type: "LIFECYCLE_POLICY_CHANGED",
      heavyWorkPolicy: "reduced",
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.currentViewerRequest).toMatchObject({
      startAttachmentId: "att-video-viewer-1",
    });
    expect(actor.getSnapshot().context.viewerOpen).toBe(true);
  });

  it("聊天媒体编排不再自己持有 inline autoplay owner 真相", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../聊天媒体编排.ts"),
      "utf8"
    );

    expect(source).toContain("创建媒体运行时Actor");
    expect(source).not.toContain("let inlineAutoplayOwnerAttachmentId");
  });
});
