import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放会话应用 } from "../../媒体/播放会话/应用";
import {
  生成视频消息,
  生成连续视频消息,
  刷新异步队列,
  适配媒体编排供测试,
} from "../common/聊天媒体编排支架";
import type { 前端传输端口 } from "../../平台/传输";
import type { 媒体播放结果 } from "../../媒体";

describe("聊天媒体编排 - 预算与窗口收敛", () => {
  it("预算快照会暴露附件级视频重量原因，而不是只给一组聚合数字", async () => {
    const attachmentId = "att-video-budget-owner-1";
    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => {
        throw new Error("unused");
      }),
      buildAttachmentContentUrl: vi.fn(
        (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
          `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
      ),
      prepareMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
      abandonMediaUpload: vi.fn(async () => {}),
      completeMediaUpload: vi.fn(async () => {
        throw new Error("unused");
      }),
    } as unknown as 前端传输端口;
    const 编排 = 创建媒体播放会话应用({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => [生成视频消息(attachmentId)],
      读取草稿: () => [],
      写入草稿列表: () => undefined,
      请求重渲染: () => undefined,
      回收媒体草稿预览地址: () => undefined,
      登记程序滚动来源: () => undefined,
      清除程序滚动来源: () => undefined,
    });
    适配媒体编排供测试(编排).设置媒体播放器供测试({
      解析播放结果: vi.fn(
        async () =>
          ({
            mode: "swarm",
            attachmentId,
            kind: "video",
            src: `blob:http://media.local/swarm-${attachmentId}`,
            thumbnailUrl: `http://media.local/poster-${attachmentId}`,
            contentHash: `hash-${attachmentId}`,
            hint: null,
          }) satisfies 媒体播放结果
      ),
    });

    try {
      编排.同步媒体窗口附件([attachmentId]);
      编排.处理自动播候选([
        {
          attachmentId,
          visibilityRatio: 0.95,
          distanceToViewportCenter: 0,
        },
      ]);
      await 刷新异步队列();
      await 刷新异步队列();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await 刷新异步队列();

      expect(编排.snapshot()).toMatchObject({
        videoBudgetByAttachmentId: {
          [attachmentId]: expect.objectContaining({
            attachmentId,
            tier: "heavy_playback",
            reason: "inline_autoplay_owner",
          }),
        },
      });
      expect(编排.读取预算()).toMatchObject({
        focusedVideoBudget: expect.arrayContaining([
          expect.objectContaining({
            attachmentId,
            tier: "heavy_playback",
            reason: "inline_autoplay_owner",
          }),
        ]),
      });
    } finally {
      编排.销毁();
    }
  });

  it("同步消息附件播放结果后，只保留近视口/当前交互窗口内的活媒体会话，而不是整房历史全养活", async () => {
    const 消息列表 = 生成连续视频消息(20);
    const 编排 = 创建媒体播放会话应用({
      transport: () =>
        ({
          loadMediaLocator: vi.fn(async () => {
            throw new Error("unused");
          }),
          buildAttachmentContentUrl: vi.fn(
            (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
              `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
          ),
          prepareMediaUpload: vi.fn(async () => {
            throw new Error("unused");
          }),
          abandonMediaUpload: vi.fn(async () => {}),
          completeMediaUpload: vi.fn(async () => {
            throw new Error("unused");
          }),
        }) as unknown as 前端传输端口,
      读取会话编号: () => "s-test",
      读取消息: () => 消息列表,
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
      抓取视频预览: vi.fn(async () => ({
        objectUrl: null,
        source: "none" as const,
        width: null,
        height: null,
      })),
    });

    编排.处理自动播候选([
      {
        attachmentId: "att-video-window-1",
        visibilityRatio: 0.93,
        distanceToViewportCenter: 0,
      },
      {
        attachmentId: "att-video-window-2",
        visibilityRatio: 0.88,
        distanceToViewportCenter: 64,
      },
    ]);
    编排.同步消息附件播放结果();
    await 刷新异步队列();

    expect(Object.keys(编排.snapshot().sessionByAttachmentId).length).toBeLessThanOrEqual(12);
    编排.销毁();
  });

  it("窗口真相未到前，不会先把整房历史附件拉成活媒体会话", async () => {
    const 消息列表 = 生成连续视频消息(20);
    const 编排 = 创建媒体播放会话应用({
      transport: () =>
        ({
          loadMediaLocator: vi.fn(async () => {
            throw new Error("unused");
          }),
          buildAttachmentContentUrl: vi.fn(
            (id: string, sessionId: string, variant: "original" | "thumbnail" = "original") =>
              `http://test.local/api/attachments/${id}/content?session_id=${sessionId}&variant=${variant}`
          ),
          prepareMediaUpload: vi.fn(async () => {
            throw new Error("unused");
          }),
          abandonMediaUpload: vi.fn(async () => {}),
          completeMediaUpload: vi.fn(async () => {
            throw new Error("unused");
          }),
        }) as unknown as 前端传输端口,
      读取会话编号: () => "s-window-sync",
      读取消息: () => 消息列表,
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
      抓取视频预览: vi.fn(async () => ({
        objectUrl: null,
        source: "none" as const,
        width: null,
        height: null,
      })),
    });

    编排.同步消息附件播放结果();
    expect(Object.keys(编排.snapshot().sessionByAttachmentId)).toHaveLength(0);

    编排.同步媒体窗口附件(
      Array.from({ length: 6 }, (_, index) => `att-video-window-${index + 1}`)
    );
    await 刷新异步队列();

    expect(Object.keys(编排.snapshot().sessionByAttachmentId).length).toBeLessThanOrEqual(6);
    编排.销毁();
  });
});
