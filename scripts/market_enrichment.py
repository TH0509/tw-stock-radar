"""Whole-market TWSE / TPEx snapshot enrichment for a static GitHub Pages site."""
import json,time,re
from datetime import datetime,timedelta,timezone
from urllib.parse import urlencode
from urllib.request import Request,urlopen
from scanner import get_json,prices,fetch,snapshot,qualifies,BASE
from analysis import sma,roc,rsi_wilder

def otc_json(path,day,**extra):
    roc=f"{day.year-1911}/{day.month:02}/{day.day:02}"
    url="https://www.tpex.org.tw/www/zh-tw/"+path+"?"+urlencode({"date":roc,**extra,"response":"json"})
    req=Request(url,headers={"User-Agent":"Mozilla/5.0","Referer":"https://www.tpex.org.tw/"})
    with urlopen(req,timeout=15) as r:return json.load(r)

def otc_prices(obj):
    for table in obj.get("tables",[]):
        fs=[re.sub(r"\s+","",str(v)) for v in table.get("fields",[])]
        rows=table.get("data",[])
        if not rows:continue
        def at(names,default):return next((i for i,x in enumerate(fs) if x in names),default)
        c=at(("代號","證券代號"),0);n=at(("名稱","證券名稱"),1);p=at(("收盤","收盤價"),2);v=at(("成交股數","成交量"),7)
        result={}
        for row in rows:
            try:
                code=str(row[c]).strip()
                if not re.fullmatch(r"[1-9][0-9]{3}",code):continue
                close=float(str(row[p]).replace(",",""))
                vol=float(str(row[v]).replace(",",""))
                if close>0 and vol>=0:result[code]={"name":str(row[n]).strip(),"close":close,"volume_shares":int(vol)}
            except (IndexError,ValueError,TypeError):pass
        if len(result)>=20:return result
    return {}

def otc_flows(obj):
    for table in obj.get("tables",[]):
        rows=table.get("data",[])
        if not rows or len(rows[0])<24:continue
        result={}
        for row in rows:
            try:
                code=str(row[0]).strip()
                if not re.fullmatch(r"[1-9][0-9]{3}",code):continue
                f,t,ds,dh,d,total=[float(str(row[i]).replace(",","")) for i in (4,13,16,19,22,23)]
                if abs(ds+dh-d)>2 or abs(f+t+d-total)>2:continue
                result[code]={"name":str(row[1]).strip(),"foreign":round(f/1000,2),
                              "trust":round(t/1000,2),"dealer":round(d/1000,2)}
            except (IndexError,ValueError,TypeError):pass
        if len(result)>=20:return result
    return {}

def enrich(base):
    dates=sorted(base["dates"])
    last=datetime.strptime(dates[-1],"%Y-%m-%d").date()
    hist,otc_hist,otc_inst={},{},{}
    errors=[]; tw_failed=0;ot_failed=0;inst_failed=0
    for i in range(43):
        day=last-timedelta(days=i)
        if day.weekday()>=5:continue
        date=day.isoformat()
        if tw_failed<3 and len(hist)<23:
            try:
                x=prices(fetch("afterTrading/MI_INDEX",date,type="ALLBUT0999"))
                if x:hist[date]=x
            except Exception as e:tw_failed+=1;errors.append("TWSE "+date+": "+str(e))
        if ot_failed<3 and len(otc_hist)<23:
            try:
                x=otc_prices(otc_json("afterTrading/dailyQuotes",day))
                if x:otc_hist[date]=x
            except Exception as e:ot_failed+=1;errors.append("TPEx "+date+": "+str(e))
        if inst_failed<3 and len(otc_inst)<4:
            try:
                x=otc_flows(otc_json("insti/dailyTrade",day,type="Daily",sect="EW",id=""))
                if x:otc_inst[date]=x
            except Exception as e:inst_failed+=1;errors.append("TPEx institution "+date+": "+str(e))
        if len(hist)>=23 and len(otc_hist)>=23 and len(otc_inst)>=4:break
        time.sleep(.2)
    def points(source,code,institution):
        rows=[]
        for day,all_data in sorted(source.items()):
            x=all_data.get(code)
            if not x or not x.get("close"):continue
            y=institution.get(day,{}).get(code)
            row={"date":day,"close":x["close"],"volume_shares":x.get("volume_shares",x.get("volume")),
                 "foreign":y["foreign"] if y else None,
                 "trust":y.get("trust") if y else None,
                 "dealer":y.get("dealer") if y else None}
            vals=[row[z] for z in ("foreign","trust","dealer")]
            row["total"]=round(sum(vals),2) if all(v is not None for v in vals) else None
            rows.append(row)
        if not rows:return []
        closes=[x["close"] for x in rows]
        metrics={"ma5":sma(closes,5),"ma20":sma(closes,20),"ma60":sma(closes,60),
                 "roc5":roc(closes,5),"roc20":roc(closes,20),"rsi14":rsi_wilder(closes)}
        for i,row in enumerate(rows):
            for key,values in metrics.items():row[key]=None if values[i] is None else round(values[i],2)
        return rows
    inst={}
    for day in dates:
        inst[day]={}
        for code,entry in base["stocks"].items():
            for x in entry.get("days",[]):
                if x["date"]==day:inst[day][code]=x
    latest=max(hist) if hist else None
    if latest:
        for code,x in hist[latest].items():
            if not re.fullmatch(r"[1-9][0-9]{3}",code):continue
            item=base["stocks"].setdefault(code,{"code":code,"name":x.get("name") or code,"days":[],"matched":False,"volume_change_pct":None})
            item["market"]="TWSE"
            item["name"]=x.get("name") or item["name"]
            item["history"]=points(hist,code,inst)
    latest=max(otc_hist) if otc_hist else None
    if latest:
        for code,x in otc_hist[latest].items():
            item={"code":code,"name":x["name"],"market":"TPEx","days":[],"matched":False,"volume_change_pct":None,
                  "history":points(otc_hist,code,otc_inst)}
            inst_dates=sorted(otc_inst)[-4:]
            if len(inst_dates)==4 and all(code in otc_inst[d] and code in otc_hist.get(d,{}) for d in inst_dates):
                ds=[]
                for day in inst_dates:
                    f=otc_inst[day][code];p=otc_hist[day][code]
                    ds.append({"date":day,"foreign":f["foreign"],"trust":f["trust"],"dealer":f["dealer"],
                               "total":round(f["foreign"]+f["trust"]+f["dealer"],2),
                               "close":p["close"],"volume_shares":p["volume_shares"]})
                item["days"]=ds
                v0,v1=ds[-2]["volume_shares"],ds[-1]["volume_shares"]
                item["volume_change_pct"]=round((v1/v0-1)*100,2) if v0 else None
                item["matched"]=bool(ds[0]["foreign"]<0 and all(d["foreign"]>0 for d in ds[1:])
                     and v0>0 and v1>=1.2*v0)
                if item["matched"]:base["matches"].append(code)
            base["stocks"][code]=item
    base["matches"].sort(key=lambda c:base["stocks"][c].get("volume_change_pct") or 0,reverse=True)
    base["scope"]="上市及上櫃普通股（依官方資料可取得範圍）"
    base["warnings"]=errors[-8:]
    return base
