//
// main.js — Electron 主进程
//
const { app, BrowserWindow, ipcMain, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { initDb } = require('./main/db');
const { registerIpc } = require('./main/ipc');
const { dataRoot, mediaDir } = require('./main/paths');

// 用户数据目录：统一放数据根（项目根 / 安装目录旁 MTableData）下的 userdata/，
// 定位不到时回退 appData/MTable（升级后登录态不随 .app 名称变化丢失）
const root = dataRoot();
const fixedUserData = root ? path.join(root, 'userdata') : path.join(app.getPath('appData'), 'MTable');

// 启动时清理可再生的 GPU/网络缓存目录：
// 这些缓存损坏后（如 Gpu Cache Creation failed: -2）渲染进程无法完成初始化，表现为窗口白屏；
// 全部为可再生缓存，删除后由 Chromium 重建。不动 Local Storage / Cookies / IndexedDB（保留登录态）
for (const name of ['GPUCache', 'GrShaderCache', 'ShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Code Cache', 'Cache']) {
  try { fs.rmSync(path.join(fixedUserData, name), { recursive: true, force: true }); } catch { /* 忽略 */ }
}
app.setPath('userData', fixedUserData);

// GPU 保留（WebGL 需要，地图类网页依赖）；仅关闭 GPU 合成走软件合成，
// 规避打包后 GPU 合成失败导致的窗口白屏（症状：开发模式正常、打包 .app 全白）
app.commandLine.appendSwitch('disable-gpu-compositing');

// 开发/CI 可用环境变量重定向用户数据目录（不影响正常安装使用）
if (process.env.MTABLE_USER_DATA) {
  app.setPath('userData', process.env.MTABLE_USER_DATA);
  app.commandLine.appendSwitch('disable-features', 'Crashpad');
}

let mainWindow = null;

function createWindow() {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'MTable',
    // macOS 隐藏标题栏（与原生版一致）；Windows 保留系统标题栏，符合平台习惯
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#f5f6fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
    },
  });

  // 新窗口请求一律交给系统浏览器（内部浏览由 <webview> 承担）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// 内置浏览器 <webview> 里的弹窗（window.open / target="_blank"）：
// Electron 22 起 <webview> 不再派发 new-window 事件，弹窗会直接变成独立系统窗口，
// 因此在 webview 的 guest webContents 上拦截，把地址转发给渲染进程，
// 由内置浏览器新开标签页展示（标签自带地址栏，可查看/复制），不再弹独立窗口
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (/^(https?:|about:)/i.test(url)) win.webContents.send('mtable:webview-popup', url);
      else if (url) shell.openExternal(url); // mailto: 等特殊协议交系统处理
    }
    return { action: 'deny' };
  });
});

// ---------- 渲染进程桥 ----------
// 返回真实应用版本号（package.json 的 version，区别于 Electron 运行时版本）
ipcMain.on('mtable:app-version', (event) => {
  event.returnValue = app.getVersion();
});

/**
 * 应用内下载安装包：
 * 保存到系统下载目录，进度通过 mtable:download-progress 实时推送渲染进程，
 * 完成后校验文件大小（expectedSize 为服务端记录的安装包字节数），
 * 不符（如服务端返回 404 错误页）则删除残缺文件并报错；
 * 校验通过后自动在访达/资源管理器中定位文件。
 */
ipcMain.handle('mtable:download', (event, { url, filename, expectedSize }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return Promise.reject(new Error('窗口不可用'));

  // 保存路径：系统下载目录 / 文件名（同名自动加序号）
  const dir = app.getPath('downloads');
  const safeName = String(filename || 'installer').replace(/[\\/:*?"<>|]/g, '_');
  let savePath = path.join(dir, safeName);
  for (let i = 1; fs.existsSync(savePath); i++) {
    const ext = path.extname(safeName);
    savePath = path.join(dir, `${path.basename(safeName, ext)} (${i})${ext}`);
  }

  const session = win.webContents.session;
  const send = (data) => {
    if (!win.isDestroyed()) win.webContents.send('mtable:download-progress', data);
  };
  const expect = Number(expectedSize) || 0;

  return new Promise((resolve, reject) => {
    const onWillDownload = (_e, item) => {
      if (item.getURL() !== url) return; // 只接管本次触发的下载
      session.removeListener('will-download', onWillDownload);
      item.setSavePath(savePath);

      item.on('updated', (_i, state) => {
        send({
          filename: safeName,
          received: item.getReceivedBytes(),
          total: item.getTotalBytes(),
          percent: item.getTotalBytes() ? item.getReceivedBytes() / item.getTotalBytes() : 0,
          state, // progressing / interrupted
          done: false,
        });
      });

      item.once('done', (_i, state) => {
        const received = item.getReceivedBytes();
        const declared = item.getTotalBytes();
        // 大小校验（1KB 容差）：服务端返回内容与记录的安装包大小不符，
        // 说明文件缺失或被错误响应（如 404 页面）替代，视为失败
        const sizeMismatch = expect > 0
          && ((declared > 0 && Math.abs(declared - expect) > 1024)
            || (state === 'completed' && Math.abs(received - expect) > 1024));

        if (state === 'completed' && !sizeMismatch) {
          const payload = { filename: safeName, filePath: savePath, state, done: true, success: true };
          send({ ...payload, percent: 1 });
          shell.showItemInFolder(savePath); // 打开所在文件夹并选中安装包
          resolve(payload);
          return;
        }

        // 删除残缺/错误文件，避免用户误装
        try { fs.unlinkSync(savePath); } catch { /* 忽略 */ }
        const err = sizeMismatch
          ? new Error(`下载内容不完整（${received} 字节，应为 ${expect} 字节），请确认管理员已成功上传完整安装包`)
          : new Error(`下载失败（${state}）`);
        const payload = { filename: safeName, state, done: true, success: false, error: err.message };
        send(payload);
        reject(err);
      });
    };

    session.on('will-download', onWillDownload);
    win.webContents.downloadURL(url);
  });
});

/**
 * 通用 HTTP 转发（供渲染进程调用外部第三方 API，如模型厂商额度接口）：
 * 渲染进程 fetch 受 CORS 限制（多数厂商接口未返回跨域头），
 * 改由主进程 Node http/https 直发请求，响应文本原样返回。
 */
ipcMain.handle('mtable:http-request', (_e, { url, method = 'GET', headers = {}, body, timeout = 15000 }) => {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('无效的 URL')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('仅支持 http/https'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    if (body) req.write(body);
    req.end();
  });
});

// game:// 协议：game://{pluginKey}/{path} → renderer/game/{pluginKey}/{path}，
// 供内置浏览器加载随包分发的游戏型插件页面（如城市赛车 city-racer）
// wallpaper:// / download:// 协议：映射到本地数据目录，替代原后端 /wallpapers /downloads 静态资源
protocol.registerSchemesAsPrivileged([
  { scheme: 'game', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'wallpaper', privileges: { standard: true, secure: true, stream: true } },
  { scheme: 'download', privileges: { standard: true, secure: true, stream: true } },
]);

// 将 {scheme}://local/{filename} 映射到本地目录下的文件（越权访问拦截）
// 文件名必须放 path 段：标准协议的 host 会被 Chromium 强制小写，丢失文件名大小写
function registerLocalFileProtocol(scheme, rootDir) {
  protocol.registerFileProtocol(scheme, (request, callback) => {
    let rel = '';
    try {
      const url = new URL(request.url);
      const p = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      rel = p || url.host; // path 为空时兼容旧格式 {scheme}://{filename}
    } catch { /* 非法 URL 走越权拦截 */ }
    const target = path.normalize(path.join(rootDir, rel));
    if (!target.startsWith(rootDir + path.sep)) { callback({ error: -3 }); return; }
    callback({ path: target });
  });
}

app.whenReady().then(() => {
  initDb();
  registerIpc();

  const gameRoot = path.join(__dirname, 'renderer', 'game');
  protocol.registerFileProtocol('game', (request, callback) => {
    let rel = '';
    try {
      const url = new URL(request.url);
      rel = `${url.host}${decodeURIComponent(url.pathname)}`;
    } catch { /* 非法 URL 走下方越权拦截 */ }
    const target = path.normalize(path.join(gameRoot, rel));
    if (!target.startsWith(gameRoot + path.sep)) { callback({ error: -3 }); return; }
    callback({ path: target });
  });

  const liteDir = mediaDir();
  registerLocalFileProtocol('wallpaper', path.join(liteDir, 'wallpapers'));
  registerLocalFileProtocol('download', path.join(liteDir, 'downloads'));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
