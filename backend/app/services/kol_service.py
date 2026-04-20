"""
KOL (財經 YouTube KOL) service.

Supports multiple user-configured YouTube channels. For each enabled channel
we fetch videos from the last N days, pull transcripts, then ask an LLM to
produce a concise summary plus the list of stocks mentioned with bullish /
bearish sentiment.

Default summariser is Gemini (reuses GEMINI_API_KEY). A NotebookLM adapter
stub is provided via NOTEBOOKLM_SUMMARY env flag for future swap-in; the
notebooklm-py CLI must be logged in before that works.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from google import genai as genai_sdk
from googleapiclient.discovery import build

from app.database import get_connection

logger = logging.getLogger(__name__)

DEFAULT_LOOKBACK_DAYS = 7
MAX_VIDEOS_PER_CHANNEL = 15
TRANSCRIPT_CHAR_LIMIT = 50_000


# ── YouTube key helpers (shared with youtube_service) ─────────────────────────

def _yt_key() -> str:
    k = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not k:
        raise RuntimeError("YOUTUBE_API_KEY not set — add it in Settings")
    return k


def _gemini_key() -> str:
    k = os.getenv("GEMINI_API_KEY", "").strip()
    if not k:
        raise RuntimeError("GEMINI_API_KEY not set — add it in Settings")
    return k


def _gemini_model() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


# ── Channel ID resolution ─────────────────────────────────────────────────────

# Use Unicode-aware patterns so Chinese / Japanese @handles match.
# `[^/?#\s]+` = anything that isn't a path separator, query marker, fragment,
# or whitespace — lets Unicode characters through.
_CHANNEL_URL_PATTERNS = [
    re.compile(r"youtube\.com/channel/(UC[\w-]+)"),
    re.compile(r"youtube\.com/@([^/?#\s]+)"),
    re.compile(r"youtube\.com/c/([^/?#\s]+)"),
    re.compile(r"youtube\.com/user/([^/?#\s]+)"),
]


def resolve_channel(input_str: str) -> dict | None:
    """
    Convert a raw YouTube channel URL / @handle / channel ID → canonical
    { channel_id, name, description } via the YouTube Data API.
    Returns None if not resolvable.
    """
    from urllib.parse import unquote
    s = input_str.strip()
    if not s:
        return None
    # URL-decode so percent-encoded CJK handles like "%E5%A5%B6..." become
    # their literal form before regex matching.
    s = unquote(s)

    # Already a UC... ID
    if s.startswith("UC") and len(s) >= 20 and "/" not in s:
        return _fetch_channel_meta(s)

    # Extract handle or id from URL
    handle = None
    for pat in _CHANNEL_URL_PATTERNS:
        m = pat.search(s)
        if m:
            token = m.group(1)
            if token.startswith("UC"):
                return _fetch_channel_meta(token)
            handle = token
            break
    if not handle:
        # Bare @handle
        if s.startswith("@"):
            handle = s[1:]

    if handle:
        return _resolve_handle(handle)
    return None


def _fetch_channel_meta(channel_id: str) -> dict | None:
    yt = build("youtube", "v3", developerKey=_yt_key())
    resp = yt.channels().list(part="snippet", id=channel_id).execute()
    items = resp.get("items", [])
    if not items:
        return None
    snip = items[0]["snippet"]
    return {
        "channel_id": channel_id,
        "name": snip.get("title", ""),
        "description": (snip.get("description") or "")[:300],
    }


def _resolve_handle(handle: str) -> dict | None:
    """Resolve an @handle / legacy username to a channel ID."""
    yt = build("youtube", "v3", developerKey=_yt_key())

    # 1. Modern forHandle — works for @handles including Unicode (preferred;
    #    costs 1 quota unit vs search's 100)
    try:
        resp = yt.channels().list(part="snippet", forHandle=f"@{handle}").execute()
        items = resp.get("items", [])
        if items:
            snip = items[0]["snippet"]
            return {
                "channel_id": items[0]["id"],
                "name": snip.get("title", ""),
                "description": (snip.get("description") or "")[:300],
            }
    except Exception as e:
        logger.debug(f"forHandle failed for {handle}: {e}")

    # 2. Legacy forUsername (only works for /user/xxx URLs)
    try:
        resp = yt.channels().list(part="snippet", forUsername=handle).execute()
        items = resp.get("items", [])
        if items:
            snip = items[0]["snippet"]
            return {
                "channel_id": items[0]["id"],
                "name": snip.get("title", ""),
                "description": (snip.get("description") or "")[:300],
            }
    except Exception:
        pass

    # 3. Last resort: search (expensive — 100 quota units)
    try:
        resp = yt.search().list(part="snippet", q=f"@{handle}", type="channel", maxResults=1).execute()
        items = resp.get("items", [])
        if items:
            cid = items[0]["snippet"]["channelId"]
            return _fetch_channel_meta(cid)
    except Exception as e:
        logger.warning(f"search fallback failed for {handle}: {e}")
    return None


# ── Channel CRUD ───────────────────────────────────────────────────────────────

def list_channels() -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT channel_id, name, description, enabled, created_at FROM kol_channels ORDER BY created_at DESC"
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["enabled"] = bool(d.get("enabled", 1))
            out.append(d)
        return out
    finally:
        conn.close()


def add_channel(raw_input: str, custom_name: str | None = None) -> dict:
    meta = resolve_channel(raw_input)
    if not meta:
        raise ValueError(f"無法解析 YouTube 頻道：{raw_input}")
    name = (custom_name or meta["name"]).strip()
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT channel_id FROM kol_channels WHERE channel_id = ?", (meta["channel_id"],)
        ).fetchone()
        if existing:
            raise ValueError(f"頻道已存在：{name} ({meta['channel_id']})")
        conn.execute(
            "INSERT INTO kol_channels (channel_id, name, description, enabled) VALUES (?, ?, ?, 1)",
            (meta["channel_id"], name, meta.get("description", "")),
        )
        conn.commit()
    finally:
        conn.close()
    return {"channel_id": meta["channel_id"], "name": name, "description": meta.get("description", "")}


def delete_channel(channel_id: str) -> bool:
    conn = get_connection()
    try:
        res = conn.execute("DELETE FROM kol_channels WHERE channel_id = ?", (channel_id,))
        conn.execute("DELETE FROM kol_videos WHERE channel_id = ?", (channel_id,))
        conn.commit()
        return res.rowcount > 0
    finally:
        conn.close()


def set_channel_enabled(channel_id: str, enabled: bool) -> bool:
    conn = get_connection()
    try:
        res = conn.execute(
            "UPDATE kol_channels SET enabled = ? WHERE channel_id = ?",
            (1 if enabled else 0, channel_id),
        )
        conn.commit()
        return res.rowcount > 0
    finally:
        conn.close()


# ── Video fetching (generic, per channel) ─────────────────────────────────────

def _fetch_recent_videos(channel_id: str, days: int) -> list[dict]:
    yt = build("youtube", "v3", developerKey=_yt_key())
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)

    # Try uploads playlist first
    videos: list[dict] = []
    try:
        ch_resp = yt.channels().list(part="contentDetails,snippet", id=channel_id).execute()
        items = ch_resp.get("items", [])
        if not items:
            return []
        playlist_id = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
        channel_name = items[0]["snippet"].get("title", "")

        resp = yt.playlistItems().list(
            part="snippet",
            playlistId=playlist_id,
            maxResults=MAX_VIDEOS_PER_CHANNEL,
        ).execute()
        for it in resp.get("items", []):
            snip = it["snippet"]
            pub_str = snip.get("publishedAt", "")
            try:
                pub_dt = datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
            except Exception:
                continue
            if pub_dt < since_dt:
                continue
            vid = snip["resourceId"]["videoId"]
            videos.append({
                "video_id": vid,
                "title": snip.get("title", ""),
                "url": f"https://www.youtube.com/watch?v={vid}",
                "thumbnail": snip.get("thumbnails", {}).get("medium", {}).get("url", ""),
                "published_at": pub_str,
                "channel_name": channel_name,
            })
    except Exception as e:
        logger.warning(f"_fetch_recent_videos({channel_id}): {e}")
    return videos


# ── Transcript (reuse youtube_service's yt-dlp path) ──────────────────────────

def _fetch_transcript(video_id: str) -> str:
    """Delegate to youtube_service._fetch_transcript for consistency."""
    from app.services.youtube_service import _fetch_transcript as _fetch
    try:
        return _fetch(video_id) or ""
    except Exception as e:
        logger.warning(f"transcript {video_id} failed: {e}")
        return ""


# ── LLM summarisation ─────────────────────────────────────────────────────────

_KOL_PROMPT = """\
這是一位財經 YouTuber 發布的影片。請根據影片字幕內容，完成三件事：

1. 用繁體中文寫一段 **正好三句話** 的總結（每句 30-45 字，總字數不超過 130 字），
   涵蓋本集的核心觀點、提到的重要事件、以及 KOL 的操作建議或市場判斷。

2. 列出被明確討論（不只是一句帶過）的所有台股，每檔註明：
   symbol（4 碼股號，或 4 碼+ -KY）
   name（公司中文名）
   sentiment：看漲填 "bullish"、看跌填 "bearish"、中立/觀察填 "neutral"
   rationale：10-25 字的簡短原因

3. overall_sentiment：本集整體市場態度 "bullish" / "bearish" / "neutral"。

回傳純 JSON（不要 markdown 圍欄）：
{
  "summary": "三句話總結",
  "overall_sentiment": "bullish|bearish|neutral",
  "stocks": [
    {"symbol":"2330","name":"台積電","sentiment":"bullish","rationale":"..."}
  ]
}

若影片與台股無關，stocks 回 []、overall_sentiment 回 "neutral"。
只回傳 JSON。
"""


def _parse_llm_response(raw: str) -> dict:
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
    try:
        obj = json.loads(raw)
    except Exception as e:
        logger.warning(f"_parse_llm_response: {e} — raw head={raw[:200]!r}")
        return {"summary": "", "overall_sentiment": "neutral", "stocks": []}
    stocks = []
    valid = {"bullish", "bearish", "neutral"}
    for s in obj.get("stocks", []) or []:
        if not isinstance(s, dict):
            continue
        sent = s.get("sentiment") if s.get("sentiment") in valid else "neutral"
        stocks.append({
            "symbol": str(s.get("symbol", "")).strip(),
            "name":   str(s.get("name", "")).strip(),
            "sentiment": sent,
            "rationale": str(s.get("rationale", "")).strip()[:120],
        })
    overall = obj.get("overall_sentiment") if obj.get("overall_sentiment") in valid else "neutral"
    return {
        "summary": str(obj.get("summary", "")).strip()[:400],
        "overall_sentiment": overall,
        "stocks": stocks,
    }


def _summarize_with_gemini(title: str, transcript: str) -> dict:
    client = genai_sdk.Client(api_key=_gemini_key())
    prompt = f"{_KOL_PROMPT}\n\n影片標題：{title}\n\n影片字幕：\n{transcript[:TRANSCRIPT_CHAR_LIMIT]}"
    resp = client.models.generate_content(model=_gemini_model(), contents=prompt)
    return _parse_llm_response(resp.text or "")


def summarize_video(video: dict) -> dict:
    """
    NotebookLM-only summariser. If NotebookLM isn't installed or the user
    isn't logged in we record a clear "not configured" placeholder instead
    of falling back to Gemini — this project explicitly opted out of Gemini
    for KOL summaries.
    """
    from app.services import notebooklm_adapter

    video_url = video.get("url") or f"https://www.youtube.com/watch?v={video['video_id']}"

    if not notebooklm_adapter.is_available():
        msg = "NotebookLM 未安裝（請 pip install notebooklm-py）"
        logger.warning(f"KOL summary skipped ({video['video_id']}): {msg}")
        return {
            **video,
            "summary": msg,
            "overall_sentiment": "neutral",
            "stocks": [],
            "summariser": "unconfigured",
        }

    auth = notebooklm_adapter.check_auth()
    if not auth.get("authenticated"):
        msg = f"NotebookLM 尚未登入（前往 Settings 點登入按鈕）"
        logger.warning(f"KOL summary skipped ({video['video_id']}): {msg}")
        return {
            **video,
            "summary": msg,
            "overall_sentiment": "neutral",
            "stocks": [],
            "summariser": "unauthenticated",
        }

    logger.info(f"NotebookLM summarise: {video['video_id']} {video.get('title','')[:40]}")
    try:
        result = notebooklm_adapter.summarize_youtube_via_notebooklm(
            video_url, video.get("title", "")
        )
    except Exception as e:
        logger.error(f"NotebookLM error {video['video_id']}: {e}")
        return {
            **video,
            "summary": f"NotebookLM 錯誤：{e}",
            "overall_sentiment": "neutral",
            "stocks": [],
            "summariser": "error",
        }

    if result is None:
        return {
            **video,
            "summary": "NotebookLM 無法處理此影片（可能是來源加入失敗或等待逾時）",
            "overall_sentiment": "neutral",
            "stocks": [],
            "summariser": "error",
        }

    return {**video, **result, "summariser": "notebooklm"}


# ── Persist + feed query ──────────────────────────────────────────────────────

def _persist_video(v: dict) -> None:
    now = datetime.now().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO kol_videos
               (video_id, channel_id, channel_name, title, url, thumbnail, published_at,
                summary, stocks_json, overall_sentiment, summariser, processed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (v["video_id"], v["channel_id"], v.get("channel_name", ""),
             v.get("title", ""), v.get("url", ""), v.get("thumbnail", ""),
             v.get("published_at", ""),
             v.get("summary", ""), json.dumps(v.get("stocks", []), ensure_ascii=False),
             v.get("overall_sentiment", "neutral"),
             v.get("summariser", ""), now),
        )
        conn.commit()
    finally:
        conn.close()


_SUCCESSFUL_SUMMARISERS = {"notebooklm", "gemini"}


def refresh_all_kol_feeds(days: int = DEFAULT_LOOKBACK_DAYS, force: bool = False) -> dict:
    """
    Fetch recent videos from every enabled KOL channel. A video is summarised
    when any of these are true:
      - It's not in `kol_videos` yet (new)
      - Its existing row doesn't have a successful summariser (notebooklm/gemini)
      - `force=True` (re-summarise everything regardless of cache)

    This means videos stored during the Gemini-fallback era with empty
    summaries automatically get reprocessed via NotebookLM now.
    """
    channels = [c for c in list_channels() if c["enabled"]]
    if not channels:
        return {"channels": 0, "new_videos": 0, "summarised": 0, "retried": 0}

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT video_id, summariser FROM kol_videos"
        ).fetchall()
    finally:
        conn.close()
    # Only skip ones that already have a *successful* summary
    successful_ids = {
        r["video_id"] for r in rows
        if (r["summariser"] or "").strip() in _SUCCESSFUL_SUMMARISERS
    }
    needs_retry_ids = {
        r["video_id"] for r in rows
        if (r["summariser"] or "").strip() not in _SUCCESSFUL_SUMMARISERS
    }

    new_count = 0
    retried = 0
    summarised = 0
    failed: list[str] = []
    for ch in channels:
        cid = ch["channel_id"]
        try:
            vids = _fetch_recent_videos(cid, days)
        except Exception as e:
            logger.warning(f"fetch videos for {cid}: {e}")
            failed.append(cid)
            continue
        for v in vids:
            vid = v["video_id"]
            if not force and vid in successful_ids:
                continue
            if vid in needs_retry_ids:
                retried += 1
            else:
                new_count += 1
            v["channel_id"] = cid
            v["channel_name"] = v.get("channel_name", ch["name"])
            summary = summarize_video(v)
            _persist_video(summary)
            summarised += 1
            time.sleep(1.0)
    return {
        "channels": len(channels),
        "new_videos": new_count,
        "retried": retried,
        "summarised": summarised,
        "failed_channels": failed,
    }


def get_kol_feed(days: int = DEFAULT_LOOKBACK_DAYS) -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT video_id, channel_id, channel_name, title, url, thumbnail,
                      published_at, summary, stocks_json, overall_sentiment,
                      summariser, processed_at
               FROM kol_videos
               WHERE published_at >= ?
               ORDER BY published_at DESC""",
            (cutoff,),
        ).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["stocks"] = json.loads(d.pop("stocks_json") or "[]")
        except Exception:
            d["stocks"] = []
        out.append(d)
    return out
