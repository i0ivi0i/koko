import {
  创建浏览器存储,
  type 前端存储端口,
} from "../存储.js";
import {
  创建浏览器媒体缓存仓库,
  type 媒体缓存仓库,
} from "../媒体/媒体缓存.js";

export interface 存储运行时依赖 {
  storage?: Partial<Storage>;
}

export interface 存储运行时 {
  壳层记忆(): 前端存储端口;
  媒体资产仓库?(): 媒体缓存仓库;
}

/**
 * 存储运行时统一托管本地存储入口，但只暴露两类稳定表面：
 * 1. 壳层记忆端口；
 * 2. 媒体完整资产元数据仓库。
 *
 * 它不拥有业务语义，只负责把浏览器存储句柄收口成稳定入口。
 */
export function 创建存储运行时(
  deps: 存储运行时依赖 = {}
): 存储运行时 {
  const 读取当前存储源 = (): Partial<Storage> | undefined =>
    deps.storage ??
    (typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined);

  return {
    壳层记忆(): 前端存储端口 {
      /**
       * 平台组合根可以是长生命周期单例，但壳层记忆端口不能把第一次读取到的
       * `window.localStorage` 句柄永久抓死。
       *
       * 这样测试里重新替换 `window.localStorage` 时，新的壳/内核仍然会读取当前
       * 浏览器存储，而不是继续误用上一个上下文留下的旧句柄。
       */
      return 创建浏览器存储(读取当前存储源());
    },

    媒体资产仓库(): 媒体缓存仓库 {
      /**
       * 第一切片先把“完整资产元数据”托管到平台存储里：
       * - 媒体 owner 不再散落拼 localStorage 键名；
       * - 记录里只放 `kind / contentHash / retainedAt / lastAccessAt` 这类 owner 真相；
       * - 这里仍然只存元数据，不伪装成媒体字节缓存层。
       */
      return 创建浏览器媒体缓存仓库(读取当前存储源());
    },
  };
}
