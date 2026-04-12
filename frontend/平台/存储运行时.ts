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
  const memory = 创建浏览器存储(deps.storage);

  return {
    壳层记忆(): 前端存储端口 {
      return memory;
    },
  };
}
