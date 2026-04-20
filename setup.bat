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
where python >nul 2>nul
if errorlevel 1 (
    echo   Python not found. Please install first:
    echo     1. https://www.python.org/downloads/  (Python 3.11+)
    echo     2. IMPORTANT: check "Add Python to PATH" during install
    echo     3. Re-run this script after installing
    pause
    exit /b 1
)
python --version
echo   [OK] Python installed

:: ---- Node check ----
echo.
echo [2/5] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js not found. Please install first:
    echo     1. https://nodejs.org/  (LTS version)
    echo     2. Next-next-finish install
    echo     3. Re-run this script after installing
    pause
    exit /b 1
)
node --version
echo   [OK] Node.js installed

:: ---- Backend deps ----
echo.
echo [3/5] Installing backend Python packages (3-5 min)...
cd backend
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo   [FAIL] Python package install failed - check internet
    pause
    exit /b 1
)
echo   [OK] Python packages installed
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
python -m playwright install chromium
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
