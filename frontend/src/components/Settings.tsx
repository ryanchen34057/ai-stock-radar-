import { useEffect, useState } from 'react';
import { useNewsRefreshInterval, NEWS_REFRESH_LIMITS } from '../hooks/useNewsRefreshInterval';
import { useKolChannels } from '../hooks/useKolFeed';
import { useFbPages } from '../hooks/useFbFeed';

interface KeyStatus {
  configured: boolean;
  masked: string;
}

interface SettingsData {
  YOUTUBE_API_KEY: KeyStatus;
  GEMINI_API_KEY: KeyStatus;
  FINMIND_TOKEN: KeyStatus;
  GEMINI_MODEL?: KeyStatus;  // in _PLAIN_KEYS, .masked holds the raw value
}

const GEMINI_MODEL_OPTIONS = [
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite（免費 1500/日 · 推薦）' },
  { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash（免費 20/日 · 較強推理）' },
  { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro（需付費 · 最強）' },
];

interface KeyFieldProps {
  label: string;
  description: string;
  helpUrl: string;
  configured: boolean;
  masked: string;
  value: string;
  show: boolean;
  onChange: (v: string) => void;
  onToggleShow: () => void;
}

function KeyField({
  label, description, helpUrl, configured, masked, value, show, onChange, onToggleShow,
}: KeyFieldProps) {
  return (
    <div className="bg-card-bg border border-border-c rounded-lg p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-p">{label}</h3>
            {configured ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800">
                已設定
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400 border border-yellow-800">
                未設定
              </span>
            )}
          </div>
          <p className="text-xs text-text-t mt-0.5">{description}</p>
        </div>
        <a
          href={helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-accent hover:underline whitespace-nowrap flex-shrink-0"
        >
          取得 API Key →
        </a>
      </div>

      {configured && !value && (
        <div className="text-xs text-text-s font-mono bg-dash-bg border border-border-c rounded px-3 py-2">
          {masked}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={configured ? '輸入新的 Key 以覆蓋現有設定' : '貼上您的 API Key'}
          className="flex-1 bg-dash-bg border border-border-c rounded px-3 py-2 text-sm text-text-p
                     placeholder:text-text-t focus:outline-none focus:border-accent transition-colors font-mono"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="px-3 py-2 text-xs text-text-s border border-border-c rounded hover:border-accent
                     hover:text-text-p transition-colors bg-dash-bg"
          title={show ? '隱藏' : '顯示'}
        >
          {show ? '隱藏' : '顯示'}
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const [data, setData] = useState<SettingsData>({
    YOUTUBE_API_KEY: { configured: false, masked: '' },
    GEMINI_API_KEY: { configured: false, masked: '' },
    FINMIND_TOKEN:   { configured: false, masked: '' },
  });
  const [ytValue, setYtValue] = useState('');
  const [ytShow, setYtShow] = useState(false);
  const [geminiValue, setGeminiValue] = useState('');
  const [geminiShow, setGeminiShow] = useState(false);
  const [finmindValue, setFinmindValue] = useState('');
  const [finmindShow, setFinmindShow] = useState(false);
  const [geminiModel, setGeminiModel] = useState<string>('gemini-2.5-flash-lite');
  const [modelDirty, setModelDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = () => {
    setLoading(true);
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: SettingsData) => {
        setData(d);
        const currentModel = d.GEMINI_MODEL?.masked;
        if (currentModel) {
          setGeminiModel(currentModel);
          setModelDirty(false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    const body: Record<string, string> = {};
    if (ytValue.trim()) body.YOUTUBE_API_KEY = ytValue.trim();
    if (geminiValue.trim()) body.GEMINI_API_KEY = geminiValue.trim();
    if (finmindValue.trim()) body.FINMIND_TOKEN = finmindValue.trim();
    if (modelDirty) body.GEMINI_MODEL = geminiModel;

    if (Object.keys(body).length === 0) return;

    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setSaveResult('ok');
      setYtValue('');
      setGeminiValue('');
      setFinmindValue('');
      setModelDirty(false);
      fetchSettings();
    } catch {
      setSaveResult('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveResult(null), 4000);
    }
  };

  const hasChanges = ytValue.trim() !== '' || geminiValue.trim() !== ''
                   || finmindValue.trim() !== '' || modelDirty;

  const [refreshIntervalMin, setRefreshIntervalMin] = useNewsRefreshInterval();
  const [refreshInput, setRefreshInput] = useState<string>(String(refreshIntervalMin));
  // Keep input in sync when the stored value changes (e.g. in another tab)
  useEffect(() => { setRefreshInput(String(refreshIntervalMin)); }, [refreshIntervalMin]);

  const commitRefreshInterval = () => {
    const n = parseInt(refreshInput, 10);
    setRefreshIntervalMin(isNaN(n) ? NEWS_REFRESH_LIMITS.default : n);
  };

  return (
    <div className="min-h-full bg-dash-bg p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-text-p">API 設定</h1>
          <p className="text-sm text-text-t mt-1">
            設定第三方 API 金鑰以啟用 YouTube 影片分析功能。金鑰儲存於後端資料庫，不會外洩至瀏覽器。
          </p>
        </div>

        {loading ? (
          <div className="text-sm text-text-t">載入中...</div>
        ) : (
          <div className="space-y-4">
            <KeyField
              label="YouTube Data API Key"
              description="用於從「理財達人秀」頻道獲取最新影片資料（YouTube Data API v3）"
              helpUrl="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
              configured={data.YOUTUBE_API_KEY.configured}
              masked={data.YOUTUBE_API_KEY.masked}
              value={ytValue}
              show={ytShow}
              onChange={setYtValue}
              onToggleShow={() => setYtShow((p) => !p)}
            />

            <KeyField
              label="Google Gemini API Key"
              description="用於 AI 分析影片字幕、提取台股代號與摘要（Gemini 1.5 Flash）"
              helpUrl="https://aistudio.google.com/app/apikey"
              configured={data.GEMINI_API_KEY.configured}
              masked={data.GEMINI_API_KEY.masked}
              value={geminiValue}
              show={geminiShow}
              onChange={setGeminiValue}
              onToggleShow={() => setGeminiShow((p) => !p)}
            />

            <KeyField
              label="FinMind Token"
              description="景氣燈號的「海關出口 / 外銷訂單」月頻指標、以及部分 EPS 資料透過 FinMind 取得。免費註冊即可得 Token，每日 300 次 quota 夠用。設定後需重啟後端。"
              helpUrl="https://finmindtrade.com/analysis/#/data/api"
              configured={data.FINMIND_TOKEN.configured}
              masked={data.FINMIND_TOKEN.masked}
              value={finmindValue}
              show={finmindShow}
              onChange={setFinmindValue}
              onToggleShow={() => setFinmindShow((p) => !p)}
            />

            <div className="bg-card-bg border border-border-c rounded-lg p-5 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-text-p">Gemini 分析模型</h3>
                <p className="text-xs text-text-t mt-0.5">
                  選擇用來分析 FB 貼文 / KOL 影片字幕的模型。免費配額依模型而異 —
                  若遇到每日 429 配額上限，建議換成 Flash Lite。
                </p>
              </div>
              <select
                value={geminiModel}
                onChange={(e) => { setGeminiModel(e.target.value); setModelDirty(true); }}
                className="w-full bg-dash-bg border border-border-c rounded px-3 py-2 text-sm text-text-p
                           focus:outline-none focus:border-accent transition-colors"
              >
                {GEMINI_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              {data.GEMINI_MODEL?.masked && (
                <div className="text-xs text-text-s">
                  目前生效：<span className="font-mono text-accent">{data.GEMINI_MODEL.masked}</span>
                </div>
              )}
            </div>

          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="px-5 py-2 text-sm font-medium rounded bg-accent text-white
                       hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '儲存中...' : '儲存設定'}
          </button>

          {saveResult === 'ok' && (
            <span className="text-sm text-green-400">設定已成功儲存</span>
          )}
          {saveResult === 'error' && (
            <span className="text-sm text-red-400">儲存失敗，請稍後再試</span>
          )}
          {!hasChanges && !saving && !saveResult && (
            <span className="text-xs text-text-t">請在上方輸入欄位填入新的 API Key</span>
          )}
        </div>

        {/* News auto-refresh interval */}
        <div className="bg-card-bg border border-border-c rounded-lg p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-text-p">新聞自動刷新</h3>
            <p className="text-xs text-text-t mt-0.5">
              當新聞面板開啟時，每隔多少分鐘重新向後端請求一次新聞列表。
              設為 <span className="font-mono text-text-s">0</span> 可關閉自動刷新；
              範圍 {NEWS_REFRESH_LIMITS.min}–{NEWS_REFRESH_LIMITS.max} 分鐘。
            </p>
            <p className="text-[11px] text-text-t mt-1 leading-relaxed">
              注意：此僅控制<span className="text-text-s">前端重新抓取後端快取</span>的頻率。
              後端對 MOPS / Google News 的實際抓取由排程器（每日 09:00）執行，
              若要強制重新抓取資料來源，請在新聞面板右上角點「全部刷新」。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={NEWS_REFRESH_LIMITS.max}
              value={refreshInput}
              onChange={(e) => setRefreshInput(e.target.value)}
              onBlur={commitRefreshInterval}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-24 bg-dash-bg border border-border-c rounded px-3 py-2 text-sm text-text-p
                         text-center focus:outline-none focus:border-accent transition-colors font-mono"
            />
            <span className="text-xs text-text-s">分鐘 / 次</span>
            <span className="text-xs text-text-t ml-auto">
              目前：
              <span className="text-text-p font-mono ml-1">
                {refreshIntervalMin === 0 ? '已停用' : `每 ${refreshIntervalMin} 分鐘`}
              </span>
            </span>
          </div>
        </div>

        <KolChannelsPanel />

        <FbPagesPanel />

        <div className="bg-card-bg border border-border-c rounded-lg p-4 text-xs text-text-t space-y-1">
          <p className="font-medium text-text-s">注意事項</p>
          <p>• API Key 儲存於後端 SQLite 資料庫，不會傳送至瀏覽器或第三方服務。</p>
          <p>• 重新啟動後端後，DB 內的設定會自動載入，無需重新輸入。</p>
          <p>• 若 .env 檔案也有設定同名變數，DB 的設定將覆蓋 .env 的值。</p>
        </div>
      </div>
    </div>
  );
}

function KolChannelsPanel() {
  const { channels, loading, add, remove, toggle } = useKolChannels();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [nblm, setNblm] = useState<{ available: boolean; authenticated: boolean; message: string } | null>(null);
  const [loginRunning, setLoginRunning] = useState(false);
  const [loginResult, setLoginResult] = useState<string | null>(null);

  const refreshNblmStatus = () => {
    fetch('/api/kol/notebooklm-status').then((r) => r.json()).then(setNblm).catch(() => {});
  };

  useEffect(() => {
    refreshNblmStatus();
    const id = setInterval(() => {
      fetch('/api/kol/notebooklm-login/status').then((r) => r.json()).then((j) => {
        const was = loginRunning;
        setLoginRunning(Boolean(j.running));
        if (was && !j.running) {
          // Login just finished — refresh auth status
          refreshNblmStatus();
          if (j.last_result) {
            const r = j.last_result;
            if (r.returncode === 0) {
              setLoginResult('登入完成，已寫入 cookie');
              setTimeout(() => setLoginResult(null), 5000);
            } else {
              // Show the most informative message available, including CLI log
              const parts: string[] = [];
              if (r.error) parts.push(r.error);
              if (r.auth_message) parts.push(r.auth_message);
              if (r.log) parts.push(`CLI 輸出：\n${r.log}`);
              if (!parts.length) parts.push(`rc=${r.returncode}`);
              setLoginResult(`登入未成功：\n${parts.join('\n')}`);
            }
          }
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginRunning]);

  const triggerLogin = async () => {
    setLoginResult(null);
    setLoginRunning(true);
    try {
      const r = await fetch('/api/kol/notebooklm-login', { method: 'POST' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `HTTP ${r.status}`);
      }
      const j = await r.json();
      if (j.status === 'already_running') {
        setLoginResult('登入流程已在執行中，請查看桌面上的視窗');
      } else {
        setLoginResult(
          '已啟動登入流程，會開兩個視窗：\n' +
          '  1. 黑色 cmd 視窗（顯示指示）\n' +
          '  2. Chromium 瀏覽器（Google 登入）\n\n' +
          '步驟：\n' +
          '  ① 在 Chromium 完成 Google 登入\n' +
          '  ② 等畫面跳到 NotebookLM 首頁\n' +
          '  ③ 切回黑色 cmd 視窗「按 ENTER」才會儲存 cookie\n' +
          '  ④ cmd 視窗可關閉'
        );
      }
    } catch (e) {
      setLoginResult(`啟動失敗：${String(e instanceof Error ? e.message : e)}`);
      setLoginRunning(false);
    }
  };

  const handleAdd = async () => {
    setErr(null);
    setBusy(true);
    try {
      await add(input.trim());
      setInput('');
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async (force = false) => {
    setRefreshMsg(null);
    const r = await fetch(`/api/kol/refresh?days=7&force=${force}`, { method: 'POST' });
    const j = await r.json();
    setRefreshMsg(
      j.status === 'started'
        ? (force
            ? '已在背景重新分析所有影片（每支 NotebookLM 約 2-3 分鐘）'
            : '已在背景分析新影片與未成功摘要的影片')
      : j.status === 'already_running' ? '目前已有分析任務執行中'
      : String(j.status ?? j.detail ?? 'unknown')
    );
    setTimeout(() => setRefreshMsg(null), 5000);
  };

  return (
    <div className="bg-card-bg border border-border-c rounded-lg p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text-p">理財頻道（YouTube）</h3>
        <p className="text-xs text-text-t mt-0.5 leading-relaxed">
          新增要追蹤的財經 YouTuber 頻道。摘要**僅**透過 <span className="text-accent">NotebookLM</span>，
          請先完成下方的 NotebookLM 登入；每支影片約 2–3 分鐘，產出 3 句話總結 + 提及個股 + 看多/看空判斷。
        </p>
        {nblm && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
              nblm.authenticated ? 'bg-green-500'
              : nblm.available ? 'bg-yellow-400' : 'bg-red-500'
            }`} />
            <span className="text-text-s">
              NotebookLM：{nblm.authenticated ? '已登入，將用於摘要'
                        : nblm.available ? '已安裝但未登入'
                        : '未安裝（請 pip install notebooklm-py）'}
            </span>
            {nblm.available && !nblm.authenticated && (
              <button
                onClick={triggerLogin}
                disabled={loginRunning}
                className="ml-auto px-3 py-1 text-xs rounded bg-accent text-white
                           hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="後端會在伺服器機器上開啟 Chromium 視窗，完成 Google 登入後自動存下 cookie"
              >
                {loginRunning ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 border border-white border-t-transparent rounded-full animate-spin" />
                    登入進行中...
                  </span>
                ) : '🔐 開啟瀏覽器登入 NotebookLM'}
              </button>
            )}
            {nblm.available && nblm.authenticated && (
              <button
                onClick={triggerLogin}
                disabled={loginRunning}
                className="ml-auto px-2 py-0.5 text-[10px] rounded border border-border-c text-text-s
                           hover:text-accent hover:border-accent transition-colors"
              >
                重新登入
              </button>
            )}
          </div>
        )}
        {loginResult && (
          <pre className="text-[11px] text-accent mt-1 leading-relaxed whitespace-pre-wrap font-mono
                          bg-dash-bg/40 border border-border-c/40 rounded p-2 max-h-64 overflow-y-auto">
            {loginResult}
          </pre>
        )}
      </div>

      {/* Add form */}
      <div className="flex gap-2">
        <input
          type="text" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="貼上頻道 URL、@handle 或 UC... 頻道 ID"
          onKeyDown={(e) => { if (e.key === 'Enter' && input.trim() && !busy) handleAdd(); }}
          className="flex-1 bg-dash-bg border border-border-c rounded px-3 py-2 text-sm text-text-p
                     placeholder:text-text-t focus:outline-none focus:border-accent font-mono"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !input.trim()}
          className="px-4 py-2 text-xs font-medium rounded bg-accent text-white
                     hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? '解析中...' : '+ 新增'}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}

      {/* Channel list */}
      <div className="space-y-1">
        {loading && <div className="text-xs text-text-t animate-pulse py-2">載入中...</div>}
        {!loading && channels.length === 0 && (
          <div className="text-xs text-text-t py-2">尚未新增頻道。</div>
        )}
        {channels.map((c) => (
          <div key={c.channel_id}
            className={`flex items-center gap-2 px-3 py-2 rounded border border-border-c
                       ${c.enabled ? 'bg-dash-bg/40' : 'bg-dash-bg/20 opacity-60'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-p truncate">{c.name}</span>
                <span className="text-[10px] text-text-t font-mono">{c.channel_id}</span>
              </div>
              {c.description && (
                <div className="text-[11px] text-text-t truncate mt-0.5">{c.description}</div>
              )}
            </div>
            <a href={`https://www.youtube.com/channel/${c.channel_id}`} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-accent hover:underline shrink-0">前往 ↗</a>
            <button
              onClick={() => toggle(c.channel_id, !c.enabled)}
              className={`text-[11px] px-2 py-0.5 rounded border transition-colors shrink-0
                ${c.enabled
                  ? 'bg-green-500/20 text-green-400 border-green-500/40'
                  : 'bg-white/5 text-text-s border-border-c'}`}
            >
              {c.enabled ? '啟用中' : '已停用'}
            </button>
            <button
              onClick={() => { if (confirm(`確定刪除 ${c.name}？`)) remove(c.channel_id); }}
              className="text-[11px] text-red-400 hover:underline shrink-0"
            >
              刪除
            </button>
          </div>
        ))}
      </div>

      {channels.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => handleRefresh(false)}
              className="px-4 py-1.5 text-xs rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors">
              ▶ 分析新影片
            </button>
            <button onClick={() => {
              if (confirm('會重新分析所有近 7 天影片（包括已有摘要的），每支約 2-3 分鐘，確定？')) handleRefresh(true);
            }}
              className="px-4 py-1.5 text-xs rounded border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 transition-colors">
              🔄 強制全部重新分析
            </button>
            {refreshMsg && <span className="text-xs text-green-400">{refreshMsg}</span>}
          </div>
          <p className="text-[11px] text-text-t">
            「分析新影片」會自動挑選新影片與過去摘要失敗的影片；「強制全部」適用於剛換 NotebookLM 或想重新產出摘要時
          </p>
        </div>
      )}
    </div>
  );
}

// ── Facebook pages panel ─────────────────────────────────────────────────────

function FbPagesPanel() {
  const { pages, add, remove, toggle, loading } = useFbPages();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auth, setAuth] = useState<{ available: boolean; authenticated: boolean; message: string } | null>(null);
  const [loginRunning, setLoginRunning] = useState(false);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const refreshAuth = () => {
    fetch('/api/fb/auth-status').then((r) => r.json()).then(setAuth).catch(() => {});
  };
  useEffect(() => {
    refreshAuth();
    const id = setInterval(() => {
      fetch('/api/fb/login-status').then((r) => r.json()).then((j) => {
        const was = loginRunning;
        setLoginRunning(Boolean(j.running));
        if (was && !j.running) {
          refreshAuth();
          if (j.last_result) {
            const r = j.last_result;
            if (r.authenticated) {
              setLoginMsg('Facebook 登入完成');
              setTimeout(() => setLoginMsg(null), 5000);
            } else {
              setLoginMsg(`登入未成功：${r.error || r.message || r.stderr_tail || `rc=${r.returncode}`}`);
            }
          }
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginRunning]);

  const triggerLogin = async () => {
    setLoginMsg(null);
    setLoginRunning(true);
    try {
      await fetch('/api/fb/login', { method: 'POST' });
      setLoginMsg('已開啟 Chromium 視窗，請在其中完成 Facebook 登入；完成後關閉該視窗即可');
    } catch (e) {
      setLoginMsg(`啟動失敗：${e}`);
      setLoginRunning(false);
    }
  };

  const handleAdd = async () => {
    setErr(null);
    setBusy(true);
    try {
      await add(input.trim());
      setInput('');
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshMsg(null);
    const r = await fetch('/api/fb/refresh?days=7', { method: 'POST' });
    const j = await r.json();
    setRefreshMsg(
      j.status === 'started' ? '已在背景開始抓取貼文（每專頁約 5-10 秒）'
      : j.status === 'already_running' ? '目前已有抓取任務執行中'
      : String(j.status ?? j.detail ?? 'unknown')
    );
    setTimeout(() => setRefreshMsg(null), 5000);
  };

  return (
    <div className="bg-card-bg border border-border-c rounded-lg p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text-p">理財粉專（Facebook）</h3>
        <p className="text-xs text-text-t mt-0.5 leading-relaxed">
          新增要追蹤的 Facebook 粉絲專頁或個人專頁。以 Playwright 用你登入的 FB cookie 抓取近期貼文；
          僅限本機個人使用，FB ToS 禁止公開部署此類自動化。
        </p>
        {auth && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
              auth.authenticated ? 'bg-green-500'
              : auth.available ? 'bg-yellow-400' : 'bg-red-500'
            }`} />
            <span className="text-text-s">
              Facebook：{auth.authenticated ? '已登入，可抓取貼文'
                       : auth.available ? '未登入' : '未安裝 Playwright'}
            </span>
            {auth.available && (
              <button
                onClick={triggerLogin}
                disabled={loginRunning}
                className="ml-auto px-3 py-1 text-xs rounded bg-accent text-white
                           hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loginRunning ? '登入中...' : auth.authenticated ? '重新登入' : '🔐 開啟瀏覽器登入 Facebook'}
              </button>
            )}
          </div>
        )}
        {loginMsg && (
          <pre className="text-[11px] text-accent mt-1 leading-relaxed whitespace-pre-wrap font-mono
                          bg-dash-bg/40 border border-border-c/40 rounded p-2 max-h-48 overflow-y-auto">
            {loginMsg}
          </pre>
        )}
      </div>

      {/* Add form */}
      <div className="flex gap-2">
        <input
          type="text" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="貼上 Facebook 專頁 URL（粉絲頁或個人頁都可）"
          onKeyDown={(e) => { if (e.key === 'Enter' && input.trim() && !busy) handleAdd(); }}
          className="flex-1 bg-dash-bg border border-border-c rounded px-3 py-2 text-sm text-text-p
                     placeholder:text-text-t focus:outline-none focus:border-accent font-mono"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !input.trim() || !auth?.authenticated}
          className="px-4 py-2 text-xs font-medium rounded bg-accent text-white
                     hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={!auth?.authenticated ? '請先登入 Facebook' : undefined}
        >
          {busy ? '解析中...' : '+ 新增'}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}

      {/* Page list */}
      <div className="space-y-1">
        {loading && <div className="text-xs text-text-t animate-pulse py-2">載入中...</div>}
        {!loading && pages.length === 0 && <div className="text-xs text-text-t py-2">尚未新增專頁。</div>}
        {pages.map((p) => (
          <div key={p.id}
            className={`flex items-center gap-2 px-3 py-2 rounded border border-border-c
                       ${p.enabled ? 'bg-dash-bg/40' : 'bg-dash-bg/20 opacity-60'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-p truncate">{p.name}</span>
                <span className="text-[10px] text-text-t">{p.kind === 'profile' ? '個人' : '粉專'}</span>
              </div>
              <div className="text-[11px] text-text-t truncate mt-0.5">{p.url}</div>
            </div>
            <a href={p.url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-accent hover:underline shrink-0">前往 ↗</a>
            <button
              onClick={() => toggle(p.id, !p.enabled)}
              className={`text-[11px] px-2 py-0.5 rounded border transition-colors shrink-0
                ${p.enabled
                  ? 'bg-green-500/20 text-green-400 border-green-500/40'
                  : 'bg-white/5 text-text-s border-border-c'}`}
            >
              {p.enabled ? '啟用中' : '已停用'}
            </button>
            <button
              onClick={() => { if (confirm(`確定刪除 ${p.name}？`)) remove(p.id); }}
              className="text-[11px] text-red-400 hover:underline shrink-0"
            >
              刪除
            </button>
          </div>
        ))}
      </div>

      {pages.length > 0 && auth?.authenticated && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <button onClick={handleRefresh}
            className="px-4 py-1.5 text-xs rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors">
            ▶ 立即抓取貼文
          </button>
          <button onClick={async () => {
            if (!confirm('會清除所有已抓取的貼文（專頁設定保留），然後重抓一次。確定？')) return;
            await fetch('/api/fb/posts', { method: 'DELETE' });
            await fetch('/api/fb/refresh?days=7', { method: 'POST' });
            setRefreshMsg('已清除舊快取並重新抓取');
            setTimeout(() => setRefreshMsg(null), 5000);
          }}
            className="px-4 py-1.5 text-xs rounded border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 transition-colors">
            🧹 清除舊快取並重抓
          </button>
          {refreshMsg && <span className="text-xs text-green-400">{refreshMsg}</span>}
          <span className="ml-auto text-[11px] text-text-t">
            每專頁約 5-10 秒
          </span>
        </div>
      )}
    </div>
  );
}
