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

:: Make sure frontend has been built (setup.bat does this too; this is a safety net)
if not exist "%~dp0frontend\dist\index.html" (
    echo Frontend dist not found. Building frontend first...
    cd frontend
    call npm run build
    if errorlevel 1 (
        echo   [FAIL] Frontend build failed. Please run setup.bat.
        pause
        exit /b 1
    )
    cd ..
)

:: Start backend in a new window — backend serves both API and the built
:: React app, so we don't need a separate frontend server.
echo [1/2] Starting backend (serves API + frontend on port 8000)...
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
echo   Opening browser to http://127.0.0.1:8000/
echo ================================================================
start "" http://127.0.0.1:8000/
echo.
echo   Keep the Backend window open while you use the app.
echo   Close the Backend window to fully stop everything.
echo.
pause
