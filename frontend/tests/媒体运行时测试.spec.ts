import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { 创建媒体运行时Actor, 投影媒体运行时预算 } from "../媒体/运行时.js";
import type { 媒体播放结果 } from "../媒体/媒体播放.js";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

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
  it("媒体运行时 owner 直连生效，旧根入口已经删除", () => {
    const ownerSource = 读取前端源码("媒体/运行时.ts");
    const mediaOrchestratorSource = 读取前端源码("媒体/播放会话/应用.ts");
    const autoplayShellSource = 读取前端源码("媒体/壳层/自动播协作.ts");
    const previewShellSource = 读取前端源码("媒体/壳层/视频预览协作.ts");

    expect(existsSync(resolve(process.cwd(), "媒体运行时.ts"))).toBe(false);
    expect(ownerSource).toContain("const 媒体运行时机 = createMachine(");
    expect(ownerSource).toContain("export function 创建媒体运行时Actor()");
    expect(existsSync(resolve(process.cwd(), "聊天媒体编排.ts"))).toBe(false);
    expect(mediaOrchestratorSource).toContain('from "../运行时.js"');
    expect(mediaOrchestratorSource).not.toContain('from "./媒体运行时.js"');
    expect(autoplayShellSource).toContain('from "../运行时.js"');
    expect(autoplayShellSource).not.toContain('from "../../媒体运行时.js"');
    expect(previewShellSource).toContain('from "../运行时.js"');
    expect(previewShellSource).not.toContain('from "../../媒体运行时.js"');
  });

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
      activeFormalPlayerCount: 1,
      autoplayOwnerCount: 1,
    });
  });

  it("正式查看器与 inline autoplay 会统一投影成单 formal player 预算，而不是两套并行正式播放器", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-owner-1",
          visibilityRatio: 0.96,
          distanceToViewportCenter: 10,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });

    expect(投影媒体运行时预算(actor.getSnapshot())).toMatchObject({
      activeFormalPlayerCount: 1,
      autoplayOwnerCount: 1,
    });

    actor.send({
      type: "VIEWER_OPEN_REQUESTED",
      request: 创建视频查看器请求("att-video-viewer-formal-1"),
    });
    actor.send({ type: "VIEWER_OPEN_CONFIRMED" });

    expect(投影媒体运行时预算(actor.getSnapshot())).toMatchObject({
      activeFormalPlayerCount: 1,
      autoplayOwnerCount: 0,
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
      resolve(import.meta.dirname, "../媒体/播放会话/应用.ts"),
      "utf8"
    );

    expect(source).toContain("创建媒体运行时Actor");
    expect(source).not.toContain("let inlineAutoplayOwnerAttachmentId");
    expect(source).not.toContain("let 当前自动播解析结果");
  });

  it("媒体运行时只负责 viewer/autoplay/runtime budget，不接手分发底层运行时初始化", () => {
    const source = 读取前端源码("媒体/运行时.ts");

    expect(source).toContain("VIEWER_OPEN_REQUESTED");
    expect(source).toContain("INLINE_AUTOPLAY_CANDIDATES_OBSERVED");
    expect(source).toContain("PLAYBACK_REQUEST_STARTED");
    expect(source).not.toContain("获取或创建协作分发浏览器运行时");
    expect(source).not.toContain("创建资产协作分发运行时");
    expect(source).not.toContain("new WebTorrent");
    expect(source).not.toContain("createServer(");
  });

  it("自动播播放结果由媒体运行时快照承载，编排层只负责解析副作用", () => {
    const actor = 创建媒体运行时Actor();
    const playback: 媒体播放结果 = {
      mode: "swarm",
      attachmentId: "att-video-inline-owned",
      kind: "video",
      src: "blob:http://media.local/swarm-inline",
      thumbnailUrl: "http://media.local/poster-inline.jpg",
      hint: null,
    };

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-owned",
          visibilityRatio: 0.91,
          distanceToViewportCenter: 14,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-inline-owned",
      playback,
    });

    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(playback);
  });

  it("pending 候选的播放源到位时，会原子切成 owner，避免 owner 已切但 playback 为空", () => {
    const actor = 创建媒体运行时Actor();
    const playback: 媒体播放结果 = {
      mode: "swarm",
      attachmentId: "att-video-inline-pending-ready",
      kind: "video",
      src: "blob:http://media.local/swarm-pending-ready",
      thumbnailUrl: null,
      hint: null,
    };

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-pending-ready",
          visibilityRatio: 0.91,
          distanceToViewportCenter: 14,
        },
      ],
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-inline-pending-ready"
    );

    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-inline-pending-ready",
      playback,
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-pending-ready"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(playback);
  });

  it("自动播播放位置由媒体运行时持有，owner 释放后仍保留同源续播时间戳", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-position-1",
          visibilityRatio: 0.91,
          distanceToViewportCenter: 14,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "PLAYBACK_POSITION_CHANGED",
      attachmentId: "att-video-inline-position-1",
      position: {
        src: "http://media.local/swarm-inline-position-1",
        currentTime: 21.25,
        updatedAt: 1_000,
      },
    });

    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-position-1"
      ]
    ).toMatchObject({
      src: "http://media.local/swarm-inline-position-1",
      currentTime: 21.25,
    });

    actor.send({ type: "INLINE_AUTOPLAY_RELEASE_REQUESTED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-position-1"
      ]
    ).toMatchObject({
      currentTime: 21.25,
    });
  });

  it("离屏释放 owner 后重新成为自动播 owner 时，会继续沿用上次中断位置", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-resume-after-release-1",
          visibilityRatio: 0.91,
          distanceToViewportCenter: 14,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "PLAYBACK_POSITION_CHANGED",
      attachmentId: "att-video-inline-resume-after-release-1",
      position: {
        src: "http://media.local/swarm-inline-resume-after-release-1",
        currentTime: 18.25,
        updatedAt: 1_000,
      },
    });

    actor.send({ type: "INLINE_AUTOPLAY_RELEASE_REQUESTED" });
    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-resume-after-release-1",
          visibilityRatio: 0.93,
          distanceToViewportCenter: 12,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-resume-after-release-1"
    );
    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-resume-after-release-1"
      ]
    ).toMatchObject({
      src: "http://media.local/swarm-inline-resume-after-release-1",
      currentTime: 18.25,
    });
  });

  it("自然循环进入下一轮后，会接受更晚的 0.x 位置并忽略延迟到达的旧轮次时间戳", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "PLAYBACK_POSITION_CHANGED",
      attachmentId: "att-video-inline-loop-1",
      position: {
        src: "http://media.local/swarm-inline-loop-1",
        currentTime: 58.5,
        updatedAt: 1_000,
      },
    });
    actor.send({
      type: "PLAYBACK_POSITION_CHANGED",
      attachmentId: "att-video-inline-loop-1",
      position: {
        src: "http://media.local/swarm-inline-loop-1",
        currentTime: 0.35,
        updatedAt: 2_000,
      },
    });
    actor.send({
      type: "PLAYBACK_POSITION_CHANGED",
      attachmentId: "att-video-inline-loop-1",
      position: {
        src: "http://media.local/swarm-inline-loop-1",
        currentTime: 58.75,
        updatedAt: 1_500,
      },
    });

    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-loop-1"
      ]
    ).toMatchObject({
      currentTime: 0.35,
      updatedAt: 2_000,
    });
  });

  it("viewer 打开或生命周期降级释放 inline owner 时，不会清空 resume 资格", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-viewer-resume-1",
          visibilityRatio: 0.92,
          distanceToViewportCenter: 8,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "PLAYBACK_POSITION_CHANGED",
      attachmentId: "att-video-inline-viewer-resume-1",
      position: {
        src: "http://media.local/swarm-inline-viewer-resume-1",
        currentTime: 26.5,
        updatedAt: 1_000,
      },
    });

    actor.send({
      type: "VIEWER_OPEN_REQUESTED",
      request: 创建视频查看器请求("att-video-inline-viewer-resume-1"),
    });
    actor.send({
      type: "LIFECYCLE_POLICY_CHANGED",
      heavyWorkPolicy: "reduced",
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-viewer-resume-1"
      ]
    ).toMatchObject({
      currentTime: 26.5,
      updatedAt: 1_000,
    });
  });

  it("自动播播放位置会保留当前消息集合内的全部附件，不能因为超过固定上限丢失续播时间戳", () => {
    const actor = 创建媒体运行时Actor();
    const activeAttachmentIds = Array.from(
      { length: 260 },
      (_, index) => `att-video-inline-position-${index}`
    );

    actor.send({
      type: "MESSAGE_ATTACHMENTS_SYNCED",
      attachmentIds: activeAttachmentIds,
    });

    for (let index = 0; index < 260; index += 1) {
      actor.send({
        type: "PLAYBACK_POSITION_CHANGED",
        attachmentId: `att-video-inline-position-${index}`,
        position: {
          src: `http://media.local/swarm-inline-position-${index}`,
          currentTime: index + 0.5,
          updatedAt: index,
        },
      });
    }

    expect(
      Object.keys(actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId)
    ).toHaveLength(260);
    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-position-0"
      ]
    ).toMatchObject({
      currentTime: 0.5,
    });
    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-position-259"
      ]?.currentTime
    ).toBeCloseTo(259.5, 2);

    actor.send({
      type: "MESSAGE_ATTACHMENTS_SYNCED",
      attachmentIds: ["att-video-inline-position-259"],
    });

    expect(actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId).toEqual({
      "att-video-inline-position-259": {
        src: "http://media.local/swarm-inline-position-259",
        currentTime: 259.5,
        updatedAt: 259,
      },
    });
  });

  it("A 退场后 B 继续播放时，只要 A 还在房间消息集合内，B 的位置上报不能裁掉 A 的续播时间戳", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "MESSAGE_ATTACHMENTS_SYNCED",
      attachmentIds: ["att-video-a"],
      positionRetentionAttachmentIds: ["att-video-a", "att-video-b"],
    });
    actor.send({
      type: "PLAYBACK_POSITION_CHANGED",
      attachmentId: "att-video-a",
      position: {
        src: "http://media.local/swarm-video-a",
        currentTime: 18.75,
        updatedAt: 1_000,
      },
    });
    actor.send({
      type: "MESSAGE_ATTACHMENTS_SYNCED",
      attachmentIds: ["att-video-b"],
      positionRetentionAttachmentIds: ["att-video-a", "att-video-b"],
    });
    actor.send({
      type: "PLAYBACK_POSITION_CHANGED",
      attachmentId: "att-video-b",
      position: {
        src: "http://media.local/swarm-video-b",
        currentTime: 6.25,
        updatedAt: 2_000,
      },
    });

    expect(actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId).toMatchObject({
      "att-video-a": {
        src: "http://media.local/swarm-video-a",
        currentTime: 18.75,
      },
      "att-video-b": {
        src: "http://media.local/swarm-video-b",
        currentTime: 6.25,
      },
    });
  });

  it("自动播播放位置在附件集合尚未同步时仍会兜底裁剪，避免异常事件把体验态撑成无界缓存", () => {
    const actor = 创建媒体运行时Actor();

    for (let index = 0; index < 260; index += 1) {
      actor.send({
        type: "PLAYBACK_POSITION_CHANGED",
        attachmentId: `att-video-inline-unsynced-position-${index}`,
        position: {
          src: `http://media.local/swarm-inline-unsynced-position-${index}`,
          currentTime: index + 0.5,
          updatedAt: index,
        },
      });
    }

    expect(
      Object.keys(actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId)
    ).toHaveLength(256);
    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-unsynced-position-0"
      ]
    ).toBeUndefined();
    expect(
      actor.getSnapshot().context.inlineAutoplayPositionByAttachmentId[
        "att-video-inline-unsynced-position-259"
      ]?.currentTime
    ).toBeCloseTo(259.5, 2);
  });

  it("hidden/background 释放自动播 owner 后，不会再通过旧路径重新把它补回来", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-hidden-1",
          visibilityRatio: 0.91,
          distanceToViewportCenter: 14,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-hidden-1"
    );

    actor.send({
      type: "LIFECYCLE_POLICY_CHANGED",
      heavyWorkPolicy: "suspended",
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();
  });

  it("自动播候选出现单帧空观测时，不会立刻释放 owner 与已裁决播放结果", () => {
    const actor = 创建媒体运行时Actor();
    const playback: 媒体播放结果 = {
      mode: "anchor",
      attachmentId: "att-video-inline-jitter-1",
      kind: "video",
      src: "http://media.local/original-att-video-inline-jitter-1",
      thumbnailUrl: "http://media.local/poster-att-video-inline-jitter-1",
      hint: null,
    };

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-jitter-1",
          visibilityRatio: 0.9,
          distanceToViewportCenter: 14,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-inline-jitter-1",
      playback,
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-jitter-1"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(playback);

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [],
    });

    // 单帧空观测通常来自虚拟列表重排/观察器抖动；不应立刻把消息卡片从 video 切回 poster。
    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-jitter-1"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(playback);

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [],
    });

    // 连续空观测仍需释放 owner，避免离屏附件长期占用预算。
    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();
  });

  it("候选连续空帧但 owner 仍在活媒体窗口内时，不会释放 canonical owner", () => {
    const actor = 创建媒体运行时Actor();
    const attachmentId = "att-video-inline-active-window-jitter";
    const playback: 媒体播放结果 = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: "blob:http://media.local/swarm-active-window-jitter",
      thumbnailUrl: null,
      hint: null,
    };

    actor.send({
      type: "MESSAGE_ATTACHMENTS_SYNCED",
      attachmentIds: [attachmentId],
    });
    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId,
          visibilityRatio: 0.93,
          distanceToViewportCenter: 12,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId,
      playback,
    });

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [],
    });
    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [],
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      attachmentId
    );
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(playback);

    actor.send({
      type: "MESSAGE_ATTACHMENTS_SYNCED",
      attachmentIds: [],
      positionRetentionAttachmentIds: [attachmentId],
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();
  });

  it("自动播 owner 正在切到新 pending 候选时，单帧空观测不会把旧 owner 提前清空", () => {
    const actor = 创建媒体运行时Actor();
    const playback: 媒体播放结果 = {
      mode: "anchor",
      attachmentId: "att-video-inline-handoff-old",
      kind: "video",
      src: "http://media.local/original-att-video-inline-handoff-old",
      thumbnailUrl: "http://media.local/poster-att-video-inline-handoff-old",
      hint: null,
    };

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-handoff-old",
          visibilityRatio: 0.93,
          distanceToViewportCenter: 12,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
      attachmentId: "att-video-inline-handoff-old",
      playback,
    });

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-handoff-new",
          visibilityRatio: 0.94,
          distanceToViewportCenter: 10,
        },
      ],
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-handoff-old"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-inline-handoff-new"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(playback);

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [],
    });

    /**
     * owner 交接时最容易出现一帧观察器抖动：
     * - 如果这里把 owner 立刻清成 null，消息窗就会收到“当前没有 canonical surface”；
     * - 后面的唯一播放器随之 destroy/recreate，用户肉眼就会看到闪一下再接着播。
     *
     * 因此在 pending 还没真正 settle 之前，单帧空观测也必须继续保留旧 owner。
     */
    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-inline-handoff-old"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-inline-handoff-new"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(playback);
  });

  it("高竖视频交接落入 dead zone 时，会保持旧 owner 并挂起新的 pending，而不是掉成 null", () => {
    const actor = 创建媒体运行时Actor();
    const playback: 媒体播放结果 = {
      mode: "anchor",
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
     * runtime 这里不能把 owner 清空；正确语义是旧 owner 继续保活，同时挂起更接近视口中心的新 pending。
     */
    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-dead-zone-old"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-dead-zone-new"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toEqual(playback);

    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBe(
      "att-video-dead-zone-new"
    );
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();
  });

  it("自动播 owner 正在交接时，连续空观测达到阈值后仍会释放旧 owner 与 pending", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-handoff-release-old",
          visibilityRatio: 0.91,
          distanceToViewportCenter: 14,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-handoff-release-new",
          visibilityRatio: 0.95,
          distanceToViewportCenter: 9,
        },
      ],
    });

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [],
    });
    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [],
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPlayback).toBeNull();
  });

  it("正式查看器关闭后，会根据最后一次可见候选重新挂起自动播 owner", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-restore-1",
          visibilityRatio: 0.92,
          distanceToViewportCenter: 10,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "VIEWER_OPEN_REQUESTED",
      request: 创建视频查看器请求("att-video-inline-restore-1"),
    });
    actor.send({ type: "VIEWER_OPEN_CONFIRMED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();

    actor.send({ type: "VIEWER_CLOSED" });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-inline-restore-1"
    );
  });

  it("生命周期恢复到 normal 后，会根据最后一次可见候选重新挂起自动播 owner", () => {
    const actor = 创建媒体运行时Actor();

    actor.send({
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-resume-1",
          visibilityRatio: 0.93,
          distanceToViewportCenter: 8,
        },
      ],
    });
    actor.send({ type: "INLINE_AUTOPLAY_SETTLE_ELAPSED" });
    actor.send({
      type: "LIFECYCLE_POLICY_CHANGED",
      heavyWorkPolicy: "suspended",
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBeNull();

    actor.send({
      type: "LIFECYCLE_POLICY_CHANGED",
      heavyWorkPolicy: "normal",
    });

    expect(actor.getSnapshot().context.inlineAutoplayOwnerAttachmentId).toBeNull();
    expect(actor.getSnapshot().context.inlineAutoplayPendingAttachmentId).toBe(
      "att-video-inline-resume-1"
    );
  });
});
