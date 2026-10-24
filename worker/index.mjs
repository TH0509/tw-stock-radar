// On-demand FinMind proxy. The token stays in Cloudflare Workers Secrets, not in GitHub Pages.
const API='https://api.finmindtrade.com/api/v4/data';
const foreign=new Set(['Foreign_Investor','Foreign_Dealer_Self']);
const trust=new Set(['Investment_Trust']);
const dealer=new Set(['Dealer','Dealer_self','Dealer_Hedging']);
const num=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const rounded=x=>x==null||!Number.isFinite(x)?null:Math.round((x+Number.EPSILON)*100)/100;
function average(values,n){return values.map((_,i)=>i<n-1?null:rounded(values.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n));}
function roc(values,n){return values.map((x,i)=>i<n||!values[i-n]?null:rounded((x/values[i-n]-1)*100));}
function rsi(values,n=14){
 const out=Array(values.length).fill(null);if(values.length<=n)return out;
 let gain=0,loss=0;
 for(let i=1;i<=n;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d);}
 gain/=n;loss/=n;
 const calc=(g,l)=>l===0?(g>0?100:50):100-100/(1+g/l);
 out[n]=rounded(calc(gain,loss));
 for(let i=n+1;i<values.length;i++){
  const d=values[i]-values[i-1];
  gain=(gain*(n-1)+Math.max(0,d))/n;loss=(loss*(n-1)+Math.max(0,-d))/n;
  out[i]=rounded(calc(gain,loss));
 }
 return out;
}
export function buildStock(code, prices, institutions){
 if(!Array.isArray(prices)||!Array.isArray(institutions))throw Error('外部資料格式不正確');
 const byDate=new Map();
 for(const p of prices){
  const date=String(p.date||'');
  const [o,h,l,c,v]=[p.open,p.max,p.min,p.close,p.Trading_Volume].map(num);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||[o,h,l,c,v].some(x=>x==null)||!(l>0&&l<=Math.min(o,c)&&h>=Math.max(o,c))||v<0)continue;
  byDate.set(date,{date,open:o,high:h,low:l,close:c,volume_shares:v});
 }
 const candles=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
 if(!candles.length)throw Error('找不到有效的開高低收行情');
 const rawFlow=new Map();
 for(const item of institutions){
  const date=String(item.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
  // Prefer FinMind's documented *Wide dataset: one row per trading date.
  // Explicit zero-valued categories are returned as 0; absent days are still null.
  if(Object.prototype.hasOwnProperty.call(item,'Foreign_Investor_buy')){
   const fields=['Foreign_Investor','Foreign_Dealer_Self','Investment_Trust','Dealer','Dealer_self','Dealer_Hedging'];
   const amounts={};
   let valid=true;
   for(const group of fields){
    const buy=num(item[group+'_buy']),sell=num(item[group+'_sell']);
    if(buy==null||sell==null){valid=false;break;}
    amounts[group]=(buy-sell)/1000;
   }
   if(!valid)continue;
   rawFlow.set(date,{foreign:amounts.Foreign_Investor+amounts.Foreign_Dealer_Self,
    trust:amounts.Investment_Trust,
    dealer:amounts.Dealer+amounts.Dealer_self+amounts.Dealer_Hedging});
   continue;
  }
  // Compatibility with the legacy long-form dataset.
  const name=String(item.name||''),buy=num(item.buy),sell=num(item.sell);
  const key=foreign.has(name)?'foreign':trust.has(name)?'trust':dealer.has(name)?'dealer':null;
  if(!key||buy==null||sell==null)continue;
  if(!rawFlow.has(date))rawFlow.set(date,{foreign:null,trust:null,dealer:null});
  const day=rawFlow.get(date);day[key]=(day[key]??0)+(buy-sell)/1000;
 }
 const closes=candles.map(p=>p.close);
 const [ma5,ma20,ma60,roc5,roc20,rsi14]=[average(closes,5),average(closes,20),
  average(closes,60),roc(closes,5),roc(closes,20),rsi(closes)];
 const points=candles.map((p,i)=>{
  const flow=rawFlow.get(p.date)||{};
  const f=rounded(flow.foreign),t=rounded(flow.trust),d=rounded(flow.dealer);
  return {...p,ma5:ma5[i],ma20:ma20[i],ma60:ma60[i],roc5:roc5[i],roc20:roc20[i],rsi14:rsi14[i],
   foreign:f,trust:t,dealer:d,total:[f,t,d].every(x=>x!=null)?rounded(f+t+d):null};
 });
 const complete=points.filter(p=>p.total!=null),last=points.at(-1),flows={};
 for(const n of [1,5,20]){
  const rows=complete.slice(-n);
  const sum=key=>rows.length?rounded(rows.reduce((a,p)=>a+p[key],0)):null;
  flows['d'+n]={count:rows.length,total:sum('total'),foreign:sum('foreign'),
   trust:sum('trust'),dealer:sum('dealer')};
 }
 const signal=last.ma20==null||last.ma5==null||last.roc20==null?'資料不足':
  last.close>last.ma20&&last.ma5>last.ma20&&last.roc20>0?'偏多':
  last.close<last.ma20&&last.ma5<last.ma20&&last.roc20<0?'偏弱':'盤整';
 return {code,name:code,points,flows,latest_close:last.close,latest_roc20:last.roc20,
  latest_rsi14:last.rsi14,signal,last_price_date:last.date,last_institution_date:complete.at(-1)?.date||null,
  price_adjusted:false,source:'FinMind TaiwanStockPrice + TaiwanStockInstitutionalInvestorsBuySellWide',
  coverage:{price_days:points.length,institution_complete_days:complete.length,
   institution_minimum_met:complete.length>=15},updated_at:new Date().toISOString()};
}
async function getDataset(name,code,start,end,token){
 const params=new URLSearchParams({dataset:name,data_id:code,start_date:start,end_date:end});
 if(token)params.set('token',token);
 const response=await fetch(API+'?'+params.toString(),{signal:AbortSignal.timeout(25000),
  headers:{accept:'application/json'}});
 if(!response.ok)throw Error('FinMind '+name+' HTTP '+response.status);
 const obj=await response.json();
 if(!Array.isArray(obj?.data)||obj.status!=null&&Number(obj.status)!==200)
  throw Error('FinMind '+name+' 回傳異常：'+String(obj?.msg||obj?.status||'unknown').slice(0,120));
 return obj.data;
}
// Clock is Asia/Taipei. Refresh the regular edge cache namespace after 20:00
// on weekdays so four-hour entries created before publication cannot mask
// newly released after-close data. Until today's price + institution are both
// present, use a short TTL to keep retrying without hammering FinMind.
export function taipeiSession(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
   timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
   hour:'2-digit',hourCycle:'h23',weekday:'short'
 }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const date=parts.year+'-'+parts.month+'-'+parts.day;
 const hour=Number(parts.hour),marketWeekday=!['Sat','Sun'].includes(parts.weekday);
 return {date,hour,marketWeekday,postClose:marketWeekday&&hour>=20,
         cacheVersion:date+'-'+(hour>=20?'post':'pre')};
}
const json=(data,status,origin,ttl=0)=>new Response(JSON.stringify(data),{status,
 headers:{'content-type':'application/json;charset=utf-8','access-control-allow-origin':origin,
  vary:'Origin','x-content-type-options':'nosniff',
  'cache-control':ttl?'public,max-age=300,s-maxage='+ttl:'no-store'}});
export default {async fetch(request,env,ctx){
 const url=new URL(request.url),requestOrigin=request.headers.get('Origin');
 const allowed=String(env.ALLOWED_ORIGIN||'https://th0509.github.io').replace(/\/$/,'');
 const localhost=/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin||'');
 const origin=requestOrigin&&(requestOrigin===allowed||(env.ALLOW_LOCALHOST==='true'&&localhost))?requestOrigin:allowed;
 if(requestOrigin&&origin!==requestOrigin)return json({error:'不允許的網頁來源'},403,allowed);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
  'access-control-allow-origin':origin,'access-control-allow-methods':'GET,OPTIONS',
  'access-control-allow-headers':'content-type','access-control-max-age':'86400',vary:'Origin'}});
 if(request.method!=='GET')return json({error:'僅支援 GET'},405,origin);
 if(url.pathname==='/api/health')return json({status:'ok',source:'FinMind',now:new Date().toISOString()},200,origin);
 const match=/^\/api\/stock\/(\d{4,6})$/.exec(url.pathname);
 if(!match)return json({error:'找不到 API 路徑'},404,origin);
 const code=match[1],force=url.searchParams.get('refresh')==='1';
 const session=taipeiSession();
 // Namespace rollover at Taiwan 20:00 invalidates pre-announcement entries.
 // Manual refresh still has an independent 5-minute per-stock edge cache.
 const standardKey=new Request(url.origin+url.pathname+'?session='+session.cacheVersion);
 const refreshKey=new Request(url.origin+url.pathname+'?manual=1&session='+session.cacheVersion);
 const key=force?refreshKey:standardKey;
 const cached=await caches.default.match(key);
 if(cached){const response=new Response(cached.body,cached);
  response.headers.set('access-control-allow-origin',origin);
  response.headers.set('vary','Origin');
  response.headers.set('access-control-expose-headers','x-radar-cache-status');
  response.headers.set('x-radar-cache-status',force?'manual-refresh-cache':'regular-cache');
  return response;}
 const end=new Date().toISOString().slice(0,10);
 const start=new Date(Date.now()-430*86400000).toISOString().slice(0,10);
 try{
  const [p,i]=await Promise.all([
   getDataset('TaiwanStockPrice',code,start,end,env.FINMIND_TOKEN),
   getDataset('TaiwanStockInstitutionalInvestorsBuySellWide',code,start,end,env.FINMIND_TOKEN)]);
  const stock=buildStock(code,p,i);
  const freshToday=stock.last_price_date===session.date
    && stock.last_institution_date===session.date;
  // During the expected after-close release window, check again if still stale.
  // Outside trading days keep the normal longer TTL.
  const regularTTL=session.postClose&&!freshToday?900:14400;
  stock.feed_status={latest_price_date:stock.last_price_date,
    latest_institution_date:stock.last_institution_date,
    taipei_date:session.date,
    today_complete:freshToday,
    checked_after_20:session.postClose,
    cache_seconds:force?300:regularTTL};
  const response=json(stock,200,origin,force?300:regularTTL);
  response.headers.set('access-control-expose-headers','x-radar-cache-status');
  response.headers.set('x-radar-cache-status','upstream-fetched');
  // Update normal cache after a forced refresh, so next ordinary stock visit stays fresh.
  if(force){
    const regular=json(stock,200,origin,regularTTL);
    ctx.waitUntil(Promise.all([
      caches.default.put(refreshKey,response.clone()),
      caches.default.put(standardKey,regular.clone())
    ]));
  }else{
    ctx.waitUntil(caches.default.put(standardKey,response.clone()));
  }
  return response;
 }catch(e){return json({error:String(e?.message||'來源暫時無法取得'),code},502,origin);}
}};
