# 台股 Radar：動能與三大法人追蹤網站

第一版可執行專案：以 FinMind 免費個股資料 API 擷取台股**原始收盤價**及**個股三大法人買賣超**，在 Python 計算技術指標，透過 GitHub Actions 於交易日晚上產生靜態 JSON，並部署至 GitHub Pages 網站。

> **狀態**：完整程式碼與 Codex Agent、Skill 定義已建立；需部署到你擁有的 GitHub 儲存庫，並實際執行資料更新後，網站才會顯示**真實行情**。目前資料檔刻意留空，沒有偽造任何台股股價。

## 網站功能

- 追蹤 `stocks.json` 自訂的個股代號及名稱，預設 2330、2317、2454、2881、2882、2603。
- 搜尋已追蹤個股並切換視圖；1M、3M、6M、全歷史切換。
- 個股 **MA5 / MA20 / MA60、ROC5 / ROC20、RSI14** 與簡易動能狀態。
- 每日外資（含外資自營商）／投信／自營商淨買賣超長條圖，最近 12 個有資料的交易日明細，最近 5 日淨買賣總計。
- 股價與法人資料最新日期、網頁資料產生時間，手機版支援。
- 工作日晚間 **20:30（臺灣時間）** 排程 GitHub Actions 更新，或手動重跑。資料是收盤後日資料，**不是即時盤中資料**。

## 首次本機啟動（需 Python 3.10+）

1. 在 [FinMind](https://finmindtrade.com/) 建立帳號、取得 token（可選；有 token 限額較高）。
2. 在專案根目錄打開終端機；macOS／Linux：

   ```bash
   export FINMIND_TOKEN='你的 FinMind Token' # 沒有 token 可跳過此行
   python3 -m unittest discover -s tests -v
   python3 scripts/update.py
   cd docs
   python3 -m http.server 8000
   ```

3. 在瀏覽器開啟 <http://localhost:8000>。
4. 若要追蹤其他股票，修改 `stocks.json` 中的 code 與 name，再重跑 `python3 scripts/update.py`。免費 API 不適合一次掃描幾千檔；目前限制最多 25 檔。

Windows PowerShell 對 token 的設定是 `$env:FINMIND_TOKEN = '你的 FinMind Token'`；啟動伺服器指令亦可使用 `python -m http.server 8000`。

## 上傳 GitHub 並開啟網站

1. 登入 GitHub，新增空白 **Public repository**，例如 `tw-stock-radar`；不要讓新儲存庫初始化 README，以免與本專案衝突。
2. 解壓縮專案並在該資料夾執行：

   ```bash
   git init
   git branch -M main
   git add .
   git commit -m "feat: 台股 Radar 追蹤網站與 Codex agents"
   git remote add origin https://github.com/你的帳號/tw-stock-radar.git
   git push -u origin main
   ```

3. 進入 **Settings → Pages → Build and deployment → Source**，選擇 **GitHub Actions**。
4. 在 **Settings → Secrets and variables → Actions → New repository secret** 新增 `FINMIND_TOKEN`（可選，但建議）。絕對不要上傳 token 到 `docs/` 或程式碼。
5. 到 **Actions → 台股收盤分析與網站部署 → Run workflow** 手動執行一次。全部成功才會發布。
6. 網站網址通常會是 `https://你的帳號.github.io/tw-stock-radar/`，要以 Pages 設定頁顯示的實際網址為準。請勿把此示例當成已經部署完成的網址。
7. 之後週一至週五臺灣時間晚上約 20:30 排程執行；GitHub 排程可能延遲，遇假日會維持上次交易資料。

**注意**：本專案使用 Pages **GitHub Actions** 部署，而非 `Deploy from a branch`。Actions 每次先重新擷取分析再發布，若有任何股票資料失敗則整次 workflow 失敗，不會把部分更新冒充完整結果。

## Codex Agent 與 Skills

本專案已建立 Codex 的實際設定檔：

```text
AGENTS.md
.codex/
  config.toml
  agents/
    data-engineer.toml
    quant-analyst.toml
    web-engineer.toml
    qa-reviewer.toml
.agents/skills/
  finmind-ingestion/SKILL.md
  momentum-indicators/SKILL.md
  institutional-flow/SKILL.md
  pages-deployment/SKILL.md
```

在 Codex App、Codex CLI 或支援的 IDE 擴充功能中**開啟此 GitHub 專案作為工作目錄**。Codex 會讀取 `AGENTS.md` 與專案 `.agents/skills/`；真正的自訂子代理定義位於 `.codex/agents/*.toml`。

建議首次給 Codex 的指令：

> 請先閱讀 AGENTS.md，使用 data_engineer、quant_analyst、web_engineer 與 qa_reviewer 的分工，檢查 FinMind 取數、RSI/ROC 計算與 GitHub Pages 部署；執行所有測試，確認沒有誤標資料日期、股/張或提供虛構資料，再提出下一版改善事項。需要程式修改時先以不衝突的檔案分工。

**Agent 與 Skill 定義檔不等於執行中的代理。** 必須把這個專案放進 Codex 工作環境後，相關角色才能被 Codex 讀取與使用。

## 分析定義及資料品質

- 免費版使用 `TaiwanStockPrice` 的未還原價格；同一批資料計算 MA、ROC、RSI 與折線圖。除權息、分割日可能產生非交易因素造成的跳動，不應直接將跨除權息期間的 ROC 解讀為總報酬。
- MA(n)：最近 n 個交易日價格平均。ROC(n)：`(今日價/前 n 交易日價 - 1) ×100%`。
- RSI14：Wilder 14 日平滑法；14 日以前沒有 RSI 數值。
- 法人資料使用 `TaiwanStockInstitutionalInvestorsBuySell` 的 `buy - sell`。股數÷1000 換算為張；外資合併 `Foreign_Investor` 與 `Foreign_Dealer_Self`；投信 `Investment_Trust`；自營商合併 `Dealer`、`Dealer_self`、`Dealer_Hedging`。
- 如果某交易日沒有法人紀錄，輸出 `null` 而不是 0；網站明列法人與股價資料的各自日期。
- 觀察訊號「偏多／偏弱／盤整」只是價格均線與動能相對關係，不構成交易指令。沒有成交策略回測、沒有預測獲利。
- **5 日累計** 是最近最多 5 個「有法人資料的交易日」加總；若缺漏會明示有效日數，不能解讀為完整連續 5 日。

## 限制與資料授權

- 這是限定自選股票的**盤後追蹤網站**，不是全上市櫃股票掃描，不提供逐筆或即時報價；需要全市場每日掃描應改設計資料儲存、商用資料授權與分批抓取策略。
- FinMind 文件標示免費單檔個股資料可查，但有 API 限流；執行速率、方案與可用資料都可能變更。
- FinMind GitHub README 指明教育及非商業用途。**公開 GitHub Pages 並重新展示資料前，請確認 FinMind 的資料重新發布／公開展示權利；若須商業公開使用，請取得授權或改用授權合法的官方資料來源。**
- 網站需存取 Chart.js CDN；若網路封鎖 CDN，指標值及表格可顯示，但圖表不會繪製。
- 請自行比對 TWSE／TPEx 公告資料，任何輸出不保證準確、即時或完整。

## 來源與文件

- [FinMind GitHub](https://github.com/FinMind/FinMind)
- [FinMind v4 資料集說明](https://github.com/FinMind/FinMind-MCP/blob/master/knowledge/datasets.md)
- [Codex 自訂子代理](https://developers.openai.com/codex/subagents)
- [Codex Skills](https://developers.openai.com/codex/build-skills)
- [GitHub Pages 發布](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
