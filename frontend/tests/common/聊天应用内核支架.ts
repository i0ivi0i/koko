import { vi } from "vitest";
import {
  type 聊天媒体测试端口,
  适配媒体编排供测试,
} from "./聊天媒体编排支架.js";
export type { 图片协作补齐激活请求 } from "./聊天媒体编排支架.js";

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

export const 读取媒体编排供测试 = (kernel: unknown): 聊天媒体测试端口 =>
  适配媒体编排供测试(kernel);

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
