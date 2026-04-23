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

:: Ensure Node.js dir is on PATH (for npm fallback build below)
if not defined NODE_DIR (
    where node 1>nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%p in ('where node') do (
            if not defined NODE_DIR for %%d in ("%%~dpp") do set "NODE_DIR=%%~fd"
        )
    )
)
if not defined NODE_DIR if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs"
if not defined NODE_DIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"

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

:: Pick a Python runner. Using `&&` chains because CMD's `if errorlevel`
:: inside parentheses is parse-time, not runtime.
set "PY_CMD="
for %%P in (py python python3) do if not defined PY_CMD (
    %%P --version 1>nul 2>&1 && set "PY_CMD=%%P"
)
if not defined PY_CMD (
    echo   [FAIL] No Python found. Run setup.bat first.
    pause
    exit /b 1
)

:: Start backend in a new window -- backend serves both API and the built
:: React app, so we don't need a separate frontend server.
echo [1/2] Starting backend (serves API + frontend on port 8000)...
start "AI Stock Radar - Backend" cmd /k "cd /d %~dp0backend && %PY_CMD% -m uvicorn main:app --host 127.0.0.1 --port 8000"

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
