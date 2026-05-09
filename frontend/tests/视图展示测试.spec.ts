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
  it("展示 owner 直连生效，旧根入口已经删除", () => {
    const messagePaneViewSource = 读取前端源码("房间消息窗/视图.ts");
    const adminViewSource = 读取前端源码("后台/视图.ts");
    const shellSource = 读取前端源码("应用根/聊天壳.ts");
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

  it("五个混合媒体附件会被 Telegram Mosaic 算法布局为多行绝对定位", () => {
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

    /**
     * 新布局使用 Telegram Mosaic 绝对定位，
     * 验证布局输出包含 totalHeight/contentWidth/spacing。
     */
    expect(item.attachmentLayout).toEqual(
      expect.objectContaining({
        contentWidth: expect.any(Number),
        totalHeight: expect.any(Number),
        spacing: 8,
      })
    );

    /** 每张卡片都应有绝对坐标和正数尺寸 */
    expect(item.attachments).toHaveLength(5);
    for (const att of item.attachments) {
      expect(att.layoutX).toBeGreaterThanOrEqual(0);
      expect(att.layoutY).toBeGreaterThanOrEqual(0);
      expect(att.displayWidth).toBeGreaterThan(0);
      expect(att.displayHeight).toBeGreaterThan(0);
    }

    /** 无溢出：每张卡片 x+width ≤ contentWidth，y+height ≤ totalHeight */
    const maxWidth = item.attachmentLayout!.contentWidth;
    const maxHeight = item.attachmentLayout!.totalHeight;
    for (const att of item.attachments) {
      expect(att.layoutX + att.displayWidth).toBeLessThanOrEqual(maxWidth + 1);
      expect(att.layoutY + att.displayHeight).toBeLessThanOrEqual(maxHeight + 1);
    }
  });

  it("六个媒体附件会被 Telegram Mosaic 算法布局为多行紧凑排列", () => {
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
        contentWidth: expect.any(Number),
        totalHeight: expect.any(Number),
        spacing: 8,
      })
    );

    expect(item.attachments).toHaveLength(6);
    /** 每张卡片都有正数尺寸和合法坐标，无溢出 */
    const maxWidth = item.attachmentLayout!.contentWidth;
    const maxHeight = item.attachmentLayout!.totalHeight;
    for (const att of item.attachments) {
      expect(att.displayWidth).toBeGreaterThan(0);
      expect(att.displayHeight).toBeGreaterThan(0);
      expect(att.layoutX + att.displayWidth).toBeLessThanOrEqual(maxWidth + 1);
      expect(att.layoutY + att.displayHeight).toBeLessThanOrEqual(maxHeight + 1);
    }
  });

  it("没有附件地址表时，不会再凭空合成旧的 HTTP 内容路径", () => {
    const item = 派生消息展示项(
      创建消息事件([创建图片附件("att-image-plain")]),
      "s-self",
      默认消息文本布局环境,
      {}
    );

    expect(item.attachments).toHaveLength(1);
    expect(item.attachments[0]).toMatchObject({
      kind: "image",
      attachmentId: "att-image-plain",
    });
    expect("originalSrc" in (item.attachments[0] ?? {})).toBe(false);
    expect("thumbnailSrc" in (item.attachments[0] ?? {})).toBe(false);
  });
});
