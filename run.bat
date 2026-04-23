@echo off
setlocal enabledelayedexpansion
title AI Stock Radar

cd /d "%~dp0"

echo.
echo ================================================================
echo   AI Stock Radar
echo ================================================================
echo.

:: ---- Python ----
set "PY_CMD="
for %%P in (py python python3) do if not defined PY_CMD (
    %%P --version 1>nul 2>&1 && set "PY_CMD=%%P"
)
if not defined PY_CMD (
    echo [FAIL] Python not found. Run setup.bat first.
    pause
    exit /b 1
)

:: ---- Node ----
set "NODE_DIR="
where node 1>nul 2>&1 && (
    for /f "delims=" %%p in ('where node') do (
        if not defined NODE_DIR for %%d in ("%%~dpp") do set "NODE_DIR=%%~fd"
    )
)
if not defined NODE_DIR if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs"
if not defined NODE_DIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"

:: ---- Auto-update (best-effort, never blocks startup) ----
where git 1>nul 2>&1
if errorlevel 1 goto :skip_update
if not exist ".git" goto :skip_update

:: Snapshot old hashes for requirements.txt + package.json
set "OLD_REQ=0"
set "OLD_PKG=0"
if exist "backend\requirements.txt" (
    for /f "delims=" %%H in ('%PY_CMD% -c "import hashlib;print(hashlib.sha1(open('backend/requirements.txt','rb').read()).hexdigest())" 2^>nul') do set "OLD_REQ=%%H"
)
if exist "frontend\package.json" (
    for /f "delims=" %%H in ('%PY_CMD% -c "import hashlib;print(hashlib.sha1(open('frontend/package.json','rb').read()).hexdigest())" 2^>nul') do set "OLD_PKG=%%H"
)

echo [1/4] Checking for updates from GitHub...
git diff --quiet
set "HAS_LOCAL_CHANGES=%errorlevel%"
if not "%HAS_LOCAL_CHANGES%"=="0" (
    echo   Local edits detected - stashing them...
    git stash push -u -m "auto-stash by run.bat" >nul 2>nul
    set "STASHED=1"
) else (
    set "STASHED=0"
)
git pull --ff-only origin master 2>nul
set "PULL_RC=%errorlevel%"
if "%STASHED%"=="1" git stash pop 1>nul 2>nul
if not "%PULL_RC%"=="0" (
    echo   [WARN] git pull skipped or failed - continuing with local code
    goto :skip_update
)
echo   [OK] code up to date

:: If requirements.txt changed, reinstall backend deps
set "NEW_REQ=0"
for /f "delims=" %%H in ('%PY_CMD% -c "import hashlib;print(hashlib.sha1(open('backend/requirements.txt','rb').read()).hexdigest())" 2^>nul') do set "NEW_REQ=%%H"
echo [2/4] Backend packages...
if "%OLD_REQ%"=="%NEW_REQ%" (
    echo   [SKIP] requirements.txt unchanged
) else (
    echo   requirements.txt changed - installing new packages...
    pushd backend
    %PY_CMD% -m pip install --upgrade -r requirements.txt
    popd
)

:: Import sanity check - heals numpy/pandas ABI mismatch
%PY_CMD% -c "import fastapi, uvicorn, pandas, numpy, yfinance, playwright, apscheduler" 1>nul 2>nul
if errorlevel 1 (
    echo   [WARN] Some backend imports failed - force-reinstalling core stack
    %PY_CMD% -m pip install --upgrade --force-reinstall --no-cache-dir numpy pandas yfinance
)

:: If package.json changed, reinstall frontend deps
set "NEW_PKG=0"
for /f "delims=" %%H in ('%PY_CMD% -c "import hashlib;print(hashlib.sha1(open('frontend/package.json','rb').read()).hexdigest())" 2^>nul') do set "NEW_PKG=%%H"
echo [3/4] Frontend packages...
if "%OLD_PKG%"=="%NEW_PKG%" (
    echo   [SKIP] package.json unchanged
) else (
    echo   package.json changed - installing new packages...
    pushd frontend
    call npm install
    popd
)

echo [4/4] Rebuilding frontend...
pushd frontend
call npm run build 1>nul 2>nul
if errorlevel 1 (
    echo   [WARN] Frontend build failed - falling back to last-good dist
)
popd
echo.

:skip_update

:: ---- Ensure frontend dist exists; build if missing ----
if not exist "%~dp0frontend\dist\index.html" (
    echo Frontend dist missing - building now...
    pushd frontend
    call npm run build
    if errorlevel 1 (
        popd
        echo   [FAIL] Frontend build failed. Run setup.bat first.
        pause
        exit /b 1
    )
    popd
)

:: ---- Start backend ----
echo.
echo ================================================================
echo   Starting AI Stock Radar on http://127.0.0.1:8000/
echo ================================================================
echo.
echo [1/2] Starting backend...
start "AI Stock Radar - Backend" cmd /k "cd /d %~dp0backend && %PY_CMD% -m uvicorn main:app --host 127.0.0.1 --port 8000"

echo [2/2] Waiting for backend to be ready...
set /a attempts=0
:wait_loop
set /a attempts+=1
timeout /t 1 /nobreak >nul
curl -s http://127.0.0.1:8000/health >nul 2>&1
if errorlevel 1 (
    if !attempts! GEQ 30 (
        echo   [FAIL] Backend did not start in 30s - check Backend window for errors
        pause
        exit /b 1
    )
    goto wait_loop
)
echo   [OK] Backend ready

echo.
echo Opening browser: http://127.0.0.1:8000/
start "" http://127.0.0.1:8000/
echo.
echo Close the "AI Stock Radar - Backend" window to fully stop everything.
echo.
pause

