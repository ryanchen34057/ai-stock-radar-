# 🛰️ AI 產業鏈股票雷達

專為台股 **AI 伺服器 / 電動車 / 機器人供應鏈** 打造的個人看盤工具：
- 📊 **儀表板**：170+ 檔股票 K 線、MA、KD、三大法人、融資融券、處置股一頁看
- 🔗 **供應鏈地圖**：按產業層 × 題材分組，龍頭股排最左
- 📰 **即時新聞**：每檔股票自動抓 Yahoo 財經新聞
- 🎙️ **理財頻道**：追蹤 YouTube 財經 KOL，AI 自動摘要 + 提取看漲看跌個股
- 🅕 **理財粉專**：追蹤 Facebook 理財專頁貼文，AI 自動分析

> **零程式基礎也能用。** 下面是最簡單的安裝步驟。

---

## 📥 安裝（Windows 版，一般使用者）

### 1️⃣ 先安裝兩個必要軟體（一次就好）

| 軟體 | 下載 | 說明 |
|---|---|---|
| **Python 3.11+** | [python.org/downloads](https://www.python.org/downloads/) | 安裝時 **記得勾選「Add Python to PATH」** |
| **Node.js LTS** | [nodejs.org](https://nodejs.org/) | 下載 LTS 版，一路下一步即可 |
| **Git**（選擇性）| [git-scm.com](https://git-scm.com/) | 用來下載本專案，也可直接下載 zip |

### 2️⃣ 下載本專案

**選項 A（有 Git）**
```bat
git clone https://github.com/ryanchen34057/ai-stock-radar-.git
cd ai-stock-radar-
```

**選項 B（沒 Git，最簡單）**
1. 打開 [GitHub repo](https://github.com/ryanchen34057/ai-stock-radar-)
2. 右上綠色 **`Code`** → **Download ZIP**
3. 解壓縮到你想放的位置（例如 `C:\ai-stock-radar`）

### 3️⃣ 跑安裝腳本

在資料夾裡**雙擊** `setup.bat`（Windows）或開 Terminal 跑 `./setup.sh`（Mac / Linux）。

這會自動：
- 檢查 Python / Node 版本
- 安裝後端 Python 套件
- 安裝前端套件並編譯
- 下載 Playwright Chromium（粉專抓取用）

整個過程 **5-10 分鐘**，失敗會告訴你原因。

### 4️⃣ 啟動

雙擊 `run.bat`（Windows）或 `./run.sh`（Mac / Linux）。

會自動：
- 啟動後端（新視窗）
- 啟動前端
- 開啟瀏覽器到 `http://127.0.0.1:5173/`

第一次啟動時，網頁會出現**進度條**告訴你正在抓取第幾檔、哪檔股票。大約 **5-15 分鐘** 會完成全部 170+ 檔股票的 5 年歷史資料、EPS、三大法人等。之後每次打開都幾秒內就顯示。

---

## 🔧 進階功能設定（選擇性）

### 📊 儀表板 / 供應鏈 / 即時新聞 — **無須設定**
直接開箱即用。

### 🎙️ 理財頻道（YouTube KOL 自動摘要）

需要兩個免費金鑰：

1. **YouTube Data API v3**
   - 到 [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
   - 啟用 API、建立 API key → 複製
2. **Gemini API**
   - 到 [Google AI Studio](https://aistudio.google.com/app/apikey)
   - 點 **Create API key** → 複製

在網頁右上角點 **⚙ 設定** → 貼上兩個 key → 儲存

模型建議選 `gemini-2.5-flash-lite`（免費每日 1500 次），比 `flash` 的 20 次餘裕很多。

追蹤頻道：在 **⚙ 設定** 底下的「理財頻道」區塊貼上頻道 URL（例如 `https://www.youtube.com/@奶爸向錢沖`）。

### 🅕 理財粉專（Facebook 貼文 AI 分析）

1. 需先完成上面的 **Gemini API** 設定（同一把 key）
2. 在 **⚙ 設定** 點 **「開啟瀏覽器登入 Facebook」** — 會跳出一個 Chromium 視窗，登入你的 FB 帳號後關閉即可（cookie 會保存在 `~/.ai-stock-radar/fb_profile/`）
3. 在 **⚙ 設定 → Facebook 專頁** 貼上想追蹤的專頁 URL
4. 回儀表板點右上 **🅕 粉專** 開啟面板 → 按「↻ 刷新」

---

## ⏰ 排程與自動更新

開著程式時，各區塊會**自動更新**：

| 區塊 | 頻率 | 說明 |
|---|---|---|
| 📊 股票報價 | 盤中每 5 分鐘 | TWSE MIS 即時報價 |
| 📊 K 線 / EPS | 每晚 18:00 / 20:00 | yfinance + FinMind |
| 📊 三大法人 | 每日 17:30 | TWSE / TPEx 盤後 |
| 🎙️ KOL | 每 5 分鐘 | YouTube API 看有無新影片 |
| 🅕 FB | 每 15 分鐘 | GraphQL intercept 抓新貼文 |
| 📰 新聞 | 輪流每 5 分鐘 | 每次抓一檔股票 |

自動更新會 **智慧跳過已分析過的貼文/影片**，不會重複燒 API 配額。

---

## ❓ 常見問題

**Q: 第一次啟動要跑多久？**
A: 依網路速度 5-15 分鐘。進度條會持續更新，可以放著去喝咖啡。

**Q: 能不能不裝 Playwright？**
A: 可以，只是 FB 粉專功能會停用。YouTube / 股票 / 新聞都正常。

**Q: Gemini 金鑰要錢嗎？**
A: 免費 tier 有每日配額（flash-lite 1500 次 / flash 20 次）。一般使用不會超。

**Q: 股票可以自己加減嗎？**
A: 可以，到設定頁的「股票管理」新增或停用。產業層、題材可以自己填。

**Q: 跑完後如何關掉程式？**
A: 關閉 `Backend` 與 `Frontend` 兩個黑色視窗就完全停止。

**Q: 可以在手機上看嗎？**
A: 如果手機跟電腦連同一個 WiFi，把電腦 IP 輸入手機瀏覽器（例如 `http://192.168.1.10:5173/`）就能用。

---

## 🛠️ 給開發者

詳細架構、資料源說明請看：
- 後端：`backend/app/services/*.py` 各服務有 docstring
- 排程：`backend/main.py` 的 lifespan
- 前端：React + TypeScript + Tailwind + Zustand

開發模式：
```bash
# Terminal A
cd backend && python -m uvicorn main:app --reload

# Terminal B
cd frontend && npm run dev
```

授權：MIT（個人使用）
