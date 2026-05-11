import { describe, expect, it, vi } from "vitest";
import {
  媒体窗口观察Owner,
  读取当前媒体窗口附件标识,
} from "../../房间消息窗/媒体窗口";

const 创建消息项 = (attachments: Array<{ attachmentId: string; kind: "image" | "video" }>) =>
  ({
    kind: "message",
    attachments,
  }) as never;

describe("房间消息窗媒体窗口Owner", () => {
  it("按 owner、刚退场 owner、自动播候选、虚拟窗口顺序裁剪近视口附件", () => {
    const attachmentIds = 读取当前媒体窗口附件标识({
      inlineAutoplayOwnerAttachmentId: "video-owner",
      最近退场Owner附件Id: "video-released",
      自动播候选可见条目: new Map([
        ["video-near", { distanceToViewportCenter: 10 }],
        ["video-far", { distanceToViewportCenter: 30 }],
      ]) as never,
      items: [
        创建消息项([
          { attachmentId: "img-1", kind: "image" },
          { attachmentId: "video-owner", kind: "video" },
          { attachmentId: "video-tail", kind: "video" },
        ]),
      ],
      virtualItems: [{ index: 0 }] as never,
    });

    expect(attachmentIds).toEqual([
      "video-owner",
      "video-released",
      "video-near",
      "video-far",
      "img-1",
      "video-tail",
    ]);
  });

  it("只在近视口附件集合变化时派发媒体窗口观察事件", () => {
    const 派发 = vi.fn();
    const owner = new 媒体窗口观察Owner(派发);
    const input = {
      inlineAutoplayOwnerAttachmentId: null,
      最近退场Owner附件Id: null,
      自动播候选可见条目: new Map(),
      items: [创建消息项([{ attachmentId: "img-1", kind: "image" }])],
      virtualItems: [{ index: 0 }] as never,
    };

    owner.dispatch媒体窗口观察(input);
    owner.dispatch媒体窗口观察(input);

    expect(派发).toHaveBeenCalledOnce();
    expect(派发).toHaveBeenCalledWith(["img-1"]);
  });
});
