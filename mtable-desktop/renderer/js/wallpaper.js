//
// wallpaper.js — 壁纸模块：账号级壁纸设置的加载 / 应用 / 保存
//
// 设计要点：
// - 壁纸层 DOM（.wp-layer）由 MainView 创建并插入内容区最底层，本模块负责
//   往该层写入背景图与亮度/模糊滤镜；
// - 启动时先用 localStorage 缓存即时应用（避免登录后白屏闪烁），
//   再异步拉取服务端最新设置覆盖（"跟随每日"模式下壁纸可能已更新）；
// - 仅在 body.wp-on 时渲染壁纸与半透明卡片（wallpaper.css），默认态零影响；
// - 登出时调用 clearWallpaper() 还原（登录/注册页不铺壁纸）。
//
import { api, BASE_URL } from './api.js';

const CACHE_KEY = 'com.mtable.wallpaper';

/** 最近一次生效的设置：{ enabled, pinnedImageId, brightness, blur, url, title, mode } */
let current = null;

/** 保存防抖定时器（设置页滑杆连续拖动时合并保存） */
let saveTimer = null;

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

function writeCache(wp) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(wp)); } catch { /* 忽略容量错误 */ }
}

/** 服务端 VO → 本地设置对象 */
function normalize(vo) {
  if (!vo) return null;
  return {
    enabled: !!vo.enabled,
    pinnedImageId: vo.pinnedImageId ?? null,
    brightness: vo.brightness ?? 100,
    blur: vo.blur ?? 0,
    url: vo.url ?? null,
    title: vo.title ?? null,
    mode: vo.pinnedImageId != null ? 'pinned' : 'auto',
  };
}

/**
 * 将设置应用到 DOM（纯本地，不打后端）。
 * 开启但暂无可用壁纸时不显示壁纸（回退默认外观）。
 */
export function applyWallpaper(wp) {
  current = wp || null;
  const active = !!(wp && wp.enabled && wp.url);
  document.body.classList.toggle('wp-on', active);
  const layer = document.querySelector('.wp-layer');
  if (!layer) return;
  if (active) {
    layer.style.backgroundImage = `url("${BASE_URL}${wp.url}")`;
    layer.style.filter = `brightness(${wp.brightness ?? 100}%) blur(${wp.blur ?? 0}px)`;
  } else {
    layer.style.backgroundImage = '';
    layer.style.filter = '';
  }
}

/** 用缓存即时应用（MainView 挂载时同步调用，避免闪烁） */
export function initWallpaperLayer() {
  const cached = readCache();
  if (cached) applyWallpaper(cached);
}

/** 拉取服务端最新设置并应用（登录后调用；失败静默保留缓存） */
export async function loadWallpaper() {
  try {
    const vo = await api.getWallpaper();
    const wp = normalize(vo);
    if (wp) {
      writeCache(wp);
      applyWallpaper(wp);
    }
  } catch { /* 网络失败时保留缓存外观 */ }
}

/** 当前生效设置（设置页初始化用） */
export function getWallpaperState() {
  return current || readCache();
}

/**
 * 合并保存设置：本地立即应用（实时预览）→ PUT 服务端 → 用服务端返回覆盖
 * （"跟随每日"模式下由服务端计算当前壁纸 URL）。
 * 抛出错误由调用方 toast 提示。
 */
export async function saveWallpaperSetting(patch) {
  const merged = { ...(current || readCache() || {}), ...patch };
  merged.enabled = !!merged.enabled;
  merged.pinnedImageId = merged.pinnedImageId ?? null;
  merged.brightness = merged.brightness ?? 100;
  merged.blur = merged.blur ?? 0;
  applyWallpaper(merged); // 先本地生效
  const vo = await api.updateWallpaper({
    enabled: merged.enabled,
    pinnedImageId: merged.pinnedImageId,
    brightness: merged.brightness,
    blur: merged.blur,
  });
  const saved = normalize(vo);
  if (saved) {
    writeCache(saved);
    applyWallpaper(saved);
  }
  return saved;
}

/** 防抖保存（滑杆拖动时持续触发，停顿 600ms 后才真正打接口） */
export function scheduleWallpaperSave(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveWallpaperSetting(patch).catch(() => { /* 保存失败保留本地外观，下次操作重试 */ });
  }, 600);
}

/** 登出时还原：移除壁纸外观（保留缓存，下次登录秒显） */
export function clearWallpaper() {
  clearTimeout(saveTimer);
  document.body.classList.remove('wp-on');
  const layer = document.querySelector('.wp-layer');
  if (layer) {
    layer.style.backgroundImage = '';
    layer.style.filter = '';
  }
}
