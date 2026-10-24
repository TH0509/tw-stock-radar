#!/usr/bin/env python3
"""上市股票掃描：外資由賣轉買、連買三日，且最新量增至少 20%。"""
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
TZ = timezone(timedelta(hours=8))
CODE = re.compile(r'^[1-9][0-9]{3}$')
T86 = 'https://www.twse.com.tw/rwd/zh/fund/T86'
MI = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'

def number(value):
    value = str(value or '').replace(',', '').strip()
    try:
        return float(value)
    except ValueError:
        return None

def request_data(base, day, **params):
    url = base + '?' + urlencode({'date': day.replace('-', ''), **params, 'response':'json'})
    req = Request(url, headers={'User-Agent':'Mozilla/5.0', 'Accept':'application/json',
                                'Referer':'https://www.twse.com.tw/'})
    with urlopen(req, timeout=25) as response:
        return json.load(response)

def index(fields, exact, prefix=False):
    normalized = [re.sub(r'\s+', '', str(f)) for f in fields]
    for i, field in enumerate(normalized):
        if field == exact or (prefix and field.startswith(exact)):
            return i
    raise ValueError('官方欄位不存在：' + exact)

def parse_t86(obj):
    if not isinstance(obj, dict) or not obj.get('data'):
        return {}
    fields = obj.get('fields', [])
    cols = [index(fields, s, prefix=prefix) for s,prefix in [
        ('證券代號',False), ('證券名稱',False),
        ('外陸資買賣超股數(不含外資自營商)',False),
        ('投信買賣超股數',False), ('自營商買賣超股數',True)]]
    result = {}
    for row in obj['data']:
        try:
            code = str(row[cols[0]]).strip()
            if not CODE.fullmatch(code):
                continue
            a, b, c = (number(row[i]) for i in cols[2:])
            if None in (a,b,c):
                continue
            result[code] = {'name':str(row[cols[1]]).strip(),
                            'foreign':round(a/1000,2),'trust':round(b/1000,2),
                            'dealer':round(c/1000,2)}
        except (IndexError, TypeError):
            continue
    return result

def parse_mi(obj):
    if not isinstance(obj, dict):
        return {}
    tables = list(obj.get('tables', []))
    for n in range(1,16):
        if obj.get(f'fields{n}') and obj.get(f'data{n}'):
            tables.append({'fields':obj[f'fields{n}'],'data':obj[f'data{n}']})
    if obj.get('fields') and obj.get('data'):
        tables.append(obj)
    for table in tables:
        try:
            ci = index(table['fields'],'證券代號')
            vi = index(table['fields'],'成交股數')
            pi = index(table['fields'],'收盤價')
        except (ValueError, KeyError):
            continue
        result = {}
        for row in table.get('data', []):
            try:
                code = str(row[ci]).strip()
                vol, price = number(row[vi]), number(row[pi])
                if CODE.fullmatch(code) and vol is not None and vol >= 0:
                    result[code] = {'volume_shares':int(vol),'close':price}
            except (IndexError, TypeError):
                continue
        if len(result)>=20:
            return result
    return {}

def evaluate(days):
    if len(days)!=4 or any(d.get('foreign') is None for d in days):
        return None
    previous, current = days[-2]['volume_shares'], days[-1]['volume_shares']
    change = None if previous is None or current is None or previous<=0 else (current/previous-1)*100
    matched = (days[0]['foreign']<0 and all(d['foreign']>0 for d in days[1:])
               and change is not None and change >= 20-1e-9)
    return {'matched':matched,'volume_change_pct':None if change is None else round(change,2)}

def build_snapshot(institutions, volumes):
    dates = sorted(institutions)
    if len(dates)!=4 or set(dates)!=set(volumes):
        raise ValueError('必須有同四個交易日的法人與股價資料')
    stocks, matches = {}, []
    for code, item in institutions[dates[-1]].items():
        days=[]
        for day in dates:
            flow, quote = institutions[day].get(code), volumes[day].get(code)
            if not flow or not quote:
                break
            days.append({'date':day,'close':quote['close'],
                         'volume_shares':quote['volume_shares'],
                         'foreign':flow['foreign'],'trust':flow['trust'],
                         'dealer':flow['dealer'],
                         'total':round(flow['foreign']+flow['trust']+flow['dealer'],2)})
        result=evaluate(days)
        if result is None:
            continue
        stocks[code]={'code':code,'name':item['name'],'days':days,**result}
        if result['matched']:
            matches.append(code)
    if not stocks:
        raise RuntimeError('資料無法比對，不可誤顯示為沒有符合股票')
    matches.sort(key=lambda c: stocks[c]['volume_change_pct'],reverse=True)
    return {'schema':1,'status':'ok','source':'TWSE T86 + MI_INDEX (上市股票)',
            'market':'TWSE', 'latest_date':dates[-1],'trading_dates':dates,
            'generated_at':datetime.now(TZ).isoformat(timespec='seconds'),
            'stocks':stocks,'matches':matches}

def run(today=None):
    today=today or datetime.now(TZ).date()
    flows={}
    for offset in range(18):
        day=(today-timedelta(days=offset)).isoformat()
        try:
            result=parse_t86(request_data(T86,day,selectType='ALLBUT0999'))
        except (OSError,ValueError,RuntimeError) as exc:
            print('法人查詢失敗',day,str(exc),file=sys.stderr)
            continue
        if result:
            flows[day]=result
        if len(flows)==4:
            break
        time.sleep(.2)
    if len(flows)!=4:
        raise RuntimeError('最近 18 日找不到完整四個法人交易日')
    volumes={}
    for day in sorted(flows):
        prices=parse_mi(request_data(MI,day,type='ALLBUT0999'))
        if not prices:
            raise RuntimeError('成交量資料不存在：'+day)
        volumes[day]=prices
        time.sleep(.2)
    return build_snapshot(flows,volumes)

def main():
    output=ROOT/'docs/data/screener.json'
    try:
        obj=run()
        print('全上市掃描',obj['latest_date'],'有效',len(obj['stocks']),'符合',len(obj['matches']))
    except Exception as exc:
        print('上市掃描暫時不可用：'+str(exc),file=sys.stderr)
        obj={'schema':1,'status':'unavailable','source':'TWSE T86 + MI_INDEX (上市股票)',
             'latest_date':None,'trading_dates':[],'stocks':{},'matches':[],
             'generated_at':datetime.now(TZ).isoformat(timespec='seconds'),
             'error':str(exc)}
    output.parent.mkdir(parents=True,exist_ok=True)
    temp=output.with_suffix('.tmp')
    temp.write_text(json.dumps(obj,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf-8')
    temp.replace(output)

if __name__=='__main__':
    main()
