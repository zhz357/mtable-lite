//
// preload.js — 渲染进程安全桥
//
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mtable', {
  platform: process.platform,
  // Electron 运行时版本
  version: process.versions.electron,
  // 应用自身版本号（package.json 的 version）
  appVersion: ipcRenderer.sendSync('mtable:app-version'),
  // 应用内下载安装包（expectedSize 为服务端记录的文件字节数，用于完整性校验）
  downloadApp: (url, filename, expectedSize) =>
    ipcRenderer.invoke('mtable:download', { url, filename, expectedSize }),
  // 订阅下载进度，返回取消订阅函数
  onDownloadProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('mtable:download-progress', handler);
    return () => ipcRenderer.removeListener('mtable:download-progress', handler);
  },
  // 通用 HTTP 转发（绕过 CORS，供模型额度等插件调用外部 API）
  httpRequest: (opts) => ipcRenderer.invoke('mtable:http-request', opts),
  // 订阅内置浏览器网页弹窗（window.open / target=_blank）被拦截后转发的地址，返回取消订阅函数
  onWebviewPopup: (cb) => {
    const handler = (_e, url) => cb(url);
    ipcRenderer.on('mtable:webview-popup', handler);
    return () => ipcRenderer.removeListener('mtable:webview-popup', handler);
  },

  // ---------- 本地数据层（SQLite，替代原后端 HTTP 接口） ----------
  // 统一 API 通道：传入 { path, method, body, token }，返回 { code, message, data }
  api: (req) => ipcRenderer.invoke('mtable:api', req),
  // AI 流式聊天：start 返回 {streamId} 或 {error,code}；增量/结束经 onAiDelta 推送，错误经 onAiError 推送
  aiChatStart: (messages, token) => ipcRenderer.invoke('mtable:ai-chat-start', { messages, token }),
  aiChatCancel: (streamId) => ipcRenderer.invoke('mtable:ai-chat-cancel', { streamId }),
  onAiDelta: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('mtable:ai-delta', handler);
    return () => ipcRenderer.removeListener('mtable:ai-delta', handler);
  },
  onAiError: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('mtable:ai-error', handler);
    return () => ipcRenderer.removeListener('mtable:ai-error', handler);
  },
  // 安装包上传：读取文件字节交给主进程落盘
  upload: (fileName, bytes) => ipcRenderer.invoke('mtable:upload', { fileName, bytes }),
  // 选择旧电脑拷贝的数据库文件（导入项目数据）；取消返回 null
  pickDbFile: () => ipcRenderer.invoke('mtable:pick-db-file'),
});
