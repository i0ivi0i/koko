import {
  派生消息展示项,
  type 聊天列表展示项,
  type 消息展示项,
  type 消息文本布局环境,
  type 附件预览地址表,
} from "../房间消息窗/视图.js";
import type { 消息事件 } from "../聊天共享/契约.js";

const 未读分隔标识 = "unread-divider" as const;

/**
 * 数组逐条引用相等比较。
 *
 * 用于内容稳定复用判定：每个 item 来自单条缓存的 cache hit 时是同一引用，
 * 整体数组内容引用相同 ⇔ 这一帧没有任何单条变化。
 */
function 数组逐条引用相等<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 派生缓存输入：完整描述「派生一帧聊天列表展示项」需要的所有事实。
 *
 * 与 `派生聊天列表展示项` 函数签名对齐，但用 input object 形态便于：
 * - 测试时只覆写关心的字段；
 * - 未来扩展无需破坏调用方。
 */
export interface 派生缓存输入 {
  messages: 消息事件[];
  currentSessionId: string;
  firstUnreadEventPosition: number | null;
  layoutEnv: 消息文本布局环境;
  附件预览地址表: 附件预览地址表;
}

/**
 * 派生统计：仅供测试与诊断观察缓存命中情况，不参与业务真相。
 */
export interface 派生统计 {
  /** 上一次 `派生(...)` 调用中真实跑过 `派生消息展示项` 的次数。 */
  本次派生次数: number;
  /** 当前缓存里持有的单条派生条目数。 */
  单条缓存大小: number;
}

/**
 * 创建按 message_id 增量派生的聊天列表展示项缓存。
 *
 * 修复 plan v2 §B 漏洞：
 * - 旧实现按 `messages === ` 引用相等比较 → xstate 每次 send 都返回新数组引用 →
 *   缓存永远 miss → N=3000 时每次 REALTIME 全量 O(N) 重派生（含文本布局测量）；
 * - 新实现按 `(message_id, 内容指纹)` 缓存单条派生结果：
 *   - 新增消息：仅对新条调 `派生消息展示项`；
 *   - 修改消息（attachment 预览地址变化等）：仅对变条重派生；
 *   - 消息被裁掉（参 Task 5 内存窗口裁剪）：缓存条目自动驱逐，避免 Map 长期增长；
 *   - layoutEnv / sessionId 变化：全量失效重派生（语义变了）。
 *
 * 性能：万人房 100 条/s 推送稳态从 O(N) 全量降到 O(M) 增量，配合 Task 6 fast-path
 * 真正闭环 24h 丝滑承诺。
 */
export function 创建聊天列表展示项缓存() {
  // 全局失效条件追踪：sessionId / layoutEnv 任一变化都会清空所有单条缓存。
  let 上次sessionId = "";
  let 上次layoutEnv: 消息文本布局环境 | null = null;
  /**
   * 上次返回的 items 数组引用。
   *
   * 当一帧派生与上次内容完全一致（每条 item 引用相同 + 长度相同）时复用同一引用，
   * 让上层 Lit 的属性比较能识别"无变化"，跳过 koko-room-message-pane 的 rerender。
   *
   * 注：不能直接用「输入引用相等」做快路径——`previewUrlByAttachmentId` 由媒体编排
   * 每次重新构建（不稳定），引用比较永远 miss；按 items 内容比较是稳定可靠的。
   */
  let 上次items: 聊天列表展示项[] | null = null;

  // 单条派生缓存：message_id → 派生结果 + 内容指纹（避免命中假阳性）。
  const 单条缓存 = new Map<string, 消息展示项>();
  const 单条缓存键 = new Map<string, string>();

  /** 上一次 `派生` 调用中真实派生的次数（不含 cache hit），仅供测试观察。 */
  let 本次派生计数 = 0;

  /**
   * 求单条消息的内容指纹键。
   *
   * 包含会让派生结果变化的所有维度：
   * - message_id：身份；
   * - event_position：分隔符位置变化时也要重新派生（不变量保险）；
   * - text：文本内容；
   * - attachment 预览地址表：图片/视频缩略图变化要重新派生（影响布局）。
   *
   * 不含 sessionId / layoutEnv：它们由全局失效兜底。
   */
  function 求单条缓存键(msg: 消息事件, 表: 附件预览地址表): string {
    let attachmentKey = "";
    const attachments = msg.attachments ?? [];
    for (const a of attachments) {
      attachmentKey += `${a.attachment_id}=${表[a.attachment_id]?.previewSrc ?? ""};`;
    }
    return `${msg.message_id}|${msg.event_position}|${msg.text}|${attachmentKey}`;
  }

  return {
    派生(input: 派生缓存输入): 聊天列表展示项[] {
      本次派生计数 = 0;

      // 全局失效：sessionId 或 layoutEnv 变了，所有单条缓存都失效（语义全变）。
      if (
        input.currentSessionId !== 上次sessionId ||
        上次layoutEnv !== input.layoutEnv
      ) {
        单条缓存.clear();
        单条缓存键.clear();
        上次sessionId = input.currentSessionId;
        上次layoutEnv = input.layoutEnv;
      }

      const items: 聊天列表展示项[] = [];
      let 已插入未读分隔条 = false;
      const 当前出现ids = new Set<string>();

      for (const message of input.messages) {
        // 未读分隔条：只插一次，位置由后端裁决的 firstUnreadEventPosition 驱动。
        if (
          !已插入未读分隔条 &&
          input.firstUnreadEventPosition !== null &&
          message.event_position === input.firstUnreadEventPosition
        ) {
          items.push({
            kind: "unread-divider",
            id: 未读分隔标识,
            label: "未读消息",
          });
          已插入未读分隔条 = true;
        }

        当前出现ids.add(message.message_id);
        const 缓存键 = 求单条缓存键(message, input.附件预览地址表);
        const 已缓存 = 单条缓存.get(message.message_id);
        if (已缓存 && 单条缓存键.get(message.message_id) === 缓存键) {
          // 命中：直接复用同一引用（让上游引用相等优化也能联动）。
          items.push(已缓存);
        } else {
          // 未命中或键变化：重新派生 + 更新缓存。
          const 派生项 = 派生消息展示项(
            message,
            input.currentSessionId,
            input.layoutEnv,
            input.附件预览地址表
          );
          单条缓存.set(message.message_id, 派生项);
          单条缓存键.set(message.message_id, 缓存键);
          本次派生计数 += 1;
          items.push(派生项);
        }
      }

      // 驱逐已被裁掉的 message_id（参 Task 5 内存窗口裁剪）。
      // 仅在缓存实际大于当前出现条目数时才扫描，避免无谓 keys() 遍历。
      if (单条缓存.size > 当前出现ids.size) {
        for (const id of [...单条缓存.keys()]) {
          if (!当前出现ids.has(id)) {
            单条缓存.delete(id);
            单条缓存键.delete(id);
          }
        }
      }

      /**
       * 内容稳定复用：本次 items 与上次每条引用都相同（长度也相同）时复用上次数组引用。
       * - 命中条件意味着没有任何单条变更（O(N) 逐条比较，但每个 item 是 O(1) 引用比较）；
       * - 命中后让上层 Lit 的 `pane.items === 上次` 跳过 rerender，是 Lit 集成期望的语义。
       * - 失败时返回新数组 items（已构建好），无额外成本。
       */
      if (上次items !== null && 数组逐条引用相等(上次items, items)) {
        return 上次items;
      }
      上次items = items;
      return items;
    },

    /**
     * 全量清空缓存。
     *
     * 用于房间退场或显式重置场景；常态下不需要主动调用，
     * 全局失效条件（sessionId / layoutEnv）已经覆盖大多数无效化路径。
     */
    清空(): void {
      单条缓存.clear();
      单条缓存键.clear();
      上次sessionId = "";
      上次layoutEnv = null;
      上次items = null;
      本次派生计数 = 0;
    },

    /**
     * 派生统计：仅供测试与运行时诊断使用。
     */
    派生统计(): 派生统计 {
      return {
        本次派生次数: 本次派生计数,
        单条缓存大小: 单条缓存.size,
      };
    },
  };
}
