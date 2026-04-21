# 🛰️ AI 產業鏈股票雷達

> 台股 AI 伺服器 / 電動車 / 機器人供應鏈看盤工具。170+ 檔股票 K 線、三大法人、融資融券、AI 自動分析 YouTube 財經 KOL 與 Facebook 粉專貼文。

---

## 📥 超詳細安裝（一步一步跟著做，約 15 分鐘）

> 💡 假設你**沒有任何程式基礎**。照著做即可，中間要等待的時候去倒杯水。

### 🧭 步驟 1：安裝 Python（程式語言執行環境）

1. 打開 **<https://www.python.org/downloads/>**
2. 點最上方那個黃色大按鈕 **`Download Python 3.x.x`**
3. 下載完執行它
4. ⚠️ **非常重要**：安裝第一個畫面底部有一個 checkbox **`Add python.exe to PATH`**，**一定要打勾**再按 Install Now。如果沒勾到後面會失敗。
5. 看到「Setup was successful」就是裝完了，按 Close

### 🧭 步驟 2：安裝 Node.js（前端需要）

1. 打開 **<https://nodejs.org/>**
2. 點左邊那顆綠色的按鈕 **`X.XX.X LTS`**（不要選 Current，選 LTS）
3. 下載完執行它，一路按 **Next → Next → Install**，不用改任何選項

### 🧭 步驟 3：下載本專案

**最簡單的做法（不需要 Git）：**

1. 打開 **<https://github.com/ryanchen34057/ai-stock-radar->**
2. 找到右上方那顆 **綠色 `Code ▼`** 按鈕，點它
3. 下拉選單最下面有 **`Download ZIP`**，點它
4. 下載的 `ai-stock-radar--master.zip`，**右鍵 → 解壓縮 → 解壓縮全部**
5. 解壓後會得到一個 `ai-stock-radar--master` 資料夾，放到你想要的位置（例如桌面或 `C:\`）

### 🧭 步驟 4：一鍵安裝

1. 打開剛剛解壓縮好的資料夾
2. 找到裡面的 **`setup.bat`**（圖示是齒輪）
3. **雙擊它**
4. 會跳出黑色視窗開始自動安裝，**不要關掉**
5. 第一次會跑 5-10 分鐘（看網速），會看到它裝：
   - Python 套件
   - 前端套件 & 編譯
   - Playwright 瀏覽器
6. 看到 `Setup complete!` 就是裝完了，按任意鍵關掉

> ⚠️ **如果 Windows SmartScreen 跳出警告**「Windows 已保護你的電腦」：
> 點 **「其他資訊」→「仍要執行」**。這只是因為 .bat 檔沒有數位簽章，不是病毒。

### 🧭 步驟 5：啟動

1. 雙擊 **`run.bat`**
2. 會跳出 **兩個黑色視窗**（Backend + 你看到的這個 launcher）
3. 等幾秒鐘後，**瀏覽器會自動打開** `http://127.0.0.1:8000/`
4. 第一次打開網頁會看到**安裝精靈進度條**，告訴你「正在抓取 第 23 / 170 檔：台積電 2330...」
5. 等 **5-15 分鐘**（看網速）進度條跑完 → 可以開始用

### 🧭 步驟 6：以後怎麼用

**每次要用時**：雙擊 `run.bat`，瀏覽器會自動打開。看完後關掉「Backend」那個黑色視窗就完全停止。

---

## 🎯 基本功能（立即可用，不用設定）

| 功能 | 怎麼看 |
|---|---|
| 📊 儀表板 | 170+ 檔股票的 K 線、MA、KD、即時報價、三大法人 |
| 🔗 供應鏈地圖 | 左上切換 Tab，按產業層 × 題材分組，龍頭股排最左 |
| 📰 即時新聞 | 右上點「📰 新聞」展開面板，自動抓 Yahoo 財經 |

---

## 🔧 進階功能（要設定 API，選擇性）

以下兩個功能需要申請免費 API key，**不設定也不影響上面的基本功能**。

### 🎙️ 理財頻道 — YouTube KOL 自動摘要

**要做的事**：申請兩個免費金鑰，貼到設定頁

#### 申請 YouTube Data API Key
1. 打開 **<https://console.cloud.google.com/apis/library/youtube.googleapis.com>**
2. 沒登入的話先用 Google 帳號登入
3. 上方會叫你「建立專案」— 隨便取名按建立
4. 點藍色的 **`啟用`** 按鈕
5. 左邊選單點 **憑證** → **建立憑證** → **API 金鑰**
6. 會跳出一串像 `AIzaSy...` 的字串，**複製起來**

#### 申請 Gemini API Key
1. 打開 **<https://aistudio.google.com/app/apikey>**
2. 用 Google 帳號登入
3. 點 **`Create API key`** → 選剛剛那個專案 → 建立
4. 複製那串金鑰

#### 貼到設定
1. 在程式右上角點 **⚙ 設定**
2. 把 YouTube key 貼到 YouTube Data API Key 欄位
3. 把 Gemini key 貼到 Google Gemini API Key 欄位
4. **Gemini 分析模型** 選 **`Gemini 2.5 Flash Lite（免費 1500/日 · 推薦）`**
5. 按 **儲存設定**

#### 新增要追蹤的頻道
1. 設定頁往下捲到「理財頻道管理」
2. 在「YouTube 頻道 URL」欄位貼上網址，例如 `https://www.youtube.com/@奶爸向錢沖`
3. 按「新增」
4. 回儀表板，右上 **🎙️ 理財** 開啟面板 → 按 **↻ 刷新** → 等幾分鐘 AI 會分析

### 🅕 理財粉專 — Facebook 貼文 AI 分析

**要做的事**：登入 Facebook 一次、貼上粉專 URL

1. 先完成上面的 **Gemini API** 設定（同一把 key 可共用）
2. ⚙ 設定 → 往下找到 Facebook 區塊 → 點 **「開啟瀏覽器登入 Facebook」**
3. 會跳出一個 Chromium 視窗 → 用你的 Facebook 帳號登入 → **關掉視窗**（cookie 會自動儲存）
4. 設定頁 → 「Facebook 專頁」→ 貼上你想追蹤的專頁 URL，例如：
   ```
   https://www.facebook.com/直雲的投資筆記
   ```
5. 按新增
6. 回儀表板 → 右上 **🅕 粉專** 開啟面板 → 按 **↻ 刷新**

---

## 🚨 遇到問題怎麼辦？

| 症狀 | 可能原因 | 解法 |
|---|---|---|
| `setup.bat` 說 `Python not found` | Python 沒裝，或沒勾 PATH | 重裝 Python，**務必勾 Add to PATH** |
| `setup.bat` 說 `Node.js not found` | Node 沒裝 | 到 nodejs.org 下載 LTS 版 |
| `pip install failed` | 網路問題或被防火牆擋 | 檢查網路、關防毒、換網路重試 |
| Backend 視窗一閃就關 | Python 缺套件 | 重跑 `setup.bat` |
| 瀏覽器打開顯示 Not Found | 前端沒編譯 | 重跑 `setup.bat`（會補編譯） |
| Gemini 429 錯誤 | 免費配額用完 | 等明天 UTC 0 點 reset，或換 flash-lite 模型 |
| 股票沒更新 | 非盤中時間 / 非交易日 | 正常；盤中每 5 分鐘自動更新 |
| FB 抓不到貼文 | 沒登入 FB 或 cookie 過期 | 設定頁重新點「開啟瀏覽器登入 Facebook」|

**更詳細的診斷**：程式跑起來後開 `http://127.0.0.1:8000/_debug/paths` 會顯示內部路徑狀態，貼給開發者看能快速判斷。

---

## ⏰ 自動更新時間表

開著程式時會**自動更新**，不用手動：

| 區塊 | 多久一次 | 備註 |
|---|---|---|
| 📊 股票即時報價 | **盤中每 5 分鐘** | TWSE MIS，只在週一至五 9:00-13:30 |
| 📊 K 線 / EPS / 營收 | 每晚 18:00 / 20:00 | yfinance + FinMind |
| 📊 三大法人 | 每日 17:30 | TWSE / TPEx 盤後 |
| 📊 處置股 | 每日 07:30 | TWSE / TPEx 公告 |
| 🎙️ KOL 影片 | 每 5 分鐘 | 只有新影片才跑 AI |
| 🅕 FB 貼文 | 每 15 分鐘 | 只有新貼文才跑 AI |
| 📰 新聞 | 每 5 分鐘輪一檔 | 170 檔輪完 ~14 小時 |

**智慧跳過機制**：已分析過的內容不會重複 call Gemini / NotebookLM，免費配額用不完。

---

## 📂 資料放哪？

- **股票資料庫**：`backend/data/stocks.db`（SQLite，可以用 DB Browser for SQLite 打開看）
- **設定**：存在 DB 的 `app_settings` 表
- **FB 登入狀態**：`C:\Users\你\.ai-stock-radar\fb_profile\`

刪除這些檔案 = 重置到預設狀態。

---

## ❓ 常見問題

<details>
<summary><b>Q: 第一次啟動為什麼這麼慢？</b></summary>
<br>
要從零抓 170 檔的 5 年歷史 K 線 + 每檔 EPS + 三大法人 20 日 = 數千筆 API 呼叫，網速好約 5 分鐘，慢點 15 分鐘。進度條會持續更新，跑完就不用再跑了。
</details>

<details>
<summary><b>Q: Gemini / YouTube API 要錢嗎？</b></summary>
<br>
都有免費 tier。<br>
Gemini Flash Lite: 免費每日 1500 次，一般使用用不完。<br>
YouTube Data API: 免費每日 10,000 單位，一次查頻道影片只花 1-2 單位。
</details>

<details>
<summary><b>Q: 程式可以加自己的股票嗎？</b></summary>
<br>
可以。⚙ 設定 → 股票管理 → 新增股票，可以填代號、名稱、所屬產業層、Tier、題材。
</details>

<details>
<summary><b>Q: 可以在手機看嗎？</b></summary>
<br>
可以。手機跟電腦連同一個 WiFi，手機瀏覽器輸入電腦 IP，例如 <code>http://192.168.1.10:8000/</code>（把 192.168.1.10 換成你電腦的 IP）。電腦 IP 在命令提示字元輸入 <code>ipconfig</code> 可查到。
</details>

<details>
<summary><b>Q: 怎麼完全移除？</b></summary>
<br>
直接刪除整個資料夾即可。再刪 <code>C:\Users\你\.ai-stock-radar\</code> 資料夾（FB 登入狀態）。不會留下任何東西在系統裡。
</details>

<details>
<summary><b>Q: 更新版本怎麼辦？</b></summary>
<br>
<b>如果你當初是用 git clone 下載的</b>（推薦）：直接雙擊 <code>update.bat</code>（Mac/Linux 是 <code>./update.sh</code>）。會自動：<br>
&nbsp;&nbsp;① git pull 最新 code<br>
&nbsp;&nbsp;② 偵測 requirements.txt / package.json 有改才會重裝套件（省時間）<br>
&nbsp;&nbsp;③ 重 build 前端<br>
你的 <code>backend/data/stocks.db</code> 完全不會動到。更新完雙擊 <code>run.bat</code> 即可。<br>
<br>
<b>如果你當初是下載 ZIP 的</b>：重下新 ZIP 解壓到旁邊新資料夾，把舊資料夾的 <code>backend/data/stocks.db</code> 複製進去，再跑 <code>setup.bat</code>。以後建議改用 git clone 才能用 <code>update.bat</code>。
</details>

---

## 🛠️ 給開發者

技術棧：
- 後端：FastAPI + APScheduler + SQLite + Playwright
- 前端：React + TypeScript + Tailwind + Zustand + Vite
- 資料源：yfinance, FinMind, TWSE MIS, TWSE / TPEx, YouTube Data API, Gemini, NotebookLM, Playwright (FB)

開發模式（熱重載）：
```bash
# Terminal A
cd backend && python -m uvicorn main:app --reload

# Terminal B
cd frontend && npm run dev
```

各服務的 docstring 在 `backend/app/services/`；排程在 `backend/main.py` 的 `lifespan`。

授權：MIT
