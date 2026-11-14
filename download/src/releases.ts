/** What the page offers (`key` is unused since the switch from R2 to asset parts; see prepare.mjs). Bump VERSION and the keys on each release. */
export const VERSION = "0.1.0";
export const DATE = "2026-11-12";
export interface Build { id: string; label: string; detail: string; labelEn: string; detailEn: string; key: string; file: string }
export const BUILDS: Build[] = [
  { id: "mac-arm64", label: "Mac · Apple 芯片", detail: "M1 / M2 / M3 / M4，macOS 11 及以上", labelEn: "Mac · Apple silicon", detailEn: "M1 / M2 / M3 / M4, macOS 11 or later", key: `releases/${VERSION}/desk-typewriter-${VERSION}-mac-arm64.dmg`, file: "桌面打字机-Mac(Apple芯片).dmg" },
  { id: "mac-x64", label: "Mac · Intel 芯片", detail: "2020 年及以前的 Intel Mac，macOS 11 及以上", labelEn: "Mac · Intel", detailEn: "Intel Macs from 2020 or earlier, macOS 11+", key: `releases/${VERSION}/desk-typewriter-${VERSION}-mac-x64.dmg`, file: "桌面打字机-Mac(Intel芯片).dmg" },
  { id: "win", label: "Windows", detail: "Windows 10 / 11，64 位", labelEn: "Windows", detailEn: "Windows 10 / 11, 64-bit", key: `releases/${VERSION}/desk-typewriter-${VERSION}-win-x64.exe`, file: "桌面打字机-Windows安装.exe" },
];
