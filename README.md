# 🛰️ AI 產業鏈股票雷達

專為台股 **AI 伺服器 / 電動車 / 機器人供應鏈** 打造的個人看盤工具：
- 📊 **儀表板**：170+ 檔股票 K 線、MA、KD、三大法人、融資融券、處置股一頁看
- 🔗 **供應鏈地圖**：按產業層 × 題材分組，龍頭股排最左
- 📰 **即時新聞**：每檔股票自動抓 Yahoo 財經新聞
- 🎙️ **理財頻道**：追蹤 YouTube 財經 KOL，AI 自動摘要 + 提取看漲看跌個股
- 🅕 **理財粉專**：追蹤 Facebook 理財專頁貼文，AI 自動分析

---

## 📥 安裝

### 1️⃣ 先裝兩個必要軟體（一次就好）

| 軟體 | 下載 | 注意事項 |
|---|---|---|
| **Python 3.11+** | [python.org/downloads](https://www.python.org/downloads/) | 安裝時 **必勾「Add Python to PATH」** |
| **Node.js LTS** | [nodejs.org](https://nodejs.org/) | 下載 LTS 版，一路下一步即可 |

### 2️⃣ 下載本專案

**A 有裝 Git**
```bat
git clone https://github.com/ryanchen34057/ai-stock-radar-.git
cd ai-stock-radar-
```

**B 沒裝 Git（最簡單）**
1. 打開 [GitHub repo](https://github.com/ryanchen34057/ai-stock-radar-)
2. 右上綠色 **`Code`** → **Download ZIP**
3. 解壓縮到你想放的位置（例如 `C:\ai-stock-radar`）

### 3️⃣ 一鍵安裝

資料夾裡雙擊 **`setup.bat`**（Windows）或在 Terminal 執行 `./setup.sh`（Mac / Linux）。

流程（約 5-10 分鐘）：
- 檢查 Python / Node
- 安裝後端 Python 套件
- 安裝前端套件並編譯成靜態檔
- 下載 Playwright Chromium（粉專抓取用）

### 4️⃣ 啟動

雙擊 **`run.bat`**（Windows）或 `./run.sh`（Mac / Linux）。

自動：
- 啟動後端（新視窗）— 後端同時提供 API 與前端靜態檔
- 瀏覽器開啟 **http://127.0.0.1:8000/**

**第一次啟動**：網頁會出現**安裝進度條**告訴你正在抓第幾檔、哪檔股票（2330 台積電…）。約 **5-15 分鐘** 抓完 170+ 檔的 5 年 K 線、EPS、三大法人等。之後打開都秒開。

---

## 🔧 進階功能設定（選擇性）

### 📊 儀表板 / 供應鏈 / 即時新聞 — **無須設定**
直接開箱即用。

### 🎙️ 理財頻道（YouTube KOL 自動摘要）

需要兩個免費金鑰：

1. **YouTube Data API v3**
   - [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com) → 啟用 API → 建立 API key → 複製
2. **Gemini API**
   - [Google AI Studio](https://aistudio.google.com/app/apikey) → **Create API key** → 複製

網頁右上 **⚙ 設定** → 貼入兩個 key → **模型建議 `gemini-2.5-flash-lite`**（免費每日 1500 次，比 `flash` 的 20 次寬裕）→ 儲存

追蹤頻道：設定頁底下「理財頻道」貼上 URL（例如 `https://www.youtube.com/@奶爸向錢沖`）。

### 🅕 理財粉專（Facebook 貼文 AI 分析）

1. 先完成上面 **Gemini API** 設定
2. **⚙ 設定** → **「開啟瀏覽器登入 Facebook」** → 彈出視窗登入後關閉（cookie 存到 `~/.ai-stock-radar/fb_profile/`）
3. 貼上想追蹤的專頁 URL
4. 回儀表板點右上 **🅕 粉專** → 按「↻ 刷新」

---

## ⏰ 自動更新頻率

開著程式時各區塊會自動更新：

| 區塊 | 頻率 | 來源 |
|---|---|---|
| 📊 股票報價 | 盤中每 5 分鐘 | TWSE MIS 即時報價 |
| 📊 K 線 / EPS | 每晚 18:00 / 20:00 | yfinance + FinMind |
| 📊 三大法人 | 每日 17:30 | TWSE / TPEx 盤後 |
| 🎙️ KOL | 每 5 分鐘 | YouTube API 查新影片 |
| 🅕 FB | 每 15 分鐘 | GraphQL intercept |
| 📰 新聞 | 輪流每 5 分鐘 | Yahoo 財經 |

智慧跳過已分析的貼文/影片，不燒 API 配額。

---

## ❓ 常見問題

**Q: 第一次啟動要跑多久？**
A: 依網路 5-15 分鐘。進度條持續更新，可放著去吃飯。

**Q: Gemini 金鑰要錢嗎？**
A: 免費 tier（flash-lite 每日 1500 次）一般用不完。

**Q: 資料存在哪？**
A: `backend/data/stocks.db`（SQLite）、FB 登入 cookie 在 `~/.ai-stock-radar/`。

**Q: 怎麼加新的股票 / 改產業層 / 題材？**
A: 進程式後右上 **⚙ 設定** → 股票管理。

**Q: 能在手機看嗎？**
A: 同 WiFi 下，手機瀏覽器輸入電腦 IP，例如 `http://192.168.1.10:8000/`。

**Q: 怎麼完全關掉？**
A: 關閉 **Backend** 視窗即可。

---

## 🛠️ 給開發者

- 後端：FastAPI + APScheduler + SQLite，服務進 `backend/app/services/`
- 前端：React + TypeScript + Tailwind + Zustand + Vite
- 排程：`backend/main.py` lifespan
- 資料源：yfinance (K 線), FinMind (季報/股利), TWSE MIS (即時報價), TWSE / TPEx (三大法人), Playwright (FB), YouTube Data API + NotebookLM (KOL)

開發模式（熱重載）：
```bash
# Terminal A
cd backend && python -m uvicorn main:app --reload

# Terminal B
cd frontend && npm run dev
```

授權：MIT
