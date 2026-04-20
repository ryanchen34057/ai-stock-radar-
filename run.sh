#!/usr/bin/env bash
# AI Stock Radar - start the app (macOS / Linux)
set -e
cd "$(dirname "$0")"

echo "================================================================"
echo "  AI Stock Radar - Starting"
echo "================================================================"

# Build frontend if missing
if [ ! -f frontend/dist/index.html ]; then
  echo "Frontend dist not found — building now..."
  (cd frontend && npm run build)
fi

# Start backend (serves API + static frontend on port 8000)
(cd backend && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

# Wait for backend to come up
echo "Waiting for backend..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "  [OK] Backend ready"
    break
  fi
  sleep 1
done

# Open browser
if command -v open >/dev/null; then open http://127.0.0.1:8000/
elif command -v xdg-open >/dev/null; then xdg-open http://127.0.0.1:8000/
fi

echo
echo "================================================================"
echo "  Browser opened. Ctrl+C to stop."
echo "================================================================"

trap "kill $BACKEND_PID 2>/dev/null; exit" INT TERM
wait
