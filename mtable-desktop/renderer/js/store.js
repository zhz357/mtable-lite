//
// store.js — localStorage 持久化（token / 菜单缓存 / 记住账号 / 用户信息）
//
const KEYS = {
  token: 'com.mtable.token',
  menus: 'com.mtable.customMenus',
  lastPhone: 'com.mtable.lastPhone',
  lastPassword: 'com.mtable.lastPassword',
  user: 'com.mtable.user',
  theme: 'com.mtable.theme',
};

function get(key) { return localStorage.getItem(key); }
function set(key, value) { localStorage.setItem(key, value); }
function remove(key) { localStorage.removeItem(key); }

export const store = {
  getToken: () => get(KEYS.token),
  setToken: (t) => set(KEYS.token, t),
  clearToken: () => remove(KEYS.token),

  getUser() { try { return JSON.parse(get(KEYS.user) || 'null'); } catch { return null; } },
  setUser(u) { set(KEYS.user, JSON.stringify(u)); },
  clearUser: () => remove(KEYS.user),

  getMenus() { try { return JSON.parse(get(KEYS.menus) || 'null'); } catch { return null; } },
  setMenus(m) { set(KEYS.menus, JSON.stringify(m)); },
  clearMenus: () => remove(KEYS.menus),

  getSavedLogin() { return { phone: get(KEYS.lastPhone), password: get(KEYS.lastPassword) }; },
  setSavedLogin(phone, password) { set(KEYS.lastPhone, phone); set(KEYS.lastPassword, password); },
  clearSavedLogin() { remove(KEYS.lastPhone); remove(KEYS.lastPassword); },

  // 主题：'light' | 'dark'（默认浅色；持久化到 localStorage，弹窗关闭/重启后保持）
  getTheme() { return get(KEYS.theme) === 'dark' ? 'dark' : 'light'; },
  setTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    set(KEYS.theme, t);
    applyTheme(t);
    return t;
  },
  /** 启动时按持久化状态恢复主题（无记录则保持默认浅色） */
  initTheme() { applyTheme(this.getTheme()); },

  logout() { this.clearToken(); this.clearMenus(); this.clearUser(); },
};

/** 将主题写入 html[data-theme]，并短暂挂载 theme-anim 实现全局平滑过渡 */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.body?.classList.add('theme-anim');
  setTimeout(() => document.body?.classList.remove('theme-anim'), 400);
}
