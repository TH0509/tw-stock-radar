import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import Worker from '../worker/index.mjs';

test('manual refresh bypasses normal four-hour cache but rate-limits to a five-minute edge cache', async()=>{
 const cache=new Map(), pending=[];
 const url=req=>typeof req==='string'?req:req.url;
 globalThis.caches={default:{
  match:async req=>cache.get(url(req))?.clone(),
  put:async(req,response)=>{cache.set(url(req),response.clone());}
 }};
 let upstream=0;
 const candles=Array.from({length:90},(_,i)=>({
  date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
  open:100+i,max:105+i,min:95+i,close:102+i,Trading_Volume:120000
 }));
 const institutional=candles.map(({date})=>({date,
  Foreign_Investor_buy:2000,Foreign_Investor_sell:1000,
  Foreign_Dealer_Self_buy:0,Foreign_Dealer_Self_sell:0,
  Investment_Trust_buy:1000,Investment_Trust_sell:500,
  Dealer_buy:0,Dealer_sell:0,Dealer_self_buy:500,Dealer_self_sell:250,
  Dealer_Hedging_buy:300,Dealer_Hedging_sell:100
 }));
 const previous=globalThis.fetch;
 globalThis.fetch=async(req)=>{
  upstream++;
  const u=new URL(url(req));
  return new Response(JSON.stringify({status:200,data:u.searchParams.get('dataset')==='TaiwanStockPrice'?candles:institutional}),{
   status:200,headers:{'content-type':'application/json'}
  });
 };
 const ctx={waitUntil:p=>pending.push(p)};
 const endpoint='https://example.workers.dev/api/stock/2330';
 const request=async suffix=>Worker.fetch(new Request(endpoint+suffix,{
  headers:{Origin:'https://th0509.github.io'}}),{ALLOWED_ORIGIN:'https://th0509.github.io'},ctx);
 try{
  let res=await request('');
  assert.equal(res.status,200);
  assert.equal(res.headers.get('x-radar-cache-status'),'upstream-fetched');
  await Promise.all(pending.splice(0));
  assert.equal(upstream,2);
  res=await request('');
  assert.equal(res.headers.get('x-radar-cache-status'),'regular-cache');
  assert.equal(upstream,2);
  res=await request('?refresh=1');
  assert.equal(res.headers.get('x-radar-cache-status'),'upstream-fetched');
  await Promise.all(pending.splice(0));
  assert.equal(upstream,4);
  res=await request('?refresh=1');
  assert.equal(res.headers.get('x-radar-cache-status'),'manual-refresh-cache');
  assert.equal(upstream,4);
 }finally{
  globalThis.fetch=previous;
 }
});
test('refresh button preserves current ticker and explains when live API is unavailable',()=>{
 const here=dirname(fileURLToPath(import.meta.url));
 const app=fs.readFileSync(resolve(here,'../docs/app.js'),'utf8');
 assert.match(app,/loadV2\(\{manual:true\}\)/);
 assert.match(app,/const previousCode=selected/);
 assert.match(app,/options\.manual\?'\?refresh=1'/);
 assert.match(app,/外部金融 API 尚未連接/);
});
