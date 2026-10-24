"""Pure calculation functions for daily Taiwan stock analysis.

FinMind TaiwanStockPriceAdj uses adjusted OHLC prices. Institutional buy/sell
figures are counts of shares; we convert the daily net to lots (1 lot=1000 shares).
No trading recommendation is made by these calculations.
"""
from __future__ import annotations

from collections import defaultdict
from math import isfinite
from statistics import mean

FOREIGN_NAMES = {'Foreign_Investor', 'Foreign_Dealer_Self'}
TRUST_NAMES = {'Investment_Trust'}
DEALER_NAMES = {'Dealer', 'Dealer_self', 'Dealer_Hedging'}


def number(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if isfinite(x) else None


def round_or_none(value, digits=2):
    return round(value, digits) if value is not None and isfinite(value) else None


def sma(prices, n):
    return [None if i + 1 < n else mean(prices[i - n + 1:i + 1]) for i in range(len(prices))]


def roc(prices, n):
    values = [None] * len(prices)
    for i in range(n, len(prices)):
        if prices[i - n] != 0:
            values[i] = (prices[i] / prices[i - n] - 1) * 100
    return values


def rsi_wilder(prices, period=14):
    out = [None] * len(prices)
    if len(prices) <= period:
        return out
    diffs = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gain = sum(max(d, 0) for d in diffs[:period]) / period
    loss = sum(max(-d, 0) for d in diffs[:period]) / period

    def rsi(g, l):
        if l == 0:
            return 100.0 if g > 0 else 50.0
        return 100 - 100 / (1 + g / l)

    out[period] = rsi(gain, loss)
    for i in range(period + 1, len(prices)):
        delta = prices[i] - prices[i - 1]
        gain = (gain * (period - 1) + max(delta, 0)) / period
        loss = (loss * (period - 1) + max(-delta, 0)) / period
        out[i] = rsi(gain, loss)
    return out


def summarize_institutions(raw):
    """date -> {foreign, trust, dealer, total} net lots; unknown groups are ignored.

    Missing dates are intentionally NOT filled with 0: no data != no trades.
    Dealer old/new categories can be combined safely across 2014-12-01.
    Foreign_Dealer_Self is included in the displayed foreign total.
    """
    by_day = defaultdict(lambda: {'foreign': 0.0, 'trust': 0.0, 'dealer': 0.0})
    for row in raw:
        date = row.get('date')
        cat = str(row.get('name') or '')
        if cat in FOREIGN_NAMES:
            key = 'foreign'
        elif cat in TRUST_NAMES:
            key = 'trust'
        elif cat in DEALER_NAMES:
            key = 'dealer'
        else:
            continue
        buy, sell = number(row.get('buy')), number(row.get('sell'))
        if not date or buy is None or sell is None:
            continue
        by_day[date][key] += (buy - sell) / 1000.0
    result = {}
    for date, vals in by_day.items():
        result[date] = {k: round_or_none(v, 2) for k, v in vals.items()}
        result[date]['total'] = round_or_none(sum(vals.values()), 2)
    return result


def signal(close, ma5, ma20, roc20):
    if None in (close, ma5, ma20, roc20):
        return '資料不足'
    if close > ma20 and ma5 > ma20 and roc20 > 0:
        return '偏多'
    if close < ma20 and ma5 < ma20 and roc20 < 0:
        return '偏弱'
    return '盤整'


def build_stock(code, name, raw_prices, raw_institutions):
    """Return a JSON-serializable entry sorted by date, with explicit missing values."""
    cleaned = {}
    for row in raw_prices:
        dt = row.get('date')
        close = number(row.get('close'))
        if dt and close is not None and close > 0:
            cleaned[dt] = row
    rows = [cleaned[k] for k in sorted(cleaned)]
    if len(rows) < 21:
        raise ValueError(f'{code} 的有效交易日不足 21 天，無法計算 ROC20')
    prices = [float(row['close']) for row in rows]
    dates = [str(row['date']) for row in rows]
    ma5, ma20, ma60 = (sma(prices, n) for n in (5, 20, 60))
    roc5, roc20 = roc(prices, 5), roc(prices, 20)
    rsis = rsi_wilder(prices)
    inst = summarize_institutions(raw_institutions)
    points = []
    for i, row in enumerate(rows):
        matched = inst.get(dates[i])
        points.append({
            'date': dates[i], 'close': round_or_none(prices[i]),
            'ma5': round_or_none(ma5[i]), 'ma20': round_or_none(ma20[i]),
            'ma60': round_or_none(ma60[i]), 'roc5': round_or_none(roc5[i]),
            'roc20': round_or_none(roc20[i]), 'rsi14': round_or_none(rsis[i]),
            'volume_shares': number(row.get('Trading_Volume')),
            'foreign': matched['foreign'] if matched else None,
            'trust': matched['trust'] if matched else None,
            'dealer': matched['dealer'] if matched else None,
            'total': matched['total'] if matched else None,
        })
    available = [x for x in points if x['total'] is not None]
    flows = {}
    for n in (1, 5, 20):
        past = available[-n:]
        flows[f'd{n}'] = {
            'count': len(past),
            'total': round_or_none(sum(x['total'] for x in past)) if past else None,
            'foreign': round_or_none(sum(x['foreign'] for x in past)) if past else None,
            'trust': round_or_none(sum(x['trust'] for x in past)) if past else None,
            'dealer': round_or_none(sum(x['dealer'] for x in past)) if past else None,
        }
    last = points[-1]
    return {
        'code': code, 'name': name,
        'last_price_date': dates[-1],
        'last_institution_date': available[-1]['date'] if available else None,
        'latest_close': last['close'],
        'latest_roc20': last['roc20'], 'latest_rsi14': last['rsi14'],
        'signal': signal(last['close'], last['ma5'], last['ma20'], last['roc20']),
        'flows': flows, 'points': points,
    }
