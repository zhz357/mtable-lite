//
// views/topbar.js — 顶部栏：Logo + 搜索框/引擎下拉 + 天气悬浮弹层 + 通知角标 + 头像下拉菜单
// （移植自 TopBarView.swift / WeatherView.swift / MainLayoutView.swift 的下拉部分）
//
import { el, clear, avatarNode, toast, adminBadge } from '../ui.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { WeatherView } from './weather.js';
import { FeedbackModal } from './feedback.js';
import { NotificationPanel } from './notifications.js';
import { PetView } from './pet.js';
import { checkUpdate, installerForPlatform, downloadInstaller } from '../updater.js';
import { applyWallpaper, getWallpaperState, scheduleWallpaperSave } from '../wallpaper.js';

// 品牌 Logo 标记（珊瑚橙立体 M，与 build/icon.png 同源设计）
const LOGO_MARK = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<defs>
<linearGradient id="lgbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF9F2"/><stop offset="1" stop-color="#F7E5D2"/></linearGradient>
<linearGradient id="lgfr" x1="0" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#FFA66B"/><stop offset="0.52" stop-color="#FF7A47"/><stop offset="1" stop-color="#E85A2C"/></linearGradient>
<path id="lgm" d="M 13 86 L 13 14 L 34 14 L 50 48 L 66 14 L 87 14 L 87 86 L 70 86 L 70 44 L 55 74 L 45 74 L 30 44 L 30 86 Z"/></defs>
<rect width="1024" height="1024" rx="232" fill="url(#lgbg)"/>
<g transform="translate(196 178) scale(6.1)" fill="#B4491F">
<use href="#lgm" x="0.5" y="0.56"/><use href="#lgm" x="1" y="1.12"/><use href="#lgm" x="1.5" y="1.68"/>
<use href="#lgm" x="2" y="2.24"/><use href="#lgm" x="2.5" y="2.8"/><use href="#lgm" x="3" y="3.36"/>
<use href="#lgm" x="3.5" y="3.92"/><use href="#lgm" x="4" y="4.48"/><use href="#lgm" x="4.5" y="5.04"/>
<use href="#lgm" x="5" y="5.6"/><use href="#lgm" x="5.5" y="6.16"/><use href="#lgm" x="6" y="6.72"/>
</g>
<g transform="translate(196 178) scale(6.1)">
<use href="#lgm" fill="url(#lgfr)"/><use href="#lgm" fill="none" stroke="#FFFFFF" stroke-opacity="0.42" stroke-width="0.7"/>
</g></svg>`;

// SearchEngine.swift：搜索引擎列表与 URL 模板
const ENGINES = [
  {
    key: 'baidu', displayName: '百度',
    template: 'https://www.baidu.com/s?wd=%@&ie=utf-8',
    favicon: 'https://www.baidu.com/favicon.ico',
    fallback: '百',
    fallbackBg: 'linear-gradient(135deg, #3373f2, #1a59d9)',
  },
  {
    key: 'bing', displayName: '必应',
    template: 'https://www.bing.com/search?q=%@',
    favicon: 'https://www.bing.com/favicon.ico',
    fallback: 'b',
    fallbackBg: 'linear-gradient(135deg, #1a73d9, #0d59bf)',
  },
  {
    key: 'google', displayName: '谷歌',
    template: 'https://www.google.com/search?q=%@',
    favicon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%234285F4' d='M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.7h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.36z'/%3E%3Cpath fill='%2334A853' d='M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z'/%3E%3Cpath fill='%23FBBC05' d='M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z'/%3E%3Cpath fill='%23EA4335' d='M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C29.86 4.26 24.94 2 24 2 15.4 2 7.96 6.93 4.34 14.1l7.35 5.7c1.73-5.2 6.58-9.05 12.31-9.05z'/%3E%3C/svg%3E",
    fallback: 'G',
    fallbackBg: 'linear-gradient(135deg, #4285f4, #1a56c4)',
  },
];

// ---------- 日历增强：24 节气 / 农历·公历节日 / 联网法定节假日（移植自 CalendarPopoverView.swift） ----------

// 24 节气数据：名称 + 平均所在月日 + 对应太阳视黄经（度）
const SOLAR_TERMS = [
  { name: '小寒', month: 1, day: 5, longitude: 285 },
  { name: '大寒', month: 1, day: 20, longitude: 300 },
  { name: '立春', month: 2, day: 4, longitude: 315 },
  { name: '雨水', month: 2, day: 19, longitude: 330 },
  { name: '惊蛰', month: 3, day: 5, longitude: 345 },
  { name: '春分', month: 3, day: 20, longitude: 0 },
  { name: '清明', month: 4, day: 5, longitude: 15 },
  { name: '谷雨', month: 4, day: 20, longitude: 30 },
  { name: '立夏', month: 5, day: 5, longitude: 45 },
  { name: '小满', month: 5, day: 21, longitude: 60 },
  { name: '芒种', month: 6, day: 5, longitude: 75 },
  { name: '夏至', month: 6, day: 21, longitude: 90 },
  { name: '小暑', month: 7, day: 7, longitude: 105 },
  { name: '大暑', month: 7, day: 23, longitude: 120 },
  { name: '立秋', month: 8, day: 7, longitude: 135 },
  { name: '处暑', month: 8, day: 23, longitude: 150 },
  { name: '白露', month: 9, day: 7, longitude: 165 },
  { name: '秋分', month: 9, day: 23, longitude: 180 },
  { name: '寒露', month: 10, day: 8, longitude: 195 },
  { name: '霜降', month: 10, day: 23, longitude: 210 },
  { name: '立冬', month: 11, day: 7, longitude: 225 },
  { name: '小雪', month: 11, day: 22, longitude: 240 },
  { name: '大雪', month: 12, day: 7, longitude: 255 },
  { name: '冬至', month: 12, day: 22, longitude: 270 },
];

// 节气结果缓存（key: 公历年）
const solarTermCache = new Map();

/** 太阳视黄经（度，0~360） */
function sunApparentLongitude(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const mr = (M * Math.PI) / 180;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(mr)
        + (0.019993 - 0.000101 * T) * Math.sin(2 * mr)
        + 0.000289 * Math.sin(3 * mr);
  let lon = (L0 + C) % 360;
  if (lon < 0) lon += 360;
  return lon;
}

/** 牛顿迭代求解太阳黄经等于目标值的儒略日（黄经日均变化约 0.98564736°） */
function solveSolarLongitude(target, guessJD) {
  let jd = guessJD;
  for (let i = 0; i < 20; i++) {
    const lon = sunApparentLongitude(jd);
    let delta = target - lon;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    if (Math.abs(delta) < 1e-6) break;
    jd += delta / 0.98564736;
  }
  return jd;
}

/** 计算某公历年所有节气的公历日期（以中国时区确定落在哪天） */
function solarTermDates(year) {
  const cached = solarTermCache.get(year);
  if (cached) return cached;
  const result = SOLAR_TERMS.map((term) => {
    // 以北京时间正午（UTC 4 点）作为初值，对应 Swift 版 Asia/Shanghai 正午
    const guessJD = Date.UTC(year, term.month - 1, term.day, 4) / 86400000 + 2440587.5;
    const jd = solveSolarLongitude(term.longitude, guessJD);
    const cn = new Date(Math.round((jd - 2440587.5) * 86400000) + 8 * 3600000);
    return { name: term.name, month: cn.getUTCMonth() + 1, day: cn.getUTCDate() };
  });
  solarTermCache.set(year, result);
  return result;
}

/** 查询指定日期（年月日数值）的节气名称 */
function solarTermName(y, m, d) {
  return solarTermDates(y).find((t) => t.month === m && t.day === d)?.name || null;
}

// 农历月日数值（formatToParts 取数字，用于节日匹配）
const fmtLunarMD = (() => {
  try { return new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric' }); } catch { return null; }
})();

function lunarMonthDay(date) {
  if (!fmtLunarMD) return null;
  try {
    const parts = fmtLunarMD.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const m = parseInt(get('month'), 10);
    const d = parseInt(get('day'), 10);
    if (!m || !d) return null;
    return { m, d };
  } catch { return null; }
}

// 农历节日（月: {日: 名称}）
const LUNAR_FESTIVALS = {
  1: { 1: '春节', 15: '元宵节' },
  5: { 5: '端午节' },
  7: { 7: '七夕', 15: '中元节' },
  8: { 15: '中秋节' },
  9: { 9: '重阳节' },
  12: { 8: '腊八', 23: '小年', 24: '小年' },
};

// 公历节日（月: {日: 名称}）
const SOLAR_FESTIVALS = {
  1: { 1: '元旦' },
  2: { 14: '情人节' },
  3: { 8: '妇女节', 12: '植树节' },
  4: { 1: '愚人节' },
  5: { 1: '劳动节', 4: '青年节' },
  6: { 1: '儿童节' },
  7: { 1: '建党节' },
  8: { 1: '建军节' },
  9: { 10: '教师节' },
  10: { 1: '国庆节' },
  12: { 24: '平安夜', 25: '圣诞节' },
};

// 联网法定节假日/调休缓存（timor.tech；key: "YYYY-MM-dd"，value: {name, type}）
const holidayCache = { map: new Map(), loadedYears: new Set() };

/** 加载指定年份的法定节假日/调休数据（8s 超时；失败静默回退本地节日/节气） */
async function loadHolidays(year, onChange) {
  if (holidayCache.loadedYears.has(year)) return;
  holidayCache.loadedYears.add(year);
  try {
    const res = await fetch(`https://timor.tech/api/holiday/year/${year}`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (!json || !json.holiday) throw new Error('bad payload');
    for (const [key, info] of Object.entries(json.holiday)) {
      holidayCache.map.set(
        `${year}-${key}`,
        { name: info.holiday ? info.name : '班', type: info.holiday ? 'holiday' : 'work' },
      );
    }
    if (onChange) onChange();
  } catch { /* 联网失败，回退本地节日/节气 */ }
}

/** 指定日期的节日/节气信息：联网节假日 → 农历节日（含除夕）→ 公历节日 → 节气 */
function festivalInfo(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  // 1. 联网节假日/调休（最权威，含调休安排）
  const hk = holidayCache.map.get(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  if (hk) return hk;

  // 2. 本地农历节日
  const lunar = lunarMonthDay(date);
  if (lunar) {
    // 除夕：腊月最后一天（次日为正月初一）
    if (lunar.m === 12) {
      const next = lunarMonthDay(new Date(y, m - 1, d + 1));
      if (next && next.m === 1 && next.d === 1) return { name: '除夕', type: 'lunar' };
    }
    const name = LUNAR_FESTIVALS[lunar.m]?.[lunar.d];
    if (name) return { name, type: 'lunar' };
  }

  // 3. 本地公历节日
  const solarName = SOLAR_FESTIVALS[m]?.[d];
  if (solarName) return { name: solarName, type: 'solar' };

  // 4. 节气
  const term = solarTermName(y, m, d);
  if (term) return { name: term, type: 'term' };

  return null;
}

export function TopBarView({ user, onLogoClick, onSearch, onLogout, onEditProfile }) {
  let userRef = user || {};
  let selectedEngine = ENGINES[0];
  let activeDropdown = null; // 'engine' | 'weather' | 'avatar' | 'bell' | 'calendar' | null

  const root = el('div', { class: 'main-topbar topbar' });

  // ---------- 下拉管理（position:absolute 挂在顶栏节点内，点击外部关闭） ----------
  let dropdownNode = null;

  function closeDropdowns() {
    if (dropdownNode) { dropdownNode.remove(); dropdownNode = null; }
    activeDropdown = null;
  }

  function showDropdown(anchor, node, placement) {
    closeDropdowns();
    dropdownNode = node;
    root.append(node);
    const r = root.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const w = node.offsetWidth;
    let left;
    if (placement === 'right') left = a.right - r.left - w + 10; // MainLayoutView: x = maxX - 90（宽 200）
    else if (placement === 'center') left = a.left - r.left + a.width / 2 - w / 2;
    else left = a.left - r.left;
    node.style.top = `${Math.round(a.bottom - r.top + 8)}px`;
    node.style.left = `${Math.round(Math.max(8, left))}px`;
  }

  const onDocMouseDown = (e) => {
    if (!root.isConnected) { document.removeEventListener('mousedown', onDocMouseDown); return; }
    if (!root.contains(e.target)) closeDropdowns();
  };
  document.addEventListener('mousedown', onDocMouseDown);

  // ---------- Logo（点击返回首页） ----------
  const logoBtn = el('button', { class: 'topbar-logo', onclick: () => { if (onLogoClick) onLogoClick(); } },
    el('div', { class: 'topbar-logo-badge', innerHTML: LOGO_MARK }),
    el('div', { class: 'topbar-logo-name', innerHTML: 'M<span class="topbar-logo-sub">Table</span>' }),
  );

  // ---------- 搜索框 ----------
  function engineFaviconNode(engine, size) {
    // EngineFaviconView.swift：加载真实 favicon，失败回退渐变色块 + 首字
    const img = el('img', {
      src: engine.favicon, alt: engine.displayName, draggable: 'false',
      style: { width: `${size}px`, height: `${size}px`, objectFit: 'contain' },
    });
    img.addEventListener('error', () => {
      const fb = el('div', { class: 'topbar-engine-fallback', style: { width: `${size}px`, height: `${size}px`, background: engine.fallbackBg, fontSize: `${Math.round(size * 0.55)}px` } }, engine.fallback);
      img.replaceWith(fb);
    });
    return img;
  }

  const engineBtn = el('button', { class: 'topbar-engine-btn', title: '切换搜索引擎' });
  function renderEngineBtn() { clear(engineBtn).append(engineFaviconNode(selectedEngine, 22)); }
  renderEngineBtn();

  engineBtn.addEventListener('click', () => {
    if (activeDropdown === 'engine') return closeDropdowns();
    activeDropdown = 'engine';
    const dd = el('div', { class: 'topbar-dd engine' });
    for (const eng of ENGINES) {
      dd.append(el('button', {
        class: 'topbar-dd-item',
        onclick: () => { selectedEngine = eng; renderEngineBtn(); closeDropdowns(); },
      },
        engineFaviconNode(eng, 18),
        el('span', {}, eng.displayName),
        eng.key === selectedEngine.key ? el('span', { class: 'icon topbar-dd-check', innerHTML: icon('checkmark') }) : null,
      ));
    }
    showDropdown(engineBtn, dd, 'center');
  });

  const searchInput = el('input', { class: 'topbar-search-input', type: 'text', placeholder: '搜你所想' });
  const clearBtn = el('button', { class: 'topbar-search-clear', style: { display: 'none' }, title: '清空' },
    el('span', { class: 'icon', innerHTML: icon('xmark.circle.fill') }));
  clearBtn.addEventListener('click', () => { searchInput.value = ''; refreshClear(); searchInput.focus(); });
  function refreshClear() { clearBtn.style.display = searchInput.value ? 'flex' : 'none'; }
  searchInput.addEventListener('input', refreshClear);

  function performSearch() {
    const q = searchInput.value;
    if (!q) return;
    const url = selectedEngine.template.replace('%@', encodeURIComponent(q));
    if (onSearch) onSearch(url);
    closeDropdowns();
  }
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') performSearch(); });

  const goBtn = el('button', { class: 'topbar-search-go', title: '搜索', onclick: performSearch },
    el('span', { class: 'icon', innerHTML: icon('magnifyingglass') }));

  const searchBox = el('div', { class: 'topbar-search' },
    engineBtn,
    el('div', { class: 'topbar-search-divider' }),
    searchInput,
    clearBtn,
    goBtn,
  );

  // ---------- 天气（复用 views/weather.js：多源定位 + Open-Meteo 主源 + 缓存兜底 + 手动指定城市） ----------
  const weatherBox = WeatherView();

  // ---------- 时钟（ClockView.swift：日历块 + 日期/星期/农历 + 秒级时间，点击弹日历） ----------
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const ZODIACS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  const LUNAR_DAYS = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
  ];
  const fmtLunarMonth = (() => {
    try { return new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long' }); } catch { return null; }
  })();
  const fmtLunarDayNum = (() => {
    try { return new Intl.DateTimeFormat('en-u-ca-chinese', { day: 'numeric' }); } catch { return null; }
  })();

  function lunarInfo(date) {
    if (!fmtLunarMonth || !fmtLunarDayNum) return '';
    try {
      const monthName = fmtLunarMonth.format(date).replace(/日$/, '').replace('UTC', '');
      const dayNum = parseInt(fmtLunarDayNum.format(date).replace(/\D/g, ''), 10);
      if (!monthName || !dayNum || dayNum < 1 || dayNum > 30) return '';
      return `${monthName}${LUNAR_DAYS[dayNum - 1]}`;
    } catch { return ''; }
  }

  const calBadgeMonth = el('div', { class: 'topbar-cal-badge-month' });
  const calBadgeDay = el('div', { class: 'topbar-cal-badge-day' });
  const clockDateLine = el('div', { class: 'topbar-clock-date' });
  const clockLunarLine = el('div', { class: 'topbar-clock-lunar' });
  const clockTime = el('div', { class: 'topbar-clock-time' });

  let calendarOpen = false;
  let calendarCursor = new Date(); // 日历弹窗当前展示月份
  const calGrid = el('div', { class: 'topbar-cal-grid' });
  const calTitle = el('div', { class: 'topbar-cal-title' });
  const calDetail = el('div', { class: 'topbar-cal-detail' });

  function renderClock() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const t = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');

    calBadgeMonth.textContent = `${Number(m)}`;
    calBadgeDay.textContent = `${Number(d)}`;

    // 干支年 + 生肖（与 ClockView.swift 公式一致）
    const stem = STEMS[(y - 4) % 10];
    const branch = BRANCHES[(y - 4) % 12];
    const lunar = lunarInfo(now);
    clockDateLine.replaceChildren(
      el('span', { class: 'topbar-clock-date-full' }, `${y}-${m}-${d}日`),
      el('span', { class: 'topbar-clock-weekday' }, `星期${WEEKDAYS[now.getDay()]}`),
    );
    clockLunarLine.textContent = `${ZODIACS[(y - 4) % 12]}${stem}${branch}年${lunar ? ' ' + lunar : ''}`;
    clockTime.textContent = t;

    if (calendarOpen) renderCalendarGrid();
  }

  /** 选中日期详情：公历日期 + 星期 + 农历 + 节日/节气 */
  function updateCalDetail(date) {
    const lunar = lunarInfo(date);
    let text = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${WEEKDAYS[date.getDay()]}`;
    if (lunar) text += ` · ${lunar}`;
    const festival = festivalInfo(date);
    if (festival) text += ` · ${festival.name}`;
    calDetail.textContent = text;
  }

  function renderCalendarGrid() {
    const cur = calendarCursor;
    const y = cur.getFullYear(), mo = cur.getMonth();
    calTitle.textContent = `${y}年${mo + 1}月`;
    clear(calGrid);
    for (const w of WEEKDAYS) calGrid.append(el('div', { class: 'topbar-cal-wd' }, w));
    const first = new Date(y, mo, 1);
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    for (let i = 0; i < first.getDay(); i++) calGrid.append(el('div', {}));
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
      const isToday = day === today.getDate() && mo === today.getMonth() && y === today.getFullYear();
      const festival = festivalInfo(new Date(y, mo, day));
      const cell = el('div', {
        class: `topbar-cal-day${isToday ? ' today' : ''}`,
        onclick: () => updateCalDetail(new Date(y, mo, day)),
      },
        el('div', { class: 'topbar-cal-daynum' }, String(day)),
        el('div', {
          class: `topbar-cal-festival${festival ? ` ${festival.type}` : ''}`,
          title: festival ? festival.name : '',
        }, festival ? festival.name : ' '));
      calGrid.append(cell);
    }
    // 翻月/打开时按需加载该年法定节假日/调休，数据到位后重绘
    loadHolidays(y, () => { if (calendarOpen && root.isConnected) renderCalendarGrid(); });
  }

  const clockBtn = el('button', { class: 'topbar-clock', title: '日历' },
    el('div', { class: 'topbar-cal-badge' }, calBadgeMonth, calBadgeDay),
    el('div', { class: 'topbar-clock-mid' }, clockDateLine, clockLunarLine),
    el('div', { class: 'topbar-clock-sep' }),
    clockTime,
  );
  clockBtn.addEventListener('click', () => {
    if (calendarOpen) { closeDropdowns(); return; }
    calendarCursor = new Date();
    updateCalDetail(new Date());
    renderCalendarGrid();
    activeDropdown = 'calendar';
    showDropdown(clockBtn, el('div', { class: 'topbar-dd calendar' },
      el('div', { class: 'topbar-cal-header' },
        el('button', { class: 'topbar-cal-nav', onclick: () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); renderCalendarGrid(); } },
          el('span', { class: 'icon', innerHTML: icon('chevron.left') })),
        calTitle,
        el('button', { class: 'topbar-cal-nav', onclick: () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); renderCalendarGrid(); } },
          el('span', { class: 'icon', innerHTML: icon('chevron.right') }))),
      calGrid,
      el('div', { class: 'topbar-cal-footer' },
        calDetail,
        el('button', { class: 'link-btn', onclick: () => { calendarCursor = new Date(); renderCalendarGrid(); updateCalDetail(new Date()); } }, '回今天')),
    ), 'center');
    calendarOpen = true; // showDropdown 内部会先关闭旧弹层，需在其之后置位
  });
  renderClock();
  updateCalDetail(new Date()); // 日历详情默认展示今天
  const clockTimer = setInterval(() => {
    if (!root.isConnected) { clearInterval(clockTimer); return; }
    renderClock();
  }, 1000);

  // 关闭弹层时同步日历开合状态
  const _closeDropdowns = closeDropdowns;
  closeDropdowns = () => { calendarOpen = false; _closeDropdowns(); };

  // ---------- 宠物伙伴：选择/切换入口 + 随机治愈系动作（详见 views/pet.js） ----------
  const petBox = PetView();

  // ---------- 右侧：问题反馈 + 通知 + 头像 ----------
  // 问题反馈入口：打开反馈弹窗（表单 + 历史记录）
  const feedbackBtn = el('button', { class: 'topbar-bell', title: '问题反馈' },
    el('span', { class: 'icon', innerHTML: icon('bubble.left') }));
  feedbackBtn.addEventListener('click', () => {
    closeDropdowns();
    FeedbackModal({ user: userRef });
  });

  // 通知铃铛：真实未读数角标 + 通知面板下拉（列表/已读管理/管理员发送入口）
  let unreadCount = 0;
  const bellBtn = el('button', { class: 'topbar-bell', title: '通知' },
    el('span', { class: 'icon', innerHTML: icon('bell') }));

  function renderBellBadge() {
    bellBtn.querySelector('.topbar-badge')?.remove();
    if (unreadCount > 0) {
      bellBtn.append(el('span', { class: 'topbar-badge' }, unreadCount > 99 ? '99+' : String(unreadCount)));
    }
  }

  function onUnreadChange(count) {
    unreadCount = count;
    renderBellBadge();
  }

  async function refreshUnread() {
    try {
      const res = await api.getUnreadCount();
      onUnreadChange(Number(res?.count) || 0);
    } catch { /* 后端不可达时保持现有角标 */ }
  }

  bellBtn.addEventListener('click', () => {
    if (activeDropdown === 'bell') return closeDropdowns();
    activeDropdown = 'bell';
    showDropdown(bellBtn, NotificationPanel({ user: userRef, onUnreadChange }), 'right');
  });

  renderBellBadge();
  refreshUnread();
  // 未读数轮询（30s），实现小红点/数字提醒
  const unreadTimer = setInterval(() => {
    if (!root.isConnected) { clearInterval(unreadTimer); return; }
    refreshUnread();
  }, 30000);

  // ---------- 新版本提示：启动时检查更新，发现新版本显示顶栏下载入口 ----------
  let latestInfo = null;
  let isDownloadingUpdate = false;
  const updatePill = el('button', {
    class: 'update-pill', style: { display: 'none' }, title: '点击下载最新版本安装包',
    onclick: downloadUpdateNow,
  });

  function paintUpdatePill(text, cls = '') {
    updatePill.className = `update-pill ${cls}`.trim();
    clear(updatePill).append(el('span', { class: 'icon', innerHTML: icon('arrowdown') }), text);
  }

  async function downloadUpdateNow() {
    if (isDownloadingUpdate || !latestInfo) return;
    const target = installerForPlatform(latestInfo);
    if (!target) { toast('当前平台暂无可用安装包', 'error'); return; }
    isDownloadingUpdate = true;
    paintUpdatePill('下载中 0%', 'downloading');
    try {
      await downloadInstaller(target.url, (p) => {
        if (!p.done) paintUpdatePill(`下载中 ${Math.round((p.percent || 0) * 100)}%`, 'downloading');
      }, target.size);
      paintUpdatePill('已下载 · 已打开文件夹', 'done');
      setTimeout(() => { updatePill.style.display = 'none'; }, 4000);
    } catch {
      paintUpdatePill(`新版本 v${latestInfo.version}`);
      toast('下载失败，请点击重试', 'error');
    }
    isDownloadingUpdate = false;
  }

  checkUpdate().then(({ hasUpdate, latest }) => {
    if (!hasUpdate) return;
    latestInfo = latest;
    paintUpdatePill(`新版本 v${latest.version}`);
    updatePill.style.display = 'inline-flex';
  }).catch(() => { /* 后端不可达或已是最新版时静默 */ });

  const avatarWrap = el('div', { class: 'topbar-avatar-wrap' });
  function renderAvatar() {
    clear(avatarWrap).append(avatarNode(userRef, 36));
    if (userRef.role === 'ADMIN') {
      avatarWrap.append(el('span', { class: 'admin-avatar-badge', title: '管理员身份登录' }, '★'));
    }
  }
  renderAvatar();

  // ---------- 主题切换器（左=太阳·浅色，右=月亮·暗黑；切换即时全局生效并持久化） ----------
  function buildThemeToggle() {
    const current = store.getTheme();
    const opt = (theme, iconName, label) => el('button', {
      class: `topbar-theme-opt${current === theme ? ' active' : ''}`,
      title: label,
      'aria-label': label,
      onclick: (e) => {
        if (store.getTheme() === theme) return;
        store.setTheme(theme); // 无刷新全局切换 + 平滑过渡，弹窗关闭后保持
        const toggle = e.currentTarget.parentElement;
        toggle.querySelectorAll('.topbar-theme-opt').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      },
    },
      el('span', { class: 'icon', innerHTML: icon(iconName) }),
      el('span', { class: 'topbar-theme-opt-label' }, label));
    return el('div', { class: 'topbar-theme-row' },
      el('div', { class: 'topbar-theme-toggle', role: 'group', 'aria-label': '主题切换' },
        opt('light', 'sun.max', '浅色主题'),
        opt('dark', 'moon', '暗黑主题'),
      ),
    );
  }

  // ---------- 壁纸开关（与设置页壁纸开关同源：本地立即生效 + 防抖保存服务端） ----------
  function buildWallpaperRow() {
    const state = {
      enabled: false, pinnedImageId: null, brightness: 100, blur: 0, url: null,
      ...(getWallpaperState() || {}),
    };
    const sw = el('button', {
      class: `wp-switch${state.enabled ? ' on' : ''}`,
      title: '开启/关闭壁纸',
      'aria-label': '开启/关闭壁纸',
      onclick: () => {
        state.enabled = !state.enabled;
        sw.classList.toggle('on', state.enabled);
        applyWallpaper({ ...state }); // 立即生效（无可用壁纸时自动回退默认外观）
        scheduleWallpaperSave({ enabled: state.enabled });
      },
    });
    return el('div', { class: 'topbar-dd-row wallpaper-row' },
      el('span', { class: 'icon', innerHTML: icon('photo.fill') }),
      '壁纸',
      sw,
    );
  }

  function buildAvatarDropdown() {
    const dd = el('div', { class: 'topbar-dd avatar' });
    dd.append(
      el('div', { class: 'topbar-userinfo' },
        avatarNode(userRef, 44),
        el('div', { class: 'topbar-userinfo-text' },
          el('div', { class: 'topbar-userinfo-name' }, userRef.nickname || ''),
          el('div', { class: 'topbar-userinfo-phone' }, userRef.phone || ''),
          userRef.role === 'ADMIN'
            ? el('div', { class: 'topbar-userinfo-badge' }, adminBadge('管理员身份登录'))
            : null)),
    );
    if (userRef.motto) {
      dd.append(
        el('div', { class: 'topbar-dd-divider' }),
        el('div', { class: 'topbar-motto' },
          el('span', { class: 'icon', innerHTML: icon('sparkles') }),
          el('span', { class: 'topbar-motto-text', title: userRef.motto }, userRef.motto)),
      );
    }
    dd.append(
      el('div', { class: 'topbar-dd-divider' }),
      el('button', { class: 'topbar-dd-row', onclick: () => { closeDropdowns(); if (onEditProfile) onEditProfile(); } },
        el('span', { class: 'icon', innerHTML: icon('person.crop.circle') }), '个人信息',
        el('span', { class: 'topbar-dd-arrow', innerHTML: icon('chevron.right') })),
      el('div', { class: 'topbar-dd-divider' }),
      buildThemeToggle(),
      buildWallpaperRow(),
      el('div', { class: 'topbar-dd-divider' }),
      el('button', { class: 'topbar-dd-row danger', onclick: () => { closeDropdowns(); if (onLogout) onLogout(); } },
        el('span', { class: 'icon', innerHTML: icon('arrow.right.square') }), '退出登录'),
    );
    return dd;
  }

  const avatarBtn = el('button', { class: 'topbar-avatar-btn', title: '账号' }, avatarWrap);
  avatarBtn.addEventListener('click', () => {
    if (activeDropdown === 'avatar') return closeDropdowns();
    activeDropdown = 'avatar';
    showDropdown(avatarBtn, buildAvatarDropdown(), 'right');
  });

  // ---------- 组装（ZStack：左右两端 + 居中搜索/时钟/天气） ----------
  const card = el('div', { class: 'topbar-card' },
    logoBtn,
    el('div', { class: 'topbar-center' }, searchBox, clockBtn, weatherBox),
    el('div', { class: 'topbar-right' }, petBox, feedbackBtn, bellBtn, updatePill, avatarBtn),
  );
  root.append(card);

  /** 登录资料变更后刷新头像/昵称 */
  root.updateUser = (u) => {
    if (u) userRef = u;
    renderAvatar();
    closeDropdowns(); // 下拉每次打开时重建，展示最新资料
  };

  return root;
}
