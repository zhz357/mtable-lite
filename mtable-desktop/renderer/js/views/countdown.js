//
// views/countdown.js — 倒计时插件（pluginKey: countdown）
// 功能：多个倒计时项目管理（新建/编辑/删除/完成）、实时剩余时间（天时分秒）、
//       到期视觉+听觉提醒、下班倒计时（每天可独立设时段、相同时段聚合展示，非工作时段展示睡觉猫）、
//       排序（手动/剩余时间/创建时间/名称）、深浅色主题、localStorage 本地持久化。
// 时间模型：目标时间以 Unix 毫秒时间戳存储，每次刷新用 Date.now() 现算剩余量，
//       不累计定时器误差，系统时间变更后下一跳自动校正。
//
import { el, clear, toast, confirmModal } from '../ui.js';
import { icon } from '../icons.js';

// ---------- 常量 ----------
const STORAGE_KEY = 'com.mtable.countdowns';
const STORAGE_VERSION = 1;

const ACCENTS = ['blue', 'purple', 'green', 'orange', 'red'];
const ACCENT_NAMES = { blue: '蓝', purple: '紫', green: '绿', orange: '橙', red: '红' };
const DEFAULT_CATEGORIES = ['学习', '工作', '生活', '节日', '其他'];
const END_ACTIONS = { notify: '仅提醒', complete: '提醒并自动标记完成' };

// ---------- 工具 ----------
const pad2 = (n) => String(n).padStart(2, '0');

function uid() {
  return `cd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 目标时间戳 → datetime-local 输入框值（本地时区） */
function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 格式化日期时间：2026-10-30 18:00 */
function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 剩余时间拆分为天/时/分/秒（不为负） */
function splitRemaining(diff) {
  const total = Math.max(0, Math.floor(diff / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/** 秒数拆分为时/分/秒（下班倒计时用） */
function splitHMS(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  return {
    h: Math.floor(s / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

// ---------- 本地持久化 ----------
// 当前插件数据（视图与持久化共用；视图重建时从 localStorage 重新加载）
let state = null;

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const targetTime = Number(raw.targetTime);
  if (!Number.isFinite(targetTime)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 50) : '未命名倒计时',
    targetTime,
    category: typeof raw.category === 'string' && raw.category ? raw.category : DEFAULT_CATEGORIES[2],
    accent: ACCENTS.includes(raw.accent) ? raw.accent : 'blue',
    note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : '',
    remindAtEnd: raw.remindAtEnd !== false,
    endAction: raw.endAction === 'complete' ? 'complete' : 'notify',
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    notified: raw.notified === true,
    done: raw.done === true,
  };
}

function defaultState() {
  return {
    version: STORAGE_VERSION,
    settings: {
      theme: 'light', soundOn: true, sortBy: 'manual',
      offwork: { workdays: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', overrides: {} },
    },
    categories: [...DEFAULT_CATEGORIES],
    items: [],
  };
}

/** 校验 HH:MM 时间字符串 */
function isHM(v) { return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v); }

/** 下班倒计时配置清洗（非法数据回退默认值） */
function sanitizeOffwork(raw) {
  const base = { workdays: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', overrides: {} };
  if (!raw || typeof raw !== 'object') return base;
  const workdays = Array.isArray(raw.workdays)
    ? [...new Set(raw.workdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    : base.workdays;
  const overrides = {};
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const [k, v] of Object.entries(raw.overrides)) {
      const d = Number(k);
      if (Number.isInteger(d) && d >= 0 && d <= 6 && v && isHM(v.start) && isHM(v.end)) {
        overrides[d] = { start: v.start, end: v.end };
      }
    }
  }
  return {
    workdays: workdays.length ? workdays : base.workdays,
    start: isHM(raw.start) ? raw.start : base.start,
    end: isHM(raw.end) ? raw.end : base.end,
    overrides,
  };
}

/** 某天生效的时段：{start,end}；单独设置优先，其次默认工作日，null 表示休息 */
function daySchedule(cfg, day) {
  const ov = cfg.overrides && cfg.overrides[day];
  if (ov) return ov;
  if (cfg.workdays.includes(day)) return { start: cfg.start, end: cfg.end };
  return null;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return {
      version: STORAGE_VERSION,
      settings: {
        theme: parsed?.settings?.theme === 'dark' ? 'dark' : 'light',
        soundOn: parsed?.settings?.soundOn !== false,
        sortBy: ['manual', 'remaining', 'created', 'title'].includes(parsed?.settings?.sortBy)
          ? parsed.settings.sortBy : 'manual',
        offwork: sanitizeOffwork(parsed?.settings?.offwork),
      },
      categories: Array.isArray(parsed?.categories) && parsed.categories.length
        ? [...new Set(parsed.categories.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim()))]
        : base.categories,
      items: Array.isArray(parsed?.items) ? parsed.items.map(sanitizeItem).filter(Boolean) : [],
    };
  } catch {
    toast('倒计时数据解析失败，已使用空数据启动', 'error');
    return defaultState();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    toast('保存失败：本地存储不可用', 'error');
    return false;
  }
}

// ---------- 到期提示音（Web Audio 合成，无需音频资源） ----------
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* 无声环境下静默失败 */ }
}

// ---------- 视图 ----------
export function CountdownView() {
  state = loadState();
  let flashItemId = null; // 到期时需要高亮的卡片

  // 每秒刷新的数字节点缓存：id -> { d, h, m, s, bar }
  const tickRefs = new Map();

  // ---------- 骨架 ----------
  const headerEl = el('div', { class: 'cd-header' });
  const toolbarEl = el('div', { class: 'cd-toolbar' });
  const gridWrapEl = el('div', { class: 'cd-grid-wrap' });
  const root = el('div', { class: 'cd-root', dataset: { theme: state.settings.theme } },
    headerEl, toolbarEl, gridWrapEl);

  // ---------- 顶部栏 ----------
  function renderHeader() {
    clear(headerEl);
    const themeBtn = el('button', {
      class: 'cd-icon-btn', title: state.settings.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式',
      onclick: () => {
        state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = state.settings.theme;
        persist();
        renderHeader();
      },
    }, el('span', { class: 'icon', innerHTML: icon(state.settings.theme === 'dark' ? 'moon.fill' : 'sun.max.fill') }));

    const soundBtn = el('button', {
      class: `cd-icon-btn${state.settings.soundOn ? ' is-on' : ''}`,
      title: state.settings.soundOn ? '关闭到期提示音' : '开启到期提示音',
      onclick: () => {
        state.settings.soundOn = !state.settings.soundOn;
        persist();
        renderHeader();
        toast(state.settings.soundOn ? '已开启到期提示音' : '已关闭到期提示音');
      },
    }, el('span', { class: 'icon', innerHTML: icon(state.settings.soundOn ? 'bell.fill' : 'bell') }));

    headerEl.append(
      el('div', { class: 'cd-header-titles' },
        el('div', { class: 'cd-title' }, '倒计时'),
        el('div', { class: 'cd-subtitle' }, '记录重要时刻，实时显示剩余时间，到期自动提醒')),
      el('div', { class: 'cd-header-actions' },
        themeBtn,
        soundBtn,
      ),
    );
  }

  // ---------- 工具栏（排序 + 新建） ----------
  function renderToolbar() {
    clear(toolbarEl);

    const sortSelect = el('select', {
      class: 'cd-select',
      onchange: (e) => { state.settings.sortBy = e.target.value; persist(); renderGrid(); },
    },
      el('option', { value: 'manual' }, '手动排序'),
      el('option', { value: 'remaining' }, '按剩余时间'),
      el('option', { value: 'created' }, '按创建时间'),
      el('option', { value: 'title' }, '按名称'),
    );
    sortSelect.value = state.settings.sortBy;

    toolbarEl.append(
      el('div', { class: 'cd-toolbar-right' },
        el('span', { class: 'cd-toolbar-label' }, '排序'),
        sortSelect,
        el('button', {
          class: 'cd-btn-primary', onclick: () => openItemDialog({}),
        }, el('span', { class: 'icon', style: { width: '14px', height: '14px' }, innerHTML: icon('plus') }), '新建倒计时'),
      ),
    );
  }

  // ---------- 列表 ----------
  function visibleItems() {
    let list = [...state.items];
    const sortBy = state.settings.sortBy;
    if (sortBy === 'remaining') list = [...list].sort((a, b) => a.targetTime - b.targetTime);
    else if (sortBy === 'created') list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    else if (sortBy === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    else list = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    return list;
  }

  function itemStatus(item) {
    if (item.done) return 'done';
    return item.targetTime <= Date.now() ? 'ended' : 'running';
  }

  function renderGrid() {
    clear(gridWrapEl);
    tickRefs.clear();
    const items = visibleItems();

    const grid = el('div', { class: 'cd-grid' });
    // 下班倒计时作为固定首卡，与倒计时卡片同尺寸
    grid.append(offworkCard());

    if (!items.length) {
      grid.append(el('div', { class: 'cd-empty' },
        el('span', { class: 'icon', style: { width: '46px', height: '46px' }, innerHTML: icon('hourglass') }),
        el('div', { class: 'cd-empty-title' }, '还没有倒计时项目'),
        el('div', { class: 'cd-empty-sub' }, '点击右上角「新建倒计时」，设置标题与目标时间即可开始'),
      ));
      gridWrapEl.append(grid);
      return;
    }

    for (const item of items) grid.append(itemCard(item, items));
    gridWrapEl.append(grid);

    if (flashItemId) {
      const card = gridWrapEl.querySelector(`[data-id="${flashItemId}"]`);
      if (card) {
        card.classList.add('cd-flash');
        setTimeout(() => card.classList.remove('cd-flash'), 2600);
      }
      flashItemId = null;
    }
  }

  function itemCard(item, items) {
    const status = itemStatus(item);
    const remaining = splitRemaining(item.targetTime - Date.now());
    const span = Math.max(1, item.targetTime - item.createdAt);
    const pct = status === 'running'
      ? Math.min(100, Math.max(0, ((Date.now() - item.createdAt) / span) * 100))
      : 100;

    const refs = {
      d: el('span', { class: 'cd-num' }, pad2(remaining.d)),
      h: el('span', { class: 'cd-num' }, pad2(remaining.h)),
      m: el('span', { class: 'cd-num' }, pad2(remaining.m)),
      s: el('span', { class: 'cd-num' }, pad2(remaining.s)),
      bar: el('div', { class: 'cd-card-bar-fill', style: { width: `${pct}%` } }),
      digits: null,
    };

    const digitsWrap = el('div', { class: `cd-digits${status === 'running' ? '' : ' dim'}` },
      el('div', { class: 'cd-unit' }, refs.d, el('div', { class: 'cd-unit-label' }, '天')),
      el('div', { class: 'cd-unit' }, refs.h, el('div', { class: 'cd-unit-label' }, '时')),
      el('div', { class: 'cd-unit' }, refs.m, el('div', { class: 'cd-unit-label' }, '分')),
      el('div', { class: 'cd-unit' }, refs.s, el('div', { class: 'cd-unit-label' }, '秒')),
    );
    refs.digits = digitsWrap;

    const badgeText = status === 'done' ? '已完成' : status === 'ended' ? '已到期' : '进行中';
    const idx = items.findIndex((x) => x.id === item.id);
    const manual = state.settings.sortBy === 'manual';

    const card = el('div', {
      class: 'cd-card', dataset: { id: item.id, accent: item.accent, status },
    },
      el('div', { class: 'cd-card-top' },
        el('div', { class: 'cd-card-title-wrap' },
          el('div', { class: 'cd-card-title', title: item.title }, item.title),
          el('div', { class: 'cd-card-meta' },
            el('span', { class: `cd-badge ${status}` }, badgeText),
          ),
        ),
        el('div', { class: 'cd-card-actions' },
          el('button', {
            class: 'cd-icon-btn sm', title: '编辑',
            onclick: () => openItemDialog({ item }),
          }, el('span', { class: 'icon', style: { width: '13px', height: '13px' }, innerHTML: icon('pencil') })),
          el('button', {
            class: 'cd-icon-btn sm danger', title: '删除',
            onclick: () => deleteItem(item),
          }, el('span', { class: 'icon', style: { width: '13px', height: '13px' }, innerHTML: icon('trash') })),
        ),
      ),
      digitsWrap,
      item.note ? el('div', { class: 'cd-card-note', title: item.note }, item.note) : null,
      el('div', { class: 'cd-card-bar' }, refs.bar),
      el('div', { class: 'cd-card-foot' },
        el('div', { class: 'cd-card-target' },
          el('span', { class: 'icon', style: { width: '12px', height: '12px' }, innerHTML: icon('calendar') }),
          fmtDateTime(item.targetTime)),
        el('div', { class: 'cd-card-foot-btns' },
          manual ? el('button', {
            class: 'cd-icon-btn sm', title: '上移', disabled: idx <= 0 ? '' : null,
            onclick: () => moveItem(item, -1),
          }, el('span', { class: 'icon', style: { width: '12px', height: '12px' }, innerHTML: icon('arrow.up') })) : null,
          manual ? el('button', {
            class: 'cd-icon-btn sm', title: '下移', disabled: idx >= items.length - 1 ? '' : null,
            onclick: () => moveItem(item, 1),
          }, el('span', { class: 'icon', style: { width: '12px', height: '12px' }, innerHTML: icon('arrow.down') })) : null,
          el('button', {
            class: 'cd-btn-ghost sm',
            onclick: () => toggleDone(item),
          }, item.done ? '恢复进行' : '标记完成'),
        ),
      ),
    );

    tickRefs.set(item.id, refs);
    return card;
  }

  function renderAll() {
    renderHeader();
    renderToolbar();
    renderGrid();
  }

  // ---------- 下班倒计时 ----------
  // 配置区 = 周览条（7 天一览，时段相同的日期聚合同色）+ 编辑面板（选中日的组统一改，可拆出单日）。
  // 工作时段内每秒刷新距下班的 时/分/秒，非工作时段展示睡觉猫。
  const DAY_LABELS = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 0: '日' };
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  // 时段组配色：默认组用主题橙，单独组按序取色；同组日期在周览条中共用同色
  const BASE_COLOR = { main: 'var(--primary)', tint: 'rgba(255, 122, 71, .10)', line: 'rgba(255, 122, 71, .38)' };
  const REST_COLOR = { main: 'var(--cd-text-3)', tint: 'transparent', line: 'var(--cd-chip-border)' };
  const GROUP_COLORS = [
    { main: '#4c7dff', tint: 'rgba(76, 125, 255, .10)', line: 'rgba(76, 125, 255, .38)' },
    { main: '#2fae86', tint: 'rgba(47, 174, 134, .10)', line: 'rgba(47, 174, 134, .38)' },
    { main: '#9a5cf0', tint: 'rgba(154, 92, 240, .10)', line: 'rgba(154, 92, 240, .38)' },
    { main: '#e0a13a', tint: 'rgba(224, 161, 58, .12)', line: 'rgba(224, 161, 58, .40)' },
  ];

  // 慵懒睡觉的猫（内联 SVG，两套主题下均清晰可见）
  const CAT_SVG = `<svg viewBox="0 0 140 90" xmlns="http://www.w3.org/2000/svg">
    <path d="M96 62c14 6 26 2 30-8" stroke="#eda45f" stroke-width="9" fill="none" stroke-linecap="round"/>
    <ellipse cx="62" cy="60" rx="38" ry="22" fill="#f6c288"/>
    <circle cx="32" cy="48" r="18" fill="#f6c288"/>
    <path d="M20 36l-3-11 10 5z" fill="#f6c288"/>
    <path d="M42 33l3-11-11 4z" fill="#f6c288"/>
    <path d="M22.5 32l-1.5-5 5 2.5z" fill="#e89a9a"/>
    <path d="M41 29.5l2-5-6 1.5z" fill="#e89a9a"/>
    <path d="M24 48q3 3 6 0" stroke="#7a5230" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M36 48q3 3 6 0" stroke="#7a5230" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M31 55q2 2 4 0" stroke="#7a5230" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M52 44q6 2 12 0M56 52q6 2 12 0M88 50q6 0 10-4" stroke="#eda45f" stroke-width="3" fill="none" stroke-linecap="round"/>
    <text x="112" y="32" font-size="17" font-weight="700" fill="#8c94ad" font-family="system-ui">Z</text>
    <text x="123" y="20" font-size="12" font-weight="700" fill="#aab2c8" font-family="system-ui">z</text>
    <text x="102" y="14" font-size="9" font-weight="700" fill="#c3cad9" font-family="system-ui">z</text>
  </svg>`;

  let offworkMode = null; // 上次渲染模式（'working' | 'rest'），模式切换时整段重渲染
  let offRefs = null;     // working 模式下的秒级刷新节点 { h, m, s, bar }
  let offworkSelDay = null; // 配置区当前选中编辑的日子（null = 未选中，不聚焦任何天）
  let offworkSelReady = false; // 仅首次渲染时默认选中今天

  function parseHM(v) {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  }

  /** 计算当前下班倒计时状态 */
  function offworkStatus(now = new Date()) {
    const cfg = state.settings.offwork;
    const sched = daySchedule(cfg, now.getDay());
    const startMin = sched ? parseHM(sched.start) : 0;
    const endMin = sched ? parseHM(sched.end) : 0;
    const valid = !!sched && endMin > startMin;
    const isWorkday = !!sched;
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    if (isWorkday && valid && nowSec >= startMin * 60 && nowSec < endMin * 60) {
      const totalSec = (endMin - startMin) * 60;
      return {
        working: true,
        invalid: false,
        remainSec: endMin * 60 - nowSec,
        progress: Math.min(1, Math.max(0, (nowSec - startMin * 60) / totalSec)),
      };
    }
    return { working: false, invalid: isWorkday && !valid, remainSec: 0, progress: 0 };
  }

  function offworkUnit(numEl, label) {
    return el('div', { class: 'cd-unit' }, numEl, el('div', { class: 'cd-unit-label' }, label));
  }

  /** 下班倒计时卡片（与倒计时卡片同尺寸，固定为网格首卡） */
  function offworkCard() {
    offRefs = null;
    const cfg = state.settings.offwork;
    const st = offworkStatus();
    offworkMode = st.working ? 'working' : 'rest';

    // ---------- 配置区：周览条（按组着色）+ 选中日所在组的编辑面板 ----------
    const baseDays = DAY_ORDER.filter((d) => !cfg.overrides[d] && cfg.workdays.includes(d));
    const groups = new Map();
    for (const d of DAY_ORDER) {
      const ov = cfg.overrides[d];
      if (!ov) continue;
      const k = `${ov.start}|${ov.end}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(d);
    }
    const groupList = [];
    if (baseDays.length) groupList.push({ key: 'base', days: baseDays, sched: { start: cfg.start, end: cfg.end }, color: BASE_COLOR });
    for (const [k, days] of groups) {
      groupList.push({ key: k, days, sched: cfg.overrides[days[0]], color: GROUP_COLORS[(groupList.length - 1) % GROUP_COLORS.length] });
    }
    const dayGroup = new Map();
    for (const g of groupList) for (const d of g.days) dayGroup.set(d, g);

    const today = new Date().getDay();
    if (!offworkSelReady) {
      offworkSelReady = true;
      offworkSelDay = dayGroup.has(today) ? today : (groupList.length ? groupList[0].days[0] : null);
    }

    const week = el('div', { class: 'cd-offwork-week' });
    for (const d of DAY_ORDER) {
      const g = dayGroup.get(d);
      const c = g ? g.color : REST_COLOR;
      week.append(el('button', {
        class: `cd-offwork-day${offworkSelDay === d ? ' selected' : ''}${g ? '' : ' rest'}${d === today ? ' today' : ''}`,
        style: { color: c.main, background: c.tint, borderColor: c.line },
        title: g ? `周${DAY_LABELS[d]}：${g.sched.start} 至 ${g.sched.end}` : `周${DAY_LABELS[d]}：休息日，点击可恢复上班`,
        onclick: () => { offworkSelDay = d; renderGrid(); },
      },
        el('span', { class: 'cd-offwork-day-name' }, DAY_LABELS[d]),
        g
          ? el('span', { class: 'cd-offwork-day-time' }, g.sched.end)
          : el('span', { class: 'cd-offwork-day-time rest-tag' },
              el('span', { class: 'icon', style: { width: '9px', height: '9px' }, innerHTML: icon('moon.fill') }),
              '休'),
      ));
    }

    const timePair = (sched, onCommit) => el('span', { class: 'cd-offwork-timepair' },
      el('input', {
        class: 'cd-select', type: 'time', value: sched.start,
        onchange: (e) => { if (!e.target.value) { e.target.value = sched.start; return; } onCommit('start', e.target.value); },
      }),
      el('span', { class: 'cd-offwork-config-sep' }, '至'),
      el('input', {
        class: 'cd-select', type: 'time', value: sched.end,
        onchange: (e) => { if (!e.target.value) { e.target.value = sched.end; return; } onCommit('end', e.target.value); },
      }),
    );

    // 单独时段与默认一致时自动并入默认组
    function mergeIntoBase() {
      for (const d of Object.keys(cfg.overrides)) {
        if (cfg.overrides[d].start === cfg.start && cfg.overrides[d].end === cfg.end) delete cfg.overrides[d];
      }
    }

    const sel = dayGroup.get(offworkSelDay);
    let editor = null;
    if (sel) {
      const isBase = sel.key === 'base';
      editor = el('div', { class: 'cd-offwork-editor' },
        el('div', { class: 'cd-offwork-editor-head' },
          el('span', { class: 'cd-offwork-editor-dot', style: { background: sel.color.main } }),
          el('span', {}, `周${sel.days.map((d) => DAY_LABELS[d]).join('·周')}`),
          el('span', { class: 'cd-offwork-editor-tag', style: { background: sel.color.main } }, isBase ? '默认时段' : '单独设置'),
        ),
        el('div', { class: 'cd-offwork-editor-row' },
          timePair(sel.sched, (key, val) => {
            if (isBase) cfg[key] = val;
            else for (const d of sel.days) cfg.overrides[d][key] = val;
            mergeIntoBase();
            persist();
            renderGrid();
          }),
        ),
        el('div', { class: 'cd-offwork-editor-foot' },
          sel.days.length > 1 ? el('button', {
            class: 'cd-btn-ghost sm', title: '将选中的这一天拆出，单独设置时段',
            onclick: () => { cfg.overrides[offworkSelDay] = { start: sel.sched.start, end: sel.sched.end }; offworkSelDay = null; persist(); renderGrid(); },
          }, `把周${DAY_LABELS[offworkSelDay]}单独设置`) : null,
          !isBase && sel.days.length === 1 ? el('button', {
            class: 'cd-btn-ghost sm', title: '取消单独设置，回到默认时段',
            onclick: () => { delete cfg.overrides[sel.days[0]]; offworkSelDay = null; persist(); renderGrid(); },
          }, '沿用默认时段') : null,
          el('button', {
            class: 'cd-btn-ghost sm', title: '将选中的这一天设为休息日',
            onclick: () => {
              const d = offworkSelDay;
              cfg.workdays = cfg.workdays.filter((x) => x !== d);
              delete cfg.overrides[d];
              offworkSelDay = null;
              persist();
              renderGrid();
            },
          }, `把周${DAY_LABELS[offworkSelDay]}设为休息`),
          sel.days.length > 1 ? el('span', { class: 'cd-offwork-editor-hint' }, '修改时段将应用到本组全部日期') : null,
        ),
      );
    } else if (offworkSelDay != null) {
      // 选中的是休息日：不自动改数据，仅提供恢复上班入口
      editor = el('div', { class: 'cd-offwork-editor' },
        el('div', { class: 'cd-offwork-editor-head' },
          el('span', { class: 'cd-offwork-editor-dot', style: { background: 'var(--cd-text-3)' } }),
          el('span', {}, `周${DAY_LABELS[offworkSelDay]}`),
          el('span', { class: 'cd-offwork-editor-tag', style: { background: 'var(--cd-text-3)' } }, '休息日'),
        ),
        el('div', { class: 'cd-offwork-editor-foot' },
          el('button', {
            class: 'cd-btn-ghost sm', title: '取消休息，按默认时段上班',
            onclick: () => { cfg.workdays.push(offworkSelDay); cfg.workdays.sort((a, b) => a - b); offworkSelDay = null; persist(); renderGrid(); },
          }, '按默认时段上班'),
        ),
      );
    }

    const configRows = [week, editor].filter(Boolean);

    // 展示区：工作时段 → 时/分/秒倒计时；非工作时段 → 睡觉猫
    let body;
    if (st.working) {
      const r = splitHMS(st.remainSec);
      offRefs = {
        h: el('span', { class: 'cd-num' }, pad2(r.h)),
        m: el('span', { class: 'cd-num' }, pad2(r.m)),
        s: el('span', { class: 'cd-num' }, pad2(r.s)),
        bar: el('div', { class: 'cd-offwork-bar-fill', style: { width: `${st.progress * 100}%` } }),
      };
      body = [
        el('div', { class: 'cd-offwork-digits' },
          offworkUnit(offRefs.h, '时'),
          offworkUnit(offRefs.m, '分'),
          offworkUnit(offRefs.s, '秒')),
        el('div', { class: 'cd-offwork-bar' }, offRefs.bar),
        el('div', { class: 'cd-card-note' }, `今日 ${daySchedule(cfg, new Date().getDay()).end} 下班，加油～`),
      ];
    } else {
      body = [el('div', { class: 'cd-offwork-rest' },
        el('span', { class: 'cd-offwork-cat', innerHTML: CAT_SVG }),
        el('div', { class: 'cd-offwork-rest-text' },
          st.invalid ? '下班时间需晚于上班时间，请调整配置' : '当前为休息时间，好好休息～'),
      )];
    }

    return el('div', { class: 'cd-card cd-offwork-card' },
      el('div', { class: 'cd-card-top' },
        el('div', { class: 'cd-card-title-wrap' },
          el('div', { class: 'cd-card-title' }, '下班倒计时'),
          el('div', { class: 'cd-card-meta' },
            el('span', { class: `cd-badge ${st.working ? 'running' : 'ended'}` }, st.working ? '工作中' : '休息中'),
          ),
        ),
      ),
      ...body,
      el('div', { class: 'cd-offwork-config' }, configRows),
    );
  }

  /** 每秒刷新下班倒计时；模式切换（上班/下班临界）时重建网格 */
  function updateOffwork() {
    const st = offworkStatus();
    const mode = st.working ? 'working' : 'rest';
    if (mode !== offworkMode) { renderGrid(); return; }
    if (st.working && offRefs) {
      const r = splitHMS(st.remainSec);
      offRefs.h.textContent = pad2(r.h);
      offRefs.m.textContent = pad2(r.m);
      offRefs.s.textContent = pad2(r.s);
      offRefs.bar.style.width = `${st.progress * 100}%`;
    }
  }

  // ---------- 每秒刷新（只更新数字节点，避免整卡重排） ----------
  function updateTick() {
    const now = Date.now();
    for (const item of state.items) {
      const refs = tickRefs.get(item.id);
      const r = splitRemaining(item.targetTime - now);
      if (refs) {
        refs.d.textContent = pad2(r.d);
        refs.h.textContent = pad2(r.h);
        refs.m.textContent = pad2(r.m);
        refs.s.textContent = pad2(r.s);
        const span = Math.max(1, item.targetTime - item.createdAt);
        refs.bar.style.width = `${Math.min(100, Math.max(0, ((now - item.createdAt) / span) * 100))}%`;
      }
      // 到期检测：以目标时间戳为准，仅触发一次
      if (!item.notified && !item.done && now >= item.targetTime) finishItem(item);
    }
    updateOffwork();
  }

  function finishItem(item) {
    item.notified = true;
    if (item.endAction === 'complete') item.done = true;
    persist();
    flashItemId = item.id;
    renderGrid();
    if (item.remindAtEnd) {
      toast(`倒计时「${item.title}」已到期`, 'success');
      if (state.settings.soundOn) beep();
    }
  }

  // 对齐到下一整秒再跳动，避免 setInterval 累积误差；视图销毁后自动停止
  let tickerId = null;
  function startTicker() {
    if (tickerId) clearTimeout(tickerId);
    const loop = () => {
      tickerId = null;
      if (!root.isConnected) return;
      updateTick();
      tickerId = setTimeout(loop, 1000 - (Date.now() % 1000) + 20);
    };
    tickerId = setTimeout(loop, 1000 - (Date.now() % 1000) + 20);
  }

  // ---------- 项目操作 ----------
  function deleteItem(item) {
    confirmModal({
      title: '删除倒计时',
      message: `确定删除倒计时「${item.title}」吗？删除后不可恢复。`,
      confirmText: '删除', cancelText: '取消', danger: true,
    }).then((ok) => {
      if (!ok) return;
      state.items = state.items.filter((x) => x.id !== item.id);
      persist();
      renderGrid();
      toast('已删除倒计时');
    });
  }

  function toggleDone(item) {
    item.done = !item.done;
    if (item.done) item.notified = true;
    persist();
    renderGrid();
  }

  function moveItem(item, dir) {
    const items = visibleItems();
    const idx = items.findIndex((x) => x.id === item.id);
    const other = items[idx + dir];
    if (!other) return;
    const tmp = item.sortOrder;
    item.sortOrder = other.sortOrder;
    other.sortOrder = tmp;
    persist();
    renderGrid();
  }

  // ---------- 新建 / 编辑弹窗 ----------
  function openItemDialog({ item }) {
    const isEdit = !!item;
    let submitting = false;

    const titleInput = el('input', {
      class: 'cd-dialog-input', type: 'text', placeholder: '例如：期末考试、生日、发布会',
      maxlength: '50', value: item?.title || '',
    });
    const timeInput = el('input', {
      class: 'cd-dialog-input', type: 'datetime-local',
      value: toLocalInput(item?.targetTime || (Date.now() + 24 * 3600 * 1000)),
    });
    const noteInput = el('textarea', {
      class: 'cd-dialog-input', rows: '2', placeholder: '备注（可选）', maxlength: '200',
    });
    noteInput.value = item?.note || '';

    let accent = item?.accent || 'blue';
    const accentRow = el('div', { class: 'cd-accent-row' });
    function renderAccents() {
      clear(accentRow);
      for (const a of ACCENTS) {
        accentRow.append(el('button', {
          class: `cd-accent-cell${a === accent ? ' selected' : ''}`, dataset: { accent: a },
          title: ACCENT_NAMES[a],
          onclick: () => { accent = a; renderAccents(); },
        }, el('span', { class: 'cd-accent-dot' })));
      }
    }
    renderAccents();

    const remindCheck = el('input', { type: 'checkbox' });
    remindCheck.checked = item ? item.remindAtEnd !== false : true;
    const actionSelect = el('select', { class: 'cd-dialog-input' },
      Object.entries(END_ACTIONS).map(([k, v]) => el('option', { value: k }, v)));
    actionSelect.value = item?.endAction === 'complete' ? 'complete' : 'notify';

    const errorText = el('div', { class: 'cd-dialog-error' });
    const submitBtn = el('button', { class: 'cd-dialog-submit' }, isEdit ? '保存' : '创建');

    function setError(msg) {
      if (msg) { errorText.textContent = msg; errorText.style.display = 'block'; }
      else errorText.style.display = 'none';
    }
    function close() { mask.remove(); }

    function submit() {
      if (submitting) return;
      const title = titleInput.value.trim();
      const timeValue = timeInput.value;
      setError(null);
      if (!title) return setError('请输入倒计时标题');
      const targetTime = new Date(timeValue).getTime();
      if (!timeValue || !Number.isFinite(targetTime)) return setError('请选择有效的目标日期时间');

      submitting = true;
      clear(submitBtn);
      submitBtn.append(el('span', { class: 'spinner' }));
      submitBtn.disabled = true;

      const data = {
        title,
        targetTime,
        accent,
        note: noteInput.value.trim(),
        remindAtEnd: remindCheck.checked,
        endAction: actionSelect.value,
      };

      try {
        if (isEdit) {
          Object.assign(item, data);
          // 目标时间改到未来后允许再次提醒
          if (targetTime > Date.now()) item.notified = false;
        } else {
          const maxSort = state.items.reduce((m, x) => Math.max(m, x.sortOrder), -1);
          state.items.push({
            id: uid(), ...data,
            createdAt: Date.now(), sortOrder: maxSort + 1,
            notified: false, done: false,
          });
        }
        persist();
        close();
        renderGrid();
        toast(isEdit ? '已保存修改' : '已创建倒计时', 'success');
      } catch (err) {
        submitting = false;
        clear(submitBtn);
        submitBtn.append(isEdit ? '保存' : '创建');
        submitBtn.disabled = false;
        setError(err?.message || '操作失败，请稍后重试');
      }
    }
    submitBtn.addEventListener('click', submit);

    const mask = el('div', {
      class: 'modal-mask',
      onclick: (e) => { if (e.target === mask) close(); },
    },
      el('div', { class: 'cd-dialog' },
        el('h3', {}, isEdit ? '编辑倒计时' : '新建倒计时'),
        el('div', { class: 'cd-dialog-body' },
          el('div', { class: 'cd-dialog-field' },
            el('label', {}, '标题'), titleInput),
          el('div', { class: 'cd-dialog-field' },
            el('label', {}, '目标日期时间'), timeInput),
          el('div', { class: 'cd-dialog-field' },
            el('label', {}, '卡片颜色'), accentRow),
          el('div', { class: 'cd-dialog-field' },
            el('label', {}, '备注'), noteInput),
          el('div', { class: 'cd-dialog-field' },
            el('label', {}, '到期后操作'),
            el('div', { class: 'cd-dialog-row' },
              actionSelect,
              el('label', { class: 'cd-check-label' }, remindCheck, '到期提醒（视觉+声音）'))),
        ),
        errorText,
        el('div', { class: 'cd-dialog-actions' },
          el('button', { class: 'cd-dialog-cancel', onclick: close }, '取消'),
          submitBtn),
      ),
    );
    document.getElementById('modal-root').append(mask);
    titleInput.focus();
  }

  // ---------- 启动 ----------
  renderAll();
  startTicker();
  return root;
}
