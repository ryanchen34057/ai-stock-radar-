# AI 產業鏈股票雷達

監控台灣 AI 供應鏈 66 檔關鍵股票的儀表板，涵蓋晶片設計→製造→封測→PCB→散熱電源→光通訊→被動元件→ODM→電力基建完整十層產業鏈。

---

## 功能特色

- **66 檔 AI 供應鏈股票**，依十層產業鏈分類
- **迷你 K 線圖**（最近 60 交易日）+ 均線疊圖
- **均線警示燈**：跌破均線 🔴 / 站上均線 🟢 / 貼線 🟡
- 支援 MA5 / MA10 / MA20 / MA60 / MA120 / MA240 即時切換
- 深色模式（預設）/ 淺色模式切換
- 每日 18:00 自動更新收盤資料
- 鍵盤快捷鍵支援

---

## 環境需求

| 工具 | 最低版本 |
|------|---------|
| Python | 3.10+ |
| Node.js | 18+ |
| npm | 9+ |

---

## 快速啟動（本機開發）

### 方法一：手動啟動（推薦新手）

**Step 1 — 後端初始化（首次執行，約需 5-10 分鐘）**

```bash
cd backend
pip install -r requirements.txt
python -m scripts.init_db
```

> 這個步驟會下載 66 檔股票的歷史 K 線資料，請耐心等待。

**Step 2 — 啟動後端伺服器**

```bash
# 在 backend/ 目錄下
uvicorn main:app --reload --port 8000
```

後端啟動後可瀏覽 http://localhost:8000/docs 查看 API 文件。

**Step 3 — 啟動前端**

```bash
cd frontend
npm install
npm run dev
```

前端啟動後開啟瀏覽器：**http://localhost:5173**

---

### 方法二：Docker Compose（一鍵啟動）

```bash
# 在專案根目錄
docker-compose up --build

# 首次需要初始化資料庫（在另一個終端機）
docker exec stock-radar-backend python -m scripts.init_db
```

---

## 每日更新

後端伺服器運行時，APScheduler 會在每天 **18:00（台灣時間）** 自動爬取當日收盤資料。

手動觸發更新：
```bash
# API 方式
curl -X POST http://localhost:8000/api/refresh

# 或直接執行腳本
cd backend && python -m scripts.daily_update
```

---

## 鍵盤快捷鍵

| 按鍵 | 功能 |
|------|------|
| `R` | 刷新資料 |
| `1`~`9` | 切換第 1-9 層產業篩選 |
| `0` | 切換第 10 層（電力基建）篩選 |
| `M` | 循環切換均線週期 |
| `D` | 切換深色/淺色模式 |
| `A` | 清除所有篩選（顯示全部） |
| `Esc` | 關閉個股詳情視窗 |

---

## 警示燈邏輯

```
股價 > 均線 × 1.01  →  🟢 站上均線（左邊框綠色）
股價 < 均線 × 0.99  →  🔴 跌破均線（左邊框紅色）
其他               →  🟡 貼著均線（左邊框黃色）
```

---

## 專案結構

```
ai-stock-radar/
├── backend/
│   ├── main.py              FastAPI 入口
│   ├── requirements.txt
│   ├── app/
│   │   ├── database.py      SQLite 連線與 Schema
│   │   ├── models.py        Pydantic 模型
│   │   ├── api/routes.py    API 端點
│   │   └── services/        yfinance 爬蟲、MA 計算
│   ├── scripts/
│   │   ├── init_db.py       首次初始化
│   │   └── daily_update.py  每日更新
│   └── data/
│       ├── stocks.json      66 檔股票清單
│       └── stocks.db        SQLite 資料庫（執行後產生）
├── frontend/
│   └── src/
│       ├── components/      React 元件
│       ├── hooks/           資料抓取、均線計算
│       ├── store/           Zustand 狀態管理
│       └── utils/           格式化工具
├── docker-compose.yml
└── README.md
```

---

## 常見問題

**Q: 初始化腳本卡住或某檔股票失敗？**
A: yfinance 有時會被 Yahoo Finance 限流。腳本設計為單一失敗不影響其他股票，只需重新執行即可補齊。

**Q: 前端顯示「尚無資料」？**
A: 請先執行 `python -m scripts.init_db` 完成初始化。

**Q: 台積電(2330)顯示的顏色：上漲是紅色？**
A: 正確。本系統使用台股慣例：**上漲 = 紅色**，下跌 = 綠色。

**Q: 如何新增自訂股票？**
A: 編輯 `backend/data/stocks.json`，加入股票資料後重新執行 `init_db.py`。

---

## 資料來源

- 歷史 K 線：Yahoo Finance（透過 `yfinance` 套件）
- 股票代號格式：`{代號}.TW`（例如 `2330.TW`）

---

**版本**: v1.0.0 | **建立日期**: 2026-04-18
