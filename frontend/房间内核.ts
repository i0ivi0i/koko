import { assign, createActor, createMachine } from "xstate";

/**
 * 房间内核上下文只保存“前端同步编排需要知道的事实”。
 *
 * 边界约束：
 * 1. 这里不是后端领域真相，不裁决成员资格、权限和消息是否成立；
 * 2. 这里只承载前端壳为了 bootstrap / 恢复 / 续接 所需的最小上下文；
 * 3. 后续状态机扩展，也必须继续守住“同步编排内核，不是领域内核”。
 */
export interface 房间内核上下文 {
  sessionId: string;
  displayAlias: string;
  roomId: string;
}

/**
 * 前端房间编排事件。
 *
 * 当前只先落下最小事件面：
 * - bootstrap 成功后，决定壳层该进大厅还是进恢复链；
 * - 后续 join / subscribe / reconnect 会在这个联合类型上继续追加。
 */
export type 房间内核事件 =
  | {
      type: "BOOTSTRAP_SUCCEEDED";
      sessionId: string;
      displayAlias: string;
      roomId: string;
    };

/**
 * 房间同步编排机的当前阶段。
 *
 * 当前最小落地只实现：
 * - 引导中
 * - 大厅中
 * - 恢复中
 *
 * 这样先把“壳层不自己拼 bootstrap 结果”的最小骨架钉住，
 * 再继续往 join / subscribe / reconnect 扩。
 */
const 房间编排机 = createMachine(
  {
    types: {} as {
      context: 房间内核上下文;
      events: 房间内核事件;
    },
    id: "房间编排机",
    initial: "引导中",
    context: {
      sessionId: "",
      displayAlias: "",
      roomId: "",
    },
    states: {
      引导中: {
        on: {
          BOOTSTRAP_SUCCEEDED: [
            {
              guard: ({ event }) => event.roomId.trim().length > 0,
              target: "恢复中",
              actions: "写入引导结果",
            },
            {
              target: "大厅中",
              actions: "写入引导结果",
            },
          ],
        },
      },
      大厅中: {},
      恢复中: {},
    },
  },
  {
    actions: {
      写入引导结果: assign(({ event }) => {
        if (event.type !== "BOOTSTRAP_SUCCEEDED") {
          return {};
        }
        return {
          sessionId: event.sessionId,
          displayAlias: event.displayAlias,
          roomId: event.roomId,
        };
      }),
    },
  }
);

/**
 * 创建一个新的房间内核 actor。
 *
 * 之所以直接返回 actor，而不是先暴露更多 wrapper，
 * 是为了先用最小接口把测试和后续壳层整合跑通，避免过早造抽象。
 */
export function 创建房间内核() {
  return createActor(房间编排机).start();
}
