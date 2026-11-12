#!/bin/bash
#
# build.sh — 构建 MTable 安装包（macOS .dmg + Windows .exe）
#
# 用法:
#   bash build.sh          双平台全量打包
#   bash build.sh mac      仅 macOS：产出 dmg + 更新本地 app/MTable.app（数据在项目根，双击即用）
#   bash build.sh win      仅 Windows：产出 NSIS .exe
#
# 产物（版本号每次打包自动 +1）:
#   dist/macos/MTable-<版本>-mac.dmg        如 MTable-1.0.1-mac.dmg（内含 MTable-<版本>.app）
#   dist/macos/mac-arm64/MTable-<版本>.app  解包 .app（mac 模式会复制为 app/MTable.app）
#   dist/windows/MTable-<版本>-windows.exe
#
# 说明:
#   - 在 macOS 上即可产出 Windows 安装包（electron-builder 跨平台生成 NSIS）
#   - 打包后历史安装包自动清理，只保留最近 3 个版本
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

PLATFORM="${1:-all}"
case "$PLATFORM" in
    mac|win|all) ;;
    *) echo "用法: bash build.sh [mac|win|all]"; exit 1 ;;
esac

if [ ! -d node_modules ]; then
    echo "==> Installing dependencies..."
    npm install
fi

# 版本号自动 +1（如 1.0.0 → 1.0.1），与发布到服务端的版本号保持一致
echo "==> Bumping version..."
npm run bump
VERSION="$(node -p "require('./package.json').version")"
echo "==> Version: v$VERSION"

if [ "$PLATFORM" = mac ] || [ "$PLATFORM" = all ]; then
    echo "==> Building macOS installer (dmg)..."
    # -c.productName 使 dmg 内的 .app 命名为 MTable-<版本>.app；--dir 同时产出解包 .app
    npx electron-builder --mac dmg --dir -c.productName="MTable-$VERSION" -c.directories.output=dist/macos

    # 更新本地日常使用的 app/MTable.app（与开发模式共用项目根 db/ media/ userdata/）
    echo "==> Updating local app/MTable.app..."
    mkdir -p app
    rm -rf app/MTable.app
    cp -R "dist/macos/mac-arm64/MTable-$VERSION.app" app/MTable.app
    rm -rf dist/macos/mac-arm64 dist/macos/builder-debug.yml dist/macos/builder-effective-config.yaml   # 解包 .app 与调试快照均为中间产物
    echo "    Local app: $ROOT_DIR/app/MTable.app"
fi

if [ "$PLATFORM" = win ] || [ "$PLATFORM" = all ]; then
    echo "==> Building Windows installer (nsis)..."
    npx electron-builder --win -c.directories.output=dist/windows

    # 清理中间产物：解包目录、调试快照、NSIS 源包（失败构建残留）、blockmap（未启用自动更新）
    rm -rf dist/windows/win-unpacked dist/windows/builder-debug.yml dist/windows/builder-effective-config.yaml \
        dist/windows/*.nsis.7z dist/windows/*.blockmap
fi

# 清理历史安装包：dist 下只保留最近 3 个版本的产物
echo "==> Pruning old installers..."
node scripts/prune-dist.js

echo ""
echo "==> Build complete! ($PLATFORM)"
if [ "$PLATFORM" = mac ] || [ "$PLATFORM" = all ]; then
    echo "    macOS dmg: $ROOT_DIR/dist/macos/MTable-$VERSION-mac.dmg"
fi
if [ "$PLATFORM" = win ] || [ "$PLATFORM" = all ]; then
    echo "    Windows:   $ROOT_DIR/dist/windows/MTable-$VERSION-windows.exe"
fi
