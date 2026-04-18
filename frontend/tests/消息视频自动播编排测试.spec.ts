import { describe, expect, it } from "vitest";
import {
  选择消息视频自动播Owner,
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

  it("可见比例不到阈值时，不会选出自动播 owner", () => {
    const candidates: 消息视频自动播候选[] = [
      {
        attachmentId: "att-video-low",
        visibilityRatio: 0.59,
        distanceToViewportCenter: 4,
      },
    ];

    expect(选择消息视频自动播Owner(candidates)).toBeNull();
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
