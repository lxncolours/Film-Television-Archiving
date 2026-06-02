#!/bin/sh
set -e

echo "=========================================="
echo "  Movie Archive - Docker 启动脚本"
echo "=========================================="

# 通过 ghcr.io API 自动获取最新版本号标签
echo "正在获取最新版本号..."
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:lxncolours/Film-Television-Archiving:pull" | sed 's/.*"token":"\([^"]*\)".*/\1/')
TAGS_JSON=$(curl -s -H "Authorization: Bearer $TOKEN" "https://ghcr.io/v2/lxncolours/Film-Television-Archiving/tags/list")
VERSION_TAGS=$(echo "$TAGS_JSON" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -V)
LATEST_VERSION=$(echo "$VERSION_TAGS" | tail -1)

if [ -z "$LATEST_VERSION" ]; then
  echo "无法获取版本号，使用默认标签: latest"
  echo ""
  docker compose pull
  docker compose up -d
else
  echo "最新版本: $LATEST_VERSION"
  echo ""
  APP_VERSION=$LATEST_VERSION docker compose pull
  APP_VERSION=$LATEST_VERSION docker compose up -d
fi

echo ""
echo "启动完成！"
echo "访问地址: http://localhost:5280"
echo "=========================================="
