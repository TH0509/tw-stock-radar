#!/usr/bin/env python3
"""Fetch daily FinMind series and render docs/data/stocks.json for GitHub Pages."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from analysis import build_stock

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.finmindtrade.com/api/v4/data'


def get_dataset(dataset, stock_id, start_date, end_date, token=''):
    params = {'dataset': dataset, 'data_id': stock_id,
              'start_date': start_date, 'end_date': end_date}
    if token:
        params['token'] = token
    url = API + '?' + urlencode(params)
    for attempt in range(3):
        try:
            req = Request(url, headers={'User-Agent': 'TW-Stock-Radar/1.0 (educational project)',
                                        'Accept': 'application/json'})
            with urlopen(req, timeout=30) as response:
                obj = json.load(response)
            if not isinstance(obj, dict) or not isinstance(obj.get('data'), list):
                raise ValueError(f'FinMind {dataset}/{stock_id}: 非預期的回傳格式')
            if obj.get('status') not in (None, 200):
                raise ValueError(f'FinMind {dataset}/{stock_id}: {obj.get("msg") or obj.get("status")}')
            return obj['data']
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == 2:
                raise RuntimeError(f'FinMind {dataset}/{stock_id} 連線失敗：{e}') from e
            print(f'重試：{stock_id}/{dataset}: {e}', file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError('無法取得資料')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=ROOT / 'stocks.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/data/stocks.json')
    parser.add_argument('--days', type=int, default=420, help='歷史日曆天數')
    args = parser.parse_args()
    if not (70 <= args.days <= 1800):
        parser.error('--days 必須在 70 到 1800 之間')
    configs = json.loads(args.config.read_text(encoding='utf-8'))['stocks']
    if not configs or len(configs) > 25:
        parser.error('請設定 1 至 25 檔追蹤股票，避免觸發免費 API 限速')
    now = datetime.now(timezone(timedelta(hours=8)))
    # End date set to today; FinMind might not yet contain today's final settlement.
    start = (now - timedelta(days=args.days)).date().isoformat()
    end = now.date().isoformat()
    stocks, errors = {}, {}
    token = os.getenv('FINMIND_TOKEN', '').strip()
    for item in configs:
        code = str(item['code']).strip()
        name = str(item['name']).strip()
        if not code.isdigit() or len(code) not in (4, 5, 6) or not name or code in stocks:
            raise ValueError(f'股票設定不正確：{item}')
        try:
            # Adjusted prices avoid artificial momentum around ex-rights/ex-dividend.
            price = get_dataset('TaiwanStockPriceAdj', code, start, end, token)
            institution = get_dataset('TaiwanStockInstitutionalInvestorsBuySell', code, start, end, token)
            stocks[code] = build_stock(code, name, price, institution)
            print(f'{code} {name}: {len(stocks[code]["points"])} 交易日；最新收盤 {stocks[code]["last_price_date"]}')
        except Exception as exc:
            errors[code] = str(exc)
            print(f'[失敗] {code}: {exc}', file=sys.stderr)
        time.sleep(0.4)

    if errors:
        # Fail safely: never overwrite a previously valid dataset with partial coverage.
        raise RuntimeError(f'有 {len(errors)} 檔更新失敗，取消發布：{errors}')
    snapshot = {
        'schema': 1,
        'generated_at': now.isoformat(timespec='seconds'),
        'source': 'FinMind TaiwanStockPriceAdj + TaiwanStockInstitutionalInvestorsBuySell',
        'price_adjusted': True, 'institution_unit': '張 (淨買賣股數 ÷ 1000)',
        'demo': False, 'stocks': stocks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix('.tmp')
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temp.replace(args.output)
    print(f'成功產生：{args.output}')


if __name__ == '__main__':
    main()
