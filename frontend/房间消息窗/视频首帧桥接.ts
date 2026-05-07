export type 预览首帧桥接宿主 = {
  归一化时间线视频播放源(src: string | null): string | null;
  捕获时间线自动播冻结帧(
    attachmentId: string,
    video: HTMLVideoElement,
    options?: { 预热已合成帧?: boolean; 立即提交?: boolean }
  ): void;
  标记时间线视频首帧已就绪(attachmentId: string, src: string | null): void;
};

export const 标记当前预览视频已出首帧 = (
  context: 预览首帧桥接宿主,
  attachmentId: string,
  target: HTMLVideoElement
): void => {
  const 预热时间线冻结桥 = (): void => {
    if (!Number.isFinite(target.currentTime) || target.readyState < target.HAVE_CURRENT_DATA) {
      return;
    }
    context.捕获时间线自动播冻结帧(attachmentId, target, { 预热已合成帧: true });
  };
  const currentSrc = target.currentSrc || target.getAttribute("src");
  const readySrc = context.归一化时间线视频播放源(currentSrc);
  if (readySrc) {
    target.dataset.previewReadySrc = readySrc;
    if (target.dataset.previewCommittedSrc && target.dataset.previewCommittedSrc !== readySrc) {
      delete target.dataset.previewCommittedSrc;
    }
    if (
      "requestVideoFrameCallback" in target &&
      typeof target.requestVideoFrameCallback === "function"
    ) {
      if (target.dataset.previewCommitPendingSrc !== readySrc) {
        target.dataset.previewCommitPendingSrc = readySrc;
        target.requestVideoFrameCallback(() => {
          if (!target.isConnected) {
            return;
          }
          const latestSrc = context.归一化时间线视频播放源(
            target.currentSrc || target.getAttribute("src")
          );
          if (!latestSrc || latestSrc !== readySrc || target.dataset.previewSrc !== readySrc) {
            return;
          }
          delete target.dataset.previewCommitPendingSrc;
          target.dataset.previewCommittedSrc = readySrc;
          预热时间线冻结桥();
          context.标记时间线视频首帧已就绪(attachmentId, latestSrc);
        });
      }
    } else if (target.readyState >= 2) {
      target.dataset.previewCommittedSrc = readySrc;
      预热时间线冻结桥();
    }
  }
  context.标记时间线视频首帧已就绪(attachmentId, currentSrc);
};
