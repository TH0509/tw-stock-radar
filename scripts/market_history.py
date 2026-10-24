#!/usr/bin/env python3
"""Incremental bulk daily history from TWSE/TPEx, cached by date for GitHub Actions.
Never substitutes missing OHLCV or institutional observations with estimates.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scanner import fetch, institutional_complete, prices
from market_enrichment import otc_json, otc_prices, otc_flows
from analysis import build_stock

ROOT = Path(__file__).resolve().parents[1]
TZ = timezone(timedelta(hours=8))
KINDS = ("tw_price", "tw_inst", "otc_price", "otc_inst")


def retrieve(kind, day):
    if kind == "tw_price":
        data = prices(fetch("afterTrading/MI_INDEX", day, type="ALLBUT0999"))
    elif kind == "tw_inst":
        data = institutional_complete(fetch("fund/T86", day, selectType="ALLBUT0999"))
    elif kind == "otc_price":
        data = otc_prices(otc_json("afterTrading/dailyQuotes", datetime.fromisoformat(day).date()))
    elif kind == "otc_inst":
        data = otc_flows(otc_json("insti/dailyTrade", datetime.fromisoformat(day).date(),
                                 type="Daily", sect="EW", id=""))
    else:
        raise ValueError(kind)
    if not isinstance(data, dict) or not data:
        raise ValueError("API 沒有可用資料（可能為休市日或格式變更）")
    return data


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
                    encoding="utf-8")
    temp.replace(path)


def load_cached(cache, days):
    result = {}
    for day in days:
        path = cache / (day + ".json")
        if not path.exists():
            result[day] = {}
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            result[day] = {k: v for k, v in value.items() if k in KINDS and isinstance(v, dict) and v}
        except (ValueError, OSError):
            result[day] = {}
    return result


def backfill(cache, today, calendar_days=238, max_missing=980, workers=5):
    dates = [(today - timedelta(days=d)).isoformat() for d in range(calendar_days + 1)
             if (today - timedelta(days=d)).weekday() < 5]
    data = load_cached(cache, dates)
    jobs = [(date, k) for date in dates for k in KINDS if k not in data[date]]
    # Always prioritize recent days so any partial run starts with the most useful charts.
    jobs = jobs[:max_missing]
    print(f"市場歷史：快取交易候選日 {len(dates)}，待抓取 {len(jobs)} 組資料", flush=True)
    failures = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {}
        for date, k in jobs:
            future_map[pool.submit(retrieve, k, date)] = (date, k)
        for i, future in enumerate(as_completed(future_map), 1):
            date, k = future_map[future]
            try:
                data[date][k] = future.result()
                save_json(cache / (date + ".json"), data[date])
            except Exception as exc:
                if len(failures) < 60:
                    failures.append(f"{date}/{k}: {exc}")
            if i % 50 == 0:
                print(f"歷史回補 {i}/{len(jobs)} 完成", flush=True)
    print(f"新資料成功 {len(jobs) - (sum(1 for d,k in jobs if k not in data[d]))}/{len(jobs)}", flush=True)
    return data, failures


def flows_to_raw(stock_code, dates_and_flows):
    raw = []
    for day, values in dates_and_flows:
        source = values.get(stock_code)
        if not source:
            continue
        for key, cat in (("foreign", "Foreign_Investor"),
                         ("trust", "Investment_Trust"),
                         ("dealer", "Dealer_self")):
            v = source.get(key)
            if v is None:
                continue
            shares = round(float(v) * 1000)
            raw.append({"date": day, "name": cat,
                        "buy": max(shares, 0), "sell": max(-shares, 0)})
    return raw


def partial_stock(code, name, rows, raw_flow):
    """New listings under 21 days retain true prices, missing derived signals."""
    from analysis import summarize_institutions
    flow = summarize_institutions(raw_flow)
    pts = []
    for r in sorted(rows, key=lambda x: x["date"]):
        f = flow.get(r["date"])
        pts.append({"date": r["date"], "open": r["open"], "high": r["high"],
                    "low": r["low"], "close": r["close"],
                    "volume_shares": r["Trading_Volume"],
                    "ma5": None, "ma20": None, "ma60": None, "roc5": None,
                    "roc20": None, "rsi14": None,
                    **(f if f else {"foreign": None, "trust": None,
                                    "dealer": None, "total": None})})
    last = pts[-1]
    return {"code": code, "name": name, "points": pts,
            "last_price_date": last["date"],
            "last_institution_date": next((p["date"] for p in reversed(pts)
                                           if p["total"] is not None), None),
            "latest_close": last["close"], "latest_roc20": None,
            "latest_rsi14": None, "signal": "資料不足",
            "flows": {f"d{n}": {"count": 0, "total": None, "foreign": None,
                               "trust": None, "dealer": None} for n in (1, 5, 20)}}


def materialize(cache_data, output, now):
    by_market = {"TWSE": {"price": {}, "flow": {}},
                 "TPEx": {"price": {}, "flow": {}}}
    mapping = [("TWSE", "tw_price", "tw_inst"),
               ("TPEx", "otc_price", "otc_inst")]
    for market, price_key, flow_key in mapping:
        dst = by_market[market]
        for day, block in sorted(cache_data.items()):
            if block.get(price_key):
                dst["price"][day] = block[price_key]
            if block.get(flow_key):
                dst["flow"][day] = block[flow_key]

    stock_index, signals, summary = {}, [], {}
    details_dir = output / "market"
    details_dir.mkdir(parents=True, exist_ok=True)
    for market, parts in by_market.items():
        price_series, flow_series = parts["price"], parts["flow"]
        dates = sorted(price_series)
        if not dates:
            summary[market] = {"price_days": 0, "institution_days": len(flow_series)}
            continue
        current = price_series[dates[-1]]
        flow_pairs = sorted(flow_series.items())
        by_code = {}
        for day in dates:
            for code, row in price_series[day].items():
                if code not in current or not re.fullmatch(r"[1-9][0-9]{3}", code):
                    continue
                o, h, l, c = (row.get(x) for x in ("open", "high", "low", "close"))
                volume = row.get("volume", row.get("volume_shares"))
                if (None in (o, h, l, c, volume) or
                        not (0 < l <= min(o, c) <= max(o, c) <= h)):
                    continue
                by_code.setdefault(code, []).append({
                    "date": day, "open": o, "max": h, "min": l,
                    "close": c, "Trading_Volume": volume,
                })
        for code, rows in by_code.items():
            name = current[code].get("name") or code
            raw_institutions = flows_to_raw(code, flow_pairs)
            try:
                stock = (build_stock(code, name, rows, raw_institutions) if len(rows) >= 21
                         else partial_stock(code, name, rows, raw_institutions))
            except (ValueError, TypeError, KeyError):
                continue
            stock["market"] = market
            stock["price_adjusted"] = False
            stock["coverage_days"] = len(stock["points"])
            stock["required_trading_days"] = 132
            stock["full_6m"] = len(stock["points"]) >= 132
            save_json(details_dir / (code + ".json"), stock)
            stock_index[code] = {"code": code, "name": name, "market": market,
                                 "has_detail": True, "coverage_days": len(rows),
                                 "last_price_date": stock["last_price_date"],
                                 "last_institution_date": stock["last_institution_date"]}
        # Use only aligned real trading dates for screening, not calendar days.
        aligned = sorted(set(price_series) & set(flow_series))[-4:]
        if len(aligned) == 4:
            for code, info in stock_index.items():
                if info["market"] != market:
                    continue
                days = []
                for day in aligned:
                    p, f = price_series[day].get(code), flow_series[day].get(code)
                    if not p or not f:
                        break
                    v = p.get("volume", p.get("volume_shares"))
                    if v is None or f.get("foreign") is None:
                        break
                    days.append({"date": day,
                                 "foreign": f.get("foreign_ex_dealer", f["foreign"]),
                                 "volume": v, "close": p["close"]})
                if len(days) != 4:
                    continue
                prior = days[-2]["volume"]; latest = days[-1]["volume"]
                info["days"] = days
                info["volume_change_pct"] = (round((latest / prior - 1) * 100, 2)
                                             if prior and prior > 0 else None)
                if (days[0]["foreign"] < 0 and all(x["foreign"] > 0 for x in days[1:])
                        and prior and prior > 0 and latest >= prior * 1.20):
                    signals.append(code)
        summary[market] = {"price_days": len(price_series),
                           "institution_days": len(flow_series),
                           "newest_institution_date": max(flow_series) if flow_series else None,
                           "oldest_price_date": dates[0], "newest_price_date": dates[-1],
                           "stock_count": len(by_code)}
    signals.sort(key=lambda c: stock_index[c].get("volume_change_pct") or 0, reverse=True)
    snapshot = {"schema": 3, "status": "ok" if stock_index else "unavailable",
                "date": max((v.get("newest_price_date","") for v in summary.values()), default="") or None,
                "generated_at": now.isoformat(timespec="seconds"),
                "stocks": stock_index, "matches": signals,
                "scope": "TWSE/TPEx 官方上市櫃日資料；未滿 132 個交易日會標示不足",
                "coverage": summary,
                "source": "TWSE MI_INDEX/T86; TPEx dailyQuotes/dailyTrade",
                "error": None if stock_index else "市場歷史資料尚未建立完成"}
    save_json(output / "screener.json", snapshot)
    print(f"已產生 {len(stock_index)} 檔股票詳情，符合篩選 {len(signals)} 檔", flush=True)
    return snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=238)
    parser.add_argument("--max-missing", type=int, default=980)
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/market-history")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/data")
    args = parser.parse_args()
    if args.days < 190 or args.days > 300:
        parser.error("歷史區間應為 190 至 300 個日曆日")
    now = datetime.now(TZ)
    data, errors = backfill(args.cache, now.date(), args.days, args.max_missing)
    result = materialize(data, args.output, now)
    if errors:
        print(f"部分歷史資料無法取得（{len(errors)} 筆錯誤摘要）：", file=sys.stderr)
        for item in errors[:15]:
            print(item, file=sys.stderr)
    if result["status"] != "ok":
        raise RuntimeError("無法取得任何可用股票行情，取消網站部署")


if __name__ == "__main__":
    main()
