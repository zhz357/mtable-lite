//
// views/dailynote.js — 便签卡片（今日便签 / 长期待办事项）
// 展示在首页右侧栏：添加、编辑、完成标记、删除、历史查看
// category='daily'   今日便签：按日期归档，历史入口查看过往记录
// category='longterm' 长期待办：未完成项永久展示，完成后移入历史
//
import { el, clear, toast } from '../ui.js';
import { api } from '../api.js';
import { icon } from '../icons.js';

// ---------- 日期工具 ----------
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmtDate(d);
}
function monthStart() {
  const d = new Date();
  return fmtDate(new Date(d.getFullYear(), d.getMonth(), 1));
}
/** ISO 时间串 "2026-10-27T10:30:00" -> "10-27 10:30" */
function shortTime(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[2]}-${m[3]} ${m[4]}` : String(iso);
}

export function DailyNoteView({ category = 'daily' } = {}) {
  const isLongTerm = category === 'longterm';
  const title = isLongTerm ? '长期待办事项' : '今日便签';
  const headerIcon = isLongTerm ? 'flag.fill' : 'note.text';
  const placeholder = isLongTerm ? '添加长期待办...' : '添加新便签...';
  const emptyTitle = isLongTerm ? '还没有长期待办' : '今天还没有便签';
  const emptySub = isLongTerm ? '未完成的待办会一直展示在这里' : '在下方输入并回车添加';

  let notes = [];
  let isLoading = true;
  let isAdding = false;

  const countBadge = el('span', { class: 'dn-count', style: { display: 'none' } });
  const listWrap = el('div', { class: 'dn-list' });
  const input = el('input', {
    class: 'dn-input', type: 'text', placeholder, maxlength: '200',
  });
  const addBtn = el('button', { class: 'dn-add', disabled: true },
    el('span', { class: 'icon', innerHTML: icon('plus.circle.fill') }));

  // MARK: - Header 计数胶囊
  function updateCount() {
    if (!notes.length) {
      countBadge.style.display = 'none';
      return;
    }
    if (isLongTerm) {
      const pending = notes.filter((n) => !n.isCompleted).length;
      countBadge.textContent = `未完成 ${pending}`;
    } else {
      const completed = notes.filter((n) => !!n.isCompleted).length;
      countBadge.textContent = `${completed}/${notes.length}`;
    }
    countBadge.style.display = '';
  }

  // MARK: - Note Row
  function noteRow(note) {
    return el('div', { class: `dn-row${note.isCompleted ? ' done' : ''}` },
      el('button', {
        class: 'dn-check',
        title: note.isCompleted ? '标记未完成' : '标记完成',
        onclick: () => toggleComplete(note),
      },
        el('span', { class: 'dn-check-box' },
          el('span', { class: 'dn-check-mark' }, '✅')),
      ),
      el('div', { class: 'dn-content', title: note.content }, note.content),
      el('button', {
        class: 'dn-edit', title: '编辑',
        onclick: () => openEditModal(note),
      },
        el('span', { class: 'icon', innerHTML: icon('pencil') })),
      el('button', {
        class: 'dn-delete', title: '删除',
        onclick: () => deleteNote(note),
      },
        el('span', { class: 'icon', innerHTML: icon('xmark') })),
    );
  }

  // MARK: - Empty State
  function emptyState() {
    return el('div', { class: 'dn-empty' },
      el('span', { class: 'icon', innerHTML: icon('note.text.badge.plus') }),
      el('div', { class: 'dn-empty-title' }, emptyTitle),
      el('div', { class: 'dn-empty-sub' }, emptySub),
    );
  }

  function renderList() {
    clear(listWrap);
    if (notes.length === 0 && !isLoading) {
      listWrap.append(emptyState());
    } else {
      for (const note of notes) listWrap.append(noteRow(note));
    }
    updateCount();
  }

  // MARK: - Actions
  async function loadNotes() {
    isLoading = true;
    try {
      const dtos = isLongTerm ? await api.getLongTermNotes() : await api.getDailyNotes();
      notes = Array.isArray(dtos) ? dtos : [];
    } catch {
      // 失败时静默保留空列表
    }
    isLoading = false;
    renderList();
  }

  function updateAddState() {
    const empty = !input.value.trim();
    addBtn.disabled = empty || isAdding;
    addBtn.classList.toggle('active', !empty);
  }

  function addNote() {
    const trimmed = input.value.trim();
    if (!trimmed || isAdding) return;

    isAdding = true;
    const text = trimmed;
    input.value = '';
    input.blur();
    updateAddState();

    // 乐观添加（负数临时 id）
    const optimisticNote = {
      id: -(Math.floor(Math.random() * 99999) + 1),
      content: text,
      isCompleted: 0,
      category,
      noteDate: null,
    };
    notes.push(optimisticNote);
    renderList();

    api.addDailyNote(text, category).then((dto) => {
      const idx = notes.findIndex((n) => n.id === optimisticNote.id);
      if (idx !== -1) notes[idx] = dto;
      isAdding = false;
      updateAddState();
      renderList();
      toast(isLongTerm ? '已添加长期待办' : '已添加今日便签');
    }).catch(() => {
      notes = notes.filter((n) => n.id !== optimisticNote.id);
      input.value = text;
      isAdding = false;
      updateAddState();
      renderList();
      toast('添加失败，请重试', 'error');
    });
  }

  function toggleComplete(note) {
    const idx = notes.findIndex((n) => n.id === note.id);
    if (idx === -1) return;

    const wasDone = !!notes[idx].isCompleted;
    const newStatus = wasDone ? 0 : 1;

    // 乐观更新完成状态与样式
    notes[idx].isCompleted = newStatus;
    renderList();
    toast(newStatus ? '已标记完成' : '已标记未完成');

    api.updateDailyNote(note.id, { isCompleted: newStatus }).then(() => {
      // 长期待办：完成后是否移出首页由服务端规则决定（不足 5 条时保留最近完成项补齐）
      if (isLongTerm) loadNotes();
    }).catch(() => {
      toast('操作失败，已恢复', 'error');
      loadNotes();
    });
  }

  function deleteNote(note) {
    notes = notes.filter((n) => n.id !== note.id);
    renderList();
    toast('已删除');

    api.deleteDailyNote(note.id).catch(() => {
      toast('删除失败，已恢复', 'error');
      loadNotes();
    });
  }

  // MARK: - 编辑弹窗
  function openEditModal(note) {
    if (document.querySelector('#modal-root .dn-edit-modal')) return;
    const editInput = el('input', {
      class: 'field-input dlg-input', type: 'text', maxlength: '200', value: note.content,
    });
    const mask = el('div', {
      class: 'modal-mask',
      onclick: (e) => { if (e.target === mask) close(); },
    },
      el('div', { class: 'dlg-modal dn-edit-modal' },
        el('div', { class: 'dlg-title' }, '编辑便签'),
        el('div', { class: 'dlg-body' }, editInput),
        el('div', { class: 'dlg-actions' },
          el('button', { class: 'dlg-btn-cancel', type: 'button', onclick: close }, '取消'),
          el('button', { class: 'dlg-btn-ok', type: 'button' }, '保存'))));

    function close() { mask.remove(); }
    const okBtn = mask.querySelector('.dlg-btn-ok');
    function save() {
      const text = editInput.value.trim();
      if (!text) { toast('内容不能为空', 'error'); editInput.focus(); return; }
      okBtn.disabled = true;
      api.updateDailyNote(note.id, { content: text }).then(() => {
        const idx = notes.findIndex((n) => n.id === note.id);
        if (idx !== -1) notes[idx].content = text;
        renderList();
        close();
        toast('已保存');
      }).catch(() => {
        okBtn.disabled = false;
        toast('保存失败，请重试', 'error');
      });
    }
    okBtn.addEventListener('click', save);
    editInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    mask.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    document.getElementById('modal-root').append(mask);
    editInput.focus();
    editInput.select();
  }

  // MARK: - 历史弹窗（按时间维度筛选浏览过往记录）
  function openHistoryModal() {
    if (document.querySelector('#modal-root .dn-his-modal')) return;

    // 时间筛选：预设 chips + 自定义起止日期（null = 不限）
    let range = { label: '近7天', start: daysAgo(6), end: null };
    let rows = [];
    let loaded = false;

    const chipsBox = el('div', { class: 'dn-his-chips' });
    const startInput = el('input', { class: 'dn-his-date', type: 'date', value: range.start || '' });
    const endInput = el('input', { class: 'dn-his-date', type: 'date', value: range.end || '' });
    const statusText = el('span', { class: 'dn-his-status' });
    const listBox = el('div', { class: 'dn-his-list' });

    const CHIPS = [
      { label: '近7天', get: () => ({ start: daysAgo(6), end: null }) },
      { label: '近30天', get: () => ({ start: daysAgo(29), end: null }) },
      { label: '本月', get: () => ({ start: monthStart(), end: null }) },
      { label: '全部', get: () => ({ start: null, end: null }) },
    ];

    const mask = el('div', {
      class: 'modal-mask',
      onclick: (e) => { if (e.target === mask) close(); },
    },
      el('div', { class: 'dn-his-modal' },
        el('div', { class: 'dn-his-head' },
          el('span', { class: 'icon', innerHTML: icon('clock') }),
          el('div', { class: 'dn-his-title' }, `${title} · 历史`),
          statusText,
          el('button', { class: 'dn-his-close', type: 'button', title: '关闭', onclick: close },
            el('span', { class: 'icon', innerHTML: icon('xmark') }))),
        el('div', { class: 'dn-his-filter' },
          chipsBox,
          el('div', { class: 'dn-his-range' },
            startInput, el('span', { class: 'dn-his-dash' }, '至'), endInput)),
        listBox));

    function close() { mask.remove(); }
    mask.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    function renderChips() {
      clear(chipsBox);
      for (const c of CHIPS) {
        chipsBox.append(el('button', {
          class: `dn-his-chip${c.label === range.label ? ' active' : ''}`, type: 'button',
          onclick: () => {
            range = { label: c.label, ...c.get() };
            startInput.value = range.start || '';
            endInput.value = range.end || '';
            renderChips();
            fetchHistory();
          },
        }, c.label));
      }
    }

    function onCustomDate() {
      range = { label: '自定义', start: startInput.value || null, end: endInput.value || null };
      renderChips();
      fetchHistory();
    }
    startInput.addEventListener('change', onCustomDate);
    endInput.addEventListener('change', onCustomDate);

    function historyRow(note) {
      const done = !!note.isCompleted;
      return el('div', { class: `dn-his-row${done ? ' done' : ''}` },
        el('span', {
          class: 'dn-his-status-icon',
          innerHTML: icon(done ? 'checkmark.circle.fill' : 'circle.dashed'),
        }),
        el('div', { class: 'dn-his-main' },
          el('div', { class: 'dn-his-content' }, note.content),
          el('div', { class: 'dn-his-meta' },
            el('span', {}, `创建：${shortTime(note.createTime) || note.noteDate || '—'}`),
            note.noteDate && note.createTime ? el('span', { class: 'dn-his-dot' }, '·') : null,
            note.noteDate && note.createTime ? el('span', {}, `日期：${note.noteDate}`) : null,
            el('span', { class: 'dn-his-dot' }, '·'),
            el('span', { class: done ? 'dn-his-tag done' : 'dn-his-tag' }, done ? '已完成' : '未完成'))));
    }

    function renderList() {
      clear(listBox);
      if (!loaded) {
        listBox.append(el('div', { class: 'dn-his-state' },
          el('span', { class: 'spinner dark' }), '正在加载历史记录...'));
        clear(statusText);
        return;
      }
      clear(statusText).append(el('b', {}, String(rows.length)), ' 条记录');
      if (!rows.length) {
        listBox.append(el('div', { class: 'dn-his-state empty' },
          el('span', { class: 'icon', innerHTML: icon('archivebox') }),
          el('div', {}, '该时间范围内暂无便签记录')));
        return;
      }
      // 按便签日期分组展示
      let lastDate = null;
      for (const note of rows) {
        if (note.noteDate !== lastDate) {
          lastDate = note.noteDate;
          listBox.append(el('div', { class: 'dn-his-group' }, lastDate || '未归档'));
        }
        listBox.append(historyRow(note));
      }
    }

    async function fetchHistory() {
      loaded = false;
      renderList();
      try {
        const dtos = await api.getDailyNoteHistory(category, range.start, range.end);
        rows = Array.isArray(dtos) ? dtos : [];
      } catch {
        rows = [];
        toast('历史记录加载失败', 'error');
      }
      if (!mask.isConnected) return;
      loaded = true;
      renderList();
    }

    renderChips();
    document.getElementById('modal-root').append(mask);
    fetchHistory();
  }

  input.addEventListener('input', updateAddState);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNote(); });
  addBtn.addEventListener('click', addNote);

  const root = el('div', { class: 'dn-card' },
    // 标题栏：图标 + 标题 + 计数 + 历史入口
    el('div', { class: 'dn-header' },
      el('span', { class: 'icon', innerHTML: icon(headerIcon) }),
      el('span', { class: 'dn-title' }, title),
      countBadge,
      el('button', {
        class: 'dn-history', type: 'button', title: `查看${title}历史`,
        onclick: openHistoryModal,
      },
        el('span', { class: 'icon', innerHTML: icon('clock') }),
        el('span', {}, '历史'))),
    el('div', { class: 'dn-divider' }),
    listWrap,
    el('div', { class: 'dn-divider' }),
    el('div', { class: 'dn-inputbar' }, input, addBtn),
  );

  loadNotes();
  return root;
}
