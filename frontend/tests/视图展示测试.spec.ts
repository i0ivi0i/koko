// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { 消息事件, 附件快照, 图片附件快照, 视频附件快照 } from "../聊天共享/契约";
import { 默认消息文本布局环境, 派生消息展示项 } from "../房间消息窗/视图";
import { 安装测试文本测量画布 } from "./common/聊天测试支架";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

安装测试文本测量画布();

function 创建图片附件(
  attachmentId: string,
  width = 960,
  height = 720
): 图片附件快照 {
  return {
    kind: "image",
    attachment_id: attachmentId,
    width,
    height,
  };
}

function 创建视频附件(
  attachmentId: string,
  width = 1280,
  height = 720
): 视频附件快照 {
  return {
    kind: "video",
    attachment_id: attachmentId,
    width,
    height,
    has_preview_asset: false,
  };
}

function 创建消息事件(
  attachments: 附件快照[],
  overrides: Partial<消息事件> = {}
): 消息事件 {
  return {
    type: "message_created",
    room_id: "r-test",
    message_id: "m-test",
    client_message_id: "c-test",
    sender_session_id: "s-other",
    sender_display_alias: "冷静的水獭",
    text: "",
    attachments,
    event_position: 1,
    ...overrides,
  };
}

describe("视图 / 消息展示项派生", () => {
  it("展示 owner 直连生效，旧根门面已经删除", () => {
    const messagePaneViewSource = 读取前端源码("房间消息窗/视图.ts");
    const adminViewSource = 读取前端源码("后台/视图.ts");
    const shellSource = 读取前端源码("总装/聊天壳.ts");
    const messagePaneSource = 读取前端源码("房间消息窗/壳.ts");
    const attachmentRenderSource = 读取前端源码("房间消息窗/附件渲染.ts");
    const messageVirtualListSource = 读取前端源码("房间消息窗/消息虚拟列表.ts");
    const adminShellSource = 读取前端源码("后台/壳.ts");

    expect(existsSync(resolve(process.cwd(), "视图.ts"))).toBe(false);
    expect(messagePaneViewSource).toContain("export function 派生聊天列表展示项(");
    expect(messagePaneViewSource).toContain("export function 派生壳级操作台状态(");
    expect(adminViewSource).toContain("export function 格式化后台概览(");
    expect(adminViewSource).toContain("export function 格式化后台房间详情(");
    expect(shellSource).toContain('from "../房间消息窗/视图.js"');
    expect(shellSource).not.toContain('from "./视图.js"');
    expect(messagePaneSource).toContain('from "./视图.js"');
    expect(messagePaneSource).not.toContain('from "../视图.js"');
    expect(attachmentRenderSource).toContain('from "./视图.js"');
    expect(attachmentRenderSource).not.toContain('from "../视图.js"');
    expect(messageVirtualListSource).toContain('from "./视图.js"');
    expect(messageVirtualListSource).not.toContain('from "../视图.js"');
    expect(adminShellSource).toContain('from "./视图.js"');
    expect(adminShellSource).not.toContain('from "../视图.js"');
  });

  it("五个混合媒体附件会被派生成 hero-strip 拼贴，而不是继续退化成双列流式列表", () => {
    const item = 派生消息展示项(
      创建消息事件([
        创建图片附件("att-1", 960, 720),
        创建视频附件("att-2", 1280, 720),
        创建图片附件("att-3", 960, 720),
        创建视频附件("att-4", 1280, 720),
        创建图片附件("att-5", 960, 720),
      ]),
      "s-self",
      默认消息文本布局环境
    );

    expect(item.attachmentLayout).toEqual(
      expect.objectContaining({
        template: "hero-strip",
        columnCount: 2,
        contentWidth: item.bubbleWidth,
      })
    );

    expect(
      item.attachments.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        gridColumnStart: attachment.gridColumnStart,
        gridColumnSpan: attachment.gridColumnSpan,
        gridRowStart: attachment.gridRowStart,
        gridRowSpan: attachment.gridRowSpan,
      }))
    ).toEqual([
      {
        attachmentId: "att-1",
        gridColumnStart: 1,
        gridColumnSpan: 1,
        gridRowStart: 1,
        gridRowSpan: 2,
      },
      {
        attachmentId: "att-2",
        gridColumnStart: 2,
        gridColumnSpan: 1,
        gridRowStart: 1,
        gridRowSpan: 1,
      },
      {
        attachmentId: "att-3",
        gridColumnStart: 2,
        gridColumnSpan: 1,
        gridRowStart: 2,
        gridRowSpan: 1,
      },
      {
        attachmentId: "att-4",
        gridColumnStart: 1,
        gridColumnSpan: 1,
        gridRowStart: 3,
        gridRowSpan: 1,
      },
      {
        attachmentId: "att-5",
        gridColumnStart: 2,
        gridColumnSpan: 1,
        gridRowStart: 3,
        gridRowSpan: 1,
      },
    ]);

    /**
     * 这里锁的是“工整拼贴”的基本几何契约：
     * hero 卡片必须独占整行，底下四张卡片共用同一组两列单元格。
     * 只要这一层成立，Renderer 和 CSS 就能稳定消费同一份真相，
     * 不会再退回“所有多媒体都只会两列平铺”的旧路。
     */
    expect(item.attachments[0]?.displayHeight).toBeGreaterThan(
      (item.attachments[0]?.displayWidth ?? 0) * 1.8
    );
    expect(item.attachments[1]?.displayHeight).toBeGreaterThan(
      (item.attachments[1]?.displayWidth ?? 0) * 1.22
    );
    expect(item.attachments[1]?.displayWidth).toBe(item.attachments[2]?.displayWidth);
    expect(item.attachments[2]?.displayWidth).toBe(item.attachments[3]?.displayWidth);
    expect(item.attachments[3]?.displayWidth).toBe(item.attachments[4]?.displayWidth);
  });

  it("六个媒体附件会切换到三列拼贴模板，而不是永远锁死在旧的双列宽度公式里", () => {
    const item = 派生消息展示项(
      创建消息事件([
        创建图片附件("att-1"),
        创建视频附件("att-2"),
        创建图片附件("att-3"),
        创建视频附件("att-4"),
        创建图片附件("att-5"),
        创建视频附件("att-6"),
      ]),
      "s-self",
      默认消息文本布局环境
    );

    expect(item.attachmentLayout).toEqual(
      expect.objectContaining({
        template: "triple-grid",
        columnCount: 3,
        contentWidth: item.bubbleWidth,
      })
    );

    expect(
      item.attachments.map((attachment) => attachment.gridColumnStart)
    ).toEqual([1, 2, 3, 1, 2, 3]);
    expect(item.attachments.every((attachment) => attachment.gridColumnSpan === 1)).toBe(true);
    expect(item.attachments.every((attachment) => attachment.gridRowSpan === 1)).toBe(true);
    expect(
      item.attachments.every(
        (attachment) => attachment.displayHeight > attachment.displayWidth * 1.24
      )
    ).toBe(true);
  });
});
