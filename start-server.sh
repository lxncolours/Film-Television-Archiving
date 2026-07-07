#!/bin/bash
# Movie Archive Server 启动脚本 (macOS)
# 用法: 在终端中运行  ./start-server.sh  或  bash start-server.sh
# 停止: Ctrl+C

cd "$(dirname "$0")"

# 优先使用系统 node，回退到 workbuddy 管理的 node (已验证可运行本项目)
NODE_BIN=$(command -v node 2>/dev/null)
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="/Users/l1berica/.workbuddy/binaries/node/versions/22.22.2/bin/node"
fi

echo "==> 工作目录: $(pwd)"
echo "==> Node: $NODE_BIN ($("$NODE_BIN" -v 2>/dev/null))"
APP_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
echo "==> 启动 Movie Archive Server v${APP_VERSION} ..."
echo

exec "$NODE_BIN" server/server.js
