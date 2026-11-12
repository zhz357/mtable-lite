//
// views/browser.js — 内嵌浏览器·多标签页·全屏切换式（移植自 WebView.swift / BrowserView.swift）
// Electron 版用 <webview> 标签承载页面；浏览器视图整体占据内容区（与菜单视图互斥显示），
// 标签的打开/切换/关闭由外层底部切换条（MainView）通过 openTab/activateTab/closeTab 驱动；
// 本组件只负责：工具栏（跟随活动标签）+ 各标签的 webview（非活动标签隐藏保活，不销毁）。
//
import { el, clear } from '../ui.js';
import { icon } from '../icons.js';

// 主 frame 允许的 scheme（照 Swift decidePolicyFor 的 allowedSchemes），
// 拦截自定义 scheme，避免系统弹出"无法打开"对话框
const ALLOWED_SCHEMES = new Set(['http', 'https', 'about', 'data', 'blob', 'game']);

// 关闭前暂停页面内的视频/音频（照 Swift dismantleNSView 的 pauseScript）
const PAUSE_MEDIA_SCRIPT =
  `(function(){document.querySelectorAll('video, audio').forEach(function(m){try{m.pause();m.currentTime=0;}catch(e){}});})();`;

const BLANK_URL = 'about:blank';
const NEW_TAB_TITLE = '新标签页';

let nextTabId = 1;

/** 将用户输入规范化为可加载的 URL（照 Swift normalizedURL）：无 scheme 补 https，关键词走必应搜索 */
function normalizeURL(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('://')) return trimmed;
  if (trimmed.startsWith('about:')) return trimmed;
  if (trimmed.startsWith('localhost')) return `http://${trimmed}`;
  if (trimmed.includes('.')) return `https://${trimmed}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`;
}

/** 标签展示名（底部切换条使用） */
export function tabTitle(tab) {
  if (tab.title && tab.title !== BLANK_URL) return tab.title;
  try {
    const u = new URL(tab.url);
    if (u.protocol === 'about:') return NEW_TAB_TITLE;
    return u.hostname;
  } catch { return tab.url || NEW_TAB_TITLE; }
}

/**
 * 多标签内嵌浏览器（全屏视图）。
 * @param {object} opts
 * @param {string}   [opts.initialURL]   首次打开时的初始地址（无 snapshot 时生效）
 * @param {object}   [opts.snapshot]     标签快照 { tabs: [{id,url,title}], activeId }（可选）
 * @param {function} [opts.onTabsChange] 标签变化回调（快照同步给外层切换条）
 * @param {function} [opts.onClose]      全部标签关闭（最后一个标签被关闭）时退出浏览器视图
 */
export function BrowserTabsView({ initialURL, snapshot, onTabsChange, onClose }) {
  // ---------- 标签数据：{ id, url, title, ready, isLoading, progress, webview, showError } ----------
  let tabs = [];
  let activeId = null;

  if (snapshot?.tabs?.length) {
    tabs = snapshot.tabs.map((t) => createTab(t.url, t.title, t.id));
    activeId = tabs.some((t) => t.id === snapshot.activeId) ? snapshot.activeId : tabs[0].id;
  } else {
    const first = createTab(normalizeURL(initialURL) || BLANK_URL);
    tabs = [first];
    activeId = first.id;
  }

  function createTab(url, title, id) {
    return { id: id || `tab-${nextTabId++}`, url, title: title || '', ready: false, isLoading: false, progress: 0 };
  }

  const activeTab = () => tabs.find((t) => t.id === activeId) || null;

  // ---------- 工具栏控件（跟随活动标签） ----------
  function navBtn(iconName, iconSize, title, handler) {
    const btn = el('button', { class: 'br-nav-btn', title, onclick: handler },
      el('span', { class: 'icon', style: { width: `${iconSize}px`, height: `${iconSize}px` }, innerHTML: icon(iconName) }));
    return btn;
  }

  // 工具栏「×」只关闭当前活动标签（最后一个标签关闭时经 closeTab → handleClose 退出浏览器视图）
  const closeBtn = navBtn('xmark', 12, '关闭当前标签页', () => {
    const t = activeTab();
    if (t) closeTab(t.id);
    else handleClose();
  });
  const backBtn = navBtn('chevron.left', 14, '后退', () => { const t = activeTab(); if (t?.ready) t.webview.goBack(); });
  const forwardBtn = navBtn('chevron.right', 14, '前进', () => { const t = activeTab(); if (t?.ready) t.webview.goForward(); });

  const reloadIcon = el('span', { class: 'icon', style: { width: '13px', height: '13px' } });
  const reloadBtn = el('button', {
    class: 'br-nav-btn', title: '刷新',
    onclick: () => {
      const t = activeTab();
      if (!t?.ready) return;
      if (t.isLoading) t.webview.stopLoading(); // 加载中 → 停止（照 Swift reloadOrStop）
      else t.webview.reload();
    },
  }, reloadIcon);

  const addressInput = el('input', { class: 'br-address-input', placeholder: '输入网址或搜索', spellcheck: 'false' });
  addressInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = activeTab();
    if (!t) return;
    const target = normalizeURL(addressInput.value);
    if (!target) return;
    t.showError(null);
    if (t.ready) t.webview.loadURL(target);
    else t.webview.setAttribute('src', target);
  });

  const addressBox = el('div', { class: 'br-address-box' },
    el('span', { class: 'icon', style: { width: '11px', height: '11px' }, innerHTML: icon('lock') }),
    addressInput);

  const titleLabel = el('div', { class: 'br-title-label' });

  // 加载进度条（对应 Swift estimatedProgress 的 linear ProgressView）
  const progressFill = el('div', { class: 'br-progress-fill' });
  const progressBar = el('div', { class: 'br-progress' }, progressFill);

  function updateNavButtons() {
    const t = activeTab();
    let canBack = false;
    let canForward = false;
    if (t?.ready) {
      try {
        canBack = t.webview.canGoBack();
        canForward = t.webview.canGoForward();
      } catch { /* webview 尚未就绪 */ }
    }
    backBtn.disabled = !canBack;
    forwardBtn.disabled = !canForward;
  }

  function refreshReloadBtn() {
    const t = activeTab();
    const loading = !!t?.isLoading;
    reloadIcon.innerHTML = icon(loading ? 'xmark.circle' : 'arrow.clockwise');
    reloadBtn.title = loading ? '停止' : '刷新';
  }

  function setProgress(p) {
    if (p > 0 && p < 1) {
      progressBar.style.display = 'block';
      progressFill.style.width = `${Math.round(p * 100)}%`;
    } else {
      progressBar.style.display = 'none';
      progressFill.style.width = '0%';
    }
  }

  function syncToolbar() {
    const t = activeTab();
    addressInput.value = t?.url || '';
    titleLabel.textContent = t ? tabTitle(t) : '';
    titleLabel.title = t?.title || '';
    refreshReloadBtn();
    updateNavButtons();
    setProgress(t?.progress || 0);
  }

  // ---------- 内容区：每个标签一个 .br-page（webview + 错误覆盖层），非活动标签隐藏保活 ----------
  const content = el('div', { class: 'br-content' });

  function buildTabPage(tab) {
    const errorMsg = el('div', { class: 'br-error-msg' });
    const errorOverlay = el('div', { class: 'br-error-overlay', style: { display: 'none' } },
      el('span', { class: 'icon br-error-icon', innerHTML: icon('wifi.exclamationmark') }),
      el('div', { class: 'br-error-title' }, '页面加载失败'),
      errorMsg,
      el('button', {
        class: 'br-reload-btn',
        onclick: () => { tab.showError(null); tab.webview.loadURL(tab.url || BLANK_URL); },
      },
        el('span', { class: 'icon', style: { width: '13px', height: '13px' }, innerHTML: icon('arrow.clockwise') }),
        '重新加载'));

    const webview = el('webview', { src: tab.url, allowpopups: '' });
    tab.webview = webview;
    tab.showError = (msg) => { errorOverlay.style.display = msg ? 'flex' : 'none'; if (msg) errorMsg.textContent = msg; };

    // ---------- webview 事件（KVO 状态同步的 Electron 对应实现） ----------
    webview.addEventListener('dom-ready', () => {
      tab.ready = true;
      if (tab.id === activeId) { updateNavButtons(); try { webview.focus(); } catch { /* 焦点不可用时忽略 */ } }
    });

    webview.addEventListener('did-start-loading', () => {
      tab.isLoading = true;
      tab.showError(null);
      if (tab.id === activeId) refreshReloadBtn();
    });

    webview.addEventListener('did-stop-loading', () => {
      tab.isLoading = false;
      tab.progress = 0;
      if (tab.id === activeId) { setProgress(0); refreshReloadBtn(); updateNavButtons(); }
    });

    webview.addEventListener('did-change-load-progress', (e) => {
      tab.progress = e.progress;
      if (tab.id === activeId) setProgress(e.progress);
    });

    // 地址栏/切换条与当前 URL 同步（对应 KVO url + onChange(addressText)）
    const syncURL = (e) => {
      if (!e.url) return;
      tab.url = e.url;
      if (tab.id === activeId) addressInput.value = e.url;
      updateNavButtons();
      emitChange();
    };
    webview.addEventListener('did-navigate', syncURL);
    webview.addEventListener('did-navigate-in-page', syncURL);

    // 页面标题变化同步到工具栏与切换条（对应 KVO title）
    webview.addEventListener('page-title-updated', (e) => {
      tab.title = e.title || '';
      if (tab.id === activeId) { titleLabel.textContent = tabTitle(tab); titleLabel.title = tab.title; }
      emitChange();
    });

    // 加载失败（照 Swift didFail：忽略用户取消 -3；展示错误页 + 重新加载）
    webview.addEventListener('did-fail-load', (e) => {
      if (!e.isMainFrame) return;       // 子 frame 失败不视为页面失败
      if (e.errorCode === -3) return;   // 导航被中断/取消（NSURLErrorCancelled 对应）
      tab.isLoading = false;
      if (tab.id === activeId) refreshReloadBtn();
      tab.showError(e.errorDescription || `加载失败（错误码 ${e.errorCode}）`);
    });

    // scheme 白名单：仅放行 http/https/about/data/blob（照 Swift decidePolicyFor）
    webview.addEventListener('will-navigate', (e) => {
      let scheme = '';
      try {
        scheme = new URL(e.url).protocol.replace(':', '').toLowerCase();
      } catch { /* 解析失败一律拦截 */ }
      if (!ALLOWED_SCHEMES.has(scheme)) e.preventDefault();
    });

    // 网页弹窗（window.open / target="_blank"）由主进程拦截并经 mtable:webview-popup
    // 转发给 MainView.openURL，在内置浏览器新开标签页（Electron 22 起 webview 不再派发 new-window）

    return el('div', { class: 'br-page', dataset: { tabId: tab.id } }, webview, errorOverlay);
  }

  function pageOf(tab) { return content.querySelector(`.br-page[data-tab-id="${tab.id}"]`); }

  // ---------- 标签操作（由外层切换条驱动） ----------
  function activateTab(id) {
    if (!tabs.some((t) => t.id === id)) return;
    activeId = id;
    for (const t of tabs) pageOf(t)?.classList.toggle('hidden', t.id !== activeId);
    syncToolbar();
    emitChange();
    try { activeTab()?.webview?.focus(); } catch { /* 焦点不可用时忽略 */ }
  }

  function openTab(url, { focusAddress = false } = {}) {
    // 相同地址的标签已存在则直接激活（避免重复点卡片堆积标签）
    const existing = tabs.find((t) => t.url === url);
    if (existing) { activateTab(existing.id); return existing; }

    const tab = createTab(url);
    tabs.push(tab);
    const page = buildTabPage(tab);
    page.classList.add('hidden');
    content.append(page);
    activateTab(tab.id);
    if (focusAddress) addressInput.focus();
    emitChange();
    return tab;
  }

  function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = tabs[idx];
    if (tab.ready) {
      try { tab.webview.executeJavaScript(PAUSE_MEDIA_SCRIPT).catch(() => {}); } catch { /* 忽略 */ }
      try { tab.webview.stopLoading(); } catch { /* 忽略 */ }
    }
    pageOf(tab)?.remove();
    tabs.splice(idx, 1);
    if (!tabs.length) { handleClose(); return; }
    if (activeId === id) {
      // 关闭活动标签后激活相邻标签（优先右侧）
      activeId = tabs[Math.min(idx, tabs.length - 1)].id;
      for (const t of tabs) pageOf(t)?.classList.toggle('hidden', t.id !== activeId);
      syncToolbar();
    }
    emitChange();
  }

  // ---------- 整体关闭 ----------
  function handleClose() {
    for (const tab of tabs) {
      if (!tab.ready) continue;
      try { tab.webview.executeJavaScript(PAUSE_MEDIA_SCRIPT).catch(() => {}); } catch { /* 忽略 */ }
      try { tab.webview.stopLoading(); } catch { /* 忽略 */ }
    }
    onClose?.();
  }

  function emitChange() {
    onTabsChange?.({
      tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title })),
      activeId,
    });
  }

  // ---------- 组装 ----------
  for (const tab of tabs) {
    const page = buildTabPage(tab);
    page.classList.toggle('hidden', tab.id !== activeId);
    content.append(page);
  }
  refreshReloadBtn();
  updateNavButtons();

  const root = el('div', { class: 'br-root' },
    el('div', { class: 'br-toolbar' },
      el('div', { class: 'br-toolbar-row' },
        closeBtn,
        backBtn,
        forwardBtn,
        reloadBtn,
        addressBox,
        titleLabel)),
    progressBar,
    el('div', { class: 'br-divider' }),
    content);

  // 外部驱动接口（底部切换条使用）
  root.openTab = (url) => openTab(normalizeURL(url) || BLANK_URL);
  root.activateTab = activateTab;
  root.closeTab = closeTab;
  root.focusAddress = () => { addressInput.focus(); addressInput.select(); };
  return root;
}
