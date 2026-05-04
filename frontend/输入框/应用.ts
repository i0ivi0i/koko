import type { 媒体附件草稿 } from "../媒体/媒体草稿.js";

type 媒体草稿状态摘要 = Pick<媒体附件草稿, "status">;

export interface 消息输入变更请求 {
  value: string;
  写入消息输入(value: string): void;
}

export interface 发送消息请求 {
  读取媒体草稿(): ReadonlyArray<媒体草稿状态摘要>;
  读取媒体选择中数量(): number;
  触发发送(): Promise<void>;
  清空媒体草稿(): void;
}

function 发送成功后需要清空媒体草稿(
  drafts: ReadonlyArray<媒体草稿状态摘要>
): boolean {
  const hasReadyDraft = drafts.some((draft) => draft.status === "ready");
  const hasBlockingDraft = drafts.some((draft) => draft.status !== "ready");
  return hasReadyDraft && !hasBlockingDraft;
}

/**
 * 输入框应用只拥有本地输入态，不替实时编排直接发消息。
 * 这样消息草稿和发送行为就不会继续散落在聊天应用内核的大 switch 里。
 */
export function 处理消息输入变更({
  value,
  写入消息输入,
}: 消息输入变更请求): void {
  写入消息输入(value);
}

/**
 * 发送命令后的草稿清理必须收在输入框应用里：
 * 1. 先让实时编排走权威发送主链；
 * 2. 只有全部草稿都已经 ready 时，才允许把本地草稿清空；
 * 3. 仍在传输/处理中/失败的草稿不能被“顺手清掉”，否则会制造假成功。
 */
export async function 处理发送消息请求({
  读取媒体草稿,
  读取媒体选择中数量,
  触发发送,
  清空媒体草稿,
}: 发送消息请求): Promise<void> {
  /**
   * 文件刚从 picker 返回时，媒体草稿可能还没写进列表；
   * 这段过渡态如果继续放行发送，就会把纯文本先发出去，附件反而滞留在本地。
   */
  if (读取媒体选择中数量() > 0) {
    return;
  }
  const drafts = 读取媒体草稿();
  await 触发发送();
  if (发送成功后需要清空媒体草稿(drafts)) {
    清空媒体草稿();
  }
}
