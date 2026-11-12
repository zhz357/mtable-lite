//
// views/marketplace.js — 插件市场（移植自 MarketplaceView.swift）
// 浏览可安装插件，按需安装/卸载到侧边栏
//
import { el, clear } from '../ui.js';
import { api, APIError } from '../api.js';
import { icon } from '../icons.js';

export function MarketplaceView({ onPluginsChanged } = {}) {
  let plugins = [];
  let activeCategory = '全部';
  let animateNext = false;
  let isLoading = false;
  let errorMessage = null;
  const busyIds = new Set();

  const content = el('div', { class: 'mk-content' });
  const tabsEl = el('div', { class: 'mk-tabs', role: 'tablist' });

  function categoryOf(plugin) {
    return (plugin.category || '').trim() || '其他';
  }

  function filteredPlugins() {
    return activeCategory === '全部'
      ? plugins
      : plugins.filter((p) => categoryOf(p) === activeCategory);
  }

  // MARK: - 分类 Tab（全部 + 数据中出现过的分类，可随插件扩展）
  function renderTabs() {
    clear(tabsEl);
    const cats = ['全部', ...new Set(plugins.map(categoryOf))];
    if (!cats.includes(activeCategory)) activeCategory = '全部';
    tabsEl.style.display = plugins.length ? '' : 'none';

    for (const cat of cats) {
      const count = cat === '全部'
        ? plugins.length
        : plugins.filter((p) => categoryOf(p) === cat).length;
      tabsEl.append(el('button', {
        type: 'button',
        class: `mk-tab${cat === activeCategory ? ' active' : ''}`,
        role: 'tab',
        'aria-selected': cat === activeCategory ? 'true' : 'false',
        onclick: () => selectCategory(cat),
      },
        el('span', { class: 'mk-tab-label' }, cat),
        el('span', { class: 'mk-tab-count' }, String(count))));
    }
  }

  function findScroller() {
    let node = root;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight + 1 && /(auto|scroll)/.test(style.overflowY)) return node;
      node = node.parentElement;
    }
    const se = document.scrollingElement;
    return se && se.scrollHeight > se.clientHeight + 1 ? se : null;
  }

  function selectCategory(cat) {
    if (cat === activeCategory) return;
    activeCategory = cat;
    animateNext = true;
    const scroller = findScroller();
    const prevTop = scroller ? scroller.scrollTop : 0;
    renderContent();
    if (scroller) {
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(prevTop, maxTop);
    }
  }

  function notifyPluginsChanged() {
    if (typeof onPluginsChanged === 'function') onPluginsChanged();
  }

  // MARK: - Content（加载 / 错误 / 空 / 网格，对应 Swift @ViewBuilder content）
  function renderContent() {
    clear(content);
    renderTabs();
    if (isLoading && !plugins.length) {
      content.append(el('div', { class: 'mk-center', style: { gap: '12px' } },
        el('span', { class: 'spinner dark' }),
        el('div', { class: 'mk-hint' }, '加载中...'),
      ));
    } else if (errorMessage && !plugins.length) {
      content.append(el('div', { class: 'mk-center' },
        el('span', { class: 'icon mk-error-icon', innerHTML: icon('exclamationmark.triangle') }),
        el('div', { class: 'mk-hint' }, errorMessage),
        el('button', { class: 'mk-retry', onclick: () => loadPlugins() }, '重试'),
      ));
    } else if (!plugins.length) {
      content.append(el('div', { class: 'mk-center', style: { gap: '12px' } },
        el('span', { class: 'icon mk-empty-icon', innerHTML: icon('square.grid.2x2') }),
        el('div', { class: 'mk-hint-lg' }, '暂无可用插件'),
      ));
    } else {
      const list = filteredPlugins();
      if (!list.length) {
        content.append(el('div', { class: 'mk-center' },
          el('div', { class: 'mk-hint-lg' }, '该分类暂无插件'),
        ));
      } else {
        const grid = el('div', { class: `mk-grid${animateNext ? ' enter' : ''}` });
        animateNext = false;
        for (const plugin of list) grid.append(pluginCard(plugin));
        content.append(grid);
      }
    }
  }

  // MARK: - Plugin Card
  function renderBtnContent(btn, plugin) {
    while (btn.firstChild) btn.removeChild(btn.firstChild);
    const installed = !!plugin.installed;
    if (busyIds.has(plugin.id)) {
      // 对应 Swift ProgressView().controlSize(.small)
      btn.append(el('span', {
        class: `spinner${installed ? ' dark' : ''}`,
        style: { width: '14px', height: '14px' },
      }));
    } else {
      btn.append(el('span', {
        class: 'icon',
        innerHTML: icon(installed ? 'trash' : 'plus.circle.fill'),
      }));
    }
    btn.append(installed ? '卸载' : '安装');
  }

  function pluginCard(plugin) {
    const installed = !!plugin.installed;
    const busy = busyIds.has(plugin.id);

    const btn = el('button', {
      class: `mk-btn${installed ? ' installed' : ''}`,
      disabled: busy ? '' : null,
      onclick: () => toggleInstall(plugin, btn),
    });
    renderBtnContent(btn, plugin);

    return el('div', { class: 'mk-card' },
      el('div', { class: 'mk-card-top' },
        // 图标
        el('div', { class: 'mk-icon' },
          el('span', { class: 'icon', innerHTML: icon(plugin.icon || 'puzzlepiece.fill') })),
        // 名称 / 版本 / 分类
        el('div', { class: 'mk-meta' },
          el('div', { class: 'mk-name-row' },
            el('div', { class: 'mk-name', title: plugin.name }, plugin.name),
            plugin.version != null && plugin.version !== ''
              ? el('span', { class: 'mk-version' }, `v${plugin.version}`)
              : null,
          ),
          plugin.category
            ? el('div', { class: 'mk-category' }, plugin.category)
            : null,
        ),
      ),
      plugin.description
        ? el('div', { class: 'mk-desc', title: plugin.description }, plugin.description)
        : null,
      btn,
    );
  }

  // MARK: - Actions
  async function loadPlugins() {
    isLoading = true;
    errorMessage = null;
    renderContent();
    try {
      const dtos = await api.getPlugins();
      plugins = Array.isArray(dtos) ? dtos : [];
    } catch (err) {
      errorMessage = err instanceof APIError ? err.message : (err?.message || '加载失败');
    }
    isLoading = false;
    renderContent();
  }

  async function toggleInstall(plugin, btn) {
    const installed = !!plugin.installed;
    if (busyIds.has(plugin.id)) return;

    let menuId = null;
    if (!installed && plugin.type === 'card') {
      menuId = await pickMenuDialog(plugin);
      if (menuId == null) return;
    }

    busyIds.add(plugin.id);
    btn.disabled = true;
    renderBtnContent(btn, plugin);

    try {
      if (installed) await api.uninstallPlugin(plugin.id);
      else await api.installPlugin(plugin.id, menuId);

      busyIds.delete(plugin.id);
      // 本地翻转已安装态（对应 Swift plugins[idx] 重建）
      const idx = plugins.findIndex((p) => p.id === plugin.id);
      if (idx !== -1) plugins[idx] = { ...plugins[idx], installed: !installed };
      renderContent();
      notifyPluginsChanged();
    } catch {
      // Swift 原版失败时静默恢复按钮
      busyIds.delete(plugin.id);
      renderContent();
    }
  }

  // 卡片型插件安装前选择目标菜单，返回 menuId（取消返回 null）
  function pickMenuDialog(plugin) {
    return new Promise(async (resolve) => {
      let menus = [];
      try {
        const dtos = await api.getMenuList();
        menus = (Array.isArray(dtos) ? dtos : []).filter((d) => !d.pluginKey);
      } catch { /* 加载失败按空菜单处理 */ }

      if (!menus.length) {
        const mask = el('div', { class: 'modal-mask' },
          el('div', { class: 'dlg-modal' },
            el('div', { class: 'dlg-title' }, plugin.name),
            el('div', { class: 'dlg-body' },
              el('div', { class: 'dlg-error', style: { display: 'block' } }, '你还没有普通菜单，请先在侧边栏新建一个菜单再安装')),
            el('div', { class: 'dlg-actions' },
              el('button', { class: 'dlg-btn-ok', type: 'button', onclick: () => { mask.remove(); resolve(null); } }, '知道了'))));
        mask.addEventListener('click', (e) => { if (e.target === mask) { mask.remove(); resolve(null); } });
        document.body.append(mask);
        return;
      }

      const select = el('select', { class: 'field-input dlg-input' },
        ...menus.map((m) => el('option', { value: String(m.id) }, m.title)));
      const cancelBtn = el('button', { class: 'dlg-btn-cancel', type: 'button' }, '取消');
      const okBtn = el('button', { class: 'dlg-btn-ok', type: 'button' }, '安装');
      const mask = el('div', { class: 'modal-mask' },
        el('div', { class: 'dlg-modal' },
          el('div', { class: 'dlg-title' }, `安装「${plugin.name}」`),
          el('div', { class: 'dlg-body' },
            el('div', { class: 'dlg-field' },
              el('label', { class: 'dlg-label' }, '安装到菜单'),
              select)),
          el('div', { class: 'dlg-actions' }, cancelBtn, okBtn)));
      const close = () => { mask.remove(); resolve(null); };
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
      cancelBtn.addEventListener('click', close);
      okBtn.addEventListener('click', () => {
        const id = Number(select.value);
        mask.remove();
        resolve(id > 0 ? id : null);
      });
      document.body.append(mask);
    });
  }

  const root = el('div', { class: 'mk-page' },
    // Header
    el('div', { class: 'mk-header' },
      el('div', { class: 'mk-title' }, '插件市场'),
      el('div', { class: 'mk-subtitle' }, '按需添加好用的功能，安装后即可在侧边栏使用'),
    ),
    el('div', { class: 'mk-divider' }),
    tabsEl,
    content,
  );

  loadPlugins();
  return root;
}
