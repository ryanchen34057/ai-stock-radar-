#!/usr/bin/env bash
# AI Stock Radar - pull latest from GitHub + reinstall deps if needed
set -e
cd "$(dirname "$0")"

echo "================================================================"
echo "  AI Stock Radar - Updating"
echo "================================================================"

if ! command -v git >/dev/null 2>&1; then
  echo "  [FAIL] git not found. Install git or download the latest ZIP manually."
  exit 1
fi
if [ ! -d ".git" ]; then
  echo "  [FAIL] This folder is not a git repo (downloaded as ZIP?)."
  echo "  To update: re-download the ZIP, back up backend/data/stocks.db,"
  echo "             extract the new ZIP, put stocks.db back, run setup.sh."
  exit 1
fi

echo "  IMPORTANT: close the running app before updating!"
read -n 1 -s -r -p "  Press any key to continue..."
echo

# Remember old hashes to decide whether to reinstall deps
old_req=$(sha1sum backend/requirements.txt 2>/dev/null | cut -c1-40)
old_pkg=$(sha1sum frontend/package.json 2>/dev/null | cut -c1-40)

echo
echo "[1/4] Pulling latest from GitHub..."
stashed=0
if ! git diff --quiet; then
  echo "  Local edits detected - stashing temporarily..."
  git stash push -u -m "auto-stash by update.sh" >/dev/null
  stashed=1
fi
git pull --ff-only origin master
if [ "$stashed" = "1" ]; then
  echo "  Re-applying your stashed edits..."
  git stash pop || echo "  [WARN] Stash pop had conflicts; resolve manually."
fi

new_req=$(sha1sum backend/requirements.txt 2>/dev/null | cut -c1-40)
new_pkg=$(sha1sum frontend/package.json 2>/dev/null | cut -c1-40)

echo
echo "[2/4] Backend Python packages..."
if [ "$old_req" = "$new_req" ]; then
  echo "  [SKIP] requirements.txt unchanged"
else
  (cd backend && python3 -m pip install -r requirements.txt)
fi

echo
echo "[3/4] Frontend JS packages..."
if [ "$old_pkg" = "$new_pkg" ]; then
  echo "  [SKIP] package.json unchanged"
else
  (cd frontend && npm install)
fi

echo
echo "[4/4] Rebuilding frontend..."
(cd frontend && npm run build)

echo
echo "================================================================"
echo "  Update complete!"
echo "  Your data (stocks.db, settings) is untouched."
echo "  Run ./run.sh to start the updated app."
echo "================================================================"
