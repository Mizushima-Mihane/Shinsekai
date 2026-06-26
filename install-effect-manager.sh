#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  ============================================"
echo "    Shinsekai 特效管理系统 — 抢鲜体验安装"
echo "  ============================================"
echo

echo "[1/3] 拉取最新代码..."
git fetch origin

echo "[2/3] 切换到 feature/effect-manager 分支..."
git checkout feature/effect-manager
git pull origin feature/effect-manager

echo "[3/3] 构建前端..."
cd frontend
pnpm install
pnpm run build

cd "$(dirname "$0")"
echo
echo "  ============================================"
echo "    安装完成！重启 Python 后端即可体验。"
echo "  ============================================"
echo
