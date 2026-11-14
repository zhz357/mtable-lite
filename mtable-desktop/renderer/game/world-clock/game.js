(function () {
  var L = window.WorldClockLogic;
  var STORE_KEY = 'com.mtable.worldclock';
  var DEFAULT_IDS = ['北京', '东京', '新加坡', '伦敦', '巴黎', '莫斯科', '纽约', '洛杉矶', '悉尼', '迪拜'];

  function load() {
    var s = { cities: DEFAULT_IDS.slice(), hour12: false, theme: 'auto', accent: 'indigo' };
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && Array.isArray(raw.cities)) {
        s.cities = raw.cities.filter(function (id) { return !!L.getCity(id); });
        s.hour12 = !!raw.hour12;
        if (['auto', 'light', 'dark'].indexOf(raw.theme) >= 0) s.theme = raw.theme;
        if (['indigo', 'ocean', 'sunset', 'forest'].indexOf(raw.accent) >= 0) s.accent = raw.accent;
      }
    } catch (e) { /* 数据损坏时以默认值启动 */ }
    return s;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 存储不可用时静默降级 */ }
  }

  var state = load();
  var root = document.documentElement;
  var grid = document.getElementById('grid');
  var emptyEl = document.getElementById('empty');
  var searchInput = document.getElementById('searchInput');
  var searchPop = document.getElementById('searchPop');
  var fmtBtn = document.getElementById('fmtBtn');
  var themeBtn = document.getElementById('themeBtn');
  var accentsEl = document.getElementById('accents');
  var heroSky = document.getElementById('heroSky');
  var localTimeEl = document.getElementById('localTime');
  var localDateEl = document.getElementById('localDate');
  var localCityEl = document.getElementById('localCity');
  var localZoneEl = document.getElementById('localZone');

  var LOCAL_ZONE = L.localZone();
  var baseTime = 0;          // 上次整秒对齐时刻（ms）
  var localClock = null;     // 本地时钟（含 offsetMin）
  var cards = {};            // cityId -> { city, els, clock }

  // ---------- 主题 ----------
  function applyTheme() {
    if (state.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
    themeBtn.textContent = state.theme === 'auto' ? '🌗' : state.theme === 'light' ? '☀️' : '🌙';
    themeBtn.title = '当前：' + ({ auto: '跟随系统', light: '浅色', dark: '深色' })[state.theme] + '，点击切换';
  }
  function applyAccent() {
    root.setAttribute('data-accent', state.accent);
    accentsEl.querySelectorAll('.accent').forEach(function (b) {
      b.classList.toggle('active', b.dataset.accent === state.accent);
    });
  }
  themeBtn.addEventListener('click', function () {
    state.theme = { auto: 'light', light: 'dark', dark: 'auto' }[state.theme];
    applyTheme(); save();
  });
  accentsEl.addEventListener('click', function (e) {
    var b = e.target.closest('.accent');
    if (!b) return;
    state.accent = b.dataset.accent;
    applyAccent(); save();
  });
  fmtBtn.addEventListener('click', function () {
    state.hour12 = !state.hour12;
    fmtBtn.textContent = state.hour12 ? '12h' : '24h';
    save();
  });

  // ---------- 表盘 ----------
  function dialSVG() {
    var ticks = '';
    for (var i = 0; i < 12; i++) {
      var a = i * 30 * Math.PI / 180;
      var r1 = i % 3 === 0 ? 46 : 49, r2 = 53;
      ticks += '<line x1="' + (60 + r1 * Math.sin(a)).toFixed(2) + '" y1="' + (60 - r1 * Math.cos(a)).toFixed(2) +
        '" x2="' + (60 + r2 * Math.sin(a)).toFixed(2) + '" y2="' + (60 - r2 * Math.cos(a)).toFixed(2) +
        '" stroke="var(--tick)" stroke-width="' + (i % 3 === 0 ? 2.4 : 1.2) + '" stroke-linecap="round"/>';
    }
    return '<svg viewBox="0 0 120 120">' +
      '<circle cx="60" cy="60" r="57" fill="var(--dial)" stroke="var(--dial-ring)" stroke-width="2"/>' +
      ticks +
      '<line class="h-hand" x1="60" y1="66" x2="60" y2="34" stroke="var(--hand)" stroke-width="4" stroke-linecap="round"/>' +
      '<line class="m-hand" x1="60" y1="70" x2="60" y2="24" stroke="var(--hand)" stroke-width="2.6" stroke-linecap="round"/>' +
      '<line class="s-hand" x1="60" y1="74" x2="60" y2="18" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round"/>' +
      '<circle cx="60" cy="60" r="3.2" fill="var(--accent)"/></svg>';
  }

  function setAngles(els, clock, elapsedSec) {
    var s = clock.second + elapsedSec, m = clock.minute + s / 60, h = (clock.hour % 12) + m / 60;
    els.hour.setAttribute('transform', 'rotate(' + (h * 30) + ' 60 60)');
    els.minute.setAttribute('transform', 'rotate(' + (m * 6) + ' 60 60)');
    els.second.setAttribute('transform', 'rotate(' + (s * 6) + ' 60 60)');
  }

  // ---------- 卡片 ----------
  function createCard(city) {
    var el = document.createElement('div');
    el.className = 'card';
    el.innerHTML =
      '<div class="dial">' + dialSVG() + '</div>' +
      '<div class="info">' +
        '<div class="city-row"><span class="flag">' + city.flag + '</span>' +
        '<span class="city-name">' + city.zh + '</span><span class="daynight"></span></div>' +
        '<div class="time">--:--:--</div>' +
        '<div class="sub-row"><span class="date"></span><span class="offset-tag"></span><span class="diff"></span></div>' +
      '</div>' +
      '<button class="remove" title="移除">×</button>';
    var svg = el.querySelector('svg');
    var entry = {
      city: city, el: el, clock: null,
      timeEl: el.querySelector('.time'),
      dateEl: el.querySelector('.date'),
      diffEl: el.querySelector('.diff'),
      dnEl: el.querySelector('.daynight'),
      offEl: el.querySelector('.offset-tag'),
      els: { hour: svg.querySelector('.h-hand'), minute: svg.querySelector('.m-hand'), second: svg.querySelector('.s-hand') }
    };
    el.querySelector('.remove').addEventListener('click', function () { removeCity(city.zh, el); });
    return entry;
  }

  function renderGrid() {
    grid.innerHTML = '';
    cards = {};
    state.cities.forEach(function (id) {
      var city = L.getCity(id);
      if (!city) return;
      var entry = createCard(city);
      cards[id] = entry;
      grid.append(entry.el);
    });
    emptyEl.classList.toggle('hidden', state.cities.length > 0);
    updateAll(new Date());
  }

  function addCity(id) {
    if (cards[id]) return;
    state.cities.push(id);
    save();
    var city = L.getCity(id);
    var entry = createCard(city);
    cards[id] = entry;
    grid.append(entry.el);
    emptyEl.classList.add('hidden');
    updateAll(new Date());
  }

  function removeCity(id, el) {
    el.classList.add('removing');
    setTimeout(function () {
      el.remove();
      delete cards[id];
      state.cities = state.cities.filter(function (c) { return c !== id; });
      save();
      emptyEl.classList.toggle('hidden', state.cities.length > 0);
    }, 240);
  }

  function flashCard(id) {
    var entry = cards[id];
    if (!entry) return;
    entry.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    entry.el.classList.remove('flash');
    void entry.el.offsetWidth;
    entry.el.classList.add('flash');
    searchPop.classList.add('hidden');
    searchInput.value = '';
  }

  // ---------- 搜索 / 内置城市列表 ----------
  function makeItem(c) {
    var added = !!cards[c.zh];
    var item = document.createElement('div');
    item.className = 'sp-item' + (added ? ' added' : '');
    var now = new Date();
    item.innerHTML = '<span class="flag">' + c.flag + '</span>' +
      '<span class="name">' + c.zh + '</span>' +
      '<span class="sub">' + c.en + ' · ' + L.offsetLabel(L.tzOffsetMinutes(c.tz, now)) + '</span>' +
      (added ? '<span class="added-tag">已添加</span>' : '');
    item.addEventListener('mousedown', function (e) {
      e.preventDefault();
      if (added) { flashCard(c.zh); return; }
      addCity(c.zh);
      renderPop();
    });
    return item;
  }

  function renderPop() {
    var q = searchInput.value.trim();
    searchPop.classList.remove('hidden');
    searchPop.innerHTML = '';
    if (q) {
      var list = L.searchCities(q);
      if (!list.length) {
        searchPop.innerHTML = '<div class="sp-empty">未找到匹配城市</div>';
        return;
      }
      list.forEach(function (c) { searchPop.append(makeItem(c)); });
      return;
    }
    // 无关键字：按国家分组展示内置城市列表
    var groups = [];
    var byCountry = {};
    L.CITIES.forEach(function (c) {
      if (!byCountry[c.country]) { byCountry[c.country] = { name: c.country, flag: c.flag, cities: [] }; groups.push(byCountry[c.country]); }
      byCountry[c.country].cities.push(c);
    });
    groups.forEach(function (g) {
      searchPop.append(el2('div', 'sp-group', g.flag + ' ' + g.name + '（' + g.cities.length + '）'));
      g.cities.forEach(function (c) { searchPop.append(makeItem(c)); });
    });
  }
  function el2(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  }
  searchInput.addEventListener('input', renderPop);
  searchInput.addEventListener('focus', renderPop);
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { searchPop.classList.add('hidden'); searchInput.blur(); }
    if (e.key === 'Enter' && searchInput.value.trim()) {
      var first = searchPop.querySelector('.sp-item');
      if (first) first.dispatchEvent(new MouseEvent('mousedown'));
    }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.search-wrap')) searchPop.classList.add('hidden');
  });

  // ---------- 时钟刷新 ----------
  function updateAll(now) {
    baseTime = now.getTime() - now.getMilliseconds();
    var localOffset = L.tzOffsetMinutes(LOCAL_ZONE, now);
    localClock = L.readClock(LOCAL_ZONE, now, localOffset);
    localClock.offsetMin = localOffset;

    localTimeEl.textContent = L.digital(localClock, state.hour12);
    localDateEl.textContent = localClock.dateText + ' ' + localClock.weekday;
    var heroNight = !localClock.isDay;
    heroSky.classList.toggle('night', heroNight);
    heroSky.classList.toggle('day', !heroNight);

    var named = null;
    for (var i = 0; i < L.CITIES.length; i++) {
      if (L.CITIES[i].tz === LOCAL_ZONE) { named = L.CITIES[i]; break; }
    }
    localCityEl.textContent = (named ? named.flag + ' ' + named.zh + ' · ' : '') + '本地时间';
    localZoneEl.textContent = LOCAL_ZONE + ' · ' + L.offsetLabel(localOffset);

    Object.keys(cards).forEach(function (id) {
      var entry = cards[id];
      entry.clock = L.readClock(entry.city.tz, now, localOffset);
      entry.timeEl.textContent = L.digital(entry.clock, state.hour12);
      entry.dateEl.textContent = entry.clock.dateText + ' ' + entry.clock.weekday;
      entry.offEl.textContent = entry.clock.offsetText;
      entry.diffEl.textContent = entry.clock.diffText;
      entry.dnEl.textContent = entry.clock.isDay ? '☀️' : '🌙';
    });
  }

  function loop() {
    var now = new Date();
    if (now.getTime() >= baseTime + 1000) updateAll(now);
    var elapsed = (now.getTime() - baseTime) / 1000;
    Object.keys(cards).forEach(function (id) {
      var e = cards[id];
      if (e.clock) setAngles(e.els, e.clock, elapsed);
    });
    requestAnimationFrame(loop);
  }

  // ---------- 启动 ----------
  applyTheme();
  applyAccent();
  fmtBtn.textContent = state.hour12 ? '12h' : '24h';
  renderGrid();
  requestAnimationFrame(loop);

  // 系统休眠恢复 / 切回窗口时立即校正
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) updateAll(new Date());
  });
})();
