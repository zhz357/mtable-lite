//
// views/sidebar.js — 左侧窄图标菜单栏：菜单列表 + 拖拽排序 + 右键编辑/删除 + 底部按钮
// （移植自 SidebarView.swift / IconPickerView.swift）
//
import { el, clear } from '../ui.js';
import { icon } from '../icons.js';

// 图标候选（取 icons.js 现有名称，6 列网格）。
// 去重约定：同一概念在小尺寸下难以区分的轮廓/实心变体只保留一种
// （如 folder.fill、house.fill、bell.fill 等与轮廓版几乎一致），实心版仅保留对比明显的
const ICON_CHOICES = [
  // —— 通用 ——
  'house', 'folder', 'star', 'star.fill', 'heart', 'heart.fill', 'bell', 'bookmark',
  'flag', 'flag.fill', 'pin', 'tag', 'sparkles', 'wand.and.stars', 'rocket',
  'puzzlepiece', 'lightbulb', 'eye', 'face.smiling', 'hand.thumbsup.fill', 'hand.raised',
  // —— 文档与效率 ——
  'doc.text', 'note.text', 'book', 'book.pages', 'list', 'checklist', 'calendar',
  'clock', 'alarm', 'timer', 'stopwatch', 'hourglass', 'archivebox', 'tray',
  'rectangle.stack', 'pencil', 'pencil.circle', 'scissors', 'paintbrush', 'magnifyingglass',
  // —— 人物与组织 ——
  'person', 'person.fill', 'person.2', 'person.crop.circle', 'briefcase',
  'building.columns', 'graduationcap', 'trophy', 'medal', 'rosette', 'checkmark.seal', 'gift',
  // —— 商业与财务 ——
  'cart', 'bag', 'creditcard', 'banknote', 'dollarsign.circle.fill',
  'chart.bar', 'chart.pie', 'chart.line.uptrend.xyaxis', 'chart.bar.xaxis',
  'cup.and.saucer', 'fork.knife', 'takeoutbag.and.cup.and.straw', 'birthday.cake',
  // —— 通讯与科技 ——
  'link', 'globe', 'network', 'envelope', 'message', 'bubble.left', 'phone',
  'keyboard', 'printer', 'desktopcomputer', 'laptopcomputer', 'iphone', 'ipad',
  'watch', 'headphones', 'server.rack', 'externaldrive', 'command', 'robot',
  'bolt.fill', 'flame', 'flame.fill', 'moon', 'moon.fill',
  // —— 天气与自然 ——
  'sun.max', 'sun.max.fill', 'cloud', 'cloud.sun', 'cloud.rain', 'cloud.bolt',
  'cloud.snow', 'cloud.fog', 'drop', 'wind', 'thermometer', 'leaf',
  // —— 出行与地图 ——
  'map', 'map.fill', 'mappin', 'location', 'location.fill', 'car', 'airplane',
  'tram', 'bicycle', 'figure.walk', 'figure.run',
  // —— 运动与健康 ——
  'sportscourt', 'soccerball', 'basketball', 'tennis.racket', 'dumbbell',
  'pills', 'cross.case', 'stethoscope',
  // —— 影音与娱乐 ——
  'film', 'music.note', 'music.note.list', 'photo', 'camera', 'mic', 'video',
  'tv', 'gamecontroller',
  // —— 工具与其他 ——
  'hammer', 'lock.shield', 'lock', 'cube', 'arrow.2.circlepath', 'plus.circle.fill',
];

export function SidebarView({ sidebarWrap, menuState, onSettingClick, onMarketplaceClick }) {
  let draggingMenuId = null;
  let draggingEl = null;
  let dialogMask = null;
  let dialogTitle = '';
  let dialogIcon = 'folder';
  let isEditingMenu = false;
  let editingMenuId = null;
  let contextMenu = null;

  // ---------- 渲染 ----------
  const listEl = el('div', { class: 'sidebar-list' });
  const footerEl = el('div', { class: 'sidebar-footer' });
  const sidebarEl = el('div', { class: 'sidebar' },
    listEl,
    el('div', { class: 'sidebar-divider' }),
    footerEl,
  );

  function render() {
    // 菜单列表
    clear(listEl);
    for (const menu of menuState.menus) {
      listEl.append(menuRow(menu));
    }
    // 底部按钮（固定，不随 menus 变化，仅首次构建）
    if (!footerEl.firstChild) {
      footerEl.append(
        footerButton('plus', '添加', openAddMenuDialog),
        footerButton('square.grid.2x2', '插件', () => { if (onMarketplaceClick) onMarketplaceClick(); }),
        footerButton('gear', '设置', () => { if (onSettingClick) onSettingClick(); }),
      );
    }
  }

  function footerButton(iconName, label, onClick) {
    return el('button', { class: 'sidebar-footer-btn', onclick: onClick },
      el('span', { class: 'icon', innerHTML: icon(iconName) }),
      el('span', { class: 'sidebar-footer-label' }, label),
    );
  }

  function menuRow(menu) {
    const isSelected = menuState.selectedMenuId === menu.id;
    const row = el('div', {
      class: `sidebar-item${isSelected ? ' is-selected' : ''}`,
      dataset: { menuId: menu.id },
      draggable: 'true',
    },
      el('div', { class: 'sidebar-item-tile' },
        el('span', { class: 'icon', innerHTML: icon(menu.icon) })),
      el('div', { class: 'sidebar-item-title' }, menu.title),
    );

    // 点击选中
    row.addEventListener('click', () => menuState.select(menu.id));

    // 右键菜单：编辑 / 删除（首页除外，对应 Swift contextMenu 条件）
    row.addEventListener('contextmenu', (e) => {
      if (menu.title === '首页') return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, menu);
    });

    // HTML5 拖拽排序（对应 Swift onDrag / MenuDropDelegate）
    row.addEventListener('dragstart', (e) => {
      draggingMenuId = menu.id;
      draggingEl = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', menu.id);
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!draggingMenuId || draggingMenuId === menu.id || !draggingEl) return;
      const menus = menuState.menus;
      const fromIdx = menus.findIndex((m) => m.id === draggingMenuId);
      const toIdx = menus.findIndex((m) => m.id === menu.id);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      // dropEntered：数组实时移动 + DOM 节点同步移动（不整体重渲染，避免中断拖拽）
      const [moved] = menus.splice(fromIdx, 1);
      menus.splice(toIdx, 0, moved);
      listEl.insertBefore(draggingEl, row);
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      draggingMenuId = null;
      draggingEl = null;
      menuState.reorder(); // 持久化 + 同步后端（main.js MenuState.reorder）
      render();
    });
    row.addEventListener('dragend', () => {
      draggingMenuId = null;
      draggingEl = null;
      render(); // 清除拖拽中的半透明态
    });

    return row;
  }

  // ---------- 右键菜单（Swift .contextMenu） ----------
  function closeContextMenu() {
    if (contextMenu) {
      contextMenu.remove();
      contextMenu = null;
      document.removeEventListener('mousedown', onDocMouseDownForContext, true);
    }
  }
  function onDocMouseDownForContext(e) {
    if (!contextMenu || !contextMenu.contains(e.target)) closeContextMenu();
  }

  function openContextMenu(x, y, menu) {
    closeContextMenu();
    contextMenu = el('div', { class: 'sidebar-context' },
      el('button', {
        class: 'sidebar-context-item',
        onclick: () => { closeContextMenu(); openEditMenuDialog(menu); },
      },
        el('span', { class: 'icon', innerHTML: icon('pencil') }), '编辑菜单'),
      el('button', {
        class: 'sidebar-context-item danger',
        onclick: () => { closeContextMenu(); menuState.requestDelete(menu.id); },
      },
        el('span', { class: 'icon', innerHTML: icon('trash') }), '删除菜单'),
    );
    document.body.append(contextMenu);
    const w = contextMenu.offsetWidth;
    const h = contextMenu.offsetHeight;
    contextMenu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
    document.addEventListener('mousedown', onDocMouseDownForContext, true);
  }

  // ---------- 添加 / 编辑菜单弹窗（Swift .sheet + menuDialog） ----------
  function closeMenuDialog() {
    if (dialogMask) { dialogMask.remove(); dialogMask = null; }
    isEditingMenu = false;
    editingMenuId = null;
    dialogTitle = '';
    dialogIcon = 'folder';
  }

  function openAddMenuDialog() {
    closeMenuDialog();
    isEditingMenu = false;
    editingMenuId = null;
    dialogTitle = '';
    dialogIcon = 'folder';
    showDialog();
  }

  function openEditMenuDialog(menu) {
    closeMenuDialog();
    isEditingMenu = true;
    editingMenuId = menu.id;
    dialogTitle = menu.title;
    dialogIcon = menu.icon;
    showDialog();
  }

  function showDialog() {
    const titleInput = el('input', {
      class: 'field-input sidebar-dialog-input', type: 'text',
      placeholder: '菜单名称', value: dialogTitle,
    });

    const grid = el('div', { class: 'sidebar-icon-grid' });
    function renderGrid() {
      clear(grid);
      for (const name of ICON_CHOICES) {
        grid.append(el('button', {
          class: `sidebar-icon-cell${name === dialogIcon ? ' is-selected' : ''}`,
          title: name,
          onclick: () => { dialogIcon = name; renderGrid(); },
        }, el('span', { class: 'icon', innerHTML: icon(name) })));
      }
    }
    renderGrid();

    const okBtn = el('button', { class: 'sidebar-btn-ok', onclick: submitMenuDialog }, '确定');
    function refreshOk() { okBtn.disabled = !dialogTitle.trim(); }
    titleInput.addEventListener('input', () => { dialogTitle = titleInput.value; refreshOk(); });
    refreshOk();

    dialogMask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === dialogMask) closeMenuDialog(); } },
      el('div', { class: 'sidebar-dialog' },
        el('div', { class: 'sidebar-dialog-title' }, isEditingMenu ? '编辑菜单' : '添加菜单'),
        titleInput,
        el('div', { class: 'sidebar-icon-section' },
          el('div', { class: 'sidebar-icon-section-label' }, '选择图标'),
          el('div', { class: 'sidebar-icon-grid-wrap' }, grid)),
        el('div', { class: 'sidebar-dialog-actions' },
          el('button', { class: 'sidebar-btn-cancel', onclick: closeMenuDialog }, '取消'),
          okBtn),
      ),
    );
    document.getElementById('modal-root').append(dialogMask);
    titleInput.focus();
  }

  function submitMenuDialog() {
    const title = dialogTitle.trim();
    if (!title) return;
    if (isEditingMenu && editingMenuId) menuState.editMenu(editingMenuId, title, dialogIcon);
    else menuState.addMenu(title, dialogIcon);
    closeMenuDialog();
  }

  // ---------- 挂载（menuState 与本视图同生命周期，订阅随视图一起销毁） ----------
  clear(sidebarWrap);
  sidebarWrap.append(sidebarEl);
  menuState.subscribe(render);
  render();
}
