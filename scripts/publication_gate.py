#!/usr/bin/env python3
"""Only publish a new trading-day snapshot after BOTH markets' OHLC and
three-institution data are publicly available. No API token required.
A trading holiday simply skips an attempt; later scheduled runs retry.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, date
from pathlib import Path
from zoneinfo import ZoneInfo

from market_history import retrieve

REQUIRED = ("tw_price", "tw_inst", "otc_price", "otc_inst")
LOCAL_TIMEZONE = ZoneInfo("Asia/Taipei")


def check_day(date, getter=retrieve):
    counts = {}
    errors = {}
    for kind in REQUIRED:
        try:
            entries = getter(kind, date)
            count = len(entries) if isinstance(entries, dict) else 0
            counts[kind] = count
            if count < 20:
                errors[kind] = f"只有 {count} 檔有效股票，尚不能確認當日資料完整"
        except Exception as e:
            counts[kind] = 0
            errors[kind] = str(e)[:200]
    return {"ready": not errors, "date": date, "counts": counts, "errors": errors}


def verify_output(screener_path: Path, target: str):
    try:
        obj = json.loads(screener_path.read_text(encoding="utf-8"))
        if obj.get("status") != "ok":
            return False, "市場資料索引狀態不是 ok"
        coverage = obj.get("coverage", {})
        for market in ("TWSE", "TPEx"):
            summary = coverage.get(market, {})
            for key in ("newest_price_date", "newest_institution_date"):
                if summary.get(key) != target:
                    return False, f"{market} {key} 為 {summary.get(key)}，未達 {target}"
        return True, "上市、上櫃股價及三大法人皆已到齊"
    except (OSError, ValueError) as e:
        return False, str(e)


def emit_outputs(output_path, fields):
    if output_path:
        with open(output_path, "a", encoding="utf-8") as file:
            for k, v in fields.items():
                print(f"{k}={v}", file=file)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["probe", "validate"], default="probe")
    parser.add_argument("--date", default=None)
    parser.add_argument("--snapshot", type=Path, default=Path("docs/data/screener.json"))
    parser.add_argument("--output", type=Path, default=Path("docs/data/update-status.json"))
    args = parser.parse_args()
    now = datetime.now(LOCAL_TIMEZONE)
    # Tuesday–Saturday morning: retry yesterday's trading-day publication.
    # This also covers delayed Friday releases without waiting until Monday.
    fallback = now.date() - timedelta(days=1) if now.hour < 12 else now.date()
    target = args.date or fallback.isoformat()
    if args.mode == "probe":
        # Return a normal skip on weekends or market holidays; avoid failed CI noise.
        result = check_day(target) if date.fromisoformat(target).weekday() < 5 else {
            "ready": False, "date": target, "counts": {}, "errors": {"calendar": "週末休市"}}
        emit_outputs(os.getenv("GITHUB_OUTPUT"), {"ready": str(result["ready"]).lower(),
                  "trading_date": target})
        print(json.dumps(result, ensure_ascii=False))
        return 0
    ok, reason = verify_output(args.snapshot, target)
    print(reason)
    if not ok:
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({
        "status": "published",
        "trading_date": target,
        "checked_at": now.isoformat(timespec="seconds"),
        "content": ["K 線與 MA5/20/60", "ROC/RSI", "外資、投信、自營商", "法人反轉選股"],
        "markets": ["TWSE", "TPEx"],
        "source": "TWSE/TPEx official after-close daily data"
    }, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
