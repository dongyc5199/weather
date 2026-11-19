import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaybackCache } from './playback-cache.js';

const turn=()=>new Promise(r=>setImmediate(r));
test('preparation bounds concurrency and keeps shared products across level changes',async()=>{
  const calls=[],frames=[{id:'a'},{id:'b'},{id:'c'}];
  const cache=new PlaybackCache((frame,product,signal)=>new Promise(resolve=>calls.push({frame,product,signal,resolve})),()=>{},2);
  cache.configure(frames,['500hPa','observation'],'b');
  assert.equal(calls.length,2);assert(calls.every(v=>v.frame.id==='b'));
  calls[1].resolve('b-cloud');await turn();
  cache.configure(frames,['700hPa','observation'],'b');
  assert(calls[0].signal.aborted);
  calls[0].resolve('late');await turn();
  for(let i=0;i<calls.length;i++){calls[i].resolve(calls[i].frame.id+'-'+calls[i].product);await turn()}
  assert(!cache.preparing);assert(frames.every(f=>cache.has(f)));
  assert.equal(cache.get(frames[1],'observation'),'b-cloud');assert.equal(cache.get(frames[1],'500hPa'),undefined);
  cache.configure([frames[0]],['700hPa'],'a');assert.equal(cache.values.size,1);
});
test('a failed product excludes just its own frame and retries after backoff',async t=>{
  let now=1000,fail=true;t.mock.method(Date,'now',()=>now);
  const frames=[{id:'a'},{id:'b'}];
  const cache=new PlaybackCache(async f=>{if(f.id==='b'&&fail)throw Error('offline');return f.id},()=>{});
  cache.configure(frames,['surface'],'a');await turn();
  assert(cache.has(frames[0]));assert(!cache.has(frames[1]));assert(!cache.preparing);
  fail=false;now+=31000;cache.configure(frames,['surface'],'a');await turn();
  assert(cache.has(frames[1]));
});
