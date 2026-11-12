//
// views/notifications.js — 系统消息通知：通知下拉面板（列表/未读管理）+ 管理员发送通知弹窗
//                          + 新版本通知下载按钮 + 管理员发布新版本弹窗
//
import { el, clear, toast, adminBadge } from '../ui.js';
import { api, APIError } from '../api.js';
import { icon } from '../icons.js';
import { downloadInstaller, fmtSize, currentPlatform, currentVersion, bumpVersion } from '../updater.js';

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 解析版本通知的 extra JSON：{ version, mac, win } */
function parseExtra(n) {
  if (n.type !== 'VERSION' || !n.extra) return null;
  try {
    const extra = JSON.parse(n.extra);
    return extra.mac || extra.win ? extra : null;
  } catch {
    return null;
  }
}

/**
 * 新版本通知的安装包下载区（每条通知独立维护下载状态）
 * @param {Object} extra 解析后的 extra JSON：{ version, mac, win }
 */
function renderVersionDownloads(extra) {
  const platform = currentPlatform(); // darwin | win32
  const entries = [];
  if (extra.mac) entries.push({ key: 'mac', url: extra.mac, label: '下载 macOS 安装包', mine: platform === 'darwin' });
  if (extra.win) entries.push({ key: 'win', url: extra.win, label: '下载 Windows 安装包', mine: platform === 'win32' });
  if (!entries.length) return null;

  const states = {}; // key -> { status: 'idle'|'downloading'|'done'|'error', percent }

  const row = el('div', { class: 'ntf-dl-row' });
  const buttons = new Map();

  function paint(entry) {
    const btn = buttons.get(entry.key);
    const st = states[entry.key] || { status: 'idle', percent: 0 };
    btn.className = `ntf-dl-btn${entry.mine ? ' mine' : ''}${st.status === 'downloading' ? ' downloading' : ''}${st.status === 'done' ? ' done' : ''}${st.status === 'error' ? ' error' : ''}`;
    clear(btn);
    if (st.status === 'downloading') {
      btn.append(
        el('span', { class: 'ntf-dl-progress' },
          el('span', { class: 'ntf-dl-progress-bar', style: { width: `${Math.max(2, Math.round(st.percent * 100))}%` } })),
        el('span', {}, `下载中 ${Math.round(st.percent * 100)}%`),
      );
      return;
    }
    if (st.status === 'done') {
      btn.append(el('span', { class: 'icon', innerHTML: icon('checkmark') }), '已下载 · 已打开文件夹');
      return;
    }
    btn.append(
      el('span', { class: 'icon', innerHTML: icon('arrowdown') }),
      st.status === 'error' ? '下载失败，点击重试' : entry.label,
    );
  }

  async function start(entry) {
    const st = states[entry.key] || (states[entry.key] = { status: 'idle', percent: 0 });
    if (st.status === 'downloading') return;
    st.status = 'downloading';
    st.percent = 0;
    paint(entry);
    try {
      await downloadInstaller(entry.url, (p) => {
        if (p.done) return;
        st.percent = p.percent || 0;
        paint(entry);
      }, entry.size);
      st.status = 'done';
      toast('安装包下载完成，已打开所在文件夹', 'success');
    } catch (err) {
      st.status = 'error';
      toast(err?.message || '下载失败，请重试', 'error');
    }
    paint(entry);
  }

  for (const entry of entries) {
    const btn = el('button', { class: 'ntf-dl-btn', type: 'button', onclick: (e) => { e.stopPropagation(); start(entry); } });
    buttons.set(entry.key, btn);
    paint(entry);
    row.append(btn);
  }
  return row;
}

/**
 * 通知下拉面板（挂在顶栏铃铛下）
 * @param {Object} opts
 * @param {Object} opts.user           当前用户（role=ADMIN 时显示"发送通知"入口）
 * @param {Function} opts.onUnreadChange 未读数变化回调（用于刷新顶栏角标）
 */
export function NotificationPanel({ user, onUnreadChange }) {
  let isAdmin = user?.role === 'ADMIN';
  let notifications = [];
  let isLoading = true;
  let markingAll = false;

  const listEl = el('div', { class: 'ntf-list' });

  function updateUnread(count) {
    if (onUnreadChange) onUnreadChange(count);
  }

  function unreadCount() {
    return notifications.filter((n) => !n.isRead).length;
  }

  async function load() {
    isLoading = true;
    renderList();
    try {
      notifications = await api.getNotifications();
      updateUnread(unreadCount());
    } catch { /* 静默失败：面板内展示错误态 */ }
    isLoading = false;
    renderList();
  }

  function renderList() {
    clear(listEl);
    if (isLoading) {
      listEl.append(el('div', { class: 'ntf-state' }, el('span', { class: 'spinner dark' }), '加载中...'));
      return;
    }
    if (!notifications.length) {
      listEl.append(
        el('div', { class: 'ntf-state empty' },
          el('span', { class: 'icon icon-lg', innerHTML: icon('bell') }),
          el('div', {}, '暂无系统通知')),
      );
      return;
    }
    for (const n of notifications) {
      const extra = parseExtra(n);
      const item = el('div', {
        class: `ntf-item${n.isRead ? '' : ' unread'}`,
        title: n.isRead ? '' : '点击标记为已读',
        onclick: () => markRead(n, item),
      },
        el('div', { class: 'ntf-item-top' },
          el('span', { class: 'ntf-dot' }),
          el('span', { class: 'ntf-item-title' }, n.title),
          n.type === 'VERSION' ? el('span', { class: 'ntf-item-badge' }, '新版本') : null,
          el('span', { class: 'ntf-item-time' }, fmtTime(n.createTime))),
        el('div', { class: 'ntf-item-content' }, n.content),
        extra ? renderVersionDownloads(extra) : null,
        el('div', { class: 'ntf-item-foot' },
          el('span', {}, n.senderName ? `来自：${n.senderName}` : '系统消息'),
          n.isRead
            ? el('span', { class: 'ntf-read-flag' },
                el('span', { class: 'icon', innerHTML: icon('checkmark') }), '已读')
            : el('span', { class: 'ntf-read-flag unread' }, '未读')),
      );
      listEl.append(item);
    }
  }

  async function markRead(n, item) {
    if (n.isRead) return;
    try {
      await api.markNotificationRead(n.id);
      n.isRead = 1;
      item?.classList.remove('unread');
      updateUnread(unreadCount());
      renderList();
    } catch (err) {
      toast(err instanceof APIError && err.business ? err.message : '操作失败', 'error');
    }
  }

  async function markAll() {
    if (markingAll || !unreadCount()) return;
    markingAll = true;
    try {
      await api.markAllNotificationsRead();
      notifications.forEach((n) => { n.isRead = 1; });
      updateUnread(0);
      renderList();
      toast('已全部标记为已读', 'success');
    } catch (err) {
      toast(err instanceof APIError && err.business ? err.message : '操作失败', 'error');
    }
    markingAll = false;
  }

  const markAllBtn = el('button', {
    class: 'ntf-head-btn', title: '全部标记为已读',
    onclick: markAll,
  }, el('span', { class: 'icon', innerHTML: icon('checkmark') }), '全部已读');

  const sendBtn = el('button', {
    class: 'ntf-head-btn primary', title: '发送系统通知（管理员）',
    onclick: () => {
      AdminSendModal({ onSuccess: () => { load(); } });
    },
  }, el('span', { class: 'icon', innerHTML: icon('paperplane') }), '发送通知', adminBadge('管理员专属功能'));

  const publishBtn = el('button', {
    class: 'ntf-head-btn primary', title: '发布新版本（管理员）',
    onclick: () => {
      VersionPublishModal({ onSuccess: () => { load(); } });
    },
  }, el('span', { class: 'icon', innerHTML: icon('rocket') }), '发新版', adminBadge('管理员专属功能'));

  const panel = el('div', { class: 'topbar-dd ntf-panel' },
    el('div', { class: 'ntf-head' },
      el('span', { class: 'ntf-head-title' }, '系统通知'),
      el('div', { class: 'ntf-head-actions' },
        isAdmin ? publishBtn : null,
        isAdmin ? sendBtn : null,
        markAllBtn)),
    listEl,
  );

  load();
  return panel;
}

/**
 * 管理员发送系统通知弹窗（仅 ADMIN 角色可见入口；后端接口同样做了权限校验）
 */
export function AdminSendModal({ onSuccess }) {
  let scope = 'ALL'; // 'ALL' | 'SELECTED'
  let users = [];
  let isLoadingUsers = false;
  let isSending = false;
  const checked = new Set();

  const titleInput = el('input', {
    class: 'field-input fb-input', type: 'text', maxlength: '100', placeholder: '请输入通知标题',
  });
  const contentInput = el('textarea', {
    class: 'field-input fb-textarea', rows: '5', maxlength: '2000', placeholder: '请输入通知内容（1-2000字）...',
  });

  // ---------- 接收范围 ----------
  const scopeAllRadio = el('input', { type: 'radio', name: 'ntf-scope', checked: true });
  const scopeSelRadio = el('input', { type: 'radio', name: 'ntf-scope' });
  const userPickerWrap = el('div', { class: 'ntf-user-picker', style: { display: 'none' } });

  function renderScope() {
    scopeAllRadio.checked = scope === 'ALL';
    scopeSelRadio.checked = scope === 'SELECTED';
    userPickerWrap.style.display = scope === 'SELECTED' ? 'flex' : 'none';
    // 首次切换到"指定用户"时加载用户列表
    if (scope === 'SELECTED' && !users.length && !isLoadingUsers) loadUsers();
    refreshSendDisabled();
  }

  // ---------- 用户选择列表 ----------
  const searchInput = el('input', {
    class: 'field-input fb-input', type: 'text', placeholder: '搜索昵称/手机号',
  });
  const userListEl = el('div', { class: 'ntf-user-list' });
  const checkedCountEl = el('span', { class: 'ntf-checked-count' }, '已选 0 人');

  function renderUsers() {
    clear(userListEl);
    const kw = searchInput.value.trim().toLowerCase();
    const filtered = kw
      ? users.filter((u) => (u.nickname || '').toLowerCase().includes(kw) || (u.phone || '').includes(kw))
      : users;
    if (!filtered.length) {
      userListEl.append(el('div', { class: 'ntf-state empty small' },
        el('div', {}, isLoadingUsers ? '加载用户中...' : '没有匹配的用户')));
      return;
    }
    for (const u of filtered) {
      const cb = el('input', {
        class: 'ntf-user-check', type: 'checkbox',
        checked: checked.has(u.id) ? true : null,
        onchange: (e) => {
          if (e.target.checked) checked.add(u.id);
          else checked.delete(u.id);
          refreshCheckedCount();
        },
      });
      userListEl.append(
        el('label', { class: 'ntf-user-row' },
          cb,
          el('span', { class: 'ntf-user-name' }, u.nickname || '未命名'),
          el('span', { class: 'ntf-user-phone' }, u.phone),
          u.role === 'ADMIN' ? el('span', { class: 'fb-badge type' }, '管理员') : null),
      );
    }
  }

  function refreshCheckedCount() {
    checkedCountEl.textContent = `已选 ${checked.size} 人`;
    refreshSendDisabled();
  }

  searchInput.addEventListener('input', renderUsers);

  async function loadUsers() {
    if (isLoadingUsers) return;
    isLoadingUsers = true;
    renderUsers();
    try {
      users = await api.getUsers();
    } catch (err) {
      toast(err instanceof APIError && err.business ? err.message : '用户列表加载失败', 'error');
    }
    isLoadingUsers = false;
    renderUsers();
  }

  // ---------- 发送 ----------
  const errorBox = el('div', { class: 'fb-msg error', style: { display: 'none' } });
  function setError(msg) {
    if (msg) { errorBox.textContent = msg; errorBox.style.display = 'flex'; }
    else errorBox.style.display = 'none';
  }

  const sendBtn = el('button', { class: 'fb-submit-btn', onclick: send }, '发送');
  const cancelBtn = el('button', { class: 'btn-secondary', style: { padding: '9px 18px', borderRadius: '10px' }, onclick: () => mask.remove() }, '取消');

  function refreshSendDisabled() {
    sendBtn.disabled = isSending
      || !titleInput.value.trim()
      || !contentInput.value.trim()
      || (scope === 'SELECTED' && !checked.size);
  }
  titleInput.addEventListener('input', refreshSendDisabled);
  contentInput.addEventListener('input', refreshSendDisabled);

  scopeAllRadio.addEventListener('change', () => { scope = 'ALL'; renderScope(); });
  scopeSelRadio.addEventListener('change', () => { scope = 'SELECTED'; renderScope(); });

  async function send() {
    setError('');
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    if (!title) return setError('请输入通知标题');
    if (!content) return setError('请输入通知内容');
    if (scope === 'SELECTED' && !checked.size) return setError('请选择接收用户');

    isSending = true;
    refreshSendDisabled();
    clear(sendBtn).append(el('span', { class: 'spinner' }), '');
    try {
      const res = await api.sendNotification({
        title, content, scope,
        receiverIds: scope === 'SELECTED' ? [...checked] : null,
      });
      toast(`发送成功，已通知 ${res?.receiverCount ?? 0} 位用户`, 'success');
      mask.remove();
      if (onSuccess) onSuccess();
    } catch (err) {
      const msg = err instanceof APIError && err.business ? err.message : '发送失败，请稍后重试';
      setError(msg);
      toast(msg, 'error');
      isSending = false;
      refreshSendDisabled();
      clear(sendBtn).append('发送');
    }
  }

  // ---------- 组装 ----------
  const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } },
    el('div', { class: 'fb-modal' },
      el('div', { class: 'fb-modal-head' },
        el('div', { class: 'fb-modal-title' },
          el('span', { class: 'icon', innerHTML: icon('paperplane') }),
          '发送系统通知',
          adminBadge('管理员专属功能')),
        el('button', {
          class: 'fb-modal-close', title: '关闭', onclick: () => mask.remove(),
        }, el('span', { class: 'icon', innerHTML: icon('xmark') }))),
      el('div', { class: 'fb-pane', style: { gap: '12px' } },
        el('div', { class: 'fb-field' }, el('label', { class: 'field-label' }, '通知标题'), titleInput),
        el('div', { class: 'fb-field' },
          el('label', { class: 'field-label' }, '通知内容'),
          contentInput),
        el('div', { class: 'fb-field' },
          el('label', { class: 'field-label' }, '接收范围'),
          el('div', { class: 'ntf-scope-row' },
            el('label', { class: 'ntf-scope-item' }, scopeAllRadio, '全部用户'),
            el('label', { class: 'ntf-scope-item' }, scopeSelRadio, '指定用户'),
            checkedCountEl)),
        userPickerWrap,
        errorBox),
      el('div', { class: 'fb-actions' }, cancelBtn, sendBtn),
    ),
  );

  userPickerWrap.append(
    searchInput,
    userListEl,
    el('div', { class: 'fb-hint' }, '可搜索并勾选需要通知的用户'),
  );

  renderScope();
  refreshCheckedCount();
  document.getElementById('modal-root').append(mask);
  titleInput.focus();
}

/**
 * 管理员发布新版本弹窗：
 * 1. 上传 macOS / Windows 安装包 → 2. 发布版本 → 3. 可选自动向全部用户发送带下载按钮的系统通知
 */
export function VersionPublishModal({ onSuccess }) {
  // 版本号默认为"本地版本 +1"（与打包自动升版本保持一致），管理员可自行修改
  const versionInput = el('input', {
    class: 'field-input fb-input', type: 'text', maxlength: '20', placeholder: '如 1.1.0（需与安装包版本一致）',
  });
  versionInput.value = bumpVersion(currentVersion());
  const notesInput = el('textarea', {
    class: 'field-input fb-textarea', rows: '4', maxlength: '2000',
    placeholder: '更新说明（将作为系统通知内容发送给用户，可留空）...',
  });

  // 安装包选择器：隐藏 input[type=file] + 展示已选文件
  function filePicker({ accept, hint }) {
    let picked = null;
    const nameEl = el('span', { class: 'ntf-up-name' }, hint);
    const input = el('input', {
      type: 'file', accept, style: { display: 'none' },
      onchange: (e) => {
        picked = e.target.files?.[0] || null;
        clear(nameEl).append(picked
          ? el('span', { class: 'ntf-up-picked' }, `${picked.name}（${fmtSize(picked.size)}）`)
          : hint);
      },
    });
    const node = el('div', { class: 'ntf-up-row' },
      el('button', {
        class: 'btn-secondary', type: 'button',
        style: { padding: '7px 14px', borderRadius: '9px', fontSize: '12px', flexShrink: '0' },
        onclick: () => input.click(),
      }, '选择文件'),
      nameEl,
      input);
    return { node, get file() { return picked; } };
  }

  const macPicker = filePicker({ accept: '.dmg,.pkg,.zip', hint: '未选择（支持 .dmg / .pkg / .zip）' });
  const winPicker = filePicker({ accept: '.exe,.zip', hint: '未选择（支持 .exe / .zip）' });

  const notifyCheck = el('input', { type: 'checkbox', checked: true, style: { accentColor: 'var(--primary)' } });

  // ---------- 发布 ----------
  const errorBox = el('div', { class: 'fb-msg error', style: { display: 'none' } });
  function setError(msg) {
    if (msg) { errorBox.textContent = msg; errorBox.style.display = 'flex'; }
    else errorBox.style.display = 'none';
  }

  const publishActionBtn = el('button', { class: 'fb-submit-btn', onclick: publish }, '发布');
  const cancelBtn = el('button', { class: 'btn-secondary', style: { padding: '9px 18px', borderRadius: '10px' }, onclick: () => mask.remove() }, '取消');

  async function publish() {
    setError('');
    const version = versionInput.value.trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) return setError('版本号格式应为 x.y.z（如 1.1.0）');
    if (!macPicker.file && !winPicker.file) return setError('请至少选择一个平台的安装包');

    publishActionBtn.disabled = true;
    const setBtn = (t) => clear(publishActionBtn).append(t);
    setBtn('准备上传...');
    try {
      const body = {
        version,
        releaseNotes: notesInput.value.trim(),
        notifyAll: notifyCheck.checked,
      };
      if (macPicker.file) {
        setBtn('上传 macOS 0%');
        body.macFile = (await api.uploadInstaller(macPicker.file,
          (loaded, total) => setBtn(`上传 macOS ${total ? Math.round((loaded / total) * 100) : 0}%`))).fileName;
      }
      if (winPicker.file) {
        setBtn('上传 Windows 0%');
        body.winFile = (await api.uploadInstaller(winPicker.file,
          (loaded, total) => setBtn(`上传 Windows ${total ? Math.round((loaded / total) * 100) : 0}%`))).fileName;
      }
      setBtn('正在发布...');
      await api.publishVersion(body);
      toast(notifyCheck.checked ? '发布成功，已向全部用户发送新版本通知' : '发布成功', 'success');
      mask.remove();
      if (onSuccess) onSuccess();
    } catch (err) {
      const msg = err instanceof APIError && err.business ? err.message : '发布失败，请稍后重试';
      setError(msg);
      toast(msg, 'error');
      publishActionBtn.disabled = false;
      clear(publishActionBtn).append('发布');
    }
  }

  // ---------- 组装 ----------
  const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } },
    el('div', { class: 'fb-modal' },
      el('div', { class: 'fb-modal-head' },
        el('div', { class: 'fb-modal-title' },
          el('span', { class: 'icon', innerHTML: icon('rocket') }),
          '发布新版本',
          adminBadge('管理员专属功能')),
        el('button', {
          class: 'fb-modal-close', title: '关闭', onclick: () => mask.remove(),
        }, el('span', { class: 'icon', innerHTML: icon('xmark') }))),
      el('div', { class: 'fb-pane', style: { gap: '12px' } },
        el('div', { class: 'fb-field' }, el('label', { class: 'field-label' }, '版本号'), versionInput),
        el('div', { class: 'fb-field' },
          el('label', { class: 'field-label' }, '更新说明'),
          notesInput),
        el('div', { class: 'fb-field' },
          el('label', { class: 'field-label' }, 'macOS 安装包'),
          macPicker.node),
        el('div', { class: 'fb-field' },
          el('label', { class: 'field-label' }, 'Windows 安装包'),
          winPicker.node),
        el('div', { class: 'fb-field' },
          el('label', { class: 'ntf-scope-item' }, notifyCheck, '发布后自动向全部用户发送系统通知（用户可一键下载）')),
        errorBox),
      el('div', { class: 'fb-actions' }, cancelBtn, publishActionBtn),
    ),
  );

  document.getElementById('modal-root').append(mask);
  versionInput.focus();
}
