//
// views/cards.js — 卡片网格视图（移植自 CardGridView.swift）
// 文件夹分类浏览 + 卡片网格 + 增改删 + HTML5 拖拽排序
//
import { el, clear, confirmModal, loadingView, toast } from '../ui.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { IconPickerView } from './iconpicker.js';

/** 规范化卡片 URL，缺失 scheme 补 https（对应 FaviconResolver.normalizedURL） */
function normalizeURL(str) {
  const t = (str || '').trim();
  if (!t) return null;
  try {
    return new URL(t.includes('://') ? t : `https://${t}`);
  } catch {
    return null;
  }
}

/** 探测图片地址是否可加载（图片标签加载不受 CORS 限制） */
function probeImage(url, timeout = 6000) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, timeout);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

/** 站点 favicon 候选地址（展示用）：iconUrl 优先，Google 服务与 /favicon.ico 兜底 */
function faviconCandidates(pageURLString, iconUrl) {
  const list = [];
  if (iconUrl) list.push(iconUrl);
  const u = normalizeURL(pageURLString);
  if (u) {
    list.push(`https://www.google.com/s2/favicons?domain=${u.host}&sz=128`);
    list.push(`${u.protocol}//${u.host}/favicon.ico`);
  }
  return list;
}

/** 多级回退解析网址图标，返回可用的图标 URL（对应 FaviconResolver.resolve） */
async function resolveFavicon(pageURLString) {
  const pageURL = normalizeURL(pageURLString);
  if (!pageURL || !pageURL.hostname) return null;
  // 1. 解析页面 HTML 中的 <link rel="icon">（跨域失败时静默跳过）
  try {
    const res = await fetch(pageURL.href, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const links = Array.from(doc.querySelectorAll('link[rel]'))
        .filter((l) => /icon/i.test(l.getAttribute('rel') || '') && (l.getAttribute('href') || '').trim())
        .sort((a, b) =>
          (/apple/i.test(a.getAttribute('rel')) ? 1 : 0) - (/apple/i.test(b.getAttribute('rel')) ? 1 : 0));
      for (const l of links) {
        try {
          const abs = new URL(l.getAttribute('href').trim(), pageURL).href;
          if (await probeImage(abs)) return abs;
        } catch { /* 忽略非法地址 */ }
      }
    }
  } catch { /* 跨域或网络失败，走兜底 */ }
  // 2. 站点根目录 /favicon.ico
  const ico = `${pageURL.protocol}//${pageURL.host}/favicon.ico`;
  if (await probeImage(ico)) return ico;
  // 3. Google favicon 服务兜底
  const google = `https://www.google.com/s2/favicons?domain=${pageURL.host}&sz=128`;
  if (await probeImage(google)) return google;
  return null;
}

/** 网站图标展示（对应 FaviconView）：加载成功替换为图片，全部失败保留 globe */
export function FaviconView(url, iconUrl, size = 40) {
  const box = el('div', { class: 'favicon-box', style: { width: `${size}px`, height: `${size}px` } },
    el('span', {
      class: 'icon',
      style: { width: `${Math.round(size * 0.45)}px`, height: `${Math.round(size * 0.45)}px` },
      innerHTML: icon('globe'),
    }));
  (async () => {
    for (const candidate of faviconCandidates(url, iconUrl)) {
      if (await probeImage(candidate)) {
        if (!box.isConnected) return; // 视图已重绘，丢弃过期结果
        clear(box).append(el('img', {
          src: candidate, alt: '',
          style: { width: '100%', height: '100%', objectFit: 'contain', padding: '6px' },
        }));
        return;
      }
    }
  })();
  return box;
}

function normalizeCard(dto) {
  return {
    id: dto.id,
    menuId: dto.menuId ?? null,
    folderId: dto.folderId ?? null,
    title: dto.title,
    description: dto.description ?? null,
    url: dto.url,
    iconUrl: dto.iconUrl ?? null,
    createTime: dto.createTime ?? null,
  };
}

/** 创建时间展示：后端返回 ISO（2026-10-13T10:24:19）→ 2026-10-13 10:24 */
function formatCreateTime(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : String(iso);
}

export function CardsView({ menuId, menuTitle, menus, onOpenURL }) {
  // ---- 状态（对应 @State）----
  let folders = [];
  let cards = [];
  let isLoading = false;
  let loadError = null;
  const folderStack = []; // 导航栈：当前所在文件夹路径
  let draggingCardId = null;

  const isRoot = () => folderStack.length === 0;
  const currentFolder = () => folderStack[folderStack.length - 1] || null;

  // ---- 右键菜单（对应 contextMenu）----
  let ctxMenu = null;
  function closeCtxMenu() {
    if (!ctxMenu) return;
    ctxMenu.remove();
    ctxMenu = null;
    document.removeEventListener('click', closeCtxMenu);
    document.removeEventListener('contextmenu', closeCtxMenu);
    document.removeEventListener('scroll', closeCtxMenu, true);
  }
  function showContextMenu(e, items) {
    e.preventDefault();
    closeCtxMenu();
    ctxMenu = el('div', { class: 'ctx-menu' },
      items.map((it) => [
        it.divider ? el('div', { class: 'ctx-divider' }) : null,
        el('button', {
          class: `ctx-item${it.danger ? ' danger' : ''}`,
          type: 'button',
          onclick: () => { closeCtxMenu(); it.action(); },
        }, it.label),
      ]),
    );
    document.body.append(ctxMenu);
    const rect = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - rect.width - 8)}px`;
    ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - rect.height - 8)}px`;
    setTimeout(() => {
      document.addEventListener('click', closeCtxMenu);
      document.addEventListener('contextmenu', closeCtxMenu);
      document.addEventListener('scroll', closeCtxMenu, true);
    });
  }

  // ---- 视图骨架 ----
  const headerWrap = el('div', { class: 'cards-header' });
  const contentWrap = el('div', { class: 'cards-content' });
  const root = el('div', { class: 'cards-root' }, headerWrap, contentWrap);

  function render() {
    renderHeader();
    renderContent();
  }

  function renderHeader() {
    clear(headerWrap);
    // 面包屑导航
    const crumbs = el('div', { class: 'crumbs' },
      el('button', {
        class: `crumb-link${isRoot() ? ' active' : ''}`,
        type: 'button',
        onclick: navigateToRoot,
      }, menuTitle),
    );
    folderStack.forEach((folder, index) => {
      crumbs.append(el('span', { class: 'icon crumb-sep', innerHTML: icon('chevron.right') }));
      if (index === folderStack.length - 1) {
        crumbs.append(el('span', { class: 'crumb-current' }, folder.title));
      } else {
        crumbs.append(el('button', {
          class: 'crumb-link', type: 'button',
          onclick: () => navigateToFolder(index),
        }, folder.title));
      }
    });
    // 标题 + 操作按钮
    const subtitle = isRoot()
      ? `${folders.length} 个文件夹，${cards.length} 个卡片`
      : `${cards.length} 个卡片`;
    headerWrap.append(
      crumbs,
      el('div', { class: 'cards-title-row' },
        el('div', {},
          el('div', { class: 'cards-title' }, currentFolder()?.title ?? menuTitle),
          el('div', { class: 'cards-count' }, subtitle),
        ),
        el('div', { class: 'cards-actions' },
          el('button', { class: 'btn-add-folder', type: 'button', onclick: () => openFolderDialog(null) },
            el('span', { class: 'icon btn-add-folder-icon', innerHTML: icon('folder.badge.plus') }),
            '新建文件夹'),
          el('button', { class: 'btn-add-card', type: 'button', onclick: openAddCardDialog },
            el('span', { class: 'icon btn-add-card-icon', innerHTML: icon('plus.circle.fill') }),
            '添加卡片'),
        ),
      ),
    );
  }

  function renderContent() {
    const prevScroll = contentWrap.querySelector('.cards-scroll');
    const scrollTop = prevScroll ? prevScroll.scrollTop : 0;
    clear(contentWrap);

    if (isLoading && cards.length === 0 && folders.length === 0) {
      contentWrap.append(loadingView('加载中...'));
      return;
    }
    if (loadError) {
      contentWrap.append(el('div', { class: 'cards-state' },
        el('span', { class: 'icon cards-state-icon error', innerHTML: icon('exclamationmark.triangle') }),
        el('div', { class: 'cards-state-title' }, loadError),
        el('button', { class: 'btn-retry', type: 'button', onclick: loadData }, '重试'),
      ));
      return;
    }
    if (isRoot() && folders.length === 0 && cards.length === 0) {
      contentWrap.append(el('div', { class: 'cards-state' },
        el('span', { class: 'icon cards-state-icon', innerHTML: icon('folder.badge.plus') }),
        el('div', { class: 'cards-state-title' }, '还没有内容'),
        el('div', { class: 'cards-state-sub' }, '点击右上角"新建文件夹"或"添加卡片"来开始'),
      ));
      return;
    }

    const scroll = el('div', { class: 'cards-scroll' });
    if (isRoot() && folders.length) scroll.append(folderSection());
    if (cards.length) scroll.append(cardSection());
    else if (!isRoot()) scroll.append(emptyFolderView());
    contentWrap.append(scroll);
    scroll.scrollTop = scrollTop;
  }

  function folderSection() {
    return el('div', { class: 'cards-section' },
      el('div', { class: 'cards-section-title' }, '文件夹'),
      el('div', { class: 'cards-grid' }, folders.map(FolderItem)),
    );
  }

  function cardSection() {
    return el('div', { class: 'cards-section' },
      isRoot() && folders.length ? el('div', { class: 'cards-section-title' }, '卡片') : null,
      el('div', { class: 'cards-grid card-grid' }, cards.map(CardItem)),
    );
  }

  function emptyFolderView() {
    return el('div', { class: 'cards-state in-scroll' },
      el('span', { class: 'icon cards-state-icon', innerHTML: icon('rectangle.stack.badge.plus') }),
      el('div', { class: 'cards-state-title' }, '该文件夹下还没有卡片'),
      el('div', { class: 'cards-state-sub' }, '点击右上角"添加卡片"来开始'),
    );
  }

  // ---- FolderItem ----
  function FolderItem(folder) {
    const node = el('div', { class: 'folder-card' },
      el('div', { class: 'folder-top' },
        el('span', { class: 'icon folder-icon', innerHTML: icon(folder.icon) }),
        el('span', { class: 'icon folder-chev', innerHTML: icon('chevron.right') }),
      ),
      el('div', { class: 'folder-title' }, folder.title),
      el('div', { class: 'folder-count' }, `${folder.cardCount} 个卡片`),
    );
    node.addEventListener('click', () => enterFolder(folder));
    node.addEventListener('contextmenu', (e) => showContextMenu(e, [
      { label: '打开文件夹', action: () => enterFolder(folder) },
      { label: '编辑文件夹', action: () => openFolderDialog(folder) },
      { divider: true },
      { label: '删除文件夹', danger: true, action: () => confirmDeleteFolder(folder) },
    ]));
    return node;
  }

  // ---- CardItem（含拖拽排序）----
  function CardItem(card) {
    // 所属菜单名：按 menuId 从菜单列表反查，查不到时回退当前菜单标题
    const menuName = menus.find((m) => m.serverId === card.menuId)?.title ?? menuTitle;
    const createdText = formatCreateTime(card.createTime);
    const node = el('div', {
      class: `card-card${draggingCardId === card.id ? ' dragging' : ''}`,
      draggable: 'true',
      dataset: { cardId: String(card.id) },
    },
      // 左列：图标 + 下方所属菜单
      el('div', { class: 'card-logo' },
        FaviconView(card.url, card.iconUrl, 40),
        el('div', { class: 'card-menu', title: `所属菜单：${menuName}` }, menuName),
      ),
      el('div', { class: 'card-info' },
        el('div', { class: 'card-title' }, card.title),
        card.description ? el('div', { class: 'card-desc' }, card.description) : null,
        createdText
          ? el('div', { class: 'card-meta', title: '创建时间' },
            el('span', { class: 'icon card-meta-icon', innerHTML: icon('clock') }),
            createdText)
          : null,
      ),
    );
    const openURL = () => { if (normalizeURL(card.url)) onOpenURL(card.url); };
    node.addEventListener('click', openURL);
    node.addEventListener('contextmenu', (e) => showContextMenu(e, [
      { label: '打开网址', action: openURL },
      { label: '编辑卡片', action: () => openCardDialog(card) },
      { label: '移动到...', action: () => openMoveCardDialog(card) },
      { divider: true },
      { label: '删除卡片', danger: true, action: () => deleteCard(card) },
    ]));
    // HTML5 拖拽排序（对应 onDrag / CardDropDelegate）
    node.addEventListener('dragstart', (e) => {
      draggingCardId = card.id;
      node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(card.id));
    });
    node.addEventListener('dragend', () => { node.classList.remove('dragging'); });
    node.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    node.addEventListener('dragenter', () => {
      // 对应 dropEntered：拖到目标卡片上方时实时交换位置
      if (draggingCardId == null || draggingCardId === card.id) return;
      const fromIndex = cards.findIndex((c) => c.id === draggingCardId);
      const toIndex = cards.findIndex((c) => c.id === card.id);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = cards.splice(fromIndex, 1);
      cards.splice(toIndex, 0, moved);
      renderCardsGrid();
    });
    node.addEventListener('drop', (e) => {
      // 对应 performDrop：结束拖拽并持久化顺序
      e.preventDefault();
      if (draggingCardId == null) return;
      draggingCardId = null;
      persistCardOrder();
    });
    return node;
  }

  /** 拖拽交换后仅重绘卡片网格（保留滚动位置） */
  function renderCardsGrid() {
    const grid = contentWrap.querySelector('.card-grid');
    if (!grid) return;
    clear(grid);
    cards.forEach((c) => grid.append(CardItem(c)));
  }

  // ---- 导航 ----
  function enterFolder(folder) { folderStack.push(folder); loadCards(); }
  function navigateToRoot() { folderStack.length = 0; loadData(); }
  function navigateToFolder(index) { folderStack.splice(index + 1); loadCards(); }

  // ---- 数据加载 ----
  async function loadData() {
    isLoading = true;
    loadError = null;
    render();
    try {
      const [folderDTOs, cardDTOs] = await Promise.all([
        api.getFolderList(menuId),
        api.getCardList(menuId),
      ]);
      folders = folderDTOs.map((d) => ({
        id: d.id, title: d.title, icon: d.icon || 'folder.fill', cardCount: d.cardCount ?? 0,
      }));
      cards = cardDTOs.map(normalizeCard);
      isLoading = false;
    } catch (err) {
      loadError = err?.message || '加载失败，请稍后重试';
      isLoading = false;
    }
    render();
  }

  async function loadCards() {
    isLoading = true;
    loadError = null;
    render();
    try {
      const dtos = await api.getCardList(menuId, currentFolder()?.id ?? null);
      cards = dtos.map(normalizeCard);
      isLoading = false;
    } catch (err) {
      loadError = err?.message || '加载失败，请稍后重试';
      isLoading = false;
    }
    render();
  }

  // ---- 卡片操作 ----
  function deleteCard(card) {
    api.deleteCard(menuId, card.id)
      .then(() => { cards = cards.filter((c) => c.id !== card.id); render(); })
      .catch(() => { /* 删除失败静默处理 */ });
  }

  function persistCardOrder() {
    const cardIds = cards.map((c) => c.id);
    if (!cardIds.length) return;
    api.reorderCards(cardIds).catch(() => {});
  }

  /** 右键"移动到..."：弹出目标菜单选择对话框并执行跨菜单移动 */
  function openMoveCardDialog(card) {
    const targets = menus
      .filter((m) => m.serverId != null && m.serverId !== menuId)
      .map((m) => ({ id: m.serverId, title: m.title }));
    if (!targets.length) {
      toast('暂无其他菜单可移动');
      return;
    }
    MoveCardDialog({
      card,
      targets,
      async onConfirm(target) {
        await api.moveCard(menuId, card.id, target.id);
        // 前端状态即时更新：从当前列表移除该卡片（无需刷新页面）
        cards = cards.filter((c) => c.id !== card.id);
        render();
        toast(`已移动到「${target.title}」`, 'success');
      },
    });
  }

  function openAddCardDialog() {
    openCardDialog(null);
  }

  function openCardDialog(card) {
    CardDialog({
      menuId, menus,
      folderId: currentFolder()?.id ?? null,
      editingCard: card,
      onSuccess(updated) {
        if (card) {
          if (updated.menuId === menuId) {
            const index = cards.findIndex((c) => c.id === updated.id);
            if (index >= 0) cards[index] = updated;
          } else {
            // 卡片被移动到其它菜单，从当前列表移除
            cards = cards.filter((c) => c.id !== updated.id);
          }
        } else {
          cards.push(updated);
        }
        render();
      },
    });
  }

  // ---- 文件夹操作 ----
  async function confirmDeleteFolder(folder) {
    let target = { ...folder };
    try {
      // 先查询文件夹下的卡片数量（对应 confirmDeleteFolder）
      const list = await api.getCardList(menuId, folder.id);
      target.cardCount = list.length;
    } catch { /* 查询失败，按已知数量提示 */ }
    const ok = await confirmModal({
      title: '确认删除文件夹',
      message: `文件夹「${target.title}」下有 ${target.cardCount} 个卡片，删除文件夹将同时删除其下所有卡片，且不可恢复。确定要删除吗？`,
      confirmText: '确认删除',
      cancelText: '取消',
      danger: true,
    });
    if (ok) {
      api.deleteFolder(menuId, target.id)
        .then(() => { folders = folders.filter((f) => f.id !== target.id); render(); })
        .catch(() => {});
    }
  }

  function openFolderDialog(editingFolder) {
    FolderDialog({
      menuId, menus,
      editingFolder,
      onSuccess(folder) {
        if (editingFolder) {
          const index = folders.findIndex((f) => f.id === folder.id);
          if (index >= 0) folders[index] = folder;
        } else {
          folders.push(folder);
        }
        render();
      },
    });
  }

  loadData();
  return root;
}

// ============================================================
// 卡片弹窗（对应 CardDialog sheet，模块级导出供首页「新增内容」复用）
// allowMenuChoice：添加模式下展示「所属菜单」选择（首页入口没有当前菜单上下文）
// ============================================================
export function CardDialog({ menuId, menus, folderId = null, editingCard = null, allowMenuChoice = false, onSuccess }) {
  const isEditing = !!editingCard;
  let iconUrlText = editingCard?.iconUrl || '';
  let isFetchingIcon = false;
  let isSubmitting = false;

  const menuOptions = menus
    .filter((m) => m.serverId != null)
    .map((m) => ({ id: m.serverId, title: m.title }));

  // 所属菜单（编辑时可重新选择；首页快捷添加时选择目标菜单）
  let menuRow = null;
  let menuSelect = null;
  if (isEditing || (allowMenuChoice && menuOptions.length)) {
    menuSelect = el('select', { class: 'field-input dlg-input' },
      menuOptions.map((o) => el('option', { value: String(o.id) }, o.title)));
    menuSelect.value = String(menuId);
    if (!menuSelect.value && menuOptions.length) menuSelect.value = String(menuOptions[0].id);
    menuRow = el('div', { class: 'dlg-field' },
      el('label', { class: 'dlg-label' }, '所属菜单'),
      menuSelect);
  }

  const urlInput = el('input', {
    class: 'field-input dlg-input', type: 'text',
    placeholder: 'https://example.com', value: editingCard?.url || '',
  });
  const fetchBtn = el('button', { class: 'btn-fetch-icon', type: 'button' }, '获取图标');
  const urlRow = el('div', { class: 'dlg-input-row' }, urlInput, fetchBtn);

  // 图标预览（仅图标，不显示地址）
  const iconPreview = el('div', { class: 'dlg-icon-preview' },
    el('span', { class: 'icon', style: { width: '18px', height: '18px' }, innerHTML: icon('globe') }));
  function showPreviewImage(src) {
    clear(iconPreview).append(el('img', { src, alt: '' }));
  }
  function showPreviewGlobe() {
    clear(iconPreview).append(el('span', {
      class: 'icon', style: { width: '18px', height: '18px' }, innerHTML: icon('globe'),
    }));
  }
  async function loadPreview() {
    const candidates = faviconCandidates(urlInput.value, iconUrlText);
    for (const candidate of candidates) {
      if (await probeImage(candidate)) { showPreviewImage(candidate); return; }
    }
    showPreviewGlobe();
  }

  const titleInput = el('input', {
    class: 'field-input dlg-input', type: 'text',
    placeholder: '卡片名称', value: editingCard?.title || '',
  });
  const descInput = el('textarea', { class: 'field-input dlg-input dlg-textarea', placeholder: '简短描述', rows: '3' });
  descInput.value = editingCard?.description || '';

  const errorText = el('div', { class: 'dlg-error', style: { display: 'none' } });
  const cancelBtn = el('button', { class: 'dlg-btn-cancel', type: 'button' }, '取消');
  const okBtn = el('button', { class: 'dlg-btn-ok', type: 'button' }, '确定');

  function syncButtons() {
    const empty = !titleInput.value.trim() || !urlInput.value.trim();
    okBtn.disabled = empty || isSubmitting;
    clear(okBtn);
    if (isSubmitting) okBtn.append(el('span', { class: 'spinner' }));
    else okBtn.append('确定');
  }

  // 输入网址时自动填充名称（对应 autoFillTitle）
  urlInput.addEventListener('input', () => {
    if (titleInput.value) return;
    const u = normalizeURL(urlInput.value);
    if (u && u.host) titleInput.value = u.host.replace(/^www\./, '');
    syncButtons();
  });
  titleInput.addEventListener('input', syncButtons);

  // 点击"获取图标"：解析当前网址图标，成功后缓存 URL 供提交时持久化
  fetchBtn.addEventListener('click', async () => {
    const current = urlInput.value.trim();
    if (!current || isFetchingIcon) return;
    isFetchingIcon = true;
    fetchBtn.disabled = true;
    clear(fetchBtn).append(el('span', { class: 'spinner dark' }));
    const resolved = await resolveFavicon(current);
    isFetchingIcon = false;
    fetchBtn.disabled = false;
    clear(fetchBtn).append('获取图标');
    iconUrlText = resolved || '';
    if (resolved) showPreviewImage(resolved);
    else showPreviewGlobe();
  });

  const mask = el('div', {
    class: 'modal-mask',
    onclick: (e) => { if (e.target === mask) close(); },
  },
    el('div', { class: 'dlg-modal' },
      el('div', { class: 'dlg-title' }, isEditing ? '编辑卡片' : '添加卡片'),
      el('div', { class: 'dlg-body' },
        menuRow,
        el('div', { class: 'dlg-field' },
          el('label', { class: 'dlg-label' }, '网址'),
          urlRow),
        el('div', { class: 'dlg-field' },
          el('label', { class: 'dlg-label' }, '图标'),
          iconPreview),
        el('div', { class: 'dlg-field' },
          el('label', { class: 'dlg-label' }, '名称'),
          titleInput),
        el('div', { class: 'dlg-field' },
          el('label', { class: 'dlg-label' }, '描述（可选）'),
          descInput),
      ),
      errorText,
      el('div', { class: 'dlg-actions' }, cancelBtn, okBtn),
    ),
  );

  function close() { mask.remove(); }
  cancelBtn.addEventListener('click', close);

  okBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    if (!title || !url || isSubmitting) return;
    isSubmitting = true;
    errorText.style.display = 'none';
    syncButtons();
    let finalURL = url;
    if (!finalURL.startsWith('http://') && !finalURL.startsWith('https://')) {
      finalURL = `https://${finalURL}`;
    }
    const description = descInput.value.trim();
    const finalIconUrl = iconUrlText || null;
    try {
      if (isEditing) {
        const targetMenuId = Number(menuSelect.value);
        const targetFolderId = targetMenuId === menuId ? folderId : null;
        await api.updateCard(targetMenuId, editingCard.id, {
          title,
          description: description || null,
          url: finalURL,
          iconUrl: finalIconUrl,
          folderId: targetFolderId,
          menuId: targetMenuId,
        });
        close();
        onSuccess({
          ...editingCard,
          menuId: targetMenuId,
          folderId: targetFolderId,
          title,
          description: description || null,
          url: finalURL,
          iconUrl: finalIconUrl,
        });
      } else {
        const targetMenuId = (allowMenuChoice && menuSelect) ? Number(menuSelect.value) : menuId;
        const dto = await api.addCard(targetMenuId, {
          title,
          description: description || null,
          url: finalURL,
          iconUrl: finalIconUrl,
          folderId,
        });
        close();
        onSuccess(normalizeCard(dto), targetMenuId);
      }
    } catch (err) {
      isSubmitting = false;
      syncButtons();
      errorText.textContent = err?.message || '操作失败，请稍后重试';
      errorText.style.display = '';
    }
  });

  document.getElementById('modal-root').append(mask);
  syncButtons();
  loadPreview(); // 编辑时回显已保存图标 / 新增时按网址尝试展示
}

// ============================================================
// 移动卡片弹窗：选择目标菜单（卡片右键"移动到..."入口）
// onConfirm(target) 由调用方执行移动；成功后关闭弹窗，失败在弹窗内展示错误并可重试
// ============================================================
export function MoveCardDialog({ card, targets, onConfirm }) {
  let selectedId = targets[0]?.id ?? null;
  let isSubmitting = false;

  const errorText = el('div', { class: 'dlg-error', style: { display: 'none' } });
  const cancelBtn = el('button', { class: 'dlg-btn-cancel', type: 'button' }, '取消');
  const okBtn = el('button', { class: 'dlg-btn-ok', type: 'button' }, '移动');

  function syncButtons() {
    okBtn.disabled = selectedId == null || isSubmitting;
    clear(okBtn);
    if (isSubmitting) okBtn.append(el('span', { class: 'spinner' }));
    else okBtn.append('移动');
  }

  const listWrap = el('div', { class: 'move-menu-list' });
  function renderList() {
    clear(listWrap);
    targets.forEach((t) => {
      const selected = t.id === selectedId;
      listWrap.append(el('button', {
        class: `move-menu-item${selected ? ' selected' : ''}`,
        type: 'button',
        onclick: () => { selectedId = t.id; renderList(); syncButtons(); },
      },
        el('span', { class: 'icon move-menu-icon', innerHTML: icon('folder') }),
        el('span', { class: 'move-menu-name' }, t.title),
        el('span', { class: 'icon move-menu-check', innerHTML: selected ? icon('checkmark') : '' }),
      ));
    });
  }
  renderList();

  const mask = el('div', {
    class: 'modal-mask',
    onclick: (e) => { if (e.target === mask) close(); },
  },
    el('div', { class: 'dlg-modal' },
      el('div', { class: 'dlg-title' }, '移动到...'),
      el('div', { class: 'dlg-body' },
        el('div', { class: 'move-card-hint' },
          '将卡片「', el('span', { class: 'move-card-title' }, card.title), '」移动到：'),
        listWrap,
      ),
      errorText,
      el('div', { class: 'dlg-actions' }, cancelBtn, okBtn),
    ),
  );

  function close() { mask.remove(); }
  cancelBtn.addEventListener('click', close);

  okBtn.addEventListener('click', async () => {
    const target = targets.find((t) => t.id === selectedId);
    if (!target || isSubmitting) return;
    isSubmitting = true;
    errorText.style.display = 'none';
    syncButtons();
    try {
      await onConfirm(target);
      close();
    } catch (err) {
      isSubmitting = false;
      syncButtons();
      errorText.textContent = err?.message || '移动失败，请稍后重试';
      errorText.style.display = '';
    }
  });

  document.getElementById('modal-root').append(mask);
  syncButtons();
}

// ============================================================
// 文件夹弹窗（对应 FolderDialog sheet，模块级导出供首页「新增内容」复用）
// ============================================================
export function FolderDialog({ menuId, menus, editingFolder = null, allowMenuChoice = false, onSuccess }) {
  const isEditing = !!editingFolder;
  let iconText = editingFolder?.icon || 'folder.fill';
  let isSubmitting = false;

  // 首页快捷添加时选择目标菜单
  const menuOptions = (menus || [])
    .filter((m) => m.serverId != null)
    .map((m) => ({ id: m.serverId, title: m.title }));
  let menuRow = null;
  let menuSelect = null;
  if (allowMenuChoice && menuOptions.length) {
    menuSelect = el('select', { class: 'field-input dlg-input' },
      menuOptions.map((o) => el('option', { value: String(o.id) }, o.title)));
    menuSelect.value = String(menuId);
    if (!menuSelect.value) menuSelect.value = String(menuOptions[0].id);
    menuRow = el('div', { class: 'dlg-field' },
      el('label', { class: 'dlg-label' }, '所属菜单'),
      menuSelect);
  }

  const titleInput = el('input', {
    class: 'field-input dlg-input', type: 'text',
    placeholder: '例如：SpringBoot', value: editingFolder?.title || '',
  });

  // 图标预览 + 名称输入（照 Swift 手输 SF Symbol 名称），点击预览可展开选择器
  const iconPreviewBtn = el('button', { class: 'dlg-folder-icon', type: 'button', title: '点击选择图标' },
    el('span', { class: 'icon', style: { width: '22px', height: '22px' } }));
  function renderIconPreview() {
    iconPreviewBtn.firstChild.innerHTML = icon(iconText.trim() || 'folder.fill');
  }
  renderIconPreview();

  const iconInput = el('input', {
    class: 'field-input dlg-input', type: 'text', placeholder: 'folder.fill', value: iconText,
  });
  iconInput.addEventListener('input', () => {
    iconText = iconInput.value;
    renderIconPreview();
  });

  let pickerWrap = null;
  let pickerOpen = false;
  function closePicker() {
    if (pickerWrap) { pickerWrap.remove(); pickerWrap = null; pickerOpen = false; }
  }
  function togglePicker() {
    if (pickerOpen) { closePicker(); return; }
    pickerWrap = el('div', { class: 'dlg-picker-wrap' });
    pickerWrap.append(IconPickerView({
      selected: iconText,
      onSelect(name) {
        iconText = name;
        iconInput.value = name;
        renderIconPreview();
      },
      onClose: closePicker,
    }));
    fields.append(pickerWrap);
    pickerOpen = true;
  }
  iconPreviewBtn.addEventListener('click', togglePicker);

  const errorText = el('div', { class: 'dlg-error', style: { display: 'none' } });
  const cancelBtn = el('button', { class: 'dlg-btn-cancel', type: 'button' }, '取消');
  const okBtn = el('button', { class: 'dlg-btn-ok', type: 'button' }, '确定');

  function syncButtons() {
    okBtn.disabled = !titleInput.value.trim() || isSubmitting;
    clear(okBtn);
    if (isSubmitting) okBtn.append(el('span', { class: 'spinner' }));
    else okBtn.append('确定');
  }
  titleInput.addEventListener('input', syncButtons);

  const fields = el('div', { class: 'dlg-body' },
    menuRow,
    el('div', { class: 'dlg-field' },
      el('label', { class: 'dlg-label' }, '文件夹名称'),
      titleInput),
    el('div', { class: 'dlg-field' },
      el('label', { class: 'dlg-label' }, '图标（SF Symbol 名称）'),
      el('div', { class: 'dlg-input-row' }, iconPreviewBtn, iconInput)),
  );

  const mask = el('div', {
    class: 'modal-mask',
    onclick: (e) => { if (e.target === mask) close(); },
  },
    el('div', { class: 'dlg-modal' },
      el('div', { class: 'dlg-title' }, isEditing ? '编辑文件夹' : '新建文件夹'),
      fields,
      errorText,
      el('div', { class: 'dlg-actions' }, cancelBtn, okBtn),
    ),
  );

  function close() { closePicker(); mask.remove(); }
  cancelBtn.addEventListener('click', close);

  okBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const finalIcon = iconText.trim() || 'folder.fill';
    if (!title || isSubmitting) return;
    isSubmitting = true;
    errorText.style.display = 'none';
    syncButtons();
    try {
      if (isEditing) {
        await api.updateFolder(menuId, editingFolder.id, title, finalIcon);
        close();
        onSuccess({ ...editingFolder, title, icon: finalIcon });
      } else {
        const targetMenuId = (allowMenuChoice && menuSelect) ? Number(menuSelect.value) : menuId;
        const dto = await api.addFolder(targetMenuId, title, finalIcon);
        close();
        onSuccess({
          id: dto.id, title: dto.title, icon: dto.icon || 'folder.fill', cardCount: dto.cardCount ?? 0,
        }, targetMenuId);
      }
    } catch (err) {
      isSubmitting = false;
      syncButtons();
      errorText.textContent = err?.message || '操作失败，请稍后重试';
      errorText.style.display = '';
    }
  });

  document.getElementById('modal-root').append(mask);
  syncButtons();
  titleInput.focus();
}
