import type { 媒体定位结果, 媒体种类 } from "../../聊天共享/契约.js";
import {
  创建资产协作分发运行时,
  type 资产协作分发事件,
  type 资产协作分发快照,
  type 资产协作分发运行时端口,
} from "../资产协作分发运行时.js";
import type { 协作分发会话事件, 协作分发媒体源 } from "../媒体协作分发.js";

type 协作分发JoinTicket刷新请求 = {
  attachmentId: string;
  swarmId: string;
  torrentInfoHash: string;
};

type 协作分发源解析请求 = {
  attachmentId: string;
  kind: 媒体种类;
  locator: 媒体定位结果;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
  eagerCompleting?: boolean;
};

export interface 媒体协作分发应用依赖 {
  创建运行时?(): 资产协作分发运行时端口;
  refreshJoinTicket(
    input: 协作分发JoinTicket刷新请求
  ): Promise<媒体定位结果 | null>;
}

export interface 媒体协作分发应用端口 {
  send(event: 资产协作分发事件): void;
  snapshot(): 资产协作分发快照;
  读取会话状态: 资产协作分发运行时端口["读取会话状态"];
  读取预算: 资产协作分发运行时端口["读取预算"];
  解析协作分发源(input: 协作分发源解析请求): Promise<协作分发媒体源 | null>;
  释放协作分发消费者: 资产协作分发运行时端口["释放协作分发消费者"];
  重置(): void;
  销毁(): void;
}

/**
 * 协作分发应用只拥有“把定位 owner 和 swarm runtime 接起来”这一层应用裁剪：
 * 1. runtime 自己管 session / budget / lifecycle；
 * 2. locator 自己管 join ticket 刷新；
 * 3. 这里把两者接成一条稳定入口，避免聊天媒体编排继续兼任协作分发 owner。
 */
export function 创建媒体协作分发应用(
  deps: 媒体协作分发应用依赖
): 媒体协作分发应用端口 {
  const runtime = (deps.创建运行时 ?? 创建资产协作分发运行时)();

  return {
    send(event: 资产协作分发事件): void {
      runtime.send(event);
    },

    snapshot(): 资产协作分发快照 {
      return runtime.snapshot();
    },

    读取会话状态(swarmId) {
      return runtime.读取会话状态(swarmId);
    },

    读取预算(snapshot?) {
      if (snapshot === undefined) {
        return runtime.读取预算();
      }
      return runtime.读取预算(snapshot);
    },

    async 解析协作分发源(
      input: 协作分发源解析请求
    ): Promise<协作分发媒体源 | null> {
      /**
       * refreshJoinTicket 只能来自定位 owner：
       * 1. 协作分发 runtime 不得自己重造 locator 刷新链；
       * 2. 聊天媒体编排也不再自己拼 refresh 参数；
       * 3. 这样 join ticket 的续租口径始终只有一套。
       */
      return runtime.解析协作分发源({
        ...input,
        refreshJoinTicket: deps.refreshJoinTicket,
      });
    },

    释放协作分发消费者(input) {
      runtime.释放协作分发消费者(input);
    },

    重置(): void {
      runtime.重置();
    },

    销毁(): void {
      runtime.销毁();
    },
  };
}
