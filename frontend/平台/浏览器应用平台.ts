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
import {
  创建传输运行时,
  type 传输运行时,
} from "./传输运行时.js";

export interface 浏览器应用平台依赖 {
  lifecycle?: 生命周期运行时;
  storage?: 存储运行时;
  serviceWorker?: 服务工作线程运行时;
  transport?: 传输运行时;
}

export interface 浏览器应用平台 {
  lifecycle: 生命周期运行时;
  storage: 存储运行时;
  serviceWorker: 服务工作线程运行时;
  transport: 传输运行时;
  启动(): Promise<void>;
}

/**
 * BrowserAppPlatform 是浏览器运行时组合根。
 * 当前阶段先把浏览器运行时能力集中到一个入口：
 * - 生命周期
 * - 存储
 * - service worker
 * - transport 实例归属
 *
 * 它不解释聊天业务事实，只负责把浏览器层能力收口，避免每个壳继续各管一份。
 */
export function 创建浏览器应用平台(
  deps: 浏览器应用平台依赖 = {}
): 浏览器应用平台 {
  const lifecycle = deps.lifecycle ?? 创建生命周期运行时();
  const storage = deps.storage ?? 创建存储运行时();
  const serviceWorker = deps.serviceWorker ?? 创建服务工作线程运行时();
  const transport = deps.transport ?? 创建传输运行时();

  return {
    lifecycle,
    storage,
    serviceWorker,
    transport,
    async 启动(): Promise<void> {
      transport.接收生命周期变化(lifecycle.snapshot());
      await serviceWorker.启动();
    },
  };
}
