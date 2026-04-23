#!/usr/bin/env bash
# AI Stock Radar - run + auto-update (macOS / Linux)
set -u
cd "$(dirname "$0")"

echo "================================================================"
echo "  AI Stock Radar"
echo "================================================================"

# ---- Auto-update (best-effort) ----
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  OLD_REQ=$(sha1sum backend/requirements.txt 2>/dev/null | cut -c1-40)
  OLD_PKG=$(sha1sum frontend/package.json 2>/dev/null | cut -c1-40)

  stashed=0
  if ! git diff --quiet; then
    echo "  Local edits detected - stashing..."
    git stash push -u -m "auto-stash by run.sh" >/dev/null 2>&1 && stashed=1
  fi
  echo "[1/4] Pulling latest code..."
  if git pull --ff-only origin master >/dev/null 2>&1; then
    echo "  [OK] up to date"
  else
    echo "  [WARN] git pull skipped or failed - continuing with local code"
  fi
  [ "$stashed" = "1" ] && git stash pop >/dev/null 2>&1 || true

  NEW_REQ=$(sha1sum backend/requirements.txt 2>/dev/null | cut -c1-40)
  NEW_PKG=$(sha1sum frontend/package.json 2>/dev/null | cut -c1-40)

  echo "[2/4] Backend packages..."
  if [ "$OLD_REQ" = "$NEW_REQ" ]; then
    echo "  [SKIP] requirements.txt unchanged"
  else
    (cd backend && python3 -m pip install --upgrade -r requirements.txt)
  fi

  # import sanity check
  if ! python3 -c "import fastapi, uvicorn, pandas, numpy, yfinance, playwright, apscheduler" >/dev/null 2>&1; then
    echo "  [WARN] import check failed - force-reinstalling core stack"
    python3 -m pip install --upgrade --force-reinstall --no-cache-dir numpy pandas yfinance
  fi

  echo "[3/4] Frontend packages..."
  if [ "$OLD_PKG" = "$NEW_PKG" ]; then
    echo "  [SKIP] package.json unchanged"
  else
    (cd frontend && npm install)
  fi

  echo "[4/4] Rebuilding frontend..."
  (cd frontend && npm run build >/dev/null 2>&1) || echo "  [WARN] build failed - using last-good dist"
fi

# ---- Build dist if completely missing ----
if [ ! -f frontend/dist/index.html ]; then
  (cd frontend && npm run build) || { echo "[FAIL] Frontend build failed"; exit 1; }
fi

# ---- Start backend ----
echo
echo "Starting AI Stock Radar on http://127.0.0.1:8000/"
(cd backend && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "  [OK] Backend ready"
    break
  fi
  sleep 1
done

if command -v open >/dev/null; then open http://127.0.0.1:8000/
elif command -v xdg-open >/dev/null; then xdg-open http://127.0.0.1:8000/
fi

echo
echo "Press Ctrl+C to stop."
trap "kill $BACKEND_PID 2>/dev/null; exit" INT TERM
wait
