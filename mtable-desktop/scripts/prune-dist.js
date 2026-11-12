#!/usr/bin/env node
//
// prune-dist.js — 构建后清理历史安装包，dist 下只保留最近 3 个版本的产物
//
// 清理范围（按版本号归组，不影响辅助文件与未解包目录）：
//   dist/macos/   *.dmg  *.blockmap
//   dist/windows/ *.exe  *.blockmap  *.7z
//
// 保留策略：
//   1. 按版本号从高到低排序，保留最近 KEEP_COUNT 个版本的全部产物；
//   2. 当前 package.json 版本始终保留（兜底，如 MBUMP=0 重打旧版本）；
//   3. 解析不出版本号的文件不动（安全兜底）。
//
// 用法：node scripts/prune-dist.js   （package.json 的 dist:* 与 build.sh 均会自动调用）
//

const fs = require('fs');
const path = require('path');

/** 保留的最近版本个数 */
const KEEP_COUNT = 3;

const version = require('../package.json').version;
const DIST = path.join(__dirname, '..', 'dist');

// 各平台的安装包产物模式
const TARGETS = [
  { dir: path.join(DIST, 'macos'), exts: ['.dmg', '.blockmap'] },
  { dir: path.join(DIST, 'windows'), exts: ['.exe', '.blockmap', '.7z'] },
];

/** 从文件名提取版本号（如 MTable-1.0.68-mac.dmg → 1.0.68），提取不到返回 null
 *  严格匹配纯 x.y.z 且后面紧跟分隔符（前瞻不吞字符），
 *  避免把文件名后缀（-mac.dmg）误当版本号导致 dmg 与 blockmap 归组不一致 */
function versionOf(name) {
  const m = name.match(/-(\d+\.\d+\.\d+)(?=[-.])/);
  return m ? m[1] : null;
}

/** 版本号比较：a 更新返回负值（用于升序排序后取尾部） */
function cmpVer(a, b) {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

let removed = 0;
for (const { dir, exts } of TARGETS) {
  if (!fs.existsSync(dir)) continue;

  // 收集安装包类文件并按版本归组
  const byVersion = new Map(); // version → [文件名]
  for (const name of fs.readdirSync(dir)) {
    if (!exts.some((ext) => name.endsWith(ext))) continue; // 只看安装包类文件
    const v = versionOf(name);
    if (!v) continue; // 解析不出版本号的不动
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(name);
  }

  // 保留最近 KEEP_COUNT 个版本 + 当前版本
  const versions = [...byVersion.keys()].sort(cmpVer);
  const keepSet = new Set(versions.slice(-KEEP_COUNT));
  keepSet.add(version);

  for (const [v, names] of byVersion) {
    if (keepSet.has(v)) continue;
    for (const name of names) {
      fs.unlinkSync(path.join(dir, name));
      removed++;
      console.log(`  removed ${path.relative(path.join(DIST, '..'), path.join(dir, name))}`);
    }
  }
}

console.log(removed
  ? `==> Cleaned ${removed} old installer file(s), kept the latest ${KEEP_COUNT} versions (current v${version}).`
  : `==> No old installers to clean (latest ${KEEP_COUNT} versions kept, current v${version}).`);
