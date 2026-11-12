//
// views/dashboard.js — 首页工作台（移植自 DashboardView.swift）
// 左侧主内容：欢迎标题 + 卡片数量柱状图 + 快捷卡片 + 今日一言
// 右侧栏：热搜榜（头条 / 微博切换）+ 今日便签
//
import { el, clear, toast } from '../ui.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { DailyNoteView } from './dailynote.js';
import { HotSearchView } from './hotsearch.js';
import { FaviconView } from './cards.js';
import { AIAssistant } from './ai-assistant.js';

/// 柱状图调色板（对应 BarChartView.palette，六色循环）
const PALETTE = ['#ff7a47', '#4dbfd9', '#33b38c', '#f2b134', '#e6738c', '#7d9bb8'];

// ---------- 首页快捷卡片（本地持久化，无需后端） ----------
const HOME_CARDS_KEY = 'mtable.home.cards';

function loadHomeCards() {
  try {
    const list = JSON.parse(localStorage.getItem(HOME_CARDS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function DashboardView({ user, menus, onOpenURL }) {
  /// 除首页外的自定义菜单（排除插件菜单；对应 Swift customMenus = menus.dropFirst().filter { $0.pluginKey == nil }）
  const customMenus = menus.slice(1).filter((m) => !m.pluginKey);

  const cardCounts = new Map(); // serverId -> 卡片数量
  let quote = null;             // 今日一言 { hitokoto, from, fromWho }
  let homeCards = loadHomeCards(); // 首页快捷卡片 [{ url, title, iconUrl, menuTitle }]

  // 已同步到服务端的菜单（快捷卡片选择器数据源）
  const menuOptions = customMenus
    .filter((m) => m.serverId != null)
    .map((m) => ({ id: m.serverId, title: m.title }));

  // ---------- 今日一言（内嵌 DailyQuoteView，吸附底部） ----------
  const quoteInner = el('div', { class: 'dash-quote-inner' });

  function renderQuote() {
    clear(quoteInner);
    if (!quote) {
      quoteInner.append(el('span', { class: 'dash-quote-text dash-quote-loading' }, '正在获取今日一言…'));
      return;
    }
    quoteInner.append(el('span', { class: 'dash-quote-text' }, quote.hitokoto));
    // 拼接出处：优先作者 + 作品（对应 attributionText）
    const who = (quote.fromWho || '').trim();
    const from = (quote.from || '').trim();
    const parts = [who, from].filter((s) => s);
    if (parts.length) {
      quoteInner.append(el('span', { class: 'dash-quote-src' }, `—— ${parts.join(' · ')}`));
    }
  }

  // ---------- 柱状图（内嵌 BarChartView，纯 div/CSS 实现） ----------
  const chartBox = el('div', { class: 'dash-chart' });
  let barWidth = 48;

  function renderChart() {
    clear(chartBox);
    const items = customMenus.map((menu) => ({
      label: menu.title,
      value: menu.serverId != null ? (cardCounts.get(menu.serverId) ?? 0) : 0,
    }));
    if (!items.length) {
      chartBox.append(el('div', { class: 'dash-chart-empty' }, '暂无数据'));
      return;
    }
    // 柱子间距：根据数量自适应（对应 barSpacing）
    const spacing = items.length <= 4 ? 32 : items.length <= 8 ? 20 : 12;
    const maxValue = Math.max(...items.map((i) => i.value), 1);
    const row = el('div', { class: 'dash-chart-row', style: { gap: `${spacing}px` } });
    items.forEach((item, index) => {
      const color = PALETTE[index % PALETTE.length];
      const height = Math.max((item.value / maxValue) * 160, 2);
      row.append(el('div', { class: 'dash-bar-col' },
        el('div', { class: 'dash-bar-value' }, String(item.value)),
        el('div', {
          class: 'dash-bar',
          style: {
            width: `${barWidth}px`,
            height: `${height}px`,
            background: `linear-gradient(180deg, ${color}, ${color}bf)`,
            boxShadow: `0 2px 4px ${color}4d`,
          },
        }),
        el('div', { class: 'dash-bar-label', style: { width: `${barWidth + 16}px` } }, item.label),
      ));
    });
    chartBox.append(row);
  }

  let lastChartWidth = 0; // 上次实测宽度（滞回用）
  let lastMeasureCount = 0;

  /** 柱子宽度随容器宽度自适应（对应 GeometryReader + barWidth） */
  function measureBarWidth() {
    const width = chartBox.clientWidth;
    if (!width) return;
    const count = customMenus.length;
    if (!count) return;
    // 滞回：容器宽度变化小于滚动条宽度级别、且菜单数未变时不重算，
    // 避免测量 → 重渲染 → 滚动条切换 → 再触发的抖动循环（窄窗口下表现为页面持续轻微抖动）
    if (lastMeasureCount === count && lastChartWidth && Math.abs(width - lastChartWidth) < 8) return;
    lastChartWidth = width;
    lastMeasureCount = count;
    const spacing = count <= 4 ? 32 : count <= 8 ? 20 : 12;
    // 预留：列间距 + 每列标签比柱宽多出的 16px + 余量，避免内容恒溢出触发横向滚动条
    const available = width - spacing * Math.max(count - 1, 0) - 16 * count - 8;
    const next = Math.round(Math.min(Math.max(available / count, 20), 60));
    if (next === barWidth) return;
    barWidth = next;
    renderChart();
  }

  // ---------- 布局 ----------
  const emptyChart = el('div', { class: 'dash-empty-chart' },
    el('span', { class: 'icon dash-empty-icon', innerHTML: icon('chart.bar.xaxis') }),
    el('div', { class: 'dash-empty-title' }, '暂无自定义菜单'),
    el('div', { class: 'dash-empty-sub' }, '在左侧侧边栏点击「+」新建菜单，开始打造您的工作空间'),
  );

  const cardsGrid = el('div', { class: 'dash-cards-grid' });

  function saveHomeCards() {
    try { localStorage.setItem(HOME_CARDS_KEY, JSON.stringify(homeCards)); } catch { /* 忽略 */ }
  }

  const isHomeCard = (url) => homeCards.some((c) => c.url === url);

  function renderHomeCards() {
    clear(cardsGrid);
    if (!homeCards.length) {
      // 空态：整个虚线区域即可点击的添加入口
      cardsGrid.append(el('button', {
        class: 'dash-cards-empty', type: 'button',
        title: '从左侧菜单中选择常用卡片添加到首页',
        onclick: openCardPicker,
      }, '点击此处从左侧菜单中选择常用卡片添加到首页'));
      return;
    }
    for (const card of homeCards) {
      const node = el('div', {
        class: 'dash-home-card',
        title: `${card.title}（来自：${card.menuTitle || '菜单'}）`,
      },
        FaviconView(card.url, card.iconUrl, 36),
        el('div', { class: 'dash-home-card-title' }, card.title),
        el('button', {
          class: 'dash-home-card-del', type: 'button', title: '从首页移除',
          onclick: (e) => {
            e.stopPropagation();
            homeCards = homeCards.filter((c) => c !== card);
            saveHomeCards();
            renderHomeCards();
            toast('已从首页移除');
          },
        }, el('span', { class: 'icon', innerHTML: icon('xmark') })));
      node.addEventListener('click', () => {
        if (typeof onOpenURL === 'function') onOpenURL(card.url);
      });
      cardsGrid.append(node);
    }
    // 已有卡片时在网格末尾保留一个虚线添加入口，保证选择器随时可达
    cardsGrid.append(el('button', {
      class: 'dash-cards-add', type: 'button',
      title: '从左侧菜单中选择常用卡片添加到首页',
      onclick: openCardPicker,
    },
      el('span', { class: 'icon', innerHTML: icon('plus') }),
      el('span', { class: 'dash-cards-add-text' }, '添加卡片')));
  }

  // ---------- 卡片选择器弹窗（左侧菜单分类导航 + 搜索高亮 + 键盘操作 + 已添加可就地移除） ----------
  function openCardPicker() {
    if (!menuOptions.length) {
      toast('请先在左侧侧边栏新建菜单并添加卡片');
      return;
    }
    // 防重入：弹窗已打开时忽略重复触发（快速连点不会叠加多层弹窗）
    if (document.querySelector('#modal-root .dash-picker-modal')) return;
    let allGroups = [];       // [{ menuId, menuTitle, cards: [...] }]
    let loaded = false;
    let filterText = '';
    let activeMenuId = null;  // null = 全部菜单
    let rowList = [];         // 当前可见卡片行（键盘 ↑↓ 导航用）

    const statusText = el('span', { class: 'dash-picker-status' });
    const searchInput = el('input', {
      class: 'field-input dlg-input', type: 'search', placeholder: '搜索卡片名称或网址',
    });
    const navBox = el('div', { class: 'dash-picker-nav' });
    const listBox = el('div', { class: 'dash-picker-list' });

    const mask = el('div', {
      class: 'modal-mask',
      onclick: (e) => { if (e.target === mask) close(); },
    },
      el('div', { class: 'dash-picker-modal' },
        el('div', { class: 'dash-picker-head' },
          el('div', { class: 'dash-picker-head-row' },
            el('div', { class: 'dlg-title' }, '添加卡片到首页'),
            statusText),
          el('div', { class: 'dash-picker-sub' }, '按菜单分类浏览，点击卡片即可添加，再次点击可移除'),
          searchInput),
        el('div', { class: 'dash-picker-main' }, navBox, listBox),
        el('div', { class: 'dash-picker-foot' },
          el('span', { class: 'dash-picker-kbd-tips' },
            el('kbd', { class: 'dash-picker-kbd' }, '↑'), el('kbd', { class: 'dash-picker-kbd' }, '↓'), ' 选择　',
            el('kbd', { class: 'dash-picker-kbd' }, 'Enter'), ' 添加　',
            el('kbd', { class: 'dash-picker-kbd' }, 'Esc'), ' 关闭'),
          el('button', { class: 'dlg-btn-cancel', type: 'button' }, '关闭'))));

    function close() { mask.remove(); }
    mask.querySelector('.dlg-btn-cancel').addEventListener('click', close);

    const kw = () => filterText.trim().toLowerCase();
    const matchCard = (c, k) => !k
      || String(c.title || '').toLowerCase().includes(k)
      || String(c.url || '').toLowerCase().includes(k);

    /** 有卡片的菜单（导航与列表共用数据源） */
    const visibleGroups = () => allGroups.filter((g) => g.cards.length);

    /** 关键字高亮（DOM 分段构建，避免 innerHTML 注入） */
    function highlight(text, k) {
      const s = String(text ?? '');
      if (!k || !s) return document.createTextNode(s);
      const frag = document.createDocumentFragment();
      const lower = s.toLowerCase();
      let from = 0;
      for (let idx = lower.indexOf(k); idx >= 0; idx = lower.indexOf(k, from)) {
        if (idx > from) frag.append(document.createTextNode(s.slice(from, idx)));
        frag.append(el('mark', { class: 'dash-picker-hl' }, s.slice(idx, idx + k.length)));
        from = idx + k.length;
      }
      if (from < s.length) frag.append(document.createTextNode(s.slice(from)));
      return frag;
    }

    /** 状态栏：已添加数量（+ 搜索时显示匹配数量） */
    function updateStatus() {
      const k = kw();
      const matched = visibleGroups()
        .reduce((s, g) => s + g.cards.filter((c) => matchCard(c, k)).length, 0);
      clear(statusText).append(el('b', {}, String(homeCards.length)), ' 张已添加');
      if (k) statusText.append(` · 匹配 ${matched} 张`);
    }

    function navItem(menuId, title, iconKey, count, active) {
      return el('button', {
        class: `dash-picker-nav-item${active ? ' active' : ''}`, type: 'button',
        onclick: () => { activeMenuId = menuId; renderNav(); renderList(); },
      },
        el('span', { class: 'icon', innerHTML: icon(iconKey) }),
        el('span', { class: 'dash-picker-nav-title' }, title),
        el('span', { class: `dash-picker-nav-count${count ? '' : ' zero'}` }, String(count)));
    }

    function renderNav() {
      clear(navBox);
      if (!loaded) {
        navBox.append(el('div', { class: 'dash-picker-nav-loading' }, '加载中...'));
        return;
      }
      const k = kw();
      const groups = visibleGroups();
      navBox.append(navItem(null, '全部', 'list',
        groups.reduce((s, g) => s + g.cards.filter((c) => matchCard(c, k)).length, 0),
        activeMenuId === null));
      for (const g of groups) {
        navBox.append(navItem(g.menuId, g.menuTitle, 'folder',
          g.cards.filter((c) => matchCard(c, k)).length,
          activeMenuId === g.menuId));
      }
    }

    function focusRow(i) {
      const row = rowList[Math.max(0, Math.min(i, rowList.length - 1))];
      if (row) { row.focus(); row.scrollIntoView({ block: 'nearest' }); }
    }

    function clearSearch() {
      filterText = '';
      searchInput.value = '';
      refresh();
      searchInput.focus();
    }

    function buildRow(group, card, k) {
      const title = card.title || card.url;

      const toggle = () => {
        if (isHomeCard(card.url)) {
          homeCards = homeCards.filter((c) => c.url !== card.url);
          saveHomeCards();
          renderHomeCards();
          refresh();
          toast(`已从首页移除「${title}」`);
        } else {
          homeCards.push({
            url: card.url,
            title,
            iconUrl: card.iconUrl || null,
            menuTitle: group.menuTitle,
          });
          saveHomeCards();
          renderHomeCards();
          refresh();
          toast(`已添加「${title}」到首页`);
        }
      };

      const added = isHomeCard(card.url);
      const actionBtn = el('button', {
        class: added ? 'dash-picker-added' : 'dash-picker-add', type: 'button',
        title: added ? '点击从首页移除' : '添加到首页',
        onclick: (e) => { e.stopPropagation(); toggle(); },
      }, added ? '✓ 已添加' : '添加');
      // 已添加状态：悬停提示可移除
      if (added) {
        actionBtn.addEventListener('mouseenter', () => { actionBtn.textContent = '移除'; });
        actionBtn.addEventListener('mouseleave', () => { actionBtn.textContent = '✓ 已添加'; });
      }

      const row = el('div', {
        class: `dash-picker-item${added ? ' added' : ''}`,
        tabindex: -1, role: 'option', 'aria-selected': String(added),
        onclick: toggle,
      },
        FaviconView(card.url, card.iconUrl, 32),
        el('div', { class: 'dash-picker-item-main' },
          el('div', { class: 'dash-picker-item-title' }, highlight(title, k)),
          el('div', { class: 'dash-picker-item-url' }, highlight(card.url, k))),
        actionBtn);

      row.addEventListener('keydown', (e) => {
        const idx = rowList.indexOf(row);
        if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(idx + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(idx - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); toggle(); }
      });
      rowList.push(row);
      return row;
    }

    function renderList() {
      clear(listBox);
      rowList = [];
      if (!loaded) {
        listBox.append(el('div', { class: 'dash-picker-state' },
          el('span', { class: 'spinner dark' }), '正在加载卡片...'));
        return;
      }
      const k = kw();
      const groups = visibleGroups()
        .filter((g) => activeMenuId == null || g.menuId === activeMenuId);
      let total = 0;
      for (const g of groups) {
        const cards = g.cards.filter((c) => matchCard(c, k));
        if (!cards.length) continue;
        listBox.append(el('div', { class: 'dash-picker-group' }, `${g.menuTitle} · ${cards.length} 个`));
        for (const card of cards) {
          total++;
          listBox.append(buildRow(g, card, k));
        }
      }
      if (!total) {
        listBox.append(el('div', { class: 'dash-picker-state empty' },
          el('div', {}, k ? '没有匹配的卡片' : '该菜单下暂无卡片'),
          k ? el('button', { class: 'link-btn', type: 'button', onclick: clearSearch }, '清除搜索') : null));
      }
    }

    function refresh() { renderNav(); renderList(); updateStatus(); }

    searchInput.addEventListener('input', () => {
      filterText = searchInput.value;
      if (loaded) refresh();
    });
    // 搜索框内按 ↓ 直接进入列表选择
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(0); }
    });
    // Esc：搜索框有内容先清空，否则关闭弹窗
    mask.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (e.target === searchInput && filterText) clearSearch();
      else close();
    });

    document.getElementById('modal-root').append(mask);
    searchInput.focus();

    // 并发拉取各菜单卡片（失败菜单跳过）
    (async () => {
      const groups = await Promise.all(menuOptions.map(async (menu) => {
        try {
          const cards = await api.getCardList(menu.id);
          return { menuId: menu.id, menuTitle: menu.title, cards: cards || [] };
        } catch {
          return { menuId: menu.id, menuTitle: menu.title, cards: [] };
        }
      }));
      allGroups = groups;
      loaded = true;
      if (!mask.isConnected) return; // 弹窗已关闭，丢弃结果
      refresh();
    })();
  }

  const content = el('div', { class: 'dash-content' },
    el('div', { class: 'dash-header' },
      el('div', { class: 'dash-header-texts' },
        el('div', { class: 'dash-hello' }, `欢迎回来, ${user.nickname}`),
        el('div', { class: 'dash-sub' }, '这是您的工作空间数据概览'),
      ),
    ),
    customMenus.length === 0 ? emptyChart
      : el('div', { class: 'dash-chart-card' }, chartBox),
    cardsGrid,
  );

  const root = el('div', { class: 'dash-root' },
    // 双列主区域：左侧主内容（欢迎 + 柱状图 + 快捷卡片）与右侧栏，各自独立滚动
    el('div', { class: 'dash-body' },
      el('div', { class: 'dash-scroll' }, content),
      // 右侧栏：热搜榜 + 今日便签 + 长期待办事项
      el('div', { class: 'dash-side' },
        HotSearchView({ onOpenURL }),
        el('div', { class: 'dash-side-note' }, DailyNoteView({ category: 'daily' })),
        el('div', { class: 'dash-side-note' }, DailyNoteView({ category: 'longterm' })),
      ),
    ),
    // 今日一言（吸附底部，单列横向滚动可查看超长句子）
    el('div', { class: 'dash-quote-bar' }, quoteInner),
    // AI 助手（右下角悬浮入口 + 右侧滑出面板）
    AIAssistant({ user }),
  );

  renderQuote();
  renderChart();
  renderHomeCards();
  loadCardCounts();
  loadHitokoto();

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => measureBarWidth()).observe(chartBox);
  } else {
    requestAnimationFrame(measureBarWidth);
  }

  return root;

  /** 各菜单卡片数量（对应 loadCardCounts；api 层用 getCardList 统计，含文件夹内卡片） */
  async function loadCardCounts() {
    for (const menu of customMenus) {
      if (menu.serverId == null) continue;
      let count = 0;
      try {
        const list = await api.getCardList(menu.serverId);
        count = list.length;
      } catch {
        count = 0;
      }
      cardCounts.set(menu.serverId, count);
      renderChart();
    }
  }

  /** 今日一言（对应 loadHitokoto；获取失败静默处理，保留空态展示） */
  async function loadHitokoto() {
    try {
      const resp = await api.fetchHitokoto();
      quote = { hitokoto: resp.hitokoto, from: resp.from, fromWho: resp.from_who };
    } catch { /* 静默处理 */ }
    renderQuote();
  }
}
