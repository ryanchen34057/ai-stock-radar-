@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title AI 產業鏈股票雷達 · 一鍵安裝

echo.
echo ================================================================
echo   AI 產業鏈股票雷達 - 第一次安裝
echo ================================================================
echo.
echo   會自動檢查並安裝：
echo     1. Python 3.11+
echo     2. Node.js 20+
echo     3. 後端 Python 套件
echo     4. 前端 JS 套件
echo     5. Playwright 瀏覽器（Facebook 貼文抓取用）
echo.
echo   整個過程約 5-10 分鐘
echo ================================================================
echo.
pause

cd /d "%~dp0"

:: ---- Python check ----
echo.
echo [1/5] 檢查 Python...
where python >nul 2>nul
if errorlevel 1 (
    echo   找不到 Python，請先安裝：
    echo     1. 到 https://www.python.org/downloads/ 下載 Python 3.11 以上
    echo     2. 安裝時勾選 "Add Python to PATH"
    echo     3. 安裝完後重新執行本程式
    pause
    exit /b 1
)
python --version
echo   [OK] Python 已安裝

:: ---- Node check ----
echo.
echo [2/5] 檢查 Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo   找不到 Node.js，請先安裝：
    echo     1. 到 https://nodejs.org/ 下載 LTS 版本
    echo     2. 一路下一步安裝
    echo     3. 安裝完後重新執行本程式
    pause
    exit /b 1
)
node --version
echo   [OK] Node.js 已安裝

:: ---- Backend deps ----
echo.
echo [3/5] 安裝後端 Python 套件（可能需要 3-5 分鐘）...
cd backend
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo   [FAIL] Python 套件安裝失敗，請檢查網路
    pause
    exit /b 1
)
echo   [OK] Python 套件安裝完成
cd ..

:: ---- Frontend deps ----
echo.
echo [4/5] 安裝前端 JS 套件（可能需要 2-3 分鐘）...
cd frontend
call npm install
if errorlevel 1 (
    echo   [FAIL] npm install 失敗，請檢查網路
    pause
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo   [FAIL] 前端編譯失敗
    pause
    exit /b 1
)
echo   [OK] 前端安裝完成
cd ..

:: ---- Playwright browser ----
echo.
echo [5/5] 安裝 Playwright Chromium 瀏覽器（FB 抓取用）...
cd backend
python -m playwright install chromium
cd ..
echo   [OK] Playwright 已安裝

echo.
echo ================================================================
echo   安裝完成！
echo ================================================================
echo.
echo   接下來要「啟動」應用程式：
echo     請執行  run.bat
echo.
echo   第一次啟動時會花 5-15 分鐘抓取所有股票歷史資料，
echo   網頁上會有進度條告訴你目前進度。
echo.
pause
