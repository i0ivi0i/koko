// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import {
  创建单视频消息项,
  创建媒体消息窗,
  创建媒体消息项,
} from "../common/房间消息窗媒体支架";

type 自动播候选测试项 = {
  attachmentId: string;
  visibilityRatio: number;
  distanceToViewportCenter: number;
};

type 自动播候选观察Owner测试接口 = {
  自动播候选观察器: IntersectionObserver | null;
  自动播候选可见条目: Map<string, 自动播候选测试项>;
};

const 读取自动播候选观察Owner = (pane: 房间消息窗): 自动播候选观察Owner测试接口 =>
  (
    pane as unknown as {
      自动播候选观察Owner: 自动播候选观察Owner测试接口;
    }
  ).自动播候选观察Owner;

describe("房间消息窗媒体查看器 - 高速换窗与预算", () => {
  it("近距离交接时，虚拟范围会额外 pin 当前 owner 与 hidden handoff 所在消息行", () => {
    const pane = 创建媒体消息窗();
    pane.items = Array.from({ length: 12 }, (_, index) =>
      创建单视频消息项(`att-pin-${index + 1}`, index + 1)
    );
    pane.inlineAutoplayOwnerAttachmentId = "att-pin-2";
    (
      pane as unknown as {
        时间线隐藏接管附件Id: string | null;
      }
    ).时间线隐藏接管附件Id = "att-pin-7";

    const indexes = (
      pane as unknown as {
        提取消息虚拟范围(range: {
          startIndex: number;
          endIndex: number;
          overscan: number;
          count: number;
        }): number[];
      }
    ).提取消息虚拟范围({
      startIndex: 4,
      endIndex: 8,
      overscan: 0,
      count: pane.items.length,
    });

    expect(indexes).toContain(1);
    expect(indexes).toContain(6);
  });

  it("远距离跳转时，不会继续 pin 已离开视口很远的旧 owner 行", () => {
    const pane = 创建媒体消息窗();
    pane.items = Array.from({ length: 24 }, (_, index) =>
      创建单视频消息项(`att-far-pin-${index + 1}`, index + 1)
    );
    pane.inlineAutoplayOwnerAttachmentId = "att-far-pin-2";
    (
      pane as unknown as {
        最近退场Owner附件Id: string | null;
      }
    ).最近退场Owner附件Id = "att-far-pin-2";

    const indexes = (
      pane as unknown as {
        提取消息虚拟范围(range: {
          startIndex: number;
          endIndex: number;
          overscan: number;
          count: number;
        }): number[];
      }
    ).提取消息虚拟范围({
      startIndex: 16,
      endIndex: 20,
      overscan: 0,
      count: pane.items.length,
    });

    expect(indexes).not.toContain(1);
  });

  it("近视口预算收紧后，非 owner 历史视频最多只保留两颗真实 preview video", async () => {
    const pane = 创建媒体消息窗();
    const attachmentIds = Array.from({ length: 8 }, (_, index) => `att-budget-${index + 1}`);
    pane.items = attachmentIds.map((attachmentId, index) =>
      创建单视频消息项(attachmentId, index + 1)
    );
    pane.mediaPlaybackByAttachmentId = Object.fromEntries(
      attachmentIds.map((attachmentId) => [
        attachmentId,
        {
          mode: "swarm",
          attachmentId,
          kind: "video",
          src: `blob:http://media.local/swarm-${attachmentId}`,
          thumbnailUrl: `http://media.local/poster-${attachmentId}`,
          hint: null,
        } satisfies 媒体播放结果,
      ])
    );
    pane.mediaPreviewByAttachmentId = Object.fromEntries(
      attachmentIds.map((attachmentId) => [
        attachmentId,
        {
          phase: "ready",
          src: `blob:http://media.local/preview-${attachmentId}`,
          source: "cache" as const,
        },
      ])
    );

    document.body.appendChild(pane);
    await pane.updateComplete;

    expect(
      pane.querySelectorAll('video.message-video-preview:not([data-canonical-player="true"])')
    ).toHaveLength(2);

    pane.remove();
  });

  it("高速换窗时，已经出帧的同源 WebTorrent preview 即使暂时跌出预算也不能回退 poster", async () => {
    const pane = 创建媒体消息窗();
    const attachmentIds = Array.from(
      { length: 8 },
      (_, index) => `att-fast-scroll-${index + 1}`
    );
    const createItems = (ids: string[]) =>
      ids.map((attachmentId, index) => 创建单视频消息项(attachmentId, index + 1));
    pane.items = createItems(attachmentIds);
    pane.mediaPlaybackByAttachmentId = Object.fromEntries(
      attachmentIds.map((attachmentId) => [
        attachmentId,
        {
          mode: "swarm",
          attachmentId,
          kind: "video",
          src: `/webtorrent/hash-${attachmentId}/content-${attachmentId}.mp4`,
          thumbnailUrl: `http://media.local/poster-${attachmentId}`,
          hint: null,
        } satisfies 媒体播放结果,
      ])
    );

    document.body.appendChild(pane);
    await pane.updateComplete;

    const targetId = attachmentIds[0]!;
    const existingPreview = pane.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${targetId}"]:not([data-canonical-player="true"])`
    );
    expect(existingPreview).not.toBeNull();
    existingPreview!.currentTime = 6.25;
    Object.defineProperty(existingPreview!, "readyState", {
      configurable: true,
      value: 4,
    });

    const 自动播观察Owner = 读取自动播候选观察Owner(pane);
    自动播观察Owner.自动播候选可见条目.clear();
    for (const [index, attachmentId] of attachmentIds.slice(1, 7).entries()) {
      自动播观察Owner.自动播候选可见条目.set(attachmentId, {
        attachmentId,
        visibilityRatio: 1,
        distanceToViewportCenter: index,
      });
    }
    /**
     * 模拟高速滚动的一拍：DOM 上仍有这张卡片和同源 `<video>`，
     * 但 IntersectionObserver/预算排序先被另一组近视口候选占满。
     */
    pane.requestUpdate();
    await pane.updateComplete;

    const videoCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${targetId}"]`
    );
    const preservedPreview = videoCard?.querySelector<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );
    expect(videoCard).not.toBeNull();
    expect(preservedPreview).toBe(existingPreview);
    expect(preservedPreview?.currentTime).toBeCloseTo(6.25, 2);
    /* poster 有封面就永远渲染（z:0），已出帧 video (z:1) 自然遮住 */
    expect(videoCard?.querySelector(".message-video-poster")).not.toBeNull();
    expect(videoCard?.querySelector(".message-video-play-indicator")).toBeNull();

    pane.remove();
  });

  it("高速换窗时只有 currentTime 但 DOM 未持有当前帧，不能裸露成黑色 preview", async () => {
    const pane = 创建媒体消息窗();
    const attachmentIds = Array.from(
      { length: 8 },
      (_, index) => `att-fast-metadata-only-${index + 1}`
    );
    pane.items = attachmentIds.map((attachmentId, index) =>
      创建单视频消息项(attachmentId, index + 1)
    );
    pane.mediaPlaybackByAttachmentId = Object.fromEntries(
      attachmentIds.map((attachmentId) => [
        attachmentId,
        {
          mode: "swarm",
          attachmentId,
          kind: "video",
          src: `/webtorrent/hash-${attachmentId}/content-${attachmentId}.mp4`,
          thumbnailUrl: `http://media.local/poster-${attachmentId}`,
          hint: null,
        } satisfies 媒体播放结果,
      ])
    );

    document.body.appendChild(pane);
    await pane.updateComplete;

    const targetId = attachmentIds[0]!;
    const existingPreview = pane.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${targetId}"]:not([data-canonical-player="true"])`
    );
    expect(existingPreview).not.toBeNull();
    existingPreview!.currentTime = 6.25;
    Object.defineProperty(existingPreview!, "readyState", {
      configurable: true,
      value: 1,
    });

    const 自动播观察Owner = 读取自动播候选观察Owner(pane);
    自动播观察Owner.自动播候选可见条目.clear();
    for (const [index, attachmentId] of attachmentIds.slice(1, 7).entries()) {
      自动播观察Owner.自动播候选可见条目.set(attachmentId, {
        attachmentId,
        visibilityRatio: 1,
        distanceToViewportCenter: index,
      });
    }
    pane.requestUpdate();
    await pane.updateComplete;

    const videoCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${targetId}"]`
    );
    const preservedPreview = videoCard?.querySelector<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );
    if (preservedPreview) {
      expect(preservedPreview.getAttribute("poster")).toBe(
        `http://media.local/poster-${targetId}`
      );
    }
    expect(
      videoCard?.querySelector<HTMLImageElement>(".message-video-poster")?.getAttribute("src")
    ).toBe(`http://media.local/poster-${targetId}`);

    pane.remove();
  });

  it("高速回滑时，已保存的同源 WebTorrent 播放位置不应闪回 poster", async () => {
    const pane = 创建媒体消息窗();
    const attachmentIds = Array.from(
      { length: 8 },
      (_, index) => `att-fast-return-${index + 1}`
    );
    pane.items = attachmentIds.map((attachmentId, index) =>
      创建单视频消息项(attachmentId, index + 1)
    );
    pane.mediaPlaybackByAttachmentId = Object.fromEntries(
      attachmentIds.map((attachmentId) => [
        attachmentId,
        {
          mode: "swarm",
          attachmentId,
          kind: "video",
          src: `/webtorrent/hash-${attachmentId}/content-${attachmentId}.mp4`,
          thumbnailUrl: `http://media.local/poster-${attachmentId}`,
          hint: null,
        } satisfies 媒体播放结果,
      ])
    );
    const targetId = attachmentIds[0]!;
    pane.inlineAutoplayOwnerAttachmentId = attachmentIds[7]!;
    pane.inlineAutoplayPositionByAttachmentId = {
      [targetId]: {
        src: `/webtorrent/hash-${targetId}/content-${targetId}.mp4`,
        currentTime: 19.5,
        updatedAt: 1_777_400_000_000,
      },
    };
    const 自动播观察Owner = 读取自动播候选观察Owner(pane);
    for (const [index, attachmentId] of attachmentIds.slice(1, 7).entries()) {
      自动播观察Owner.自动播候选可见条目.set(attachmentId, {
        attachmentId,
        visibilityRatio: 1,
        distanceToViewportCenter: index,
      });
    }

    document.body.appendChild(pane);
    await pane.updateComplete;

    const videoCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${targetId}"]`
    );
    const restoredPreview = videoCard?.querySelector<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );
    expect(videoCard).not.toBeNull();
    expect(restoredPreview).not.toBeNull();
    expect(restoredPreview?.getAttribute("src")).toBe(
      `/webtorrent/hash-${targetId}/content-${targetId}.mp4`
    );
    restoredPreview?.dispatchEvent(new Event("loadedmetadata"));
    expect(restoredPreview?.currentTime).toBeCloseTo(19.5, 2);
    /* poster 有封面就永远渲染（z:0），不再被意图压制 */
    expect(videoCard?.querySelector(".message-video-poster")).not.toBeNull();
    expect(restoredPreview?.getAttribute("poster")).toBe(`http://media.local/poster-${targetId}`);
    expect(videoCard?.querySelector(".message-video-play-indicator")).toBeNull();
    Object.defineProperty(restoredPreview!, "readyState", {
      configurable: true,
      value: 4,
    });
    restoredPreview!.dispatchEvent(new Event("loadeddata"));
    await pane.updateComplete;
    /* 出帧后 poster 仍在 DOM — z:1 video 遮住 z:0 poster */
    expect(videoCard?.querySelector(".message-video-poster")).not.toBeNull();
    expect(videoCard?.querySelector(".message-video-play-indicator")).toBeNull();

    pane.remove();
  });

  it("高速虚拟卸载后回到已出首帧视频时，应复用首帧缓存而不是闪回 poster", async () => {
    const pane = 创建媒体消息窗();
    const targetId = "att-fast-remount-1";
    const otherIds = Array.from(
      { length: 7 },
      (_, index) => `att-fast-remount-other-${index + 1}`
    );
    const allIds = [targetId, ...otherIds];
    const createItems = (ids: string[]) =>
      ids.map((attachmentId, index) => 创建单视频消息项(attachmentId, index + 1));
    pane.items = createItems(allIds);
    pane.mediaPlaybackByAttachmentId = Object.fromEntries(
      allIds.map((attachmentId) => [
        attachmentId,
        {
          mode: "swarm",
          attachmentId,
          kind: "video",
          src: `/webtorrent/hash-${attachmentId}/content-${attachmentId}.mp4`,
          thumbnailUrl: `http://media.local/poster-${attachmentId}`,
          hint: null,
        } satisfies 媒体播放结果,
      ])
    );

    document.body.appendChild(pane);
    await pane.updateComplete;

    type 测试虚拟项 = { key: string; index: number; start: number };
    const 创建虚拟项 = (indexes: number[]): 测试虚拟项[] =>
      indexes.map((index) => ({
        key: `m-${allIds[index]}`,
        index,
        start: index * 240,
      }));
    const 内部虚拟器 = (
      pane as unknown as {
        读取消息虚拟器(): { getVirtualItems(): 测试虚拟项[] };
      }
    ).读取消息虚拟器();
    const 读取虚拟项 = vi.spyOn(内部虚拟器, "getVirtualItems");

    const firstPreview = pane.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${targetId}"]:not([data-canonical-player="true"])`
    );
    expect(firstPreview).not.toBeNull();
    Object.defineProperty(firstPreview!, "currentSrc", {
      configurable: true,
      value: `/webtorrent/hash-${targetId}/content-${targetId}.mp4`,
    });
    firstPreview!.dispatchEvent(new Event("loadeddata"));

    读取虚拟项.mockReturnValue(创建虚拟项([1, 2, 3, 4, 5, 6, 7]));
    pane.jumpToLatestLabel = "虚拟卸载";
    await pane.updateComplete;
    expect(
      pane.querySelector(
        `.message-video-card[data-attachment-id="${targetId}"]`
      )
    ).toBeNull();

    const 自动播观察Owner = 读取自动播候选观察Owner(pane);
    自动播观察Owner.自动播候选可见条目.clear();
    for (const [index, attachmentId] of otherIds.slice(0, 6).entries()) {
      自动播观察Owner.自动播候选可见条目.set(attachmentId, {
        attachmentId,
        visibilityRatio: 1,
        distanceToViewportCenter: index,
      });
    }
    读取虚拟项.mockReturnValue(创建虚拟项([0, 1, 2, 3, 4, 5, 6, 7]));
    pane.jumpToLatestLabel = "虚拟回滑";
    await pane.updateComplete;

    const videoCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${targetId}"]`
    );
    const restoredPreview = videoCard?.querySelector<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );
    expect(videoCard).not.toBeNull();
    expect(restoredPreview).not.toBeNull();
    expect(restoredPreview?.getAttribute("src")).toBe(
      `/webtorrent/hash-${targetId}/content-${targetId}.mp4`
    );
    expect(
      videoCard?.querySelector<HTMLImageElement>(".message-video-poster")?.getAttribute("src")
    ).toBe(`http://media.local/poster-${targetId}`);
    Object.defineProperty(restoredPreview!, "readyState", {
      configurable: true,
      value: 4,
    });
    restoredPreview!.dispatchEvent(new Event("loadeddata"));
    await pane.updateComplete;
    expect(videoCard?.querySelector(".message-video-poster")).not.toBeNull();
    expect(videoCard?.querySelector(".message-video-play-indicator")).toBeNull();

    pane.remove();
  });

  it("高速回滑遇到编排冷快照时，源级首帧缓存不能重挂真实 preview video", async () => {
    const pane = 创建媒体消息窗();
    const targetId = "att-fast-cold-budget-1";
    const otherIds = Array.from(
      { length: 7 },
      (_, index) => `att-fast-cold-budget-other-${index + 1}`
    );
    const allIds = [targetId, ...otherIds];
    const createItems = (ids: string[]) =>
      ids.map((attachmentId, index) => 创建单视频消息项(attachmentId, index + 1));
    const targetSrc = `/webtorrent/hash-${targetId}/content-${targetId}.mp4`;
    pane.items = createItems(allIds);
    pane.mediaPlaybackByAttachmentId = {
      [targetId]: {
        mode: "swarm",
        attachmentId: targetId,
        kind: "video",
        src: targetSrc,
        thumbnailUrl: `http://media.local/poster-${targetId}`,
        hint: null,
      } satisfies 媒体播放结果,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    type 测试虚拟项 = { key: string; index: number; start: number };
    const 创建虚拟项 = (indexes: number[]): 测试虚拟项[] =>
      indexes.map((index) => ({
        key: `m-${allIds[index]}`,
        index,
        start: index * 240,
      }));
    const 内部虚拟器 = (
      pane as unknown as {
        读取消息虚拟器(): { getVirtualItems(): 测试虚拟项[] };
      }
    ).读取消息虚拟器();
    const 读取虚拟项 = vi.spyOn(内部虚拟器, "getVirtualItems");

    const firstPreview = pane.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${targetId}"]:not([data-canonical-player="true"])`
    );
    expect(firstPreview).not.toBeNull();
    Object.defineProperty(firstPreview!, "currentSrc", {
      configurable: true,
      value: targetSrc,
    });
    firstPreview!.dispatchEvent(new Event("loadeddata"));

    读取虚拟项.mockReturnValue(创建虚拟项([1, 2, 3, 4, 5, 6, 7]));
    pane.jumpToLatestLabel = "冷快照虚拟卸载";
    await pane.updateComplete;

    (pane as unknown as {
      mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;
      mediaVideoBudgetByAttachmentId: Record<string, unknown>;
    }).mediaPlaybackByAttachmentId = {};
    (pane as unknown as {
      mediaVideoBudgetByAttachmentId: Record<string, unknown>;
    }).mediaVideoBudgetByAttachmentId = {
      [targetId]: {
        attachmentId: targetId,
        tier: "cold_expression",
        reason: "inactive",
        canonicalVideoSrc: null,
        previewVideoSrc: null,
        allowInlineCanonical: false,
        allowPreviewVideo: false,
        formalByteSource: "none",
      },
    };
    const 自动播观察Owner = 读取自动播候选观察Owner(pane);
    自动播观察Owner.自动播候选可见条目.clear();
    for (const [index, attachmentId] of otherIds.slice(0, 6).entries()) {
      自动播观察Owner.自动播候选可见条目.set(attachmentId, {
        attachmentId,
        visibilityRatio: 1,
        distanceToViewportCenter: index,
      });
    }
    读取虚拟项.mockReturnValue(创建虚拟项([0, 1, 2, 3, 4, 5, 6, 7]));
    pane.jumpToLatestLabel = "冷快照高速回滑";
    await pane.updateComplete;

    const videoCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${targetId}"]`
    );
    const restoredPreview = videoCard?.querySelector<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );
    expect(videoCard?.dataset.budgetTier).toBe("cold_expression");
    expect(videoCard?.dataset.formalByteSource).toBe("none");
    expect(restoredPreview).toBeNull();
    expect(
      videoCard?.querySelector<HTMLImageElement>(".message-video-poster")?.getAttribute("src")
    ).toBe(`http://media.local/poster-${targetId}`);

    pane.remove();
  });

  it("高速回滑只有源级首帧缓存但当前 DOM 未出帧时，不能裸露黑色 preview", async () => {
    const pane = 创建媒体消息窗();
    const targetId = "att-fast-remount-black-guard-1";
    const otherIds = Array.from(
      { length: 7 },
      (_, index) => `att-fast-remount-black-guard-other-${index + 1}`
    );
    const allIds = [targetId, ...otherIds];
    const targetSrc = `/webtorrent/hash-${targetId}/content-${targetId}.mp4`;
    const targetPoster = `http://media.local/poster-${targetId}`;
    pane.items = allIds.map((attachmentId, index) =>
      创建单视频消息项(attachmentId, index + 1)
    );
    pane.mediaPlaybackByAttachmentId = Object.fromEntries(
      allIds.map((attachmentId) => [
        attachmentId,
        {
          mode: "swarm",
          attachmentId,
          kind: "video",
          src: `/webtorrent/hash-${attachmentId}/content-${attachmentId}.mp4`,
          thumbnailUrl: `http://media.local/poster-${attachmentId}`,
          hint: null,
        } satisfies 媒体播放结果,
      ])
    );

    document.body.appendChild(pane);
    await pane.updateComplete;

    type 测试虚拟项 = { key: string; index: number; start: number };
    const 创建虚拟项 = (indexes: number[]): 测试虚拟项[] =>
      indexes.map((index) => ({
        key: `m-${allIds[index]}`,
        index,
        start: index * 240,
      }));
    const 内部虚拟器 = (
      pane as unknown as {
        读取消息虚拟器(): { getVirtualItems(): 测试虚拟项[] };
      }
    ).读取消息虚拟器();
    const 读取虚拟项 = vi.spyOn(内部虚拟器, "getVirtualItems");

    const firstPreview = pane.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${targetId}"]:not([data-canonical-player="true"])`
    );
    expect(firstPreview).not.toBeNull();
    Object.defineProperty(firstPreview!, "currentSrc", {
      configurable: true,
      value: targetSrc,
    });
    firstPreview!.dispatchEvent(new Event("loadeddata"));

    读取虚拟项.mockReturnValue(创建虚拟项([1, 2, 3, 4, 5, 6, 7]));
    pane.jumpToLatestLabel = "黑底测试虚拟卸载";
    await pane.updateComplete;

    const 自动播观察Owner = 读取自动播候选观察Owner(pane);
    自动播观察Owner.自动播候选可见条目.clear();
    for (const [index, attachmentId] of otherIds.slice(0, 6).entries()) {
      自动播观察Owner.自动播候选可见条目.set(attachmentId, {
        attachmentId,
        visibilityRatio: 1,
        distanceToViewportCenter: index,
      });
    }
    读取虚拟项.mockReturnValue(创建虚拟项([0, 1, 2, 3, 4, 5, 6, 7]));
    pane.jumpToLatestLabel = "黑底测试高速回滑";
    await pane.updateComplete;

    const videoCard = pane.querySelector<HTMLElement>(
      `.message-video-card[data-attachment-id="${targetId}"]`
    );
    const remountedPreview = videoCard?.querySelector<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );
    expect(remountedPreview).not.toBeNull();
    expect(remountedPreview?.readyState).toBe(0);
    expect(remountedPreview?.getAttribute("poster")).toBe(targetPoster);
    expect(
      videoCard?.querySelector<HTMLImageElement>(".message-video-poster")?.getAttribute("src")
    ).toBe(targetPoster);
    expect(videoCard?.querySelector(".message-video-play-indicator")).toBeNull();

    Object.defineProperty(remountedPreview!, "readyState", {
      configurable: true,
      value: 4,
    });
    remountedPreview!.dispatchEvent(new Event("loadeddata"));
    await pane.updateComplete;
    /* 出帧后 poster 仍在 DOM — z:1 video 遮住 z:0 poster */
    expect(videoCard?.querySelector(".message-video-poster")).not.toBeNull();
    expect(remountedPreview?.getAttribute("poster")).toBeNull();

    pane.remove();
  });

  it("首帧虚拟列表尚未就绪时，不会一次把三十多条历史视频都塞进 DOM", async () => {
    const pane = 创建媒体消息窗();
    pane.items = Array.from({ length: 40 }, (_, index) =>
      创建单视频消息项(`att-first-frame-${index + 1}`, index + 1)
    );

    document.body.appendChild(pane);
    await pane.updateComplete;

    expect(pane.querySelectorAll("button.message-video-preview-trigger").length).toBeLessThanOrEqual(12);

    pane.remove();
  });

  it("房间首轮更新时，自动播候选也会先做视频预算裁剪，再回抛给外层编排", async () => {
    const pane = 创建媒体消息窗();
    const 内部面板 = pane as unknown as {
      自动播候选观察Owner: 自动播候选观察Owner测试接口 & {
        读取自动播候选(scrollContainer: HTMLElement): Array<自动播候选测试项>;
      };
    };
    内部面板.自动播候选观察Owner.自动播候选观察器 = {} as IntersectionObserver;
    内部面板.自动播候选观察Owner.自动播候选可见条目 = new Map(
      Array.from({ length: 16 }, (_, index) => [
        `att-autoplay-budget-${index + 1}`,
        {
          attachmentId: `att-autoplay-budget-${index + 1}`,
          visibilityRatio: 1,
          distanceToViewportCenter: index * 10,
        },
      ])
    );

    const candidates = 内部面板.自动播候选观察Owner.读取自动播候选(
      document.createElement("div")
    );

    expect(candidates).toHaveLength(12);
    expect(candidates.map((candidate) => candidate.attachmentId)).toEqual(
      Array.from({ length: 12 }, (_, index) => `att-autoplay-budget-${index + 1}`)
    );
  });

  it("房间媒体窗口观察事件会先做活媒体预算裁剪，再把附件集合回抛给外层", async () => {
    const pane = 创建媒体消息窗();
    const 观察记录: string[][] = [];
    pane.addEventListener("room-media-window-observed", (event) => {
      观察记录.push((event as CustomEvent<{ attachmentIds: string[] }>).detail.attachmentIds);
    });
    pane.items = Array.from({ length: 20 }, (_, index) => ({
      ...创建媒体消息项(),
      id: `m-window-budget-${index + 1}`,
      eventPosition: index + 1,
      attachments: [
        {
          kind: "image" as const,
          attachmentId: `att-image-window-budget-${index + 1}`,
          width: 1200,
          height: 800,
      layoutX: 0,
      layoutY: 0,
          displayWidth: 320,
          displayHeight: 213,
        },
        {
          kind: "video" as const,
          attachmentId: `att-video-window-budget-${index + 1}`,
          width: 1280,
          height: 720,
      layoutX: 0,
      layoutY: 0,
          displayWidth: 320,
          displayHeight: 180,
          posterSrc: `http://media.local/poster-video-window-budget-${index + 1}`,
        },
      ],
    }));

    document.body.appendChild(pane);
    await pane.updateComplete;

    const 最新附件集合 = 观察记录.at(-1) ?? [];
    const 视频附件前缀 = "att-video-window-budget-";
    expect(最新附件集合.length).toBeLessThanOrEqual(24);
    expect(
      最新附件集合.filter((attachmentId) => attachmentId.startsWith(视频附件前缀)).length
    ).toBeLessThanOrEqual(12);

    pane.remove();
  });

  it("虚拟列表纯 range 更新也会刷新媒体窗口观察，避免运行时沿用旧预算清空自动播 owner", async () => {
    const pane = 创建媒体消息窗();
    const 观察记录: string[][] = [];
    pane.addEventListener("room-media-window-observed", (event) => {
      观察记录.push((event as CustomEvent<{ attachmentIds: string[] }>).detail.attachmentIds);
    });
    pane.items = Array.from({ length: 8 }, (_, index) => ({
      ...创建媒体消息项(),
      id: `m-window-range-${index + 1}`,
      eventPosition: index + 1,
      attachments: [
        {
          kind: "video" as const,
          attachmentId: `att-video-window-range-${index + 1}`,
          width: 1280,
          height: 720,
      layoutX: 0,
      layoutY: 0,
          displayWidth: 320,
          displayHeight: 180,
          posterSrc: `http://media.local/poster-video-window-range-${index + 1}`,
        },
      ],
    }));

    type 测试虚拟项 = { key: string; index: number; start: number };
    const 创建虚拟项 = (indexes: number[]): 测试虚拟项[] =>
      indexes.map((index) => ({
        key: `m-window-range-${index + 1}`,
        index,
        start: index * 240,
      }));
    const 内部虚拟器 = (
      pane as unknown as {
        读取消息虚拟器(): { getVirtualItems(): 测试虚拟项[] };
      }
    ).读取消息虚拟器();
    const 读取虚拟项 = vi.spyOn(内部虚拟器, "getVirtualItems");
    读取虚拟项.mockReturnValue(创建虚拟项([0, 1]));

    document.body.appendChild(pane);
    await pane.updateComplete;
    const 初始观察次数 = 观察记录.length;
    expect(观察记录.at(-1)).toEqual([
      "att-video-window-range-1",
      "att-video-window-range-2",
    ]);

    pane.requestUpdate();
    await pane.updateComplete;
    expect(观察记录.length).toBe(初始观察次数);

    读取虚拟项.mockReturnValue(创建虚拟项([4, 5]));
    pane.requestUpdate();
    await pane.updateComplete;

    expect(观察记录.length).toBeGreaterThan(初始观察次数);
    expect(观察记录.at(-1)).toEqual([
      "att-video-window-range-5",
      "att-video-window-range-6",
    ]);

    pane.remove();
  });
});
