"""
Facebook page / profile scraping service.

Uses Playwright with a persistent Chromium profile stored at
~/.ai-stock-radar/fb_profile. The user logs in once via the Settings page
(opens a visible Chromium window); cookies persist in the profile dir so
later headless scrapes stay authenticated.

Honest caveats:
  - Meta's Terms of Service forbid automated scraping. This is intended
    for personal, local-only use; don't deploy publicly.
  - FB obfuscates CSS class names; selectors here are best-effort and
    may need updating when FB redesigns.
  - Personal profiles only work if the logged-in account is a friend (or
    the profile is fully public). Business Pages are typically scrape-able.
  - Keep call frequency low (< 1 request per 10 sec) to avoid rate-limits.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from app.database import get_connection

logger = logging.getLogger(__name__)

PROFILE_DIR = Path(os.environ.get("FB_PROFILE_DIR",
                                  str(Path.home() / ".ai-stock-radar" / "fb_profile")))
PROFILE_DIR.mkdir(parents=True, exist_ok=True)
SCRAPE_TIMEOUT_SEC = 40
MAX_POSTS_PER_PAGE = 15


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_fb_url(url: str) -> str | None:
    """
    Normalize various FB URL formats:
      facebook.com/username       → canonical
      m.facebook.com/...          → www
      full URLs with query params → strip
    Returns None if not a FB URL.
    """
    u = url.strip()
    if not u:
        return None
    # Accept bare usernames
    if re.fullmatch(r"[A-Za-z0-9._\-]{3,60}", u):
        return f"https://www.facebook.com/{u}"
    # Prepend scheme if missing
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    # Force www + strip query
    u = re.sub(r"^https?://(m\.|web\.|mbasic\.)?facebook\.com", "https://www.facebook.com", u)
    u = u.split("?")[0].rstrip("/")
    if "facebook.com/" not in u:
        return None
    return u


def _page_id_from_url(url: str) -> str:
    """Extract the last path segment as an ID (e.g. facebook.com/zuck → 'zuck')."""
    return url.rstrip("/").rsplit("/", 1)[-1]


# ── Playwright runner (sync wrapper) ──────────────────────────────────────────

def _run_playwright_async(coro):
    """Run an async Playwright coroutine in a new event loop, synchronously."""
    try:
        return asyncio.run(coro)
    except RuntimeError as e:
        # If already in an event loop (shouldn't happen from our threads), fall back
        logger.warning(f"_run_playwright_async: {e}")
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()


async def _with_context(headless: bool):
    """
    Launch a persistent Playwright Chromium context. Returns (playwright, context).
    Caller must close both.
    """
    from playwright.async_api import async_playwright
    pw = await async_playwright().start()
    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE_DIR),
        headless=headless,
        args=["--disable-blink-features=AutomationControlled"],
        locale="zh-TW",
        viewport={"width": 1280, "height": 900},
    )
    return pw, ctx


# ── Auth check ────────────────────────────────────────────────────────────────

async def _check_auth_async() -> dict:
    pw = ctx = None
    try:
        pw, ctx = await _with_context(headless=True)
        page = await ctx.new_page()
        try:
            await page.goto("https://www.facebook.com/", wait_until="domcontentloaded", timeout=15000)
        except Exception as e:
            return {"authenticated": False, "available": True, "message": f"connect error: {e}"}
        # When logged out, FB shows the login form with id=email. When logged in,
        # the URL stays on / and the feed skeleton renders (no email form).
        email_present = await page.locator("input[name='email']").count()
        url = page.url
        if "login" in url or email_present > 0:
            return {"authenticated": False, "available": True,
                    "message": "Facebook 未登入，請在 Settings 點『開啟瀏覽器登入 Facebook』"}
        return {"authenticated": True, "available": True, "message": "Authenticated"}
    finally:
        if ctx: await ctx.close()
        if pw: await pw.stop()


def check_auth() -> dict:
    """
    {available: bool, authenticated: bool, message: str}
    Available means Playwright + chromium installed; authenticated means FB
    cookie in the persistent profile still works.
    """
    try:
        import playwright  # noqa
    except Exception:
        return {"available": False, "authenticated": False,
                "message": "playwright not installed"}
    try:
        return _run_playwright_async(_check_auth_async())
    except Exception as e:
        return {"available": True, "authenticated": False,
                "message": f"auth check error: {e}"}


# ── Login (headed window, runs in foreground — same pattern as notebooklm) ────

def launch_login_window() -> tuple[int, str]:
    """
    Open a headed Chromium window pointing at facebook.com/login using our
    persistent profile. User logs in; when the cookie is saved, closing the
    window commits the profile.

    Returns (returncode, stderr_short). Blocks for up to 10 minutes.
    """
    # Spawn a small Python subprocess so its asyncio loop is isolated from
    # FastAPI's running loop.
    script = r"""
import asyncio
from playwright.async_api import async_playwright

async def main(user_data_dir):
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
            viewport={"width": 1280, "height": 900},
            locale="zh-TW",
        )
        page = await ctx.new_page()
        await page.goto("https://www.facebook.com/login", timeout=30000)
        # Wait until the user has finished (either closes window, or page
        # reaches a non-login URL and stays there for a bit).
        try:
            await page.wait_for_url(lambda u: "login" not in u and "checkpoint" not in u, timeout=600000)
        except Exception:
            pass
        # Give FB a moment to persist tokens
        try:
            await page.wait_for_timeout(3000)
        except Exception:
            pass
        await ctx.close()

import sys
asyncio.run(main(sys.argv[1]))
"""
    try:
        p = subprocess.run(
            [sys.executable, "-c", script, str(PROFILE_DIR)],
            capture_output=True, text=True, timeout=650,
            encoding="utf-8", errors="replace",
        )
        return p.returncode, (p.stderr or "").strip()[-2000:]
    except subprocess.TimeoutExpired:
        return 124, "login window timed out (>10 min)"
    except Exception as e:
        return -1, str(e)


# ── Page resolution ───────────────────────────────────────────────────────────

async def _resolve_page_async(url: str) -> dict | None:
    pw = ctx = None
    try:
        pw, ctx = await _with_context(headless=True)
        page = await ctx.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=SCRAPE_TIMEOUT_SEC * 1000)
        except Exception as e:
            logger.warning(f"resolve_page_async goto {url}: {e}")
            return None

        # Give the page a moment for og:title and h1 to mount
        try: await page.wait_for_timeout(1500)
        except Exception: pass

        try:
            name = await page.evaluate(_PAGE_META_JS)
        except Exception:
            name = None

        if not name:
            title = await page.title()
            name = re.sub(r"^\(\d+\)\s*", "", title or "").strip()
            name = re.sub(r"\s*[\|\-–—]\s*Facebook.*$", "", name).strip()

        title_raw = await page.title()
        if "找不到" in (title_raw or "") or "isn't available" in (title_raw or "").lower():
            return None
        if not name:
            return None

        kind = "profile" if "/profile.php" in url or url.rstrip("/").rsplit("/", 1)[-1].isdigit() else "page"

        return {"url": url, "name": name[:80], "kind": kind, "id": _page_id_from_url(url)}
    finally:
        if ctx: await ctx.close()
        if pw: await pw.stop()


def resolve_page(url_input: str) -> dict | None:
    """Return {id, url, name, kind} or None if page can't be resolved."""
    url = _normalize_fb_url(url_input)
    if not url:
        return None
    try:
        return _run_playwright_async(_resolve_page_async(url))
    except Exception as e:
        logger.warning(f"resolve_page {url_input}: {e}")
        return None


# ── Page post scraping ────────────────────────────────────────────────────────

_PERMALINK_JS = r"""
(args) => {
  // Collect post permalinks on the /posts feed page. We only return URLs +
  // a timestamp hint — full post content is fetched by navigating to each
  // permalink individually (FB renders the full, non-truncated body there).
  const POST_URL_RE = /(\/posts\/|\/videos\/|\/photos\/|\/photo\/|\/story\.php|story_fbid|fbid=|\/permalink\/|\/reel\/|\/watch\/)/;
  const TS_RE = /(剛剛|\d+\s*(?:分鐘|小時|天|週|月|年)前?|昨天|前天|今天|\d{1,2}月\s*\d{1,2}日|\d{4}年|\d+\s*(?:min|hour|day|hr|h|d)s?\s*ago)/i;
  const seen = new Set();
  const out = [];
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  for (const a of anchors) {
    const href = (a.href || '').split('#')[0];
    if (!POST_URL_RE.test(href)) continue;
    const text = (a.innerText || '').trim();
    const aria = (a.getAttribute('aria-label') || '').trim();
    const hasTsHint = TS_RE.test(text) || TS_RE.test(aria);
    // Canonicalise — drop query params except fbid (which is the ID)
    let url = href;
    try {
      const u = new URL(href);
      const fbid = u.searchParams.get('fbid');
      const sid = u.searchParams.get('story_fbid');
      u.search = '';
      if (fbid) u.searchParams.set('fbid', fbid);
      if (sid) u.searchParams.set('story_fbid', sid);
      url = u.toString().replace(/\/$/, '');
    } catch (e) { /* fall back to raw */ }
    if (seen.has(url)) continue;
    // Skip generic /photos (no id) / /videos (hub) / /reel (hub)
    if (/\/(photos|videos|reel|watch)\/?$/.test(url)) continue;
    // Require it to look like a real post permalink: has an id segment or fbid
    const hasId = /\/posts\/\d|\/videos\/\d|\/photos\/[^\/]+|fbid=\d|story_fbid=\d|\/reel\/\d|\/permalink\/\d|\/watch\/\?v=/.test(url);
    if (!hasId) continue;
    seen.add(url);
    out.push({ url, timestamp_hint: aria || text, has_ts: hasTsHint });
  }
  // Prefer links that had a timestamp nearby (those are the main feed items,
  // not related-post / see-more links)
  out.sort((a, b) => (b.has_ts ? 1 : 0) - (a.has_ts ? 1 : 0));
  return out;
}
"""


_SINGLE_POST_JS = r"""
(args) => {
  // Extract clean post body text from an individual post permalink page.
  // On a permalink URL, FB renders the post in a main <div role="main"> or
  // opens a modal dialog. The body is in [data-ad-preview="message"] or
  // [data-ad-comet-preview="message"]; fall back to the largest dir="auto"
  // block that isn't a comment.
  const knownPageName = (args && args.pageName) || '';

  // Click any "查看更多" / "See more" first (inside the post only)
  try {
    const expandables = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
    for (const el of expandables) {
      const t = (el.innerText || '').trim();
      if (/^(查看更多|See more|顯示更多|Show more)$/i.test(t)) {
        try { el.click(); } catch (e) {}
      }
    }
  } catch (e) {}

  const isInComment = (el) => {
    let p = el.parentElement;
    while (p) {
      const al = p.getAttribute && p.getAttribute('aria-label') || '';
      if (/comment|留言|reply|回覆/i.test(al)) return true;
      const dp = p.getAttribute && p.getAttribute('data-pagelet') || '';
      if (/comment/i.test(dp)) return true;
      p = p.parentElement;
    }
    return false;
  };

  // Try data-ad-preview first (Pages posts)
  let text = '';
  const previews = Array.from(document.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]'));
  for (const msg of previews) {
    if (isInComment(msg)) continue;
    const t = (msg.innerText || '').trim();
    if (t && t.length > text.length) text = t;
  }

  // Filter for vertical-character decorations: FB's photo viewer renders
  // timestamps as per-character stacked divs (writing-mode: vertical-rl).
  // These produce innerText with mostly 1-char lines. Reject them.
  const isStackedChars = (t) => {
    const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 6) return false;
    const short = lines.filter(l => l.length <= 2).length;
    return short / lines.length > 0.6;
  };

  // Fallback: scan dir="auto" blocks (post body usually has dir=auto) and
  // pick the longest non-comment one
  if (!text) {
    const dirAuto = Array.from(document.querySelectorAll('div[dir="auto"], span[dir="auto"]'));
    for (const d of dirAuto) {
      if (isInComment(d)) continue;
      const t = (d.innerText || '').trim();
      if (t.length < 4 || t.length > 5000) continue;
      if (knownPageName && t === knownPageName) continue;
      if (/^(已驗證帳號|Verified|Follow|追蹤|贊助|公開|Public)$/.test(t)) continue;
      if (/^(查看全部|查看更多|See more|View all)/.test(t)) continue;
      if (isStackedChars(t)) continue;
      if (t.length > text.length) text = t;
    }
  }

  // Last-ditch fallback for photo-only posts: look at span[dir="auto"]
  // inside the photo-viewer right panel specifically
  if (!text) {
    const photoPanel = document.querySelector('[role="dialog"] [role="complementary"], [role="dialog"]');
    if (photoPanel) {
      const spans = Array.from(photoPanel.querySelectorAll('span[dir="auto"], div[dir="auto"]'));
      for (const s of spans) {
        if (isInComment(s)) continue;
        const t = (s.innerText || '').trim();
        if (t.length < 10 || t.length > 5000) continue;
        if (isStackedChars(t)) continue;
        if (t.length > text.length) text = t;
      }
    }
  }

  // Final defence: if whatever we picked looks like stacked chars, drop it
  if (text && isStackedChars(text)) text = '';

  // Extract posted_at from a tooltip-bearing anchor
  let posted_at = '';
  const tsLinks = Array.from(document.querySelectorAll('a[aria-label]'));
  for (const l of tsLinks) {
    const al = (l.getAttribute('aria-label') || '').trim();
    if (/\d/.test(al) && al.length < 80) { posted_at = al.split('\n')[0]; break; }
  }

  // Engagement counts (best effort) — scan the document for "N 則留言" etc.
  const parseK = (s) => {
    if (!s) return 0;
    s = String(s).replace(/,/g, '');
    if (/K$/i.test(s)) return Math.round(parseFloat(s) * 1000);
    if (/M$/i.test(s)) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s, 10) || 0;
  };
  const docText = (document.body && document.body.innerText) || '';
  const m1 = docText.match(/\b([\d,]+(?:\.\d+)?[KM]?)\s*(?:個人|讚|likes?|reactions?)\b/i);
  const m2 = docText.match(/\b([\d,]+(?:\.\d+)?[KM]?)\s*(?:則留言|留言|comments?)\b/i);
  const m3 = docText.match(/\b([\d,]+(?:\.\d+)?[KM]?)\s*(?:次分享|分享|shares?)\b/i);
  const reactions = m1 ? Math.min(parseK(m1[1]), 10000000) : 0;
  const comments  = m2 ? Math.min(parseK(m2[1]), 10000000) : 0;
  const shares    = m3 ? Math.min(parseK(m3[1]), 10000000) : 0;

  return { text: text.slice(0, 3000), posted_at, reactions, comments, shares };
}
"""


_POST_JS = r"""
(args) => {
  const knownPageName = (args && args.pageName) || '';
  const POST_URL_RE = /(\/posts\/|\/videos\/|\/photos\/|\/story\.php|story_fbid|fbid=|\/permalink\/|\/reel\/|\/watch\/)/;
  const parseK = (s) => {
    if (!s) return 0;
    s = String(s).replace(/,/g, '').replace(/\s/g, '');
    if (/K$/i.test(s)) return Math.round(parseFloat(s) * 1000);
    if (/M$/i.test(s)) return Math.round(parseFloat(s) * 1_000_000);
    return parseInt(s, 10) || 0;
  };

  // ══════════════════════════════════════════════════════════════════════
  // NEW PRIMARY STRATEGY: slice body.innerText by post markers.
  //
  // Every visible post on a Page feed ends with either "所有心情: N" or
  // "N 則留言" / "N 次分享" markers. The author name repeats at the top of
  // each post. Using these anchors we can split the body text into posts
  // without touching DOM wrappers (which FB obfuscates heavily).
  // ══════════════════════════════════════════════════════════════════════
  const bodyText = document.body ? (document.body.innerText || '') : '';
  const lines = bodyText.split('\n').map(l => l.trim());

  const TIMESTAMP_RE = /^(剛剛|\d+\s*(?:分鐘|小時|天|週|月|年)前?|昨天|前天|今天|\d{1,2}月\s*\d{1,2}日|\d{4}年\s*\d{1,2}月|[JFMASOND][a-z]+\s+\d{1,2}|\d+\s*(?:min|hour|day|hr|h|d)s?\s*ago)$/i;
  const REACT_END_RE = /^所有心情|^All reactions|^[\d,\.KM]+\s*(?:則留言|留言|次分享|分享|comments?|shares?)|^[\d,\.KM]+\s*人覺得|^喜歡\s*\d+/i;

  // Permalink links indexed by approximate chunk position (each post has
  // a timestamp link; text index of that timestamp lets us associate URL)
  const permalinkLinks = Array.from(document.querySelectorAll('a[href]'))
    .filter(a => POST_URL_RE.test(a.href));

  // Collect (startLineIdx, endLineIdx) for each post by looking for author
  // repetitions at the top of each block — but simpler: slice by END markers.
  const postChunks = [];
  let currentStart = -1;
  for (let i = 0; i < lines.length; i++) {
    // Opening signal: a line exactly equal to the page's author name
    if (knownPageName && lines[i] === knownPageName) {
      if (currentStart < 0) currentStart = i;
    }
    // Closing signal: reaction bar
    if (currentStart >= 0 && REACT_END_RE.test(lines[i])) {
      postChunks.push({ start: currentStart, reactLine: i, endReactIdx: i });
      currentStart = -1;
    }
  }

  // Build posts from chunks
  const textPosts = [];
  for (const ch of postChunks) {
    // Skip past header lines (author, 已驗證帳號, timestamp, 公開)
    let bodyStart = ch.start + 1;
    while (bodyStart < ch.reactLine) {
      const ln = lines[bodyStart];
      if (ln === '' || ln === '作者' || ln === knownPageName) { bodyStart++; continue; }
      if (/^(已驗證帳號|Verified|Follow|追蹤|贊助)$/.test(ln)) { bodyStart++; continue; }
      if (TIMESTAMP_RE.test(ln)) { bodyStart++; continue; }
      if (/^(公開|僅限粉絲|Public)$/.test(ln)) { bodyStart++; continue; }
      if (/^[·•]+$/.test(ln)) { bodyStart++; continue; }
      if (/^\s*$/.test(ln)) { bodyStart++; continue; }
      break;
    }
    // Body is the lines from bodyStart until reactLine
    const bodyLines = lines.slice(bodyStart, ch.reactLine)
      .filter(ln => ln && !/^(查看更多|See more|顯示更多|Show more|\.\.\.\s*查看更多)$/i.test(ln));
    const text = bodyLines.join('\n').trim();
    if (!text || text.length < 10) continue;

    // Try to find a permalink near this chunk. We don't have text-to-DOM
    // mapping here; best effort: pick the Nth permalink for the Nth chunk.
    textPosts.push({ text, chunkStart: ch.start, chunkEnd: ch.reactLine });
  }

  // Attach one permalink to each text post (ordinal match)
  const postsOut = [];
  const seenUrls = new Set();
  for (let i = 0; i < textPosts.length && postsOut.length < 15; i++) {
    const p = textPosts[i];
    const link = permalinkLinks[i];
    let url = link ? link.href.split('?')[0].replace(/\/$/, '') : '';
    if (!url || seenUrls.has(url)) {
      url = `#textpost-${i}-${p.text.slice(0,40).replace(/\s+/g, '_')}`;
    }
    seenUrls.add(url);
    postsOut.push({
      url, text: p.text.slice(0, 2500), posted_at: '',
      reactions: 0, comments: 0, shares: 0,
    });
  }

  const debug2 = {
    total_lines: lines.length,
    post_chunks: postChunks.length,
    text_posts: textPosts.length,
    permalinks_found: permalinkLinks.length,
    first_chunk_preview: postChunks[0] ? lines.slice(postChunks[0].start, Math.min(postChunks[0].start + 8, lines.length)).join(' | ') : '',
  };

  // If the new strategy worked, return early
  if (postsOut.length > 0) {
    return { posts: postsOut, debug: debug2 };
  }

  // ── LEGACY PATH (only if new strategy found nothing) ──────────────────

  // NEW STRATEGY: FB Pages no longer wrap posts in role="article". Instead
  // posts are plain divs with obfuscated class names. We anchor on the
  // reactions footer ("所有心情", "N則留言", "N次分享") and walk up to find
  // the smallest ancestor that contains a full post.
  const REACTION_MARKER_RE = /(所有心情|All reactions|則留言|comments?|次分享|shares?)/i;

  // Collect all candidate reaction-footer nodes
  const reactionNodes = Array.from(document.querySelectorAll('div, span'))
    .filter(el => {
      const t = (el.innerText || '').trim();
      if (t.length < 2 || t.length > 150) return false;
      return REACTION_MARKER_RE.test(t);
    });

  // NEW: walk UP from each POST permalink link (not reaction markers).
  // This gives tighter wrappers. But FB has many non-post permalink links
  // (nav bar, related-posts, sidebar), so we narrow to links whose text or
  // aria-label looks like a post TIMESTAMP ("3 小時", "昨天", "2024年3月").
  // (re-filter permalinkLinks by timestamp for the legacy walk-up path)
  const timestampLinkRE = /(剛剛|\d+\s*(?:分鐘|小時|天|週|月|年)前?|昨天|前天|今天|\d{1,2}月\s*\d{1,2}日)/i;
  const permalinkLinks2 = permalinkLinks.filter(a => {
    const t = (a.innerText || '').trim();
    const al = (a.getAttribute('aria-label') || '').trim();
    return timestampLinkRE.test(t) || timestampLinkRE.test(al);
  });

  const wrappersSet = new Set();
  const arts = [];
  const REACTION_PLAIN_RE = /(所有心情|則留言|次分享|All reactions)/;

  for (const link of permalinkLinks2) {
    let p = link.parentElement;
    let chosen = null;
    while (p) {
      const t = (p.innerText || '').trim();
      const tl = t.length;
      if (tl > 4500) break;
      // We've expanded enough when our wrapper contains a reaction footer
      if (tl >= 150 && REACTION_PLAIN_RE.test(t)) {
        chosen = p;
        break;
      }
      p = p.parentElement;
    }
    if (!chosen || wrappersSet.has(chosen)) continue;
    wrappersSet.add(chosen);
    arts.push(chosen);
  }

  // Fallback: if no wrappers found, use role="article" approach (legacy FB)
  if (arts.length === 0) {
    const isComment = (a) => {
      let p = a.parentElement;
      while (p) {
        if (p.getAttribute && p.getAttribute('role') === 'article') return true;
        p = p.parentElement;
      }
      return false;
    };
    Array.from(document.querySelectorAll('[role="article"]'))
      .filter(a => !isComment(a)).forEach(a => arts.push(a));
  }

  const feed = null;  // no-op for new layout

  const debug = {
    total_articles: document.querySelectorAll('[role="article"]').length,
    top_level: arts.length,
    has_feed: !!feed,
    url: location.href,
    title: document.title,
    per_article: [],
  };

  const seenUrls2 = new Set();
  const out = [];

  for (let idx = 0; idx < arts.length && out.length < 15; idx++) {
    const a = arts[idx];

    // ── Author check ───────────────────────────────────────────────────────
    // FB's "recent activity" view mixes: own posts, comments on others'
    // posts, and reactions. Only keep articles whose HEADER author matches
    // the page we're scraping.
    let authorName = '';
    const header = a.querySelector('h2, h3, strong');
    if (header) {
      // The header usually contains a link to the author's profile; prefer
      // its text.
      const authLink = header.querySelector('a[role="link"], a[aria-label]') || header;
      authorName = (authLink.innerText || '').split('\n')[0].trim();
    }
    // Fallback: first link inside the article that isn't a permalink
    if (!authorName) {
      const firstLinks = Array.from(a.querySelectorAll('a[href]')).slice(0, 6);
      for (const l of firstLinks) {
        const href = l.href;
        if (/\/posts\/|\/photos\/|story_fbid|\/videos\//.test(href)) continue;
        const t = (l.innerText || '').trim();
        if (t && t.length <= 40 && !/^\d+\s*(分|時|天|前)$/.test(t)) {
          authorName = t;
          break;
        }
      }
    }

    if (knownPageName && authorName && !authorName.includes(knownPageName)
        && !knownPageName.includes(authorName)) {
      debug.per_article.push({ idx, skipped: 'author-mismatch', authorName, knownPageName });
      continue;
    }

    // ── Simple text extraction via innerText parsing ───────────────────────
    // Since FB's DOM structure varies wildly, the most reliable way is to
    // take the wrapper's innerText and strip out the known-noise top/bottom:
    //   top noise: author line, verified badge, timestamp link, "Follow" btn
    //   bottom noise: "所有心情" / "N 則留言" / "讚" / "回覆" / "分享" row
    const wholeText = (a.innerText || '').trim();
    const lines = wholeText.split('\n').map(l => l.trim());

    // Find the reaction-bar index (end of post body)
    let endIdx = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (/^(所有心情|All reactions|\d[\d,\.]*[KM]?\s*$)/.test(lines[i])) { endIdx = i; break; }
      if (/^(\d[\d,\.]*[KM]?)\s*(則留言|留言|comments?|次分享|分享|shares?)/.test(lines[i])) { endIdx = i; break; }
    }

    // Find the header-end index (start of post body) — skip:
    //   page-name line, "已驗證帳號" / "Verified", timestamp ("3 小時", "昨天")
    let startIdx = 0;
    for (let i = 0; i < endIdx; i++) {
      const ln = lines[i];
      if (ln === '' || ln === '作者') { startIdx = i + 1; continue; }
      if (knownPageName && ln === knownPageName) { startIdx = i + 1; continue; }
      if (/^(已驗證帳號|Verified|Follow|追蹤|贊助)$/.test(ln)) { startIdx = i + 1; continue; }
      // Timestamp lines
      if (/^(剛剛|\d+\s*(?:分鐘|小時|天|週|月|年)前?|昨天|前天|今天)$/.test(ln)) { startIdx = i + 1; continue; }
      if (/^\d{1,2}月\s*\d{1,2}日/.test(ln)) { startIdx = i + 1; continue; }
      if (/^[·•]+$/.test(ln)) { startIdx = i + 1; continue; }
      // Page visibility icons "公開" etc.
      if (/^(公開|僅限粉絲|Public)$/.test(ln)) { startIdx = i + 1; continue; }
      // First real-looking line
      break;
    }

    let bodyLines = lines.slice(startIdx, endIdx).filter(ln => ln && ln !== '查看更多' && ln !== 'See more');
    // Strip trailing UI tokens if present
    while (bodyLines.length && /^(查看更多|See more|顯示更多|Show more|\.\.\.)$/i.test(bodyLines[bodyLines.length - 1])) {
      bodyLines.pop();
    }

    let text = bodyLines.join('\n').trim();
    if (text.length > 2500) text = text.slice(0, 2500);

    // ── legacy noise helpers kept for the fallback scoring path below ───
    const NOISE_ARIA = /(\bcomment|留言|\breply\b|回覆|reaction|反應)/i;
    const isNoiseNode = (d) => {
      let p = d;
      while (p && p !== a) {
        if (p.getAttribute) {
          if (p.getAttribute('role') === 'article') return true;
          const al = p.getAttribute('aria-label') || '';
          if (al && NOISE_ARIA.test(al)) return true;
          const dp = p.getAttribute('data-pagelet') || '';
          if (/comment|reaction/i.test(dp)) return true;
          const dt = p.getAttribute('data-testid') || '';
          if (/comment|reply/i.test(dt)) return true;
        }
        p = p.parentElement;
      }
      return false;
    };

    // Also: find the comments section by structural marker. FB renders a
    // horizontal divider before comments; everything in DOM order after the
    // "Write a comment..." composer is comments / replies / reaction list.
    // Record a cutoff node so we can reject dir="auto" nodes beyond it.
    let cutoffIndex = -1;
    {
      const allNodes = Array.from(a.querySelectorAll('*'));
      for (let i = 0; i < allNodes.length; i++) {
        const n = allNodes[i];
        const al = (n.getAttribute && n.getAttribute('aria-label')) || '';
        const ph = (n.getAttribute && n.getAttribute('placeholder')) || '';
        if (/撰寫留言|Write a comment|留言…|留言\.\.\./i.test(al + ' ' + ph)) {
          cutoffIndex = i;
          break;
        }
      }
    }
    const allChildren = cutoffIndex >= 0 ? Array.from(a.querySelectorAll('*')) : null;

    // Text extraction — primary path already ran above via innerText split.
    // Only fall back to data-ad-preview if the split approach produced nothing.
    if (!text) {
      const msg = a.querySelector('[data-ad-preview="message"]');
      if (msg && !isNoiseNode(msg)) text = (msg.innerText || '').trim();
    }

    const debugArticle = { idx, candidates: [], cutoffIndex };

    if (!text) {
      // Broader candidate pool: every div/span/p with non-empty text.
      // FB pages sometimes put the post body in a plain div without dir="auto".
      const allCands = Array.from(a.querySelectorAll('div, span, p'))
        .filter((d) => {
          if (d.tagName === 'BUTTON') return false;
          const ro = d.getAttribute && d.getAttribute('role');
          if (ro === 'button' || ro === 'link') return false;
          return true;
        });
      const candidates = allCands.filter((d) => !isNoiseNode(d));

      // Score each candidate. Strategy: heavily penalise UI noise tokens
      // so the clean post body (even when short) beats noisy versions that
      // have author/engagement labels glued to the text.
      const NOISE_TOKEN_RE = /(作者|已驗證帳號|Verified|^讚$|\n讚\n|\n回覆\n|\n分享\n|\n\d+天\n|\n\d+小時\n|\n\d+分鐘\n|\n\d+$)/m;
      const scoreOf = (d) => {
        const t = (d.innerText || '').trim();
        if (t.length < 4 || t.length > 4000) return -Infinity;
        let s = 0;
        const cs = window.getComputedStyle(d);
        if (cs.whiteSpace && cs.whiteSpace.indexOf('pre') !== -1) s += 100;
        if (d.getAttribute && d.getAttribute('dir') === 'auto') s += 40;
        // Penalty: noise tokens (author/engagement labels mashed in)
        const noiseMatches = (t.match(/作者|已驗證帳號|Verified|讚$|\n讚\n|\n回覆\n|\n分享\n|\n\d+天\n|\n\d+小時\n|\n\d+分鐘\n/g) || []).length;
        s -= noiseMatches * 50;
        // Penalty: interactive descendants (UI container)
        const interactive = d.querySelectorAll('a[role="link"], [role="button"]').length;
        s -= interactive * 8;
        // Prefer leafy nodes (fewer descendants = closer to actual text node)
        s -= Math.max(0, d.querySelectorAll('*').length - 5) * 1;
        // Mild length bonus up to a cap so we don't favour walls of noise
        s += Math.min(40, t.length);
        return s;
      };

      // Exclude header repetitions of the page name (which often appears as
      // the first dir="auto" in every article — FB's "post-by: {pageName}")
      const og = document.querySelector('meta[property="og:title"]');
      const ogName = og ? (og.getAttribute('content') || '').trim() : '';
      const titleNoPrefix = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*[\|\-–—]\s*Facebook.*$/, '').trim();
      const pageNameVariants = new Set([knownPageName, ogName, titleNoPrefix].filter(Boolean));

      let bestScore = -Infinity;
      let bestText = '';
      let bestFallback = '';  // longest valid, used when nothing scores well
      for (const d of candidates) {
        const t = (d.innerText || '').trim();
        if (t.length < 4 || t.length > 4000) {
          debugArticle.candidates.push({ reason: 'length', len: t.length });
          continue;
        }
        if (/^[\s·•]+$/.test(t)) { debugArticle.candidates.push({reason:'decor'}); continue; }
        if (/^\d+\s*(?:分|時|天|週|月|年)前$/.test(t)) { debugArticle.candidates.push({reason:'date'}); continue; }
        if (/^作者$/.test(t)) { debugArticle.candidates.push({reason:'author'}); continue; }
        if (t.length < 30 && /^(已驗證帳號|Verified\b)/.test(t)) { debugArticle.candidates.push({reason:'verified'}); continue; }
        if (pageNameVariants.has(t)) { debugArticle.candidates.push({reason:'page-name'}); continue; }
        if (cutoffIndex >= 0 && allChildren) {
          const idxN = allChildren.indexOf(d);
          if (idxN > cutoffIndex) { debugArticle.candidates.push({reason:'after-cutoff'}); continue; }
        }

        const s = scoreOf(d);
        if (s !== -Infinity && s > bestScore) {
          bestScore = s;
          bestText = t;
        }
        if (t.length > bestFallback.length && t.length >= 4) {
          bestFallback = t;
        }
        debugArticle.candidates.push({ reason: 'considered', score: s === -Infinity ? null : Math.round(s), len: t.length, preview: t.slice(0, 60) });
      }
      // Always prefer scored winner over longest-fallback — the fallback
      // tends to be the whole noisy article. Only use fallback when no
      // candidate scored positively at all.
      text = bestScore !== -Infinity ? bestText : bestFallback;
      debugArticle.total_candidates = allCands.length;
      debugArticle.filtered_candidates = candidates.length;
      debugArticle.chosen = text.slice(0, 80);
      debugArticle.best_score = bestScore === -Infinity ? null : bestScore;
    }

    debug.per_article.push(debugArticle);

    // If still empty but this is a permalink'd post, we have an image-only
    // post — that's fine, leave text empty. The UI shows "(圖片貼文)".

    // Permalink — FB uses many URL shapes; if none match, fabricate one
    const allLinks = Array.from(a.querySelectorAll('a[href]'));
    const permalinks = allLinks.filter((l) => POST_URL_RE.test(l.href));
    let url = '';
    if (permalinks.length) {
      url = permalinks[0].href.split('?')[0].replace(/\/$/, '');
    } else {
      // Synthesise a stable id from the first 120 chars of text + index
      const stub = (text || 'post').slice(0, 80).replace(/\s+/g, '_');
      url = `${location.href.split('?')[0].replace(/\/$/, '')}#post-${idx}-${encodeURIComponent(stub)}`;
    }
    if (seenUrls2.has(url)) continue;
    seenUrls2.add(url);

    // Time
    let posted_at = '';
    const timeLinks = Array.from(a.querySelectorAll('a[aria-label]'))
      .filter((el) => /\d/.test(el.getAttribute('aria-label') || ''));
    if (timeLinks.length) {
      posted_at = (timeLinks[0].getAttribute('aria-label') || '').split('\n')[0].trim();
    }
    if (!posted_at) {
      const abbr = a.querySelector('abbr, time');
      if (abbr) posted_at = (abbr.getAttribute('title') || abbr.getAttribute('datetime') || abbr.innerText || '').trim();
    }

    // Engagement (best-effort) — search narrowly for common FB footer
    // patterns. Cap at 10,000,000 to discard obvious mis-matches (e.g. a
    // 9-digit string that isn't a count).
    let reactions = 0, comments = 0, shares = 0;
    {
      const clone = a.cloneNode(true);
      clone.querySelectorAll('[role="article"]').forEach((n) => n.remove());
      const t = clone.innerText || '';
      // Require: digit(s) (possibly with K/M), whitespace, then the label.
      // `\b` anchors prevent us from chewing into 9-digit ID runs.
      const m1 = t.match(/\b([\d,]+(?:\.\d+)?[KM]?)\s*(?:個人|讚|likes?|reactions?)\b/i);
      const m2 = t.match(/\b([\d,]+(?:\.\d+)?[KM]?)\s*(?:則留言|留言|comments?)\b/i);
      const m3 = t.match(/\b([\d,]+(?:\.\d+)?[KM]?)\s*(?:次分享|分享|shares?)\b/i);
      const CAP = 10_000_000;
      if (m1) reactions = Math.min(parseK(m1[1]), CAP);
      if (m2) comments  = Math.min(parseK(m2[1]), CAP);
      if (m3) shares    = Math.min(parseK(m3[1]), CAP);
      // If still absurd, zero out rather than ship bogus numbers
      if (reactions >= CAP) reactions = 0;
      if (comments >= CAP)  comments  = 0;
      if (shares >= CAP)    shares    = 0;
    }

    // Accept even with thin text if we have engagement or a permalink
    if (!text && reactions === 0 && comments === 0 && permalinks.length === 0) continue;

    // Reject obviously wrong content — these mean we latched onto a
    // comments-section wrapper instead of the post itself
    if (/^(查看全部|View all|View more|View previous)/.test(text)) continue;
    if (text.length < 15) continue;  // real posts have more content

    out.push({ url, text: text.slice(0, 2000), posted_at, reactions, comments, shares });
  }

  // Attach debug as a property on the array (via a trailing element we strip)
  out.__debug = debug;
  return { posts: out, debug };
}
"""


_PAGE_META_JS = r"""
() => {
  // Prefer og:title meta (clean, no notification count prefix)
  const og = document.querySelector('meta[property="og:title"]');
  if (og) {
    const v = (og.getAttribute('content') || '').trim();
    if (v) return v;
  }
  const h1 = document.querySelector('h1');
  if (h1) {
    const t = (h1.innerText || '').trim();
    if (t) return t;
  }
  // document.title is usually like "(3) Page Name | Facebook"
  let t = document.title || '';
  t = t.replace(/^\(\d+\)\s*/, '');
  t = t.replace(/\s*[\|\-–—]\s*Facebook.*$/, '');
  return t.trim();
}
"""


# ── GraphQL-intercept approach ────────────────────────────────────────────────
# Instead of parsing FB's obfuscated DOM, we intercept the GraphQL XHR responses
# the page issues as it loads/scrolls, and extract posts by regex from the JSON
# body. This is much more reliable than DOM selectors because the JSON shape is
# stable, whereas FB's CSS classes are randomised.

_POST_ID_RE        = re.compile(r'"post_id":"(\d+)"')
_CREATION_TIME_RE  = re.compile(r'"(?:creation_time|publish_time|created_time|published_time|story_timestamp)":(\d{10})')
_MESSAGE_TEXT_RE   = re.compile(r'"message":\{(?:[^{}]*"text":"((?:[^"\\]|\\.)*?)")')
_POST_URL_RE       = re.compile(r'"url":"(https:\\/\\/www\.facebook\.com\\/[^"]*?\\/posts\\/[^"]*?)"')
# Also capture video/photo/permalink URLs so non-"/posts/" items still get a URL
_ANY_POST_URL_RE   = re.compile(
    r'"url":"(https:\\/\\/www\.facebook\.com\\/[^"]*?\\/(?:posts|videos|photos|permalink|reel)\\/[^"]*?)"'
)


def _decode_fb_text(s: str) -> str:
    """Decode JSON-escaped FB text: unescape \\uXXXX, \\n, \\/ etc."""
    if not s:
        return s
    # Wrap in quotes so json.loads handles all escapes correctly
    try:
        return json.loads('"' + s + '"')
    except Exception:
        # Fallback: best-effort manual unescape
        return (s.replace('\\n', '\n').replace('\\/', '/').replace('\\"', '"')
                 .replace('\\\\', '\\'))


def _extract_posts_from_graphql(body: str) -> list[dict]:
    """Extract posts from a GraphQL response body using regex."""
    posts: list[dict] = []
    seen_ids: set[str] = set()

    # A post_id can appear multiple times in one response (FB includes the
    # same post in different query edges). Check each occurrence's ±5000-char
    # window and merge — some windows have creation_time, others have the
    # message text, others have the URL.
    post_id_positions: dict[str, list[int]] = {}
    for m in _POST_ID_RE.finditer(body):
        pid = m.group(1)
        post_id_positions.setdefault(pid, []).append(m.start())

    for pid, positions in post_id_positions.items():
        if pid in seen_ids:
            continue

        timestamp = 0
        text = ""
        url = ""

        for pos in positions:
            search_start = max(0, pos - 5000)
            search_end = min(len(body), pos + 5000)
            nearby = body[search_start:search_end]

            if not timestamp:
                ct_match = _CREATION_TIME_RE.search(nearby)
                if ct_match:
                    try:
                        timestamp = int(ct_match.group(1))
                    except ValueError:
                        pass

            for mt in _MESSAGE_TEXT_RE.finditer(nearby):
                cand = mt.group(1)
                if len(cand) > len(text):
                    text = cand

            if not url:
                um = _POST_URL_RE.search(nearby) or _ANY_POST_URL_RE.search(nearby)
                if um:
                    url = um.group(1).replace("\\/", "/")

            if timestamp and text and url:
                break

        if text:
            text = _decode_fb_text(text)

        if timestamp > 0 or text:
            seen_ids.add(pid)
            posts.append({
                "id": pid,
                "text": text,
                "timestamp": timestamp,
                "url": url,
            })
    return posts


async def _fetch_posts_async(page_url: str, days: int, known_name: str = "") -> list[dict]:
    """
    Load the page, intercept all GraphQL XHR responses, and regex-extract posts
    from each JSON body. Much more reliable than DOM scraping because FB's
    GraphQL envelope shape is stable.
    """
    pw = ctx = None
    posts_url = page_url.rstrip("/") + "/posts"
    all_posts: dict[str, dict] = {}

    try:
        pw, ctx = await _with_context(headless=True)
        page = await ctx.new_page()

        # Register response interceptor BEFORE navigation so we catch the
        # initial GraphQL burst.
        sample_dumped = [False]
        async def _handle_response(response):
            try:
                if "graphql" not in response.url:
                    return
                try:
                    body = await response.text()
                except Exception:
                    return
                if len(body) < 5000:
                    return
                new_posts = _extract_posts_from_graphql(body)
                # Dump a sample body once per scrape if it contains a post_id
                if new_posts and not sample_dumped[0]:
                    try:
                        sample_path = Path.home() / ".ai-stock-radar" / "fb_last_graphql.json"
                        sample_path.parent.mkdir(parents=True, exist_ok=True)
                        sample_path.write_text(body[:200000], encoding="utf-8")
                        sample_dumped[0] = True
                    except Exception:
                        pass
                for post in new_posts:
                    pid = post.get("id", "")
                    if pid and pid not in all_posts:
                        all_posts[pid] = post
            except Exception:
                pass

        page.on("response", lambda r: asyncio.create_task(_handle_response(r)))

        try:
            await page.goto(posts_url, wait_until="domcontentloaded",
                            timeout=SCRAPE_TIMEOUT_SEC * 1000)
        except Exception as e:
            logger.warning(f"FB goto {posts_url}: {e}; falling back to {page_url}")
            try:
                await page.goto(page_url, wait_until="domcontentloaded",
                                timeout=SCRAPE_TIMEOUT_SEC * 1000)
            except Exception as e2:
                logger.warning(f"FB fallback goto {page_url}: {e2}")
                return []

        # Initial load — wait for first GraphQL burst
        await page.wait_for_timeout(5000)

        # Scroll to trigger paginated GraphQL loads. Stop when no new posts
        # for several consecutive scrolls.
        no_new = 0
        for scroll_i in range(1, 11):
            prev = len(all_posts)
            try:
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            except Exception:
                break
            await page.wait_for_timeout(3000)
            if len(all_posts) == prev:
                no_new += 1
                if no_new >= 3:
                    break
            else:
                no_new = 0
            if len(all_posts) >= MAX_POSTS_PER_PAGE * 2:
                break

        # Resolve live page name (for author-mismatch debugging only; the
        # GraphQL path doesn't strictly need it)
        try:
            page_name = await page.evaluate("""() => {
                const h1 = document.querySelector('h1');
                if (h1) return (h1.innerText || '').trim();
                const og = document.querySelector('meta[property="og:title"]');
                if (og) return (og.getAttribute('content') || '').trim();
                return '';
            }""")
        except Exception:
            page_name = ''
    finally:
        if ctx: await ctx.close()
        if pw: await pw.stop()

    # Sort by timestamp desc, then shape to the existing post dict format
    raw_posts = list(all_posts.values())
    raw_posts.sort(key=lambda p: p.get("timestamp", 0), reverse=True)

    out: list[dict] = []
    for rp in raw_posts[:MAX_POSTS_PER_PAGE]:
        text = (rp.get("text") or "").strip()
        if not text or len(text) < 4:
            continue
        ts = rp.get("timestamp", 0) or 0
        posted_at = datetime.fromtimestamp(ts).isoformat() if ts else ""
        url = rp.get("url") or f"https://www.facebook.com/{_page_id_from_url(page_url)}/posts/{rp['id']}"
        out.append({
            "url": url,
            "text": text,
            "posted_at": posted_at,
            "reactions": 0,
            "comments": 0,
            "shares": 0,
        })

    logger.info(f"FB scrape {page_url}: intercepted {len(all_posts)} graphql posts, kept {len(out)}")
    debug = {
        "graphql_posts": len(all_posts),
        "kept": len(out),
        "page_name": page_name,
    }
    for p in out:
        if page_name:
            p["_page_name_live"] = page_name
    if out:
        out[0]["_debug"] = debug
    return out


def _post_id_from(raw_url: str) -> str:
    """Derive a stable post ID from the permalink."""
    if not raw_url:
        return ""
    # Keep query for /photo/?fbid=... style URLs so the fbid is the key
    if "fbid=" in raw_url:
        import urllib.parse as up
        q = up.parse_qs(up.urlparse(raw_url).query)
        fbid = q.get("fbid", [None])[0]
        if fbid:
            return f"fbid_{fbid}"
    base = raw_url.split("?")[0].rstrip("/")
    tail = base.rsplit("/", 1)[-1]
    if tail in ("photo", "photos", "posts", ""):
        # Not a usable ID — fall back to full URL hash
        import hashlib
        return hashlib.sha1(raw_url.encode()).hexdigest()[:24]
    return tail


def _parse_posted_at(label: str) -> str:
    """
    Best effort: FB abbr title is like 'Monday, April 18, 2026 at 7:12 AM'.
    Fall back to the raw label.
    """
    if not label:
        return ""
    # Try common formats
    for fmt in (
        "%A, %B %d, %Y at %I:%M %p",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M",
    ):
        try:
            return datetime.strptime(label, fmt).isoformat()
        except ValueError:
            continue
    return label[:120]


# ── Page CRUD ─────────────────────────────────────────────────────────────────

def list_pages() -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, url, name, kind, enabled, created_at FROM fb_pages ORDER BY created_at DESC"
        ).fetchall()
        return [{**dict(r), "enabled": bool(r["enabled"])} for r in rows]
    finally:
        conn.close()


def add_page(url_or_handle: str, custom_name: str | None = None) -> dict:
    meta = resolve_page(url_or_handle)
    if not meta:
        raise ValueError(f"無法解析 Facebook 專頁：{url_or_handle}（可能是網址錯誤、專頁不存在、或當前未登入）")
    pid = meta["id"]
    conn = get_connection()
    try:
        existing = conn.execute("SELECT id FROM fb_pages WHERE id = ?", (pid,)).fetchone()
        if existing:
            raise ValueError(f"專頁已存在：{meta['name']} ({pid})")
        conn.execute(
            "INSERT INTO fb_pages (id, url, name, kind, enabled) VALUES (?, ?, ?, ?, 1)",
            (pid, meta["url"], custom_name or meta["name"], meta["kind"]),
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": pid, "url": meta["url"], "name": custom_name or meta["name"], "kind": meta["kind"]}


def delete_page(page_id: str) -> bool:
    conn = get_connection()
    try:
        res = conn.execute("DELETE FROM fb_pages WHERE id = ?", (page_id,))
        conn.execute("DELETE FROM fb_posts WHERE page_id = ?", (page_id,))
        conn.commit()
        return res.rowcount > 0
    finally:
        conn.close()


def set_page_enabled(page_id: str, enabled: bool) -> bool:
    conn = get_connection()
    try:
        res = conn.execute(
            "UPDATE fb_pages SET enabled = ? WHERE id = ?",
            (1 if enabled else 0, page_id),
        )
        conn.commit()
        return res.rowcount > 0
    finally:
        conn.close()


# ── Refresh + feed ────────────────────────────────────────────────────────────

_refresh_lock = threading.Lock()


# ── Gemini analysis (mirrors KOL pipeline) ────────────────────────────────────

_FB_ANALYSIS_PROMPT = """\
以下是一篇財經 KOL 在 Facebook 發的貼文。請根據內文做三件事：

1. 用繁體中文寫一段 **1-2 句話**（不超過 80 字）摘要，抓住作者主要觀點或建議。
2. 列出被明確討論（不只是一句帶過）的所有台股，每檔註明：
   symbol（4 碼股號，或 4 碼+ -KY）
   name（公司中文名）
   sentiment："bullish" / "bearish" / "neutral"
   rationale：10-25 字的簡短原因
3. overall_sentiment：整篇貼文對大盤/個股的整體態度 "bullish" / "bearish" / "neutral"

回傳純 JSON（不要 markdown 圍欄）：
{
  "summary": "1-2 句話摘要",
  "overall_sentiment": "bullish|bearish|neutral",
  "stocks": [
    {"symbol":"2330","name":"台積電","sentiment":"bullish","rationale":"..."}
  ]
}

若貼文與台股無關，stocks 回 []、overall_sentiment 回 "neutral"。
只回傳 JSON。
"""


def _load_stock_universe() -> tuple[dict[str, str], dict[str, str]]:
    """
    Return two lookups built from the stocks table:
      by_symbol: {symbol → canonical_name}
      by_name:   {canonical_name → symbol}
    Used to validate / correct LLM-produced (symbol, name) pairs so
    hallucinated codes like "2444 京元電" (real: 2444 睿能創意) don't leak through.
    """
    conn = get_connection()
    try:
        rows = conn.execute("SELECT symbol, name FROM stocks").fetchall()
    finally:
        conn.close()
    by_symbol = {r["symbol"]: r["name"] for r in rows if r["symbol"]}
    by_name = {r["name"]: r["symbol"] for r in rows if r["name"]}
    return by_symbol, by_name


def _validate_stock_entry(raw_sym: str, raw_name: str,
                          by_symbol: dict[str, str],
                          by_name: dict[str, str]) -> tuple[str, str] | None:
    """
    Decide what (symbol, name) to keep for one LLM-produced entry.
    Priority:
      1. If symbol exists in DB and its canonical name == LLM name → accept.
      2. If symbol exists but name mismatches → trust the DB name.
      3. If symbol doesn't exist but the name matches a DB stock → use the DB
         symbol instead (fixes the hallucinated-code case).
      4. Otherwise drop the entry.
    """
    sym = (raw_sym or "").strip()
    name = (raw_name or "").strip()

    if sym in by_symbol:
        return sym, by_symbol[sym]   # trust DB's canonical name

    if name and name in by_name:
        return by_name[name], name   # symbol was wrong, but name identifies the stock

    return None


def _parse_fb_llm_response(raw: str) -> dict:
    import re as _re
    raw = _re.sub(r"^```(?:json)?\s*", "", (raw or "").strip(), flags=_re.MULTILINE)
    raw = _re.sub(r"\s*```$", "", raw, flags=_re.MULTILINE)
    try:
        obj = json.loads(raw)
    except Exception as e:
        logger.warning(f"_parse_fb_llm_response: {e} — raw head={raw[:200]!r}")
        return {"summary": "", "overall_sentiment": "neutral", "stocks": []}

    by_symbol, by_name = _load_stock_universe()
    stocks = []
    seen_syms: set[str] = set()
    dropped: list[str] = []
    valid_sent = {"bullish", "bearish", "neutral"}

    for s in obj.get("stocks", []) or []:
        if not isinstance(s, dict):
            continue
        validated = _validate_stock_entry(
            s.get("symbol", ""), s.get("name", ""), by_symbol, by_name
        )
        if validated is None:
            dropped.append(f"{s.get('symbol','')}|{s.get('name','')}")
            continue
        sym, canonical_name = validated
        if sym in seen_syms:
            continue  # same stock mentioned twice — keep first
        seen_syms.add(sym)
        sent = s.get("sentiment") if s.get("sentiment") in valid_sent else "neutral"
        stocks.append({
            "symbol": sym,
            "name":   canonical_name,
            "sentiment": sent,
            "rationale": str(s.get("rationale", "")).strip()[:120],
        })

    if dropped:
        logger.info(f"FB LLM: dropped {len(dropped)} hallucinated entries: {dropped[:5]}")

    overall = obj.get("overall_sentiment") if obj.get("overall_sentiment") in valid_sent else "neutral"
    return {
        "summary": str(obj.get("summary", "")).strip()[:300],
        "overall_sentiment": overall,
        "stocks": stocks,
    }


def _analyse_post_with_gemini(content: str, page_name: str = "",
                              max_retries: int = 3) -> dict:
    """Analyse one FB post via Gemini with 429-aware retry."""
    if not content or not content.strip():
        return {"summary": "", "overall_sentiment": "neutral", "stocks": [],
                "summariser": "none"}
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return {"summary": "Gemini 金鑰未設定，請前往 Settings 填入",
                "overall_sentiment": "neutral", "stocks": [],
                "summariser": "unconfigured"}

    from google import genai as genai_sdk
    client = genai_sdk.Client(api_key=key)
    prompt = f"{_FB_ANALYSIS_PROMPT}\n\n專頁：{page_name}\n\n貼文內容：\n{content[:4000]}"
    # Flash-lite has a far higher daily free-tier budget than flash
    # (1500/day vs 20/day). Fine for short FB posts.
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")

    for attempt in range(max_retries):
        try:
            resp = client.models.generate_content(model=model, contents=prompt)
            result = _parse_fb_llm_response(resp.text or "")
            result["summariser"] = "gemini"
            return result
        except Exception as e:
            msg = str(e)
            is_quota = "429" in msg or "RESOURCE_EXHAUSTED" in msg
            # A DAILY-quota 429 won't recover by retrying (only midnight UTC
            # reset helps), so give up immediately to not burn attempts
            is_daily_quota = is_quota and "PerDay" in msg
            if is_quota and not is_daily_quota and attempt < max_retries - 1:
                import re as _re
                m = (_re.search(r"retryDelay['\"]?\s*:\s*['\"](\d+)s", msg)
                     or _re.search(r"retry[^\d]+(\d+)\s*(?:s|sec)", msg, _re.IGNORECASE))
                wait = int(m.group(1)) + 3 if m else 30
                wait = max(wait, 13)
                logger.warning(f"Gemini 429 (per-min) — waiting {wait}s (attempt {attempt+1}/{max_retries})")
                time.sleep(wait)
                continue
            if is_daily_quota:
                logger.warning(f"Gemini 429 (DAILY quota exhausted — stops until UTC midnight)")
                return {"summary": "今日 Gemini 免費配額已用完，請明天再試或換 flash-lite / 付費",
                        "overall_sentiment": "neutral", "stocks": [],
                        "summariser": "quota_exhausted"}
            logger.warning(f"FB analyse gemini error: {e}")
            return {"summary": f"分析失敗：{e}", "overall_sentiment": "neutral",
                    "stocks": [], "summariser": "error"}
    return {"summary": "分析失敗：超過重試次數", "overall_sentiment": "neutral",
            "stocks": [], "summariser": "error"}


def _persist_posts(page_id: str, page_name: str, posts: list[dict]) -> int:
    now = datetime.now().isoformat()
    conn = get_connection()
    n = 0
    try:
        # Pre-load successfully analysed post_ids so we don't re-spend tokens
        rows = conn.execute(
            "SELECT post_id, summariser FROM fb_posts WHERE page_id = ?",
            (page_id,),
        ).fetchall()
        already_analysed: dict[str, str] = {r["post_id"]: (r["summariser"] or "") for r in rows}

        for p in posts:
            p.pop("_debug", None)
            p.pop("_page_name_live", None)
            post_id = _post_id_from(p.get("url", ""))
            if not post_id:
                continue

            # Skip re-analysing if we already have a successful Gemini result
            prior = already_analysed.get(post_id, "")
            if prior == "gemini":
                analysis = None  # don't overwrite
            else:
                content = p.get("text", "") or ""
                analysis = _analyse_post_with_gemini(content, page_name)
                time.sleep(13)  # 5 RPM free-tier budget

            if analysis is not None:
                conn.execute(
                    """INSERT OR REPLACE INTO fb_posts
                       (post_id, page_id, page_name, content, posted_at, url,
                        images_json, reactions_count, comments_count, processed_at,
                        summary, stocks_json, overall_sentiment, summariser)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (post_id, page_id, page_name,
                     p.get("text", ""), _parse_posted_at(p.get("posted_at", "")),
                     p.get("url", ""), json.dumps(p.get("images", []), ensure_ascii=False),
                     int(p.get("reactions", 0) or 0), int(p.get("comments", 0) or 0), now,
                     analysis.get("summary", ""),
                     json.dumps(analysis.get("stocks", []), ensure_ascii=False),
                     analysis.get("overall_sentiment", "neutral"),
                     analysis.get("summariser", "")),
                )
            else:
                # Update only the scraped fields, preserve prior analysis
                conn.execute(
                    """UPDATE fb_posts
                       SET content = ?, posted_at = ?, url = ?, images_json = ?,
                           reactions_count = ?, comments_count = ?, processed_at = ?,
                           page_name = ?
                       WHERE post_id = ?""",
                    (p.get("text", ""), _parse_posted_at(p.get("posted_at", "")),
                     p.get("url", ""), json.dumps(p.get("images", []), ensure_ascii=False),
                     int(p.get("reactions", 0) or 0), int(p.get("comments", 0) or 0), now,
                     page_name, post_id),
                )
            n += 1
        conn.commit()
    finally:
        conn.close()
    return n


def refresh_all_pages(days: int = 7) -> dict:
    """Scrape every enabled page serially and persist posts."""
    if not _refresh_lock.acquire(blocking=False):
        return {"status": "already_running"}
    try:
        pages = [p for p in list_pages() if p["enabled"]]
        if not pages:
            return {"pages": 0, "new_posts": 0, "failed": []}

        total = 0
        failed: list[str] = []
        for pg in pages:
            try:
                posts = _run_playwright_async(_fetch_posts_async(pg["url"], days, pg["name"]))

                # Choose the best page name. Prefer live-scraped, but reject
                # known-bad values that come from FB UI chrome (notification
                # popups, navigation headers, etc.) intercepting og:title.
                live = next((p.get("_page_name_live") for p in posts if p.get("_page_name_live")), None)
                bad_names = {
                    "通知", "Notifications", "Facebook", "首頁", "Home",
                    "Watch", "Marketplace", "Messenger", "動態消息", "News Feed",
                }
                name = live if live and live not in bad_names else pg["name"]
                if live and name != pg["name"] and live not in bad_names:
                    conn = get_connection()
                    try:
                        conn.execute("UPDATE fb_pages SET name = ? WHERE id = ?", (name, pg["id"]))
                        conn.commit()
                    finally:
                        conn.close()
                total += _persist_posts(pg["id"], name, posts)
            except Exception as e:
                logger.error(f"refresh FB {pg['url']}: {e}")
                failed.append(pg["id"])
            time.sleep(2.5)  # polite
        return {"pages": len(pages), "new_posts": total, "failed_pages": failed}
    finally:
        _refresh_lock.release()


async def _scrape_debug_async(url: str, known_name: str = "") -> dict:
    """Re-run the GraphQL-intercept scraper and return everything captured."""
    posts = await _fetch_posts_async(url, days=7, known_name=known_name)
    # Pull debug payload off the first post if present
    debug = {}
    if posts and isinstance(posts[0], dict):
        debug = posts[0].pop("_debug", {}) or {}
        for p in posts:
            p.pop("_page_name_live", None)
    return {
        "page_name": debug.get("page_name", ""),
        "filter_name": known_name,
        "navigated_url": url,
        "raw": {"posts": posts, "debug": debug},
    }


def scrape_debug(url: str) -> dict:
    """Run the scraper once and return diagnostic info (not persisted).
    Uses the DB's known page name for author filtering when available."""
    # Look up stored name to match refresh behaviour
    conn = get_connection()
    try:
        row = conn.execute("SELECT name FROM fb_pages WHERE url = ?", (url,)).fetchone()
        known_name = row["name"] if row else ""
    finally:
        conn.close()
    try:
        return _run_playwright_async(_scrape_debug_async(url, known_name))
    except Exception as e:
        return {"error": str(e)}


def clear_all_posts() -> int:
    """Wipe the fb_posts cache — used when you've fixed the scraper and want
    to re-scrape cleanly. Returns the number of rows removed."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT COUNT(*) FROM fb_posts").fetchone()
        n = row[0] if row else 0
        conn.execute("DELETE FROM fb_posts")
        conn.commit()
        return n
    finally:
        conn.close()


def get_feed(days: int = 7, limit: int = 100) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT post_id, page_id, page_name, content, posted_at, url,
                      images_json, reactions_count, comments_count, processed_at,
                      summary, stocks_json, overall_sentiment, summariser
               FROM fb_posts
               ORDER BY CASE WHEN posted_at='' THEN processed_at ELSE posted_at END DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try: d["images"] = json.loads(d.pop("images_json") or "[]")
            except Exception: d["images"] = []
            try: d["stocks"] = json.loads(d.pop("stocks_json") or "[]")
            except Exception: d["stocks"] = []
            out.append(d)
        return out
    finally:
        conn.close()


def reanalyse_all_posts(force: bool = False) -> dict:
    """
    Run Gemini analysis on stored posts.
    - force=False (default): only posts without a successful gemini analysis
      (summariser != "gemini"). Cheapest, skips cached results.
    - force=True: re-analyse every post regardless (burns quota — only use
      after prompt / stock-universe changes when cached answers are stale).
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT post_id, page_name, content, summariser FROM fb_posts"
        ).fetchall()
    finally:
        conn.close()

    analysed = 0
    skipped = 0
    for r in rows:
        content = r["content"] or ""
        if not content.strip():
            continue
        prior = (r["summariser"] or "").strip()
        if not force and prior == "gemini":
            skipped += 1
            continue
        analysis = _analyse_post_with_gemini(content, r["page_name"] or "")
        conn2 = get_connection()
        try:
            conn2.execute(
                """UPDATE fb_posts
                   SET summary = ?, stocks_json = ?,
                       overall_sentiment = ?, summariser = ?
                   WHERE post_id = ?""",
                (analysis.get("summary", ""),
                 json.dumps(analysis.get("stocks", []), ensure_ascii=False),
                 analysis.get("overall_sentiment", "neutral"),
                 analysis.get("summariser", ""),
                 r["post_id"]),
            )
            conn2.commit()
        finally:
            conn2.close()
        analysed += 1
        time.sleep(13)  # 5 RPM free-tier budget
    logger.info(f"reanalyse_all_posts: analysed={analysed} skipped_cached={skipped} force={force}")
    return {"analysed": analysed, "skipped_cached": skipped, "force": force}
