export type 生命周期可见性 = "visible" | "hidden";
export type 生命周期阶段 =
  | "active"
  | "background"
  | "page_hidden"
  | "frozen"
  | "resumed";

export interface 生命周期快照 {
  visibility: 生命周期可见性;
  phase: 生命周期阶段;
}

type 可监听窗口 = Pick<Window, "addEventListener">;
type 可监听文档 = Pick<Document, "addEventListener"> & {
  visibilityState?: DocumentVisibilityState;
};

export interface 生命周期运行时依赖 {
  window?: 可监听窗口;
  document?: 可监听文档;
}

export interface 生命周期运行时 {
  snapshot(): 生命周期快照;
  订阅(listener: (snapshot: 生命周期快照) => void): () => void;
}

const 从文档派生可见性 = (documentTarget: 可监听文档 | undefined): 生命周期可见性 =>
  documentTarget?.visibilityState === "hidden" ? "hidden" : "visible";

/**
 * 生命周期运行时只回答“浏览器当前处在哪个运行阶段”。
 * 它不解释房间恢复、未读、补洞这些聊天语义，只把浏览器信号收口成稳定快照。
 */
export function 创建生命周期运行时(
  deps: 生命周期运行时依赖 = {}
): 生命周期运行时 {
  const windowTarget =
    deps.window ?? (typeof window !== "undefined" ? window : undefined);
  const documentTarget =
    deps.document ?? (typeof document !== "undefined" ? document : undefined);

  let current: 生命周期快照 = {
    visibility: 从文档派生可见性(documentTarget),
    phase: 从文档派生可见性(documentTarget) === "hidden" ? "background" : "active",
  };
  const listeners = new Set<(snapshot: 生命周期快照) => void>();

  const 发布快照 = (): void => {
    const snapshot = { ...current };
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const 更新快照 = (patch: Partial<生命周期快照>): void => {
    current = { ...current, ...patch };
    发布快照();
  };

  documentTarget?.addEventListener("visibilitychange", () => {
    const visibility = 从文档派生可见性(documentTarget);
    更新快照({
      visibility,
      phase: visibility === "hidden" ? "background" : "active",
    });
  });

  windowTarget?.addEventListener("pagehide", () => {
    更新快照({
      visibility: "hidden",
      phase: "page_hidden",
    });
  });

  windowTarget?.addEventListener("pageshow", () => {
    更新快照({
      visibility: 从文档派生可见性(documentTarget),
      phase: "active",
    });
  });

  windowTarget?.addEventListener("freeze", () => {
    更新快照({
      visibility: "hidden",
      phase: "frozen",
    });
  });

  windowTarget?.addEventListener("resume", () => {
    更新快照({
      visibility: 从文档派生可见性(documentTarget),
      phase: "resumed",
    });
  });

  return {
    snapshot(): 生命周期快照 {
      return { ...current };
    },

    订阅(listener: (snapshot: 生命周期快照) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
