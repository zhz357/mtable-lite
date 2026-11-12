// 跨进程持久化验证：新进程打开同一 SQLite 文件，读取上一进程写入的数据
const { app } = require('electron');
const path = require('path');
const os = require('os');
const dir = process.env.MT_TEST_DIR || path.join(os.tmpdir(), 'mtable-selftest');
process.env.MT_TEST_DIR = dir; // 让 main/paths.js 走 userData 隔离，不写项目根 db/
app.setPath('userData', dir);
const { initDb } = require('../main/db');
const { handleApi } = require('../main/api');

app.whenReady().then(async () => {
  initDb();
  const login = await handleApi({ path: '/api/auth/login', method: 'POST', body: { phone: '13800138000', password: '123456' } });
  const menus = await handleApi({ path: '/api/menus', token: login.data.token });
  const has = menus.data.some((m) => m.title === 'PERSIST_MARKER');
  console.log('PERSIST_CROSS_PROCESS:', has ? 'PASS' : 'FAIL', '| menus=', menus.data.map((m) => m.title).join(','));
  app.quit();
});
