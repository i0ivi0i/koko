const 协作分发WebRtc关闭降噪安装标记 = Symbol.for(
  "koko.media.webrtc.expected-close-dampening.installed"
);
const 协作分发WebRtc通道降噪绑定标记 = Symbol.for(
  "koko.media.webrtc.expected-close-dampening.channel-bound"
);

type 可补丁RTCPeerConnection原型 = {
  createDataChannel?: (...args: unknown[]) => 可降噪RTCDataChannel;
  [协作分发WebRtc关闭降噪安装标记]?: true;
};

type 可补丁RTCPeerConnection构造器 = {
  prototype?: 可补丁RTCPeerConnection原型;
};

type 可降噪RTCDataChannel = EventTarget & {
  [协作分发WebRtc通道降噪绑定标记]?: true;
};

type RTC错误事件载体 = Event & {
  error?: unknown;
  message?: string;
};

type RTCDataChannel事件载体 = {
  channel?: unknown;
};

const 读取对象字段 = (input: unknown, field: string): unknown =>
  input && typeof input === "object" ? (input as Record<string, unknown>)[field] : undefined;

const 读取RTC错误消息 = (input: unknown): string => {
  if (input instanceof Error) {
    return input.message;
  }
  const message = 读取对象字段(input, "message");
  if (typeof message === "string") {
    return message;
  }
  return typeof input === "string" ? input : "";
};

const 是否为协作分发WebRtc预期关闭错误 = (event: RTC错误事件载体): boolean => {
  const error = event.error ?? event;
  const message = 读取RTC错误消息(error) || 读取RTC错误消息(event);
  const detail = 读取对象字段(error, "errorDetail");
  const sctpCauseCode = 读取对象字段(error, "sctpCauseCode");
  return (
    message.includes("User-Initiated Abort") ||
    (detail === "sctp-failure" && sctpCauseCode === 12)
  );
};

const 绑定RTCDataChannel预期关闭降噪 = (channel: unknown): void => {
  if (!(channel instanceof EventTarget)) {
    return;
  }
  const target = channel as 可降噪RTCDataChannel;
  if (target[协作分发WebRtc通道降噪绑定标记]) {
    return;
  }
  Object.defineProperty(target, 协作分发WebRtc通道降噪绑定标记, {
    value: true,
  });
  target.addEventListener(
    "error",
    (event) => {
      /**
       * WebTorrent/WebRTC data channel 在正常关闭时可能抛出
       * `User-Initiated Abort`。这是已知退场信号，不再继续交给上层 error 链。
       */
      if (是否为协作分发WebRtc预期关闭错误(event as RTC错误事件载体)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true }
  );
};

const 读取原型链属性描述符 = (
  proto: object,
  property: PropertyKey
): PropertyDescriptor | undefined => {
  let current: object | null = proto;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
};

export function 安装协作分发WebRtc关闭降噪(scope: typeof globalThis = globalThis): void {
  const ctor = 读取对象字段(scope, "RTCPeerConnection") as
    | 可补丁RTCPeerConnection构造器
    | undefined;
  const proto = ctor?.prototype;
  if (!proto || proto[协作分发WebRtc关闭降噪安装标记]) {
    return;
  }
  Object.defineProperty(proto, 协作分发WebRtc关闭降噪安装标记, {
    value: true,
  });

  const originalCreateDataChannel = proto.createDataChannel;
  if (typeof originalCreateDataChannel === "function") {
    Object.defineProperty(proto, "createDataChannel", {
      configurable: true,
      value(this: unknown, ...args: unknown[]) {
        const channel = originalCreateDataChannel.apply(this, args);
        绑定RTCDataChannel预期关闭降噪(channel);
        return channel;
      },
    });
  }

  const originalOnDataChannel = 读取原型链属性描述符(proto, "ondatachannel");
  const fallbackOnDataChannel = new WeakMap<object, unknown>();
  Object.defineProperty(proto, "ondatachannel", {
    configurable: true,
    get(this: object) {
      return originalOnDataChannel?.get
        ? originalOnDataChannel.get.call(this)
        : fallbackOnDataChannel.get(this) ?? null;
    },
    set(this: object, handler: unknown) {
      const wrapped =
        typeof handler === "function"
          ? function (this: unknown, event: RTCDataChannel事件载体) {
              绑定RTCDataChannel预期关闭降噪(event?.channel);
              return handler.call(this, event);
            }
          : handler;
      fallbackOnDataChannel.set(this, wrapped);
      originalOnDataChannel?.set?.call(this, wrapped);
    },
  });
}
