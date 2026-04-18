import { useEffect, useRef, useState } from 'react';

interface KeyStatus {
  configured: boolean;
  masked: string;
}

interface SettingsData {
  YOUTUBE_API_KEY: KeyStatus;
  GEMINI_API_KEY: KeyStatus;
  YOUTUBE_CHANNEL_ID: KeyStatus;
}

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
    YOUTUBE_CHANNEL_ID: { configured: false, masked: '' },
  });
  const [ytValue, setYtValue] = useState('');
  const [ytShow, setYtShow] = useState(false);
  const [geminiValue, setGeminiValue] = useState('');
  const [channelIdValue, setChannelIdValue] = useState('');
  const [geminiShow, setGeminiShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = () => {
    setLoading(true);
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: SettingsData) => setData(d))
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
    if (channelIdValue.trim()) body.YOUTUBE_CHANNEL_ID = channelIdValue.trim();

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
      setChannelIdValue('');
      fetchSettings();
    } catch {
      setSaveResult('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveResult(null), 4000);
    }
  };

  const hasChanges = ytValue.trim() !== '' || geminiValue.trim() !== '' || channelIdValue.trim() !== '';

  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<string | null>(null);
  const [pipelineDays, setPipelineDays] = useState(14);
  const wasRunningRef = useRef(false);

  // Poll pipeline status
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/youtube/pipeline-status');
        if (!res.ok || !active) return;
        const json = await res.json();
        const running: boolean = json.running ?? false;
        setPipelineRunning(running);
        if (wasRunningRef.current && !running && json.last_result) {
          const r = json.last_result;
          if (r.error) {
            setPipelineResult(`API 錯誤：${r.error}`);
          } else {
            const found = r.found ?? 0;
            if (found === 0) {
              setPipelineResult(`找不到近 ${pipelineDays} 天的影片，請確認頻道 ID 是否正確`);
            } else if (r.processed === 0) {
              setPipelineResult(`找到 ${found} 支影片，但都已分析過（快取中）`);
            } else {
              const noTs = r.no_transcript ?? 0;
              const parts = [`找到 ${found} 支，分析 ${r.processed} 支`];
              if (noTs > 0) parts.push(`${noTs} 支無字幕`);
              parts.push(`共 ${r.total_mentions} 則股票提及`);
              setPipelineResult(
                r.total_mentions === 0
                  ? `⚠ ${parts.join('、')} — 字幕全部無法取得，或 Gemini 未找到股票提及（請查後端 log）`
                  : `完成：${parts.join('、')}`
              );
            }
          }
        }
        wasRunningRef.current = running;
      } catch {/* ignore */}
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { active = false; clearInterval(id); };
  }, [pipelineDays]);

  const handleRunPipeline = async (clearCache = false) => {
    setPipelineResult(null);
    if (clearCache) {
      await fetch('/api/youtube/cache', { method: 'DELETE' }).catch(() => {});
    }
    try {
      const res = await fetch(`/api/youtube/refresh?days=${pipelineDays}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || '執行失敗');
      if (json.status === 'already_running') {
        setPipelineResult('管道已在執行中，請稍候...');
      } else {
        setPipelineRunning(true);
        wasRunningRef.current = true;
      }
    } catch (e) {
      setPipelineResult(`啟動失敗：${e}`);
    }
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

            <div className="bg-card-bg border border-border-c rounded-lg p-5 space-y-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-text-p">YouTube 頻道 ID</h3>
                  {data.YOUTUBE_CHANNEL_ID.configured ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800">已設定</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400 border border-yellow-800">使用預設值</span>
                  )}
                </div>
                <p className="text-xs text-text-t mt-0.5">
                  要分析的 YouTube 頻道 ID（以 UC 開頭）。可從頻道頁面 URL 取得，例如{' '}
                  <span className="font-mono text-text-s">youtube.com/channel/UCxxxxxxxx</span>
                </p>
              </div>
              {data.YOUTUBE_CHANNEL_ID.configured && !channelIdValue && (
                <div className="text-xs text-text-s font-mono bg-dash-bg border border-border-c rounded px-3 py-2">
                  {data.YOUTUBE_CHANNEL_ID.masked}
                </div>
              )}
              <input
                type="text"
                value={channelIdValue}
                onChange={(e) => setChannelIdValue(e.target.value)}
                placeholder={data.YOUTUBE_CHANNEL_ID.configured ? '輸入新的頻道 ID 以覆蓋' : 'UCxxxxxxxxxxxxxxxxxx'}
                className="w-full bg-dash-bg border border-border-c rounded px-3 py-2 text-sm text-text-p
                           placeholder:text-text-t focus:outline-none focus:border-accent transition-colors font-mono"
              />
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

        {/* YouTube pipeline trigger */}
        <div className="bg-card-bg border border-border-c rounded-lg p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-text-p">立即執行 YouTube 分析</h3>
            <p className="text-xs text-text-t mt-0.5">
              擷取近 7 天「理財達人秀」影片字幕，使用 Gemini 分析後存入資料庫。
              設定 API Key 後需手動執行一次；之後每天 18:30 自動執行。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-s">搜尋近</span>
              <select
                value={pipelineDays}
                onChange={(e) => setPipelineDays(Number(e.target.value))}
                disabled={pipelineRunning}
                className="text-xs bg-dash-bg border border-border-c rounded px-2 py-1 text-text-p
                           focus:outline-none focus:border-accent disabled:opacity-40"
              >
                <option value={7}>7 天</option>
                <option value={14}>14 天</option>
                <option value={30}>30 天</option>
              </select>
            </div>
            <button
              onClick={() => handleRunPipeline(false)}
              disabled={pipelineRunning}
              className="px-5 py-2 text-sm font-medium rounded bg-red-600 text-white
                         hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {pipelineRunning ? '執行中...' : '▶ 立即執行'}
            </button>
            <button
              onClick={() => handleRunPipeline(true)}
              disabled={pipelineRunning}
              title="清除所有已分析的快取，強制重新分析所有影片"
              className="px-4 py-2 text-sm font-medium rounded border border-border-c text-text-s
                         hover:border-red-500 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              清除快取並重新執行
            </button>
            {pipelineRunning && (
              <span className="flex items-center gap-1.5 text-xs text-yellow-400">
                <span className="inline-block w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                影片解析中，請稍候（可能需要 1-2 分鐘）
              </span>
            )}
          </div>
          {pipelineResult && !pipelineRunning && (
            <p className={`text-sm ${pipelineResult.startsWith('API 錯誤') ? 'text-red-400' : pipelineResult.startsWith('找不到') ? 'text-yellow-400' : 'text-green-400'}`}>
              {pipelineResult}
            </p>
          )}
        </div>

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
