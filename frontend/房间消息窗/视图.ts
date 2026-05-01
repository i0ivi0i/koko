import type { 附件快照, 消息事件 } from "../聊天共享/契约.js";
import type { 首页房间历史条目 } from "../存储.js";
import type { 媒体附件草稿 } from "../媒体/媒体草稿.js";
import type { 房间视口模式 } from "../总装/聊天状态.js";
import {
  默认文本布局器,
  type 文本布局结果,
  type 文本布局环境,
} from "./文本布局.js";

/**
 * 聊天展示 owner 只负责消息列表、操作台和房间壳层 presenter。
 * 后台展示文案已经拆回后台模块，避免根目录展示总管继续双活。
 */

export interface 消息文本布局环境 extends 文本布局环境 {
  maxContentWidth: number;
  singleLineMaxContentWidth: number;
  bubbleHorizontalPadding: number;
  bubbleHorizontalBorderWidth: number;
}

export const 默认消息文本布局环境: 消息文本布局环境 = {
  fontFamily: "Microsoft YaHei",
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 22,
  whiteSpace: "normal",
  wordBreak: "normal",
  maxContentWidth: 420,
  singleLineMaxContentWidth: 420,
  bubbleHorizontalPadding: 28,
  bubbleHorizontalBorderWidth: 2,
};

export type 媒体拼贴模板 =
  | "single"
  | "double-grid"
  | "hero-top"
  | "quad-grid"
  | "hero-strip"
  | "triple-grid";

export interface 媒体附件拼贴布局 {
  template: 媒体拼贴模板;
  columnCount: number;
  gap: number;
  rowHeight: number;
  contentWidth: number;
}

export interface 消息展示项 {
  kind: "message";
  id: string;
  owner: "mine" | "other";
  body: string;
  hasText: boolean;
  attachments: 媒体附件展示项[];
  attachmentLayout?: 媒体附件拼贴布局;
  layout: 文本布局结果;
  bubbleWidth: number;
  senderDisplayAlias: string;
  showAlias: boolean;
  eventPosition: number;
}

export interface 图片附件展示项 {
  kind: "image";
  attachmentId: string;
  width: number;
  height: number;
  gridColumnStart?: number;
  gridColumnSpan?: number;
  gridRowStart?: number;
  gridRowSpan?: number;
  displayWidth: number;
  displayHeight: number;
  thumbnailSrc: string;
  originalSrc: string;
}

export interface 视频附件展示项 {
  kind: "video";
  attachmentId: string;
  width: number;
  height: number;
  gridColumnStart?: number;
  gridColumnSpan?: number;
  gridRowStart?: number;
  gridRowSpan?: number;
  displayWidth: number;
  displayHeight: number;
  originalSrc: string;
  posterSrc: string | null;
}

export type 媒体附件展示项 = 图片附件展示项 | 视频附件展示项;
interface 媒体附件拼贴槽位 {
  columnStart: number;
  columnSpan: number;
  rowStart: number;
  rowSpan: number;
}

interface 媒体附件展示结果 {
  attachments: 媒体附件展示项[];
  attachmentLayout: 媒体附件拼贴布局 | null;
}

export type 附件内容地址表 = Record<
  string,
  {
    originalSrc: string;
    thumbnailSrc: string;
  }
>;

export interface 未读分隔展示项 {
  kind: "unread-divider";
  id: "unread-divider";
  label: "未读消息";
}

export type 聊天列表展示项 = 消息展示项 | 未读分隔展示项;
export type 壳主舞台模式 = "boot" | "home" | "room";
export type 控制台模式 = "hidden" | "join" | "message";

export interface 首页会话展示项 {
  roomId: string;
  roomCode: string;
  title: string;
  meta: string;
}

export interface 操作台槽位配置 {
  visible: boolean;
  disabled: boolean;
  label: string;
}

export interface 操作台主输入配置 {
  value: string;
  placeholder: string;
  enterKeyHint: "go" | "send" | "done";
  disabled: boolean;
}

/**
 * 这是壳层 presenter，不是新的业务真状态。
 * 它只回答一个问题：唯一操作台此刻该如何表现。
 */
export interface 壳级操作台状态 {
  mode: 控制台模式;
  statusText: string;
  statusAttention: boolean;
  auxSlot: 操作台槽位配置;
  primaryInput: 操作台主输入配置;
  primaryAction: 操作台槽位配置;
}

const 未读分隔标识 = "unread-divider" as const;

/**
 * 壳层展示列表派生：
 * 1. 消息展示项仍然只来自权威事件；
 * 2. 未读分隔条只是本地展示项，不是领域事件；
 * 3. 分隔条位置由后端裁决的 `firstUnreadEventPosition` 驱动，前端不自己猜。
 */
export function 派生聊天列表展示项(
  messages: 消息事件[],
  currentSessionId: string,
  firstUnreadEventPosition: number | null,
  layoutEnv: 消息文本布局环境 = 默认消息文本布局环境,
  附件内容地址表: 附件内容地址表 = {}
): 聊天列表展示项[] {
  const items: 聊天列表展示项[] = [];
  let unreadDividerInserted = false;

  for (const message of messages) {
    if (
      !unreadDividerInserted &&
      firstUnreadEventPosition !== null &&
      message.event_position === firstUnreadEventPosition
    ) {
      items.push({
        kind: "unread-divider",
        id: 未读分隔标识,
        label: "未读消息",
      });
      unreadDividerInserted = true;
    }
    items.push(派生消息展示项(message, currentSessionId, layoutEnv, 附件内容地址表));
  }

  return items;
}

/**
 * 壳层只基于稳定事实派生展示模型：
 * - sender_session_id 是否等于当前 session_id，决定左右分边；
 * - event_position 继续留在同步层，不进入普通聊天主视图。
 */
export function 派生消息展示项(
  event: 消息事件,
  currentSessionId: string,
  layoutEnv: 消息文本布局环境 = 默认消息文本布局环境,
  附件内容地址表: 附件内容地址表 = {}
): 消息展示项 {
  const isMine = event.sender_session_id === currentSessionId;
  const body = 读取消息文本(event);
  const hasText = body.trim().length > 0;
  const { attachments, attachmentLayout } = 派生媒体附件展示结果(
    event.attachments ?? [],
    layoutEnv,
    附件内容地址表
  );
  const 多行紧凑候选 = 默认文本布局器.布局纯文本({
    text: hasText ? body : " ",
    width: layoutEnv.maxContentWidth,
    shrinkWrap: "same-line-count",
    fontFamily: layoutEnv.fontFamily,
    fontSize: layoutEnv.fontSize,
    fontWeight: layoutEnv.fontWeight,
    lineHeight: layoutEnv.lineHeight,
    ...(layoutEnv.whiteSpace ? { whiteSpace: layoutEnv.whiteSpace } : {}),
    ...(layoutEnv.wordBreak ? { wordBreak: layoutEnv.wordBreak } : {}),
  });
  const 单行直通上限 = Math.max(
    layoutEnv.maxContentWidth,
    layoutEnv.singleLineMaxContentWidth
  );
  const layout =
    多行紧凑候选.naturalWidth <= 单行直通上限
      ? 默认文本布局器.布局纯文本({
          text: hasText ? body : " ",
          width: Math.max(1, Math.ceil(多行紧凑候选.naturalWidth)),
          fontFamily: layoutEnv.fontFamily,
          fontSize: layoutEnv.fontSize,
          fontWeight: layoutEnv.fontWeight,
          lineHeight: layoutEnv.lineHeight,
          ...(layoutEnv.whiteSpace ? { whiteSpace: layoutEnv.whiteSpace } : {}),
          ...(layoutEnv.wordBreak ? { wordBreak: layoutEnv.wordBreak } : {}),
        })
      : 多行紧凑候选;
  const 文本气泡宽度 = hasText ? 计算消息气泡宽度(layout, layoutEnv) : 0;
  const 媒体气泡宽度 =
    attachments.length > 0
      ? hasText
        ? 计算媒体附件气泡宽度(attachments, layoutEnv, attachmentLayout)
        : 计算媒体附件内容宽度(attachments, layoutEnv, attachmentLayout)
      : 0;

  /**
   * 宽度裁决顺序在这里收口：
   * 1. 先按多行上限拿一版紧凑候选；
   * 2. 如果它的单行自然宽度仍落在单行直通上限内，就直接回到单行；
   * 3. 只有单行真的放不下，才继续使用 bubbles 式多行 shrinkwrap。
   *
   * 这样既保住了 Pretext 的零 reflow 优势，也避免把短消息硬压成两行。
   */

  return {
    kind: "message",
    id: event.message_id,
    owner: isMine ? "mine" : "other",
    body,
    hasText,
    attachments,
    ...(attachmentLayout ? { attachmentLayout } : {}),
    layout,
    bubbleWidth: Math.max(文本气泡宽度, 媒体气泡宽度),
    senderDisplayAlias: event.sender_display_alias,
    showAlias: !isMine,
    eventPosition: event.event_position,
  };
}

function 读取消息文本(event: 消息事件): string {
  return event.text;
}

function 派生媒体附件展示结果(
  attachments: 附件快照[],
  layoutEnv: 消息文本布局环境,
  附件内容地址表: 附件内容地址表
): 媒体附件展示结果 {
  if (attachments.length === 0) {
    return {
      attachments: [],
      attachmentLayout: null,
    };
  }

  const 拼贴规划 = 规划媒体拼贴布局(attachments.length, layoutEnv);
  const 单图宽度上限 = Math.max(140, Math.min(layoutEnv.maxContentWidth, 320));
  const attachmentsItems = attachments.map<媒体附件展示项>((attachment, index) => {
      const slot = 拼贴规划.slots[index] ?? {
        columnStart: 1,
        columnSpan: 1,
        rowStart: 1,
        rowSpan: 1,
      };
      const displayWidth =
        拼贴规划.layout.template === "single"
          ? Math.min(attachment.width, 单图宽度上限)
          : 计算拼贴槽位宽度(拼贴规划.layout, slot);
      const displayHeight =
        拼贴规划.layout.template === "single"
          ? Math.max(
              72,
              Math.round((displayWidth * attachment.height) / Math.max(1, attachment.width))
            )
          : 计算拼贴槽位高度(拼贴规划.layout, slot);

      /**
       * 多附件消息在 presenter 层先收口成统一拼贴几何：
       * 1. 壳层和 renderer 只消费一份槽位真相，不再各自猜“几列几行”；
       * 2. 混合图片/视频也共用同一模板选择逻辑，避免一边是图片网格、一边是视频列表；
       * 3. 多附件时不再逐张保留原始纵横比，而是统一裁切到拼贴槽位，换取 Telegram 式整齐结构。
       */
      if (attachment.kind === "video") {
        return {
          kind: "video",
          attachmentId: attachment.attachment_id,
          width: attachment.width,
          height: attachment.height,
          gridColumnStart: slot.columnStart,
          gridColumnSpan: slot.columnSpan,
          gridRowStart: slot.rowStart,
          gridRowSpan: slot.rowSpan,
          displayWidth,
          displayHeight,
          originalSrc: 读取附件内容地址(附件内容地址表, attachment.attachment_id, "original"),
          /**
           * 视频消息流默认态只吃后端权威封面：
           * 1. 让 snapshot 和 locator 共用同一份 preview 真相；
           * 2. realtime room_event 在无逐连接 session 上下文时，不会直接带 still_url，
           *    这时只允许根据后端显式给出的 `has_preview_asset` 真相，回填当前会话的 thumbnail 地址；
           * 3. 不再让壳层临时抠首帧、长第二套预览链；
           * 4. 正式播放仍然继续走唯一媒体主链。
           */
          posterSrc:
            attachment.preview_asset?.still_url ??
            (attachment.has_preview_asset
              ? 读取附件内容地址(附件内容地址表, attachment.attachment_id, "thumbnail")
              : null),
        };
      }
      return {
        kind: "image",
        attachmentId: attachment.attachment_id,
        width: attachment.width,
        height: attachment.height,
        gridColumnStart: slot.columnStart,
        gridColumnSpan: slot.columnSpan,
        gridRowStart: slot.rowStart,
        gridRowSpan: slot.rowSpan,
        displayWidth,
        displayHeight,
        /**
         * canonical 图片已经不再存在服务端 thumbnail 派生：
         * 1. 时间线卡片和查看器都直接围绕同一份受控 original/canonical 入口；
         * 2. 这样 presenter 不会继续猜一条已经退场的 thumbnail 支路；
         * 3. 真要展示更轻量的静态封面，必须来自后端显式给出的 preview 真相，而不是这里脑补。
         */
        thumbnailSrc: 读取附件内容地址(附件内容地址表, attachment.attachment_id, "original"),
        originalSrc: 读取附件内容地址(附件内容地址表, attachment.attachment_id, "original"),
      };
    });

  const attachmentLayout =
    拼贴规划.layout.template === "single"
      ? {
          ...拼贴规划.layout,
          contentWidth: attachmentsItems[0]?.displayWidth ?? 拼贴规划.layout.contentWidth,
          rowHeight: attachmentsItems[0]?.displayHeight ?? 拼贴规划.layout.rowHeight,
        }
      : 拼贴规划.layout;

  return {
    attachments: attachmentsItems,
    attachmentLayout,
  };
}

function 规划媒体拼贴布局(
  attachmentCount: number,
  layoutEnv: 消息文本布局环境
): {
  layout: 媒体附件拼贴布局;
  slots: 媒体附件拼贴槽位[];
} {
  const gap = 8;
  const multiAttachmentWidth = Math.max(248, Math.min(layoutEnv.maxContentWidth, 384));
  const 双列单元宽度 = Math.floor((multiAttachmentWidth - gap) / 2);
  const 双列单元高度 = Math.max(196, Math.floor(双列单元宽度 * 1.28));
  const 三列单元宽度 = Math.floor((multiAttachmentWidth - gap * 2) / 3);
  const 三列单元高度 = Math.max(152, Math.floor(三列单元宽度 * 1.36));

  /**
   * 多媒体拼贴现在明确向“竖向短视频优先”的几何收口：
   * 1. 双列和三列单元都明确做成 portrait cell，而不是“接近正方形”的海报块；
   * 2. 三图/五图模板继续保留 leader column，让主卡片纵向跨两行；
   * 3. 同时把拼贴最大内容宽度略放开，减少时间线两侧空耗的网页式留白。
   */
  if (attachmentCount <= 1) {
    return {
      layout: {
        template: "single",
        columnCount: 1,
        gap: 0,
        rowHeight: 0,
        contentWidth: multiAttachmentWidth,
      },
      slots: [{ columnStart: 1, columnSpan: 1, rowStart: 1, rowSpan: 1 }],
    };
  }

  if (attachmentCount === 2) {
    return {
      layout: {
        template: "double-grid",
        columnCount: 2,
        gap,
        rowHeight: 双列单元高度,
        contentWidth: multiAttachmentWidth,
      },
      slots: [
        { columnStart: 1, columnSpan: 1, rowStart: 1, rowSpan: 1 },
        { columnStart: 2, columnSpan: 1, rowStart: 1, rowSpan: 1 },
      ],
    };
  }

  if (attachmentCount === 3) {
    return {
      layout: {
        template: "hero-top",
        columnCount: 2,
        gap,
        rowHeight: 双列单元高度,
        contentWidth: multiAttachmentWidth,
      },
      slots: [
        { columnStart: 1, columnSpan: 1, rowStart: 1, rowSpan: 2 },
        { columnStart: 2, columnSpan: 1, rowStart: 1, rowSpan: 1 },
        { columnStart: 2, columnSpan: 1, rowStart: 2, rowSpan: 1 },
      ],
    };
  }

  if (attachmentCount === 4) {
    return {
      layout: {
        template: "quad-grid",
        columnCount: 2,
        gap,
        rowHeight: 双列单元高度,
        contentWidth: multiAttachmentWidth,
      },
      slots: [
        { columnStart: 1, columnSpan: 1, rowStart: 1, rowSpan: 1 },
        { columnStart: 2, columnSpan: 1, rowStart: 1, rowSpan: 1 },
        { columnStart: 1, columnSpan: 1, rowStart: 2, rowSpan: 1 },
        { columnStart: 2, columnSpan: 1, rowStart: 2, rowSpan: 1 },
      ],
    };
  }

  if (attachmentCount === 5) {
    return {
      layout: {
        template: "hero-strip",
        columnCount: 2,
        gap,
        rowHeight: 双列单元高度,
        contentWidth: multiAttachmentWidth,
      },
      slots: [
        { columnStart: 1, columnSpan: 1, rowStart: 1, rowSpan: 2 },
        { columnStart: 2, columnSpan: 1, rowStart: 1, rowSpan: 1 },
        { columnStart: 2, columnSpan: 1, rowStart: 2, rowSpan: 1 },
        { columnStart: 1, columnSpan: 1, rowStart: 3, rowSpan: 1 },
        { columnStart: 2, columnSpan: 1, rowStart: 3, rowSpan: 1 },
      ],
    };
  }

  return {
    layout: {
      template: "triple-grid",
      columnCount: 3,
      gap,
      rowHeight: 三列单元高度,
      contentWidth: multiAttachmentWidth,
    },
    slots: Array.from({ length: attachmentCount }, (_, index) => ({
      columnStart: (index % 3) + 1,
      columnSpan: 1,
      rowStart: Math.floor(index / 3) + 1,
      rowSpan: 1,
    })),
  };
}

function 计算拼贴槽位宽度(
  layout: 媒体附件拼贴布局,
  slot: 媒体附件拼贴槽位
): number {
  const 单列宽度 = Math.floor(
    (layout.contentWidth - layout.gap * Math.max(0, layout.columnCount - 1)) / layout.columnCount
  );
  return 单列宽度 * slot.columnSpan + layout.gap * Math.max(0, slot.columnSpan - 1);
}

function 计算拼贴槽位高度(
  layout: 媒体附件拼贴布局,
  slot: 媒体附件拼贴槽位
): number {
  return layout.rowHeight * slot.rowSpan + layout.gap * Math.max(0, slot.rowSpan - 1);
}

/**
 * 展示层只读附件地址表，不直接知道 transport/session。
 * 如果某条测试只关心 presenter 几何而没显式提供 URL，就退回稳定默认值，避免把测试绑死到网络端口。
 */
function 读取附件内容地址(
  附件内容地址表: 附件内容地址表,
  attachmentId: string,
  variant: "original" | "thumbnail"
): string {
  const entry = 附件内容地址表[attachmentId];
  if (entry) {
    return variant === "thumbnail" ? entry.thumbnailSrc : entry.originalSrc;
  }
  return `/api/attachments/${attachmentId}/${variant}`;
}

function 计算媒体附件气泡宽度(
  attachments: 媒体附件展示项[],
  layoutEnv: 消息文本布局环境,
  attachmentLayout?: 媒体附件拼贴布局 | null
): number {
  return (
    计算媒体附件内容宽度(attachments, layoutEnv, attachmentLayout) +
    layoutEnv.bubbleHorizontalPadding +
    layoutEnv.bubbleHorizontalBorderWidth
  );
}

function 计算媒体附件内容宽度(
  attachments: 媒体附件展示项[],
  layoutEnv: 消息文本布局环境,
  attachmentLayout?: 媒体附件拼贴布局 | null
): number {
  if (attachmentLayout) {
    return Math.min(layoutEnv.maxContentWidth, attachmentLayout.contentWidth);
  }
  const 宫格间距 = 8;
  const 列数 = attachments.length >= 2 ? 2 : 1;
  return 列数 === 1
    ? attachments[0]?.displayWidth ?? 0
    : Math.min(
        layoutEnv.maxContentWidth,
        (attachments[0]?.displayWidth ?? 0) * 2 + 宫格间距
      );
}

function 计算消息气泡宽度(
  layout: 文本布局结果,
  layoutEnv: 消息文本布局环境
): number {
  /**
   * 消息气泡宽度不再用“单行自然宽度”粗暴裁决。
   * 这里直接消费布局结果里最宽的那一行：
   * 1. 普通多行消息会得到真正已断行后的最宽行；
   * 2. shrinkwrap 消息会得到“保持相同行数但更紧”的那组行里的最宽行；
   * 3. 如果当前消息被判定为“单行直通”，这里也允许它超过多行上限，
   *    但仍然受单行直通上限约束；
   * 4. 最后再补上气泡的整块外框宽度。
   *
   * 注意这里必须把左右边框也一起算进去：
   * 当前宿主全局使用 `box-sizing: border-box`，而 `.message-bubble`
   * 还有左右各 1px 边框。如果只补 padding，不补 border，
   * 真实 DOM 可用正文宽度就会比 Pretext 预算少 2px，
   * 短中文会稳定出现 `2+1 / 3+1 / 4+1` 的假换行。
   */
  const 文本宽度上限 = Math.max(
    layoutEnv.maxContentWidth,
    layoutEnv.singleLineMaxContentWidth
  );
  const 文本宽度 = Math.min(layout.maxLineWidth, 文本宽度上限);
  return (
    文本宽度 +
    layoutEnv.bubbleHorizontalPadding +
    layoutEnv.bubbleHorizontalBorderWidth
  );
}

/**
 * 主舞台模式只由恢复阶段和当前房间锚点派生。
 * 它是壳层的只读语义，不允许回写成第二份真状态。
 */
export function 派生壳主舞台模式(input: {
  bootstrapState: "booting" | "ready";
  roomId: string;
}): 壳主舞台模式 {
  if (input.bootstrapState === "booting") {
    return "boot";
  }
  return input.roomId ? "room" : "home";
}

/**
 * 控制台模式同样只回答“当前应该展示哪种输入语义”，
 * 不能演化成和 `roomId/bootstrapState` 脱节的可写状态。
 */
export function 派生控制台模式(input: {
  bootstrapState: "booting" | "ready";
  roomId: string;
}): 控制台模式 {
  if (input.bootstrapState === "booting") {
    return "hidden";
  }
  return input.roomId ? "message" : "join";
}

/**
 * 唯一操作台的显示语义统一从这里派生：
 * - `hidden` 表示操作台实体常驻，但主输入和主动作暂时冻结；
 * - `join` / `message` 只切输入值来源、placeholder、主按钮文案与禁用态；
 * - 这层不拥有第二份真状态，只翻译壳层当前上下文。
 */
export function 派生壳级操作台状态(input: {
  consoleMode: 控制台模式;
  roomCodeInput: string;
  messageInput: string;
  pending: boolean;
  statusText: string;
  statusAttention?: boolean;
  composerMediaDrafts?: 媒体附件草稿[];
}): 壳级操作台状态 {
  const 媒体草稿列表 = input.composerMediaDrafts ?? [];
  const 运输中的媒体数 = 媒体草稿列表.filter((draft) => draft.status === "transporting").length;
  const 处理中的媒体数 = 媒体草稿列表.filter((draft) => draft.status === "processing").length;
  const 失败媒体数 = 媒体草稿列表.filter((draft) => draft.status === "failed").length;
  const baseState = {
    statusText: input.statusText,
    statusAttention: Boolean(input.statusAttention),
    auxSlot: {
      visible: false,
      disabled: true,
      label: "",
    },
  } satisfies Pick<壳级操作台状态, "statusText" | "statusAttention" | "auxSlot">;

  if (input.consoleMode === "hidden") {
    return {
      mode: "hidden",
      ...baseState,
      primaryInput: {
        value: "",
        placeholder: "房间短码",
        enterKeyHint: "done",
        disabled: true,
      },
      primaryAction: {
        visible: true,
        disabled: true,
        label: "进房",
      },
    };
  }

  if (input.consoleMode === "message") {
    /**
     * 发送区的禁用理由必须和按钮状态同源派生：
     * 1. 先看失败媒体草稿，因为这是用户最需要处理的阻塞项；
     * 2. 再看仍在传字节的媒体草稿；
     * 3. 再看已经传完、但仍在等后端 complete 的媒体草稿；
     * 4. 最后才回到房间普通状态文案。
     *
     * 这样 Enter 提交和按钮点击至少会看到同一份可见原因，
     * 不再出现“按钮看起来能点，但命令层 silent return”的体验落差。
     */
    const statusText =
      失败媒体数 > 0
        ? `${失败媒体数} 个媒体附件上传失败，请重试或删除`
        : 运输中的媒体数 > 0
          ? `正在上传 ${运输中的媒体数} 个媒体附件`
          : 处理中的媒体数 > 0
            ? `正在处理 ${处理中的媒体数} 个媒体附件`
          : input.statusText;
    const statusAttention = 失败媒体数 > 0 || Boolean(input.statusAttention);
    const hasBlockingDraft = 运输中的媒体数 > 0 || 处理中的媒体数 > 0 || 失败媒体数 > 0;
    return {
      mode: "message",
      ...baseState,
      statusText,
      statusAttention,
      auxSlot: {
        visible: true,
        disabled: input.pending,
        label: "+",
      },
      primaryInput: {
        value: input.messageInput,
        placeholder: "输入消息",
        enterKeyHint: "send",
        disabled: false,
      },
      primaryAction: {
        visible: true,
        disabled: input.pending || hasBlockingDraft,
        label: "发送",
      },
    };
  }

  return {
    mode: "join",
    ...baseState,
    primaryInput: {
      value: input.roomCodeInput,
      placeholder: "房间短码",
      enterKeyHint: "go",
      disabled: false,
    },
    primaryAction: {
      visible: true,
      disabled: false,
      label: "进房",
    },
  };
}

/**
 * 首页会话列表只是历史房间锚点的展示模型：
 * - `title` 收口主标题；
 * - `meta` 收口辅助时间文案；
 * - presenter 负责把原始条目翻译成模板真正消费的形状。
 */
export function 派生首页会话展示项(
  items: 首页房间历史条目[]
): 首页会话展示项[] {
  return items.map((item) => ({
    roomId: item.roomId,
    roomCode: item.roomCode,
    title: item.roomCode || item.roomId,
    meta: `最近进入: ${new Date(item.lastEnteredAt).toLocaleString("zh-CN")}`,
  }));
}

export interface 房间壳提示文案输入 {
  recoveryState: "idle" | "retryable_failure" | "reconnecting";
  roomId: string;
  displayAlias: string;
}

export interface 消息窗口提示文案输入 {
  historyLoading: boolean;
  historyErrorCode: string;
}

/**
 * 房间壳只承接“整个房间页都该知道”的稳定提示：
 * - 优先展示当前最重要的异常或恢复提示；
 * - 没有异常时，再退回到身份辅助信息。
 *
 * 历史分页只属于消息窗口局部体验，不允许继续从这里泄漏到头部或底部操作台。
 */
export function 派生房间壳提示文案(input: 房间壳提示文案输入): {
  recoveryHint: string;
  subtitle: string;
} {
  const recoveryHint = 派生恢复提示文案(input.recoveryState, input.roomId);
  if (recoveryHint) {
    return { recoveryHint, subtitle: recoveryHint };
  }
  return {
    recoveryHint,
    subtitle: input.displayAlias ? `当前匿名身份：${input.displayAlias}` : "群聊房间",
  };
}

/**
 * 历史分页提示严格收口在消息窗口内部：
 * - 这里只翻译局部“更早消息加载中/失败”文案；
 * - 不让调用方再把这类局部态抬升成整页级提示。
 */
export function 派生消息窗口提示文案(input: 消息窗口提示文案输入): {
  historyHint: string;
} {
  return {
    historyHint: 派生历史提示文案(input.historyLoading, input.historyErrorCode),
  };
}

function 派生恢复提示文案(
  recoveryState: 房间壳提示文案输入["recoveryState"],
  roomId: string
): string {
  if (recoveryState === "reconnecting") {
    return "会话已刷新，正在重新恢复";
  }
  if (recoveryState !== "retryable_failure") {
    return "";
  }
  return roomId ? "实时连接暂不可用，可稍后重试" : "恢复失败，可稍后重试";
}

function 派生历史提示文案(historyLoading: boolean, historyErrorCode: string): string {
  if (historyLoading) {
    return "正在加载更早消息";
  }
  if (historyErrorCode) {
    return "更早消息加载失败，可继续上滑重试";
  }
  return "";
}

/**
 * “跳到最新”入口只属于壳层浮动动作。
 * 它的存在条件完全来自前端当前视口语义，不回写任何后端真相。
 */
export function 派生跳到最新入口文案(input: {
  viewportMode: 房间视口模式;
  hasUnreadNewerMessages: boolean;
}): string {
  if (!input.hasUnreadNewerMessages) {
    return "";
  }
  if (input.viewportMode === "贴底跟随") {
    return "";
  }
  return "有新消息，跳到最新";
}
