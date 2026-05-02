import type { 消息事件 } from "../../聊天共享/契约";
import type { 媒体播放结果 } from "../../媒体";

export const 生成视频消息 = (attachmentId: string): 消息事件 =>
  ({
    attachments: [
      {
        attachment_id: attachmentId,
        kind: "video",
      },
    ],
  }) as unknown as 消息事件;

export const 生成图片消息 = (attachmentId: string): 消息事件 =>
  ({
    attachments: [
      {
        attachment_id: attachmentId,
        kind: "image",
      },
    ],
  }) as unknown as 消息事件;

export const 生成连续视频消息 = (count: number): 消息事件[] =>
  Array.from({ length: count }, (_, index) =>
    生成视频消息(`att-video-window-${index + 1}`)
  );

export const 生成锚点视频播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "anchor",
  attachmentId,
  kind: "video",
  src: `http://media.local/original-${attachmentId}`,
  thumbnailUrl: null,
  hint: null,
});

export const 刷新异步队列 = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

export const 创建延后Promise = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};
