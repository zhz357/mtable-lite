//
// updater.js — 版本更新：检查最新版本 / 版本号比较 / 应用内下载安装包
//
import { api, BASE_URL } from './api.js';

/** 当前应用版本号（来自 package.json，经主进程 app.getVersion() 暴露） */
export function currentVersion() {
  return window.mtable?.appVersion || '';
}

/** 当前运行平台：'darwin' | 'win32' | ... */
export function currentPlatform() {
  return window.mtable?.platform || 'unknown';
}

/**
 * 版本号比较：a 大于 b 返回 1，小于返回 -1，相等返回 0
 * 非法版本号按 0 处理；段数不齐按 0 补齐
 */
export function compareVersions(a, b) {
  const parse = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

/**
 * 检查更新：请求服务端最新版本并与本地版本比较
 * @returns {{ hasUpdate: boolean, latest: Object, current: string }}
 */
export async function checkUpdate() {
  const latest = await api.getLatestVersion();
  const current = currentVersion();
  const hasUpdate = !!latest?.version && compareVersions(latest.version, current) > 0;
  return { hasUpdate, latest, current };
}

/** 版本号 patch 位 +1（如 1.0.0 → 1.0.1） */
export function bumpVersion(v) {
  const parts = String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.slice(0, 3).join('.');
}

/** 相对地址转完整下载地址 */
function toAbsolute(url) {
  return /^https?:\/\//i.test(url) ? url : `${BASE_URL}${url}`;
}

/** 从下载地址提取文件名 */
export function fileNameOf(url) {
  return decodeURIComponent(toAbsolute(url).split('/').pop().split('?')[0]);
}

/** 格式化文件大小（字节 → 可读文本） */
export function fmtSize(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return '';
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(Number(bytes) / 1024).toFixed(0)} KB`;
}

/**
 * 下载安装包：优先走应用内下载（主进程，带进度回调与大小校验），非 Electron 环境退化为系统浏览器
 * @param {string} url 下载地址（相对或绝对）
 * @param {Function} [onProgress] 进度回调 ({ percent, received, total, done, success })
 * @param {number} [expectedSize] 服务端记录的文件字节数，用于完整性校验（0/空 = 不校验）
 */
export async function downloadInstaller(url, onProgress, expectedSize = 0) {
  const full = toAbsolute(url);
  const filename = fileNameOf(url);
  if (!window.mtable?.downloadApp) {
    window.open(full); // 非 Electron 环境：交给系统浏览器下载
    return;
  }
  const unsubscribe = onProgress
    ? window.mtable.onDownloadProgress((p) => onProgress(p))
    : null;
  try {
    await window.mtable.downloadApp(full, filename, expectedSize);
  } finally {
    unsubscribe?.();
  }
}

/** 按当前平台挑选安装包，返回 { url, size, label } 或 null */
export function installerForPlatform(latest, platform = currentPlatform()) {
  if (!latest) return null;
  if (platform === 'darwin' && latest.macUrl) {
    return {
      url: latest.macUrl,
      size: latest.macSize || 0,
      label: `macOS 安装包${latest.macSize ? `（${fmtSize(latest.macSize)}）` : ''}`,
    };
  }
  if (platform === 'win32' && latest.winUrl) {
    return {
      url: latest.winUrl,
      size: latest.winSize || 0,
      label: `Windows 安装包${latest.winSize ? `（${fmtSize(latest.winSize)}）` : ''}`,
    };
  }
  return null;
}
