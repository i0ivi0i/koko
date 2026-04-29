import { describe, expect, it } from "vitest";
import {
  投影信息流视频预算,
  type 正式媒体字节来源,
} from "../媒体/信息流视频预算.js";

const 正式WebTorrent来源: 正式媒体字节来源 = "webtorrent_official_stream";

describe("信息流视频预算", () => {
  it("heavy owner 只有在正式内容字节来自 WebTorrent 时才允许 canonical 接管", () => {
    const budget = 投影信息流视频预算({
      attachmentId: "att-budget-webtorrent",
      playback: {
        mode: "swarm",
        attachmentId: "att-budget-webtorrent",
        kind: "video",
        src: "blob:http://media.local/swarm-att-budget-webtorrent",
        thumbnailUrl: null,
        hint: null,
        formalByteSource: 正式WebTorrent来源,
      },
      inlineAutoplayPlayback: null,
      viewerCanonicalVideoSrc: null,
      previewVideoSrc: "blob:http://media.local/swarm-att-budget-webtorrent",
      inMediaWindow: true,
      isAutoplayCandidate: false,
      isInlineAutoplayOwner: true,
      isViewerOwner: false,
      sessionStatus: "backfilling",
      locallyComplete: false,
      formalByteSource: 正式WebTorrent来源,
    });

    expect(budget).toMatchObject({
      tier: "heavy_playback",
      reason: "inline_autoplay_owner",
      formalByteSource: 正式WebTorrent来源,
      allowInlineCanonical: true,
    });
  });

  it("非 WebTorrent 内容字节入口只能成为失败证据，不能变成 warm 或 heavy 成功", () => {
    const budget = 投影信息流视频预算({
      attachmentId: "att-budget-bypass",
      playback: null,
      inlineAutoplayPlayback: null,
      viewerCanonicalVideoSrc: "https://cdn.local/att-budget-bypass.mp4",
      previewVideoSrc: "https://cdn.local/att-budget-bypass-preview.mp4",
      inMediaWindow: true,
      isAutoplayCandidate: true,
      isInlineAutoplayOwner: true,
      isViewerOwner: false,
      sessionStatus: null,
      locallyComplete: false,
      formalByteSource: "non_webtorrent_bypass",
    });

    expect(budget).toMatchObject({
      tier: "cold_expression",
      reason: "non_webtorrent_bypass",
      canonicalVideoSrc: null,
      previewVideoSrc: null,
      allowInlineCanonical: false,
      allowPreviewVideo: false,
      formalByteSource: "non_webtorrent_bypass",
    });
  });

  it("WebTorrent lifecycle 已降为轻帮助时不会因为旧 preview src 继续保留前台视频面", () => {
    const budget = 投影信息流视频预算({
      attachmentId: "att-budget-light-help",
      playback: null,
      inlineAutoplayPlayback: null,
      viewerCanonicalVideoSrc: null,
      previewVideoSrc: "blob:http://media.local/swarm-att-budget-light-help",
      inMediaWindow: true,
      isAutoplayCandidate: true,
      isInlineAutoplayOwner: false,
      isViewerOwner: false,
      sessionStatus: "backfilling",
      locallyComplete: false,
      formalByteSource: 正式WebTorrent来源,
      webTorrentLifecycle: {
        state: "light_help",
        generation: 2,
        activeReaderCount: 0,
        hasPresenceHeartbeat: true,
        hasJoinTicketRefresh: true,
      },
    });

    expect(budget).toMatchObject({
      tier: "light_help",
      reason: "retained_media_session",
      previewVideoSrc: null,
      allowPreviewVideo: false,
      webTorrentLifecycleState: "light_help",
      activeWebTorrentReaderCount: 0,
    });
  });
});
