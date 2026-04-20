@echo off
setlocal enabledelayedexpansion
title AI Stock Radar - Build Release

echo.
echo ================================================================
echo   AI Stock Radar - Build Windows Installer
echo ================================================================
echo.
echo   Output: electron\release\AI-Stock-Radar-Setup-1.0.0.exe
echo           electron\release\AI-Stock-Radar-Portable-1.0.0.exe
echo.
echo   Requirements:
echo     - Python 3.11+ on PATH
echo     - Node.js 20+ on PATH
echo     - Internet connection
echo.
echo   Time: 15-30 minutes on first build
echo ================================================================
pause

cd /d "%~dp0"

:: --------------------------------------------------------------
:: Step 1: Build React frontend as static files
:: --------------------------------------------------------------
echo.
echo [1/6] Building React frontend...
cd frontend
call npm install
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
cd ..
echo   [OK] Frontend built to frontend\dist

:: --------------------------------------------------------------
:: Step 2: Download embedded Python
:: --------------------------------------------------------------
set PYTHON_VERSION=3.11.9
set PYTHON_ZIP=python-%PYTHON_VERSION%-embed-amd64.zip
set PYTHON_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/%PYTHON_ZIP%

echo.
echo [2/6] Downloading embedded Python %PYTHON_VERSION%...
if not exist "electron\python-embed" (
    if not exist "electron\%PYTHON_ZIP%" (
        powershell -Command "Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile 'electron\%PYTHON_ZIP%'"
        if errorlevel 1 goto fail
    )
    powershell -Command "Expand-Archive -Path 'electron\%PYTHON_ZIP%' -DestinationPath 'electron\python-embed' -Force"
    if errorlevel 1 goto fail

    :: Enable pip by uncommenting "import site" in python311._pth
    powershell -Command "(Get-Content 'electron\python-embed\python311._pth') -replace '#import site', 'import site' | Set-Content 'electron\python-embed\python311._pth'"

    :: Install pip
    powershell -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile 'electron\python-embed\get-pip.py'"
    electron\python-embed\python.exe electron\python-embed\get-pip.py --no-warn-script-location
    if errorlevel 1 goto fail

    echo   [OK] Embedded Python installed
) else (
    echo   [SKIP] electron\python-embed already exists
)

:: --------------------------------------------------------------
:: Step 3: Install backend dependencies into embedded Python
:: --------------------------------------------------------------
echo.
echo [3/6] Installing backend Python packages into embedded Python...
electron\python-embed\python.exe -m pip install --no-warn-script-location -r backend\requirements.txt
if errorlevel 1 goto fail
echo   [OK] Python packages installed

:: --------------------------------------------------------------
:: Step 4: Install Playwright Chromium
:: --------------------------------------------------------------
echo.
echo [4/6] Downloading Playwright Chromium (~150 MB for FB scraping)...
set PLAYWRIGHT_BROWSERS_PATH=%CD%\electron\python-embed\playwright-browsers
electron\python-embed\python.exe -m playwright install chromium
if errorlevel 1 goto fail
echo   [OK] Playwright Chromium installed

:: --------------------------------------------------------------
:: Step 5: Install Electron dependencies
:: --------------------------------------------------------------
echo.
echo [5/6] Installing Electron packages...
cd electron
call npm install
if errorlevel 1 goto fail
cd ..
echo   [OK] Electron packages installed

:: --------------------------------------------------------------
:: Step 6: Build installer + portable exe
:: --------------------------------------------------------------
echo.
echo [6/6] Packaging Electron installer (5-15 minutes)...
cd electron
call npm run dist
if errorlevel 1 goto fail
cd ..

echo.
echo ================================================================
echo   Build complete!
echo ================================================================
echo.
echo   Output files:
dir /b electron\release\*.exe
echo.
echo   - AI-Stock-Radar-Setup-*.exe    (NSIS installer)
echo   - AI-Stock-Radar-Portable-*.exe (portable, no install)
echo.
echo   These are self-contained; end users do NOT need Python or Node.
echo ================================================================
pause
exit /b 0

:fail
echo.
echo ================================================================
echo   Build failed! Check the error messages above.
echo ================================================================
pause
exit /b 1
