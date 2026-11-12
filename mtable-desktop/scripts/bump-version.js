//
// scripts/bump-version.js — 打包前自动将 package.json 的版本号 patch 位 +1
// 如 1.0.0 → 1.0.1；patch 上限 99，1.0.99 的下一版本进位为 1.1.0。可用 MBUMP=0 跳过自增（按当前版本号打包）。
//
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (process.env.MBUMP === '0') {
  console.log(`==> Version (no bump): v${pkg.version}`);
  process.exit(0);
}

const parts = String(pkg.version || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
while (parts.length < 3) parts.push(0);
parts[2] += 1;
if (parts[2] > 99) {
  parts[2] = 0;
  parts[1] += 1;
}
pkg.version = parts.slice(0, 3).join('.');

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`==> Version bumped: v${pkg.version}`);
