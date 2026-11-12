//
// ipc.js — 主进程 IPC 注册：统一 API 通道 + AI 流式聊天 + 安装包上传
//
const { ipcMain, dialog, BrowserWindow } = require('electron');
const { handleApi, ApiError, requireActiveModel, resolveUserId } = require('./api');
const external = require('./external');

let streamSeq = 0;
const activeStreams = new Map(); // streamId -> { cancel }

function registerIpc() {
  // 统一 API 通道：渲染进程所有数据请求都走这里，返回 { code, message, data }
  ipcMain.handle('mtable:api', async (_e, req) => {
    try {
      return await handleApi(req);
    } catch (e) {
      if (e instanceof ApiError) return { code: e.code, message: e.message, data: null };
      console.error('[api] 未处理异常', req && req.path, e);
      return { code: 500, message: e.message || '系统内部错误', data: null };
    }
  });

  // AI 流式聊天：先做前置校验（未配置模型等以 {error} 立即返回），
  // 校验通过后异步流式推送增量文本到渲染进程。
  ipcMain.handle('mtable:ai-chat-start', (event, { messages, token }) => {
    let cfg;
    try {
      const userId = resolveUserId(token);
      cfg = requireActiveModel(userId);
    } catch (e) {
      return { error: e.message, code: e.code || 1001 };
    }
    const streamId = ++streamSeq;
    const sender = event.sender;
    const send = (channel, payload) => { if (!sender.isDestroyed()) sender.send(channel, payload); };
    const { cancel } = external.streamChat(
      { baseUrl: cfg.base_url, apiKey: cfg.api_key, modelId: cfg.model_id, messages },
      {
        onDelta: (content) => send('mtable:ai-delta', { streamId, content }),
        onDone: () => { activeStreams.delete(streamId); send('mtable:ai-delta', { streamId, done: true }); },
        onError: (e) => { activeStreams.delete(streamId); send('mtable:ai-error', { streamId, message: e.message || '连接模型失败，请稍后重试' }); },
      },
    );
    activeStreams.set(streamId, { cancel });
    return { streamId };
  });
  ipcMain.handle('mtable:ai-chat-cancel', (_e, { streamId }) => {
    const s = activeStreams.get(streamId);
    if (s) { try { s.cancel(); } catch { /* ignore */ } activeStreams.delete(streamId); }
  });

  // 安装包上传（管理员发布版本）：渲染进程读取文件字节，主进程落盘
  ipcMain.handle('mtable:upload', (_e, { fileName, bytes }) => {
    const buf = Buffer.from(bytes);
    const info = external.storeUpload(fileName, buf);
    return { code: 200, message: '上传成功', data: { fileName: info.fileName, url: info.url, originalName: fileName, size: info.size } };
  });

  // 选择旧电脑拷贝过来的 SQLite 数据库文件（导入项目数据），取消返回 null
  ipcMain.handle('mtable:pick-db-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择要导入的数据库文件',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    return canceled ? null : filePaths[0];
  });
}

module.exports = { registerIpc };
