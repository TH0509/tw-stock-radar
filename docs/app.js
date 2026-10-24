'use strict';
const $ = (id) => document.getElementById(id);
let payload = null;
let selected = null;
let period = 66;
let candleChart = null;
let candleObserver = null;
let latestSelectionRequest = 0;
let charts = [];
const fmt = (n, max = 2) => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('zh-TW', {maximumFractionDigits:max});
const signed = (v, suffix = '') => v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : ''}${fmt(v)}${suffix}`;
const tone = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
function paintNumber(id, v, suffix = '', prefixSign = false) {
  const el = $(id); el.textContent = prefixSign ? signed(v, suffix) : (v == null ? '—' : fmt(v) + suffix);
  el.classList.remove('up', 'down'); if (v != null) el.classList.add(tone(v));
}
function notice(message) { const el = $('status'); el.textContent = message; el.hidden = !message; }
function clearCharts() {
  charts.forEach(c => c.destroy()); charts = [];
  if(candleObserver){candleObserver.disconnect();candleObserver=null;}
  if(candleChart){candleChart.remove();candleChart=null;}
}
function axisOptions(label, position = 'left') {
  return {position, grid:{color:'rgba(104,137,182,.12)'}, border:{display:false}, ticks:{color:'#8497b2',font:{size:10},maxTicksLimit:5}, title:{display:!!label,text:label,color:'#6683a4',font:{size:10}}, beginAtZero:false};
}
function createChart(id, config) {
  if (typeof Chart === 'undefined') { notice('圖表函式庫載入失敗，請確認網路允許存取 jsDelivr CDN。'); return; }
  charts.push(new Chart($(id), config));
}
const chartBase = {
  responsive:true, maintainAspectRatio:false, animation:false,
  interaction:{mode:'index',intersect:false},
  plugins:{legend:{position:'bottom',labels:{color:'#a1b3c9',boxWidth:10,boxHeight:2,padding:18,font:{size:10}}},
           tooltip:{backgroundColor:'#16263d',titleColor:'#eaf3ff',bodyColor:'#dae6f6',borderColor:'#395270',borderWidth:1}},
  scales:{x:{grid:{display:false},border:{display:false},ticks:{color:'#7990ad',maxTicksLimit:7,maxRotation:0,font:{size:10}}},y:axisOptions('NT$')}
};
function renderList() {
  const list = $('tickerList'); list.replaceChildren();
  if (!payload) return;
  const query = $('search').value.trim().toLowerCase();
  const entries = Object.values(payload.stocks).filter(x => x.code.includes(query) || x.name.toLowerCase().includes(query));
  $('tickerCount').textContent = String(Object.keys(payload.stocks).length);
  if (!entries.length) { const s=document.createElement('p');s.style.color='#8fa3bc';s.textContent='沒有符合的股票';list.append(s);return; }
  entries.forEach(stock => {
    const button=document.createElement('button');button.type='button';button.className='ticker'+(selected===stock.code?' active':'');
    const icon=document.createElement('span');icon.className='ticker-icon';icon.textContent=stock.code.slice(-2);
    const name=document.createElement('span');name.className='ticker-name';name.textContent=stock.name;
    const sub=document.createElement('span');sub.className='ticker-sub';sub.textContent=stock.code;name.append(sub);
    const arrow=document.createElement('span');arrow.className='ticker-arrow';arrow.textContent='›';
    button.append(icon,name,arrow); button.onclick=()=>select(stock.code);list.append(button);
  });
}
function select(code) {
  if (!payload?.stocks[code]) return;
  selected = code;
  renderList();
  const s=payload.stocks[code];
  $('stockName').textContent=`${s.name}｜動能與籌碼`;
  $('stockCode').textContent=s.code;
  $('lastDate').textContent=`股價資料：${s.last_price_date}`;
  const badge=$('signal');badge.textContent=s.signal;badge.className='signal-pill'+(s.signal==='偏多'?' bull':s.signal==='偏弱'?' bear':'');
  paintNumber('vClose',s.latest_close);
  paintNumber('vRoc',s.latest_roc20,'%',true);
  paintNumber('vRsi',s.latest_rsi14);
  paintNumber('vFlow',s.flows.d5.total,' 張',true);
  $('flowDate').textContent=`${s.flows.d5.count}/5 個有資料交易日 · 截至 ${s.last_institution_date || '—'}`;
  $('tableCaption').textContent=`法人資料截至 ${s.last_institution_date || '—'} · 最近最多 25 個有資料交易日 · 單位：張`;
  renderCharts(s); renderTable(s);
}
function renderCandleChart(points) {
  const el=$('priceChart');el.replaceChildren();
  const candles=points.filter(p=>[p.open,p.high,p.low,p.close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))
    .map(p=>({time:p.date,open:p.open,high:p.high,low:p.low,close:p.close}));
  if(!candles.length){
    el.textContent='此期間缺少有效的開盤、最高、最低、收盤價，無法繪製真實 K 線。';
    el.classList.add('missing-candles');return;
  }
  el.classList.remove('missing-candles');
  if(typeof LightweightCharts==='undefined'){
    el.textContent='K 線套件無法載入，請檢查網路或瀏覽器限制。';return;
  }
  const style={layout:{background:{type:'solid',color:'#111b2b'},textColor:'#a1b3c9'},
    grid:{vertLines:{color:'#1b2a3e'},horzLines:{color:'#253246'}},
    crosshair:{mode:LightweightCharts.CrosshairMode.Normal},
    rightPriceScale:{borderColor:'#3b4d63'},timeScale:{borderColor:'#3b4d63',timeVisible:false},
    localization:{locale:'zh-TW'},
    width:Math.max(el.clientWidth,320),height:Math.max(el.clientHeight,300)};
  candleChart=LightweightCharts.createChart(el,style);
  // Taiwan market color convention: rising red, falling green.
  const price=candleChart.addCandlestickSeries({
    upColor:'#ff7888',downColor:'#43c9a6',wickUpColor:'#ff7888',
    wickDownColor:'#43c9a6',borderVisible:false,priceLineVisible:false});
  price.setData(candles);
  for(const [key,name,color] of [['ma5','MA5','#5ad5af'],['ma20','MA20','#e9c57d'],['ma60','MA60','#ac92ef']]){
    const data=points.filter(p=>Number.isFinite(p[key])).map(p=>({time:p.date,value:p[key]}));
    if(!data.length)continue;
    const series=candleChart.addLineSeries({title:name,color,lineWidth:2,priceLineVisible:false,
      lastValueVisible:false,crosshairMarkerVisible:false});
    series.setData(data);
  }
  candleChart.timeScale().fitContent();
  if(typeof ResizeObserver!=='undefined'){
    candleObserver=new ResizeObserver(entries=>{
      if(!candleChart)return;
      const r=entries[0].contentRect;
      if(r.width>0)candleChart.applyOptions({width:r.width,height:Math.max(r.height,300)});
    });
    candleObserver.observe(el);
  }
}
function renderCharts(s) {
  clearCharts();
  const points=period===0?s.points:s.points.slice(-period);
  renderCandleChart(points);
  const labels=points.map(p=>p.date.slice(5));
  const line=(label,key,color,extra={})=>({label, data:points.map(p=>p[key]), borderColor:color,backgroundColor:color,pointRadius:0,borderWidth:2,spanGaps:false,tension:.2,...extra});
  createChart('momentumChart',{type:'line',data:{labels,datasets:[
    line('ROC20 (%)','roc20','#7eafff',{yAxisID:'y'}),line('RSI14','rsi14','#e9c57d',{yAxisID:'rsi'})]},
    options:{...chartBase,scales:{x:chartBase.scales.x,y:axisOptions('ROC %'),rsi:{...axisOptions('RSI','right'),min:0,max:100,grid:{display:false}}}}});
  const bars=[['外資','foreign','#70acfa'],['投信','trust','#56d2b1'],['自營商','dealer','#e9c47f']]
    .map(([label,key,color])=>({type:'bar',label,data:points.map(p=>p[key]),backgroundColor:color,borderRadius:1,maxBarThickness:20,stack:'institutional'}));
  createChart('instChart',{type:'bar',data:{labels,datasets:bars},options:{...chartBase,scales:{x:{...chartBase.scales.x,stacked:true},y:{...axisOptions('張'),stacked:true}}}});
}
function renderTable(s) {
  const body=$('instTable');body.replaceChildren();
  const rows=s.points.filter(p=>p.foreign!==null||p.trust!==null||p.dealer!==null).slice(-25).reverse();
  if (!rows.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.textContent='目前沒有法人資料';tr.append(td);body.append(tr);return;}
  rows.forEach(p=>{
    const tr=document.createElement('tr');
    [p.date,p.foreign,p.trust,p.dealer,p.total].forEach((val,i)=>{
      const td=document.createElement('td');td.textContent=i===0?val:signed(val);if (i>0)td.className=tone(val);tr.append(td);
    });body.append(tr);
  });
}
async function load() {
  $('updateTime').textContent='正在同步網站資料…';
  try {
    const r=await fetch(`./data/stocks.json?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const obj=await r.json();
    if(!obj || typeof obj.stocks!=='object')throw new Error('資料結構不正確');
    payload=obj;
    $('updateTime').textContent=obj.generated_at?'產生時間：'+new Date(obj.generated_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未產生真實資料';
    if(obj.demo)notice('示範模式：目前為虛構資料，不能用於行情判斷。');
    else if(!Object.keys(obj.stocks).length) notice('尚未匯入股市資料。請在專案執行 python scripts/update.py，或啟用 GitHub Actions 手動部署。');
    else notice('');
    const codes=Object.keys(obj.stocks);
    if(codes.length){select(obj.stocks[selected]?selected:codes[0]);}
    else {selected=null;clearCharts();$('stockName').textContent='等待首次資料更新';$('lastDate').textContent='尚未取得資料';$('tickerCount').textContent='0';$('tickerList').replaceChildren();}
  } catch(err) {notice(`無法載入分析資料：${err.message}。請先啟動本機網頁伺服器或檢查部署結果。`);$('updateTime').textContent='資料讀取失敗';}
}
$('search').addEventListener('input',renderList);
$('refresh').addEventListener('click',async()=>{
 const button=$('refresh');if(button.disabled)return;
 button.disabled=true;button.textContent='⟳ 更新中…';
 try{await loadV2({manual:true});}
 catch(err){notice('重新載入失敗：'+String(err?.message||err));}
 finally{button.disabled=false;button.textContent='⟳ 更新資料';}
});
$('periodTabs').addEventListener('click',e=>{
  const btn=e.target.closest('button[data-period]');if(!btn)return;
  period=Number(btn.dataset.period);
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));
  if(selected)renderCharts(payload.stocks[selected]);
});


const WATCH_KEY='tw-radar-personal-v1';
let userList=null,marketData=null;
function savedCodes(){try{const r=JSON.parse(localStorage.getItem(WATCH_KEY));return Array.isArray(r)?r.filter(c=>/^\d{4,6}$/.test(c)):null;}catch{return null;}}
function saveCodes(){try{localStorage.setItem(WATCH_KEY,JSON.stringify(userList));}catch{}}
function addCode(code){
  if(!/^\d{4,6}$/.test(code)){alert('請輸入4至6碼股票代號');return;}
  if(!userList.includes(code)){if(userList.length>=200){alert('自選股上限200檔');return;}userList.push(code);saveCodes();}
  renderList();renderScreen();
  void selectOrMissing(code);
  $('watchCode').value='';
}
function removeCode(code){
  userList=userList.filter(x=>x!==code);saveCodes();
  if(selected===code){selected=null;if(userList.length)void selectOrMissing(userList[0]);else{$('stockName').textContent='目前沒有自選股';clearCharts();}}
  renderList();renderScreen();
}
function renderList(){
 const list=$('tickerList');list.replaceChildren();
 const entries=userList||[];const query=$('search').value.trim().toLowerCase();
 $('tickerCount').textContent=String(entries.length);
 for(const code of entries){
   const stock=payload?.stocks?.[code],name=stock?.name||marketData?.stocks?.[code]?.name||'資料待補';
   if(query&&!code.includes(query)&&!name.toLowerCase().includes(query))continue;
   const row=document.createElement('div');row.className='ticker-row';
   const button=document.createElement('button');button.type='button';button.className='ticker'+(selected===code?' active':'');
   const icon=document.createElement('span');icon.className='ticker-icon';icon.textContent=code.slice(-2);
   const title=document.createElement('span');title.className='ticker-name';title.textContent=name;
   const sub=document.createElement('span');sub.className='ticker-sub';sub.textContent=code;title.append(sub);
   button.append(icon,title);button.onclick=()=>void selectOrMissing(code);
   const remove=document.createElement('button');remove.className='ticker-remove';remove.type='button';remove.textContent='×';remove.title='移除自選股';remove.onclick=()=>removeCode(code);
   row.append(button,remove);list.append(row);
 }
 if(query){
   const head=document.createElement('p');head.className='watch-tip';head.textContent='市場搜尋結果（點擊加入自選股）';list.append(head);
   const hits=Object.values(marketData?.stocks||{}).filter(item=>(item.code.includes(query)||item.name.toLowerCase().includes(query))&&!entries.includes(item.code)).slice(0,20);
   for(const item of hits){
     const button=document.createElement('button');button.type='button';button.className='ticker market-result';
     const icon=document.createElement('span');icon.className='ticker-icon';icon.textContent=item.code.slice(-2);
     const name=document.createElement('span');name.className='ticker-name';name.textContent=item.name;
     const detail=document.createElement('span');detail.className='ticker-sub';detail.textContent=item.code+' · '+(item.market==='TPEx'?'上櫃':'上市');name.append(detail);
     button.append(icon,name);button.onclick=()=>{addCode(item.code);$('search').value='';renderList();};list.append(button);
   }
   if(!hits.length){const note=document.createElement('p');note.className='watch-tip';note.textContent='市場資料中沒有其他符合條件的股票。若代號正確，可在上方直接新增。';list.append(note);}
 }
}
function makeCompact(entry){
 const raw=(entry.history?.length?entry.history:entry.days||[]);
 const pts=raw.map(d=>({date:d.date,close:d.close,volume_shares:d.volume_shares??d.volume??null,
    foreign:d.foreign??null,trust:d.trust??null,dealer:d.dealer??null,total:d.total??null,
    ma5:d.ma5??null,ma20:d.ma20??null,ma60:d.ma60??null,
    roc5:d.roc5??null,roc20:d.roc20??null,rsi14:d.rsi14??null}));
 if(!pts.length)return null;
 // If institutional stats are only available in four-day scan, add those to history by date.
 for(const day of entry.days||[]){const p=pts.find(x=>x.date===day.date);if(p){
   p.foreign=day.foreign??p.foreign;p.trust=day.trust??p.trust;
   p.dealer=day.dealer??p.dealer;p.total=day.total??p.total;
 }}
 const last=pts.at(-1),available=pts.filter(p=>p.foreign!=null||p.total!=null);
 const sum=(rows,key)=>rows.length&&rows.every(p=>p[key]!=null)?Math.round(rows.reduce((a,p)=>a+p[key],0)*100)/100:null;
 const flows={};for(const n of [1,5,20]){const recent=available.slice(-n);flows['d'+n]={
   count:recent.length,total:sum(recent,'total'),foreign:sum(recent,'foreign'),trust:sum(recent,'trust'),dealer:sum(recent,'dealer')};}
 let signal='資料不足';
 if(last.close!=null&&last.ma5!=null&&last.ma20!=null&&last.roc20!=null){
   signal=last.close>last.ma20&&last.ma5>last.ma20&&last.roc20>0?'偏多':
          last.close<last.ma20&&last.ma5<last.ma20&&last.roc20<0?'偏弱':'盤整';
 }
 return {code:entry.code,name:entry.name,points:pts,latest_close:last.close,latest_roc20:last.roc20,latest_rsi14:last.rsi14,
   signal,last_price_date:last.date,last_institution_date:available.at(-1)?.date||null,market:entry.market||'TWSE',
   flows,snapshot_only:true};
}
async function selectOrMissing(code,options={}){
 const requestId=++latestSelectionRequest;
 const noticeBox=$('coverageNote');noticeBox.hidden=false;
 const staticDetails=payload?.stocks?.[code];
 const index=marketData?.stocks?.[code];
 let details=null,remoteError='',remoteStatus='';
 let fetchedFromWorker=false;
 const base=String(window.RADAR_API_BASE||'').trim().replace(/\/+$/,'');
 selected=code;renderList();
 if(base){
  noticeBox.textContent='正在向外部金融資料 API 查詢 '+code+' 的 OHLC、MA 與三大法人歷史…';
  try{
   const url=base+'/api/stock/'+encodeURIComponent(code)+(options.manual?'?refresh=1':'');
   const r=await fetch(url,{cache:'no-store',headers:{accept:'application/json'}});
   remoteStatus=r.headers.get('x-radar-cache-status')||'unknown';
   const response=await r.json();
   if(!r.ok)throw new Error(response?.error||'HTTP '+r.status);
   if(response.code!==code||!Array.isArray(response.points)||!response.points.length)
    throw new Error('遠端股票資料不完整');
   response.name=index?.name||staticDetails?.name||code;
   details=response;fetchedFromWorker=true;
   if(!payload)payload={stocks:{}};
   payload.stocks[code]=details;
  }catch(err){remoteError=String(err.message||err);}
 }
 if(requestId!==latestSelectionRequest)return;
 if(!details&&index?.has_detail){
  noticeBox.textContent='正在讀取上次部署的股票歷史快取…';
  try{
   const r=await fetch('./data/market/'+encodeURIComponent(code)+'.json?v=8',{cache:'no-store'});
   if(!r.ok)throw new Error('HTTP '+r.status);
   const obj=await r.json();
   if(obj.code!==code||!Array.isArray(obj.points)||!obj.points.length)
    throw new Error('快取資料格式不正確');
   obj.name=index.name||obj.name;
   if(!payload)payload={stocks:{}};
   payload.stocks[code]=obj;details=obj;
  }catch(err){remoteError+=(remoteError?'；':'')+'歷史快取：'+String(err.message||err);}
 }
 if(!details&&staticDetails)details=staticDetails;
 if(requestId!==latestSelectionRequest)return;
 if(details){
  select(code);
  const valid=details.points?.filter(p=>p.foreign!=null&&p.trust!=null&&p.dealer!=null).length||0;
  const total=details.points?.length||0;
  const cautions=[];
  if(remoteError)cautions.push('即時外部 API 暫時不可用，改顯示上次部署資料：'+remoteError);
  if(total<132)cautions.push('股價歷史只有 '+total+' 個交易日，3／6 月走勢可能不完整');
  if(valid<15)cautions.push('三大法人完整資料目前只有 '+valid+' 個交易日（目標至少 15 日）');
  if(cautions.length){noticeBox.hidden=false;noticeBox.textContent=cautions.join('。')+'。缺值不會補成零。';}
  else noticeBox.hidden=true;
  return {source:fetchedFromWorker?'worker':'published',cache:remoteStatus,
    date:details.last_price_date,institutionDate:details.last_institution_date,requested:code,error:remoteError};
 }
 selected=code;renderList();clearCharts();
 $('stockName').textContent=code+'｜資料無法取得';$('stockCode').textContent=code;
 $('lastDate').textContent='資料不足';$('signal').textContent='資料不足';
 for(const id of ['vClose','vRoc','vRsi','vFlow'])paintNumber(id,null);
 $('instTable').replaceChildren();
 noticeBox.hidden=false;
 noticeBox.textContent='找不到 '+code+' 的 OHLC／法人資料'+(remoteError?'：'+remoteError:'。請先部署外部 API 或檢查市場回補')+'。';
 return {source:'unavailable',requested:code,error:remoteError};
}
function renderScreen(){
 const container=$('screenList');container.replaceChildren();
 if(marketData?.status!=='ok'){
  $('screenStatus').textContent='市場選股暫時無法使用：'+(marketData?.error||'尚未發布資料')+'。不代表沒有符合條件的股票。';
  return;
 }
 const matches=marketData.matches||[];
 $('screenStatus').textContent='最新：'+(marketData.date||'未知日期')+'｜符合 '+matches.length+' 檔';
 if(!matches.length){
  const p=document.createElement('p');p.className='screen-hint';p.textContent='這期沒有符合全部篩選條件的股票。';
  container.append(p);return;
 }
 for(const code of matches){
  const stock=marketData.stocks?.[code];if(!stock)continue;
  const card=document.createElement('div');card.className='signal-card';
  const top=document.createElement('div');top.className='signal-card-head';
  const title=document.createElement('strong');title.textContent=code+' '+stock.name;
  const button=document.createElement('button');button.type='button';button.className='screen-add';
  button.textContent=userList?.includes(code)?'✓ 已追蹤':'＋ 加入';
  button.onclick=()=>userList?.includes(code)?removeCode(code):addCode(code);
  top.append(title,button);
  const details=document.createElement('div');details.className='signal-card-data';
  details.textContent='最新量增 '+signed(stock.volume_change_pct,'%');
  const days=document.createElement('div');days.className='signal-flow-days';
  days.textContent=(stock.days||[]).slice(-3).map(p=>signed(p.foreign)).join('／')+' 張';
  card.append(top,details,days);container.append(card);
 }
}
function indicateLiveStatus(){
 const el=$('apiStatus');if(!el)return;
 const base=String(window.RADAR_API_BASE||'').trim();
 el.textContent=base?'外部金融 API：已設定；每 15 分鐘自動檢查股價與法人資料（盤後更新）':
  '外部金融 API：尚未設定，目前僅顯示已發布的歷史快取';
}
async function loadV2(options={}){
 const manual=options.manual===true;
 const previousCode=selected;
 indicateLiveStatus();
 await load();
 try{
   const r=await fetch('./data/screener.json?v='+Date.now(),{cache:'no-store'});
   if(!r.ok)throw new Error('HTTP '+r.status);
   marketData=await r.json();
 }catch(e){marketData={status:'unavailable',error:String(e),stocks:{},matches:[]};}
 if(userList===null){userList=savedCodes();if(userList===null){userList=Object.keys(payload?.stocks||{});saveCodes();}}
 for(const [code,item] of Object.entries(marketData?.stocks||{})){
  if(!payload.stocks[code] && !item.has_detail){const record=makeCompact(item);if(record)payload.stocks[code]=record;}
 }
 renderScreen();renderList();
 // Do not jump back to one of the original six when users refresh a different stock.
 const code=previousCode&&(userList.includes(previousCode)||payload?.stocks?.[previousCode]||marketData?.stocks?.[previousCode])
   ?previousCode:userList[0];
 const result=code?await selectOrMissing(code,{manual}):null;
 if(!code){$('stockName').textContent='請新增自選股票';clearCharts();}
 if(result?.date){
  $('updateTime').textContent='股價：'+result.date+' ｜ 法人：'+(result.institutionDate||'尚無資料')+' ｜ 每 15 分鐘檢查更新';
 }else if(marketData?.date){
  $('updateTime').textContent='市場資料截至 '+marketData.date+' ｜ 每 15 分鐘檢查更新';
 }
 if(manual){
  const apiConfigured=Boolean(String(window.RADAR_API_BASE||'').trim());
  if(result?.source==='worker'){
   const cache=result.cache==='upstream-fetched'?'已向 FinMind 重新查詢':
    result.cache==='manual-refresh-cache'?'使用最近五分鐘的手動更新快取':
    '讀取 API 快取';
   notice('已更新 '+result.requested+'：'+cache+'。最新行情交易日：'+(result.date||'未知')+'；盤後資料並非即時報價。');
  }else if(!apiConfigured){
   notice('外部金融 API 尚未連接；本次只重新讀取 GitHub Pages 已發布的資料，無法直接向 FinMind 更新。請先設定 RADAR_API_BASE_URL 並重新部署。');
  }else{
   notice('已重新讀取網頁資料，但外部 API 查詢未成功'+(result?.error?'：'+result.error:'')+'。目前顯示的仍可能是上次部署的資料。');
  }
 }
}
$('watchForm').addEventListener('submit',e=>{e.preventDefault();addCode($('watchCode').value.trim());});
loadV2();
setInterval(loadV2,15*60*1000);
