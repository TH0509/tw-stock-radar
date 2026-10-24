import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildStock} from '../worker/index.mjs';
const d=i=>new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10);
const candles=Array.from({length:90},(_,i)=>({date:d(i),open:100+i,max:105+i,min:95+i,close:102+i,Trading_Volume:100000}));
const inst=candles.map(({date})=>({date,
 Foreign_Investor_buy:3000,Foreign_Investor_sell:1000,
 Foreign_Dealer_Self_buy:0,Foreign_Dealer_Self_sell:0,
 Investment_Trust_buy:6000,Investment_Trust_sell:1000,
 Dealer_buy:0,Dealer_sell:0,
 Dealer_self_buy:500,Dealer_self_sell:1000,
 Dealer_Hedging_buy:700,Dealer_Hedging_sell:200}));
test('90 real K lines, MA5/20/60 and 15+ days of all 3 investor groups',()=>{
 const result=buildStock('3017',candles,inst);
 assert.equal(result.points.length,90);
 assert.equal(result.coverage.institution_complete_days,90);
 assert.equal(result.coverage.institution_minimum_met,true);
 assert.equal(result.points[0].open,100);
 assert.equal(result.points[0].high,105);
 assert.equal(result.points[59].ma60,131.5);
 assert.equal(result.points[70].foreign,2);
 assert.equal(result.points[70].trust,5);
 assert.equal(result.points[70].dealer,0);
 assert.equal(result.points[70].total,7);
 assert.equal(result.flows.d5.count,5);
 assert.equal(result.flows.d5.total,35);
});
test('missing trading day remains null and correctly warns when fewer than 15 complete days',()=>{
 const result=buildStock('3017',candles,inst.slice(0,12));
 assert.equal(result.coverage.institution_complete_days,12);
 assert.equal(result.coverage.institution_minimum_met,false);
 assert.equal(result.points[30].trust,null);
 assert.equal(result.points[30].total,null);
});
test('invalid artificial candles are rejected instead of plotted',()=>{
 assert.throws(()=>buildStock('3017',[{date:d(0),open:100,max:90,min:80,close:99,Trading_Volume:0}],[]));
});
