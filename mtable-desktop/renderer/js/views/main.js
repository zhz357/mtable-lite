//
// views/main.js — 主布局：顶部栏 + 左侧菜单 + 右侧内容区（移植自 MainLayoutView.swift）
//
import { el, clear, confirmModal, avatarNode } from '../ui.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { TopBarView } from './topbar.js';
import { SidebarView } from './sidebar.js';
import { DashboardView } from './dashboard.js';
import { CardsView } from './cards.js';
import { MarketplaceView } from './marketplace.js';
import { RoadmapView } from './roadmap.js';
import { CountdownView } from './countdown.js';
import { QuotaView } from './quota.js';
import { SettingView } from './settings.js';
import { BrowserTabsView, tabTitle } from './browser.js';
import { ProfileEditView } from './profile.js';
import { initWallpaperLayer, loadWallpaper } from '../wallpaper.js';

let nextLocalId = 1;
const localId = () => `local-${nextLocalId++}`;

/// 菜单状态管理（移植自 MenuState：乐观更新 + 本地缓存 + 异步同步）
class MenuState {
  constructor() {
    this.settingId = '__setting__';
    this.marketplaceId = '__marketplace__';
    this.menus = store.getMenus() || [this.defaultMenu()];
    this.selectedMenuId = this.menus[0]?.id ?? null;
    this.listeners = new Set();
    this.#loadFromAPI();
  }

  defaultMenu() { return { id: localId(), serverId: null, title: '首页', icon: 'house.fill', pluginKey: null }; }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn()); }

  persist() { store.setMenus(this.menus); }

  async #loadFromAPI() {
    try {
      const dtos = await api.getMenuList();
      let loaded = dtos.map((d) => ({
        id: `s-${d.id}`, serverId: d.id, title: d.title,
        icon: d.icon || 'folder', pluginKey: d.pluginKey || null,
      }));
      if (!loaded.length) loaded = [this.defaultMenu()];
      this.menus = loaded;
      this.selectedMenuId = this.menus[0]?.id ?? null;
      this.persist();
      this.emit();
    } catch { /* API 失败时保留本地缓存 */ }
  }

  reload() { this.#loadFromAPI(); }

  select(id) {
    if (this.selectedMenuId === id) return;
    this.selectedMenuId = id;
    this.emit();
  }

  addMenu(title, icon) {
    const menu = { id: localId(), serverId: null, title, icon, pluginKey: null };
    this.menus.push(menu);
    this.selectedMenuId = menu.id;
    this.persist();
    this.emit();
    api.addMenu(title, icon).then((dto) => {
      menu.serverId = dto.id;
      menu.id = `s-${dto.id}`;
      if (this.selectedMenuId === menu.id) this.selectedMenuId = menu.id;
      this.persist(); this.emit();
    }).catch(() => {
      this.menus = this.menus.filter((m) => m !== menu);
      if (this.selectedMenuId === menu.id) this.selectedMenuId = this.menus[0]?.id ?? null;
      this.persist(); this.emit();
    });
  }

  editMenu(id, title, icon) {
    const menu = this.menus.find((m) => m.id === id);
    if (!menu) return;
    const prev = { title: menu.title, icon: menu.icon };
    menu.title = title; menu.icon = icon;
    this.persist(); this.emit();
    if (menu.serverId) {
      api.updateMenu(menu.serverId, title, icon).catch(() => {
        menu.title = prev.title; menu.icon = prev.icon;
        this.persist(); this.emit();
      });
    }
  }

  requestDelete(id) {
    const menu = this.menus.find((m) => m.id === id);
    if (!menu) return;
    if (!menu.serverId) return this.#performDelete(menu);
    api.getCardList(menu.serverId).then((cards) => {
      if (cards.length > 0) {
        confirmModal({
          title: '确认删除菜单',
          message: `菜单「${menu.title}」下有 ${cards.length} 个卡片，删除菜单将同时删除其下所有卡片，且不可恢复。确定要删除吗？`,
          confirmText: '确认删除', cancelText: '取消', danger: true,
        }).then((ok) => { if (ok) this.#performDelete(menu); });
      } else {
        this.#performDelete(menu);
      }
    }).catch(() => this.#performDelete(menu));
  }

  #performDelete(menu) {
    this.menus = this.menus.filter((m) => m !== menu);
    if (this.selectedMenuId === menu.id) this.selectedMenuId = this.menus[0]?.id ?? null;
    this.persist(); this.emit();
    if (menu.serverId) {
      api.deleteMenu(menu.serverId).catch(() => {
        this.menus.unshift(menu);
        this.persist(); this.emit();
      });
    }
  }

  reorder() {
    this.persist();
    const serverIds = this.menus.map((m) => m.serverId).filter(Boolean);
    if (serverIds.length) api.reorderMenus(serverIds).catch(() => {});
  }
}

export function MainView({ user, onLogout }) {
  const state = new MenuState();
  // 内嵌浏览器（多标签·全屏切换式）：浏览器视图与菜单内容互斥地占据整个内容区，
  // 打开网页 → 浏览器全屏；点击侧栏菜单/Logo → 回到菜单全屏（也是全屏，无分屏挤压）；
  // 有标签时底部常驻一条切换条：[🏠菜单] [标签×] [标签×] [+]，一键互切；
  // 切换仅显隐、不销毁 webview，页面状态保留
  let browserRef = null;
  let tabsSnapshot = null; // { tabs: [{id,url,title}], activeId }
  let browserVisible = false;
  let switchbarEl = null;
  let userRef = user;

  const contentWrap = el('div', {
    class: 'main-content',
    style: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  });
  // 壁纸背景层：内容区最底层（view-host / 底部切换条在其上，见 wallpaper.css）；
  // 先用 localStorage 缓存即时应用避免闪烁，再异步拉取服务端最新设置覆盖
  const wpLayer = el('div', { class: 'wp-layer' });
  contentWrap.append(wpLayer);
  initWallpaperLayer();
  loadWallpaper();
  const viewHost = el('div', { class: 'view-host' });
  const menuLayer = el('div', { class: 'menu-layer' });
  const browserLayer = el('div', { class: 'browser-layer' });
  viewHost.append(menuLayer, browserLayer);
  contentWrap.append(viewHost);

  function syncLayers() {
    const showBrowser = browserVisible && !!browserRef;
    menuLayer.classList.toggle('hidden', showBrowser);
    browserLayer.classList.toggle('hidden', !showBrowser);
  }

  function showBrowser() {
    if (!browserRef || browserVisible) return;
    browserVisible = true;
    renderContent();        // 仅刷新切换条高亮，菜单内容保留在 menuLayer 中
    syncLayers();
    renderSwitchbar();
  }

  /** 关闭整个浏览器：清空标签与切换条，回到菜单视图 */
  function closeBrowser() {
    browserRef = null; tabsSnapshot = null; browserVisible = false;
    clear(browserLayer);
    syncLayers();
    renderSwitchbar();
  }

  /** 确保浏览器存在（首个标签用 initialURL），只创建一次、常驻 browserLayer */
  function ensureBrowser(initialURL) {
    if (browserRef) return;
    browserRef = BrowserTabsView({
      initialURL,
      onTabsChange(s) { tabsSnapshot = s; renderSwitchbar(); },
      onClose: closeBrowser,
    });
    browserLayer.append(browserRef);
  }

  /** 打开网页：追加/激活标签并切换到浏览器全屏视图 */
  function openURL(url) {
    ensureBrowser(url);
    browserRef?.openTab(url);
    showBrowser();
  }

  // 网页弹窗（window.open / target="_blank"）被主进程拦截后转发至此，
  // 在内置浏览器新标签页打开（标签自带地址栏，可查看/复制），不弹独立窗口
  const disposePopup = window.mtable?.onWebviewPopup
    ? window.mtable.onWebviewPopup((url) => { if (url) openURL(url); })
    : null;

  // ---------- 底部标签切换条：[🏠菜单] [标签×]... [+] ----------
  function renderSwitchbar() {
    switchbarEl?.remove(); switchbarEl = null;
    if (!browserRef || !tabsSnapshot?.tabs?.length) return;
    const homeBtn = el('button', {
      class: `bsb-home${browserVisible ? '' : ' active'}`, title: '返回菜单',
      onclick: () => {
        browserVisible = false;
        renderContent();
        syncLayers();
        renderSwitchbar();
      },
    }, el('span', { class: 'icon', innerHTML: icon('house.fill') }));
    const chips = tabsSnapshot.tabs.map((t) => el('div', {
      class: `bsb-chip${browserVisible && t.id === tabsSnapshot.activeId ? ' active' : ''}`,
      title: t.url,
      onclick: () => { browserRef.activateTab(t.id); showBrowser(); },
    },
      el('span', { class: 'bsb-chip-title' }, tabTitle(t)),
      el('button', {
        class: 'bsb-chip-close', title: '关闭标签页',
        onclick: (e) => { e.stopPropagation(); browserRef.closeTab(t.id); },
      }, el('span', { class: 'icon', style: { width: '9px', height: '9px' }, innerHTML: icon('xmark') }))));
    const plusBtn = el('button', {
      class: 'bsb-plus', title: '新建标签页',
      onclick: () => { browserRef.openTab('about:blank'); showBrowser(); browserRef.focusAddress(); },
    }, el('span', { class: 'icon', style: { width: '12px', height: '12px' }, innerHTML: icon('plus') }));
    switchbarEl = el('div', { class: 'browser-switchbar' },
      homeBtn,
      el('div', { class: 'bsb-tabs' }, chips),
      plusBtn);
    contentWrap.append(switchbarEl);
  }

  function renderContent() {
    clear(menuLayer);
    if (state.selectedMenuId === state.settingId) {
      menuLayer.append(SettingView({
        user: userRef,
        onUserUpdated(u) { userRef = u; store.setUser(u); },
      }));
    } else if (state.selectedMenuId === state.marketplaceId) {
      menuLayer.append(MarketplaceView({ onPluginsChanged: () => state.reload() }));
    } else if (state.selectedMenuId === state.menus[0]?.id) {
      menuLayer.append(DashboardView({ user: userRef, menus: state.menus, onOpenURL: openURL }));
    } else {
      const menu = state.menus.find((m) => m.id === state.selectedMenuId);
      if (!menu) {
        menuLayer.append(DashboardView({ user: userRef, menus: state.menus, onOpenURL: openURL }));
      } else if (menu.pluginKey) {
        menuLayer.append(pluginContent(menu.pluginKey));
      } else if (menu.serverId) {
        menuLayer.append(CardsView({
          menuId: menu.serverId, menuTitle: menu.title, menus: state.menus,
          onOpenURL: openURL,
        }));
      } else {
        menuLayer.append(placeholderView(menu.title, menu.icon, '正在同步...'));
      }
    }
  }

  function pluginContent(pluginKey) {
    if (pluginKey === 'learning-roadmap') return RoadmapView();
    if (pluginKey === 'countdown') return CountdownView();
    if (pluginKey === 'model-quota') return QuotaView();
    return placeholderView(pluginKey, 'puzzlepiece', `插件「${pluginKey}」暂未支持渲染`);
  }

  // 菜单切换 → 自动回到菜单视图（已开标签保留在底部切换条中）
  let lastSelectedId = state.selectedMenuId;
  state.subscribe(() => {
    if (state.selectedMenuId !== lastSelectedId) {
      lastSelectedId = state.selectedMenuId;
      browserVisible = false;
    }
    renderContent();
    syncLayers();
    renderSwitchbar();
  });

  const sidebarWrap = el('div', { class: 'main-sidebar' });
  SidebarView({
    sidebarWrap, menuState: state,
    onSettingClick: () => state.select(state.settingId),
    onMarketplaceClick: () => state.select(state.marketplaceId),
  });

  const topbarNode = TopBarView({
    user: userRef,
    onLogoClick: () => state.select(state.menus[0]?.id),
    onSearch: openURL,
    onLogout,
    onEditProfile() {
      openProfileEdit();
    },
    onUserUpdated(u) { userRef = u; store.setUser(u); },
  });

  function openProfileEdit() {
    ProfileEditView({
      user: userRef,
      onSuccess(u) { userRef = u; store.setUser(u); topbarNode.updateUser(u); renderContent(); },
    });
  }

  const shell = el('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' } },
    topbarNode,
    el('div', { style: { flex: '1', display: 'flex', minHeight: '0' } },
      sidebarWrap,
      el('div', { style: { width: '1px', background: 'var(--line)' } }),
      contentWrap,
    ),
  );

  renderContent();
  syncLayers();
  // 视图卸载（登出/切换路由）时由 app.js 调用，解除全局弹窗订阅，避免重复监听
  shell.dispose = () => disposePopup?.();
  return shell;
}

function placeholderView(title, icon_, message) {
  return el('div', { class: 'empty-state' },
    el('span', { class: 'icon icon-lg', innerHTML: icon(icon_) }),
    el('div', { class: 'title' }, title),
    el('div', {}, message),
  );
}
