'use strict';
const $ = (id) => document.getElementById(id);
let payload = null;
let selected = null;
let period = 66;
let charts = [];
const fmt = (n, max = 2) => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('zh-TW', {maximumFractionDigits:max});
const signed = (v, suffix = '') => v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : ''}${fmt(v)}${suffix}`;
const tone = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
function paintNumber(id, v, suffix = '', prefixSign = false) {
  const el = $(id); el.textContent = prefixSign ? signed(v, suffix) : (v == null ? '—' : fmt(v) + suffix);
  el.classList.remove('up', 'down'); if (v != null) el.classList.add(tone(v));
}
function notice(message) { const el = $('status'); el.textContent = message; el.hidden = !message; }
function clearCharts() { charts.forEach(c => c.destroy()); charts = []; }
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
  $('tableCaption').textContent=`法人資料截至 ${s.last_institution_date || '—'} · 單位：張`;
  renderCharts(s); renderTable(s);
}
function renderCharts(s) {
  clearCharts();
  const points=period===0?s.points:s.points.slice(-period);
  const labels=points.map(p=>p.date.slice(5));
  const line=(label,key,color,extra={})=>({label, data:points.map(p=>p[key]), borderColor:color,backgroundColor:color,pointRadius:0,borderWidth:2,spanGaps:false,tension:.2,...extra});
  createChart('priceChart',{type:'line',data:{labels,datasets:[
    line('收盤價','close','#8bb6ff',{borderWidth:2.6}),line('MA5','ma5','#50caa3'),line('MA20','ma20','#e9c57d'),line('MA60','ma60','#ac92ef')]},
    options:{...chartBase,plugins:chartBase.plugins,scales:{...chartBase.scales,y:axisOptions('新臺幣')}}});
  createChart('momentumChart',{type:'line',data:{labels,datasets:[
    line('ROC20 (%)','roc20','#7eafff',{yAxisID:'y'}),line('RSI14','rsi14','#e9c57d',{yAxisID:'rsi'})]},
    options:{...chartBase,scales:{x:chartBase.scales.x,y:axisOptions('ROC %'),rsi:{...axisOptions('RSI','right'),min:0,max:100,grid:{display:false}}}}});
  const bars=[['外資','foreign','#70acfa'],['投信','trust','#56d2b1'],['自營商','dealer','#e9c47f']]
    .map(([label,key,color])=>({type:'bar',label,data:points.map(p=>p[key]),backgroundColor:color,borderRadius:1,maxBarThickness:20,stack:'institutional'}));
  createChart('instChart',{type:'bar',data:{labels,datasets:bars},options:{...chartBase,scales:{x:{...chartBase.scales.x,stacked:true},y:{...axisOptions('張'),stacked:true}}}});
}
function renderTable(s) {
  const body=$('instTable');body.replaceChildren();
  const rows=s.points.filter(p=>p.foreign!==null||p.total!==null).slice(-12).reverse();
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
$('refresh').addEventListener('click',loadV2);
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
  selectOrMissing(code);
  $('watchCode').value='';
}
function removeCode(code){
  userList=userList.filter(x=>x!==code);saveCodes();
  if(selected===code){selected=null;if(userList.length)selectOrMissing(userList[0]);else{$('stockName').textContent='目前沒有自選股';clearCharts();}}
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
   button.append(icon,title);button.onclick=()=>selectOrMissing(code);
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
function selectOrMissing(code){
 const c=$('coverageNote');c.hidden=true;
 if(payload?.stocks?.[code]){select(code);if(payload.stocks[code].snapshot_only){c.hidden=false;c.textContent=`此股可用 ${payload.stocks[code].points.length} 個交易日的盤後資料；部分法人日期或 MA60 可能不足，缺少的指標以「—」表示。`;}return;}
 selected=code;renderList();clearCharts();$('stockName').textContent=code+'｜尚無分析資料';$('stockCode').textContent=code;
 $('lastDate').textContent='資料不足';$('signal').textContent='資料不足';
 for(const id of ['vClose','vRoc','vRsi','vFlow'])paintNumber(id,null);
 $('instTable').replaceChildren();c.hidden=false;c.textContent='已加入自選股，但目前未取得此代號的官方市場資料。網站不會產生虛構股價。';
}
function renderScreen(){
 const body=$('screenTable');body.replaceChildren();
 if(marketData?.status!=='ok'){$('screenStatus').textContent='市場掃描暫時無法使用：'+(marketData?.error||'資料尚未發布')+'。不代表沒有符合條件的股票。';return;}
 const codes=marketData.matches||[];
 $('screenStatus').textContent='上市／上櫃個股最新資料：'+marketData.date+'｜符合條件 '+codes.length+' 檔；排除 ETF（範圍依官方資料供應情況）';
 if(!codes.length){const row=body.insertRow(),cell=row.insertCell();cell.colSpan=4;cell.textContent='目前沒有符合全部條件的上市股票';return;}
 for(const code of codes){
   const item=marketData.stocks[code];if(!item)continue;
   const row=body.insertRow();row.insertCell().textContent=code+' '+item.name;
   row.insertCell().textContent=item.days.slice(1).map(d=>signed(d.foreign)).join(' / ');
   row.insertCell().textContent=signed(item.volume_change_pct,'%');
   const button=document.createElement('button');button.type='button';button.className='screen-add';
   button.textContent=userList?.includes(code)?'✓ 已追蹤':'＋ 追蹤';
   button.onclick=()=>userList?.includes(code)?removeCode(code):addCode(code);
   row.insertCell().append(button);
 }
}
async function loadV2(){
 await load();
 try{
   const r=await fetch('./data/screener.json?v='+Date.now(),{cache:'no-store'});
   if(!r.ok)throw new Error('HTTP '+r.status);
   marketData=await r.json();
 }catch(e){marketData={status:'unavailable',error:String(e),stocks:{},matches:[]};}
 if(userList===null){userList=savedCodes();if(userList===null){userList=Object.keys(payload?.stocks||{});saveCodes();}}
 for(const [code,item] of Object.entries(marketData?.stocks||{})){
  if(!payload.stocks[code]){const record=makeCompact(item);if(record)payload.stocks[code]=record;}
 }
 renderScreen();renderList();
 const code=userList.includes(selected)?selected:userList[0];
 if(code)selectOrMissing(code);else{$('stockName').textContent='請新增自選股票';clearCharts();}
}
$('watchForm').addEventListener('submit',e=>{e.preventDefault();addCode($('watchCode').value.trim());});
loadV2();
setInterval(loadV2,15*60*1000);
