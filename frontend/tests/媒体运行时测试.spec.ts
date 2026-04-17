import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { 创建媒体运行时Actor, 投影媒体运行时预算 } from "../媒体运行时.js";

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
  it("同屏真实 video 数超过预算时，只有可见 owner 保留为 active", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-1",
          visibilityRatio: 0.82,
          distanceToViewportCenter: 42,
        },
        {
          attachmentId: "att-video-inline-2",
          visibilityRatio: 0.93,
          distanceToViewportCenter: 12,
        },
        {
          attachmentId: "att-video-inline-3",
          visibilityRatio: 0.88,
          distanceToViewportCenter: 28,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });

    expect(投影媒体运行时预算(actor.getSnapshot())).toMatchObject({
      activeVideoCount: 1,
      autoplayOwnerCount: 1,
    });
  });

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

  it("长任务计数和 inflight locator/manifest/range 计数会进入统一快照", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({ type: "LOCATOR_REQUEST_STARTED" });
    actor.send({ type: "PLAYBACK_REQUEST_STARTED" });

    expect(投影媒体运行时预算(actor.getSnapshot())).toMatchObject({
      inflightLocatorCount: 1,
      inflightManifestOrRangeCount: 1,
      longTaskCount: 0,
    });

    actor.send({ type: "LOCATOR_REQUEST_FINISHED", durationMs: 12 });
    actor.send({ type: "PLAYBACK_REQUEST_FINISHED", durationMs: 160 });

    expect(投影媒体运行时预算(actor.getSnapshot())).toMatchObject({
      inflightLocatorCount: 0,
      inflightManifestOrRangeCount: 0,
      longTaskCount: 1,
    });
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
