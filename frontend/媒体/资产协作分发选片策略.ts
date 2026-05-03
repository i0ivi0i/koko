import type { 底层协作分发会话, 资产协作分发运行时内部 } from "./资产协作分发运行时.js";

export function 激活整附件补齐(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): void {
  const 首次进入整附件补齐 = !session.eagerCompleting;
  session.wholeFileBackfillEnabled = true;
  if (首次进入整附件补齐) {
    session.eagerCompleting = true;
    if (!runtime.已销毁) {
      runtime.actor.send({
        type: "BACKFILL_REQUESTED",
        swarmId: session.swarmId,
      });
    }
  }
  /**
   * preview-first 只抬首眼关键片段；whole-file backfill 随后接上，避免首帧被整文件下载抢预算。
   */
  激活预览关键字节优先(session);
  恢复整附件补齐(session);
}

export function 激活预览关键字节优先(session: 底层协作分发会话): void {
  if (session.previewPriorityApplied) {
    return;
  }
  session.previewPriorityApplied = true;
  for (const 区间 of 推导预览关键片段区间(session)) {
    session.torrent?.critical?.(区间.start, 区间.end);
    session.torrent?.select?.(区间.start, 区间.end, 0);
  }
}

export function 恢复整附件补齐(session: 底层协作分发会话): void {
  if (!session.wholeFileBackfillEnabled || session.wholeFileSelectApplied || !session.file) {
    return;
  }
  session.wholeFileSelectApplied = true;
  session.file.select(1);
}

function 推导预览关键片段区间(
  session: Pick<底层协作分发会话, "file" | "torrent">
): Array<{ start: number; end: number }> {
  const fallback = [{ start: 0, end: 4 }];
  const pieceLength = session.torrent?.pieceLength;
  const fileOffset = session.file?.offset;
  const fileLength = session.file?.length;
  if (
    !Number.isFinite(pieceLength) ||
    !Number.isFinite(fileOffset) ||
    !Number.isFinite(fileLength) ||
    pieceLength! <= 0 ||
    fileOffset! < 0 ||
    fileLength! <= 0
  ) {
    return fallback;
  }
  const 文件首片段 = Math.floor(fileOffset! / pieceLength!);
  const 文件尾片段 = Math.floor((fileOffset! + fileLength! - 1) / pieceLength!);
  if (文件尾片段 < 文件首片段) {
    return fallback;
  }
  const 区间列表: Array<{ start: number; end: number }> = [];
  追加预览关键片段区间(区间列表, 文件首片段, Math.min(文件首片段 + 4, 文件尾片段));
  追加预览关键片段区间(区间列表, Math.max(文件尾片段 - 4, 文件首片段), 文件尾片段);
  return 区间列表.length > 0 ? 区间列表 : fallback;
}

function 追加预览关键片段区间(
  ranges: Array<{ start: number; end: number }>,
  start: number,
  end: number
): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return;
  }
  const last = ranges.at(-1);
  if (last && start <= last.end + 1) {
    last.end = Math.max(last.end, end);
    return;
  }
  ranges.push({ start, end });
}
