@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title AI 產業鏈股票雷達 · 執行中

cd /d "%~dp0"

echo.
echo ================================================================
echo   AI 產業鏈股票雷達 - 啟動中
echo ================================================================
echo.
echo   若是第一次使用，請先執行 setup.bat
echo.

:: Start backend in a new window
echo [1/2] 啟動後端伺服器（新視窗）...
start "AI Stock Radar - Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

:: Wait for backend to come up
echo [2/2] 等待後端就緒...
set /a attempts=0
:wait_loop
set /a attempts+=1
timeout /t 1 /nobreak >nul
curl -s http://127.0.0.1:8000/health >nul 2>&1
if errorlevel 1 (
    if !attempts! GEQ 30 (
        echo   [FAIL] 後端啟動超時，請看後端視窗的錯誤訊息
        pause
        exit /b 1
    )
    goto wait_loop
)
echo   [OK] 後端就緒

echo.
echo ================================================================
echo   開啟瀏覽器...
echo ================================================================

:: Use dist (built) assets via python's simple http server? No — just open the dev server
:: If frontend/dist exists, serve it with python's http.server. Else fallback to npm dev.
if exist "%~dp0frontend\dist\index.html" (
    echo 以 frontend\dist 作為靜態網頁
    start "AI Stock Radar - Frontend" cmd /k "cd /d %~dp0frontend\dist && python -m http.server 5173"
    timeout /t 2 /nobreak >nul
    start "" http://127.0.0.1:5173/
) else (
    echo 未找到 frontend\dist，改用開發模式 (npm run dev)
    start "AI Stock Radar - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
    timeout /t 5 /nobreak >nul
    start "" http://127.0.0.1:5173/
)

echo.
echo   已在瀏覽器開啟。關閉本視窗不會關掉程式 —
echo   要完全關掉請關閉「Backend」與「Frontend」兩個視窗。
echo.
pause
