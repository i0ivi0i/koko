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
});
