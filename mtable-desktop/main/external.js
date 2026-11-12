//
// external.js — 原后端对外部服务的调用逻辑，本地化到 Electron 主进程
// 涵盖：LLM（OpenAI 兼容）测试/列表/流式对话、热搜代理、壁纸（Bing/NASA）拉取落盘、安装包文件存储
//
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { mediaDir } = require('./paths');
const { getDb, nowIso, todayDate } = require('./db');

const UA = 'Mozilla/5.0 (MTable-Lite)';

// ---------- 通用 HTTP ----------
function request(urlStr, { method = 'GET', headers = {}, body, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('无效的 URL: ' + urlStr)); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    if (body) req.write(body);
    req.end();
  });
}
async function getJson(url, timeout = 15000) {
  const res = await request(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  return JSON.parse(res.buffer.toString('utf8'));
}

// ---------- 目录 ----------
function dataDir(name) {
  const dir = path.join(mediaDir(), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const wallpaperDir = () => dataDir('wallpapers');
const downloadsDir = () => dataDir('downloads');

// ---------- LLM（OpenAI 兼容协议） ----------
function chatEndpoint(baseUrl) {
  let root = (baseUrl || '').trim();
  while (root.endsWith('/')) root = root.slice(0, -1);
  return root + '/chat/completions';
}
function modelsEndpoint(baseUrl) {
  let root = (baseUrl || '').trim();
  while (root.endsWith('/')) root = root.slice(0, -1);
  return root + '/models';
}

function llmError(status, body) {
  let detail = '';
  try {
    const j = JSON.parse(body);
    detail = (j.error && j.error.message) || j.message || '';
  } catch { detail = String(body || '').slice(0, 200); }
  const hint = status === 401 ? 'API 密钥无效或已过期（401）'
    : status === 403 ? '无权访问该模型（403）'
      : status === 404 ? 'API 地址或模型 ID 不存在（404）'
        : status === 429 ? '请求过于频繁或模型额度不足（429），请稍后重试、充值或更换模型'
          : `厂商接口返回异常（HTTP ${status}）`;
  return new Error(detail ? hint + '：' + detail : hint);
}

async function testChat(baseUrl, apiKey, modelId) {
  const body = JSON.stringify({
    model: modelId,
    messages: [{ role: 'user', content: '你好，请回复“连接成功”四个字。' }],
    stream: false, max_tokens: 32,
  });
  const start = Date.now();
  const res = await request(chatEndpoint(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body, timeout: 30000,
  });
  if (res.status < 200 || res.status >= 300) throw llmError(res.status, res.buffer.toString('utf8'));
  const j = JSON.parse(res.buffer.toString('utf8'));
  const reply = (((j.choices || [])[0] || {}).message || {}).content || '';
  return { latencyMs: Date.now() - start, reply: reply.trim() || '(模型未返回内容)' };
}

async function listModels(baseUrl, apiKey) {
  const res = await request(modelsEndpoint(baseUrl), {
    headers: { Authorization: 'Bearer ' + apiKey }, timeout: 30000,
  });
  if (res.status < 200 || res.status >= 300) throw llmError(res.status, res.buffer.toString('utf8'));
  const j = JSON.parse(res.buffer.toString('utf8'));
  return (j.data || []).map((x) => x.id).filter(Boolean).sort();
}

/**
 * 流式对话：POST /chat/completions stream=true，解析 SSE 增量回调 onDelta。
 * 返回 { cancel() }。onDone 在正常结束或 [DONE] 时调用；onError 在异常时调用。
 */
function streamChat({ baseUrl, apiKey, modelId, messages }, { onDelta, onDone, onError }) {
  let settled = false;
  const finish = (fn, arg) => { if (settled) return; settled = true; fn(arg); };
  const body = JSON.stringify({ model: modelId, messages, stream: true });
  let u;
  try { u = new URL(chatEndpoint(baseUrl)); } catch (e) { finish(onError, e); return { cancel() {} }; }
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request(u, {
    method: 'POST', timeout: 300000,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey, Accept: 'text/event-stream' },
  }, (res) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish(onError, llmError(res.statusCode, Buffer.concat(chunks).toString('utf8'))));
      return;
    }
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      const events = buf.split('\n\n');
      buf = events.pop() ?? '';
      for (const ev of events) {
        for (const line of ev.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let j; try { j = JSON.parse(payload); } catch { continue; }
          const delta = (((j.choices || [])[0] || {}).delta || {}).content || '';
          if (delta) onDelta(delta);
        }
      }
    });
    res.on('end', () => finish(onDone));
    res.on('error', (e) => finish(onError, e));
  });
  req.on('error', (e) => finish(onError, e));
  req.on('timeout', () => { req.destroy(new Error('连接模型超时')); });
  req.write(body);
  req.end();
  return { cancel() { try { req.destroy(); } catch { /* ignore */ } } };
}

// ---------- 热搜代理（uapis 主源 + 60s 备用，进程内缓存 60s） ----------
const UAPIS_URL = 'https://uapis.cn/api/v1/misc/hotboard?type=';
const SIXTY_URL = 'https://60s.viki.moe/v2/';
const hotCache = new Map();
function normalizeSource(s) { return String(s).toLowerCase() === 'weibo' ? 'weibo' : 'toutiao'; }
function toItem(title, hotValue, link) { return { title, hot_value: hotValue, link }; }
async function fetchUapis(key) {
  const j = await getJson(UAPIS_URL + key, 4000);
  return (j.list || []).filter((n) => n.title).map((n) => toItem(n.title, n.hot_value || '', n.url || ''));
}
async function fetch60s(key) {
  const j = await getJson(SIXTY_URL + key, 4000);
  return (j.data || []).filter((n) => n.title).map((n) => toItem(n.title, n.hot_value || '', n.link || ''));
}
async function getHotList(source) {
  const key = normalizeSource(source);
  const hit = hotCache.get(key);
  if (hit && Date.now() - hit.ts < 60000) return hit.data;
  let data = [];
  try { data = await fetchUapis(key); } catch { /* fallthrough */ }
  if (!data.length) { try { data = await fetch60s(key); } catch { /* fallthrough */ } }
  if (data.length) { hotCache.set(key, { data, ts: Date.now() }); return data; }
  if (hit) return hit.data;
  throw new Error('热搜获取失败，请稍后重试');
}

// ---------- 壁纸：Bing / NASA 拉取落盘 ----------
const BING_HOSTS = ['https://cn.bing.com', 'https://www.bing.com'];
const BING_API_PATH = '/HPImageArchive.aspx?format=js&idx=0&n=8&uhd=1&uhdwidth=3840&uhdheight=2160&mkt=zh-CN';
const SIXTY_HOSTS = ['https://60s-api.viki.moe', 'https://60s.viki.moe'];
const NASA_SEARCH_URL = 'https://images-api.nasa.gov/search';
const NASA_ASSET_BASE = 'https://images-assets.nasa.gov/image/';
const NASA_QUERIES = ['nebula', 'galaxy', 'aurora', 'moon', 'mars', 'jupiter', 'saturn', 'milky way', 'earth', 'space station'];
const NASA_PAGE_SIZE = 6;
const NASA_MAX_NEW = 12;
const NASA_MAX_BYTES = 16 * 1024 * 1024;

function extractIdParam(url) {
  const s = url.indexOf('id='); if (s < 0) return null;
  const rest = url.slice(s + 3); const amp = rest.indexOf('&');
  return amp >= 0 ? rest.slice(0, amp) : rest;
}
function deriveImageKey(idValue) {
  if (!idValue) return null;
  const m = idValue.match(/^(OHR\.[^_]+)/); if (m) return m[1];
  const dot = idValue.lastIndexOf('.'); return dot > 0 ? idValue.slice(0, dot) : idValue;
}
function parseBingDate(sd) {
  if (/^\d{8}$/.test(sd)) return `${sd.slice(0, 4)}-${sd.slice(4, 6)}-${sd.slice(6, 8)}`;
  return todayDate();
}
async function fetchBingImages() {
  for (const host of BING_HOSTS) {
    try {
      const j = await getJson(host + BING_API_PATH, 15000);
      if (j.images && j.images.length) return j.images;
    } catch { /* next host */ }
  }
  for (const host of SIXTY_HOSTS) {
    try {
      const j = await getJson(host + '/v2/bing', 15000);
      const cover = (j.data || {}).cover_4k || '';
      const idx = cover.indexOf('/th?'); if (idx < 0) continue;
      return [{ url: cover.slice(idx), title: (j.data || {}).title || '', copyright: (j.data || {}).copyright || '', startdate: todayDate().replace(/-/g, '') }];
    } catch { /* next host */ }
  }
  return [];
}
async function downloadBing(url) {
  for (const host of BING_HOSTS) {
    try {
      const res = await request(host + url, { headers: { 'User-Agent': UA }, timeout: 30000 });
      if (res.status === 200 && res.buffer.length) return res.buffer;
    } catch { /* next host */ }
  }
  return null;
}
function insertWallpaperImage(img) {
  const now = nowIso();
  const r = getDb().prepare(`INSERT INTO t_wallpaper_image
    (image_key, source, category, image_date, title, copyright, file_name, url, create_time, update_time)
    VALUES (@imageKey, @source, @category, @imageDate, @title, @copyright, @fileName, @url, @now, @now)`)
    .run({ ...img, now });
  return r.lastInsertRowid;
}
async function storeBingImage(node) {
  const url = node.url || ''; if (!url) return false;
  const imageKey = deriveImageKey(extractIdParam(url)); if (!imageKey) return false;
  const dup = getDb().prepare('SELECT 1 FROM t_wallpaper_image WHERE image_key = ?').get(imageKey);
  if (dup) return false;
  const fileName = imageKey + '_3840x2160.jpg';
  const target = path.join(wallpaperDir(), fileName);
  if (!fs.existsSync(target)) {
    const bytes = await downloadBing(url);
    if (!bytes || !bytes.length) return false;
    fs.writeFileSync(target, bytes);
  }
  insertWallpaperImage({
    imageKey, source: 'bing', category: '每日精选', imageDate: parseBingDate(node.startdate || ''),
    title: node.title || null, copyright: node.copyright || null, fileName, url: 'wallpaper://local/' + fileName,
  });
  return true;
}
async function syncFromBing() {
  const images = await fetchBingImages();
  let added = 0;
  for (const node of images) { try { if (await storeBingImage(node)) added++; } catch { /* skip */ } }
  return added;
}
async function resolveNasaJpg(nasaId) {
  try {
    const encoded = encodeURIComponent(nasaId).replace(/%20/g, '%20');
    const j = await getJson(NASA_ASSET_BASE + encoded + '/collection.json', 15000);
    const assets = (Array.isArray(j) ? j : []).map(String);
    const pick = assets.find((u) => u.endsWith('~orig.jpg')) || assets.find((u) => u.endsWith('~medium.jpg'));
    return pick ? pick.replace(/^http:\/\//, 'https://') : null;
  } catch { return null; }
}
async function downloadBytes(url, maxBytes) {
  const res = await request(url, { headers: { 'User-Agent': UA }, timeout: 60000 });
  if (res.status !== 200 || res.buffer.length > maxBytes) return null;
  return res.buffer;
}
async function storeNasaImage(item) {
  const data = (((item || {}).data || [])[0]) || {};
  const nasaId = data.nasa_id || ''; if (!nasaId) return false;
  const imageKey = 'nasa:' + nasaId;
  if (getDb().prepare('SELECT 1 FROM t_wallpaper_image WHERE image_key = ?').get(imageKey)) return false;
  const jpgUrl = await resolveNasaJpg(nasaId); if (!jpgUrl) return false;
  const bytes = await downloadBytes(jpgUrl, NASA_MAX_BYTES); if (!bytes || !bytes.length) return false;
  const fileName = 'nasa_' + nasaId.replace(/[^A-Za-z0-9._-]/g, '_') + '.jpg';
  const target = path.join(wallpaperDir(), fileName);
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
  const dc = (data.date_created || '').trim().slice(0, 10);
  insertWallpaperImage({
    imageKey, source: 'nasa', category: '太空漫游',
    imageDate: /^\d{4}-\d{2}-\d{2}$/.test(dc) ? dc : todayDate(),
    title: (data.title || '').slice(0, 200) || null, copyright: 'NASA（公有领域）',
    fileName, url: 'wallpaper://local/' + fileName,
  });
  return true;
}
async function fetchNasaItems(query) {
  try {
    const url = NASA_SEARCH_URL + '?q=' + encodeURIComponent(query) + '&media_type=image&page_size=' + NASA_PAGE_SIZE;
    const j = await getJson(url, 15000);
    return (((j.collection || {}).items) || []);
  } catch { return []; }
}
async function syncFromNasa() {
  let added = 0;
  for (const query of NASA_QUERIES) {
    if (added >= NASA_MAX_NEW) break;
    for (const item of await fetchNasaItems(query)) {
      if (added >= NASA_MAX_NEW) break;
      try { if (await storeNasaImage(item)) added++; } catch { /* skip */ }
    }
  }
  return added;
}

// ---------- 安装包文件存储 ----------
function storeUpload(fileName, bytes) {
  const dir = downloadsDir();
  const safe = String(fileName).replace(/[\\/:*?"<>|]/g, '_');
  fs.writeFileSync(path.join(dir, safe), bytes);
  return { fileName: safe, size: bytes.length, url: 'download://local/' + safe };
}
function sizeOf(storedName) {
  if (!storedName) return null;
  try { return fs.statSync(path.join(downloadsDir(), storedName)).size; } catch { return null; }
}

module.exports = {
  testChat, listModels, streamChat,
  getHotList,
  syncFromBing, syncFromNasa, wallpaperDir,
  storeUpload, sizeOf, downloadsDir,
};
