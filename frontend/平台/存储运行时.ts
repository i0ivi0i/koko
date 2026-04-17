import {
  创建浏览器存储,
  type 前端存储端口,
} from "../存储.js";
import {
  创建浏览器媒体缓存仓库,
  type 媒体缓存仓库,
} from "../媒体/媒体缓存.js";
import {
  创建浏览器媒体定位缓存仓库,
  type 媒体定位缓存仓库,
} from "../媒体/媒体定位.js";
import {
  创建浏览器协作分发Torrent缓存仓库,
  type 协作分发Torrent缓存仓库,
} from "../媒体/媒体协作分发缓存.js";

type 可持久化导航器 = {
  storage?: {
    persist?(): Promise<unknown>;
  };
};

export interface 存储运行时依赖 {
  storage?: Partial<Storage>;
  navigator?: 可持久化导航器;
}

export type 存储运行时事件 =
  | { type: "STORAGE_PERSISTENCE_RESULT"; persisted: boolean }
  | { type: "STORAGE_EVICTION_DETECTED" };

export interface 存储运行时 {
  壳层记忆(): 前端存储端口;
  媒体资产仓库?(): 媒体缓存仓库;
  媒体定位仓库?(): 媒体定位缓存仓库;
  协作分发缓存仓库?(): 协作分发Torrent缓存仓库;
  订阅事件?(listener: (event: 存储运行时事件) => void): () => void;
  请求持久化存储?(): Promise<boolean>;
  报告加速层丢失?(): void;
}

/**
 * 存储运行时统一托管本地存储入口，但只暴露三类稳定表面：
 * 1. 壳层记忆端口；
 * 2. 媒体完整资产元数据仓库；
 * 3. 媒体 locator 持久化仓库。
 *
 * 它不拥有业务语义，只负责把浏览器存储句柄收口成稳定入口。
 */
export function 创建存储运行时(
  deps: 存储运行时依赖 = {}
): 存储运行时 {
  const 事件监听器 = new Set<(event: 存储运行时事件) => void>();
  const 读取当前导航器 = (): 可持久化导航器 | undefined =>
    deps.navigator ??
    (typeof navigator !== "undefined" ? (navigator as 可持久化导航器) : undefined);
  const 读取当前存储源 = (): Partial<Storage> | undefined => {
    if (deps.storage) {
      return deps.storage;
    }
    const candidate =
      typeof window !== "undefined" && window.localStorage
        ? (window.localStorage as Partial<Storage>)
        : ((globalThis as { localStorage?: Partial<Storage> }).localStorage ?? undefined);
    return candidate;
  };
  const 发布事件 = (event: 存储运行时事件): void => {
    for (const listener of 事件监听器) {
      listener(event);
    }
  };

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

    媒体定位仓库(): 媒体定位缓存仓库 {
      /**
       * locator 仍然只是前端恢复体验用的本地投影：
       * - 只保存已经拿到过的解析结果；
       * - 不在这里发明播放或鉴权真相；
       * - 页面重开后由媒体 owner 决定是否继续复用或重签。
       */
      return 创建浏览器媒体定位缓存仓库(读取当前存储源());
    },

    协作分发缓存仓库(): 协作分发Torrent缓存仓库 {
      /**
       * 协作分发缓存仓库只保存可重挂 swarm 的极小元数据。
       * 真正的 WebTorrent 会话生命周期仍然留给协作分发 runtime 自己管理。
       */
      return 创建浏览器协作分发Torrent缓存仓库(
        读取当前存储源() as Pick<Storage, "getItem" | "setItem"> | undefined
      );
    },

    订阅事件(listener: (event: 存储运行时事件) => void): () => void {
      事件监听器.add(listener);
      return () => {
        事件监听器.delete(listener);
      };
    },

    async 请求持久化存储(): Promise<boolean> {
      const persist = 读取当前导航器()?.storage?.persist;
      if (typeof persist !== "function") {
        return false;
      }
      try {
        const persisted = Boolean(await persist());
        发布事件({
          type: "STORAGE_PERSISTENCE_RESULT",
          persisted,
        });
        return persisted;
      } catch {
        发布事件({
          type: "STORAGE_PERSISTENCE_RESULT",
          persisted: false,
        });
        return false;
      }
    },

    报告加速层丢失(): void {
      发布事件({ type: "STORAGE_EVICTION_DETECTED" });
    },
  };
}
