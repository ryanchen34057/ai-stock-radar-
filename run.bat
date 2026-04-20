@echo off
setlocal enabledelayedexpansion
title AI Stock Radar - Running

cd /d "%~dp0"

echo.
echo ================================================================
echo   AI Stock Radar - Starting
echo ================================================================
echo.
echo   First time? Run setup.bat first.
echo.

:: Start backend in a new window
echo [1/2] Starting backend (new window)...
start "AI Stock Radar - Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

:: Wait for backend to come up
echo [2/2] Waiting for backend...
set /a attempts=0
:wait_loop
set /a attempts+=1
timeout /t 1 /nobreak >nul
curl -s http://127.0.0.1:8000/health >nul 2>&1
if errorlevel 1 (
    if !attempts! GEQ 30 (
        echo   [FAIL] Backend did not start in 30s - check the Backend window for errors
        pause
        exit /b 1
    )
    goto wait_loop
)
echo   [OK] Backend ready

echo.
echo ================================================================
echo   Opening browser...
echo ================================================================

if exist "%~dp0frontend\dist\index.html" (
    echo Using built frontend at frontend\dist
    start "AI Stock Radar - Frontend" cmd /k "cd /d %~dp0frontend\dist && python -m http.server 5173"
    timeout /t 2 /nobreak >nul
    start "" http://127.0.0.1:5173/
) else (
    echo No built frontend found, using dev mode (npm run dev)
    start "AI Stock Radar - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
    timeout /t 5 /nobreak >nul
    start "" http://127.0.0.1:5173/
)

echo.
echo   Browser opened. Closing this window will NOT stop the app.
echo   To fully stop: close both Backend and Frontend windows.
echo.
pause
