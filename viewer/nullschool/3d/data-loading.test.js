import test from "node:test";
import assert from "node:assert/strict";
import { DataLoader, immutableData } from "./data-loading.js";
const base="/data/live/20261116T06Z-f009-0p5-v2/";
test("Snapshot data is decoded once while status is always fetched live", async()=>{
 const calls=[];const loader=new DataLoader(async(url,options)=>{calls.push({url,options});return new Response('{"id":1}');});
 const first=await loader.json(base+"wind.json");
 assert.equal(await loader.json(base+"wind.json"),first);
 await loader.json('/api/earth/status');await loader.json('/api/earth/status');
 assert.equal(calls.length,3);assert.equal(calls[0].options.cache,'default');assert.equal(calls[1].options.cache,'no-store');
 assert.equal(immutableData('/api/earth/3d/photorealistic'),false);
});
test("Cancelled and failed requests cannot poison the snapshot cache",async()=>{
 let calls=0;const loader=new DataLoader(async()=>++calls===1?new Response('bad',{status:502}):new Response('[1]'));
 await assert.rejects(loader.json(base+'wind.json'),/502/);
 assert.deepEqual(await loader.json(base+'wind.json'),[1]);
 const controller=new AbortController();controller.abort();
 await assert.rejects(loader.json(base+'wind.json',1000,controller.signal),{name:'AbortError'});
 assert.equal(calls,2);
});
test("Decoded data has a bounded LRU budget and never crosses snapshots",async()=>{
 let calls=0;const loader=new DataLoader(async()=>{calls++;return new Response('[1,2]');},{maxBytes:15});
 await loader.json(base+'wind.json');await loader.json(base+'temp.json');await loader.json(base+'wind.json');
 assert.equal(calls,3);assert.equal(loader.metrics().entries,1);
 await loader.json(base.replace('f009','f010')+'wind.json');assert.equal(calls,4);
});
test("A compressed binary field is cached as bytes without numeric JSON conversion",async()=>{
 let calls=0;const bytes=new Uint8Array([0,0,0,60,0,56,0,60]);
 const loader=new DataLoader(async()=>{calls++;return new Response(bytes);});
 const url='/api/earth/3d/cloud-shape/20261116T12Z-f003-0p5-v2/field.bin';
 const first=await loader.binary(url);assert.deepEqual(new Uint8Array(first),bytes);
 assert.equal(await loader.binary(url),first);assert.equal(calls,1);
 const controller=new AbortController();controller.abort();
 await assert.rejects(loader.binary(url,1000,controller.signal),{name:'AbortError'});
});

test("Concurrent fills count an immutable response only once toward the cache budget", async () => {
  const loader = new DataLoader(async () => new Response("[1]"), {maxBytes: 18});
  const url = base + "wind.json";
  await Promise.all([loader.json(url), loader.json(url)]);
  assert.equal(loader.metrics().requests, 1);
  // Independently cancellable requests may both finish and replace the same entry.
  const other = base + "temp.json";
  await Promise.all([new AbortController(), new AbortController()].map(c => loader.json(other, 25000, c.signal)));
  await loader.json(base + "temp.json");
  assert.equal(loader.bytes, 18);
  assert.equal(loader.metrics().entries, 2);
  assert.deepEqual(new Uint8Array(await loader.binary(url)), new TextEncoder().encode("[1]"));
});
