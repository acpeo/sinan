import { isLinuxPlatform, isMacPlatform, isWindowsPlatform } from "./windowClient";


// 平台旗标：Windows 是主战场，零件里的平台分支共用这三条。
export const IS_MAC = isMacPlatform();
export const IS_WINDOWS = isWindowsPlatform();
export const IS_LINUX = isLinuxPlatform();
