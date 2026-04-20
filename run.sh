#!/usr/bin/env bash
# AI 產業鏈股票雷達 — 啟動（macOS / Linux）
set -e
cd "$(dirname "$0")"

echo "================================================================"
echo "  啟動 AI 產業鏈股票雷達"
echo "================================================================"

# Start backend in background
(cd backend && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

# Wait for backend
echo "[1/2] 等待後端就緒..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "  [OK] 後端就緒"
    break
  fi
  sleep 1
done

# Start frontend
echo "[2/2] 啟動前端..."
if [ -f frontend/dist/index.html ]; then
  (cd frontend/dist && python3 -m http.server 5173) &
  FRONTEND_PID=$!
else
  (cd frontend && npm run dev) &
  FRONTEND_PID=$!
fi

# Open browser after 2s
sleep 2
if command -v open >/dev/null; then open http://127.0.0.1:5173/
elif command -v xdg-open >/dev/null; then xdg-open http://127.0.0.1:5173/
fi

echo
echo "================================================================"
echo "  已在瀏覽器開啟。按 Ctrl+C 可同時關閉後端與前端。"
echo "================================================================"

# Trap Ctrl+C to kill both
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
