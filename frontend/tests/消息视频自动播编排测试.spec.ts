import { describe, expect, it } from "vitest";
import {
  排序消息视频自动播候选,
  选择消息视频自动播Owner,
  选择消息视频自动播连续Owner候选,
  type 消息视频自动播候选,
} from "../媒体/消息视频自动播编排";

describe("消息视频自动播编排", () => {
  it("多个视频同时进入视口时，只会选离视口中心最近的那个作为自动播 owner", () => {
    const candidates: 消息视频自动播候选[] = [
      {
        attachmentId: "att-video-top",
        visibilityRatio: 0.82,
        distanceToViewportCenter: 96,
      },
      {
        attachmentId: "att-video-center",
        visibilityRatio: 0.76,
        distanceToViewportCenter: 12,
      },
      {
        attachmentId: "att-video-bottom",
        visibilityRatio: 0.91,
        distanceToViewportCenter: 84,
      },
    ];

    expect(选择消息视频自动播Owner(candidates)).toBe("att-video-center");
  });

  it("候选预热复用同一套排序，不能被 DOM 顺序带偏", () => {
    const candidates: 消息视频自动播候选[] = [
      {
        attachmentId: "att-video-dom-first",
        visibilityRatio: 0.9,
        distanceToViewportCenter: 120,
      },
      {
        attachmentId: "att-video-center",
        visibilityRatio: 0.82,
        distanceToViewportCenter: 10,
      },
      {
        attachmentId: "att-video-near",
        visibilityRatio: 0.86,
        distanceToViewportCenter: 24,
      },
    ];

    expect(排序消息视频自动播候选(candidates).map((candidate) => candidate.attachmentId)).toEqual([
      "att-video-center",
      "att-video-near",
      "att-video-dom-first",
    ]);
  });

  it("连续性阈值以下时，不会选出自动播 owner", () => {
    const candidates: 消息视频自动播候选[] = [
      {
        attachmentId: "att-video-low",
        visibilityRatio: 0.24,
        distanceToViewportCenter: 4,
      },
    ];

    expect(选择消息视频自动播Owner(candidates)).toBeNull();
  });

  it("高竖视频交接落入 0.6 死区时，也必须继续裁决出连续 owner 候选而不是返回 null", () => {
    const candidates: 消息视频自动播候选[] = [
      {
        attachmentId: "att-video-old",
        visibilityRatio: 0.437,
        distanceToViewportCenter: 319.4,
      },
      {
        attachmentId: "att-video-new",
        visibilityRatio: 0.506,
        distanceToViewportCenter: 280.6,
      },
    ];

    /**
     * 真实房间里的高竖视频交接区会天然出现“两边都低于 0.6”的窗口。
     * 这里如果返回 null，runtime 就会把 owner 清空，消息窗随即撤掉 canonical host，
     * 用户肉眼看到的就是“闪一下、抽一下、再接着播”。
     */
    expect(选择消息视频自动播Owner(candidates)).toBeNull();
    expect(选择消息视频自动播连续Owner候选(candidates)).toBe("att-video-new");
  });

  it("当前 owner 仍在可见阈值内时，会保持粘性而不是在相邻视频间来回切换", () => {
    const candidates: 消息视频自动播候选[] = [
      {
        attachmentId: "att-video-current",
        visibilityRatio: 0.78,
        distanceToViewportCenter: 28,
      },
      {
        attachmentId: "att-video-new",
        visibilityRatio: 0.92,
        distanceToViewportCenter: 12,
      },
    ];

    expect(选择消息视频自动播Owner(candidates, undefined, "att-video-current")).toBe(
      "att-video-current"
    );
  });

  it("有完整可见视频时，会优先在完整可见集合里裁决 owner，而不是继续让半屏候选抢走焦点", () => {
    const candidates: 消息视频自动播候选[] = [
      {
        attachmentId: "att-video-partial-near-center",
        visibilityRatio: 0.72,
        distanceToViewportCenter: 8,
      },
      {
        attachmentId: "att-video-fully-visible",
        visibilityRatio: 1,
        distanceToViewportCenter: 54,
      },
    ];

    expect(选择消息视频自动播Owner(candidates)).toBe("att-video-fully-visible");
  });

  it("当前 owner 只有半屏可见而新视频已完整进入视口时，会把 owner 切给完整可见的新视频", () => {
    const candidates: 消息视频自动播候选[] = [
      {
        attachmentId: "att-video-current",
        visibilityRatio: 0.69,
        distanceToViewportCenter: 18,
      },
      {
        attachmentId: "att-video-fully-visible",
        visibilityRatio: 1,
        distanceToViewportCenter: 44,
      },
    ];

    expect(选择消息视频自动播Owner(candidates, undefined, "att-video-current")).toBe(
      "att-video-fully-visible"
    );
  });
});
