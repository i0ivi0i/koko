import { vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 媒体会话信号 } from "../../媒体/媒体会话";

const 创建内核宿主 = () => ({
  addController: vi.fn(),
  removeController: vi.fn(),
  requestUpdate: vi.fn(),
  updateComplete: Promise.resolve(true),
});

export const 创建内核依赖 = () => {
  const 滚动宿主 = 创建内核宿主();
  return {
    滚动宿主,
    渲染桥: {
      请求重渲染: () => {
        滚动宿主.requestUpdate();
      },
      等待壳渲染完成: async () => {
        await 滚动宿主.updateComplete;
      },
    },
  };
};

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

export type 聊天媒体测试端口 = {
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    继续上传草稿(localId: string): Promise<void>;
    重新上传草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
  设置媒体查看器供测试(viewer: {
    打开(input: { startAttachmentId: string; items: unknown[] }): void;
    同步?(input: { startAttachmentId: string; items: unknown[] }): void;
    销毁(): void;
  }): void;
  设置媒体播放器供测试(player: {
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
  }): void;
  处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  关闭媒体查看器供测试(): void;
};

export const 读取媒体编排供测试 = (kernel: unknown): 聊天媒体测试端口 =>
  (kernel as { 媒体编排: 聊天媒体测试端口 }).媒体编排;

export const 观察媒体窗口 = async (
  kernel: { dispatch(command: unknown): Promise<unknown> },
  attachmentIds: string[]
): Promise<void> => {
  await kernel.dispatch({
    type: "ROOM_MEDIA_WINDOW_OBSERVED",
    attachmentIds,
  });
  await Promise.resolve();
  await Promise.resolve();
};
