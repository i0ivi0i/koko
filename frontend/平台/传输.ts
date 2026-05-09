import type { Socket } from "socket.io-client";
import type {
  附件快照,
  消息事件,
  媒体附件上传结果,
  媒体附件转发请求,
  媒体附件转发结果,
  媒体定位结果,
  媒体SourceHash复用请求,
  媒体SourceHash复用结果,
  媒体SourceHash信息,
  媒体上传准备结果,
  媒体种类,
  预览资源描述,
  后台概览,
  后台房间列表,
  后台房间详情,
  后台登录结果,
} from "../聊天共享/契约.js";
import { 实时连接适配 } from "../聊天实时/适配/实时连接适配.js";
import type {
  聊天房间传输端口,
} from "../聊天共享/适配/聊天房间传输端口.js";
import type {
  聊天实时连接端口,
  实时连接运行时策略,
} from "../聊天共享/适配/聊天实时连接端口.js";
import { 创建房间HTTP接口 } from "../聊天恢复/适配/房间HTTP接口.js";
import { 媒体HTTP接口 } from "../媒体/适配/媒体HTTP接口.js";
import { 后台HTTP接口 } from "../后台/适配/后台HTTP接口.js";
import { 创建PoW门禁 } from "../连接门禁/pow门禁.js";

type 接口错误响应 = {
  code?: string;
  message?: string;
};

/**
 * HTTP 失败要把状态码和稳定错误码一起带回壳层。
 * 这样恢复分类器才能区分“硬失效”与“临时失败”，而不是只看到一串模糊字符串。
 */
export class Http接口错误 extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "Http接口错误";
  }
}

/**
 * 媒体传输端口只承接上传、定位和附件内容地址构建。
 * 这里继续保留最薄的 adapter 语义，不倒灌聊天房间或后台管理能力。
 */
export interface 媒体传输端口 {
  prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File,
    sourceHash?: 媒体SourceHash信息
  ): Promise<媒体上传准备结果>;
  reuseMediaBySourceHash(
    kind: 媒体种类,
    input: 媒体SourceHash复用请求
  ): Promise<媒体SourceHash复用结果>;
  forwardMediaAttachment(
    kind: 媒体种类,
    input: 媒体附件转发请求
  ): Promise<媒体附件转发结果>;
  abandonMediaUpload(sessionId: string, attachmentId: string): Promise<void>;
  completeMediaUpload(sessionId: string, attachmentId: string): Promise<媒体附件上传结果>;
  loadMediaLocator(
    sessionId: string,
    attachmentId: string,
    signal?: AbortSignal
  ): Promise<媒体定位结果>;
  buildAttachmentContentUrl(
    attachmentId: string,
    sessionId: string,
    variant?: "original" | "thumbnail"
  ): string;
}

/**
 * 后台查询传输端口只承接后台只读查询。
 * 登录留在单独窄口，避免后台调用方又退回“全拿一份巨型 transport”。
 */
export interface 后台查询传输端口 {
  loadAdminOverview(token: string): Promise<后台概览>;
  adminRooms(token: string): Promise<后台房间列表>;
  adminRoomDetail(token: string, roomId: string): Promise<后台房间详情>;
}

/**
 * 后台会话传输端口只承接登录。
 * 这样后台会话编排不会顺手看到概览/房间详情等查询能力。
 */
export interface 后台会话传输端口 {
  adminLogin(username: string, password: string): Promise<后台登录结果>;
}

/**
 * 正式组合根仍然是 `前端传输端口`。
 * 调用侧应该直接用 TypeScript 的结构类型收窄到自己那一小截能力，
 * 不再保留“只是返回自己”的纯包装层。
 */
export interface 前端传输端口
  extends 聊天房间传输端口,
    聊天实时连接端口,
    媒体传输端口,
    后台查询传输端口,
    后台会话传输端口 {}

export type { 聊天房间传输端口, 聊天实时连接端口, 实时连接运行时策略 };

const 创建绝对地址解析器 = (baseUrl: string) => (pathOrUrl: string): string =>
  new URL(pathOrUrl, baseUrl).href;

const 创建预览资源解析器 =
  (解析绝对地址: (pathOrUrl: string) => string) =>
  (preview: 预览资源描述 | null | undefined): 预览资源描述 | null => {
    if (!preview) {
      return null;
    }
    return {
      ...preview,
      still_url: 解析绝对地址(preview.still_url),
    };
  };

const 创建附件快照解析器 =
  (解析预览资源: (preview: 预览资源描述 | null | undefined) => 预览资源描述 | null) =>
  (attachment: 附件快照): 附件快照 => ({
    ...attachment,
    preview_asset: 解析预览资源(attachment.preview_asset),
  });

const 创建消息事件解析器 =
  (解析附件快照: (attachment: 附件快照) => 附件快照) =>
  (event: 消息事件): 消息事件 => {
    const attachments = event.attachments?.map((attachment) => 解析附件快照(attachment));
    return {
      ...event,
      /**
       * `消息事件.attachments` 在共享契约里是“可选字段”，不是“必有但值可为 undefined”。
       * 这里按 contract 原语义投影，避免 exactOptionalPropertyTypes 下长出脏形状。
       */
      ...(attachments ? { attachments } : {}),
    };
  };

const 创建房间结果解析器 = (
  解析消息事件: (event: 消息事件) => 消息事件
): Pick<
  Parameters<typeof 创建房间HTTP接口>[0],
  "解析房间快照" | "解析增量事件快照" | "解析房间历史页"
> => ({
  解析房间快照: (snapshot) => ({
    ...snapshot,
    snapshot_messages: snapshot.snapshot_messages.map((event) => 解析消息事件(event)),
  }),
  解析增量事件快照: (snapshot) => ({
    ...snapshot,
    events: snapshot.events.map((event) => 解析消息事件(event)),
  }),
  解析房间历史页: (page) => ({
    ...page,
    messages: page.messages.map((event) => 解析消息事件(event)),
  }),
});

const 创建HTTP错误构造器 =
  (baseUrl: string) =>
  async (
    method: "GET" | "POST",
    path: string,
    response: Response
  ): Promise<Http接口错误> => {
    let code = `http_${response.status}`;
    let message = `${method} ${new URL(path, baseUrl).pathname} failed: ${response.status}`;
    try {
      const payload = (await response.json()) as 接口错误响应;
      if (typeof payload.code === "string" && payload.code.trim()) {
        code = payload.code;
      }
      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      // 某些 5xx 可能没有 JSON；此时退回通用 HTTP 错误即可。
    }
    return new Http接口错误(response.status, code, message);
  };

const 创建JSON接口 = (baseUrl: string) => {
  const 构造HTTP错误 = 创建HTTP错误构造器(baseUrl);
  return {
    async get<T>(
      path: string,
      headers: Record<string, string> = {},
      signal?: AbortSignal
    ): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        headers,
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        throw await 构造HTTP错误("GET", path, response);
      }
      return (await response.json()) as T;
    },

    async post<T>(path: string, body: object): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw await 构造HTTP错误("POST", path, response);
      }
      return (await response.json()) as T;
    },
  };
};

/**
 * 前端传输组合根只负责把现成的 realtime / room / media / admin adapter 拼起来。
 * 调用侧继续直接消费稳定端口，不再继续依赖一个超大 class 自己拥有所有细节。
 * 这个 owner 现在归 `frontend/平台/传输.ts`，因为它表达的是“浏览器这一侧如何组装 transport”。
 */
export function 创建前端传输(baseUrl: string): 前端传输端口 {
  const 实时连接 = new 实时连接适配(baseUrl);
  const { get, post } = 创建JSON接口(baseUrl);
  const 解析绝对地址 = 创建绝对地址解析器(baseUrl);
  const 解析预览资源 = 创建预览资源解析器(解析绝对地址);
  const 解析附件快照 = 创建附件快照解析器(解析预览资源);
  const 解析消息事件 = 创建消息事件解析器(解析附件快照);
  const 房间传输 = 创建房间HTTP接口({
    get,
    post,
    ...创建房间结果解析器(解析消息事件),
  });
  const 媒体传输 = new 媒体HTTP接口({
    get,
    post,
    解析绝对地址,
    解析预览资源,
  });
  const 后台传输 = new 后台HTTP接口({
    get,
    post,
  });

  return {
    ...房间传输,
    prepareMediaUpload: (kind, sessionId, file, sourceHash) =>
      媒体传输.prepareMediaUpload(kind, sessionId, file, sourceHash),
    reuseMediaBySourceHash: (kind, input) =>
      媒体传输.reuseMediaBySourceHash(kind, input),
    forwardMediaAttachment: (kind, input) =>
      媒体传输.forwardMediaAttachment(kind, input),
    abandonMediaUpload: (sessionId, attachmentId) =>
      媒体传输.abandonMediaUpload(sessionId, attachmentId),
    completeMediaUpload: (sessionId, attachmentId) =>
      媒体传输.completeMediaUpload(sessionId, attachmentId),
    loadMediaLocator: (sessionId, attachmentId, signal) =>
      媒体传输.loadMediaLocator(sessionId, attachmentId, signal),
    buildAttachmentContentUrl: (
      attachmentId,
      sessionId,
      variant: "original" | "thumbnail" = "original"
    ) => {
      const params = new URLSearchParams({
        session_id: sessionId,
        variant,
      });
      return `${baseUrl}/api/attachments/${attachmentId}/content?${params.toString()}`;
    },
    loadAdminOverview: (token) => 后台传输.loadAdminOverview(token),
    adminLogin: (username, password) => 后台传输.adminLogin(username, password),
    adminRooms: (token) => 后台传输.adminRooms(token),
    adminRoomDetail: (token, roomId) => 后台传输.adminRoomDetail(token, roomId),
    createSocket: (sessionId: string, powToken?: string): Socket =>
      实时连接.createSocket(sessionId, powToken),
    接收运行时策略: (policy) => {
      实时连接.接收运行时策略(policy);
    },
    读取运行时策略: () => 实时连接.读取运行时策略(),
    释放Socket: (socket) => {
      实时连接.释放Socket(socket);
    },
    // PoW 门禁：服务端防御启用时，获取 challenge 并解题的 /api/pow/challenge 404 说明服务端没启用防御。
    // 本地开发无 KOKO_POW_SECRET 时服务端不注册 PoW 路由，前端正常走无 token 连接路径。
    获取PowToken: (() => {
      const pow = 创建PoW门禁(baseUrl);
      // 先探测服务端是否启用了 PoW 防御，404 则跳过。
      let 服务端已启用: boolean | null = null;
      return async (): Promise<string> => {
        if (服务端已启用 === false) {
          return "";
        }
        try {
          const token = await pow.获取token();
          服务端已启用 = true;
          return token;
        } catch (err) {
          // challenge 请求 404 说明服务端没启用防御（开发模式），跳过。
          if (服务端已启用 === null) {
            服务端已启用 = false;
            return "";
          }
          throw err;
        }
      };
    })(),
  };
}
