#!/usr/bin/env bash
# AI 產業鏈股票雷達 — 一鍵安裝（macOS / Linux）
set -e
cd "$(dirname "$0")"

echo
echo "================================================================"
echo "  AI 產業鏈股票雷達 - 第一次安裝"
echo "================================================================"
echo

# ---- Python check ----
echo "[1/5] 檢查 Python..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "  找不到 Python，請先安裝："
  echo "    macOS:  brew install python@3.11"
  echo "    Ubuntu: sudo apt install python3.11 python3-pip python3-venv"
  exit 1
fi
python3 --version
echo "  [OK] Python 已安裝"

# ---- Node check ----
echo
echo "[2/5] 檢查 Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "  找不到 Node.js，請先安裝："
  echo "    macOS:  brew install node"
  echo "    Ubuntu: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install nodejs"
  exit 1
fi
node --version
echo "  [OK] Node.js 已安裝"

# ---- Backend deps ----
echo
echo "[3/5] 安裝後端 Python 套件（可能需要 3-5 分鐘）..."
cd backend
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
cd ..
echo "  [OK] 後端套件安裝完成"

# ---- Frontend deps ----
echo
echo "[4/5] 安裝前端 JS 套件（可能需要 2-3 分鐘）..."
cd frontend
npm install
npm run build
cd ..
echo "  [OK] 前端安裝完成"

# ---- Playwright ----
echo
echo "[5/5] 安裝 Playwright Chromium..."
cd backend
python3 -m playwright install chromium
cd ..
echo "  [OK] Playwright 安裝完成"

echo
echo "================================================================"
echo "  安裝完成！"
echo "================================================================"
echo
echo "  啟動應用程式："
echo "    ./run.sh"
echo
echo "  第一次啟動會花 5-15 分鐘抓取所有股票歷史資料。"
echo
