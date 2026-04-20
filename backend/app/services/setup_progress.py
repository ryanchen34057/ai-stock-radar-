"""
Global setup-progress tracker.

The initial data sweep (k-lines, EPS, FinMind, institutional, etc.) runs in a
background thread on app startup. This module exposes a thread-safe progress
snapshot so the frontend can render a "first-run installer" overlay with
per-stock status ("fetching 23 / 149: 台積電 2330").

Flow:
    begin("klines", total=149)  → per-stock: update(current, symbol, name)
    begin("eps", total=149)     → ...
    mark_phase_done("klines")   → move to next phase
    mark_all_done()             → overlay auto-dismisses
"""
from __future__ import annotations

import threading
from datetime import datetime
from typing import Any

_lock = threading.Lock()

# Ordered phase list — defines the progress steps shown to the user.
_PHASES = [
    {"key": "klines",         "label": "抓取 K 線歷史資料"},
    {"key": "eps",             "label": "抓取每股盈餘（EPS）"},
    {"key": "finmind",         "label": "抓取財報狗資料（FinMind）"},
    {"key": "disposal",        "label": "抓取處置股名單"},
    {"key": "institutional",   "label": "抓取三大法人 / 融資融券近 20 日"},
    {"key": "logos",           "label": "抓取公司 logo"},
    {"key": "news",            "label": "抓取新聞"},
]

_state: dict[str, Any] = {
    "running":       False,
    "phase":         None,       # current phase key
    "phase_label":   "",
    "phase_index":   0,
    "phase_total":   len(_PHASES),
    "current":       0,          # per-phase count
    "total":         0,
    "symbol":        "",
    "name":          "",
    "started_at":    None,
    "updated_at":    None,
    "completed_at":  None,
    "phases_done":   [],         # list of completed phase keys
    "error":         None,
}


def _now() -> str:
    return datetime.now().isoformat()


def all_phases() -> list[dict]:
    return list(_PHASES)


def begin_sweep() -> None:
    """Called once when the whole startup sweep starts."""
    with _lock:
        _state["running"] = True
        _state["started_at"] = _now()
        _state["updated_at"] = _now()
        _state["completed_at"] = None
        _state["phases_done"] = []
        _state["error"] = None


def begin(phase_key: str, total: int = 0) -> None:
    """Enter a new phase with an optional item total."""
    idx = next((i for i, p in enumerate(_PHASES) if p["key"] == phase_key), 0)
    label = _PHASES[idx]["label"] if idx < len(_PHASES) else phase_key
    with _lock:
        _state["phase"] = phase_key
        _state["phase_label"] = label
        _state["phase_index"] = idx + 1
        _state["current"] = 0
        _state["total"] = total
        _state["symbol"] = ""
        _state["name"] = ""
        _state["updated_at"] = _now()


def update(current: int, symbol: str = "", name: str = "") -> None:
    """Report progress within the current phase."""
    with _lock:
        _state["current"] = current
        if symbol: _state["symbol"] = symbol
        if name:   _state["name"] = name
        _state["updated_at"] = _now()


def mark_phase_done(phase_key: str) -> None:
    with _lock:
        if phase_key not in _state["phases_done"]:
            _state["phases_done"].append(phase_key)
        _state["updated_at"] = _now()


def mark_all_done() -> None:
    with _lock:
        _state["running"] = False
        _state["completed_at"] = _now()
        _state["updated_at"] = _now()


def report_error(msg: str) -> None:
    with _lock:
        _state["error"] = str(msg)[:500]
        _state["updated_at"] = _now()


def snapshot() -> dict:
    """Return a copy of current state (safe to serialise)."""
    with _lock:
        return {**_state, "phases": list(_PHASES)}
