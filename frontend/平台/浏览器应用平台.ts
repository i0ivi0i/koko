import {
  创建生命周期运行时,
  type 生命周期运行时,
} from "./生命周期运行时.js";
import {
  创建存储运行时,
  type 存储运行时,
} from "./存储运行时.js";
import {
  创建服务工作线程运行时,
  type 服务工作线程运行时,
} from "./服务工作线程运行时.js";

export interface 浏览器应用平台依赖 {
  lifecycle?: 生命周期运行时;
  storage?: 存储运行时;
  serviceWorker?: 服务工作线程运行时;
}

export interface 浏览器应用平台 {
  lifecycle: 生命周期运行时;
  storage: 存储运行时;
  serviceWorker: 服务工作线程运行时;
  启动(): Promise<void>;
}

/**
 * BrowserAppPlatform 是浏览器运行时组合根。
 * 当前阶段只先收生命周期、存储和 service worker；等后续阶段再把多标签、通知、离线、传输接进来。
 */
export function 创建浏览器应用平台(
  deps: 浏览器应用平台依赖 = {}
): 浏览器应用平台 {
  const lifecycle = deps.lifecycle ?? 创建生命周期运行时();
  const storage = deps.storage ?? 创建存储运行时();
  const serviceWorker = deps.serviceWorker ?? 创建服务工作线程运行时();

  return {
    lifecycle,
    storage,
    serviceWorker,
    async 启动(): Promise<void> {
      await serviceWorker.启动();
    },
  };
}
