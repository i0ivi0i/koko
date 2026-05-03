import type {
  资产协作分发快照,
  资产协作分发运行时内部,
} from "./资产协作分发运行时.js";

export const 读取资产协作分发预算 = (
  runtime: 资产协作分发运行时内部,
  snapshot: 资产协作分发快照 = runtime.actor.getSnapshot()
) => {
  const sessions = Object.values(snapshot.context.sessions);
  let wholeFileHeavySessionCount = 0;
  let zeroRefHeavySessionCount = 0;
  let zeroRefLightHelpSessionCount = 0;

  for (const session of sessions) {
    const isZeroRef = session.consumers.length === 0;
    const internalSession = runtime.底层会话表.get(session.swarmId);
    const wholeFileHeavyActive = internalSession?.wholeFileBackfillEnabled === true;
    const canStayAsLightHelp =
      isZeroRef && (session.eagerCompleting || session.locallyComplete);
    if (wholeFileHeavyActive) {
      wholeFileHeavySessionCount += 1;
      if (isZeroRef) {
        zeroRefHeavySessionCount += 1;
      }
    }
    if (canStayAsLightHelp && !wholeFileHeavyActive) {
      zeroRefLightHelpSessionCount += 1;
    }
  }
  return {
    activeSwarmCount: sessions.length,
    hiddenHeavyTaskCount:
      snapshot.context.heavyWorkPolicy === "normal" ? 0 : wholeFileHeavySessionCount,
    wholeFileHeavySessionCount,
    zeroRefHeavySessionCount,
    zeroRefLightHelpSessionCount,
    // 预算只看当前底层 whole-file select 是否仍激活，避免把零引用轻帮助误算成重 reader。
    zeroRefWholeFileReaderCount: sessions.reduce((count, session) => {
      if (session.consumers.length !== 0) {
        return count;
      }
      const internalSession = runtime.底层会话表.get(session.swarmId);
      return internalSession?.wholeFileSelectApplied ? count + 1 : count;
    }, 0),
  };
};
