import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  判定播放连续性表面,
  播放连续性机,
  type 播放连续性输入,
} from "../媒体/全局丝滑自动播.js";

const 基础输入: 播放连续性输入 = {
  attachmentId: "att-1",
  ownerAttachmentId: "att-1",
  surface: "timeline",
  source: { src: "blob:webtorrent/att-1" },
  savedPosition: { src: "blob:webtorrent/att-1", currentTime: 18, updatedAt: 1 },
  dom: { previewReadyState: 0, canonicalReadyState: 0, sourceMatches: true },
  host: { exists: true, hasStableFrame: true },
  frameEvidence: { kind: "none" },
  intent: { viewerOpen: false, fullscreen: false },
};

describe("全局丝滑自动播", () => {
  it("有同源保存位置但当前 DOM 未可显示时只能隐藏接管，不能露出真实视频", () => {
    const decision = 判定播放连续性表面(基础输入);

    expect(decision).toMatchObject({
      phase: "hiddenHandoff",
      kind: "hidden_handoff",
      targetCurrentTime: 18,
    });
  });

  it("当前 canonical DOM 已可显示且位置同源时才允许 visible canonical", () => {
    const decision = 判定播放连续性表面({
      ...基础输入,
      dom: { previewReadyState: 2, canonicalReadyState: 3, sourceMatches: true },
    });

    expect(decision).toMatchObject({
      phase: "visible",
      kind: "visible_canonical",
      targetCurrentTime: 18,
    });
  });

  it("当前只有同源 preview 首帧可显示时保持暂停帧，不抢露 canonical", () => {
    const decision = 判定播放连续性表面({
      ...基础输入,
      dom: { previewReadyState: 2, canonicalReadyState: 0, sourceMatches: true },
      frameEvidence: {
        kind: "preview_dom",
        src: "blob:webtorrent/att-1",
        currentTime: 18,
      },
    });

    expect(decision).toMatchObject({
      phase: "pausedFrame",
      kind: "hold_frame",
      src: "blob:webtorrent/att-1",
      targetCurrentTime: 18,
    });
  });

  it("preview DOM 虽已出首帧，但帧时间还没追上续播点时不能误判成暂停帧", () => {
    const decision = 判定播放连续性表面({
      ...基础输入,
      dom: { previewReadyState: 2, canonicalReadyState: 0, sourceMatches: true },
      frameEvidence: {
        kind: "preview_dom",
        src: "blob:webtorrent/att-1",
        currentTime: 0,
      },
    });

    expect(decision).toMatchObject({
      phase: "hiddenHandoff",
      kind: "hidden_handoff",
      targetCurrentTime: 18,
    });
  });

  it("调用方已确认同源时允许相对 WebTorrent 源承接 currentSrc 绝对地址保存位置", () => {
    const decision = 判定播放连续性表面({
      ...基础输入,
      source: { src: "/webtorrent/demo-infohash/content-demo.mp4" },
      savedPosition: {
        src: "https://127.0.0.1/webtorrent/demo-infohash/content-demo.mp4",
        currentTime: 19.75,
        updatedAt: 2,
      },
      dom: { previewReadyState: 0, canonicalReadyState: 0, sourceMatches: true },
    });

    expect(decision).toMatchObject({
      phase: "hiddenHandoff",
      kind: "hidden_handoff",
      targetCurrentTime: 19.75,
    });
  });

  it("同源稳定帧已经存在时，即使暂无保存位置也不能退成冷占位", () => {
    const decision = 判定播放连续性表面({
      ...基础输入,
      savedPosition: null,
      dom: { previewReadyState: 0, canonicalReadyState: 0, sourceMatches: true },
      host: { exists: true, hasStableFrame: true },
    });

    expect(decision).toMatchObject({
      phase: "hiddenHandoff",
      kind: "hidden_handoff",
      targetCurrentTime: 0,
    });
  });

  it("查看器和全屏意图会变成同一条会话 handoff，而不是冷启动", () => {
    expect(
      判定播放连续性表面({
        ...基础输入,
        intent: { viewerOpen: true, fullscreen: false },
      })
    ).toMatchObject({ phase: "viewerHandoff", kind: "viewer_handoff", targetCurrentTime: 18 });

    expect(
      判定播放连续性表面({
        ...基础输入,
        intent: { viewerOpen: false, fullscreen: true },
      })
    ).toMatchObject({
      phase: "fullscreenHandoff",
      kind: "fullscreen_handoff",
      targetCurrentTime: 18,
    });
  });

  it("无正式源或宿主缺失时只能给冷占位理由，不能伪造续播", () => {
    expect(
      判定播放连续性表面({
        ...基础输入,
        source: { src: null },
      })
    ).toMatchObject({ phase: "coldPlaceholder", kind: "cold_placeholder", reason: "no_source" });

    expect(
      判定播放连续性表面({
        ...基础输入,
        host: { exists: false, hasStableFrame: false },
      })
    ).toMatchObject({
      phase: "coldPlaceholder",
      kind: "cold_placeholder",
      reason: "host_missing",
    });
  });

  it("显式退场时进入 retire 阶段", () => {
    const decision = 判定播放连续性表面({
      ...基础输入,
      intent: { viewerOpen: false, fullscreen: false, retire: true },
    });

    expect(decision).toMatchObject({ phase: "retired", kind: "retire" });
  });

  it("播放连续性裁决保留显式顺序，但不能把 XState runtime 放进滚动热路径", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../媒体/全局丝滑自动播.ts"),
      "utf8"
    );

    expect(播放连续性机.transitions).toEqual([
      "retired",
      "coldPlaceholder",
      "fullscreenHandoff",
      "viewerHandoff",
      "visible",
      "pausedFrame",
      "hiddenHandoff",
    ]);
    expect(source).not.toContain("initialTransition");
    expect(source).not.toContain("setup(");
  });
});
