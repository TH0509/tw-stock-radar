"""TWSE listed stocks: prior-day sell, three buy days, volume +20%."""
import json,re,time
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlencode
BASE="https://www.twse.com.tw/rwd/zh/"
ROOT=Path(__file__).resolve().parents[1]
def number(s):
    try:return float(str(s).replace(",","").strip())
    except (ValueError,TypeError):return None
def fetch(endpoint,date,**params):
    url=BASE+endpoint+"?"+urlencode({"date":date.replace("-",""),"response":"json",**params})
    req=Request(url,headers={"User-Agent":"Mozilla/5.0","Referer":"https://www.twse.com.tw/"})
    with urlopen(req,timeout=25) as r:return json.load(r)
def idx(headers,name):
    h=[re.sub(r"\s+","",x) for x in headers]
    for i,x in enumerate(h):
        if x==name:return i
    raise ValueError("找不到欄位："+name)
def inst(payload):
    if not payload.get("data"):return {}
    h=payload.get("fields",[])
    c=idx(h,"證券代號");n=idx(h,"證券名稱")
    f=idx(h,"外陸資買賣超股數(不含外資自營商)")
    result={}
    for r in payload["data"]:
        code=str(r[c]).strip()
        val=number(r[f])
        if re.fullmatch("[1-9][0-9]{3}",code) and val is not None:
            result[code]={"name":str(r[n]).strip(),"foreign":round(val/1000,2)}
    return result
def prices(payload):
    tables=payload.get("tables",[])
    for n in range(1,15):
        if payload.get("fields"+str(n)) and payload.get("data"+str(n)):
            tables.append({"fields":payload["fields"+str(n)],"data":payload["data"+str(n)]})
    if payload.get("fields") and payload.get("data"):
        tables.append({"fields":payload["fields"],"data":payload["data"]})
    for table in tables:
        try:
            h=table["fields"];c=idx(h,"證券代號");v=idx(h,"成交股數");p=idx(h,"收盤價");n=idx(h,"證券名稱")
        except (KeyError,ValueError):continue
        result={}
        for row in table.get("data",[]):
            code=str(row[c]).strip()
            volume=number(row[v])
            if re.fullmatch("[1-9][0-9]{3}",code) and volume is not None:
                result[code]={"volume":volume,"close":number(row[p]),"name":str(row[n]).strip()}
        if len(result)>20:return result
    return {}
def qualifies(days):
    if len(days)!=4 or any(d.get("foreign") is None for d in days):return False
    v0=days[-2].get("volume");v1=days[-1].get("volume")
    return days[0]["foreign"]<0 and all(d["foreign"]>0 for d in days[1:]) and v0 is not None and v1 is not None and v0>0 and v1>=1.2*v0
def snapshot(inst_days,price_days):
    dates=sorted(inst_days)
    if len(dates)!=4 or dates!=sorted(price_days):raise ValueError("需要四個相同交易日")
    universe={};matches=[]
    for code,info in inst_days[dates[-1]].items():
        days=[]
        for dt in dates:
            f=inst_days[dt].get(code);p=price_days[dt].get(code)
            if f is None or p is None:break
            days.append({"date":dt,"foreign":f["foreign"],"volume":p["volume"],"close":p["close"]})
        if len(days)!=4:continue
        yes=qualifies(days)
        v0=days[-2]["volume"];v1=days[-1]["volume"]
        growth=round((v1/v0-1)*100,2) if v0>0 else None
        universe[code]={"code":code,"name":info["name"],"days":days,"matched":yes,"volume_change_pct":growth}
        if yes:matches.append(code)
    if not universe:raise ValueError("未取得可比對股票")
    matches.sort(key=lambda c:universe[c]["volume_change_pct"],reverse=True)
    return {"status":"ok","date":dates[-1],"dates":dates,"stocks":universe,"matches":matches,"scope":"TWSE上市股票，不含ETF與上櫃"}
def main():
    out=ROOT/"docs/data/screener.json"
    try:
        now=datetime.now(timezone(timedelta(hours=8))).date()
        days={}
        for x in range(18):
            day=(now-timedelta(days=x)).isoformat()
            try:
                data=inst(fetch("fund/T86",day,selectType="ALLBUT0999"))
                if data:days[day]=data
            except Exception as e:print("略過",day,e)
            if len(days)==4:break
        if len(days)<4:raise RuntimeError("缺少四日法人資料")
        price={}
        for dt in sorted(days):
            price[dt]=prices(fetch("afterTrading/MI_INDEX",dt,type="ALLBUT0999"))
            if not price[dt]:raise RuntimeError("缺少成交量："+dt)
        result=snapshot(days,price)
        try:
            from market_enrichment import enrich
            result=enrich(result)
        except Exception as e:
            result["enrichment_error"]=str(e)
            print("市場個股歷史資料擴充失敗，保留四日篩選結果：",e)
    except Exception as e:
        result={"status":"unavailable","error":str(e),"date":None,"stocks":{},"matches":[]}
    result["generated_at"]=datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    out.parent.mkdir(exist_ok=True,parents=True)
    out.write_text(json.dumps(result,ensure_ascii=False),encoding="utf-8")
    print("上市與上櫃掃描",result["status"],len(result["matches"]))
if __name__=="__main__":main()
