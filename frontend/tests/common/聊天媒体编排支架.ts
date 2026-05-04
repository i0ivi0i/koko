import type { 消息事件 } from "../../聊天共享/契约";
import type { 媒体查看器打开请求 } from "../../媒体/媒体查看器";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 媒体附件草稿 } from "../../媒体/媒体草稿";
import type { 媒体会话信号 } from "../../媒体/媒体会话";

export type 图片协作补齐激活请求 = {
  attachmentId: string;
  kind: "image" | "video";
  consumerId?: string;
  onSessionEvent?: (signal: {
    type: "SWARM_ACTIVE" | "SWARM_NO_PEERS" | "SWARM_TICKET_INVALID" | "ASSET_COMPLETE";
    attachmentId: string;
    swarmId: string;
    contentHash?: string;
  }) => void;
};

type 测试媒体发布器 = {
  处理选择媒体文件(files: Iterable<File>): Promise<void>;
  移除草稿(localId: string): void;
  继续上传草稿(localId: string): Promise<void>;
  重新上传草稿(localId: string): Promise<void>;
  清空(): void;
  销毁(): void;
};

type 测试媒体查看器 = {
  打开(input: 媒体查看器打开请求): void;
  同步?(input: 媒体查看器打开请求): void;
  销毁(): void;
};

type 测试媒体播放器 = {
  解析播放结果(input: {
    attachmentId: string;
    kind: "image" | "video";
    surface?: "viewer" | "inline_autoplay";
    consumerId?: string;
  }): Promise<媒体播放结果>;
  激活协作补齐?(input: 图片协作补齐激活请求): Promise<void>;
  释放附件播放资源?(input: {
    attachmentId: string;
    consumerId?: string;
    丢弃未完成补齐?: boolean;
  }): void;
};

export type 聊天媒体测试端口 = {
  设置媒体发布器供测试(publisher: 测试媒体发布器): void;
  设置媒体查看器供测试(viewer: 测试媒体查看器): void;
  设置媒体播放器供测试(player: 测试媒体播放器): void;
  写入媒体草稿列表供测试(drafts: 媒体附件草稿[]): void;
  处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  关闭媒体查看器供测试(): void;
};

type 媒体编排内部桥 = {
  替换媒体发布器: 聊天媒体测试端口["设置媒体发布器供测试"];
  替换媒体查看器: 聊天媒体测试端口["设置媒体查看器供测试"];
  替换媒体播放器: 聊天媒体测试端口["设置媒体播放器供测试"];
  替换媒体草稿列表: 聊天媒体测试端口["写入媒体草稿列表供测试"];
  关闭媒体查看器: 聊天媒体测试端口["关闭媒体查看器供测试"];
};

type 媒体编排正式端口 = {
  处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  内部桥: 媒体编排内部桥;
};

/**
 * 生产媒体编排已经不再背 `供测试` 公开表面。
 * 这里把旧测试动词投影成 test-only 适配层，保证：
 * 1. 旧测试语义还能稳定复用；
 * 2. 真正被替换的仍然只是 `内部桥`；
 * 3. 生产运行时不再为了测试兼容继续暴露第二套公开入口。
 */
export const 适配媒体编排供测试 = (input: unknown): 聊天媒体测试端口 => {
  const 媒体编排 =
    (input as { 媒体编排?: 媒体编排正式端口 }).媒体编排 ??
    (input as 媒体编排正式端口);
  return {
    ...媒体编排,
    设置媒体发布器供测试: (publisher) => 媒体编排.内部桥.替换媒体发布器(publisher),
    设置媒体查看器供测试: (viewer) => 媒体编排.内部桥.替换媒体查看器(viewer),
    设置媒体播放器供测试: (player) => 媒体编排.内部桥.替换媒体播放器(player),
    写入媒体草稿列表供测试: (drafts) => 媒体编排.内部桥.替换媒体草稿列表(drafts),
    处理媒体会话信号: (attachmentId, signal) =>
      媒体编排.处理媒体会话信号(attachmentId, signal),
    关闭媒体查看器供测试: () => 媒体编排.内部桥.关闭媒体查看器(),
  } as 聊天媒体测试端口;
};

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
