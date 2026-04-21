import { describe, expect, it, vi } from "vitest";
import { 创建聊天媒体编排 } from "../聊天媒体编排";
import type { 前端传输端口 } from "../传输";
import type { 消息事件 } from "../契约";
import type { 媒体播放结果 } from "../媒体";

const 生成视频消息 = (attachmentId: string): 消息事件 =>
  ({
    attachments: [
      {
        attachment_id: attachmentId,
        kind: "video",
      },
    ],
  }) as unknown as 消息事件;

const 生成锚点视频播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "anchor",
  attachmentId,
  kind: "video",
  src: `http://media.local/original-${attachmentId}`,
  thumbnailUrl: null,
  hint: null,
});

const 刷新异步队列 = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

describe("聊天媒体编排", () => {
  it("视频预览进入 missing_source 后，同一 sourceVersion 下重复同步不会无限重试", async () => {
    const attachmentId = "att-video-preview-loop-1";
    const 抓取视频预览 = vi.fn(async () => ({
      objectUrl: null,
      source: "none" as const,
      width: null,
      height: null,
    }));
    const transport: 前端传输端口 = {
      loadMediaLocator: vi.fn(async () => ({
        attachment_id: attachmentId,
        kind: "video" as const,
        status: "ready" as const,
        original_url: `http://media.local/original-${attachmentId}`,
        thumbnail_url: null,
        distribution: null,
        file_asset: {
          asset_id: attachmentId,
          content_hash: `hash-${attachmentId}`,
          kind: "single_file_video" as const,
          variants: {
            canonical: {
              id: "canonical",
              mime_type: "video/mp4",
              url: `http://media.local/canonical-${attachmentId}.mp4`,
              width: 1280,
              height: 720,
            },
          },
          origin: {
            original_url: `http://media.local/original-${attachmentId}`,
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
          distribution: null,
        },
      })),
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

    const 编排 = 创建聊天媒体编排({
      transport: () => transport,
      读取会话编号: () => "s-test",
      读取消息: () => [生成视频消息(attachmentId)],
      读取草稿: () => [],
      写入草稿列表: () => {},
      请求重渲染: () => {},
      回收媒体草稿预览地址: () => {},
      登记程序滚动来源: () => {},
      清除程序滚动来源: () => {},
      抓取视频预览,
    });

    (
      编排 as unknown as {
        设置媒体播放器供测试(player: {
          解析播放结果(input: {
            attachmentId: string;
            kind: "image" | "video";
            surface?: "viewer" | "inline_autoplay";
            consumerId?: string;
          }): Promise<媒体播放结果>;
          激活协作补齐?(input: {
            attachmentId: string;
            kind: "image" | "video";
            consumerId?: string;
          }): Promise<void>;
          释放附件播放资源?(input: {
            attachmentId: string;
            consumerId?: string;
            丢弃未完成补齐?: boolean;
          }): void;
        }): void;
      }
    ).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue(生成锚点视频播放结果(attachmentId)),
    });

    编排.同步消息附件播放结果();
    await 刷新异步队列();
    expect(抓取视频预览).toHaveBeenCalledTimes(1);

    // 同一 sourceVersion 下再次同步，只允许维持 missing_source，不允许重复重试预览抓帧。
    编排.同步消息附件播放结果();
    await 刷新异步队列();
    expect(抓取视频预览).toHaveBeenCalledTimes(1);

    // sourceVersion 发生变化（会话恢复重裁决）后，允许触发一次新的预览尝试。
    编排.处理媒体会话信号(attachmentId, { type: "ENTER_RECOVERING" });
    await 刷新异步队列();
    await 刷新异步队列();
    expect(抓取视频预览).toHaveBeenCalledTimes(2);

    编排.销毁();
  });
});
