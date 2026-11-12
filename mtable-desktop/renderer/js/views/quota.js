//
// views/quota.js — 模型额度插件（pluginKey: model-quota）
// 功能：添加/编辑/删除大模型厂商（内置 DeepSeek / Kimi / 智谱 预设），
//       通过各厂商 API Key 自动拉取余额/资源包余量，
//       本地快照差值统计当日/近 14 天消耗趋势，过期倒计时与余量不足提醒（每日一次）。
//       主页面仅展示已添加（配置了 API Key）的厂商。
// 网络：厂商接口无 CORS 头，统一走主进程 mtable:http-request IPC 转发。
// 数据：API Key、快照、提醒记录均存 localStorage，不上传服务端。
//
import { el, clear, toast, confirmModal } from '../ui.js';
import { icon } from '../icons.js';

const STORAGE_KEY = 'com.mtable.model-quota';
const STALE_MS = 5 * 60 * 1000;        // 数据超过 5 分钟视为过期，自动重拉
const SNAPSHOT_KEEP_DAYS = 90;          // 快照保留天数
const TREND_DAYS = 14;                  // 趋势图天数
const LOW_RATIO = 0.2;                  // 余量不足阈值（相对总额度）

// ---------- 工具 ----------
const num = (v) => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(num(v)) ? null : num(v));

/** 金额/数量格式化：大数以「万/亿」计 */
function fmtVal(v, unit) {
  if (v == null) return '--';
  if (unit === 'tokens' || unit === 'credits') {
    if (v >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
    if (v >= 1e4) return `${(v / 1e4).toFixed(1)} 万`;
    return String(Math.round(v));
  }
  return `¥ ${v.toFixed(2)}`;
}

/** 时间戳（秒/毫秒/字符串混兼容）→ 毫秒或 null */
function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
  const t = Date.parse(String(v).replace(/-/g, '/'));
  return Number.isFinite(t) ? t : null;
}

function fmtDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ---------- 厂商响应解析 ----------
// parse 返回：{ remaining, total|null, unit, rows:[{label,value}], packs:[{name,remaining,total,expireAt}] }

function parseDeepSeek(json) {
  const infos = Array.isArray(json.balance_infos) ? json.balance_infos : [];
  const sum = (f) => infos.reduce((s, b) => s + (numOrNull(b[f]) || 0), 0);
  return {
    remaining: sum('total_balance'), total: null, unit: '¥',
    rows: [
      { label: '现金余额', value: sum('cash_balance') },
      { label: '赠金/代金券', value: sum('granted_balance') + sum('voucher_balance') },
    ],
    packs: [],
  };
}

function parseKimi(json) {
  const d = json.data || json;
  const sub = d.subscription_balance || {};
  return {
    remaining: numOrNull(d.available_balance) ?? numOrNull(d.total_balance) ?? 0,
    total: null, unit: '¥',
    rows: [
      { label: '充值余额', value: numOrNull(sub.rechargeable_balance) ?? 0 },
      { label: '赠券余额', value: numOrNull(sub.virtual_balance) ?? 0 },
    ],
    packs: [],
  };
}

function parseZhipu(json) {
  const raw = json.result || json.data || json;
  const list = Array.isArray(raw) ? raw : (raw.list || raw.records || raw.items || []);
  const packs = [];
  for (const i of list) {
    if (!i || typeof i !== 'object') continue;
    const name = i.subscription_name || i.name || i.product_name || i.pack_name || '资源包';
    const total = numOrNull(i.total_amount ?? i.total ?? i.amount ?? i.quota);
    const used = numOrNull(i.used_amount ?? i.used);
    let remaining = numOrNull(i.remaining ?? i.remain ?? i.balance ?? i.left_amount);
    if (remaining == null && total != null) remaining = Math.max(0, total - (used || 0));
    if (remaining == null && used == null) continue;
    packs.push({
      name, remaining, total,
      expireAt: toMs(i.expired_time ?? i.expire_time ?? i.expiration_date ?? i.end_time ?? i.valid_end_time),
    });
  }
  const unit = packs.some((p) => (p.remaining || 0) > 10000) ? 'tokens' : '¥';
  if (!packs.length && json.code != null && !['200', '0'].includes(String(json.code))) {
    throw new Error(`智谱接口返回异常：${json.message || json.msg || JSON.stringify(json).slice(0, 100)}`);
  }
  const remaining = packs.reduce((s, p) => s + (p.remaining || 0), 0);
  const total = packs.length && packs.every((p) => p.total != null)
    ? packs.reduce((s, p) => s + p.total, 0) : null;
  return { remaining, total, unit, rows: [], packs };
}

function parseMiniMax(json) {
  const d = json.data || json.result || json;
  const get = (...names) => {
    for (const n of names) {
      const v = numOrNull(d?.[n]) ?? numOrNull(json?.[n]);
      if (v != null) return v;
    }
    return null;
  };
  const remaining = get('remaining_credit', 'remaining_credits', 'remain_credit', 'left_credit', 'remaining', 'remain', 'balance') ?? 0;
  const total = get('total_credit', 'total_credits', 'total', 'quota');
  const used = get('used_credit', 'used_credits', 'used');
  return {
    remaining,
    total: total != null ? total : (used != null ? remaining + used : null),
    unit: 'credits',
    rows: [
      { label: '已用积分', value: used },
      { label: '总积分', value: total },
    ],
    packs: [],
  };
}

// ---------- 内置厂商预设目录 ----------
// type: 'api' = 有公开余额接口，自动拉取；'manual' = 无公开接口，手动录入用量
const CATALOG = [
  {
    preset: 'deepseek', name: 'DeepSeek', accent: '#4d6bfe', type: 'api',
    url: 'https://api.deepseek.com/user/balance', parse: parseDeepSeek,
    keyHint: 'sk-…（platform.deepseek.com 申请）',
  },
  {
    preset: 'kimi', name: 'Kimi / Moonshot', accent: '#12b76a', type: 'api',
    url: 'https://api.moonshot.cn/v1/users/me/balance', parse: parseKimi,
    keyHint: 'sk-…（platform.moonshot.cn 申请）',
  },
  {
    preset: 'zhipu', name: '智谱 GLM', accent: '#3f8cff', type: 'api',
    url: 'https://open.bigmodel.cn/api/paas/v4/subscription/overview_list?page_num=1&page_size=20',
    parse: parseZhipu,
    keyHint: '…（bigmodel.cn 用户中心-API Keys）',
  },
  {
    preset: 'minimax', name: 'MiniMax', accent: '#e8590c', type: 'api',
    url: 'https://www.minimaxi.com/v1/token_plan/remains', parse: parseMiniMax,
    keyHint: '…（platform.minimaxi.com 开放平台 API Key）',
  },
  { preset: 'qwen', name: '阿里云百炼 · 通义', accent: '#ff6a00', type: 'manual' },
  { preset: 'doubao', name: '火山方舟 · 豆包', accent: '#2b6de8', type: 'manual' },
  { preset: 'hunyuan', name: '腾讯混元', accent: '#0052d9', type: 'manual' },
  { preset: 'ernie', name: '百度千帆 · 文心', accent: '#2932e1', type: 'manual' },
  { preset: 'spark', name: '讯飞星火', accent: '#0d5eff', type: 'manual' },
  { preset: 'mimo', name: '小米 MiMo', accent: '#ff6900', type: 'manual' },
  { preset: 'step', name: '阶跃星辰 Step', accent: '#7c3aed', type: 'manual' },
  { preset: 'sensenova', name: '商汤日日新', accent: '#e64a19', type: 'manual' },
  { preset: 'yi', name: '零一万物 Yi', accent: '#10b981', type: 'manual' },
];
const presetOf = (id) => CATALOG.find((c) => c.preset === id);
const isManual = (a) => presetOf(a.preset)?.type === 'manual';

// ---------- HTTP（主进程转发，兜底 fetch） ----------
async function httpGetJSON(url, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  let status, text;
  if (window.mtable?.httpRequest) {
    const res = await window.mtable.httpRequest({ url, method: 'GET', headers, timeout: 15000 });
    status = res.status; text = res.body;
  } else {
    const res = await fetch(url, { headers });
    status = res.status; text = await res.text();
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 走下方报错 */ }
  if (status === 401) throw new Error('API Key 无效或已过期');
  if (status !== 200) {
    const msg = json?.error?.message || json?.msg || json?.message || text?.slice(0, 100) || `HTTP ${status}`;
    throw new Error(`请求失败（${status}）：${msg}`);
  }
  if (!json) throw new Error('响应不是 JSON');
  return json;
}

// ---------- 本地持久化 ----------
// accounts: [{ id(=preset), preset, name, key }]，主页面只渲染 accounts 中的厂商
let state = null;

function defaultState() {
  return { version: 2, accounts: [], snapshots: {}, lastData: {}, notified: { date: '', items: [] } };
}

/** v1（keys 映射）→ v2（accounts 列表）迁移 */
function migrateAccounts(p) {
  if (Array.isArray(p.accounts)) {
    return p.accounts
      .filter((a) => a && presetOf(a.preset) && (presetOf(a.preset).type === 'manual' || (typeof a.key === 'string' && a.key.trim())))
      .map((a) => ({
        ...a,
        id: a.preset,
        name: String(a.name || presetOf(a.preset).name).slice(0, 30),
        key: typeof a.key === 'string' ? a.key.trim() : '',
      }));
  }
  if (p.keys && typeof p.keys === 'object') {
    return Object.entries(p.keys)
      .filter(([preset, k]) => presetOf(preset) && typeof k === 'string' && k.trim())
      .map(([preset, key]) => ({ id: preset, preset, name: presetOf(preset).name, key: key.trim() }));
  }
  return [];
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const p = JSON.parse(raw);
    return {
      version: 2,
      accounts: migrateAccounts(p),
      snapshots: p.snapshots && typeof p.snapshots === 'object' ? p.snapshots : {},
      lastData: p.lastData && typeof p.lastData === 'object' ? p.lastData : {},
      notified: {
        date: typeof p.notified?.date === 'string' ? p.notified.date : '',
        items: Array.isArray(p.notified?.items) ? p.notified.items : [],
      },
    };
  } catch {
    return defaultState();
  }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 存储满时静默 */ }
}

/** 记录快照（同值不重复记录），并裁剪过期数据 */
function pushSnapshot(id, remaining) {
  if (!Number.isFinite(remaining)) return;
  const list = state.snapshots[id] || (state.snapshots[id] = []);
  const last = list[list.length - 1];
  const now = Date.now();
  if (last && last.remaining === remaining) return; // 同值仅保留最早时间，用于跨时段消耗计算
  list.push({ ts: now, remaining });
  const cutoff = now - SNAPSHOT_KEEP_DAYS * 86400000;
  while (list.length && list[0].ts < cutoff) list.shift();
}

/** 近 days 天每日消耗序列 [{day, value}]，无数据日为 0 */
function dailySeries(id, days) {
  const list = state.snapshots[id] || [];
  const out = [];
  const today = dayStart(Date.now());
  for (let i = days - 1; i >= 0; i--) {
    const day = today - i * 86400000;
    const dayEnd = day + 86400000;
    const inDay = list.filter((s) => s.ts >= day && s.ts < dayEnd);
    if (!inDay.length) { out.push({ day, value: 0 }); continue; }
    const prev = [...list].reverse().find((s) => s.ts < day);
    const start = prev ? prev.remaining : inDay[0].remaining;
    const end = inDay[inDay.length - 1].remaining;
    out.push({ day, value: Math.max(0, start - end) });
  }
  return out;
}

// ---------- 提醒 ----------
/** 手动录入型厂商：用录入数据合成与 API 型同构的 data 结构 */
function manualData(acc) {
  const remaining = numOrNull(acc.remaining) ?? 0;
  const total = numOrNull(acc.total);
  const expireAt = numOrNull(acc.expireAt);
  return {
    remaining, total, unit: acc.unit || '¥',
    rows: [{ label: '总额度', value: total }],
    packs: expireAt ? [{ name: '套餐', remaining, total, expireAt }] : [],
  };
}

function checkReminders(id, name, data) {
  const today = fmtDate(Date.now());
  if (state.notified.date !== today) { state.notified = { date: today, items: [] }; }
  const fire = (key, msg) => {
    if (state.notified.items.includes(key)) return;
    state.notified.items.push(key);
    toast(msg, 'error');
  };
  if (data.remaining != null && data.remaining <= 0) fire(`${id}:empty`, `${name} 额度已用尽`);
  else if (data.total && data.remaining / data.total < LOW_RATIO) fire(`${id}:low`, `${name} 剩余不足 20%（${fmtVal(data.remaining, data.unit)}）`);
  for (const pack of data.packs || []) {
    if (!pack.expireAt) continue;
    const days = Math.ceil((pack.expireAt - Date.now()) / 86400000);
    if (days <= 0) fire(`${id}:expired:${pack.name}`, `${name}「${pack.name}」已过期`);
    else if (days <= 7) fire(`${id}:exp:${pack.name}`, `${name}「${pack.name}」${days} 天后过期，剩 ${fmtVal(pack.remaining, data.unit)}`);
  }
  persist();
}

// ---------- 视图 ----------
export function QuotaView() {
  state = loadState();
  const loading = new Set();

  const headerEl = el('div', { class: 'qt-header' });
  const gridEl = el('div', { class: 'qt-grid' });
  const root = el('div', { class: 'qt-root' }, headerEl, gridEl);

  async function refreshAccount(acc) {
    const p = presetOf(acc.preset);
    if (!p || loading.has(acc.id)) return;

    // 手动录入型：直接用录入数据合成，无需网络
    if (p.type === 'manual') {
      const data = manualData(acc);
      pushSnapshot(acc.id, data.remaining);
      state.lastData[acc.id] = { ok: true, data, fetchedAt: Date.now() };
      persist();
      checkReminders(acc.id, acc.name, data);
      if (root.isConnected) renderGrid();
      return;
    }

    if (!acc.key) return;
    loading.add(acc.id);
    renderGrid();
    try {
      const json = await httpGetJSON(p.url, acc.key);
      const data = p.parse(json);
      pushSnapshot(acc.id, data.remaining);
      state.lastData[acc.id] = { ok: true, data, fetchedAt: Date.now() };
      persist();
      checkReminders(acc.id, acc.name, data);
    } catch (err) {
      state.lastData[acc.id] = { ok: false, error: err?.message || String(err), fetchedAt: Date.now() };
      persist();
    } finally {
      loading.delete(acc.id);
      if (root.isConnected) renderGrid();
    }
  }

  function refreshAll() {
    for (const acc of state.accounts) refreshAccount(acc);
  }

  function deleteAccount(acc) {
    confirmModal({
      title: '删除厂商',
      message: `确定删除「${acc.name}」吗？其配置、消耗历史与提醒记录将一并清除。`,
      confirmText: '删除', cancelText: '取消', danger: true,
    }).then((ok) => {
      if (!ok) return;
      state.accounts = state.accounts.filter((a) => a.id !== acc.id);
      delete state.snapshots[acc.id];
      delete state.lastData[acc.id];
      persist();
      renderGrid();
      toast('已删除厂商');
    });
  }

  // ---------- 头部 ----------
  function renderHeader() {
    clear(headerEl);
    headerEl.append(
      el('div', { class: 'qt-header-titles' },
        el('div', { class: 'qt-title' }, '模型额度'),
        el('div', { class: 'qt-subtitle' }, '已购大模型服务余量、消耗趋势与到期提醒（数据本地存储）')),
      el('div', { class: 'qt-header-actions' },
        el('button', {
          class: 'qt-btn-primary', onclick: () => openAccountDialog(null),
        }, el('span', { class: 'icon', style: { width: '13px', height: '13px' }, innerHTML: icon('plus.square') }), '添加厂商'),
        el('button', { class: 'qt-icon-btn', title: '刷新全部', onclick: refreshAll },
          el('span', { class: 'icon', innerHTML: icon('arrow.clockwise') }))),
    );
  }

  // ---------- 卡片 ----------
  function trendChart(id, unit) {
    const series = dailySeries(id, TREND_DAYS);
    const max = Math.max(...series.map((s) => s.value), 0);
    const row = el('div', { class: 'qt-trend' });
    for (const s of series) {
      const h = max > 0 ? Math.max((s.value / max) * 34, s.value > 0 ? 3 : 1) : 1;
      row.append(el('div', {
        class: 'qt-trend-bar', style: { height: `${h}px` },
        title: `${fmtDate(s.day)} 消耗 ${fmtVal(s.value, unit)}`,
      }));
    }
    return row;
  }

  function accountCard(acc) {
    const p = presetOf(acc.preset);
    const ld = state.lastData[acc.id];
    const isLoading = loading.has(acc.id);
    const data = ld?.ok ? ld.data : null;

    const head = el('div', { class: 'qt-card-head' },
      el('div', { class: 'qt-card-name' },
        el('span', { class: 'qt-dot' }), acc.name),
      el('div', { class: 'qt-card-actions' },
        ...(!isManual(acc) ? [el('button', {
          class: 'qt-icon-btn sm', title: '刷新', disabled: isLoading ? '' : null,
          onclick: () => refreshAccount(acc),
        }, el('span', { class: `icon${isLoading ? ' qt-spin' : ''}`, innerHTML: icon('arrow.clockwise') }))] : []),
        el('button', {
          class: 'qt-icon-btn sm', title: isManual(acc) ? '更新用量 / 编辑' : '编辑',
          onclick: () => openAccountDialog(acc),
        }, el('span', { class: 'icon', innerHTML: icon('pencil.circle') })),
        el('button', {
          class: 'qt-icon-btn sm danger', title: '删除',
          onclick: () => deleteAccount(acc),
        }, el('span', { class: 'icon', innerHTML: icon('xmark.circle') }))));

    const children = [head];

    if (isLoading && !data) {
      children.push(el('div', { class: 'qt-empty' }, '加载中…'));
      return el('div', { class: 'qt-card', style: `--qt-accent:${p.accent}` }, ...children);
    }

    if (ld && !ld.ok && !data) {
      children.push(
        el('div', { class: 'qt-error' },
          el('span', { class: 'icon', style: { width: '14px', height: '14px' }, innerHTML: icon('exclamationmark.circle.fill') }), ld.error),
        el('div', { class: 'qt-foot' }, `更新于 ${fmtDate(ld.fetchedAt)} ${fmtTime(ld.fetchedAt)}`));
      return el('div', { class: 'qt-card', style: `--qt-accent:${p.accent}` }, ...children);
    }

    if (data) {
      children.push(el('div', { class: 'qt-remaining' }, fmtVal(data.remaining, data.unit),
        el('span', { class: 'qt-remaining-label' }, '当前余量')));

      if (data.total != null && data.total > 0) {
        const pct = Math.min(100, Math.max(0, (data.remaining / data.total) * 100));
        children.push(el('div', { class: 'qt-progress' },
          el('div', { class: `qt-progress-fill${pct < LOW_RATIO * 100 ? ' low' : ''}`, style: { width: `${pct}%` } })));
      }

      const series = dailySeries(acc.id, TREND_DAYS);
      const todayVal = series[series.length - 1]?.value ?? 0;
      const weekSum = series.slice(-7).reduce((s, x) => s + x.value, 0);
      children.push(el('div', { class: 'qt-stats' },
        el('div', { class: 'qt-stat' }, el('div', { class: 'qt-stat-v' }, fmtVal(todayVal, data.unit)), el('div', { class: 'qt-stat-k' }, '今日消耗')),
        el('div', { class: 'qt-stat' }, el('div', { class: 'qt-stat-v' }, fmtVal(weekSum, data.unit)), el('div', { class: 'qt-stat-k' }, '近 7 天')),
        el('div', { class: 'qt-stat' }, trendChart(acc.id, data.unit), el('div', { class: 'qt-stat-k' }, `近 ${TREND_DAYS} 天趋势`))));

      if (data.rows?.length) {
        children.push(el('div', { class: 'qt-rows' },
          ...data.rows.filter((r) => r.value != null).map((r) =>
            el('div', { class: 'qt-row' }, el('span', {}, r.label), el('span', { class: 'qt-row-v' }, fmtVal(r.value, data.unit))))));
      }

      for (const pack of data.packs || []) {
        if (!pack.expireAt) continue;
        const days = Math.ceil((pack.expireAt - Date.now()) / 86400000);
        children.push(el('div', { class: `qt-pack${days <= 7 ? ' warn' : ''}${days <= 0 ? ' dead' : ''}` },
          el('span', { class: 'icon', style: { width: '12px', height: '12px' }, innerHTML: icon('timer.list') }),
          el('span', {}, `${pack.name} · ${fmtVal(pack.remaining, data.unit)}`),
          el('span', { class: 'qt-pack-expire' }, days <= 0 ? '已过期' : `${days} 天后过期（${fmtDate(pack.expireAt)}）`)));
      }

      children.push(el('div', { class: 'qt-foot' },
        `更新于 ${fmtDate(ld?.fetchedAt || Date.now())} ${fmtTime(ld?.fetchedAt || Date.now())}`,
        ld && !ld.ok ? el('span', { class: 'qt-foot-err' }, `刷新失败：${ld.error}`) : null));
    } else {
      children.push(el('div', { class: 'qt-empty' }, '尚未拉取数据，点击右上角刷新'));
    }
    return el('div', { class: 'qt-card', style: `--qt-accent:${p.accent}` }, ...children);
  }

  function renderGrid() {
    clear(gridEl);
    if (!state.accounts.length) {
      gridEl.append(el('div', { class: 'qt-page-empty' },
        el('span', { class: 'icon', style: { width: '46px', height: '46px' }, innerHTML: icon('chart.bar.xaxis') }),
        el('div', { class: 'qt-page-empty-title' }, '还没有添加大模型厂商'),
        el('div', { class: 'qt-page-empty-sub' }, '点击右上角「添加厂商」，选择厂商并填入 API Key 即可开始监控'),
        el('button', { class: 'qt-btn-primary', onclick: () => openAccountDialog(null) },
          el('span', { class: 'icon', style: { width: '13px', height: '13px' }, innerHTML: icon('plus.square') }), '添加厂商')));
      return;
    }
    for (const acc of state.accounts) gridEl.append(accountCard(acc));
  }

  // ---------- 添加 / 编辑弹窗 ----------
  // acc 为 null 时是添加（需选厂商预设）；否则编辑（改名称、Key 或手动用量）
  function openAccountDialog(acc) {
    const isEdit = !!acc;
    let preset = isEdit ? acc.preset : (CATALOG.find((c) => !state.accounts.some((a) => a.id === c.preset))?.preset || null);

    const nameInput = el('input', {
      class: 'qt-dialog-input', type: 'text', maxlength: '30',
      placeholder: '显示名称', value: isEdit ? acc.name : (presetOf(preset)?.name || ''),
    });

    // —— API 型字段 ——
    const keyInput = el('input', {
      class: 'qt-dialog-input', type: 'password',
      placeholder: isEdit ? '留空则保持原 Key' : (presetOf(preset)?.keyHint || ''),
      value: '', autocomplete: 'off',
    });

    // —— 手动型字段 ——
    const remainingInput = el('input', {
      class: 'qt-dialog-input', type: 'number', min: '0', step: 'any',
      placeholder: '当前剩余额度', value: isEdit && acc.remaining != null ? acc.remaining : '',
    });
    const totalInput = el('input', {
      class: 'qt-dialog-input', type: 'number', min: '0', step: 'any',
      placeholder: '套餐总额度', value: isEdit && acc.total != null ? acc.total : '',
    });
    const unitSelect = el('select', { class: 'qt-dialog-input' },
      el('option', { value: '¥' }, '金额 ¥'),
      el('option', { value: 'tokens' }, 'Token 数'),
      el('option', { value: 'credits' }, 'Credits'));
    unitSelect.value = isEdit ? (acc.unit || '¥') : '¥';
    const expireInput = el('input', {
      class: 'qt-dialog-input', type: 'date',
      value: isEdit && acc.expireAt ? fmtDate(acc.expireAt) : '',
    });

    // 厂商选择（仅添加时）
    const presetRow = el('div', { class: 'qt-preset-row' });
    function renderPresets() {
      clear(presetRow);
      for (const c of CATALOG) {
        const added = state.accounts.some((a) => a.id === c.preset);
        presetRow.append(el('button', {
          class: `qt-preset-chip${c.preset === preset ? ' selected' : ''}`,
          disabled: added ? '' : null,
          title: added ? '该厂商已添加' : '',
          onclick: () => {
            if (added) return;
            preset = c.preset;
            if (!nameInput.value.trim() || CATALOG.some((x) => x.name === nameInput.value.trim())) {
              nameInput.value = c.name;
            }
            keyInput.placeholder = c.keyHint || '';
            renderPresets();
            renderFields();
          },
        }, el('span', { class: 'qt-dot', style: `--qt-accent:${c.accent}` }), c.name,
          el('span', { class: `qt-chip-tag${c.type === 'manual' ? ' grey' : ''}` }, c.type === 'manual' ? '手动' : '自动'),
          added ? el('span', { class: 'qt-chip-added' }, '已添加') : null));
      }
    }

    // 表单字段区：按厂商类型切换
    const fieldsWrap = el('div', { class: 'qt-dialog-fields' });
    function renderFields() {
      clear(fieldsWrap);
      fieldsWrap.append(el('div', { class: 'qt-dialog-field' }, el('label', {}, '显示名称'), nameInput));
      const p = presetOf(preset);
      if (!p) return;
      if (p.type === 'manual') {
        fieldsWrap.append(
          el('div', { class: 'qt-dialog-field' }, el('label', {}, '剩余额度'), remainingInput),
          el('div', { class: 'qt-dialog-field' }, el('label', {}, '总额度（可选）'), totalInput),
          el('div', { class: 'qt-dialog-row' },
            el('div', { class: 'qt-dialog-field' }, el('label', {}, '单位'), unitSelect),
            el('div', { class: 'qt-dialog-field' }, el('label', {}, '过期日期（可选）'), expireInput)));
      } else {
        fieldsWrap.append(el('div', { class: 'qt-dialog-field' }, el('label', {}, 'API Key'), keyInput));
      }
    }

    const errorText = el('div', { class: 'qt-dialog-error' });
    function setError(msg) {
      if (msg) { errorText.textContent = msg; errorText.style.display = 'block'; }
      else errorText.style.display = 'none';
    }
    function close() { mask.remove(); }

    const submit = el('button', {
      class: 'qt-dialog-submit', onclick: () => {
        const name = nameInput.value.trim().slice(0, 30);
        setError(null);
        if (!preset) return setError('请选择厂商');
        if (!name) return setError('请输入显示名称');
        const p = presetOf(preset);
        if (p.type === 'manual') {
          const remaining = numOrNull(remainingInput.value);
          if (remaining == null || remaining < 0) return setError('请输入有效的剩余额度');
          const total = numOrNull(totalInput.value);
          const expireAt = expireInput.value
            ? dayStart(Date.parse(expireInput.value.replace(/-/g, '/'))) + 86400000 - 1 : null;
          const upd = { name, remaining, total, unit: unitSelect.value, expireAt };
          if (isEdit) Object.assign(acc, upd);
          else state.accounts.push({ id: preset, preset, name, key: '', ...upd });
        } else {
          const key = keyInput.value.trim();
          if (!isEdit && !key) return setError('请输入 API Key');
          if (isEdit) {
            acc.name = name;
            if (key) acc.key = key;
          } else {
            state.accounts.push({ id: preset, preset, name, key });
          }
        }
        const saved = isEdit ? acc : state.accounts[state.accounts.length - 1];
        persist();
        close();
        renderGrid();
        toast(isEdit ? '已保存修改' : '已添加厂商', 'success');
        refreshAccount(saved);
      },
    }, isEdit ? '保存' : '添加');

    if (!isEdit) {
      renderPresets();
    }
    renderFields();

    const mask = el('div', {
      class: 'modal-mask', onclick: (e) => { if (e.target === mask) close(); },
    },
      el('div', { class: 'qt-dialog' },
        el('h3', {}, isEdit ? `编辑「${acc.name}」` : '添加大模型厂商'),
        el('div', { class: 'qt-dialog-hint' }, '自动=通过 API Key 查询余额；手动=自行录入用量，本地统计消耗与到期提醒'),
        ...(!isEdit ? [el('div', { class: 'qt-dialog-field' }, el('label', {}, '选择厂商'), presetRow)] : []),
        fieldsWrap,
        errorText,
        el('div', { class: 'qt-dialog-actions' },
          el('button', { class: 'qt-dialog-cancel', onclick: close }, '取消'),
          submit)));
    document.getElementById('modal-root').append(mask);
    (isEdit ? (isManual(acc) ? remainingInput : keyInput) : nameInput).focus();
  }

  // ---------- 启动与自动刷新 ----------
  renderHeader();
  renderGrid();
  refreshAll();

  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    const now = Date.now();
    for (const acc of state.accounts) {
      const ld = state.lastData[acc.id];
      if (!ld || now - ld.fetchedAt > STALE_MS) refreshAccount(acc);
    }
  }, 60 * 1000);

  return root;
}
