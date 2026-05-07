import { describe, expect, it } from "vitest";
import { 创建媒体运行时Actor } from "../媒体/运行时.js";
import type { 媒体播放结果 } from "../媒体/媒体播放.js";

describe("媒体运行时自动播稳定表面", () => {
  it("已有旧 owner 时，pending 播放源到位但稳定表面还没 ready，不能立刻切成新 owner", () => {
    const actor = 创建媒体运行时Actor();
    const oldPlayback: 媒体播放结果 = {
      mode: "swarm",
      attachmentId: "att-video-inline-old-owner",
      kind: "video",
      src: "blob:http://media.local/swarm-old-owner",
      thumbnailUrl: null,
      hint: null,
    };
    const nextPlayback: 媒体播放结果 = {
      mode: "swarm",
      attachmentId: "att-video-inline-pending-no-surface",
      kind: "video",
      src: "blob:http://media.local/swarm-pending-no-surface",
      thumbnailUrl: null,
      hint: null,
    };

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-old-owner",
          visibilityRatio: 0.93,
          distanceToViewportCenter: 10,
        },
      ],
    });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-inline-old-owner",
      playback: oldPlayback,
    });

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-pending-no-surface",
          visibilityRatio: 0.95,
          distanceToViewportCenter: 8,
        },
      ],
    });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-inline-pending-no-surface",
      playback: nextPlayback,
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-old-owner"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-inline-pending-no-surface"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingPlayback).toEqual(nextPlayback);
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();
  });

  it("已有旧 owner 时，pending 拿到稳定 bridge 后才会带着 pendingPlayback 原子切成新 owner", () => {
    const actor = 创建媒体运行时Actor();
    const oldPlayback: 媒体播放结果 = {
      mode: "swarm",
      attachmentId: "att-video-inline-old-owner",
      kind: "video",
      src: "blob:http://media.local/swarm-old-owner",
      thumbnailUrl: null,
      hint: null,
    };
    const nextPlayback: 媒体播放结果 = {
      mode: "swarm",
      attachmentId: "att-video-inline-pending-bridge-ready",
      kind: "video",
      src: "blob:http://media.local/swarm-pending-bridge-ready",
      thumbnailUrl: null,
      hint: null,
    };

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-old-owner",
          visibilityRatio: 0.93,
          distanceToViewportCenter: 10,
        },
      ],
    });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-inline-old-owner",
      playback: oldPlayback,
    });
    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-pending-bridge-ready",
          visibilityRatio: 0.95,
          distanceToViewportCenter: 8,
        },
      ],
    });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-inline-pending-bridge-ready",
      playback: nextPlayback,
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-old-owner"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-inline-pending-bridge-ready"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingPlayback).toEqual(nextPlayback);

    actor.send({
      type: "INLINE_AUTOPLAY_STABLE_SURFACE_READY",
      attachmentId: "att-video-inline-pending-bridge-ready",
      surface: "bridge",
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-pending-bridge-ready"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPendingPlayback).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(nextPlayback);
  });

  it("高竖视频交接落入 dead zone 时，轻微领先的新卡不会立刻挂成 pending", () => {
    const actor = 创建媒体运行时Actor();
    const playback: 媒体播放结果 = {
      mode: "legacy_anchor",
      attachmentId: "att-video-dead-zone-old",
      kind: "video",
      src: "http://media.local/original-att-video-dead-zone-old",
      thumbnailUrl: "http://media.local/poster-att-video-dead-zone-old",
      hint: null,
    };

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-dead-zone-old",
          visibilityRatio: 0.91,
          distanceToViewportCenter: 14,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-dead-zone-old",
      playback,
    });

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-dead-zone-old",
          visibilityRatio: 0.437,
          distanceToViewportCenter: 319.4,
        },
        {
          attachmentId: "att-video-dead-zone-new",
          visibilityRatio: 0.506,
          distanceToViewportCenter: 280.6,
        },
      ],
    });

    /**
     * 这不是观察器抖动，而是高竖视频天然会落入“所有候选都低于 0.6”的数学死区。
     * 但如果新卡只比旧卡多露一点点，就不能立刻把 pending 切过去；
     * 否则旧卡还接近半屏可见时就会先被冻住，肉眼看到的就是退场抽一下。
     */
    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-dead-zone-old"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();

    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-dead-zone-old"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();
  });

  it("高竖视频交接落入 dead zone 时，明显领先的新卡会先挂成 pending，等稳定表面 ready 后再接管", () => {
    const actor = 创建媒体运行时Actor();
    const playback: 媒体播放结果 = {
      mode: "legacy_anchor",
      attachmentId: "att-video-dead-zone-old",
      kind: "video",
      src: "http://media.local/original-att-video-dead-zone-old",
      thumbnailUrl: "http://media.local/poster-att-video-dead-zone-old",
      hint: null,
    };

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-dead-zone-old",
          visibilityRatio: 0.91,
          distanceToViewportCenter: 14,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-dead-zone-old",
      playback,
    });

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-dead-zone-old",
          visibilityRatio: 0.39,
          distanceToViewportCenter: 338,
        },
        {
          attachmentId: "att-video-dead-zone-new",
          visibilityRatio: 0.57,
          distanceToViewportCenter: 236,
        },
      ],
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-dead-zone-old"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-dead-zone-new"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();

    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-dead-zone-old"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-dead-zone-new"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();

    actor.send({
      type: "INLINE_AUTOPLAY_STABLE_SURFACE_READY",
      attachmentId: "att-video-dead-zone-new",
      surface: "bridge",
    });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-dead-zone-new",
      playback: {
        mode: "swarm",
        attachmentId: "att-video-dead-zone-new",
        kind: "video",
        src: "blob:http://media.local/swarm-att-video-dead-zone-new",
        thumbnailUrl: null,
        hint: null,
      },
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-dead-zone-new"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();
  });
});
