"""
NotebookLM adapter — summarises a YouTube video by:
  1. Creating a notebook
  2. Adding the YouTube URL as a source
  3. Waiting for source processing
  4. Asking a structured question to get JSON summary
  5. Cleaning up the notebook

Requires `notebooklm` CLI on PATH + prior `notebooklm login` auth.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


# ── CLI resolution ────────────────────────────────────────────────────────────

def _notebooklm_cmd() -> list[str] | None:
    """
    Resolve the `notebooklm` CLI. Checks PATH first, then the venv this
    backend is running from (more reliable in Windows when PATH is weird).
    Returns a list ready to pass to subprocess.run, or None if not installed.
    """
    override = os.getenv("NOTEBOOKLM_BIN", "").strip()
    if override:
        return [override]

    path_hit = shutil.which("notebooklm") or shutil.which("notebooklm.exe")
    if path_hit:
        return [path_hit]

    # Fallback: look in the venv's Scripts/ relative to sys.executable
    import sys
    scripts = Path(sys.executable).parent
    for name in ("notebooklm.exe", "notebooklm"):
        candidate = scripts / name
        if candidate.exists():
            return [str(candidate)]

    return None


def is_available() -> bool:
    return _notebooklm_cmd() is not None


def get_cli() -> list[str] | None:
    """Public access to the resolved CLI command (used by login route)."""
    return _notebooklm_cmd()


# ── CLI helpers ───────────────────────────────────────────────────────────────

def _run(args: list[str], timeout: int = 60) -> tuple[int, str, str]:
    """Run a notebooklm subcommand, returns (rc, stdout, stderr)."""
    cli = _notebooklm_cmd()
    if cli is None:
        raise RuntimeError("notebooklm CLI not found — install with `pip install notebooklm-py`")
    cmd = cli + args
    logger.debug(f"notebooklm {' '.join(args)}")
    try:
        p = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace"
        )
        return p.returncode, p.stdout or "", p.stderr or ""
    except subprocess.TimeoutExpired as e:
        logger.warning(f"notebooklm {args[0]} timeout after {timeout}s")
        return 124, "", f"timeout after {timeout}s"


def _run_json(args: list[str], timeout: int = 60) -> dict | list | None:
    rc, out, err = _run([*args, "--json"], timeout=timeout)
    if rc != 0:
        logger.warning(f"notebooklm {args[0]} rc={rc} stderr={err.strip()[:200]}")
        return None
    try:
        # Some CLIs emit warnings before the JSON payload; find the first JSON object/array
        text = out.strip()
        m = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if m:
            text = m.group(1)
        return json.loads(text)
    except Exception as e:
        logger.warning(f"notebooklm {args[0]} json parse: {e} — head={out[:200]!r}")
        return None


# ── Auth / status ─────────────────────────────────────────────────────────────

def check_auth() -> dict:
    """
    Return {'available': bool, 'authenticated': bool, 'message': str}.

    Uses `notebooklm auth check --json` which reports whether cookies are
    stored and valid. `notebooklm status` reports the currently-selected
    notebook, NOT auth — easy to confuse.
    """
    if not is_available():
        return {"available": False, "authenticated": False,
                "message": "notebooklm CLI not installed (pip install notebooklm-py)"}

    rc, out, err = _run(["auth", "check", "--json"], timeout=20)
    # `auth check` exits non-zero when not authenticated; parse regardless
    try:
        # Skip any non-JSON prefix (Windows legacy console sometimes prints warnings)
        text = (out or "").strip()
        m = re.search(r"\{.*\}", text, re.DOTALL)
        payload = json.loads(m.group(0)) if m else {}
    except Exception:
        payload = {}

    checks = payload.get("checks", {}) if isinstance(payload, dict) else {}
    storage_ok = bool(checks.get("storage_exists"))
    cookies_ok = bool(checks.get("cookies_present"))
    sid_ok = bool(checks.get("sid_cookie"))
    authed = storage_ok and cookies_ok and sid_ok

    if authed:
        email = (payload.get("details") or {}).get("email") or ""
        return {
            "available": True,
            "authenticated": True,
            "message": f"Authenticated{(' as ' + email) if email else ''}",
        }

    missing = []
    if not storage_ok: missing.append("storage_state.json missing")
    if not cookies_ok: missing.append("no cookies stored")
    if not sid_ok:     missing.append("SID cookie missing")
    detail = ", ".join(missing) if missing else (err.strip() or out.strip()[:200])
    return {"available": True, "authenticated": False,
            "message": f"Not authenticated ({detail})"}


# ── Core workflow ─────────────────────────────────────────────────────────────

_KOL_ASK_PROMPT = """\
請以繁體中文回答，並嚴格只回傳 JSON（無 markdown 圍欄、無其他說明）。

這是一位財經 YouTuber 發布的影片。請根據影片內容完成三件事：

1. "summary"：寫「正好三句話」的總結（每句 30-45 字、總字數不超過 130 字），
   涵蓋本集核心觀點、提到的重要事件、以及 KOL 的操作建議或市場判斷。

2. "stocks"：列出被明確討論（不只是一句帶過）的所有台股，每檔包含：
   symbol（4 碼股號，或 4 碼+ -KY），
   name（中文名），
   sentiment（"bullish"=看漲 / "bearish"=看跌 / "neutral"=中立或未明），
   rationale（10-25 字原因）。

3. "overall_sentiment"：本集整體市場態度 "bullish"/"bearish"/"neutral"。

若影片與台股無關，stocks 回 []、overall_sentiment 回 "neutral"。

JSON 格式：
{"summary":"...","overall_sentiment":"...","stocks":[{"symbol":"2330","name":"台積電","sentiment":"bullish","rationale":"..."}]}
"""


def _create_notebook(title: str) -> str | None:
    j = _run_json(["create", title], timeout=30)
    if isinstance(j, dict):
        # CLI wraps in {"notebook": {"id": "..."}}
        nb = j.get("notebook") if isinstance(j.get("notebook"), dict) else j
        return nb.get("id")
    return None


def _add_youtube_source(notebook_id: str, url: str) -> str | None:
    j = _run_json(["source", "add", url, "--notebook", notebook_id], timeout=60)
    if isinstance(j, dict):
        src = j.get("source") if isinstance(j.get("source"), dict) else j
        return src.get("id") or src.get("source_id")
    return None


def _ask(notebook_id: str, question: str, timeout: int = 180) -> str | None:
    j = _run_json(["ask", question, "--notebook", notebook_id], timeout=timeout)
    if isinstance(j, dict):
        return j.get("answer")
    return None


def _delete_notebook(notebook_id: str) -> None:
    # notebooklm notebook delete <id> [--yes] (flag may vary across versions)
    _run(["notebook", "delete", notebook_id], timeout=30)


_VALID_SENTIMENTS = {"bullish", "bearish", "neutral"}


def _parse_answer(raw: str) -> dict:
    """Extract the JSON object from a NotebookLM answer (may have [1] citations / prose)."""
    if not raw:
        return {"summary": "", "overall_sentiment": "neutral", "stocks": []}
    # NotebookLM often wraps JSON in ```json ... ``` fences; strip them anywhere
    text = raw.replace("```json", "```")
    text = re.sub(r"```\s*", "", text, flags=re.MULTILINE)
    # Strip citation brackets like [1], [2]
    text = re.sub(r"\[\d+\]", "", text)
    # Find first {...} object (non-greedy won't help because JSON has nested braces — use DOTALL + greedy + balanced trick)
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        logger.warning(f"_parse_answer: no JSON found, raw head={raw[:200]!r}")
        return {"summary": raw[:200].strip(), "overall_sentiment": "neutral", "stocks": []}
    try:
        obj = json.loads(m.group(0))
    except Exception as e:
        logger.warning(f"_parse_answer: {e}, head={m.group(0)[:200]!r}")
        return {"summary": "", "overall_sentiment": "neutral", "stocks": []}

    stocks = []
    for s in obj.get("stocks", []) or []:
        if not isinstance(s, dict):
            continue
        sent = s.get("sentiment") if s.get("sentiment") in _VALID_SENTIMENTS else "neutral"
        stocks.append({
            "symbol": str(s.get("symbol", "")).strip(),
            "name":   str(s.get("name", "")).strip(),
            "sentiment": sent,
            "rationale": str(s.get("rationale", "")).strip()[:120],
        })
    overall = obj.get("overall_sentiment") if obj.get("overall_sentiment") in _VALID_SENTIMENTS else "neutral"
    return {
        "summary": str(obj.get("summary", "")).strip()[:400],
        "overall_sentiment": overall,
        "stocks": stocks,
    }


def summarize_youtube_via_notebooklm(video_url: str, title: str) -> dict | None:
    """
    Workflow: create notebook → add YouTube source → (server-side processing
    happens asynchronously) → ask → parse → cleanup.

    NOTE: we skip `source wait` because the installed CLI's wait command has
    an asyncio bug; NotebookLM's `ask` happily queues until processing is
    done internally, so the explicit wait is redundant anyway.
    """
    import time
    nb_title = (f"KOL-{title}" if title else "KOL-video")[:80]
    notebook_id = _create_notebook(nb_title)
    if not notebook_id:
        logger.warning(f"NotebookLM: create notebook failed for {video_url}")
        return None

    try:
        source_id = _add_youtube_source(notebook_id, video_url)
        if not source_id:
            logger.warning(f"NotebookLM: add source failed for {video_url}")
            return None

        # Short pause to give the ingestion a head start — `ask` queues
        # internally but a 5s pause reduces first-turn "no source yet" edge cases.
        time.sleep(5)

        answer = _ask(notebook_id, _KOL_ASK_PROMPT, timeout=300)
        if not answer:
            logger.warning(f"NotebookLM: ask returned empty for {video_url}")
            return None

        return _parse_answer(answer)

    finally:
        try:
            _delete_notebook(notebook_id)
        except Exception as e:
            logger.debug(f"NotebookLM cleanup: {e}")
