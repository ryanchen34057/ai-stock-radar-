@echo off
setlocal enabledelayedexpansion
title AI Stock Radar - Update

cd /d "%~dp0"

echo.
echo ================================================================
echo   AI Stock Radar - Updating
echo ================================================================
echo.

:: ---- Check git ----
where git 1>nul 2>&1
if errorlevel 1 (
    echo   [FAIL] git not found on this system.
    echo.
    echo   You downloaded this as a ZIP. To update, you need to:
    echo     1. Download the latest ZIP from https://github.com/ryanchen34057/ai-stock-radar-
    echo     2. Back up backend\data\stocks.db  ^(your stocks + settings^)
    echo     3. Extract the new ZIP over a fresh folder
    echo     4. Restore your stocks.db into backend\data\
    echo     5. Run setup.bat then run.bat
    echo.
    echo   Or install Git from https://git-scm.com/  then re-run update.bat.
    pause
    exit /b 1
)

if not exist ".git" (
    echo   [FAIL] Not a git repository.
    echo   This folder was downloaded as ZIP, not cloned. See above ZIP steps.
    pause
    exit /b 1
)

:: ---- Remind to close the running app ----
echo   IMPORTANT: close the running app before updating!
echo     - Close the "AI Stock Radar - Backend" window if open
echo.
pause

:: ---- Resolve Python + Node command paths (same logic as setup.bat/run.bat) ----
set "PY_CMD="
py -3.12 --version 1>nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3.12"
if not defined PY_CMD (
    where python3.12 1>nul 2>&1
    if not errorlevel 1 set "PY_CMD=python3.12"
)
if not defined PY_CMD (
    where python 1>nul 2>&1
    if not errorlevel 1 set "PY_CMD=python"
)
if not defined PY_CMD (
    echo   [FAIL] Python not found. Re-run setup.bat first.
    pause
    exit /b 1
)

set "NODE_DIR="
where node 1>nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%p in ('where node') do (
        if not defined NODE_DIR for %%d in ("%%~dpp") do set "NODE_DIR=%%~fd"
    )
)
if not defined NODE_DIR if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs"
if not defined NODE_DIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
if not defined NODE_DIR (
    echo   [FAIL] Node.js not found. Re-run setup.bat first.
    pause
    exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"

:: ---- Remember old hashes of key files to detect changes ----
set "OLD_REQ=0"
set "OLD_PKG=0"
if exist "backend\requirements.txt" (
    for /f "delims=" %%H in ('%PY_CMD% -c "import hashlib;print(hashlib.sha1(open('backend/requirements.txt','rb').read()).hexdigest())"') do set "OLD_REQ=%%H"
)
if exist "frontend\package.json" (
    for /f "delims=" %%H in ('%PY_CMD% -c "import hashlib;print(hashlib.sha1(open('frontend/package.json','rb').read()).hexdigest())"') do set "OLD_PKG=%%H"
)

:: ---- Step 1: git pull ----
echo.
echo [1/4] Pulling latest code from GitHub...

:: Auto-stash local changes so a pull doesn't fail on dirty tree
git diff --quiet
set "HAS_LOCAL_CHANGES=%errorlevel%"
if not "%HAS_LOCAL_CHANGES%"=="0" (
    echo   Local edits detected - stashing them temporarily...
    git stash push -u -m "auto-stash by update.bat" >nul
    set "STASHED=1"
) else (
    set "STASHED=0"
)

git pull --ff-only origin master
if errorlevel 1 (
    echo.
    echo   [FAIL] git pull failed. Possible reasons:
    echo     - Your local branch diverged from master
    echo     - Network issue
    echo     - Merge conflict in your local edits
    if "%STASHED%"=="1" (
        echo   Your stashed changes are safe - restore with: git stash pop
    )
    pause
    exit /b 1
)

:: Re-apply stashed changes if any
if "%STASHED%"=="1" (
    echo   Re-applying your stashed local edits...
    git stash pop
    if errorlevel 1 (
        echo   [WARN] Stash pop had conflicts - resolve manually with: git status
    )
)

:: ---- Step 2: compare hashes to decide whether to re-install deps ----
set "NEW_REQ=0"
set "NEW_PKG=0"
for /f "delims=" %%H in ('%PY_CMD% -c "import hashlib;print(hashlib.sha1(open('backend/requirements.txt','rb').read()).hexdigest())"') do set "NEW_REQ=%%H"
for /f "delims=" %%H in ('%PY_CMD% -c "import hashlib;print(hashlib.sha1(open('frontend/package.json','rb').read()).hexdigest())"') do set "NEW_PKG=%%H"

echo.
echo [2/4] Backend Python packages...
if "%OLD_REQ%"=="%NEW_REQ%" (
    echo   [SKIP] requirements.txt unchanged
) else (
    echo   requirements.txt changed - installing new packages...
    cd backend
    %PY_CMD% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo   [FAIL] pip install failed
        pause
        exit /b 1
    )
    cd ..
    echo   [OK] Backend packages updated
)

echo.
echo [3/4] Frontend JS packages...
if "%OLD_PKG%"=="%NEW_PKG%" (
    echo   [SKIP] package.json unchanged
) else (
    echo   package.json changed - installing new packages...
    cd frontend
    call npm install
    if errorlevel 1 (
        echo   [FAIL] npm install failed
        pause
        exit /b 1
    )
    cd ..
    echo   [OK] Frontend packages updated
)

echo.
echo [4/4] Rebuilding frontend...
cd frontend
call npm run build
if errorlevel 1 (
    echo   [FAIL] Frontend build failed
    pause
    exit /b 1
)
cd ..
echo   [OK] Frontend rebuilt

echo.
echo ================================================================
echo   Update complete!
echo ================================================================
echo.
echo   Your data (stocks.db, settings, FB cookie) was not touched.
echo.
echo   Run run.bat to start the updated app.
echo ================================================================
pause
