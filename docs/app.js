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
  const rows=s.points.filter(p=>p.total!==null).slice(-12).reverse();
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
$('refresh').addEventListener('click',load);
$('periodTabs').addEventListener('click',e=>{
  const btn=e.target.closest('button[data-period]');if(!btn)return;
  period=Number(btn.dataset.period);
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));
  if(selected)renderCharts(payload.stocks[selected]);
});
load();
// Page checks for a newly deployed static snapshot; does not fetch live market quotes.
setInterval(load,15*60*1000);
