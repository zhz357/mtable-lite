//
// app.js — 应用入口与路由：欢迎页 → 登录/注册 → 主界面
//
import { el, clear } from './ui.js';
import { store } from './store.js';
import { setUnauthorizedHandler } from './api.js';
import { WelcomeView } from './views/welcome.js';
import { LoginView } from './views/login.js';
import { RegisterView } from './views/register.js';
import { MainView } from './views/main.js';
import { clearWallpaper } from './wallpaper.js';

export const AppContext = { user: null };

// 登录态失效（Token 过期/无效）时自动退出：清除凭证并跳回欢迎页
setUnauthorizedHandler(() => {
  AppContext.user = null;
  store.logout();
  clearWallpaper();
  navigate('welcome');
});

const root = document.getElementById('app');
document.body.dataset.platform = window.mtable?.platform || 'unknown';
store.initTheme(); // 启动时恢复持久化的主题（默认浅色）

export function navigate(route) {
  root.firstElementChild?.dispose?.(); // 卸载旧视图的全局订阅（如内置浏览器弹窗转发）
  clear(root);
  switch (route) {
    case 'welcome':
      root.append(WelcomeView({ onStartLogin: () => navigate('login') }));
      break;
    case 'login':
      root.append(LoginView({
        onBack: () => navigate('welcome'),
        onRegister: () => navigate('register'),
        onLoginSuccess(user) {
          AppContext.user = user;
          navigate('main');
        },
      }));
      break;
    case 'register':
      root.append(RegisterView({
        onBack: () => navigate('login'),
        onRegisterSuccess(user) {
          AppContext.user = user;
          navigate('main');
        },
      }));
      break;
    case 'main':
      root.append(MainView({
        user: AppContext.user,
        onLogout() {
          AppContext.user = null;
          store.logout();
          clearWallpaper();
          navigate('welcome');
        },
      }));
      break;
  }
}

// 启动：若有 token 则直接恢复用户信息进入主界面
(async function boot() {
  const user = store.getUser();
  if (store.getToken() && user) {
    AppContext.user = user;
    navigate('main');
  } else {
    navigate('welcome');
  }
})();
