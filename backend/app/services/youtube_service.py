"""
YouTube 理財達人秀 daily summary module.
1. YouTube Data API v3  → fetch recent videos from channel
2. youtube-transcript-api → fetch Chinese captions
3. Gemini 1.5 Flash     → extract Taiwan stock mentions + summaries
4. SQLite cache          → youtube_mentions table
"""
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone

from google import genai as genai_sdk
import urllib3
from googleapiclient.discovery import build

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

CHANNEL_ID = "UCZtyuG_5czNxPoFVwEwBsUw"  # 理財達人秀 (fallback, overridable via app_settings)
MAX_VIDEOS = 10
TRANSCRIPT_CHAR_LIMIT = 60_000  # safety cap for Gemini input


# ── helpers ───────────────────────────────────────────────────────────────────

def _yt_key() -> str:
    k = os.getenv("YOUTUBE_API_KEY", "")
    if not k:
        raise RuntimeError("YOUTUBE_API_KEY not set")
    return k


def _channel_id() -> str:
    return os.getenv("YOUTUBE_CHANNEL_ID", CHANNEL_ID)


def _gemini_key() -> str:
    k = os.getenv("GEMINI_API_KEY", "")
    if not k:
        raise RuntimeError("GEMINI_API_KEY not set")
    return k


def _ts_to_sec(ts: str) -> int:
    """'HH:MM:SS' or 'MM:SS' → seconds"""
    parts = [int(x) for x in ts.strip().split(":")]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return 0


def _format_transcript(items) -> str:
    """
    Merge transcript items into readable text with timestamp markers every 60s.
    Handles both old dict format and new TranscriptSnippet object format (v1.x).
    """
    lines: list[str] = []
    last_mark = -60
    chunk: list[str] = []
    for item in items:
        if isinstance(item, dict):
            start = item.get("start", 0)
            text = item.get("text", "").replace("\n", " ").strip()
        else:
            start = getattr(item, "start", 0)
            text = getattr(item, "text", "").replace("\n", " ").strip()
        if not text:
            continue
        if start - last_mark >= 60:
            if chunk:
                lines.append(" ".join(chunk))
                chunk = []
            h = int(start) // 3600
            m = (int(start) % 3600) // 60
            s = int(start) % 60
            lines.append(f"\n[{h:02d}:{m:02d}:{s:02d}]")
            last_mark = start
        chunk.append(text)
    if chunk:
        lines.append(" ".join(chunk))
    return " ".join(lines)


# ── YouTube Data API ──────────────────────────────────────────────────────────

def _parse_pub_dt(pub_str: str):
    try:
        return datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
    except Exception:
        return None


def _fetch_via_uploads_playlist(youtube, channel_id: str, since_dt, max_results: int) -> list[dict] | None:
    """Try to fetch via uploads playlist. Returns None if channel/playlist not found."""
    ch_resp = youtube.channels().list(part="contentDetails", id=channel_id).execute()
    ch_items = ch_resp.get("items", [])
    if not ch_items:
        logger.warning(f"channels.list returned no items for {channel_id}")
        return None

    playlist_id = ch_items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
    logger.info(f"Uploads playlist: {playlist_id}")

    resp = youtube.playlistItems().list(
        part="snippet",
        playlistId=playlist_id,
        maxResults=max_results,
    ).execute()

    videos = []
    for item in resp.get("items", []):
        snip = item["snippet"]
        pub_str = snip.get("publishedAt", "")
        pub_dt = _parse_pub_dt(pub_str)
        if pub_dt is None or pub_dt < since_dt:
            continue
        vid = snip["resourceId"]["videoId"]
        videos.append({
            "video_id": vid,
            "title": snip.get("title", ""),
            "url": f"https://www.youtube.com/watch?v={vid}",
            "date": pub_str[:10],
        })
    return videos


def _fetch_via_search(youtube, channel_id: str, since_dt, max_results: int) -> list[dict]:
    """Fallback: search.list without publishedAfter, filter manually."""
    logger.info("Falling back to search.list")
    resp = youtube.search().list(
        part="snippet",
        channelId=channel_id,
        order="date",
        maxResults=max_results,
        type="video",
    ).execute()

    videos = []
    for item in resp.get("items", []):
        snip = item["snippet"]
        pub_str = snip.get("publishedAt", "")
        pub_dt = _parse_pub_dt(pub_str)
        if pub_dt is None or pub_dt < since_dt:
            continue
        vid = item["id"]["videoId"]
        videos.append({
            "video_id": vid,
            "title": snip.get("title", ""),
            "url": f"https://www.youtube.com/watch?v={vid}",
            "date": pub_str[:10],
        })
    return videos


def _fetch_video_descriptions(youtube, video_ids: list[str]) -> dict[str, str]:
    """Batch-fetch full descriptions for a list of video IDs (1 API call)."""
    if not video_ids:
        return {}
    resp = youtube.videos().list(
        part="snippet",
        id=",".join(video_ids),
    ).execute()
    return {
        item["id"]: item["snippet"].get("description", "")
        for item in resp.get("items", [])
    }


def _fetch_channel_videos(days: int = 7) -> list[dict]:
    """
    Return list of {video_id, title, description, url, date} for videos in last `days` days.
    Tries uploads playlist first (cheaper); falls back to search.list.
    Fetches descriptions in one batch call.
    """
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    channel_id = _channel_id()
    youtube = build("youtube", "v3", developerKey=_yt_key())

    videos = _fetch_via_uploads_playlist(youtube, channel_id, since_dt, MAX_VIDEOS)
    if videos is None:
        videos = _fetch_via_search(youtube, channel_id, since_dt, MAX_VIDEOS)

    # Batch-fetch descriptions
    descs = _fetch_video_descriptions(youtube, [v["video_id"] for v in videos])
    for v in videos:
        v["description"] = descs.get(v["video_id"], "")

    logger.info(f"YouTube: {len(videos)} videos in last {days} days (channel={channel_id})")
    return videos


# ── Transcript ────────────────────────────────────────────────────────────────

def _fetch_transcript(video_id: str) -> str:
    """
    Fetch auto-generated subtitles via yt-dlp (works even when YouTube API says disabled).
    Returns plain text transcript or empty string.
    """
    import tempfile, subprocess, glob, sys

    url = f"https://www.youtube.com/watch?v={video_id}"
    with tempfile.TemporaryDirectory() as tmpdir:
        cmd = [
            sys.executable, "-m", "yt_dlp",
            "--write-auto-sub",
            "--sub-langs", "zh-Hant,zh-TW,zh,zh-Hans,en",
            "--sub-format", "vtt",
            "--skip-download",
            "--no-playlist",
            "--quiet",
            "--output", f"{tmpdir}/%(id)s",
            url,
        ]
        try:
            subprocess.run(cmd, timeout=30, check=False, capture_output=True)
        except subprocess.TimeoutExpired:
            logger.warning(f"yt-dlp timeout for {video_id}")
            return ""

        # Find any .vtt file downloaded
        vtt_files = glob.glob(f"{tmpdir}/*.vtt")
        if not vtt_files:
            logger.warning(f"No subtitle file for {video_id}")
            return ""

        vtt_path = vtt_files[0]
        lang = vtt_path.split(".")[-2] if "." in vtt_path else "unknown"
        text = _parse_vtt(vtt_path)
        logger.info(f"Transcript {video_id}: {len(text)} chars via yt-dlp (lang={lang})")
        return text[:TRANSCRIPT_CHAR_LIMIT]


def _parse_vtt(path: str) -> str:
    """Convert WebVTT subtitle file to plain text, deduplicating consecutive lines."""
    import re as _re
    seen: set[str] = set()
    lines: list[str] = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            # Skip headers, timestamps, and empty lines
            if not line or line.startswith("WEBVTT") or "-->" in line or _re.match(r"^\d+$", line):
                continue
            # Strip VTT tags like <00:00:00.000><c>text</c>
            line = _re.sub(r"<[^>]+>", "", line).strip()
            if line and line not in seen:
                seen.add(line)
                lines.append(line)
    return " ".join(lines)


# ── Gemini extraction ─────────────────────────────────────────────────────────

_PROMPT_VIDEO = """\
這是台灣財經節目「理財達人秀」的影片。
請仔細聆聽，萃取所有被明確討論的台股（不只是一句帶過的提及）。
每檔股票請用繁體中文寫 1-2 句話（不超過 50 字）摘要主要討論要點，並記錄首次出現的時間戳記。
另外根據節目討論的內容，判斷對該股的看法：看漲填 "bullish"、看跌填 "bearish"、中立或無法判斷填 "neutral"。

回傳格式為 JSON 陣列，若無明確討論的個股，回傳 []。
JSON 格式：
[{"symbol":"2330","name":"台積電","summary":"...","timestamp":"00:12:34","sentiment":"bullish"}]

只回傳 JSON，不要其他說明文字。
"""

_PROMPT_TEXT_PREFIX = """\
以下是台灣財經節目「理財達人秀」的影片說明內容。
請仔細閱讀，萃取所有被明確討論的台股（不只是一句帶過的提及）。
每檔股票請用繁體中文寫 1-2 句話（不超過 50 字）摘要主要討論要點。
timestamp 若無法判斷請填 "00:00:00"。
另外根據節目討論的內容，判斷對該股的看法：看漲填 "bullish"、看跌填 "bearish"、中立或無法判斷填 "neutral"。

回傳格式為 JSON 陣列，若無明確討論的個股，回傳 []。
JSON 格式：
[{"symbol":"2330","name":"台積電","summary":"...","timestamp":"00:12:34","sentiment":"bullish"}]

只回傳 JSON，不要其他說明文字。

影片說明：
"""


def _parse_gemini_response(raw: str) -> list[dict]:
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
    mentions = json.loads(raw)
    if not isinstance(mentions, list):
        return []
    _VALID_SENTIMENTS = {"bullish", "bearish", "neutral"}
    result = []
    for m in mentions:
        if not isinstance(m, dict):
            continue
        sym = str(m.get("symbol", "")).strip()
        name = str(m.get("name", "")).strip()
        summary = str(m.get("summary", "")).strip()
        ts = str(m.get("timestamp", "00:00:00")).strip()
        sentiment = str(m.get("sentiment", "neutral")).strip().lower()
        if sentiment not in _VALID_SENTIMENTS:
            sentiment = "neutral"
        if sym and summary:
            result.append({"symbol": sym, "name": name,
                            "summary": summary, "timestamp": ts,
                            "timestamp_sec": _ts_to_sec(ts),
                            "sentiment": sentiment})
    return result


def _gemini_generate(client, contents, max_retries: int = 3) -> str | None:
    """Call Gemini with automatic retry on 429 rate-limit errors."""
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
                contents=contents,
                config=genai_sdk.types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=4096,
                ),
            )
            return response.text
        except Exception as e:
            msg = str(e)
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                # Parse suggested retry delay from error message
                import re as _re
                m = _re.search(r"retry[^:]*:\s*'?(\d+)", msg, _re.IGNORECASE)
                wait = int(m.group(1)) + 5 if m else 30
                wait = max(wait, 15)
                logger.warning(f"Gemini rate limited, waiting {wait}s (attempt {attempt+1}/{max_retries})")
                time.sleep(wait)
            else:
                logger.error(f"Gemini error: {e}")
                return None
    logger.error("Gemini max retries exceeded")
    return None


def _extract_mentions_from_url(video_url: str) -> list[dict]:
    """Pass YouTube URL directly to Gemini — no transcript needed."""
    client = genai_sdk.Client(api_key=_gemini_key())
    raw = _gemini_generate(client, [
        genai_sdk.types.Part(file_data=genai_sdk.types.FileData(file_uri=video_url)),
        genai_sdk.types.Part(text=_PROMPT_VIDEO),
    ])
    if not raw:
        return []
    try:
        result = _parse_gemini_response(raw)
        logger.info(f"Gemini (video URL) extracted {len(result)} mentions")
        return result
    except Exception as e:
        logger.warning(f"Gemini (video URL) parse error: {e}")
        return []


def _extract_mentions_from_text(content: str) -> list[dict]:
    """Fallback: analyse title + description text."""
    if not content.strip():
        return []
    client = genai_sdk.Client(api_key=_gemini_key())
    raw = _gemini_generate(client, _PROMPT_TEXT_PREFIX + content)
    if not raw:
        return []
    try:
        result = _parse_gemini_response(raw)
        logger.info(f"Gemini (text) extracted {len(result)} mentions")
        return result
    except Exception as e:
        logger.warning(f"Gemini (text) parse error: {e}")
        return []


# ── Persistence ───────────────────────────────────────────────────────────────

def _save_mentions(conn, video: dict, mentions: list[dict]):
    for m in mentions:
        conn.execute(
            """INSERT OR IGNORE INTO youtube_mentions
               (video_id, video_title, video_url, video_date,
                stock_symbol, stock_name, summary, timestamp_sec, sentiment)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (video["video_id"], video["title"], video["url"], video["date"],
             m["symbol"], m["name"], m["summary"], m["timestamp_sec"],
             m.get("sentiment", "neutral")),
        )
    conn.commit()


# ── Public interface ──────────────────────────────────────────────────────────

def run_youtube_pipeline(conn, days: int = 7):
    """
    Full pipeline: fetch channel videos → transcripts → Gemini → DB.
    Called by APScheduler at 18:30 and optionally via /api/youtube/refresh.
    """
    logger.info("Starting YouTube pipeline")
    videos = _fetch_channel_videos(days=days)
    if not videos:
        logger.info("No videos found in date range")
        return {"processed": 0, "total_mentions": 0, "found": 0}

    # Skip videos already processed
    existing = {
        row[0] for row in conn.execute(
            "SELECT DISTINCT video_id FROM youtube_mentions"
        ).fetchall()
    }
    new_videos = [v for v in videos if v["video_id"] not in existing]
    logger.info(f"{len(new_videos)} new videos to process (skipping {len(videos) - len(new_videos)} cached)")

    total_mentions = 0
    no_transcript = 0
    for video in new_videos:
        logger.info(f"Processing: {video['title'][:60]}")

        transcript = _fetch_transcript(video["video_id"])
        if transcript:
            mentions = _extract_mentions_from_text(transcript)
            source = "transcript"
        else:
            no_transcript += 1
            desc = video.get("description", "").strip()
            content = f"標題：{video['title']}\n\n節目說明：\n{desc}" if desc else f"標題：{video['title']}"
            mentions = _extract_mentions_from_text(content)
            source = "description"

        logger.info(f"  Source={source}, {len(mentions)} mentions")
        _save_mentions(conn, video, mentions)
        total_mentions += len(mentions)
        logger.info(f"  Saved {len(mentions)} mentions")
        time.sleep(8)  # Rate limit: be polite to Gemini API

    return {
        "found": len(videos),
        "processed": len(new_videos),
        "no_transcript": no_transcript,
        "total_mentions": total_mentions,
    }


def get_mentions(conn, days: int = 7) -> list[dict]:
    """Query DB for mentions within last `days` days."""
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT id, video_id, video_title, video_url, video_date,
                  stock_symbol, stock_name, summary, timestamp_sec, sentiment
           FROM youtube_mentions
           WHERE video_date >= ?
           ORDER BY video_date DESC, id ASC""",
        (since,),
    ).fetchall()
    return [dict(r) for r in rows]
