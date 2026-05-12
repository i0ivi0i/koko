import {
  创建浏览器存储,
  type 前端存储端口,
} from "./存储.js";
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
import {
  创建浏览器预览缓存,
  type 预览缓存端口,
} from "../媒体/预览缓存.js";

type 可持久化导航器 = {
  storage?: {
    persist?(): Promise<unknown>;
    persisted?(): Promise<unknown>;
    estimate?(): Promise<unknown>;
    getDirectory?: unknown;
  };
};

export interface 存储运行时依赖 {
  storage?: Partial<Storage>;
  navigator?: 可持久化导航器;
  fileSystemFileHandleCtor?: { prototype?: { createWritable?: unknown } };
}

export type 存储运行时事件 =
  | { type: "STORAGE_PERSISTENCE_RESULT"; persisted: boolean }
  | { type: "STORAGE_EVICTION_DETECTED" };

export interface 存储运行时 {
  壳层记忆(): 前端存储端口;
  媒体资产仓库?(): 媒体缓存仓库;
  媒体定位仓库?(): 媒体定位缓存仓库;
  视频预览仓库?(): 预览缓存端口;
  协作分发缓存仓库?(): 协作分发Torrent缓存仓库;
  读取协作分发字节Store能力?(): {
    webTorrent默认OPFSStore可用: boolean;
  };
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
  const 读取FileSystemFileHandleCtor = ():
    | { prototype?: { createWritable?: unknown } }
    | undefined =>
    deps.fileSystemFileHandleCtor ??
    (globalThis as typeof globalThis & {
      FileSystemFileHandle?: { prototype?: { createWritable?: unknown } };
    }).FileSystemFileHandle;
  const 读取当前存储源 = (): Partial<Storage> | undefined => {
    if (deps.storage) {
      return deps.storage;
    }
    if (typeof window === "undefined") {
      return undefined;
    }
    try {
      // 存储运行时只接浏览器窗口的 localStorage；Node 的 globalThis.localStorage
      // 不是产品运行入口，读取它会制造第二存储面并触发测试环境 warning。
      return window.localStorage as Partial<Storage>;
    } catch {
      return undefined;
    }
  };
  const 发布事件 = (event: 存储运行时事件): void => {
    for (const listener of 事件监听器) {
      listener(event);
    }
  };
  const 读取持久化状态 = async (
    storageManager: NonNullable<可持久化导航器["storage"]>
  ): Promise<boolean | null> => {
    if (typeof storageManager.persisted !== "function") {
      return null;
    }
    try {
      return Boolean(await storageManager.persisted());
    } catch {
      return null;
    }
  };
  const 预热存储估算 = async (
    storageManager: NonNullable<可持久化导航器["storage"]>
  ): Promise<void> => {
    if (typeof storageManager.estimate !== "function") {
      return;
    }
    try {
      await storageManager.estimate();
    } catch {
      /**
       * `estimate()` 只服务 best-effort 平台判断：
       * - 这里读取它，是为了把浏览器原生存储观测也纳入统一入口；
       * - 失败不升级成业务失败，更不阻断后面的 `persisted()/persist()`；
       * - 真正的业务可用性仍由媒体定位与会话 owner 决定。
       */
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

    视频预览仓库(): 预览缓存端口 {
      /**
       * 视频预览缓存只保存“同一 canonical video 已经派生过什么 preview”的本地投影：
       * - 它服务恢复体验，不是后端正式 poster 真相；
       * - 预览 owner 只能通过平台存储入口拿仓库，不能自己越层去碰浏览器全局；
       * - 这样后续换成 OPFS / IndexedDB 时，媒体编排仍然只认这一条稳定端口。
       */
      return 创建浏览器预览缓存(
        读取当前存储源() as Pick<Storage, "getItem" | "setItem"> | undefined
      );
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

    读取协作分发字节Store能力() {
      const storageManager = 读取当前导航器()?.storage;
      const fileHandleCtor = 读取FileSystemFileHandleCtor();
      return {
        // WebTorrent v2.5+ 内置 OPFS/FSA chunk store；这里只投影能力事实给媒体层。
        webTorrent默认OPFSStore可用:
          typeof storageManager?.getDirectory === "function" &&
          typeof fileHandleCtor?.prototype?.createWritable === "function",
      };
    },

    订阅事件(listener: (event: 存储运行时事件) => void): () => void {
      事件监听器.add(listener);
      return () => {
        事件监听器.delete(listener);
      };
    },

    async 请求持久化存储(): Promise<boolean> {
      const storageManager = 读取当前导航器()?.storage;
      if (!storageManager) {
        return false;
      }
      await 预热存储估算(storageManager);
      const 已持久化 = await 读取持久化状态(storageManager);
      if (已持久化 === true) {
        发布事件({
          type: "STORAGE_PERSISTENCE_RESULT",
          persisted: true,
        });
        return true;
      }
      const persist = storageManager.persist;
      if (typeof persist !== "function") {
        return false;
      }

      try {
        const persisted = Boolean(await persist());
        const 最终持久化结果 =
          persisted || (await 读取持久化状态(storageManager)) === true;
        发布事件({
          type: "STORAGE_PERSISTENCE_RESULT",
          persisted: 最终持久化结果,
        });
        return 最终持久化结果;
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
