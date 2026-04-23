@echo off
setlocal enabledelayedexpansion
title AI Stock Radar - Setup

echo.
echo ================================================================
echo   AI Stock Radar - First-time Setup
echo ================================================================
echo.
echo   Auto-installs:
echo     1. Python 3.11+ check
echo     2. Node.js 20+ check
echo     3. Backend Python packages
echo     4. Frontend JS packages
echo     5. Playwright Chromium (for Facebook scraping)
echo.
echo   Time: ~5-10 minutes
echo ================================================================
echo.
pause

cd /d "%~dp0"

:: ---- Python check ----
echo.
echo [1/5] Checking Python...

:: Robust Python detection. `if errorlevel` inside parentheses is parse-time
:: in CMD (not runtime), so we use `&&` chains on single lines.
set "PY_CMD="
for %%P in (py python python3) do if not defined PY_CMD (
    %%P --version 1>nul 2>&1 && set "PY_CMD=%%P"
)

if not defined PY_CMD (
    echo   [FAIL] No Python found on this system.
    echo     Install Python 3.11 or 3.12: https://www.python.org/downloads/
    echo     IMPORTANT: check "Add Python to PATH" during install.
    pause
    exit /b 1
)

echo   Using: %PY_CMD%
%PY_CMD% --version
if errorlevel 1 (
    echo   [FAIL] %PY_CMD% exists but failed to run.
    pause
    exit /b 1
)

:: Warn if not 3.12 (3.14 misses wheels, 3.10- may miss newer features)
for /f "tokens=2" %%v in ('%PY_CMD% --version 2^>^&1') do set "PY_VER=%%v"
echo   Detected Python %PY_VER%
echo %PY_VER% | findstr /r "^3\.1[12]\." >nul
if errorlevel 1 (
    echo.
    echo   [WARN] Python %PY_VER% may have missing package wheels.
    echo   Recommended: Python 3.12.  Continue anyway? Press Ctrl+C to abort.
    pause
)
echo   [OK] Python ready

:: ---- Node check ----
echo.
echo [2/5] Checking Node.js...

:: Try PATH first, then common install locations
set "NODE_DIR="
where node 1>nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%p in ('where node') do (
        if not defined NODE_DIR (
            for %%d in ("%%~dpp") do set "NODE_DIR=%%~fd"
        )
    )
)
if not defined NODE_DIR if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs"
if not defined NODE_DIR if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles(x86)%\nodejs"
if not defined NODE_DIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"

if not defined NODE_DIR (
    echo   [FAIL] Node.js not found on this system.
    echo     Install Node.js LTS: https://nodejs.org/
    echo     IMPORTANT: keep default "Add to PATH" checked during install.
    pause
    exit /b 1
)

:: Prepend node dir to PATH for the rest of this script so node/npm always work
set "PATH=%NODE_DIR%;%PATH%"
echo   Using: %NODE_DIR%
node --version
echo   [OK] Node.js installed

:: ---- Backend deps ----
echo.
echo [3/5] Installing backend Python packages (3-5 min)...
cd backend
%PY_CMD% -m pip install --upgrade pip >nul
%PY_CMD% -m pip install --upgrade -r requirements.txt
if errorlevel 1 (
    echo   [FAIL] Python package install failed - check internet
    pause
    exit /b 1
)

:: Import sanity check - catches numpy/pandas ABI mismatches or half-installed
:: envs that `pip install` silently leaves behind. If any critical module
:: fails to import, force-reinstall the common ABI-sensitive pair so users
:: don't have to debug cryptic 'size changed' errors themselves.
echo   Verifying installed packages import cleanly...
%PY_CMD% -c "import fastapi, uvicorn, pandas, numpy, yfinance, playwright, apscheduler" 1>nul 2>nul
if errorlevel 1 (
    echo   [WARN] Import sanity check failed - likely a numpy/pandas ABI
    echo          mismatch. Force-reinstalling the core stack...
    %PY_CMD% -m pip install --upgrade --force-reinstall --no-cache-dir numpy pandas yfinance
    if errorlevel 1 (
        echo   [FAIL] Force reinstall failed
        pause
        exit /b 1
    )
    %PY_CMD% -c "import fastapi, uvicorn, pandas, numpy, yfinance, playwright, apscheduler"
    if errorlevel 1 (
        echo   [FAIL] Import check still failing after force-reinstall.
        echo         Run:  %PY_CMD% -c "import pandas"
        echo         for the specific error.
        pause
        exit /b 1
    )
)
echo   [OK] Python packages installed and verified
cd ..

:: ---- Frontend deps ----
echo.
echo [4/5] Installing frontend JS packages (2-3 min)...
cd frontend
call npm install
if errorlevel 1 (
    echo   [FAIL] npm install failed - check internet
    pause
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo   [FAIL] Frontend build failed
    pause
    exit /b 1
)
echo   [OK] Frontend built
cd ..

:: ---- Playwright browser ----
echo.
echo [5/5] Installing Playwright Chromium (for FB scraping)...
cd backend
%PY_CMD% -m playwright install chromium
cd ..
echo   [OK] Playwright installed

echo.
echo ================================================================
echo   Setup complete!
echo ================================================================
echo.
echo   To start the app:
echo     run.bat
echo.
echo   First launch takes 5-15 min to fetch all stock history.
echo   A progress bar will show which stock is being fetched.
echo.
pause
