import { describe, expect, it } from "vitest";
import { 创建房间视口Actor } from "../房间视口运行时";

describe("房间视口运行时", () => {
  it("程序补偿滚动期间，顶部触发不会被误判成用户请求加载历史", () => {
    const actor = 创建房间视口Actor();

    actor.send({
      type: "SNAPSHOT_BASELINE_SYNCED",
      firstUnreadEventPosition: null,
    });
    actor.send({
      type: "INITIAL_UNREAD_SETTLED",
      firstUnreadEventPosition: null,
    });
    actor.send({ type: "USER_SCROLL_INTENT_STARTED" });
    actor.send({
      type: "PROGRAMMATIC_SCROLL_STARTED",
      reason: "compensate_history",
    });
    actor.send({
      type: "SCROLL_OBSERVED",
      candidateReadAnchorPosition: 12,
      isNearBottom: false,
      reachedTop: true,
      canLoadHistory: true,
      now: 1_000,
    });

    expect(actor.snapshot()).toMatchObject({
      scrollPhase: "compensating_history",
      shouldLoadHistory: false,
      candidateReadAnchorPosition: null,
    });
  });

  it("只有用户真实滚动意图成立后，候选已读锚点才允许推进", () => {
    const actor = 创建房间视口Actor();

    actor.send({
      type: "SNAPSHOT_BASELINE_SYNCED",
      firstUnreadEventPosition: null,
    });
    actor.send({
      type: "INITIAL_UNREAD_SETTLED",
      firstUnreadEventPosition: null,
    });
    actor.send({
      type: "SCROLL_OBSERVED",
      candidateReadAnchorPosition: 8,
      isNearBottom: false,
      reachedTop: false,
      canLoadHistory: false,
      now: 1_200,
    });
    expect(actor.snapshot().candidateReadAnchorPosition).toBeNull();

    actor.send({ type: "USER_SCROLL_INTENT_STARTED" });
    actor.send({
      type: "SCROLL_OBSERVED",
      candidateReadAnchorPosition: 8,
      isNearBottom: false,
      reachedTop: false,
      canLoadHistory: false,
      now: 1_300,
    });

    expect(actor.snapshot().candidateReadAnchorPosition).toBe(8);
  });

  it("跳到最新会切回贴底跟随，并清空未读新增标志", () => {
    const actor = 创建房间视口Actor();

    actor.send({
      type: "SNAPSHOT_BASELINE_SYNCED",
      firstUnreadEventPosition: 5,
    });
    actor.send({
      type: "INITIAL_UNREAD_SETTLED",
      firstUnreadEventPosition: 5,
    });
    actor.send({ type: "AUTHORITATIVE_EVENTS_APPENDED" });
    expect(actor.snapshot()).toMatchObject({
      viewportMode: "围绕未读阅读",
      hasUnreadNewerMessages: true,
    });

    actor.send({ type: "JUMP_TO_LATEST_REQUESTED" });

    expect(actor.snapshot()).toMatchObject({
      viewportMode: "贴底跟随",
      hasUnreadNewerMessages: false,
    });
  });

  it("首屏围绕未读恢复完成前，不允许把 DOM 观测直接当成已读提交真相", () => {
    const actor = 创建房间视口Actor();

    actor.send({
      type: "SNAPSHOT_BASELINE_SYNCED",
      firstUnreadEventPosition: 5,
    });
    actor.send({
      type: "SCROLL_OBSERVED",
      candidateReadAnchorPosition: 6,
      isNearBottom: false,
      reachedTop: false,
      canLoadHistory: false,
      now: 2_000,
    });

    expect(actor.snapshot()).toMatchObject({
      initialUnreadSettled: false,
      scrollPhase: "restoring_unread",
      candidateReadAnchorPosition: null,
    });
  });
});
