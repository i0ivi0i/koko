export type 消息视频自动播候选 = {
  attachmentId: string;
  visibilityRatio: number;
  distanceToViewportCenter: number;
};

const 默认自动播可见阈值 = 0.6;
const 默认自动播连续性可见阈值 = 0.35;
const 默认完整可见阈值 = 0.98;

const 排序自动播候选 = (
  candidates: 消息视频自动播候选[],
  preferredAttachmentId: string | null,
  options: { allowPreferredStickiness?: boolean } = {}
): 消息视频自动播候选[] => {
  const { allowPreferredStickiness = true } = options;
  const sortedCandidates = [...candidates].sort((left, right) => {
    if (left.distanceToViewportCenter !== right.distanceToViewportCenter) {
      return left.distanceToViewportCenter - right.distanceToViewportCenter;
    }
    if (left.visibilityRatio !== right.visibilityRatio) {
      return right.visibilityRatio - left.visibilityRatio;
    }
    return left.attachmentId.localeCompare(right.attachmentId);
  });
  if (
    allowPreferredStickiness &&
    preferredAttachmentId &&
    sortedCandidates.some((candidate) => candidate.attachmentId === preferredAttachmentId)
  ) {
    const preferredCandidate = sortedCandidates.find(
      (candidate) => candidate.attachmentId === preferredAttachmentId
    );
    return preferredCandidate
      ? [
          preferredCandidate,
          ...sortedCandidates.filter(
            (candidate) => candidate.attachmentId !== preferredAttachmentId
          ),
        ]
      : sortedCandidates;
  }
  return sortedCandidates;
};

const 读取自动播竞争候选 = (
  candidates: 消息视频自动播候选[],
  minVisibilityRatio: number
): 消息视频自动播候选[] => {
  const 过阈值候选 = candidates.filter(
    (candidate) => candidate.visibilityRatio >= minVisibilityRatio
  );
  /**
   * 一旦某条视频已经几乎完整进入视口，就不能再让“离中心更近但只露半屏”的候选压住它。
   * 这条规则比调大最小阈值更稳，因为它只在“完整入场”这一小段窗口里切换裁决策略。
   */
  return 过阈值候选.some((candidate) => candidate.visibilityRatio >= 默认完整可见阈值)
    ? 过阈值候选.filter((candidate) => candidate.visibilityRatio >= 默认完整可见阈值)
    : 过阈值候选;
};

/**
 * 自动播编排只回答一个问题：当前这一屏谁有资格成为唯一 owner。
 * 它不碰播放源，不碰 DOM，不碰媒体恢复逻辑，只做候选裁决。
 */
export function 选择消息视频自动播Owner(
  candidates: 消息视频自动播候选[],
  minVisibilityRatio = 默认自动播可见阈值,
  preferredAttachmentId: string | null = null
): string | null {
  return 排序自动播候选(
    读取自动播竞争候选(candidates, minVisibilityRatio),
    preferredAttachmentId
  )[0]?.attachmentId ?? null;
}

/**
 * 高竖视频交接时，视口里可能会天然出现“所有候选都低于 0.6，但又都明显可见”的 dead zone。
 * 这时如果直接返回 null，runtime 就会把 owner 清空，消息窗随即撤掉 canonical surface。
 *
 * 这里单独给出一条更低的“连续性阈值”：
 * 1. 只服务 owner 连续交接，不改变正式进入 owner 的高门槛；
 * 2. 仍然沿用同一套完整可见优先 / 离中心最近 / 可见比例更高排序；
 * 3. 刻意关闭 preferred stickiness，让 dead zone 里更接近中心的新卡片能够被挂成 pending，
 *    而不是让旧 owner 死扛到几乎离屏。
 */
export function 选择消息视频自动播连续Owner候选(
  candidates: 消息视频自动播候选[],
  minVisibilityRatio = 默认自动播连续性可见阈值
): string | null {
  return 排序自动播候选(
    读取自动播竞争候选(candidates, minVisibilityRatio),
    null,
    { allowPreferredStickiness: false }
  )[0]?.attachmentId ?? null;
}
