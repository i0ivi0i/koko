import { 创建应用运行时, type 应用运行时端口 } from "../平台/应用运行时.js";
import {
  创建聊天应用内核,
  type 聊天应用内核端口,
  type 聊天应用快照,
} from "../聊天应用内核.js";
import type { 房间滚动器宿主 } from "../时间线/滚动器.js";
import { 获取默认浏览器应用平台, type 浏览器应用平台 } from "../平台/index.js";
import type { 聊天运行时预算状态 } from "../状态.js";
import type { 前端传输端口 } from "../传输.js";

interface 聊天壳应用装配依赖 {
  请求重渲染(): void;
  等待壳渲染完成(): Promise<void>;
  滚动宿主: 房间滚动器宿主;
  查询滚动容器(): HTMLElement | null;
  查询消息节点(): HTMLElement[];
  清理房间视图本地状态(input: { previewUrls: string[] }): void;
}

export interface 聊天壳应用装配 {
  readonly 平台: 浏览器应用平台;
  readonly kernel: 聊天应用内核端口;
  读取应用运行时(): 应用运行时端口;
  读取预算烟测快照(): 聊天运行时预算状态;
  设置测试传输(transport: 前端传输端口): void;
  销毁(): void;
}

/**
 * 聊天壳总装只做一件事：把平台、内核和 AppRuntime 组装成同一份入口。
 * 这样壳层以后只能消费装配结果，不能再私自 new 第二颗 kernel 或第二条平台订阅链。
 */
export function 创建聊天壳应用装配(
  deps: 聊天壳应用装配依赖
): 聊天壳应用装配 {
  const 平台 = 获取默认浏览器应用平台();
  const kernel = 创建聊天应用内核({
    platform: 平台,
    渲染桥: {
      请求重渲染: deps.请求重渲染,
      等待壳渲染完成: deps.等待壳渲染完成,
    },
    滚动宿主: deps.滚动宿主,
    查询滚动容器: deps.查询滚动容器,
    查询消息节点: deps.查询消息节点,
    清理房间视图本地状态: deps.清理房间视图本地状态,
  });
  let 应用运行时: 应用运行时端口 | null = null;

  const 读取聊天快照 = (): 聊天应用快照 => kernel.snapshot();

  return {
    平台,
    kernel,
    读取应用运行时(): 应用运行时端口 {
      if (!应用运行时) {
        应用运行时 = 创建应用运行时({
          dispatch: (command) => kernel.dispatch(command),
          subscribePlatformEvents: (listener) => 平台.订阅事件?.(listener) ?? (() => {}),
        });
      }
      return 应用运行时;
    },
    读取预算烟测快照(): 聊天运行时预算状态 {
      return 读取聊天快照().runtimeBudget;
    },
    设置测试传输(transport: 前端传输端口): void {
      应用运行时?.dispose();
      应用运行时 = null;
      kernel.setTransportForTest(transport);
    },
    销毁(): void {
      应用运行时?.dispose();
      应用运行时 = null;
      kernel.dispose();
    },
  };
}
