# 台股 Radar：直接連接外部歷史股價與三大法人 API

## 資料傳送路徑

```text
GitHub Pages（台股 Radar）
  → https://你的-worker.workers.dev/api/stock/3017
    → Cloudflare Worker（隱藏 FinMind Token／驗證代碼／快取四小時）
      → FinMind TaiwanStockPrice（420 天開高低收、成交量）
      → FinMind TaiwanStockInstitutionalInvestorsBuySellWide（420 天完整三大法人）
      → 返回統一結構 OHLC、MA5/20/60、ROC5/20、RSI14、法人至少 15 日可用性
```

前端 **每次點選股票優先連外部 API**；沒有啟用 Worker 或 API 暫時失敗，會顯示 GitHub Pages 已產生的歷史快取及「資料缺漏」提醒。不會把快取冒充最新資料。個股的日 K 圖使用真實開、高、低、收；紅漲、綠跌，MA5/20/60 疊在 K 圖上。

全市場「外資由賣轉買、連買三日、量增 20%」的**右側選股欄**繼續讀取證交所、櫃買中心官方的盤後掃描結果（`docs/data/screener.json`）。**它不是即時盤中選股服務**。

## 啟用 API：需要使用者自己登入 Cloudflare 做一次授權

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 註冊或登入，啟用 Workers 免費方案（實際配額依 Cloudflare 帳號及政策）。本專案 Worker 程式已位於 `worker/index.mjs`、`wrangler.jsonc`。
2. 在電腦終端機於本儲存庫根目錄執行：

   ```bash
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put FINMIND_TOKEN
   ```

   最後一步會請你輸入從 [FinMind](https://finmindtrade.com/) 取得的 Token，請**不要**將 Token 存入公開 GitHub 檔案。若使用免費 API 無 Token，也能部署 Worker，但請求上限較低；可跳過 secret put。

3. 部署後 Cloudflare 會提供如 `https://tw-radar-stock-api.<你的workers子網域>.workers.dev` 的真實網址。先開啟 `/api/health`，看到 `status:ok` 表示 Worker 有啟動；再開啟 `/api/stock/2330` 看 JSON 中是否有 `points`、`flows`、`coverage`。
4. 到 GitHub `TH0509/tw-stock-radar → Settings → Secrets and variables → Actions → Variables → New repository variable`，新增：

   - **Name：** `RADAR_API_BASE_URL`
   - **Value：** 你的 Worker HTTPS 根網址（**不要**加 `/api/stock/...`）

5. 到 GitHub **Actions → 台股收盤分析與網站部署 → Run workflow** 重新部署。GitHub Actions 會把 Worker 根網址寫入 `docs/api-config.js`，網頁顯示「外部金融 API：已設定」。

## 驗收：不要只看綠色勾勾

- 選取非原始六檔的 `3017`，網頁要顯示至少 60 個交易日 MA60 所需的歷史價格，`5D`、`1M`、`3M`、`6M` 可以切換。
- K 線有**真實的 open / high / low / close**，不是收盤價折線。
- K 線旁有 MA5、MA20、MA60 的綠／黃／紫色走勢線。
- 最新法人表列出外資、投信、自營商、合計；各類別以張計，網頁依照 `coverage.institution_complete_days` 檢查是否至少 15 個交易日，少於 15 日必須警告。
- 右側側欄顯示官方每日掃描結果，可直接「＋ 加入」自選股；確認個股加入後仍能取得完整資料。
- API 有問題不能悄悄顯示舊資料作為最新資料；必須標示快取或資料不足。

## 資料與安全限制

FinMind Free 方案官方標示 `TaiwanStockPrice`、`TaiwanStockInstitutionalInvestorsBuySellWide` 為個股可查資料，但有小時呼叫限額（未登入 300 次、帶 Token 600 次，實際政策以官方公告為準）。本 Worker 以 4 小時伺服器端快取避免每次重複打上游 API。

Worker 是公開 HTTPS 路徑；它將 Token 放在 Cloudflare Secrets，非公開頁面內。網站與 API 不包含登入驗證；若要防止第三方直接使用公開 API、要求可用率或商用授權，需再加身份驗證、限速與正式授權來源。FinMind 目前有非商業用途及轉載使用限制，公開散布前請依官方授權條款核對。股價未作除權息還原，跨除權息期間的 ROC 不等於含股利報酬。

交易所休市、新上市、停牌、資料不足或 FinMind API 不可用時，無法保證 15 個法人交易日或六個月資料。網站會顯示實際可用日數，不會填入虛構數據。
