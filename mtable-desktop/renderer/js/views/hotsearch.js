//
// views/hotsearch.js — 首页热搜卡片
// 头条 / 微博双源 tab 切换，默认展示前 10 条，列表垂直滑动查看更多
// 数据源：后端代理（uapis 主源 + 60s 备源 + 服务端缓存），api.fetchHotList
//
import { el, clear } from '../ui.js';
import { api } from '../api.js';
import { icon } from '../icons.js';

const SOURCES = [
  { key: 'toutiao', label: '头条热搜' },
  { key: 'weibo', label: '微博热搜' },
];

/** 热度值格式化：过万显示「x.x万」，无效值返回空串（隐藏热度标签） */
function formatHot(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
}

// 会话级缓存（模块级，跨视图重建共享）：切换菜单回到首页不再重新请求，直接渲染缓存
// value: { items, ts }；STALE_MS 内视为新鲜，过期后先渲染缓存再后台静默刷新
const cache = new Map();
const STALE_MS = 60_000;

export function HotSearchView({ onOpenURL } = {}) {
  let activeKey = SOURCES[0].key;
  let loadToken = 0; // 异步令牌：tab 快速切换 / 连点刷新时只保留最后一次请求结果

  const refreshBtn = el('button', {
    class: 'hs-refresh', type: 'button', title: '刷新热搜',
    onclick: () => load(activeKey, { force: true }),
  }, el('span', { class: 'icon', innerHTML: icon('arrow.clockwise') }));

  const tabs = SOURCES.map((source) => el('button', {
    class: 'hs-tab', type: 'button',
    onclick: () => setActive(source.key),
  }, source.label));

  const listWrap = el('div', { class: 'hs-list' });

  const root = el('div', { class: 'hs-card' },
    el('div', { class: 'hs-header' },
      el('span', { class: 'icon hs-flame', innerHTML: icon('flame.fill') }),
      el('div', { class: 'hs-title' }, '热搜榜'),
      refreshBtn),
    el('div', { class: 'hs-tabs' }, tabs),
    listWrap,
  );

  function renderTabs() {
    tabs.forEach((tab, i) => tab.classList.toggle('active', SOURCES[i].key === activeKey));
  }

  function renderLoading() {
    clear(listWrap).append(el('div', { class: 'hs-state' },
      el('span', { class: 'spinner dark' }), '正在获取热搜…'));
  }

  function renderError() {
    clear(listWrap).append(el('div', { class: 'hs-state empty' },
      el('div', {}, '热搜获取失败'),
      el('button', { class: 'link-btn', type: 'button', onclick: () => load(activeKey, { force: true }) }, '点击重试')));
  }

  function renderList() {
    clear(listWrap);
    const items = cache.get(activeKey)?.items || [];
    if (!items.length) {
      listWrap.append(el('div', { class: 'hs-state empty' },
        el('div', {}, '暂时没有获取到热搜内容'),
        el('button', { class: 'link-btn', type: 'button', onclick: () => load(activeKey, { force: true }) }, '点击重试')));
      return;
    }
    items.forEach((item, index) => {
      const hot = formatHot(item.hot_value);
      const row = el('div', {
        class: 'hs-row',
        title: hot ? `${item.title} · ${hot}热度` : String(item.title ?? ''),
        onclick: () => {
          if (item.link && typeof onOpenURL === 'function') onOpenURL(item.link);
        },
      },
        // 前三名高亮徽标（红 / 橙 / 黄），其余灰色序号
        el('span', { class: `hs-rank${index < 3 ? ` top${index + 1}` : ''}` }, String(index + 1)),
        el('span', { class: 'hs-name' }, String(item.title ?? '')),
        hot ? el('span', { class: 'hs-hot' }, hot) : null,
      );
      listWrap.append(row);
    });
  }

  async function load(key, { force = false, silent = false } = {}) {
    const entry = cache.get(key);
    const stale = !entry || Date.now() - entry.ts > STALE_MS;
    if (!stale && !force) {
      renderList();
      return;
    }
    const token = ++loadToken;
    if (silent) {
      if (entry) renderList(); // 静默刷新：先展示旧数据，不显示加载态
    } else {
      renderLoading();
      refreshBtn.classList.add('loading');
    }
    try {
      const items = await api.fetchHotList(key);
      if (token !== loadToken) return; // 已有更新请求，丢弃过期结果
      cache.set(key, { items: Array.isArray(items) ? items : [], ts: Date.now() });
      if (key === activeKey) renderList();
    } catch (err) {
      if (token !== loadToken) return;
      console.warn('[热搜] 获取失败', key, err?.message || err);
      if (!silent) {
        cache.delete(key);
        renderError();
      } // 静默失败：保留旧数据
    } finally {
      if (token === loadToken) refreshBtn.classList.remove('loading');
    }
  }

  function setActive(key) {
    if (key === activeKey) return;
    activeKey = key;
    renderTabs();
    load(key);
  }

  renderTabs();
  load(activeKey);

  // 每 60s 静默刷新当前榜单；视图被移除（切换菜单）后自动清理定时器
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    load(activeKey, { silent: true });
  }, STALE_MS);

  return root;
}
