//
// views/roadmap.js — 学习路线插件（移植自 LearningRoadmapView.swift）
// 结构：左侧路线列表（280px）+ 右侧待办详情；待办可折叠出备注列表，逐层下钻
//
import { el, clear, toast, confirmModal } from '../ui.js';
import { api } from '../api.js';
import { icon } from '../icons.js';

// 备注创建时间格式化（createTime 为后端 LocalDateTime 的 ISO 字符串）
function fmtNoteTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 右键菜单（对应 SwiftUI contextMenu） ----------
let closeOpenMenu = null;

function closeContextMenu() {
  if (closeOpenMenu) { closeOpenMenu(); closeOpenMenu = null; }
}

function openContextMenu(event, items) {
  closeContextMenu();
  const menu = el('div', { class: 'roadmap-context-menu' },
    items.map((item) => item == null
      ? el('div', { class: 'roadmap-context-sep' })
      : el('button', {
          class: `roadmap-context-item${item.danger ? ' danger' : ''}`,
          onclick: () => { closeContextMenu(); item.action(); },
        }, item.label)));
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const x = Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8));
  const y = Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const onDocDown = (e) => { if (!menu.contains(e.target)) closeContextMenu(); };
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true));
  closeOpenMenu = () => {
    menu.remove();
    document.removeEventListener('mousedown', onDocDown, true);
  };
}

// ---------- 通用表单弹窗（对应 RouteDialog / TodoDialog / NoteDialog） ----------
function openFormDialog({ title, fields, canSubmit, onSubmit }) {
  const inputs = {};
  let submitting = false;

  const errorText = el('div', { class: 'roadmap-dialog-error', style: { display: 'none' } });
  const submitBtn = el('button', { class: 'roadmap-dialog-submit' }, '确定');

  function refresh() {
    submitBtn.disabled = submitting || !canSubmit(inputs);
  }
  function setError(msg) {
    if (msg) { errorText.textContent = msg; errorText.style.display = 'block'; }
    else errorText.style.display = 'none';
  }
  function close() { mask.remove(); }
  async function submit() {
    if (submitBtn.disabled) return;
    submitting = true;
    setError(null);
    clear(submitBtn);
    submitBtn.append(el('span', { class: 'spinner' }));
    refresh();
    try {
      await onSubmit(inputs);
      close();
    } catch (err) {
      submitting = false;
      clear(submitBtn);
      submitBtn.append('确定');
      setError(err?.message || '操作失败，请稍后重试');
      refresh();
    }
  }

  submitBtn.addEventListener('click', submit);

  const fieldNodes = fields.map((f, i) => {
    const input = f.multiline
      ? el('textarea', { class: 'roadmap-dialog-input', rows: String(f.rows || 3), placeholder: f.placeholder || '' })
      : el('input', { class: 'roadmap-dialog-input', placeholder: f.placeholder || '' });
    input.value = f.value || '';
    inputs[f.key] = input;
    input.addEventListener('input', refresh);
    if (!f.multiline) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && i === 0) submit(); });
    }
    return el('div', { class: 'roadmap-dialog-field' },
      el('label', { class: 'roadmap-dialog-label' }, f.label),
      input);
  });

  const mask = el('div', {
    class: 'modal-mask',
    onclick: (e) => { if (e.target === mask) close(); },
  },
    el('div', { class: 'roadmap-dialog' },
      el('h3', {}, title),
      el('div', { class: 'roadmap-dialog-body' }, fieldNodes),
      errorText,
      el('div', { class: 'roadmap-dialog-actions' },
        el('button', { class: 'roadmap-dialog-cancel', onclick: close }, '取消'),
        submitBtn)));

  document.getElementById('modal-root').append(mask);
  refresh();
  inputs[fields[0].key].focus();
}

// ---------- 视图 ----------
export function RoadmapView() {
  // 状态
  let routes = [];
  let selectedRouteId = null;
  let todos = [];
  const notesByTodo = new Map();          // todoId -> [{ id, content, isCompleted }]
  const expandedTodoIds = new Set();
  const loadingNotesTodoIds = new Set();
  let isLoadingRoutes = false;
  let isLoadingTodos = false;

  // 骨架
  const sidebar = el('div', { class: 'roadmap-sidebar' });
  const detail = el('div', { class: 'roadmap-detail' });
  const root = el('div', { class: 'roadmap-root' },
    sidebar,
    el('div', { class: 'roadmap-divider' }),
    detail);

  function progressPct(route) {
    return route.todoCount > 0 ? (route.completedCount / route.todoCount) * 100 : 0;
  }

  // ---------- 渲染：路线侧边栏 ----------
  function renderSidebar() {
    clear(sidebar);
    sidebar.append(
      el('div', { class: 'roadmap-sidebar-header' },
        el('div', { class: 'roadmap-sidebar-title' }, '学习路线'),
        el('button', {
          class: 'roadmap-add-route-btn', title: '新建学习路线',
          onclick: openAddRouteDialog,
        }, el('span', { class: 'icon', style: { width: '18px', height: '18px' }, innerHTML: icon('plus.circle.fill') }))),
      el('div', { class: 'roadmap-sidebar-sep' }));

    const list = el('div', { class: 'roadmap-route-list' });
    if (!routes.length && !isLoadingRoutes) {
      list.append(el('div', { class: 'roadmap-empty-routes' }, '还没有学习路线', el('br'), '点击右上角 + 新建'));
    } else {
      routes.forEach((r) => list.append(routeRow(r)));
    }
    sidebar.append(list);
  }

  function routeRow(route) {
    const selected = route.id === selectedRouteId;
    return el('div', {
      class: `roadmap-route-row${selected ? ' selected' : ''}`,
      onclick: () => selectRoute(route),
      oncontextmenu: (e) => {
        e.preventDefault();
        openContextMenu(e, [
          { label: '编辑路线', action: () => openEditRouteDialog(route) },
          null,
          { label: '删除路线', danger: true, action: () => confirmDeleteRoute(route) },
        ]);
      },
    },
      el('div', { class: 'roadmap-route-row-top' },
        el('div', { class: 'roadmap-route-title' }, route.title),
        el('div', { class: 'roadmap-route-progress-text' }, `${route.completedCount}/${route.todoCount}`)),
      el('div', { class: 'roadmap-progress-track' },
        el('div', { class: 'roadmap-progress-fill', style: { width: `${progressPct(route)}%` } })));
  }

  // ---------- 渲染：待办详情 ----------
  function renderDetail() {
    clear(detail);
    const route = routes.find((r) => r.id === selectedRouteId);
    if (!route) {
      detail.append(el('div', { class: 'roadmap-detail-placeholder' },
        el('span', { class: 'icon', style: { width: '48px', height: '48px', color: 'var(--text-4)' }, innerHTML: icon('graduationcap') }),
        el('div', {}, '请选择或新建一条学习路线')));
      return;
    }

    detail.append(
      el('div', { class: 'roadmap-detail-header' },
        el('div', { class: 'roadmap-detail-header-top' },
          el('div', { class: 'roadmap-detail-header-titles' },
            el('div', { class: 'roadmap-detail-title' }, route.title),
            route.description ? el('div', { class: 'roadmap-detail-desc' }, route.description) : null),
          el('button', { class: 'roadmap-add-todo-btn', onclick: openAddTodoDialog },
            el('span', { class: 'icon', style: { width: '14px', height: '14px' }, innerHTML: icon('plus.circle.fill') }),
            '添加待办')),
        el('div', { class: 'roadmap-progress-row' },
          el('div', { class: 'roadmap-progress-label' }, `完成进度 ${route.completedCount}/${route.todoCount}`),
          el('div', { class: 'roadmap-progress-track lg' },
            el('div', { class: 'roadmap-progress-fill', style: { width: `${progressPct(route)}%` } })))),
      el('div', { class: 'roadmap-detail-sep' }));

    const list = el('div', { class: 'roadmap-todo-list' });
    if (isLoadingTodos && !todos.length) {
      list.append(el('div', { class: 'roadmap-todo-state loading' },
        el('span', { class: 'spinner dark' }), '加载待办...'));
    } else if (!todos.length) {
      list.append(el('div', { class: 'roadmap-todo-state' },
        el('span', { class: 'icon', style: { width: '40px', height: '40px', color: 'var(--text-4)' }, innerHTML: icon('checklist') }),
        el('div', {}, '还没有待办项'),
        el('div', { class: 'roadmap-todo-state-sub' }, '点击右上角「添加待办」来规划你的学习路线')));
    } else {
      todos.forEach((t) => list.append(todoRow(t, route)));
    }
    detail.append(list);
  }

  function todoRow(todo, route) {
    const isExpanded = expandedTodoIds.has(todo.id);
    const notes = notesByTodo.get(todo.id) || [];
    const isLoadingNotes = loadingNotesTodoIds.has(todo.id);

    const card = el('div', {
      class: 'roadmap-todo-card',
      oncontextmenu: (e) => {
        e.preventDefault();
        openContextMenu(e, [
          { label: '编辑待办', action: () => openEditTodoDialog(todo) },
          null,
          { label: '删除待办', danger: true, action: () => deleteTodo(todo, route) },
        ]);
      },
    },
      el('div', { class: 'roadmap-todo-top' },
        el('button', {
          class: 'roadmap-check',
          title: todo.isCompleted ? '标记为未完成' : '标记为完成',
          onclick: () => toggleTodo(todo, route),
        }, el('span', { class: `roadmap-check-circle${todo.isCompleted ? ' done' : ''}` },
          todo.isCompleted ? el('span', { class: 'icon', style: { width: '10px', height: '10px', color: '#fff' }, innerHTML: icon('checkmark') }) : null)),
        el('div', { class: `roadmap-todo-title${todo.isCompleted ? ' done' : ''}` }, todo.title),
        el('button', {
          class: 'roadmap-icon-btn', title: '添加备注',
          onclick: () => openAddNoteDialog(todo.id),
        }, el('span', { class: 'icon', style: { width: '14px', height: '14px' }, innerHTML: icon('note.text.badge.plus') })),
        el('button', {
          class: 'roadmap-icon-btn', title: isExpanded ? '收起备注' : '展开备注',
          onclick: () => toggleExpand(todo),
        }, el('span', { class: 'icon', style: { width: '12px', height: '12px' }, innerHTML: icon(isExpanded ? 'chevron.up' : 'chevron.down') })),
        el('button', {
          class: 'roadmap-icon-btn', title: '编辑待办',
          onclick: () => openEditTodoDialog(todo),
        }, el('span', { class: 'icon', style: { width: '12px', height: '12px' }, innerHTML: icon('pencil') }))));

    if (isExpanded) {
      const notesBox = el('div', { class: 'roadmap-notes' }, el('div', { class: 'roadmap-notes-sep' }));
      if (isLoadingNotes && !notes.length) {
        notesBox.append(el('div', { class: 'roadmap-note-state' },
          el('span', { class: 'spinner dark', style: { width: '12px', height: '12px' } }), '加载备注...'));
      } else if (!notes.length) {
        notesBox.append(el('div', { class: 'roadmap-note-state' }, '暂无备注，点击上方「备注」按钮添加'));
      } else {
        const listNode = el('div', { class: 'roadmap-notes-list' });
        notes.forEach((n) => listNode.append(noteRow(n, todo.id)));
        notesBox.append(listNode);
      }
      card.append(notesBox);
    }
    return card;
  }

  function noteRow(note, todoId) {
    return el('div', {
      class: 'roadmap-note-row',
      oncontextmenu: (e) => {
        e.preventDefault();
        openContextMenu(e, [
          { label: '编辑备注', action: () => openEditNoteDialog(todoId, note) },
          null,
          { label: '删除备注', danger: true, action: () => deleteNote(note, todoId) },
        ]);
      },
    },
      el('button', {
        class: 'roadmap-check sm',
        title: note.isCompleted ? '标记为未完成' : '标记为完成',
        onclick: () => toggleNote(note, todoId),
      }, el('span', { class: `roadmap-check-circle sm green${note.isCompleted ? ' done' : ''}` },
        note.isCompleted ? el('span', { class: 'icon', style: { width: '8px', height: '8px', color: '#fff' }, innerHTML: icon('checkmark') }) : null)),
      el('div', { class: `roadmap-note-content${note.isCompleted ? ' done' : ''}` }, note.content),
      note.createTime ? el('span', { class: 'roadmap-note-time' }, fmtNoteTime(note.createTime)) : null,
      el('button', {
        class: 'roadmap-icon-btn sm', title: '编辑备注',
        onclick: () => openEditNoteDialog(todoId, note),
      }, el('span', { class: 'icon', style: { width: '11px', height: '11px' }, innerHTML: icon('pencil') })),
      el('button', {
        class: 'roadmap-icon-btn sm trash', title: '删除备注',
        onclick: () => deleteNote(note, todoId),
      }, el('span', { class: 'icon', style: { width: '11px', height: '11px' }, innerHTML: icon('trash') })));
  }

  function render() {
    renderSidebar();
    renderDetail();
  }

  // ---------- 数据加载 ----------
  async function loadRoutes(preferredId = null) {
    isLoadingRoutes = true;
    render();
    try {
      const dtos = (await api.getStudyRoutes()) || [];
      routes = dtos.map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description ?? null,
        todoCount: d.todoCount ?? 0,
        completedCount: d.completedCount ?? 0,
      }));
      if (preferredId != null && routes.some((r) => r.id === preferredId)) {
        selectedRouteId = preferredId;
      } else if (selectedRouteId == null || !routes.some((r) => r.id === selectedRouteId)) {
        selectedRouteId = routes[0]?.id ?? null;
      }
      isLoadingRoutes = false;
      render();
      if (selectedRouteId != null) loadTodos();
    } catch (err) {
      isLoadingRoutes = false;
      render();
      toast(err?.message || '网络连接失败，请检查后端服务', 'error');
    }
  }

  async function loadTodos() {
    if (selectedRouteId == null) return;
    isLoadingTodos = true;
    notesByTodo.clear();
    expandedTodoIds.clear();
    loadingNotesTodoIds.clear();
    render();
    try {
      const dtos = (await api.getStudyTodos(selectedRouteId)) || [];
      todos = dtos.map((d) => ({ id: d.id, title: d.title, isCompleted: d.isCompleted === 1 }));
    } catch {
      todos = [];
    }
    isLoadingTodos = false;
    render();
  }

  async function loadNotes(todoId) {
    loadingNotesTodoIds.add(todoId);
    render();
    try {
      const dtos = (await api.getStudyNotes(todoId)) || [];
      notesByTodo.set(todoId, dtos.map((d) => ({ id: d.id, content: d.content, isCompleted: d.isCompleted === 1, createTime: d.createTime })));
    } catch {
      notesByTodo.set(todoId, []);
    }
    loadingNotesTodoIds.delete(todoId);
    render();
  }

  // ---------- 操作 ----------
  function selectRoute(route) {
    selectedRouteId = route.id;
    loadTodos();
  }

  function toggleTodo(todo, route) {
    const idx = todos.findIndex((t) => t.id === todo.id);
    if (idx < 0) return;
    todos[idx].isCompleted = !todos[idx].isCompleted;
    render();
    const newStatus = todos[idx].isCompleted ? 1 : 0;
    api.updateStudyTodo(route.id, todo.id, todos[idx].title, newStatus)
      .then(() => loadRoutes(route.id))
      .catch(() => {
        const cur = todos.findIndex((t) => t.id === todo.id);
        if (cur >= 0) { todos[cur].isCompleted = !todos[cur].isCompleted; render(); }
      });
  }

  function toggleNote(note, todoId) {
    const notes = notesByTodo.get(todoId);
    const idx = notes ? notes.findIndex((n) => n.id === note.id) : -1;
    if (idx < 0) return;
    notes[idx].isCompleted = !notes[idx].isCompleted;
    render();
    const newStatus = notes[idx].isCompleted ? 1 : 0;
    api.updateStudyNote(todoId, note.id, notes[idx].content, newStatus)
      .catch(() => {
        const cur = (notesByTodo.get(todoId) || []).findIndex((n) => n.id === note.id);
        if (cur >= 0) {
          notesByTodo.get(todoId)[cur].isCompleted = !notesByTodo.get(todoId)[cur].isCompleted;
          render();
        }
      });
  }

  async function deleteTodo(todo, route) {
    try {
      await api.deleteStudyTodo(route.id, todo.id);
      todos = todos.filter((t) => t.id !== todo.id);
      notesByTodo.delete(todo.id);
      expandedTodoIds.delete(todo.id);
      render();
      await loadRoutes(route.id);
    } catch { /* 删除失败静默处理（照 Swift） */ }
  }

  async function deleteNote(note, todoId) {
    try {
      await api.deleteStudyNote(todoId, note.id);
      notesByTodo.set(todoId, (notesByTodo.get(todoId) || []).filter((n) => n.id !== note.id));
      render();
    } catch {
      await loadNotes(todoId);
    }
  }

  function confirmDeleteRoute(route) {
    confirmModal({
      title: '确认删除学习路线',
      message: `学习路线「${route.title}」及其所有待办项将被删除，且不可恢复。确定要删除吗？`,
      confirmText: '确认删除',
      cancelText: '取消',
      danger: true,
    }).then((ok) => { if (ok) deleteRoute(route); });
  }

  async function deleteRoute(route) {
    try {
      await api.deleteStudyRoute(route.id);
      routes = routes.filter((r) => r.id !== route.id);
      if (selectedRouteId === route.id) selectedRouteId = routes[0]?.id ?? null;
      todos = [];
      notesByTodo.clear();
      expandedTodoIds.clear();
      loadingNotesTodoIds.clear();
      render();
      if (selectedRouteId != null) loadTodos();
    } catch { /* 删除失败静默处理（照 Swift） */ }
  }

  function toggleExpand(todo) {
    if (expandedTodoIds.has(todo.id)) {
      expandedTodoIds.delete(todo.id);
    } else {
      expandedTodoIds.add(todo.id);
      if (!notesByTodo.has(todo.id)) loadNotes(todo.id);
    }
    render();
  }

  // ---------- 弹窗 ----------
  function openAddRouteDialog() {
    openFormDialog({
      title: '新建学习路线',
      fields: [
        { key: 'title', label: '路线名称', placeholder: '例如：学习 SwiftUI' },
        { key: 'description', label: '描述（可选）', placeholder: '简要描述这门课程或目标', multiline: true, rows: 3 },
      ],
      canSubmit: (v) => v.title.value.trim().length > 0,
      onSubmit: async (v) => {
        const title = v.title.value.trim();
        const description = v.description.value.trim() || undefined;
        const dto = await api.addStudyRoute(title, description);
        await loadRoutes(dto.id);
      },
    });
  }

  function openEditRouteDialog(route) {
    openFormDialog({
      title: '编辑学习路线',
      fields: [
        { key: 'title', label: '路线名称', placeholder: '例如：学习 SwiftUI', value: route.title },
        { key: 'description', label: '描述（可选）', placeholder: '简要描述这门课程或目标', value: route.description || '', multiline: true, rows: 3 },
      ],
      canSubmit: (v) => v.title.value.trim().length > 0,
      onSubmit: async (v) => {
        const title = v.title.value.trim();
        const description = v.description.value.trim() || undefined;
        await api.updateStudyRoute(route.id, title, description);
        await loadRoutes(selectedRouteId);
      },
    });
  }

  function openAddTodoDialog() {
    if (selectedRouteId == null) return;
    const routeId = selectedRouteId;
    openFormDialog({
      title: '添加待办项',
      fields: [{ key: 'title', label: '待办标题', placeholder: '例如：第一章 环境搭建' }],
      canSubmit: (v) => v.title.value.trim().length > 0,
      onSubmit: async (v) => {
        await api.addStudyTodo(routeId, v.title.value.trim());
        await loadTodos();
      },
    });
  }

  function openEditTodoDialog(todo) {
    if (selectedRouteId == null) return;
    const routeId = selectedRouteId;
    openFormDialog({
      title: '编辑待办项',
      fields: [{ key: 'title', label: '待办标题', placeholder: '例如：第一章 环境搭建', value: todo.title }],
      canSubmit: (v) => v.title.value.trim().length > 0,
      onSubmit: async (v) => {
        await api.updateStudyTodo(routeId, todo.id, v.title.value.trim(), todo.isCompleted ? 1 : 0);
        await loadTodos();
      },
    });
  }

  function openAddNoteDialog(todoId) {
    openFormDialog({
      title: '添加备注',
      fields: [{ key: 'content', label: '备注内容', placeholder: '记录当前学习进度，例如：已看完第 3 小节视频', multiline: true, rows: 4 }],
      canSubmit: (v) => v.content.value.trim().length > 0,
      onSubmit: async (v) => {
        await api.addStudyNote(todoId, v.content.value.trim());
        await loadNotes(todoId);
      },
    });
  }

  function openEditNoteDialog(todoId, note) {
    openFormDialog({
      title: '编辑备注',
      fields: [{ key: 'content', label: '备注内容', placeholder: '记录当前学习进度，例如：已看完第 3 小节视频', value: note.content, multiline: true, rows: 4 }],
      canSubmit: (v) => v.content.value.trim().length > 0,
      onSubmit: async (v) => {
        await api.updateStudyNote(todoId, note.id, v.content.value.trim(), note.isCompleted ? 1 : 0);
        await loadNotes(todoId);
      },
    });
  }

  // ---------- 启动（对应 .task { await loadRoutes() }） ----------
  render();
  loadRoutes();
  return root;
}
