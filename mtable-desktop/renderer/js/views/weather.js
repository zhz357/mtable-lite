//
// views/weather.js — 天气组件（移植自 WeatherView.swift）
// 显示地点、当前温度、天气情况、最低/最高温度
// 稳定性策略：
//   定位：ipinfo.io / GeoJS / ipapi.co 多源依次回退 + 30 分钟缓存（内存 + localStorage）
//   城市：坐标反查中文名（bigdatacloud），失败回退 IP 城市名
//   天气：Open-Meteo（免费无 Key、稳定）主源，wttr.in 备源
//   城市：点击天气可按 省/市 级联选择手动指定城市（IP 定位漂移时的兜底），勾选自动定位即恢复
//   展示：启动先展示上次成功的缓存数据，后台静默刷新；失败保留缓存；10 分钟刷新一次
//
import { el } from '../ui.js';
import { icon } from '../icons.js';
import { CHINA_REGIONS, findRegionCity } from '../data/chinaRegions.js';

const REFRESH_INTERVAL = 10 * 60 * 1000;  // 天气 10 分钟刷新（天气变化缓慢，避免频繁请求被限流）
const LOCATION_TTL = 30 * 60 * 1000;      // IP 定位缓存 30 分钟
const FAIL_RETRY_DELAY = 30 * 1000;       // 完全失败后 30 秒自动重试一次
const LOCATION_CACHE_KEY = 'mtable.weather.location';
const WEATHER_CACHE_KEY = 'mtable.weather.cache';
const CITY_OVERRIDE_KEY = 'mtable.weather.city'; // 手动指定城市（修正 IP 定位漂移）

async function fetchJSON(url, timeout) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// MARK: - IP 定位（多源依次回退，任一成功即返回 { city, lat, lon }）
const locationProviders = [
  // ipinfo.io：{ city, loc: "lat,lon" }
  async () => {
    const r = await fetchJSON('https://ipinfo.io/json', 6000);
    const parts = String(r.loc || '').split(',');
    const lat = Number.parseFloat(parts[0]);
    const lon = Number.parseFloat(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { city: r.city || '', lat, lon };
    return null;
  },
  // GeoJS：{ city, latitude, longitude }
  async () => {
    const r = await fetchJSON('https://get.geojs.io/v1/ip/geo.json', 6000);
    const lat = Number.parseFloat(r.latitude);
    const lon = Number.parseFloat(r.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { city: r.city || '', lat, lon };
    return null;
  },
  // ipapi.co：{ city, latitude, longitude }
  async () => {
    const r = await fetchJSON('https://ipapi.co/json/', 6000);
    const lat = Number.parseFloat(r.latitude);
    const lon = Number.parseFloat(r.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { city: r.city || '', lat, lon };
    return null;
  },
];

let locationCache = null; // 进程内复用，避免每次刷新都请求定位

async function fetchLocation() {
  if (locationCache && Date.now() - locationCache.ts < LOCATION_TTL) return locationCache;
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATION_CACHE_KEY) || 'null');
    if (saved?.lat != null && Date.now() - saved.ts < LOCATION_TTL) {
      locationCache = saved;
      return saved;
    }
  } catch { /* 忽略坏缓存 */ }

  for (const provider of locationProviders) {
    try {
      const loc = await provider();
      if (loc) {
        locationCache = { ...loc, ts: Date.now() };
        try { localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(locationCache)); } catch { /* 忽略 */ }
        return locationCache;
      }
    } catch { /* 当前源失败，尝试下一个 */ }
  }
  return null;
}

// MARK: - 坐标反查中文城市名（修正"显示错误地区"：以坐标为准解析行政区，失败回退 IP 城市名）
async function fetchCityName(lat, lon, fallback) {
  try {
    const r = await fetchJSON(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`,
      5000);
    // locality 为县区级（更贴近实际位置），优先于 city
    const city = r.locality || r.city || r.principalSubdivision;
    if (city) return String(city).replace(/(市|地区|盟)$/, '');
  } catch { /* 反查失败，回退 */ }
  return fallback || '我的位置';
}

// MARK: - 手动指定城市（内置省/市坐标表，见 data/chinaRegions.js）
function getCityOverride() {
  try {
    return String(localStorage.getItem(CITY_OVERRIDE_KEY) || '').trim() || null;
  } catch {
    return null;
  }
}

// MARK: - WWO 天气代码 → 图标 / 描述 / 颜色（wttr.in 备源使用）
function weatherInfo(code) {
  switch (code) {
    case 113: return { iconName: 'sun.max.fill', description: '晴', color: '#f2a633' };
    case 116: return { iconName: 'cloud.sun', description: '多云', color: '#8ca6c7' };
    case 119:
    case 122: return { iconName: 'cloud.fill', description: '阴', color: '#8c94ad' };
    case 143:
    case 248:
    case 260: return { iconName: 'cloud.fog', description: '雾', color: '#99a1b3' };
    case 176:
    case 263:
    case 266:
    case 281:
    case 284:
    case 293:
    case 296: return { iconName: 'cloud.drizzle', description: '小雨', color: '#6699d9' };
    case 299:
    case 302:
    case 305:
    case 308: return { iconName: 'cloud.rain', description: '中到大雨', color: '#598cd9' };
    case 179:
    case 182:
    case 185:
    case 227:
    case 230:
    case 323:
    case 326:
    case 329:
    case 332:
    case 335:
    case 338: return { iconName: 'cloud.snow', description: '雪', color: '#80b3e6' };
    case 200:
    case 353:
    case 356:
    case 359:
    case 362:
    case 365:
    case 368:
    case 371:
    case 374:
    case 377:
    case 380: return { iconName: 'cloud.bolt.rain', description: '雷阵雨', color: '#8c73d9' };
    case 311:
    case 314:
    case 317:
    case 320:
    case 350: return { iconName: 'cloud.sleet', description: '雨夹雪', color: '#7399d9' };
    default: return { iconName: 'cloud', description: '未知', color: '#8c94ad' };
  }
}

// MARK: - WMO 天气代码 → 图标 / 描述 / 颜色（Open-Meteo 主源使用）
function wmoInfo(code) {
  if (code === 0) return { iconName: 'sun.max.fill', description: '晴', color: '#f2a633' };
  if (code === 1 || code === 2) return { iconName: 'cloud.sun', description: '多云', color: '#8ca6c7' };
  if (code === 3) return { iconName: 'cloud.fill', description: '阴', color: '#8c94ad' };
  if (code === 45 || code === 48) return { iconName: 'cloud.fog', description: '雾', color: '#99a1b3' };
  if ((code >= 51 && code <= 57) || code === 61 || code === 80) return { iconName: 'cloud.drizzle', description: '小雨', color: '#6699d9' };
  if (code === 63 || code === 65 || code === 81 || code === 82) return { iconName: 'cloud.rain', description: '中到大雨', color: '#598cd9' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { iconName: 'cloud.snow', description: '雪', color: '#80b3e6' };
  if ((code >= 56 && code <= 57) || code === 66 || code === 67) return { iconName: 'cloud.sleet', description: '雨夹雪', color: '#7399d9' };
  if (code >= 95) return { iconName: 'cloud.bolt.rain', description: '雷阵雨', color: '#8c73d9' };
  return { iconName: 'cloud', description: '未知', color: '#8c94ad' };
}

// MARK: - 天气主源：Open-Meteo（免费无 Key，国内外可达性均较好）
async function fetchWeatherOpenMeteo(lat, lon, city) {
  const r = await fetchJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`,
    8000);
  const current = r.current;
  const daily = r.daily;
  const currentTemp = Number.parseFloat(current?.temperature_2m);
  if (!current || !Number.isFinite(currentTemp)) return null;
  let minTemp = Number.parseFloat(daily?.temperature_2m_min?.[0]);
  let maxTemp = Number.parseFloat(daily?.temperature_2m_max?.[0]);
  if (!Number.isFinite(minTemp)) minTemp = currentTemp;
  if (!Number.isFinite(maxTemp)) maxTemp = currentTemp;
  return {
    city,
    currentTemp,
    weatherCode: Number.parseInt(current.weather_code, 10) || 0,
    minTemp,
    maxTemp,
    wmo: true, // WMO 代码体系
  };
}

// MARK: - 天气备源：wttr.in（原实现保留作为兜底）
async function fetchWeatherWttr(lat, lon, city) {
  const r = await fetchJSON(`https://wttr.in/${lat},${lon}?format=j1`, 10000);
  const current = r.current_condition?.[0];
  const today = r.weather?.[0];
  if (!current || !today) return null;

  const currentTemp = Number.parseFloat(current.temp_C) || 0;
  let minTemp = Number.parseFloat(today.mintempC) || 0;
  let maxTemp = Number.parseFloat(today.maxtempC) || 0;

  // 修正：确保 minTemp <= currentTemp <= maxTemp
  if (currentTemp < minTemp) minTemp = currentTemp;
  if (currentTemp > maxTemp) maxTemp = currentTemp;

  return {
    city,
    currentTemp,
    weatherCode: Number.parseInt(current.weatherCode, 10) || 0,
    minTemp,
    maxTemp,
    wmo: false, // WWO 代码体系
  };
}

async function fetchWeather(lat, lon, city) {
  try {
    const data = await fetchWeatherOpenMeteo(lat, lon, city);
    if (data) return data;
  } catch { /* 主源失败，走备源 */ }
  try {
    return await fetchWeatherWttr(lat, lon, city);
  } catch {
    return null;
  }
}

function readWeatherCache() {
  try {
    return JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeWeatherCache(data) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ ...data, ts: Date.now() }));
  } catch { /* 忽略 */ }
}

export function WeatherView() {
  let weather = readWeatherCache(); // 启动先用上次成功的缓存兜底，避免"经常不可用"
  let fromCache = !!weather;        // 当前展示是否来自缓存（后台刷新成功后自动转为实时）
  let isLoading = false;
  let timer = null;
  let retryTimer = null;

  const chip = el('span', { class: 'weather-chip' });

  // MARK: - 渲染（天气 / 加载中 / 占位，三选一）
  function render() {
    while (chip.firstChild) chip.removeChild(chip.firstChild);
    if (weather) {
      const info = weather.wmo ? wmoInfo(weather.weatherCode) : weatherInfo(weather.weatherCode);
      chip.className = 'weather-chip weather-chip-data weather-chip-tappable';
      chip.title = `${weather.city}${fromCache ? ' · 缓存数据' : ''} · 点击设置城市`;
      chip.onclick = () => openCityDialog();
      chip.append(
        // 左侧：天气图标
        el('span', { class: 'weather-icon-wrap' },
          el('span', { class: 'icon', style: { color: info.color }, innerHTML: icon(info.iconName) })),
        // 中间：城市 + 天气描述
        el('span', { class: 'weather-info' },
          el('span', { class: 'weather-city' }, weather.city),
          el('span', { class: 'weather-desc' }, info.description)),
        // 分隔线
        el('span', { class: 'weather-divider' }),
        // 右侧：当前温度 + 最低/最高温度
        el('span', { class: 'weather-temps' },
          el('span', { class: 'weather-temp-now' }, `${Math.trunc(weather.currentTemp)}°`),
          el('span', { class: 'weather-temp-range' },
            el('span', { class: 'weather-temp-min' }, `${Math.trunc(weather.minTemp)}°`),
            el('span', { class: 'weather-temp-sep' }, '/'),
            el('span', { class: 'weather-temp-max' }, `${Math.trunc(weather.maxTemp)}°`))),
      );
    } else if (isLoading) {
      chip.className = 'weather-chip weather-chip-mini';
      chip.title = '';
      chip.onclick = null;
      chip.append(
        el('span', { class: 'spinner dark', style: { width: '14px', height: '14px' } }),
        el('span', { class: 'weather-status' }, '加载天气...'),
      );
    } else {
      chip.className = 'weather-chip weather-chip-mini weather-chip-tappable';
      chip.title = '点击重试';
      chip.append(
        el('span', { class: 'icon weather-status-icon', innerHTML: icon('cloud.sun') }),
        el('span', { class: 'weather-status' }, '天气不可用'),
      );
      // 点击重试（对应 Swift onTapGesture）
      chip.onclick = () => loadWeather();
    }
  }

  async function loadWeather() {
    if (isLoading) return;
    isLoading = true;
    if (!weather) render(); // 已有展示（缓存/实时）时静默刷新，避免闪烁

    try {
      let data = null;
      const override = getCityOverride();
      const hit = override ? findRegionCity(override) : null;
      if (hit) {
        // 手动指定城市优先（内置坐标表，零请求无歧义）；数据行格式 [名称, 纬度, 经度]
        data = await fetchWeather(hit[1], hit[2], hit[0]);
      } else {
        const loc = await fetchLocation();
        if (loc) {
          const city = await fetchCityName(loc.lat, loc.lon, loc.city);
          data = await fetchWeather(loc.lat, loc.lon, city);
        }
      }
      if (data) {
        weather = data;
        fromCache = false;
        writeWeatherCache(data);
      }
    } catch { /* 失败保留当前展示 */ }
    isLoading = false;
    if (chip.isConnected) render();

    // 全程失败（仍无有效数据）时安排一次快速重试
    if (!weather && chip.isConnected) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (chip.isConnected) loadWeather(); }, FAIL_RETRY_DELAY);
    }
  }

  // MARK: - 设置城市弹窗（复用全局弹窗样式；省/市级联选择，勾选自动定位 = 恢复 IP 定位）
  function openCityDialog() {
    // 已有手动城市且在数据表内 → 预选；否则默认自动定位
    const current = getCityOverride();
    let defProvince = '';
    let defCity = '';
    if (current) {
      for (const region of CHINA_REGIONS) {
        if (region.cities.some((c) => c[0] === current)) {
          defProvince = region.province;
          defCity = current;
          break;
        }
      }
    }

    const autoCheck = el('input', {
      class: 'dlg-auto-check', type: 'checkbox',
      style: { accentColor: 'var(--primary)', margin: '0' },
    });
    const autoRow = el('label', { class: 'dlg-check-row' },
      autoCheck,
      el('span', {}, '按 IP 自动定位（取消勾选后可手动选择省/市）'));

    const provinceSelect = el('select', { class: 'field-input dlg-input' },
      el('option', { value: '' }, '选择省份'),
      CHINA_REGIONS.map((r) => el('option', { value: r.province }, r.province)));
    const citySelect = el('select', { class: 'field-input dlg-input' });
    const selectRow = el('div', { class: 'dlg-input-row' }, provinceSelect, citySelect);

    // 级联：切换省份 → 重建城市列表并默认选第一个（省会/首府排在首位；直辖市仅一项）
    function fillCities(province) {
      while (citySelect.firstChild) citySelect.removeChild(citySelect.firstChild);
      const region = CHINA_REGIONS.find((r) => r.province === province);
      citySelect.append(el('option', { value: '' }, province ? '选择城市' : '请先选择省份'));
      if (region) citySelect.append(...region.cities.map((c) => el('option', { value: c[0] }, c[0])));
      citySelect.value = region?.cities[0]?.[0] || '';
    }
    function syncSelectState() {
      const manual = !autoCheck.checked;
      provinceSelect.disabled = !manual;
      citySelect.disabled = !manual;
    }

    provinceSelect.addEventListener('change', () => fillCities(provinceSelect.value));
    autoCheck.addEventListener('change', () => {
      syncSelectState();
      setError(null);
    });

    if (defProvince) {
      provinceSelect.value = defProvince;
      fillCities(defProvince);
      citySelect.value = defCity;
    } else {
      fillCities('');
      autoCheck.checked = true;
    }
    syncSelectState();

    const errorText = el('div', { class: 'dlg-error', style: { display: 'none' } });
    const cancelBtn = el('button', { class: 'dlg-btn-cancel', type: 'button' }, '取消');
    const okBtn = el('button', { class: 'dlg-btn-ok', type: 'button' }, '确定');
    const mask = el('div', {
      class: 'modal-mask',
      onclick: (e) => { if (e.target === mask) close(); },
    },
      el('div', { class: 'dlg-modal' },
        el('div', { class: 'dlg-title' }, '设置天气城市'),
        el('div', { class: 'dlg-body' },
          autoRow,
          el('div', { class: 'dlg-field' },
            el('label', { class: 'dlg-label' }, '所在地区（天气默认按 IP 自动定位，地区不准时可手动指定）'),
            selectRow)),
        errorText,
        el('div', { class: 'dlg-actions' }, cancelBtn, okBtn)));

    function close() { mask.remove(); }
    function setError(msg) {
      if (msg) { errorText.textContent = msg; errorText.style.display = ''; }
      else errorText.style.display = 'none';
    }
    cancelBtn.addEventListener('click', close);

    okBtn.addEventListener('click', () => {
      setError(null);
      if (autoCheck.checked) {
        // 恢复自动定位
        try { localStorage.removeItem(CITY_OVERRIDE_KEY); } catch { /* 忽略 */ }
        close();
        loadWeather();
        return;
      }
      const province = provinceSelect.value;
      const city = citySelect.value;
      if (!province || !city) {
        setError('请先选择省份和城市');
        return;
      }
      try { localStorage.setItem(CITY_OVERRIDE_KEY, city); } catch { /* 忽略 */ }
      close();
      loadWeather();
    });

    document.getElementById('modal-root').append(mask);
    if (autoCheck.checked) autoCheck.focus();
    else provinceSelect.focus();
  }

  // MARK: - 自动刷新（对应 startAutoRefresh / stopAutoRefresh）
  function startAutoRefresh() {
    loadWeather(); // 先加载一次（有缓存时后台静默刷新）
    timer = setInterval(() => {
      if (!chip.isConnected) { stopAutoRefresh(); return; }
      loadWeather();
    }, REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  startAutoRefresh();
  return chip;
}
