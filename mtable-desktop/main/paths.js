//
// paths.js — 项目数据路径统一入口
// 数据根目录（dataRoot）按优先级定位，其下统一存放：
//   db/       SQLite 数据库
//   media/    壁纸、安装包等媒体文件
//   userdata/ Chromium 运行时数据（缓存/Cookie/本地存储，由 main.js 设置）
// 1. 开发模式 / 打包版位于项目内（app/MTable.app）→ 项目根（数据集中在项目根，方便维护）
// 2. 分享给他人安装使用 → 安装目录旁的 MTableData/：
//    macOS: MTable.app 同级目录下的 MTableData/（如 /Applications/MTableData）
//    Windows: 安装目录（exe 所在目录）下的 MTableData/
// 3. 安装目录不可写或定位失败 → 回退 %APPDATA%/MTable，保证不崩
//
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function projectRoot() {
  // 测试/CI 通过 MT_TEST_DIR / MTABLE_USER_DATA 显式指定数据目录时，禁用项目根定位，保证隔离
  if (process.env.MT_TEST_DIR || process.env.MTABLE_USER_DATA) return null;
  if (app.isPackaged) {
    const r = path.resolve(path.dirname(app.getPath('exe')), '..', '..', '..', '..');
    return fs.existsSync(path.join(r, 'package.json')) && fs.existsSync(path.join(r, 'main.js')) ? r : null;
  }
  return path.resolve(__dirname, '..');
}

function dataRoot() {
  if (process.env.MT_TEST_DIR || process.env.MTABLE_USER_DATA) return null;
  const r = projectRoot();
  if (r) return r;
  if (app.isPackaged) {
    const base = process.platform === 'darwin'
      ? path.resolve(path.dirname(app.getPath('exe')), '..', '..', '..') // .app 的父目录
      : path.dirname(app.getPath('exe'));                                 // Windows 安装目录
    const dir = path.join(base, 'MTableData');
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch { /* 无写权限，走回退 */ }
  }
  return path.join(app.getPath('appData'), 'MTable');
}

function dbDir() {
  const r = dataRoot();
  return r ? path.join(r, 'db') : path.join(app.getPath('userData'), 'db');
}

function mediaDir() {
  const r = dataRoot();
  return r ? path.join(r, 'media') : path.join(app.getPath('userData'), 'media');
}

module.exports = { projectRoot, dataRoot, dbDir, mediaDir };
