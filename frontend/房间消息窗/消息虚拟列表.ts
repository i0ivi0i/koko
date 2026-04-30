import type { 聊天列表展示项, 消息展示项 } from "../视图.js";

export type 消息虚拟项 = {
  key: unknown;
  index: number;
  start: number;
};

export type 消息虚拟范围 = {
  startIndex: number;
  endIndex: number;
  overscan: number;
  count: number;
};

export const 消息虚拟列表overscan消息数 = 4;

const 首帧兜底消息预算上限 = 12;
const 首帧兜底最小消息数量 = 6;
const 首帧兜底默认视口高度 = 720;
const 首帧兜底视口覆盖倍率 = 1.25;

export const 估算媒体附件布局高度 = (item: 消息展示项): number => {
  if (item.attachments.length === 0) {
    return 0;
  }
  const layout = item.attachmentLayout;
  if (layout) {
    const rowCount = Math.max(
      1,
      ...item.attachments.map(
        (attachment) =>
          (attachment.gridRowStart ?? 1) + Math.max(1, attachment.gridRowSpan ?? 1) - 1
      )
    );
    return rowCount * layout.rowHeight + Math.max(0, rowCount - 1) * layout.gap;
  }
  const columnCount = item.attachments.length >= 2 ? 2 : 1;
  const rowCount = Math.ceil(item.attachments.length / columnCount);
  const rowHeight = Math.max(
    0,
    ...item.attachments.map((attachment) => attachment.displayHeight)
  );
  const gap = columnCount > 1 ? 8 : 0;
  return rowCount * rowHeight + Math.max(0, rowCount - 1) * gap;
};

export const 估算消息行高度 = (
  items: readonly 聊天列表展示项[],
  index: number
): number => {
  const item = items[index];
  if (!item) {
    return 72;
  }
  if (item.kind === "unread-divider") {
    return 28;
  }
  const aliasHeight = item.showAlias ? 22 : 0;
  if (item.attachments.length > 0) {
    const mediaHeight = 估算媒体附件布局高度(item);
    const mediaTextGap = item.hasText ? 8 : 0;
    return Math.max(48, aliasHeight + item.layout.height + mediaTextGap + mediaHeight);
  }
  return Math.max(48, aliasHeight + item.layout.height + 32);
};

export const 提取消息虚拟范围 = (
  items: readonly 聊天列表展示项[],
  range: 消息虚拟范围
): number[] => {
  const indexes = new Set<number>();
  const start = Math.max(range.startIndex - range.overscan, 0);
  const end = Math.min(range.endIndex + range.overscan, range.count - 1);
  for (let index = start; index <= end; index += 1) {
    indexes.add(index);
  }
  const unreadDividerIndex = items.findIndex((item) => item.kind === "unread-divider");
  if (unreadDividerIndex >= 0) {
    indexes.add(unreadDividerIndex);
    if (unreadDividerIndex + 1 < items.length) {
      indexes.add(unreadDividerIndex + 1);
    }
  }
  return Array.from(indexes).sort((left, right) => left - right);
};

export const 补齐首帧消息虚拟项 = (input: {
  virtualItems: readonly 消息虚拟项[];
  items: readonly 聊天列表展示项[];
  viewportHeight: number;
}): 消息虚拟项[] => {
  const { virtualItems, items } = input;
  if (virtualItems.length > 0 || items.length === 0) {
    return [...virtualItems];
  }

  const 视口高度 = input.viewportHeight || 首帧兜底默认视口高度;
  const 目标覆盖高度 = Math.max(视口高度 * 首帧兜底视口覆盖倍率, 首帧兜底默认视口高度);
  let 累积高度 = 0;
  let 已选消息数 = 0;
  let endIndex = 0;
  for (; endIndex < items.length; endIndex += 1) {
    累积高度 += 估算消息行高度(items, endIndex) + 10;
    已选消息数 += 1;
    if (已选消息数 >= 首帧兜底消息预算上限) {
      break;
    }
    if (已选消息数 >= 首帧兜底最小消息数量 && 累积高度 >= 目标覆盖高度) {
      break;
    }
  }
  const indexes = 提取消息虚拟范围(items, {
    startIndex: 0,
    endIndex: Math.min(items.length - 1, endIndex),
    overscan: 0,
    count: items.length,
  });
  const starts: number[] = [];
  let offset = 0;
  for (let index = 0; index < items.length; index += 1) {
    starts[index] = offset;
    offset += 估算消息行高度(items, index) + 10;
  }
  return indexes.map((index) => ({
    key: items[index]?.id ?? index,
    index,
    start: starts[index] ?? 0,
  }));
};
