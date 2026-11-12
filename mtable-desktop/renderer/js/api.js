//
// api.js — 数据请求层：本地 SQLite 版（经 Electron IPC 调用主进程，替代原后端 HTTP 接口）
//
import { store } from './store.js';

// 本地模式无后端服务：壁纸/安装包等静态资源改由自定义协议（wallpaper:// download://）加载，
// 保留空 BASE_URL 以兼容既有 `BASE_URL + url` 拼接写法。
export const BASE_URL = '';

export class APIError extends Error {
  constructor(message, business = false) {
    super(message);
    this.business = business;
  }
}

/** 登录态失效业务码（与主进程 ResultCode.TOKEN_EXPIRED 一致） */
const TOKEN_EXPIRED_CODE = 4011;

// 登录态失效时的全局回调（由 app.js 注册：清除凭证并跳回欢迎页）
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) { unauthorizedHandler = fn; }

/** 统一处理登录态失效：触发回调后抛出业务错误，让各视图的 catch 正常收尾 */
function handleUnauthorized(message) {
  if (unauthorizedHandler) unauthorizedHandler();
  return new APIError(message || '登录已过期，请重新登录', true);
}

/** 解析主进程统一返回结构 { code, message, data } */
function handleResult(result) {
  if (!result || typeof result.code !== 'number') throw new APIError('本地数据服务异常');
  if (result.code === TOKEN_EXPIRED_CODE) throw handleUnauthorized(result.message);
  if (result.code !== 200) throw new APIError(result.message || '请求失败', true);
  return result.data;
}

async function request(path, { method = 'GET', body } = {}) {
  const token = store.getToken();
  const result = await window.mtable.api({ path, method, body, token });
  return handleResult(result);
}

const requestVoid = request; // 无返回体接口同样处理

export const api = {
  // ---------- 认证 ----------
  login: (phone, password) =>
    request('/api/auth/login', { method: 'POST', body: { phone, password } }),
  register: (phone, password, nickname) =>
    request('/api/auth/register', { method: 'POST', body: { phone, password, nickname } }),
  updateProfile: (nickname, avatar, motto) =>
    requestVoid('/api/auth/profile', { method: 'PUT', body: { nickname, avatar, motto } }),
  changePassword: (oldPassword, newPassword) =>
    requestVoid('/api/auth/password', { method: 'PUT', body: { oldPassword, newPassword } }),
  getSessionTtl: () => request('/api/auth/session-ttl'),
  setSessionTtl: (days) => requestVoid('/api/auth/session-ttl', { method: 'PUT', body: { days } }),
  // 导入旧电脑的 app.db：全量覆盖本地数据，成功后当前登录态失效需重新登录
  pickDbFile: () => window.mtable.pickDbFile(),
  importDb: (file) => requestVoid('/api/auth/import-db', { method: 'PUT', body: { file } }),

  // ---------- 菜单 ----------
  getMenuList: () => request('/api/menus'),
  addMenu: (title, icon) => request('/api/menus', { method: 'POST', body: { title, icon } }),
  updateMenu: (menuId, title, icon) =>
    requestVoid(`/api/menus/${menuId}`, { method: 'PUT', body: { title, icon } }),
  deleteMenu: (menuId) => requestVoid(`/api/menus/${menuId}`, { method: 'DELETE' }),
  reorderMenus: (menuIds) =>
    requestVoid('/api/menus/reorder', { method: 'PUT', body: { menuIds } }),

  // ---------- 文件夹 ----------
  getFolderList: (menuId) => request(`/api/menus/${menuId}/folders`),
  addFolder: (menuId, title, icon) =>
    request(`/api/menus/${menuId}/folders`, { method: 'POST', body: { title, icon } }),
  updateFolder: (menuId, folderId, title, icon) =>
    requestVoid(`/api/menus/${menuId}/folders/${folderId}`, { method: 'PUT', body: { title, icon } }),
  deleteFolder: (menuId, folderId) =>
    requestVoid(`/api/menus/${menuId}/folders/${folderId}`, { method: 'DELETE' }),

  // ---------- 卡片 ----------
  getCardList: (menuId, folderId) =>
    request(`/api/menus/${menuId}/cards${folderId != null ? `?folderId=${folderId}` : ''}`),
  addCard: (menuId, body) =>
    request(`/api/menus/${menuId}/cards`, { method: 'POST', body }),
  updateCard: (menuId, cardId, body) =>
    requestVoid(`/api/menus/${menuId}/cards/${cardId}`, { method: 'PUT', body }),
  moveCard: (menuId, cardId, targetMenuId) =>
    requestVoid(`/api/menus/${menuId}/cards/${cardId}/move`, { method: 'PUT', body: { targetMenuId } }),
  deleteCard: (menuId, cardId) =>
    requestVoid(`/api/menus/${menuId}/cards/${cardId}`, { method: 'DELETE' }),
  reorderCards: (cardIds) =>
    requestVoid('/api/cards/reorder', { method: 'PUT', body: { cardIds } }),

  // ---------- 每日便签 ----------
  getDailyNotes: () => request('/api/daily-notes'),
  getLongTermNotes: () => request('/api/daily-notes/longterm'),
  // category: 'daily' | 'longterm'；start / end 可选（yyyy-MM-dd）
  getDailyNoteHistory: (category, start, end) => {
    const q = new URLSearchParams({ category });
    if (start) q.set('start', start);
    if (end) q.set('end', end);
    return request(`/api/daily-notes/history?${q}`);
  },
  addDailyNote: (content, category) =>
    request('/api/daily-notes', { method: 'POST', body: { content, category } }),
  updateDailyNote: (noteId, body) =>
    requestVoid(`/api/daily-notes/${noteId}`, { method: 'PUT', body }),
  deleteDailyNote: (noteId) => requestVoid(`/api/daily-notes/${noteId}`, { method: 'DELETE' }),

  // ---------- 壁纸 ----------
  getWallpaper: () => request('/api/wallpaper'),
  updateWallpaper: (body) => requestVoid('/api/wallpaper', { method: 'PUT', body }),
  // source 可选：'bing' / 'nasa'，缺省返回全部来源
  getWallpaperImages: (limit = 14, source) =>
    request(`/api/wallpaper/images?limit=${limit}${source ? `&source=${encodeURIComponent(source)}` : ''}`),
  // 从 Bing/NASA 拉取最新壁纸，返回新增数量
  syncWallpapers: () => request('/api/wallpaper/sync', { method: 'POST' }),

  // ---------- 插件市场 ----------
  getPlugins: () => request('/api/plugins'),
  installPlugin: (pluginId, menuId) =>
    requestVoid(`/api/plugins/${pluginId}/install`, { method: 'POST', body: menuId != null ? { menuId } : {} }),
  uninstallPlugin: (pluginId) => requestVoid(`/api/plugins/${pluginId}/uninstall`, { method: 'DELETE' }),

  // ---------- 学习路线 ----------
  getStudyRoutes: () => request('/api/study/routes'),
  addStudyRoute: (title, description) =>
    request('/api/study/routes', { method: 'POST', body: { title, description } }),
  updateStudyRoute: (routeId, title, description) =>
    requestVoid(`/api/study/routes/${routeId}`, { method: 'PUT', body: { title, description } }),
  deleteStudyRoute: (routeId) => requestVoid(`/api/study/routes/${routeId}`, { method: 'DELETE' }),
  getStudyTodos: (routeId) => request(`/api/study/routes/${routeId}/todos`),
  addStudyTodo: (routeId, title) =>
    request(`/api/study/routes/${routeId}/todos`, { method: 'POST', body: { title } }),
  updateStudyTodo: (routeId, todoId, title, isCompleted) =>
    requestVoid(`/api/study/routes/${routeId}/todos/${todoId}`, { method: 'PUT', body: { title, isCompleted } }),
  deleteStudyTodo: (routeId, todoId) =>
    requestVoid(`/api/study/routes/${routeId}/todos/${todoId}`, { method: 'DELETE' }),
  getStudyNotes: (todoId) => request(`/api/study/todos/${todoId}/notes`),
  addStudyNote: (todoId, content) =>
    request(`/api/study/todos/${todoId}/notes`, { method: 'POST', body: { content } }),
  updateStudyNote: (todoId, noteId, content, isCompleted) =>
    requestVoid(`/api/study/todos/${todoId}/notes/${noteId}`, { method: 'PUT', body: { content, isCompleted } }),
  deleteStudyNote: (todoId, noteId) =>
    requestVoid(`/api/study/todos/${todoId}/notes/${noteId}`, { method: 'DELETE' }),

  // ---------- 问题反馈 ----------
  getMyFeedbacks: () => request('/api/feedback'),
  addFeedback: (body) => request('/api/feedback', { method: 'POST', body }),

  // ---------- 系统通知（用户端） ----------
  getNotifications: () => request('/api/notifications'),
  getUnreadCount: () => request('/api/notifications/unread-count'),
  markNotificationRead: (notificationId) =>
    requestVoid(`/api/notifications/${notificationId}/read`, { method: 'PUT' }),
  markAllNotificationsRead: () =>
    requestVoid('/api/notifications/read-all', { method: 'PUT' }),

  // ---------- 管理员（消息发送 / 账号体系） ----------
  getUsers: () => request('/api/admin/users'),
  sendNotification: (body) =>
    request('/api/admin/notifications', { method: 'POST', body }),

  // ---------- 版本更新（用户端检查更新） ----------
  getLatestVersion: () => request('/api/version/latest'),

  // ---------- 管理员（版本发布） ----------
  // 上传安装包（本地：读取文件字节交主进程落盘；onProgress(loaded, total) 上报进度）
  uploadInstaller: async (file, onProgress) => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (onProgress) onProgress(bytes.length, bytes.length);
    const res = await window.mtable.upload(file.name, bytes);
    if (res?.code === TOKEN_EXPIRED_CODE) throw handleUnauthorized(res.message);
    if (!res || res.code !== 200) throw new APIError(res?.message || '上传失败', res?.code === 400);
    return res.data;
  },
  publishVersion: (body) =>
    request('/api/admin/versions', { method: 'POST', body }),

  // ---------- AI 助手（大模型配置 + 流式聊天） ----------
  getAiModels: () => request('/api/ai/models'),
  addAiModel: (body) => request('/api/ai/models', { method: 'POST', body }),
  updateAiModel: (id, body) => requestVoid(`/api/ai/models/${id}`, { method: 'PUT', body }),
  deleteAiModel: (id) => requestVoid(`/api/ai/models/${id}`, { method: 'DELETE' }),
  activateAiModel: (id) => requestVoid(`/api/ai/models/${id}/active`, { method: 'PUT' }),
  testAiModel: (body) => request('/api/ai/models/test', { method: 'POST', body }),
  // 实时拉取厂商最新可用模型列表（OpenAI 兼容 /models；失败时 ok=false、models 为空）
  listRemoteAiModels: (body) => request('/api/ai/models/remote-list', { method: 'POST', body }),

  // ---------- AI 任务历史（新建任务自动保存 / 历史查看与恢复） ----------
  saveAiTask: (body) => request('/api/ai/tasks', { method: 'POST', body }),
  getAiTasks: () => request('/api/ai/tasks'),
  getAiTaskDetail: (id) => request(`/api/ai/tasks/${id}`),
  deleteAiTask: (id) => requestVoid(`/api/ai/tasks/${id}`, { method: 'DELETE' }),

  /**
   * AI 流式对话（本地：经主进程直连厂商，增量文本通过 IPC 事件推送）。
   * @param {Array<{role:string,content:string}>} messages 最近对话历史（含当前一条用户消息）
   * @param {(delta:string)=>void} onDelta 每收到一段增量文本的回调
   * @param {AbortSignal} [signal] 中断信号（用户主动停止生成）
   * 前置业务校验失败（如未配置模型）抛出 APIError；主动停止抛出 AbortError。
   */
  async chatStream(messages, onDelta, signal) {
    const token = store.getToken();
    const start = await window.mtable.aiChatStart(messages, token);
    if (start?.error) {
      if (start.code === TOKEN_EXPIRED_CODE) throw handleUnauthorized(start.error);
      throw new APIError(start.error, true);
    }
    const streamId = start.streamId;
    return new Promise((resolve, reject) => {
      let settled = false;
      let aborted = false;
      const cleanup = () => { offDelta(); offError(); if (signal) signal.removeEventListener('abort', onAbort); };
      const finish = (error) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(); };
      const offDelta = window.mtable.onAiDelta((data) => {
        if (data.streamId !== streamId) return;
        if (data.done) return finish();
        if (data.content) onDelta(data.content);
      });
      const offError = window.mtable.onAiError((data) => {
        if (data.streamId !== streamId) return;
        finish(new APIError(data.message, true));
      });
      const onAbort = () => {
        if (settled) return;
        aborted = true;
        window.mtable.aiChatCancel(streamId);
        const e = new Error('aborted'); e.name = 'AbortError';
        finish(e);
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
      void aborted;
    });
  },

  // ---------- 今日一言 ----------
  async fetchHitokoto() {
    try {
      const res = await fetch('https://v1.hitokoto.cn/?c=i&c=k&encode=json', {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error();
      return await res.json();
    } catch {
      throw new APIError('网络连接失败');
    }
  },

  // ---------- 热搜榜单（source: toutiao 头条 / weibo 微博；后端代理+缓存） ----------
  async fetchHotList(source) {
    const data = await request(`/api/hot/${source}`);
    return Array.isArray(data) ? data : [];
  },
};
