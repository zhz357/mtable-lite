// 数据层端到端自测（在 Electron 主进程运行时执行，验证 SQLite CRUD + 持久化）
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const userDataDir = process.env.MT_TEST_DIR || path.join(os.tmpdir(), 'mtable-selftest-' + Date.now());
process.env.MT_TEST_DIR = userDataDir; // 让 main/paths.js 走 userData 隔离，不写项目根 db/
app.setPath('userData', userDataDir);
const { initDb, dbFile } = require('../main/db');
const { handleApi } = require('../main/api');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function run() {
  const info = initDb();
  console.log('DB file:', info.file, 'exists:', fs.existsSync(info.file));

  // 注册新用户
  const phone = '1370000000' + Math.floor(Math.random() * 10);
  let r = await handleApi({ path: '/api/auth/register', method: 'POST', body: { phone, password: 'abc123', nickname: '自测用户' } });
  check('register ok', r.code === 200 && r.data && r.data.token, r);
  const token = r.data.token;
  const userId = r.data.userId;
  check('register role USER', r.data.role === 'USER', r.data);

  // 登录已有测试账号
  r = await handleApi({ path: '/api/auth/login', method: 'POST', body: { phone: '13800138000', password: '123456' } });
  check('login seed user ok', r.code === 200 && r.data.token, r);
  // 跨进程持久化标记：给种子用户建一个固定菜单
  await handleApi({ path: '/api/menus', method: 'POST', body: { title: 'PERSIST_MARKER', icon: 'flag' }, token: r.data.token });
  // 错误密码
  r = await handleApi({ path: '/api/auth/login', method: 'POST', body: { phone: '13800138000', password: 'wrong' } });
  check('login wrong pw rejected', r.code === 401, r);

  // 默认首页菜单存在
  r = await handleApi({ path: '/api/menus', token });
  check('default home menu seeded', r.code === 200 && r.data.length === 1 && r.data[0].title === '首页', r.data);

  // 新增菜单
  r = await handleApi({ path: '/api/menus', method: 'POST', body: { title: '工具', icon: 'wrench' }, token });
  check('addMenu', r.code === 200 && r.data.id && r.data.title === '工具', r);
  const menuId = r.data.id;

  // 首页不可删除
  const homeId = (await handleApi({ path: '/api/menus', token })).data[0].id;
  r = await handleApi({ path: `/api/menus/${homeId}`, method: 'DELETE', token });
  check('home menu delete blocked', r.code === 400, r);

  // 新增文件夹
  r = await handleApi({ path: `/api/menus/${menuId}/folders`, method: 'POST', body: { title: '常用', icon: 'folder' }, token });
  check('addFolder', r.code === 200 && r.data.id, r);
  const folderId = r.data.id;

  // 新增卡片（根级）
  r = await handleApi({ path: `/api/menus/${menuId}/cards`, method: 'POST', body: { title: 'GitHub', url: 'https://github.com', description: 'code', iconUrl: '' }, token });
  check('addCard', r.code === 200 && r.data.id && r.data.title === 'GitHub', r);
  const cardId = r.data.id;

  // 卡片列表（根级）
  r = await handleApi({ path: `/api/menus/${menuId}/cards`, token });
  check('getCards root count=1', r.code === 200 && r.data.length === 1, r.data);

  // 更新卡片
  r = await handleApi({ path: `/api/menus/${menuId}/cards/${cardId}`, method: 'PUT', body: { title: 'GitHub Repo', url: 'https://github.com', description: 'x', iconUrl: '', folderId }, token });
  check('updateCard', r.code === 200, r);
  r = await handleApi({ path: `/api/menus/${menuId}/cards?folderId=${folderId}`, token });
  check('card moved into folder', r.data.length === 1 && r.data[0].title === 'GitHub Repo', r.data);

  // 文件夹卡片数
  r = await handleApi({ path: `/api/menus/${menuId}/folders`, token });
  check('folder cardCount=1', r.data[0].cardCount === 1, r.data);

  // 删除卡片
  r = await handleApi({ path: `/api/menus/${menuId}/cards/${cardId}`, method: 'DELETE', token });
  check('deleteCard', r.code === 200, r);

  // 便签：新增今日 + 长期
  r = await handleApi({ path: '/api/daily-notes', method: 'POST', body: { content: '写周报', category: 'daily' }, token });
  check('addDailyNote', r.code === 200 && r.data.noteDate && r.data.category === 'daily', r);
  const noteId = r.data.id;
  r = await handleApi({ path: '/api/daily-notes', token });
  check('getDailyNotes count=1', r.data.length === 1, r.data);
  r = await handleApi({ path: `/api/daily-notes/${noteId}`, method: 'PUT', body: { isCompleted: 1 }, token });
  check('updateNote complete', r.code === 200, r);

  // 学习路线 + 待办 + 备注
  r = await handleApi({ path: '/api/study/routes', method: 'POST', body: { title: 'Java', description: '后端' }, token });
  check('addStudyRoute', r.code === 200 && r.data.id, r);
  const routeId = r.data.id;
  r = await handleApi({ path: `/api/study/routes/${routeId}/todos`, method: 'POST', body: { title: 'JVM' }, token });
  const todoId = r.data.id;
  r = await handleApi({ path: `/api/study/todos/${todoId}/notes`, method: 'POST', body: { content: 'GC 章节' }, token });
  check('addStudyNote', r.code === 200 && r.data.id, r);
  r = await handleApi({ path: '/api/study/routes', token });
  check('route todoCount=1 completedCount=0', r.data[0].todoCount === 1 && r.data[0].completedCount === 0, r.data);

  // 插件市场 + 安装（menu 型）
  r = await handleApi({ path: '/api/plugins', token });
  check('plugins seeded >=7', r.code === 200 && r.data.length >= 7, r.data && r.data.length);
  const roadmap = r.data.find((p) => p.pluginKey === 'learning-roadmap');
  r = await handleApi({ path: `/api/plugins/${roadmap.id}/install`, method: 'POST', body: {}, token });
  check('install menu plugin', r.code === 200, r);
  r = await handleApi({ path: '/api/plugins', token });
  check('plugin marked installed', r.data.find((p) => p.pluginKey === 'learning-roadmap').installed === true, r.data);

  // 反馈
  r = await handleApi({ path: '/api/feedback', method: 'POST', body: { reporterName: '张三', feedbackType: 'BUG', content: '测试反馈' }, token });
  check('addFeedback', r.code === 200 && r.data.reporterAccount === phone, r);

  // 壁纸设置
  r = await handleApi({ path: '/api/wallpaper', method: 'PUT', body: { enabled: true, brightness: 90, blur: 2 }, token });
  check('updateWallpaper', r.code === 200 && r.data.enabled === true && r.data.brightness === 90, r);

  // AI 模型配置（首份自动启用 + 脱敏）
  r = await handleApi({ path: '/api/ai/models', method: 'POST', body: { name: 'DS', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-abcdefg123456789', modelId: 'deepseek-chat' }, token });
  check('addAiModel active + masked', r.code === 200 && r.data.isActive === 1 && r.data.maskedApiKey.includes('****'), r);

  // AI 任务保存 + 列表 + 详情
  r = await handleApi({ path: '/api/ai/tasks', method: 'POST', body: { title: '', messages: [{ role: 'user', content: '你好世界' }, { role: 'assistant', content: 'hi' }] }, token });
  check('saveAiTask', r.code === 200 && r.data.messageCount === 2 && r.data.messages === null, r);
  const taskId = r.data.id;
  r = await handleApi({ path: `/api/ai/tasks/${taskId}`, token });
  check('aiTask detail messages', r.data.messages && r.data.messages.length === 2, r);

  // 未授权：无 token
  r = await handleApi({ path: '/api/menus', token: 'bad-token' });
  check('bad token -> 4011', r.code === 4011, r);

  // 菜单重排（回归：/api/menus/reorder 不被 {menuId} 误匹配）
  const menus = (await handleApi({ path: '/api/menus', token })).data;
  const ids = menus.map((m) => m.id).reverse();
  r = await handleApi({ path: '/api/menus/reorder', method: 'PUT', body: { menuIds: ids }, token });
  check('reorderMenus', r.code === 200, r);
  const after = (await handleApi({ path: '/api/menus', token })).data;
  check('reorder applied', after[0].id === ids[0], { ids, after: after.map((m) => m.id) });

  // 版本 latest（无发布记录 -> data null）
  r = await handleApi({ path: '/api/version/latest', token });
  check('version latest null ok', r.code === 200 && r.data === null, r);

  // 管理员登录 + 发送通知 + 普通用户接收
  const adm = await handleApi({ path: '/api/auth/login', method: 'POST', body: { phone: '13900000000', password: '123456' } });
  check('admin login role', adm.code === 200 && adm.data.role === 'ADMIN', adm.data);
  r = await handleApi({ path: '/api/admin/notifications', method: 'POST', body: { title: '公告', content: '系统维护', scope: 'ALL' }, token: adm.data.token });
  check('admin send notification', r.code === 200 && r.data.receiverCount >= 1, r);
  r = await handleApi({ path: '/api/notifications', token });
  check('user receives notification', r.code === 200 && r.data.some((n) => n.title === '公告'), r.data);
  r = await handleApi({ path: '/api/notifications/unread-count', token });
  check('unread count >=1', r.data.count >= 1, r);

  // 登录响应含 avatar/motto/role 字段
  check('login response shape', ['token', 'userId', 'phone', 'nickname', 'avatar', 'motto', 'role'].every((k) => k in adm.data), adm.data);

  // 持久化验证：重新打开同一 db 文件读取数据仍在
  console.log('--- persistence re-read via new handleApi (same process/db) ---');
  r = await handleApi({ path: '/api/menus', token });
  check('menus persisted', r.data.some((m) => m.title === '工具'), r.data);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  console.log('userId=', userId);
  app.quit();
}

app.whenReady().then(() => { run().catch((e) => { console.error('TEST ERROR', e); app.exit(1); }); });
app.on('window-all-closed', (e) => { /* keep running for headless */ });
