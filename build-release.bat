@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title AI 股票雷達 · 打包發行版

echo.
echo ================================================================
echo   打包 AI 產業鏈股票雷達 for Windows
echo ================================================================
echo.
echo   本腳本會產出：electron/release/AI-Stock-Radar-Setup-1.0.0.exe
echo   （安裝版）以及 Portable 版。
echo.
echo   需求：
echo     - Python 3.11+
echo     - Node.js 20+
echo     - 網路連線（下載 embedded Python、deps）
echo.
echo   預估時間：15-30 分鐘（首次）
echo ================================================================
pause

cd /d "%~dp0"

:: ──────────────────────────────────────────────────────────────────
:: Step 1: Build React frontend as static files
:: ──────────────────────────────────────────────────────────────────
echo.
echo [1/6] 編譯 React 前端...
cd frontend
call npm install
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
cd ..
echo   [OK] 前端已編譯至 frontend/dist

:: ──────────────────────────────────────────────────────────────────
:: Step 2: Download embedded Python
:: ──────────────────────────────────────────────────────────────────
set PYTHON_VERSION=3.11.9
set PYTHON_ZIP=python-%PYTHON_VERSION%-embed-amd64.zip
set PYTHON_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/%PYTHON_ZIP%

echo.
echo [2/6] 下載 embedded Python %PYTHON_VERSION%...
if not exist "electron\python-embed" (
    if not exist "electron\%PYTHON_ZIP%" (
        powershell -Command "Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile 'electron\%PYTHON_ZIP%'"
        if errorlevel 1 goto fail
    )
    powershell -Command "Expand-Archive -Path 'electron\%PYTHON_ZIP%' -DestinationPath 'electron\python-embed' -Force"
    if errorlevel 1 goto fail

    :: Enable pip: uncomment import site in python311._pth
    powershell -Command "(Get-Content 'electron\python-embed\python311._pth') -replace '#import site', 'import site' | Set-Content 'electron\python-embed\python311._pth'"

    :: Install pip
    powershell -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile 'electron\python-embed\get-pip.py'"
    electron\python-embed\python.exe electron\python-embed\get-pip.py --no-warn-script-location
    if errorlevel 1 goto fail

    echo   [OK] embedded Python 已安裝
) else (
    echo   [SKIP] 已存在 electron/python-embed
)

:: ──────────────────────────────────────────────────────────────────
:: Step 3: Install backend dependencies into embedded Python
:: ──────────────────────────────────────────────────────────────────
echo.
echo [3/6] 安裝後端 Python 套件到 embedded Python...
electron\python-embed\python.exe -m pip install --no-warn-script-location -r backend\requirements.txt
if errorlevel 1 goto fail
echo   [OK] Python 套件已安裝

:: ──────────────────────────────────────────────────────────────────
:: Step 4: Install Playwright Chromium into embedded Python
:: ──────────────────────────────────────────────────────────────────
echo.
echo [4/6] 下載 Playwright Chromium（FB 抓取用，~150MB）...
set PLAYWRIGHT_BROWSERS_PATH=%CD%\electron\python-embed\playwright-browsers
electron\python-embed\python.exe -m playwright install chromium
if errorlevel 1 goto fail
echo   [OK] Playwright Chromium 已安裝

:: ──────────────────────────────────────────────────────────────────
:: Step 5: Install Electron dependencies
:: ──────────────────────────────────────────────────────────────────
echo.
echo [5/6] 安裝 Electron 套件...
cd electron
call npm install
if errorlevel 1 goto fail
cd ..
echo   [OK] Electron 套件已安裝

:: ──────────────────────────────────────────────────────────────────
:: Step 6: Build installer + portable exe
:: ──────────────────────────────────────────────────────────────────
echo.
echo [6/6] 打包 Electron 安裝檔（需要 5-15 分鐘）...
cd electron
call npm run dist
if errorlevel 1 goto fail
cd ..

echo.
echo ================================================================
echo   打包完成！
echo ================================================================
echo.
echo   產出檔案：
dir /b electron\release\*.exe
echo.
echo   - AI-Stock-Radar-Setup-*.exe  → 標準安裝版
echo   - AI-Stock-Radar-Portable-*.exe → 免安裝版
echo.
echo   這兩個檔案都是 self-contained，使用者不用裝 Python / Node。
echo ================================================================
pause
exit /b 0

:fail
echo.
echo ================================================================
echo   打包失敗！請檢查上方錯誤訊息。
echo ================================================================
pause
exit /b 1
