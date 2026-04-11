export type 附件能力标识 = "media";

export type 附件能力触发策略 = "direct";

export interface 附件能力定义 {
  id: 附件能力标识;
  label: string;
  ariaLabel: string;
  triggerStrategy: 附件能力触发策略;
}

export interface 统一媒体文件选择配置 {
  buttonId: string;
  inputId: string;
  accept: string;
  multiple: boolean;
}

export interface 附件能力注册表 {
  默认能力标识: 附件能力标识;
  能力列表: 附件能力定义[];
  统一媒体文件选择配置: 统一媒体文件选择配置;
}

type 附件入口运行环境 = {
  userAgent?: string;
  maxTouchPoints?: number;
};

function 读取当前附件入口运行环境(): 附件入口运行环境 {
  const navigatorRef = globalThis.navigator;
  return {
    userAgent: navigatorRef?.userAgent ?? "",
    maxTouchPoints: navigatorRef?.maxTouchPoints ?? 0,
  };
}

function 是可能兼容性较弱的移动媒体选择环境(env: 附件入口运行环境): boolean {
  const userAgent = (env.userAgent ?? "").trim().toLowerCase();
  const maxTouchPoints = Number.isFinite(env.maxTouchPoints) ? Number(env.maxTouchPoints) : 0;
  const 是苹果移动端 =
    /(iphone|ipad|ipod)/u.test(userAgent) ||
    (userAgent.includes("macintosh") && maxTouchPoints > 1);
  const 是其他移动端 = /(android|mobile|harmony)/u.test(userAgent);
  return 是苹果移动端 || 是其他移动端;
}

function 构造统一媒体文件Accept(): string {
  /**
   * 移动端系统 picker 对长 `accept` 列表的兼容性并不稳定，
   * 这里统一收口成最宽但最稳的媒体类型提示：
   * - 图片交给 `image/*`
   * - 视频交给 `video/*`
   *
   * HEIC/HEIF 的兜底继续留在选中文件后的预处理阶段，不再把扩展名过滤硬塞进 picker。
   */
  return ["image/*", "video/*"].join(",");
}

/**
 * 附件入口的第一阶段只开放“媒体”这一种能力，
 * 但文件选择配置必须一开始就按统一媒体入口建模：
 * 1. 图片和视频共用一个 input；
 * 2. `accept` 收口成宽类型媒体提示，避免长过滤列表反向伤害系统 picker；
 * 3. 多选能力按运行环境降级，移动端优先稳定单选，桌面端继续保留多选。
 */
function 构造统一媒体文件选择配置(
  env: 附件入口运行环境
): 统一媒体文件选择配置 {
  return {
    buttonId: "composerMediaPickerBtn",
    inputId: "composerMediaFileInput",
    accept: 构造统一媒体文件Accept(),
    multiple: !是可能兼容性较弱的移动媒体选择环境(env),
  };
}

export const 默认统一媒体文件选择配置: 统一媒体文件选择配置 = {
  buttonId: "composerMediaPickerBtn",
  inputId: "composerMediaFileInput",
  accept: 构造统一媒体文件Accept(),
  multiple: true,
};

export function 创建附件能力注册表(
  env: 附件入口运行环境 = 读取当前附件入口运行环境()
): 附件能力注册表 {
  return {
    默认能力标识: "media",
    能力列表: [
      {
        id: "media",
        label: "媒体",
        ariaLabel: "选择图片或视频",
        triggerStrategy: "direct",
      },
    ],
    统一媒体文件选择配置: 构造统一媒体文件选择配置(env),
  };
}
