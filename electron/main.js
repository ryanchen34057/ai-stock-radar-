// AI 產業鏈股票雷達 — Electron main process
// Flow:
//   1. Spawn the FastAPI backend as a child process (using embedded Python in
//      production, or system python3 in dev).
//   2. Poll /health until backend is up.
//   3. Load http://127.0.0.1:8000/ into a BrowserWindow — backend serves the
//      pre-built React app from frontend/dist.
//   4. On window close, kill the backend subprocess.

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const IS_DEV = process.env.ELECTRON_DEV === '1';
const BACKEND_PORT = 8000;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

let backendProcess = null;
let mainWindow = null;
let splashWindow = null;

// ── Paths ─────────────────────────────────────────────────────────────────────
function resourcesRoot() {
  // In packaged app: process.resourcesPath → <install-dir>/resources
  // In dev:          project root (two levels above this file in a normal layout)
  if (IS_DEV) return path.resolve(__dirname, '..');
  return process.resourcesPath;
}

function backendDir() {
  return IS_DEV
    ? path.resolve(__dirname, '..', 'backend')
    : path.join(resourcesRoot(), 'backend');
}

function frontendDistDir() {
  return IS_DEV
    ? path.resolve(__dirname, '..', 'frontend', 'dist')
    : path.join(resourcesRoot(), 'frontend-dist');
}

function pythonExe() {
  if (IS_DEV) return process.platform === 'win32' ? 'python' : 'python3';
  // Packaged: embedded Python shipped as extraResources
  return path.join(resourcesRoot(), 'python', 'python.exe');
}

// ── Backend lifecycle ─────────────────────────────────────────────────────────
function startBackend() {
  const cwd = backendDir();
  const py  = pythonExe();

  // Check the embedded Python exists in production. If missing, show a dialog
  // rather than silently failing.
  if (!IS_DEV && !fs.existsSync(py)) {
    dialog.showErrorBox(
      'Python 未找到',
      `找不到內嵌的 Python：${py}\n請重新安裝本程式。`,
    );
    app.quit();
    return;
  }

  const env = { ...process.env };
  env.FRONTEND_DIST_DIR = frontendDistDir();
  // User data dir — DB, settings, FB profile, Playwright cache all go here
  // so the install dir itself stays read-only (avoids Program Files permissions).
  env.USER_DATA_DIR = app.getPath('userData');
  if (!IS_DEV) {
    // Embedded Python reads paths from python311._pth, NOT from PYTHONHOME.
    // Setting PYTHONHOME on embedded Python actively breaks it.
    // The _pth file contains:
    //     python311.zip
    //     .
    //     Lib\site-packages
    //     import site
    // so pip-installed packages resolve correctly without env vars.
    // We DO add the backend dir so `from app.xxx` imports resolve.
    env.PYTHONPATH = cwd;
    // Playwright browsers live inside the packaged resources tree
    env.PLAYWRIGHT_BROWSERS_PATH = path.join(resourcesRoot(), 'python', 'playwright-browsers');
  }

  const args = ['-m', 'uvicorn', 'main:app',
                '--host', '127.0.0.1', '--port', String(BACKEND_PORT)];

  console.log(`[main] spawn: ${py} ${args.join(' ')} (cwd=${cwd})`);
  console.log(`[main] USER_DATA_DIR=${env.USER_DATA_DIR}`);
  console.log(`[main] FRONTEND_DIST_DIR=${env.FRONTEND_DIST_DIR}`);
  backendProcess = spawn(py, args, { cwd, env, windowsHide: true });

  // Ring-buffer last N lines of stderr so we can surface them in the error dialog
  const stderrRing = [];
  const pushStderr = (line) => {
    stderrRing.push(line);
    if (stderrRing.length > 80) stderrRing.shift();
  };

  backendProcess.stdout.on('data', (d) => {
    const s = d.toString();
    process.stdout.write(`[backend] ${s}`);
  });
  backendProcess.stderr.on('data', (d) => {
    const s = d.toString();
    process.stderr.write(`[backend] ${s}`);
    s.split(/\r?\n/).forEach((line) => { if (line.trim()) pushStderr(line); });
  });
  backendProcess.on('exit', (code) => {
    console.log(`[main] backend exited code=${code}`);
    backendProcess = null;
    if (mainWindow && !mainWindow.isDestroyed() && code !== 0) {
      const tail = stderrRing.slice(-25).join('\n');
      dialog.showErrorBox(
        '後端伺服器已停止',
        `後端意外結束 (exit code ${code})\n\n最後幾行日誌：\n${tail || '(no output)'}`
      );
    }
  });
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    console.log('[main] killing backend');
    try { backendProcess.kill('SIGTERM'); } catch (e) { /* ignore */ }
    // Fallback after 3s
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        try { backendProcess.kill('SIGKILL'); } catch (e) { /* ignore */ }
      }
    }, 3000);
  }
}

async function waitForBackend(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`${BACKEND_URL}/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve(); else reject();
        });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(); });
      });
      return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ── Windows ───────────────────────────────────────────────────────────────────
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480, height: 320,
    frame: false, alwaysOnTop: true, resizable: false,
    transparent: false, backgroundColor: '#0D1117',
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => { splashWindow = null; });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 1000,
    minWidth: 1024, minHeight: 720,
    backgroundColor: '#0D1117',
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(BACKEND_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  });

  // External links open in the system browser, not inside our app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BACKEND_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Simple menu — File/View/Help
  const menu = Menu.buildFromTemplate([
    {
      label: '檔案',
      submenu: [
        { label: '開啟 GitHub', click: () => shell.openExternal('https://github.com/ryanchen34057/ai-stock-radar-') },
        { type: 'separator' },
        { role: 'quit', label: '結束' },
      ],
    },
    {
      label: '檢視',
      submenu: [
        { role: 'reload', label: '重新載入' },
        { role: 'forceReload', label: '強制重新載入' },
        { role: 'toggleDevTools', label: '開發者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '原始大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全螢幕' },
      ],
    },
    {
      label: '說明',
      submenu: [
        {
          label: '關於 AI 產業鏈股票雷達',
          click: () => dialog.showMessageBox({
            type: 'info',
            title: '關於',
            message: 'AI 產業鏈股票雷達',
            detail: '台股 AI / 電動車 / 機器人供應鏈看盤工具\n版本 1.0.0\n\nhttps://github.com/ryanchen34057/ai-stock-radar-',
          }),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplashWindow();
  startBackend();

  const ok = await waitForBackend(60_000);
  if (!ok) {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    dialog.showErrorBox('後端啟動失敗', '60 秒內無法連上 127.0.0.1:8000，程式將關閉。');
    app.quit();
    return;
  }
  createMainWindow();
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { stopBackend(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
