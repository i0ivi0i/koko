import {
  创建浏览器应用平台,
  type 浏览器应用平台,
} from "./浏览器应用平台.js";

let 默认浏览器应用平台: 浏览器应用平台 | null = null;

/**
 * 入口和壳层只拿平台门面，不分散 import 内部 runtime。
 * 这样后面继续扩平台能力时，外层调用面还能保持稳定。
 */
export function 获取默认浏览器应用平台(): 浏览器应用平台 {
  if (!默认浏览器应用平台) {
    默认浏览器应用平台 = 创建浏览器应用平台();
  }
  return 默认浏览器应用平台;
}

export {
  创建浏览器应用平台,
  type 浏览器应用平台事件,
  type 浏览器应用平台命令,
  type 浏览器应用平台快照,
  type 浏览器应用平台,
} from "./浏览器应用平台.js";
export {
  创建生命周期运行时,
  type 生命周期快照,
  type 生命周期运行时,
} from "./生命周期运行时.js";
export {
  创建存储运行时,
  type 存储运行时,
} from "./存储运行时.js";
export {
  创建服务工作线程运行时,
  type 服务工作线程运行时事件,
  type 服务工作线程快照,
  type 服务工作线程运行时,
} from "./服务工作线程运行时.js";
export {
  创建传输运行时,
  type 传输运行时快照,
  type 传输运行时依赖,
  type 传输运行时,
} from "./传输运行时.js";
export {
  创建多上下文运行时,
  type 多上下文运行时快照,
  type 多上下文运行时依赖,
  type 多上下文运行时,
} from "./多上下文运行时.js";
export {
  创建通知运行时,
  type 通知运行时快照,
  type 通知运行时依赖,
  type 通知运行时,
  type 显示通知输入,
} from "./通知运行时.js";
export {
  创建离线运行时,
  type 离线运行时快照,
  type 离线运行时依赖,
  type 离线运行时,
} from "./离线运行时.js";
export {
  创建离线任务仓库,
  type 平台离线任务,
  type 离线任务仓库,
  type 离线任务仓库依赖,
  type 离线任务存储实现,
} from "./离线任务仓库.js";
