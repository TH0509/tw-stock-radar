import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taipeiSession} from '../worker/index.mjs';

test('session rotates after 20:00 Taiwan, invalidating stale morning cache',()=>{
 const morning=taipeiSession(new Date('2026-10-23T11:30:00Z'));
 const evening=taipeiSession(new Date('2026-10-23T12:30:00Z'));
 assert.equal(morning.date,'2026-10-23');
 assert.equal(morning.postClose,false);
 assert.equal(evening.postClose,true);
 assert.notEqual(morning.cacheVersion, evening.cacheVersion);
});
test('weekends do not claim a trading-day publication',()=>{
 const saturday=taipeiSession(new Date('2026-10-24T13:30:00Z'));
 assert.equal(saturday.postClose,false);
 assert.equal(saturday.marketWeekday,false);
});
