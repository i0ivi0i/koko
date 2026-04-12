import {
  创建浏览器存储,
  type 前端存储端口,
} from "../存储.js";

export interface 存储运行时依赖 {
  storage?: Partial<Storage>;
}

export interface 存储运行时 {
  壳层记忆(): 前端存储端口;
}

/**
 * 存储运行时先只托管壳层本地记忆端口。
 * 这样做的目的不是再包一层轮子，而是先把“谁负责给壳层提供本地记忆”收进平台层。
 */
export function 创建存储运行时(
  deps: 存储运行时依赖 = {}
): 存储运行时 {
  return {
    壳层记忆(): 前端存储端口 {
      /**
       * 平台组合根可以是长生命周期单例，但壳层记忆端口不能把第一次读取到的
       * `window.localStorage` 句柄永久抓死。
       *
       * 这样测试里重新替换 `window.localStorage` 时，新的壳/内核仍然会读取当前
       * 浏览器存储，而不是继续误用上一个上下文留下的旧句柄。
       */
      return 创建浏览器存储(
        deps.storage ??
          (typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined)
      );
    },
  };
}
