export type 消息视频自动播候选 = {
  attachmentId: string;
  visibilityRatio: number;
  distanceToViewportCenter: number;
};

const 默认自动播可见阈值 = 0.6;
const 默认完整可见阈值 = 0.98;

/**
 * 自动播编排只回答一个问题：当前这一屏谁有资格成为唯一 owner。
 * 它不碰播放源，不碰 DOM，不碰媒体恢复逻辑，只做候选裁决。
 */
export function 选择消息视频自动播Owner(
  candidates: 消息视频自动播候选[],
  minVisibilityRatio = 默认自动播可见阈值,
  preferredAttachmentId: string | null = null
): string | null {
  const 过阈值候选 = candidates.filter(
    (candidate) => candidate.visibilityRatio >= minVisibilityRatio
  );
  /**
   * 一旦某条视频已经几乎完整进入视口，就不能再让“离中心更近但只露半屏”的候选压住它。
   * 这条规则比调大最小阈值更稳，因为它只在“完整入场”这一小段窗口里切换裁决策略。
   */
  const 可进入竞争的候选 = (
    过阈值候选.some((candidate) => candidate.visibilityRatio >= 默认完整可见阈值)
      ? 过阈值候选.filter(
          (candidate) => candidate.visibilityRatio >= 默认完整可见阈值
        )
      : 过阈值候选
  )
    .sort((left, right) => {
      if (left.distanceToViewportCenter !== right.distanceToViewportCenter) {
        return left.distanceToViewportCenter - right.distanceToViewportCenter;
      }
      if (left.visibilityRatio !== right.visibilityRatio) {
        return right.visibilityRatio - left.visibilityRatio;
      }
      return left.attachmentId.localeCompare(right.attachmentId);
    });

  if (
    preferredAttachmentId &&
    可进入竞争的候选.some((candidate) => candidate.attachmentId === preferredAttachmentId)
  ) {
    return preferredAttachmentId;
  }

  return 可进入竞争的候选[0]?.attachmentId ?? null;
}
