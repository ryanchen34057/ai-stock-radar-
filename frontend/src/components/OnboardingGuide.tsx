import { useState, useEffect } from 'react';

const STORAGE_KEY = 'onboarding_seen_v1';

/**
 * First-run usage guide — shows a modal with the 3 optional feature
 * configurations (YouTube/Gemini for KOL + News, Facebook login for 粉專).
 * Appears automatically until the user clicks "知道了，開始使用".
 */
export function OnboardingGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 text-xs bg-card-bg border border-border-c text-text-s
                   hover:text-accent hover:border-accent rounded-full px-3 py-1.5 shadow-lg"
        title="再次顯示使用說明"
      >
        ? 使用說明
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="max-w-2xl w-full bg-card-bg border border-border-c rounded-xl shadow-2xl my-8">
        {/* Header */}
        <div className="p-5 border-b border-border-c flex items-start gap-3">
          <div className="text-3xl">🛰️</div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-text-p">歡迎使用 AI 產業鏈股票雷達</h2>
            <p className="text-sm text-text-s mt-1">
              📊 股票資料與三大法人等功能 <strong className="text-accent">不用任何設定</strong>，開箱即用。
              以下幾個進階功能需要各自申請 API 才能啟用：
            </p>
          </div>
          <button onClick={dismiss} className="text-text-t hover:text-text-p text-xl">✕</button>
        </div>

        {/* Feature sections */}
        <div className="p-5 space-y-4">

          <Section
            icon="📊"
            title="儀表板 / 供應鏈地圖"
            status="ready"
            statusText="立即可用"
          >
            <p>開啟即顯示所有股票 K 線、MA、KD、三大法人、融資融券、處置股等資料。</p>
            <p className="text-text-t text-xs mt-1">
              第一次啟動會花 5-15 分鐘把全部股票歷史資料抓完 — 進度條會告訴你到哪了。
            </p>
          </Section>

          <Section
            icon="🎙️"
            title="理財頻道（YouTube KOL 自動摘要）"
            status="needs-config"
            statusText="需要設定"
          >
            <p>抓取你追蹤的 YouTube 理財頻道影片，用 AI 自動摘要 + 提取個股看漲看跌。</p>
            <ol className="list-decimal list-inside text-xs text-text-s mt-2 space-y-1">
              <li>
                到 <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                       target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Google Cloud Console
                </a> 申請 <strong>YouTube Data API v3</strong> 金鑰（免費，10 分鐘內搞定）
              </li>
              <li>
                到 <a href="https://aistudio.google.com/app/apikey"
                       target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Google AI Studio
                </a> 申請 <strong>Gemini API</strong> 金鑰（免費）
              </li>
              <li>點右上角 <strong>⚙ 設定</strong> → 貼上兩個 key → 按「儲存設定」</li>
              <li>回儀表板點 <strong>🎙️ 理財</strong> 開啟面板 → 到設定頁新增頻道 URL → 按「↻ 刷新」</li>
            </ol>
          </Section>

          <Section
            icon="🅕"
            title="理財粉專（Facebook 貼文 AI 分析）"
            status="needs-config"
            statusText="需要設定"
          >
            <p>抓取 Facebook 理財專頁的最新貼文，用 Gemini 自動分析提到的個股與看漲看跌。</p>
            <ol className="list-decimal list-inside text-xs text-text-s mt-2 space-y-1">
              <li>必須先完成上面「理財頻道」的 Gemini 設定（同一把 key）</li>
              <li>⚙ 設定 → <strong>「開啟瀏覽器登入 Facebook」</strong>（彈出的視窗登入後關閉即可）</li>
              <li>⚙ 設定 → <strong>Facebook 專頁</strong>：貼上想追蹤的專頁 URL，例如
                <code className="text-accent font-mono ml-1">https://www.facebook.com/直雲的投資筆記</code></li>
              <li>回儀表板點 <strong>🅕 粉專</strong> 開啟面板 → 按「↻ 刷新」</li>
            </ol>
          </Section>

          <Section
            icon="📰"
            title="即時新聞"
            status="ready"
            statusText="立即可用"
          >
            <p>免申請 API，自動從 Yahoo 財經抓取每檔股票的最新新聞，每 N 分鐘輪流更新一檔。</p>
          </Section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-c flex items-center justify-between bg-dash-bg/30 rounded-b-xl">
          <span className="text-xs text-text-t">
            💡 之後右下角會有「? 使用說明」按鈕可重新打開
          </span>
          <button
            onClick={dismiss}
            className="px-5 py-2 bg-accent text-black font-bold rounded hover:bg-accent/90 transition-colors"
          >
            知道了，開始使用 →
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, status, statusText, children }: {
  icon: string;
  title: string;
  status: 'ready' | 'needs-config';
  statusText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-dash-bg/40 border border-border-c rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="text-2xl flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-bold text-text-p">{title}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
              status === 'ready'
                ? 'bg-tw-up/20 text-tw-up border border-tw-up/40'
                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
            }`}>
              {statusText}
            </span>
          </div>
          <div className="text-sm text-text-s leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
