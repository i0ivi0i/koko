export type 消息视频自动播候选 = {
  attachmentId: string;
  visibilityRatio: number;
  distanceToViewportCenter: number;
};

const 默认自动播可见阈值 = 0.6;

/**
 * 自动播编排只回答一个问题：当前这一屏谁有资格成为唯一 owner。
 * 它不碰播放源，不碰 DOM，不碰媒体恢复逻辑，只做候选裁决。
 */
export function 选择消息视频自动播Owner(
  candidates: 消息视频自动播候选[],
  minVisibilityRatio = 默认自动播可见阈值
): string | null {
  const 可进入竞争的候选 = candidates
    .filter((candidate) => candidate.visibilityRatio >= minVisibilityRatio)
    .sort((left, right) => {
      if (left.distanceToViewportCenter !== right.distanceToViewportCenter) {
        return left.distanceToViewportCenter - right.distanceToViewportCenter;
      }
      if (left.visibilityRatio !== right.visibilityRatio) {
        return right.visibilityRatio - left.visibilityRatio;
      }
      return left.attachmentId.localeCompare(right.attachmentId);
    });

  return 可进入竞争的候选[0]?.attachmentId ?? null;
}
