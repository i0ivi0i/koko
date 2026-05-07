import { describe, expect, it } from "vitest";

import {
  判定播放连续性表面,
  type 播放连续性输入,
} from "../../媒体/视频可见槽位协议.js";

const 基础输入: 播放连续性输入 = {
  attachmentId: "att-cold-1",
  ownerAttachmentId: "att-cold-1",
  surface: "timeline",
  source: { src: "http://media.local/swarm-cold-1" },
  savedPosition: {
    src: "http://media.local/swarm-cold-1",
    currentTime: 18,
    updatedAt: 1_715_000_000_000,
  },
  dom: {
    previewReadyState: 0,
    canonicalReadyState: 0,
    sourceMatches: true,
    previewCommitted: false,
    canonicalCommitted: false,
  },
  host: {
    exists: true,
    hasStableFrame: true,
  },
  frameEvidence: { kind: "none" },
  intent: {
    viewerOpen: false,
    fullscreen: false,
  },
};

describe("视频可见槽位协议 / 冷路径首轮曝光", () => {
  it("首轮只有 placeholder 占位时，也必须把当前可见槽位明确标成 placeholder，不能让渲染层自己猜", () => {
    const decision = 判定播放连续性表面({
      ...基础输入,
      /**
       * 这里故意用 `as 播放连续性输入 & {...}` 先写红测：
       * 当前生产代码还不认识 `coldPath`，测试会先失败，
       * 然后再驱动协议把“冷首轮可见槽位”升级成显式事实。
       */
      coldPath: {
        coldFirstExposure: true,
        stableSurface: "placeholder",
      },
    } as 播放连续性输入 & {
      coldPath: {
        coldFirstExposure: boolean;
        stableSurface: "none" | "placeholder" | "preview_frame" | "frozen_frame";
      };
    });

    expect(decision).toMatchObject({
      phase: "hiddenHandoff",
      kind: "hidden_handoff",
      visibleSurface: "placeholder",
      targetCurrentTime: 18,
    });
  });

  it("首轮既没有 warm frame 也没有 placeholder 时，协议也必须显式给出 placeholder 可见槽位，禁止渲染层裸奔", () => {
    const decision = 判定播放连续性表面({
      ...基础输入,
      savedPosition: null,
      host: {
        exists: true,
        hasStableFrame: false,
      },
      coldPath: {
        coldFirstExposure: true,
        stableSurface: "none",
      },
    } as 播放连续性输入 & {
      coldPath: {
        coldFirstExposure: boolean;
        stableSurface: "none" | "placeholder" | "preview_frame" | "frozen_frame";
      };
    });

    expect(decision).toMatchObject({
      phase: "coldPlaceholder",
      kind: "cold_placeholder",
      visibleSurface: "placeholder",
      reason: "no_position",
    });
  });
});
