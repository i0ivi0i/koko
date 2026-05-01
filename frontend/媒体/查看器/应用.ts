import type { 媒体查看器打开请求 } from "../媒体查看器.js";

type 查看器附件种类 = "image" | "video";

type 查看器附件条目 = {
  attachmentId: string;
  kind: 查看器附件种类;
};

type 查看器播放结果 = {
  attachmentId: string;
  mode: string;
  src: string;
};

type 查看器媒体会话快照 = {
  playback: 查看器播放结果 | null;
};

type 查看器媒体会话端口 = {
  snapshot(): 查看器媒体会话快照;
  启动(): Promise<void> | void;
  send(event: { type: "ENTER_RECOVERING" }): void;
};

type 查看器媒体运行时上下文 = {
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPlayback: 查看器播放结果 | null;
};

export interface 媒体查看器应用依赖 {
  读取附件条目(attachmentId: string): 查看器附件条目 | null;
  读取或创建媒体会话(attachment: 查看器附件条目): 查看器媒体会话端口;
  读取媒体运行时上下文(): 查看器媒体运行时上下文;
  投影查看器请求到当前播放真相(request: 媒体查看器打开请求): 媒体查看器打开请求;
  触发视频预览收敛(attachmentId: string): void;
  接收媒体运行时事实(event: {
    type: "VIEWER_OPEN_REQUESTED";
    request: 媒体查看器打开请求;
  }): void;
}

export interface 媒体查看器应用端口 {
  打开查看器(request: 媒体查看器打开请求): void;
}

const 复制查看器请求 = (request: 媒体查看器打开请求): 媒体查看器打开请求 => ({
  startAttachmentId: request.startAttachmentId,
  items: request.items.map((item) => ({ ...item })),
});

const 启动查看器起始附件会话 = (
  deps: 媒体查看器应用依赖,
  request: 媒体查看器打开请求
): void => {
  const startAttachment = deps.读取附件条目(request.startAttachmentId);
  if (!startAttachment) {
    return;
  }
  const session = deps.读取或创建媒体会话(startAttachment);
  const snapshot = session.snapshot();
  if (!snapshot.playback) {
    void session.启动();
    return;
  }
  if (startAttachment.kind !== "video") {
    return;
  }
  /**
   * 显式 viewer open 必须拿回正式裁决权：
   * 1. 旧 playback 可能已经过期、被删除或绑定了旧 ticket；
   * 2. 只有 viewer 自己点开时，才值得把这条会话重新打回 recovering；
   * 3. 普通时间线渲染不能偷用这条逻辑，否则会把轻量表面放大成持续重裁。
   */
  session.send({ type: "ENTER_RECOVERING" });
};

const 补启动查看器正式会话Consumer = (
  deps: 媒体查看器应用依赖,
  request: 媒体查看器打开请求
): void => {
  const startAttachment = deps.读取附件条目(request.startAttachmentId);
  if (!startAttachment || startAttachment.kind !== "video") {
    return;
  }
  const session = deps.读取或创建媒体会话(startAttachment);
  if (session.snapshot().playback) {
    return;
  }
  /**
   * 命中热自动播时，viewer 只是在接管同一条热链：
   * 1. 这时不能先打回 recovering，否则会把热源白白打冷；
   * 2. 但 viewer 仍要补到自己的正式 consumer，防止自动播释放后 route 也跟着掉。
   */
  void session.启动();
};

const 当前请求命中热自动播会话 = (
  deps: 媒体查看器应用依赖,
  request: 媒体查看器打开请求
): boolean => {
  const startAttachment = deps.读取附件条目(request.startAttachmentId);
  if (!startAttachment || startAttachment.kind !== "video") {
    return false;
  }
  const 当前媒体运行时上下文 = deps.读取媒体运行时上下文();
  if (当前媒体运行时上下文.inlineAutoplayOwnerAttachmentId !== request.startAttachmentId) {
    return false;
  }
  const 当前自动播播放 = 当前媒体运行时上下文.inlineAutoplayPlayback;
  if (!当前自动播播放 || 当前自动播播放.attachmentId !== request.startAttachmentId) {
    return false;
  }
  const session = deps.读取或创建媒体会话(startAttachment);
  const snapshot = session.snapshot();
  /**
   * “热自动播命中”只接受同一附件、同一正式热链：
   * 1. 如果媒体会话自己还没拿到 playback，允许 viewer 直接吃 runtime 已经确认的 swarm 热源；
   * 2. 一旦媒体会话已有 playback，就必须确认 src/mode 仍然一致；
   * 3. 只要有漂移，就回到 viewer recovering，让正式 owner 重新判案。
   */
  if (!snapshot.playback) {
    return 当前自动播播放.mode === "swarm";
  }
  return (
    snapshot.playback.mode === 当前自动播播放.mode &&
    snapshot.playback.src === 当前自动播播放.src
  );
};

/**
 * 查看器应用只拥有“打开 viewer 时该走哪条媒体会话主链”这条交互真相：
 * 1. 是否复用热自动播；
 * 2. 是否把起始附件打回 recovering；
 * 3. 打开请求投影到当前播放真相后，再交回媒体运行时。
 *
 * 它不拥有 DOM、播放器壳、PhotoSwipe、Video.js，也不拥有真正的媒体分发真相。
 */
export function 创建媒体查看器应用(
  deps: 媒体查看器应用依赖
): 媒体查看器应用端口 {
  return {
    打开查看器(request: 媒体查看器打开请求): void {
      const baseRequest = 复制查看器请求(request);
      if (当前请求命中热自动播会话(deps, baseRequest)) {
        补启动查看器正式会话Consumer(deps, baseRequest);
      } else {
        启动查看器起始附件会话(deps, baseRequest);
      }
      const nextRequest = deps.投影查看器请求到当前播放真相(baseRequest);
      if (deps.读取附件条目(request.startAttachmentId)?.kind === "video") {
        deps.触发视频预览收敛(request.startAttachmentId);
      }
      deps.接收媒体运行时事实({
        type: "VIEWER_OPEN_REQUESTED",
        request: nextRequest,
      });
    },
  };
}
