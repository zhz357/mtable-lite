//
// db.js — 本地 SQLite 数据层（better-sqlite3，替代原 MySQL 后端）
//
// 数据库文件位于项目根 db/app.db（见 main/paths.js），随应用启动自动创建、
// 建表、迁移并写入初始数据；所有数据以本地文件形式持久化。
//
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dbDir } = require('./paths');

let db = null;

// ---------- 时间工具（与后端 LocalDateTime / LocalDate 的 JSON 格式一致） ----------
// 时间戳存为本地 ISO 字符串 "YYYY-MM-DDTHH:mm:ss"（无 Z、无毫秒），
// 前端 new Date(iso) 按本地时区解析，行为与原后端一致。
function pad(n) { return String(n).padStart(2, '0'); }
function nowIso(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function todayDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------- 密码哈希（本地替代 BCrypt，使用 scrypt） ----------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  // 原后端（MySQL）迁移过来的 BCrypt 哈希
  if (stored.startsWith('$2')) {
    try { return require('bcryptjs').compareSync(String(plain), stored); } catch { return false; }
  }
  if (!stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const salt = Buffer.from(saltHex, 'hex');
  const expect = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(String(plain), salt, expect.length);
  return crypto.timingSafeEqual(got, expect);
}

// ---------- 建表 ----------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS t_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  nickname TEXT,
  avatar TEXT,
  motto TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL DEFAULT 'USER',
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_create_time ON t_user(create_time);

CREATE TABLE IF NOT EXISTS t_user_menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder',
  plugin_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menu_user ON t_user_menu(user_id);
CREATE INDEX IF NOT EXISTS idx_menu_sort ON t_user_menu(sort_order);
CREATE INDEX IF NOT EXISTS idx_menu_plugin ON t_user_menu(plugin_key);

CREATE TABLE IF NOT EXISTS t_menu_folder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder.fill',
  sort_order INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folder_menu ON t_menu_folder(menu_id);
CREATE INDEX IF NOT EXISTS idx_folder_user ON t_menu_folder(user_id);

CREATE TABLE IF NOT EXISTS t_menu_card (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER NOT NULL,
  folder_id INTEGER,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  icon_url TEXT,
  plugin_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_menu ON t_menu_card(menu_id);
CREATE INDEX IF NOT EXISTS idx_card_user ON t_menu_card(user_id);
CREATE INDEX IF NOT EXISTS idx_card_folder ON t_menu_card(folder_id);
CREATE INDEX IF NOT EXISTS idx_card_plugin ON t_menu_card(plugin_key);

CREATE TABLE IF NOT EXISTS t_daily_note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'daily',
  note_date TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_cat_date ON t_daily_note(user_id, category, note_date);

CREATE TABLE IF NOT EXISTS t_plugin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL DEFAULT 'puzzlepiece.fill',
  category TEXT DEFAULT '工具',
  type TEXT NOT NULL DEFAULT 'menu',
  version TEXT DEFAULT '1.0.0',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS t_study_route (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_route_user ON t_study_route(user_id);

CREATE TABLE IF NOT EXISTS t_study_todo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todo_route ON t_study_todo(route_id);

CREATE TABLE IF NOT EXISTS t_study_note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_todo ON t_study_note(todo_id);

CREATE TABLE IF NOT EXISTS t_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  reporter_name TEXT NOT NULL,
  reporter_account TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  content TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON t_feedback(user_id);

CREATE TABLE IF NOT EXISTS t_notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  sender_id INTEGER NOT NULL,
  sender_name TEXT,
  type TEXT NOT NULL DEFAULT 'GENERAL',
  extra TEXT,
  create_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS t_notification_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_time TEXT,
  UNIQUE(notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_nu_user_read ON t_notification_user(user_id, is_read);

CREATE TABLE IF NOT EXISTS t_app_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  release_notes TEXT,
  mac_file TEXT,
  mac_size INTEGER,
  win_file TEXT,
  win_size INTEGER,
  notify_users INTEGER NOT NULL DEFAULT 1,
  publisher_id INTEGER NOT NULL,
  publisher_name TEXT,
  create_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS t_ai_model_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'custom',
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_user ON t_ai_model_config(user_id, is_active);

CREATE TABLE IF NOT EXISTS t_ai_chat_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  messages TEXT NOT NULL,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_user ON t_ai_chat_task(user_id, update_time);

CREATE TABLE IF NOT EXISTS t_wallpaper_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'bing',
  category TEXT,
  image_date TEXT NOT NULL,
  title TEXT,
  copyright TEXT,
  file_name TEXT NOT NULL,
  url TEXT NOT NULL,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wp_date ON t_wallpaper_image(image_date);
CREATE INDEX IF NOT EXISTS idx_wp_source ON t_wallpaper_image(source, image_date);

CREATE TABLE IF NOT EXISTS t_wallpaper_setting (
  user_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  pinned_image_id INTEGER,
  brightness INTEGER NOT NULL DEFAULT 100,
  blur INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS t_session (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  create_time TEXT NOT NULL,
  expire_time TEXT
);

CREATE TABLE IF NOT EXISTS t_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const PRESET_PLUGINS = [
  ['learning-roadmap', '学习路线', '规划课程学习路线，拆分待办事项，并在每个待办下记录当前学习进度。', 'graduationcap.fill', '学习', 'menu', '1.0.0', 0],
  ['countdown', '倒计时', '创建多个倒计时，实时显示剩余天/时/分/秒，到期视觉与声音提醒，支持分类管理、排序、深浅色主题与数据导入导出。', 'timer', '工具', 'menu', '1.0.0', 1],
  ['city-racer', '城市赛车', '3D 城市赛道竞速小游戏：检查点计时圈速、漂移攒分加成，冲击个人最佳纪录，解压必备！', 'car.fill', '游戏', 'card', '1.0.0', 3],
  ['minesweeper', '扫雷', '经典扫雷：首点保护随机布雷、数字提示、右键插旗、数字格一键开圈，初/中/高三级预设与自定义难度，计时器、剩余雷数与最佳纪录。', 'gamecontroller.fill', '游戏', 'card', '1.0.0', 4],
  ['number-puzzle', '数字华容道', '数字华容道滑块拼图：3×3/4×4/5×5 三级难度切换，随机可解棋盘，步数与计时统计，胜利判定与自动完成提示，支持重置游戏与音效开关。', 'square.grid.2x2', '游戏', 'card', '1.0.0', 5],
  ['tetris', '俄罗斯方块', '经典俄罗斯方块：简单/中等/困难三档难度，方块袋随机生成、旋转踢墙、行消除与连消计分，实时得分、等级、下一方块预览，支持暂停继续、重新开始与最佳纪录。', 'cube.fill', '游戏', 'card', '1.0.0', 6],
  ['world-clock', '世界时钟', '全球主要国家与城市实时时间：时区自动转换与日期同步，模拟+数字双显示、昼夜标识，支持城市搜索、常用城市收藏、12/24 小时制切换、多主题与响应式布局。', 'globe', '工具', 'card', '1.0.0', 7],
];

function seed() {
  const now = nowIso();
  // 预置插件目录（幂等）
  const insPlugin = db.prepare(`INSERT OR IGNORE INTO t_plugin
    (plugin_key, name, description, icon, category, type, version, sort_order, is_enabled, create_time, update_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  for (const p of PRESET_PLUGINS) insPlugin.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], now, now);

  // 演示账号（与原后端初始数据一致；本地以 scrypt 重新加密明文 "123456"）
  const pwd = hashPassword('123456');
  const insUser = db.prepare(`INSERT OR IGNORE INTO t_user
    (phone, password, nickname, status, role, create_time, update_time) VALUES (?, ?, ?, 1, ?, ?, ?)`);
  const insMenu = db.prepare(`INSERT INTO t_user_menu
    (user_id, title, icon, sort_order, is_enabled, create_time, update_time) VALUES (?, '首页', 'house.fill', 0, 1, ?, ?)`);
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM t_user').get().c;
  if (userCount === 0) {
    const r1 = insUser.run('13800138000', pwd, '测试用户', 'USER', now, now);
    insMenu.run(r1.lastInsertRowid, now, now);
    insUser.run('13900000000', pwd, '系统管理员', 'ADMIN', now, now);
  }
}

function initDb() {
  const dir = dbDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'app.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // 旧库迁移：t_session 补 expire_time 列（NULL = 永不过期，兼容存量会话）
  if (!db.prepare("SELECT 1 FROM pragma_table_info('t_session') WHERE name = 'expire_time'").get()) {
    db.exec('ALTER TABLE t_session ADD COLUMN expire_time TEXT');
  }
  // 旧库迁移：壁纸 URL 改为 path 格式（host 段会被 Chromium 小写化，导致大小写文件名 404）
  db.exec("UPDATE t_wallpaper_image SET url = 'wallpaper://local/' || file_name WHERE substr(url, 1, 12) = 'wallpaper://' AND url NOT LIKE 'wallpaper://local/%'");
  seed();
  return { file, dir };
}

function getDb() {
  if (!db) throw new Error('数据库未初始化');
  return db;
}

// 从旧电脑拷贝的 app.db 全量导入：校验来源库后，按表逐张覆盖当前库（列取两侧交集，兼容版本差异）
const IMPORT_TABLES = ['t_user', 't_user_menu', 't_menu_card', 't_menu_folder', 't_daily_note',
  't_plugin', 't_study_route', 't_study_todo', 't_study_note', 't_feedback', 't_notification',
  't_notification_user', 't_app_version', 't_ai_model_config', 't_ai_chat_task',
  't_wallpaper_image', 't_wallpaper_setting', 't_session'];
function importDb(srcFile) {
  if (!fs.existsSync(srcFile)) throw new Error('文件不存在');
  let src;
  try { src = new Database(srcFile, { readonly: true }); } catch { throw new Error('不是有效的 SQLite 数据库文件'); }
  try {
    const names = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const missing = IMPORT_TABLES.filter((t) => !names.has(t));
    if (missing.length) throw new Error('缺少表：' + missing.join(', ') + '（请确认选择的是 MTable 的 app.db）');
    const d = getDb();
    const esc = srcFile.replace(/'/g, "''");
    d.exec('PRAGMA foreign_keys=OFF');
    d.exec(`ATTACH DATABASE '${esc}' AS src`);
    try {
      const tx = d.transaction(() => {
        for (const t of IMPORT_TABLES.concat(names.has('t_config') ? ['t_config'] : [])) {
          const dstCols = d.prepare(`SELECT name FROM pragma_table_info(?)`).all(t).map((r) => r.name);
          const srcCols = new Set(src.prepare(`SELECT name FROM pragma_table_info(?)`).all(t).map((r) => r.name));
          const cols = dstCols.filter((c) => srcCols.has(c));
          d.prepare(`DELETE FROM ${t}`).run();
          d.prepare(`INSERT INTO ${t} (${cols.join(',')}) SELECT ${cols.join(',')} FROM src.${t}`).run();
          // AUTOINCREMENT 序列表同步到导入后的最大 id
          if (dstCols.includes('id')) {
            const mx = d.prepare(`SELECT MAX(id) AS m FROM ${t}`).get().m;
            d.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(mx || 0, t);
          }
        }
      });
      tx();
    } finally {
      d.exec('DETACH DATABASE src');
      d.exec('PRAGMA foreign_keys=ON');
    }
  } finally {
    src.close();
  }
}

function dbFile() {
  return path.join(dbDir(), 'app.db');
}

module.exports = { initDb, getDb, dbFile, importDb, nowIso, todayDate, hashPassword, verifyPassword };
