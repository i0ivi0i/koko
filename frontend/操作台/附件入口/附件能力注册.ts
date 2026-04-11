import { 可选择图片文件类型, 可选择视频文件类型 } from "../../媒体/index.js";

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

/**
 * 附件入口的第一阶段只开放“媒体”这一种能力，
 * 但文件选择配置必须一开始就按统一媒体入口建模：
 * 1. 图片和视频共用一个 input；
 * 2. `accept` 同时覆盖图片和视频；
 * 3. `multiple=true`，避免未来再为多选能力补第二套入口。
 */
function 合并可选择媒体文件类型(): string[] {
  return Array.from(new Set([...可选择图片文件类型, ...可选择视频文件类型]));
}

export const 默认统一媒体文件选择配置: 统一媒体文件选择配置 = {
  buttonId: "composerMediaPickerBtn",
  inputId: "composerMediaFileInput",
  accept: 合并可选择媒体文件类型().join(","),
  multiple: true,
};

export function 创建附件能力注册表(): 附件能力注册表 {
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
    统一媒体文件选择配置: 默认统一媒体文件选择配置,
  };
}
