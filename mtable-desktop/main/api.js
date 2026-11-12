//
// api.js（主进程）— 本地 API 路由：把原后端 REST 端点逐一映射到 SQLite 操作
// 渲染进程通过 IPC 'mtable:api' 传入 { path, method, body, token }，
// 返回 { code, message, data }，与原后端统一 Result 结构完全一致。
//
const crypto = require('crypto');
const { getDb, nowIso, todayDate, hashPassword, verifyPassword } = require('./db');
const external = require('./external');

const CODE = { SUCCESS: 200, PARAM: 400, UNAUTHORIZED: 401, TOKEN_EXPIRED: 4011, FORBIDDEN: 403, INTERNAL: 500 };

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const err = (code, message) => { throw new ApiError(code, message); };
const ok = (data, message = '操作成功') => ({ code: CODE.SUCCESS, message, data: data === undefined ? null : data });

// ---------- 列别名（DB 蛇形 → 前端驼峰） ----------
const C = {
  user: 'id, phone, nickname, avatar, motto, status, role, create_time AS createTime, update_time AS updateTime',
  menu: 'id, user_id AS userId, title, icon, plugin_key AS pluginKey, sort_order AS sortOrder, is_enabled AS isEnabled, create_time AS createTime, update_time AS updateTime',
  folder: 'id, menu_id AS menuId, user_id AS userId, title, icon, sort_order AS sortOrder, create_time AS createTime, update_time AS updateTime',
  card: 'id, menu_id AS menuId, folder_id AS folderId, user_id AS userId, title, description, url, icon_url AS iconUrl, plugin_key AS pluginKey, sort_order AS sortOrder, create_time AS createTime, update_time AS updateTime',
  note: 'id, user_id AS userId, content, is_completed AS isCompleted, category, note_date AS noteDate, sort_order AS sortOrder, create_time AS createTime, update_time AS updateTime',
  route: 'id, user_id AS userId, title, description, sort_order AS sortOrder, create_time AS createTime, update_time AS updateTime',
  todo: 'id, route_id AS routeId, user_id AS userId, title, is_completed AS isCompleted, sort_order AS sortOrder, create_time AS createTime, update_time AS updateTime',
  snote: 'id, todo_id AS todoId, user_id AS userId, content, is_completed AS isCompleted, sort_order AS sortOrder, create_time AS createTime, update_time AS updateTime',
  feedback: 'id, user_id AS userId, reporter_name AS reporterName, reporter_account AS reporterAccount, feedback_type AS feedbackType, content, status, create_time AS createTime, update_time AS updateTime',
  wpimg: 'id, image_key AS imageKey, source, category, image_date AS imageDate, title, copyright, file_name AS fileName, url, create_time AS createTime, update_time AS updateTime',
};

const q = (sql, ...p) => getDb().prepare(sql).all(...p);
const g = (sql, ...p) => getDb().prepare(sql).get(...p);
const run = (sql, ...p) => getDb().prepare(sql).run(...p);
const count = (sql, ...p) => g(sql, ...p).c;

// ---------- 会话 ----------
// 登录有效期（天）：存 t_config，0 = 永久，默认 30 天；修改后对新建会话生效，
// 并把现有会话的过期时间统一刷新为新有效期（"动态设置"立即影响当前登录态）
const TTL_KEY = 'session_ttl_days';
const TTL_DEFAULT = 30;
function getTtlDays() {
  const r = g('SELECT value FROM t_config WHERE key = ?', TTL_KEY);
  return r ? Number(r.value) : TTL_DEFAULT;
}
function futureIso(days) {
  const d = new Date(Date.now() + days * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const days = getTtlDays();
  run('INSERT INTO t_session (token, user_id, create_time, expire_time) VALUES (?, ?, ?, ?)',
    token, userId, nowIso(), days > 0 ? futureIso(days) : null);
  return token;
}
function resolveUserId(token) {
  if (!token) err(CODE.TOKEN_EXPIRED, '登录已过期，请重新登录');
  const s = g('SELECT user_id AS userId, expire_time AS expireTime FROM t_session WHERE token = ?', token);
  if (!s) err(CODE.TOKEN_EXPIRED, '登录已过期，请重新登录');
  if (s.expireTime && s.expireTime < nowIso()) {
    run('DELETE FROM t_session WHERE token = ?', token);
    err(CODE.TOKEN_EXPIRED, '登录已过期，请重新登录');
  }
  return s.userId;
}
function loginResponse(user, token) {
  return ok({
    token, userId: user.id, phone: user.phone, nickname: user.nickname,
    avatar: user.avatar, motto: user.motto, role: user.role,
  }, '操作成功');
}

// ---------- 归属校验 ----------
function ownMenu(userId, menuId) {
  const m = g(`SELECT ${C.menu} FROM t_user_menu WHERE id = ? AND user_id = ?`, menuId, userId);
  if (!m) err(CODE.FORBIDDEN, '菜单不存在或无权限'); return m;
}
function ownCard(userId, cardId) {
  const c = g(`SELECT ${C.card} FROM t_menu_card WHERE id = ? AND user_id = ?`, cardId, userId);
  if (!c) err(CODE.FORBIDDEN, '卡片不存在或无权限'); return c;
}
function ownFolder(userId, folderId) {
  const f = g(`SELECT ${C.folder} FROM t_menu_folder WHERE id = ? AND user_id = ?`, folderId, userId);
  if (!f) err(CODE.FORBIDDEN, '文件夹不存在或无权限'); return f;
}
function ownNote(userId, noteId) {
  const n = g(`SELECT ${C.note} FROM t_daily_note WHERE id = ? AND user_id = ?`, noteId, userId);
  if (!n) err(CODE.FORBIDDEN, '便签不存在或无权限'); return n;
}
function ownRoute(userId, routeId) {
  const r = g(`SELECT ${C.route} FROM t_study_route WHERE id = ? AND user_id = ?`, routeId, userId);
  if (!r) err(CODE.FORBIDDEN, '学习路线不存在或无权限'); return r;
}
function ownTodo(userId, todoId) {
  const t = g(`SELECT ${C.todo} FROM t_study_todo WHERE id = ? AND user_id = ?`, todoId, userId);
  if (!t) err(CODE.FORBIDDEN, '待办项不存在或无权限'); return t;
}
function ownStudyNote(userId, noteId) {
  const n = g(`SELECT ${C.snote} FROM t_study_note WHERE id = ? AND user_id = ?`, noteId, userId);
  if (!n) err(CODE.FORBIDDEN, '备注不存在或无权限'); return n;
}
function ownAiModel(userId, id) {
  const m = g('SELECT * FROM t_ai_model_config WHERE id = ? AND user_id = ?', id, userId);
  if (!m) err(CODE.FORBIDDEN, '模型配置不存在或无权限'); return m;
}

const normCat = (c) => (c === 'longterm' ? 'longterm' : 'daily');

// ---------- 路由表 ----------
const routes = [];
const add = (method, pattern, handler, { auth = true } = {}) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/\{(\w+)\}/g, (_, k) => {
    keys.push(k);
    // 数字主键用 (\d+)；source（toutiao/weibo）等非数字参数用 ([^/]+)
    return k === 'source' ? '([^/]+)' : '(\\d+)';
  }) + '$');
  routes.push({ method, rx, keys, handler, auth });
};

// ===== 认证 =====
add('POST', '/api/auth/login', ({ body }) => {
  const user = g(`SELECT ${C.user}, password FROM t_user WHERE phone = ?`, body.phone);
  if (!user || !verifyPassword(body.password, user.password)) err(CODE.UNAUTHORIZED, '手机号或密码错误');
  if (user.status === 0) err(CODE.FORBIDDEN, '账号已被禁用');
  return loginResponse(user, createSession(user.id));
}, { auth: false });

add('POST', '/api/auth/register', ({ body }) => {
  if (count('SELECT COUNT(*) AS c FROM t_user WHERE phone = ?', body.phone) > 0) err(CODE.PARAM, '该手机号已注册');
  const now = nowIso();
  const r = run('INSERT INTO t_user (phone, password, nickname, status, role, create_time, update_time) VALUES (?, ?, ?, 1, ?, ?, ?)',
    body.phone, hashPassword(body.password), body.nickname, 'USER', now, now);
  const userId = r.lastInsertRowid;
  // 自增 id 若复用了已删除用户的旧 id，清理其残留菜单，避免新账号"继承"孤儿数据（如出现两个首页）
  run('DELETE FROM t_user_menu WHERE user_id = ?', userId);
  run('INSERT INTO t_user_menu (user_id, title, icon, sort_order, is_enabled, create_time, update_time) VALUES (?, ?, ?, 0, 1, ?, ?)',
    userId, '首页', 'house.fill', now, now);
  const user = g(`SELECT ${C.user} FROM t_user WHERE id = ?`, userId);
  return loginResponse(user, createSession(userId));
}, { auth: false });

add('PUT', '/api/auth/profile', ({ userId, body }) => {
  run('UPDATE t_user SET nickname = ?, avatar = ?, motto = ?, update_time = ? WHERE id = ?',
    body.nickname, body.avatar, body.motto, nowIso(), userId);
  return ok(null, '资料更新成功');
});
add('PUT', '/api/auth/password', ({ userId, body }) => {
  const user = g('SELECT * FROM t_user WHERE id = ?', userId);
  if (!user) err(CODE.UNAUTHORIZED, '登录已过期，请重新登录');
  if (!verifyPassword(body.oldPassword, user.password)) err(CODE.PARAM, '原密码不正确');
  run('UPDATE t_user SET password = ?, update_time = ? WHERE id = ?', hashPassword(body.newPassword), nowIso(), userId);
  return ok(null, '密码修改成功');
});
add('GET', '/api/auth/session-ttl', () => ok({ days: getTtlDays() }));
add('PUT', '/api/auth/import-db', ({ body }) => {
  try {
    require('./db').importDb(String(body.file || ''));
  } catch (e) {
    err(CODE.PARAM, e.message || '导入失败');
  }
  return ok(null, '项目数据导入成功，请重新登录');
});
add('PUT', '/api/auth/session-ttl', ({ body }) => {
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 0 || days > 3650) err(CODE.PARAM, '有效期需为 0-3650 之间的整数天（0 为永久）');
  run('INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)', TTL_KEY, String(days));
  // 现有会话统一刷新为新有效期，立即生效
  run('UPDATE t_session SET expire_time = ?', days > 0 ? futureIso(days) : null);
  return ok({ days }, '登录有效期已更新');
});

// ===== 菜单 =====
add('GET', '/api/menus', ({ userId }) =>
  ok(q(`SELECT ${C.menu} FROM t_user_menu WHERE user_id = ? AND is_enabled = 1 ORDER BY sort_order ASC`, userId)));
add('POST', '/api/menus', ({ userId, body }) => {
  const now = nowIso();
  const c = count('SELECT COUNT(*) AS c FROM t_user_menu WHERE user_id = ?', userId);
  const r = run('INSERT INTO t_user_menu (user_id, title, icon, sort_order, is_enabled, create_time, update_time) VALUES (?, ?, ?, ?, 1, ?, ?)',
    userId, body.title, body.icon && body.icon.trim() ? body.icon : 'folder', c, now, now);
  return ok(g(`SELECT ${C.menu} FROM t_user_menu WHERE id = ?`, r.lastInsertRowid), '添加成功');
});
add('PUT', '/api/menus/{menuId}', ({ userId, params, body }) => {
  const m = ownMenu(userId, params.menuId);
  const title = body.title;
  if (m.title === '首页' && title !== '首页') err(CODE.PARAM, '首页菜单不允许修改名称');
  run('UPDATE t_user_menu SET title = ?, icon = ?, update_time = ? WHERE id = ? AND user_id = ?',
    title, body.icon && body.icon.trim() ? body.icon : 'folder', nowIso(), params.menuId, userId);
  return ok(null, '更新成功');
});
add('DELETE', '/api/menus/{menuId}', ({ userId, params }) => {
  const m = ownMenu(userId, params.menuId);
  if (m.title === '首页') err(CODE.PARAM, '首页菜单不允许删除');
  run('DELETE FROM t_menu_card WHERE menu_id = ?', m.id);
  run('DELETE FROM t_user_menu WHERE id = ?', m.id);
  return ok(null, '删除成功');
});
add('PUT', '/api/menus/reorder', ({ userId, body }) => {
  (body.menuIds || []).forEach((id, i) => run('UPDATE t_user_menu SET sort_order = ? WHERE id = ? AND user_id = ?', i, id, userId));
  return ok(null, '排序成功');
});

// ===== 文件夹 =====
add('GET', '/api/menus/{menuId}/folders', ({ userId, params }) => {
  ownMenu(userId, params.menuId);
  const folders = q(`SELECT ${C.folder} FROM t_menu_folder WHERE menu_id = ? AND user_id = ? ORDER BY sort_order ASC`, params.menuId, userId);
  for (const f of folders) f.cardCount = count('SELECT COUNT(*) AS c FROM t_menu_card WHERE menu_id = ? AND folder_id = ?', f.menuId, f.id);
  return ok(folders);
});
add('POST', '/api/menus/{menuId}/folders', ({ userId, params, body }) => {
  ownMenu(userId, params.menuId);
  const now = nowIso();
  const c = count('SELECT COUNT(*) AS c FROM t_menu_folder WHERE menu_id = ? AND user_id = ?', params.menuId, userId);
  const r = run('INSERT INTO t_menu_folder (menu_id, user_id, title, icon, sort_order, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
    params.menuId, userId, body.title, body.icon && body.icon.trim() ? body.icon : 'folder.fill', c, now, now);
  const f = g(`SELECT ${C.folder} FROM t_menu_folder WHERE id = ?`, r.lastInsertRowid);
  f.cardCount = 0;
  return ok(f, '添加成功');
});
add('PUT', '/api/menus/{menuId}/folders/{folderId}', ({ userId, params, body }) => {
  ownFolder(userId, params.folderId);
  run('UPDATE t_menu_folder SET title = ?, icon = ?, update_time = ? WHERE id = ? AND user_id = ?',
    body.title, body.icon && body.icon.trim() ? body.icon : 'folder.fill', nowIso(), params.folderId, userId);
  return ok(null, '更新成功');
});
add('DELETE', '/api/menus/{menuId}/folders/{folderId}', ({ userId, params }) => {
  ownFolder(userId, params.folderId);
  run('DELETE FROM t_menu_card WHERE folder_id = ?', params.folderId);
  run('DELETE FROM t_menu_folder WHERE id = ?', params.folderId);
  return ok(null, '删除成功');
});

// ===== 卡片 =====
add('GET', '/api/menus/{menuId}/cards', ({ userId, params, query }) => {
  ownMenu(userId, params.menuId);
  const folderId = query.folderId != null && query.folderId !== '' ? Number(query.folderId) : null;
  if (folderId != null) return ok(q(`SELECT ${C.card} FROM t_menu_card WHERE menu_id = ? AND folder_id = ? ORDER BY sort_order ASC`, params.menuId, folderId));
  return ok(q(`SELECT ${C.card} FROM t_menu_card WHERE menu_id = ? AND folder_id IS NULL ORDER BY sort_order ASC`, params.menuId));
});
add('GET', '/api/menus/{menuId}/card-count', ({ userId, params }) => {
  ownMenu(userId, params.menuId);
  return ok(count('SELECT COUNT(*) AS c FROM t_menu_card WHERE menu_id = ?', params.menuId));
});
add('POST', '/api/menus/{menuId}/cards', ({ userId, params, body }) => {
  ownMenu(userId, params.menuId);
  if (body.folderId != null) ownFolder(userId, body.folderId);
  const now = nowIso();
  const c = body.folderId != null
    ? count('SELECT COUNT(*) AS c FROM t_menu_card WHERE menu_id = ? AND folder_id = ?', params.menuId, body.folderId)
    : count('SELECT COUNT(*) AS c FROM t_menu_card WHERE menu_id = ? AND folder_id IS NULL', params.menuId);
  const r = run('INSERT INTO t_menu_card (menu_id, folder_id, user_id, title, description, url, icon_url, sort_order, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    params.menuId, body.folderId != null ? body.folderId : null, userId, body.title, body.description, body.url, body.iconUrl, c, now, now);
  return ok(g(`SELECT ${C.card} FROM t_menu_card WHERE id = ?`, r.lastInsertRowid), '添加成功');
});
add('PUT', '/api/menus/{menuId}/cards/{cardId}', ({ userId, params, body }) => {
  ownCard(userId, params.cardId);
  if (body.menuId != null) ownMenu(userId, body.menuId);
  if (body.folderId != null) ownFolder(userId, body.folderId);
  const menuId = body.menuId != null ? body.menuId : params.menuId;
  if (body.menuId != null) {
    run('UPDATE t_menu_card SET title=?, description=?, url=?, icon_url=?, folder_id=?, menu_id=?, update_time=? WHERE id=? AND user_id=?',
      body.title, body.description, body.url, body.iconUrl, body.folderId != null ? body.folderId : null, body.menuId, nowIso(), params.cardId, userId);
  } else {
    run('UPDATE t_menu_card SET title=?, description=?, url=?, icon_url=?, folder_id=?, update_time=? WHERE id=? AND user_id=?',
      body.title, body.description, body.url, body.iconUrl, body.folderId != null ? body.folderId : null, nowIso(), params.cardId, userId);
  }
  void menuId;
  return ok(null, '更新成功');
});
add('PUT', '/api/menus/{menuId}/cards/{cardId}/move', ({ userId, params, body }) => {
  const card = ownCard(userId, params.cardId);
  ownMenu(userId, body.targetMenuId);
  if (body.targetMenuId === card.menuId) return ok(null, '移动成功');
  const c = count('SELECT COUNT(*) AS c FROM t_menu_card WHERE menu_id = ? AND folder_id IS NULL', body.targetMenuId);
  run('UPDATE t_menu_card SET menu_id = ?, folder_id = NULL, sort_order = ?, update_time = ? WHERE id = ? AND user_id = ?',
    body.targetMenuId, c, nowIso(), params.cardId, userId);
  return ok(null, '移动成功');
});
add('PUT', '/api/cards/reorder', ({ userId, body }) => {
  (body.cardIds || []).forEach((id, i) => run('UPDATE t_menu_card SET sort_order = ? WHERE id = ? AND user_id = ?', i, id, userId));
  return ok(null, '排序成功');
});
add('DELETE', '/api/menus/{menuId}/cards/{cardId}', ({ userId, params }) => {
  ownCard(userId, params.cardId);
  run('DELETE FROM t_menu_card WHERE id = ?', params.cardId);
  return ok(null, '删除成功');
});

// ===== 每日便签 =====
add('GET', '/api/daily-notes', ({ userId, query }) => {
  const date = query.date && query.date.trim() ? query.date : todayDate();
  return ok(q(`SELECT ${C.note} FROM t_daily_note WHERE user_id = ? AND category = 'daily' AND note_date = ? ORDER BY sort_order ASC, create_time ASC`, userId, date));
});
add('GET', '/api/daily-notes/longterm', ({ userId }) => {
  const pending = q(`SELECT ${C.note} FROM t_daily_note WHERE user_id = ? AND category = 'longterm' AND is_completed = 0 ORDER BY sort_order ASC, create_time ASC`, userId);
  if (pending.length >= 5) return ok(pending);
  const slots = 5 - pending.length;
  const done = q(`SELECT ${C.note} FROM t_daily_note WHERE user_id = ? AND category = 'longterm' AND is_completed = 1 ORDER BY update_time DESC LIMIT ${slots}`, userId);
  return ok([...pending, ...done]);
});
add('GET', '/api/daily-notes/history', ({ userId, query }) => {
  const cat = normCat(query.category);
  let sql = `SELECT ${C.note} FROM t_daily_note WHERE user_id = ? AND category = ?`;
  const p = [userId, cat];
  if (query.start && query.start.trim()) { sql += ' AND note_date >= ?'; p.push(query.start); }
  if (query.end && query.end.trim()) { sql += ' AND note_date <= ?'; p.push(query.end); }
  sql += ' ORDER BY note_date DESC, create_time DESC';
  return ok(q(sql, ...p));
});
add('POST', '/api/daily-notes', ({ userId, body }) => {
  const cat = normCat(body.category);
  const today = todayDate();
  const now = nowIso();
  const c = count('SELECT COUNT(*) AS c FROM t_daily_note WHERE user_id = ? AND category = ? AND note_date = ?', userId, cat, today);
  const r = run('INSERT INTO t_daily_note (user_id, content, is_completed, category, note_date, sort_order, create_time, update_time) VALUES (?, ?, 0, ?, ?, ?, ?, ?)',
    userId, body.content, cat, today, c, now, now);
  return ok(g(`SELECT ${C.note} FROM t_daily_note WHERE id = ?`, r.lastInsertRowid), '添加成功');
});
add('PUT', '/api/daily-notes/{noteId}', ({ userId, params, body }) => {
  ownNote(userId, params.noteId);
  const sets = []; const p = [];
  if (body.content != null) { sets.push('content = ?'); p.push(body.content); }
  if (body.isCompleted != null) { sets.push('is_completed = ?'); p.push(body.isCompleted); }
  if (sets.length) { sets.push('update_time = ?'); p.push(nowIso(), params.noteId, userId); run(`UPDATE t_daily_note SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, ...p); }
  return ok(null, '更新成功');
});
add('DELETE', '/api/daily-notes/{noteId}', ({ userId, params }) => {
  ownNote(userId, params.noteId);
  run('DELETE FROM t_daily_note WHERE id = ?', params.noteId);
  return ok(null, '删除成功');
});

// ===== 学习路线 =====
add('GET', '/api/study/routes', ({ userId }) => {
  const routes = q(`SELECT ${C.route} FROM t_study_route WHERE user_id = ? ORDER BY sort_order ASC, create_time ASC`, userId);
  for (const r of routes) {
    r.todoCount = count('SELECT COUNT(*) AS c FROM t_study_todo WHERE route_id = ?', r.id);
    r.completedCount = count('SELECT COUNT(*) AS c FROM t_study_todo WHERE route_id = ? AND is_completed = 1', r.id);
  }
  return ok(routes);
});
add('POST', '/api/study/routes', ({ userId, body }) => {
  const now = nowIso();
  const c = count('SELECT COUNT(*) AS c FROM t_study_route WHERE user_id = ?', userId);
  const r = run('INSERT INTO t_study_route (user_id, title, description, sort_order, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)',
    userId, body.title, body.description, c, now, now);
  return ok(g(`SELECT ${C.route} FROM t_study_route WHERE id = ?`, r.lastInsertRowid), '添加成功');
});
add('PUT', '/api/study/routes/{routeId}', ({ userId, params, body }) => {
  ownRoute(userId, params.routeId);
  run('UPDATE t_study_route SET title = ?, description = ?, update_time = ? WHERE id = ? AND user_id = ?',
    body.title, body.description, nowIso(), params.routeId, userId);
  return ok(null, '更新成功');
});
add('DELETE', '/api/study/routes/{routeId}', ({ userId, params }) => {
  ownRoute(userId, params.routeId);
  run(`DELETE FROM t_study_note WHERE todo_id IN (SELECT id FROM t_study_todo WHERE route_id = ?)`, params.routeId);
  run('DELETE FROM t_study_todo WHERE route_id = ?', params.routeId);
  run('DELETE FROM t_study_route WHERE id = ?', params.routeId);
  return ok(null, '删除成功');
});
add('GET', '/api/study/routes/{routeId}/todos', ({ userId, params }) => {
  ownRoute(userId, params.routeId);
  return ok(q(`SELECT ${C.todo} FROM t_study_todo WHERE route_id = ? AND user_id = ? ORDER BY sort_order ASC, create_time ASC`, params.routeId, userId));
});
add('POST', '/api/study/routes/{routeId}/todos', ({ userId, params, body }) => {
  ownRoute(userId, params.routeId);
  const now = nowIso();
  const c = count('SELECT COUNT(*) AS c FROM t_study_todo WHERE route_id = ? AND user_id = ?', params.routeId, userId);
  const r = run('INSERT INTO t_study_todo (route_id, user_id, title, is_completed, sort_order, create_time, update_time) VALUES (?, ?, ?, 0, ?, ?, ?)',
    params.routeId, userId, body.title, c, now, now);
  return ok(g(`SELECT ${C.todo} FROM t_study_todo WHERE id = ?`, r.lastInsertRowid), '添加成功');
});
add('PUT', '/api/study/routes/{routeId}/todos/{todoId}', ({ userId, params, body }) => {
  ownRoute(userId, params.routeId); ownTodo(userId, params.todoId);
  if (body.isCompleted != null) run('UPDATE t_study_todo SET title = ?, is_completed = ?, update_time = ? WHERE id = ? AND user_id = ?', body.title, body.isCompleted, nowIso(), params.todoId, userId);
  else run('UPDATE t_study_todo SET title = ?, update_time = ? WHERE id = ? AND user_id = ?', body.title, nowIso(), params.todoId, userId);
  return ok(null, '更新成功');
});
add('DELETE', '/api/study/routes/{routeId}/todos/{todoId}', ({ userId, params }) => {
  ownRoute(userId, params.routeId); ownTodo(userId, params.todoId);
  run('DELETE FROM t_study_note WHERE todo_id = ?', params.todoId);
  run('DELETE FROM t_study_todo WHERE id = ?', params.todoId);
  return ok(null, '删除成功');
});
add('GET', '/api/study/todos/{todoId}/notes', ({ userId, params }) => {
  ownTodo(userId, params.todoId);
  return ok(q(`SELECT ${C.snote} FROM t_study_note WHERE todo_id = ? AND user_id = ? ORDER BY sort_order ASC, create_time ASC`, params.todoId, userId));
});
add('POST', '/api/study/todos/{todoId}/notes', ({ userId, params, body }) => {
  ownTodo(userId, params.todoId);
  const now = nowIso();
  const c = count('SELECT COUNT(*) AS c FROM t_study_note WHERE todo_id = ? AND user_id = ?', params.todoId, userId);
  const r = run('INSERT INTO t_study_note (todo_id, user_id, content, is_completed, sort_order, create_time, update_time) VALUES (?, ?, ?, 0, ?, ?, ?)',
    params.todoId, userId, body.content, c, now, now);
  return ok(g(`SELECT ${C.snote} FROM t_study_note WHERE id = ?`, r.lastInsertRowid), '添加成功');
});
add('PUT', '/api/study/todos/{todoId}/notes/{noteId}', ({ userId, params, body }) => {
  ownTodo(userId, params.todoId); ownStudyNote(userId, params.noteId);
  if (body.isCompleted != null) run('UPDATE t_study_note SET content = ?, is_completed = ?, update_time = ? WHERE id = ? AND user_id = ?', body.content, body.isCompleted, nowIso(), params.noteId, userId);
  else run('UPDATE t_study_note SET content = ?, update_time = ? WHERE id = ? AND user_id = ?', body.content, nowIso(), params.noteId, userId);
  return ok(null, '更新成功');
});
add('DELETE', '/api/study/todos/{todoId}/notes/{noteId}', ({ userId, params }) => {
  ownTodo(userId, params.todoId); ownStudyNote(userId, params.noteId);
  run('DELETE FROM t_study_note WHERE id = ?', params.noteId);
  return ok(null, '删除成功');
});

// ===== 插件市场 =====
function installedKeys(userId) {
  const set = new Set();
  q('SELECT plugin_key AS k FROM t_user_menu WHERE user_id = ? AND plugin_key IS NOT NULL', userId).forEach((r) => set.add(r.k));
  q('SELECT plugin_key AS k FROM t_menu_card WHERE user_id = ? AND plugin_key IS NOT NULL', userId).forEach((r) => set.add(r.k));
  return set;
}
add('GET', '/api/plugins', ({ userId }) => {
  const keys = installedKeys(userId);
  const plugins = q(`SELECT id, plugin_key AS pluginKey, name, description, icon, category,
    CASE WHEN type IS NULL THEN 'menu' ELSE type END AS type, version, sort_order AS sortOrder
    FROM t_plugin WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC`);
  return ok(plugins.map((p) => ({ ...p, installed: keys.has(p.pluginKey) })));
});
add('POST', '/api/plugins/{pluginId}/install', ({ userId, params, body }) => {
  const plugin = g('SELECT * FROM t_plugin WHERE id = ?', params.pluginId);
  if (!plugin || plugin.is_enabled === 0) err(CODE.PARAM, '插件不存在或已下架');
  if (installedKeys(userId).has(plugin.plugin_key)) return ok(null, '安装成功');
  const now = nowIso();
  if (plugin.type === 'card') {
    const menuId = body && body.menuId != null ? Number(body.menuId) : null;
    if (menuId == null) err(CODE.PARAM, '请选择要安装到的菜单');
    const target = g('SELECT * FROM t_user_menu WHERE id = ? AND user_id = ?', menuId, userId);
    if (!target) err(CODE.PARAM, '目标菜单不存在');
    if (target.plugin_key) err(CODE.PARAM, '插件菜单下不能安装插件卡片');
    const c = count('SELECT COUNT(*) AS c FROM t_menu_card WHERE menu_id = ?', menuId);
    run('INSERT INTO t_menu_card (menu_id, user_id, title, description, url, plugin_key, sort_order, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      menuId, userId, plugin.name, plugin.description, 'game://' + plugin.plugin_key + '/index.html', plugin.plugin_key, c, now, now);
  } else {
    const c = count('SELECT COUNT(*) AS c FROM t_user_menu WHERE user_id = ?', userId);
    run('INSERT INTO t_user_menu (user_id, title, icon, plugin_key, sort_order, is_enabled, create_time, update_time) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
      userId, plugin.name, plugin.icon, plugin.plugin_key, c, now, now);
  }
  return ok(null, '安装成功');
});
add('DELETE', '/api/plugins/{pluginId}/uninstall', ({ userId, params }) => {
  const plugin = g('SELECT * FROM t_plugin WHERE id = ?', params.pluginId);
  if (!plugin || plugin.is_enabled === 0) err(CODE.PARAM, '插件不存在或已下架');
  run('DELETE FROM t_user_menu WHERE user_id = ? AND plugin_key = ?', userId, plugin.plugin_key);
  run('DELETE FROM t_menu_card WHERE user_id = ? AND plugin_key = ?', userId, plugin.plugin_key);
  return ok(null, '卸载成功');
});

// ===== 问题反馈 =====
add('POST', '/api/feedback', ({ userId, body }) => {
  const user = g('SELECT phone FROM t_user WHERE id = ?', userId);
  if (!user) err(CODE.UNAUTHORIZED, '用户不存在');
  const now = nowIso();
  const r = run('INSERT INTO t_feedback (user_id, reporter_name, reporter_account, feedback_type, content, status, create_time, update_time) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    userId, body.reporterName, user.phone, body.feedbackType, body.content, now, now);
  return ok(g(`SELECT ${C.feedback} FROM t_feedback WHERE id = ?`, r.lastInsertRowid), '提交成功');
});
add('GET', '/api/feedback', ({ userId }) =>
  ok(q(`SELECT ${C.feedback} FROM t_feedback WHERE user_id = ? ORDER BY create_time DESC LIMIT 200`, userId)));

// ===== 系统通知 =====
add('GET', '/api/notifications', ({ userId }) => {
  const rels = q('SELECT notification_id AS nid, is_read AS isRead, read_time AS readTime FROM t_notification_user WHERE user_id = ? ORDER BY id DESC LIMIT 100', userId);
  if (!rels.length) return ok([]);
  const out = [];
  for (const rel of rels) {
    const n = g('SELECT id, title, content, sender_name AS senderName, type, extra, create_time AS createTime FROM t_notification WHERE id = ?', rel.nid);
    if (!n) continue;
    out.push({ ...n, isRead: rel.isRead, readTime: rel.readTime });
  }
  out.sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
  return ok(out);
});
add('GET', '/api/notifications/unread-count', ({ userId }) =>
  ok({ count: count('SELECT COUNT(*) AS c FROM t_notification_user WHERE user_id = ? AND is_read = 0', userId) }));
add('PUT', '/api/notifications/{notificationId}/read', ({ userId, params }) => {
  run('UPDATE t_notification_user SET is_read = 1, read_time = ? WHERE user_id = ? AND notification_id = ? AND is_read = 0', nowIso(), userId, params.notificationId);
  return ok(null, '已标记为已读');
});
add('PUT', '/api/notifications/read-all', ({ userId }) => {
  run('UPDATE t_notification_user SET is_read = 1, read_time = ? WHERE user_id = ? AND is_read = 0', nowIso(), userId);
  return ok(null, '已全部标记为已读');
});

// ===== 管理员：账号 / 通知 / 版本 =====
function sendNotification(senderId, body) {
  const sender = g('SELECT nickname FROM t_user WHERE id = ?', senderId);
  if (!sender) err(CODE.UNAUTHORIZED, '发送人不存在');
  let receivers;
  if (body.scope === 'ALL') receivers = q('SELECT id FROM t_user');
  else {
    const ids = (body.receiverIds || []).filter((x) => x != null).map(Number).filter((v, i, a) => a.indexOf(v) === i);
    if (!ids.length) err(CODE.PARAM, '请选择接收用户');
    receivers = ids.map((id) => g('SELECT id FROM t_user WHERE id = ?', id)).filter(Boolean);
  }
  if (!receivers.length) err(CODE.PARAM, '接收用户不存在');
  const now = nowIso();
  const r = run('INSERT INTO t_notification (title, content, sender_id, sender_name, type, extra, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
    body.title, body.content, senderId, sender.nickname, body.type || 'GENERAL', body.extra || null, now);
  const ins = getDb().prepare('INSERT INTO t_notification_user (notification_id, user_id, is_read, read_time) VALUES (?, ?, 0, NULL)');
  for (const u of receivers) ins.run(r.lastInsertRowid, u.id);
  return receivers.length;
}
add('GET', '/api/admin/users', ({ userId }) => {
  requireAdmin(userId);
  return ok(q('SELECT id, phone, nickname, role, status, create_time AS createTime FROM t_user ORDER BY create_time DESC').map((u) => ({ ...u })));
});
add('POST', '/api/admin/users', ({ userId, body }) => {
  requireAdmin(userId);
  if (count('SELECT COUNT(*) AS c FROM t_user WHERE phone = ?', body.phone) > 0) err(CODE.PARAM, '该手机号已注册');
  const now = nowIso();
  const r = run('INSERT INTO t_user (phone, password, nickname, status, role, create_time, update_time) VALUES (?, ?, ?, 1, ?, ?, ?)',
    body.phone, hashPassword(body.password), body.nickname, body.role && body.role.trim() ? body.role : 'USER', now, now);
  const u = g('SELECT id, phone, nickname, role, status, create_time AS createTime FROM t_user WHERE id = ?', r.lastInsertRowid);
  return ok(u, '创建成功');
});
add('PUT', '/api/admin/users/{userId}/role', ({ userId: operatorId, params, body }) => {
  requireAdmin(operatorId);
  const target = Number(params.userId);
  if (operatorId === target) err(CODE.PARAM, '不能修改自己的角色');
  if (!g('SELECT id FROM t_user WHERE id = ?', target)) err(CODE.PARAM, '用户不存在');
  run('UPDATE t_user SET role = ?, update_time = ? WHERE id = ?', body.role, nowIso(), target);
  return ok(null, '角色配置成功');
});
add('POST', '/api/admin/notifications', ({ userId, body }) => {
  requireAdmin(userId);
  return ok({ receiverCount: sendNotification(userId, body) }, '发送成功');
});
add('POST', '/api/admin/versions', ({ userId, body }) => {
  requireAdmin(userId);
  const mac = body.macFile && body.macFile.trim(); const win = body.winFile && body.winFile.trim();
  if (!mac && !win) err(CODE.PARAM, '请至少上传一个平台的安装包');
  const publisher = g('SELECT nickname FROM t_user WHERE id = ?', userId);
  if (!publisher) err(CODE.UNAUTHORIZED, '发布人不存在');
  const notifyAll = body.notifyAll == null ? true : !!body.notifyAll;
  const now = nowIso();
  const r = run('INSERT INTO t_app_version (version, release_notes, mac_file, mac_size, win_file, win_size, notify_users, publisher_id, publisher_name, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    String(body.version).trim(), body.releaseNotes || null, mac || null, mac ? external.sizeOf(mac) : null, win || null, win ? external.sizeOf(win) : null, notifyAll ? 1 : 0, userId, publisher.nickname, now);
  const rec = g('SELECT * FROM t_app_version WHERE id = ?', r.lastInsertRowid);
  if (notifyAll) {
    const extra = JSON.stringify({
      version: rec.version,
      ...(rec.mac_file ? { mac: 'download://local/' + rec.mac_file, macSize: rec.mac_size } : {}),
      ...(rec.win_file ? { win: 'download://local/' + rec.win_file, winSize: rec.win_size } : {}),
    });
    sendNotification(userId, {
      title: 'MTable 新版本 v' + rec.version + ' 发布',
      content: body.releaseNotes || ('新版本 ' + rec.version + ' 已发布，欢迎更新体验。'),
      scope: 'ALL', type: 'VERSION', extra,
    });
  }
  return ok(null, '发布成功');
});

// ===== 版本更新（用户端） =====
add('GET', '/api/version/latest', () => {
  const latest = g('SELECT * FROM t_app_version ORDER BY id DESC LIMIT 1');
  if (!latest) return ok(null);
  return ok({
    version: latest.version, releaseNotes: latest.release_notes,
    macUrl: latest.mac_file ? 'download://local/' + latest.mac_file : null, macSize: latest.mac_size,
    winUrl: latest.win_file ? 'download://local/' + latest.win_file : null, winSize: latest.win_size,
    publishTime: latest.create_time,
  });
}, { auth: false });

// ===== AI 模型配置 =====
function maskApiKey(key) {
  if (!key || !key.trim()) return '';
  const k = key.trim();
  if (k.length <= 8) return '****';
  return k.slice(0, 3) + '****' + k.slice(-4);
}
function aiVO(cfg) {
  return { id: cfg.id, name: cfg.name, provider: cfg.provider, baseUrl: cfg.base_url, maskedApiKey: maskApiKey(cfg.api_key), modelId: cfg.model_id, isActive: cfg.is_active, createTime: cfg.create_time };
}
add('GET', '/api/ai/models', ({ userId }) =>
  ok(q('SELECT * FROM t_ai_model_config WHERE user_id = ? ORDER BY is_active DESC, update_time DESC', userId).map(aiVO)));
add('POST', '/api/ai/models', ({ userId, body }) => {
  const now = nowIso();
  const c = count('SELECT COUNT(*) AS c FROM t_ai_model_config WHERE user_id = ?', userId);
  const r = run('INSERT INTO t_ai_model_config (user_id, name, provider, base_url, api_key, model_id, is_active, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    userId, String(body.name).trim(), String(body.provider).trim(), String(body.baseUrl).trim(), (body.apiKey || '').trim(), String(body.modelId).trim(), c === 0 ? 1 : 0, now, now);
  return ok(aiVO(g('SELECT * FROM t_ai_model_config WHERE id = ?', r.lastInsertRowid)), '添加成功');
});
add('PUT', '/api/ai/models/{id}', ({ userId, params, body }) => {
  const cfg = ownAiModel(userId, params.id);
  const apiKey = body.apiKey && body.apiKey.trim() ? body.apiKey.trim() : cfg.api_key;
  run('UPDATE t_ai_model_config SET name=?, provider=?, base_url=?, api_key=?, model_id=?, update_time=? WHERE id=? AND user_id=?',
    String(body.name).trim(), String(body.provider).trim(), String(body.baseUrl).trim(), apiKey, String(body.modelId).trim(), nowIso(), params.id, userId);
  return ok(aiVO(g('SELECT * FROM t_ai_model_config WHERE id = ?', params.id)), '更新成功');
});
add('DELETE', '/api/ai/models/{id}', ({ userId, params }) => {
  const cfg = ownAiModel(userId, params.id);
  run('DELETE FROM t_ai_model_config WHERE id = ?', params.id);
  if (cfg.is_active === 1) {
    const next = g('SELECT id FROM t_ai_model_config WHERE user_id = ? ORDER BY update_time DESC LIMIT 1', userId);
    if (next) run('UPDATE t_ai_model_config SET is_active = 1 WHERE id = ?', next.id);
  }
  return ok(null, '删除成功');
});
add('PUT', '/api/ai/models/{id}/active', ({ userId, params }) => {
  ownAiModel(userId, params.id);
  run('UPDATE t_ai_model_config SET is_active = 0 WHERE user_id = ?', userId);
  run('UPDATE t_ai_model_config SET is_active = 1 WHERE id = ? AND user_id = ?', params.id, userId);
  return ok(null, '已启用');
});
add('POST', '/api/ai/models/test', async ({ userId, body }) => {
  let { baseUrl, modelId, apiKey } = body;
  if (body.id != null) {
    const cfg = ownAiModel(userId, body.id);
    if (!apiKey || !apiKey.trim()) apiKey = cfg.api_key;
    baseUrl = cfg.base_url; modelId = cfg.model_id;
  }
  if (!apiKey || !apiKey.trim()) err(CODE.PARAM, '请先填写 API 密钥');
  try { const r = await external.testChat(baseUrl.trim(), apiKey, modelId.trim()); return ok({ ...r, ok: true }); }
  catch (e) { return ok({ ok: false, error: e.message }); }
});
add('POST', '/api/ai/models/remote-list', async ({ userId, body }) => {
  let { baseUrl, apiKey } = body;
  if (body.id != null) {
    const cfg = ownAiModel(userId, body.id);
    if (!apiKey || !apiKey.trim()) apiKey = cfg.api_key;
    baseUrl = cfg.base_url;
  }
  if (!apiKey || !apiKey.trim()) return ok({ ok: false, models: [] });
  try { return ok({ ok: true, models: await external.listModels(baseUrl.trim(), apiKey) }); }
  catch { return ok({ ok: false, models: [] }); }
});

// ===== AI 任务历史 =====
function normalizeMessages(messages) {
  return (messages || []).map((m) => ({ role: String(m.role).toLowerCase() === 'assistant' ? 'assistant' : 'user', content: m.content }));
}
function resolveTitle(title, messages) {
  if (title && title.trim()) return trunc(title.replace(/\s+/g, ' ').trim(), 30);
  const first = messages.find((m) => m.role === 'user');
  if (first) { const t = trunc(first.content.replace(/\s+/g, ' ').trim(), 30); if (t) return t; }
  return '新任务';
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
add('POST', '/api/ai/tasks', ({ userId, body }) => {
  const messages = normalizeMessages(body.messages);
  const title = resolveTitle(body.title, messages);
  const json = JSON.stringify(messages);
  const now = nowIso();
  if (body.id != null) {
    const t = g('SELECT id FROM t_ai_chat_task WHERE id = ? AND user_id = ?', body.id, userId);
    if (!t) err(CODE.FORBIDDEN, '任务不存在或无权限');
    run('UPDATE t_ai_chat_task SET title=?, message_count=?, messages=?, update_time=? WHERE id=? AND user_id=?', title, messages.length, json, now, body.id, userId);
    return ok(taskVO(g('SELECT * FROM t_ai_chat_task WHERE id = ?', body.id), null), '保存成功');
  }
  const r = run('INSERT INTO t_ai_chat_task (user_id, title, message_count, messages, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)', userId, title, messages.length, json, now, now);
  return ok(taskVO(g('SELECT * FROM t_ai_chat_task WHERE id = ?', r.lastInsertRowid), null), '保存成功');
});
add('GET', '/api/ai/tasks', ({ userId }) =>
  ok(q('SELECT id, user_id AS userId, title, message_count AS messageCount, create_time AS createTime, update_time AS updateTime FROM t_ai_chat_task WHERE user_id = ? ORDER BY update_time DESC LIMIT 100', userId).map((t) => taskVO(t, null))));
add('GET', '/api/ai/tasks/{id}', ({ userId, params }) => {
  const t = g('SELECT * FROM t_ai_chat_task WHERE id = ? AND user_id = ?', params.id, userId);
  if (!t) err(CODE.FORBIDDEN, '任务不存在或无权限');
  let msgs = []; try { msgs = JSON.parse(t.messages); } catch { err(CODE.INTERNAL, '任务数据已损坏，无法恢复'); }
  return ok(taskVO(t, msgs));
});
add('DELETE', '/api/ai/tasks/{id}', ({ userId, params }) => {
  if (!g('SELECT id FROM t_ai_chat_task WHERE id = ? AND user_id = ?', params.id, userId)) err(CODE.FORBIDDEN, '任务不存在或无权限');
  run('DELETE FROM t_ai_chat_task WHERE id = ?', params.id);
  return ok(null, '删除成功');
});
function taskVO(t, messages) {
  return { id: t.id, title: t.title, messageCount: t.message_count != null ? t.message_count : t.messageCount, messages, createTime: t.create_time != null ? t.create_time : t.createTime, updateTime: t.update_time != null ? t.update_time : t.updateTime };
}

// ===== 壁纸 =====
function resolveCurrentImage(setting) {
  if (setting && setting.pinned_image_id != null) {
    const pinned = g(`SELECT ${C.wpimg} FROM t_wallpaper_image WHERE id = ?`, setting.pinned_image_id);
    if (pinned) return pinned;
  }
  return g(`SELECT ${C.wpimg} FROM t_wallpaper_image ORDER BY image_date DESC, id DESC LIMIT 1`);
}
function wallpaperVO(userId) {
  const setting = g('SELECT * FROM t_wallpaper_setting WHERE user_id = ?', userId);
  const current = resolveCurrentImage(setting);
  const vo = setting
    ? { enabled: setting.enabled === 1, pinnedImageId: setting.pinned_image_id, brightness: setting.brightness, blur: setting.blur }
    : { enabled: false, pinnedImageId: null, brightness: 100, blur: 0 };
  vo.mode = vo.pinnedImageId == null ? 'auto' : 'pinned';
  if (current) { vo.url = current.url; vo.title = current.title; vo.copyright = current.copyright; }
  return vo;
}
add('GET', '/api/wallpaper', ({ userId }) => ok(wallpaperVO(userId)));
add('PUT', '/api/wallpaper', ({ userId, body }) => {
  const pinnedId = body.pinnedImageId != null ? Number(body.pinnedImageId) : null;
  if (pinnedId != null && !g('SELECT id FROM t_wallpaper_image WHERE id = ?', pinnedId)) err(CODE.PARAM, '固定壁纸不存在');
  const clamp = (v, min, max, def) => (v == null ? def : Math.max(min, Math.min(max, v)));
  const enabled = body.enabled ? 1 : 0;
  const brightness = clamp(body.brightness, 30, 150, 100);
  const blur = clamp(body.blur, 0, 30, 0);
  const now = nowIso();
  const exists = g('SELECT user_id FROM t_wallpaper_setting WHERE user_id = ?', userId);
  if (exists) run('UPDATE t_wallpaper_setting SET enabled=?, pinned_image_id=?, brightness=?, blur=?, update_time=? WHERE user_id=?', enabled, pinnedId, brightness, blur, now, userId);
  else run('INSERT INTO t_wallpaper_setting (user_id, enabled, pinned_image_id, brightness, blur, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)', userId, enabled, pinnedId, brightness, blur, now, now);
  return ok(wallpaperVO(userId), '保存成功');
});
add('GET', '/api/wallpaper/images', ({ query }) => {
  const n = Math.min(Math.max(Number(query.limit) || 14, 1), 30);
  const source = query.source && query.source.trim() ? query.source.trim().toLowerCase() : null;
  let sql = `SELECT ${C.wpimg} FROM t_wallpaper_image`;
  const p = [];
  if (source) { sql += ' WHERE source = ?'; p.push(source); }
  sql += ` ORDER BY image_date DESC, id DESC LIMIT ${n}`;
  return ok(q(sql, ...p));
});
add('POST', '/api/wallpaper/sync', async () => {
  const added = (await external.syncFromBing()) + (await external.syncFromNasa());
  return ok(added, '同步完成');
});

// ===== 热搜 =====
add('GET', '/api/hot/{source}', async ({ params }) => ok(await external.getHotList(params.source)), { auth: false });

// ---------- 管理员校验 ----------
function requireAdmin(userId) {
  const u = g('SELECT role FROM t_user WHERE id = ?', userId);
  if (!u || u.role !== 'ADMIN') err(CODE.FORBIDDEN, '无权访问');
}

// ---------- 供流式聊天使用：取当前启用模型 ----------
function requireActiveModel(userId) {
  const cfg = g('SELECT * FROM t_ai_model_config WHERE user_id = ? AND is_active = 1 LIMIT 1', userId);
  if (!cfg) err(1001, '尚未配置大模型，请先在 AI 助手的「模型设置」中添加并启用');
  if (!cfg.api_key || !cfg.api_key.trim()) err(1002, '当前模型的 API 密钥为空，请在「模型设置」中补全后重试');
  return cfg;
}

// ---------- 分发 ----------
function parseQuery(search) {
  const out = {};
  if (!search) return out;
  for (const pair of search.split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
    const v = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1));
    out[k] = v;
  }
  return out;
}

async function handleApi({ path, method = 'GET', body, token }) {
  let pathname = path, search = '';
  const qi = path.indexOf('?');
  if (qi >= 0) { pathname = path.slice(0, qi); search = path.slice(qi + 1); }
  const m = (method || 'GET').toUpperCase();
  for (const route of routes) {
    if (route.method !== m) continue;
    const mt = route.rx.exec(pathname);
    if (!mt) continue;
    const params = {};
    route.keys.forEach((k, i) => { params[k] = mt[i + 1]; });
    const ctx = { params, query: parseQuery(search), body: body || {}, token };
    try {
      if (route.auth) ctx.userId = resolveUserId(token);
      return await route.handler(ctx);
    } catch (e) {
      if (e instanceof ApiError) return { code: e.code, message: e.message, data: null };
      throw e;
    }
  }
  return { code: 404, message: '接口不存在: ' + m + ' ' + pathname, data: null };
}

module.exports = { handleApi, ApiError, requireActiveModel, resolveUserId };
