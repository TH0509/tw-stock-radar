# Codex 專案指令：台股 Radar

## 任務
建置每天收盤後更新的「個股動能與三大法人買賣超」靜態儀表板；使用 Python 取數與計算、GitHub Actions 排程、GitHub Pages 發布。

## 必須遵守
- 使用臺灣正體中文介面與文件，不要使用簡體字。
- 保持明確的資料源、日期、單位與最新成功發布時間；此專案不是即時交易系統。
- 僅以交易日計算 MA、ROC、RSI；以還原股價計算長期動能，避免除權息扭曲。
- FinMind 法人買賣 `buy - sell` 原始股數除以 1000 才是「張」。外資含 Foreign_Dealer_Self，投信 Investment_Trust，自營商 Dealer、Dealer_self、Dealer_Hedging；不要重複計算。
- 缺失資料保留 null，不可默認當日淨買賣超 = 0。
- FINMIND_TOKEN 只放環境變數或 GitHub Actions Secret；不可上傳。
- 不要自動產生投資下單功能，不宣稱任何技術訊號能保證獲利。
- 沒有完整成功資料時不可覆蓋已發布快照。
- 程式修改後先跑 `python -m unittest discover -s tests -v`。

## 分工
- data_engineer：資料擷取 API、穩定性與錯誤回報
- quant_analyst：動能、均線、RSI、三大法人運算及單元測試
- web_engineer：圖表、搜尋、手機排版與可近用性
- qa_reviewer：獨立風險審查，不修改程式

必要時讓不同的子代理獨立審核，避免同時改同一個檔案造成衝突。以 `.agents/skills/` 內流程作為該類工作的操作守則。

## 交付標準
站點顯示每檔股票還原收盤價、ROC20、RSI14、MA5/20/60、三大法人當日明細及 5 日加總、資料日期；GitHub Actions 手動執行及工作日晚間排程皆可部署；錯誤時不散布不完整分析資料。
