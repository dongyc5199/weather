import test from 'node:test';
import assert from 'node:assert/strict';
import { ForecastTimeline } from './forecast-timeline.js';

const a={id:'a'}, b={id:'b'}, c={id:'c'};
function harness(dwell=2000){
  const loads=[];
  const timeline=new ForecastTimeline((frame,signal)=>new Promise((resolve,reject)=>{
    loads.push({frame,signal,resolve,reject});
  }),()=>{},dwell);
  return {timeline,loads};
}
test('an old request cannot advance or reschedule after seeking or pausing',async()=>{
  const {timeline:t,loads}=harness();
  t.catalog([a,b,c],c);
  const play=t.play();assert.equal(t.pending.id,'a');
  const seek=t.seek(1);assert.ok(loads[0].signal.aborted);
  loads[0].resolve();await play;assert.equal(t.current,'c');assert.equal(t.pending.id,'b');
  loads[1].resolve();await seek;assert.equal(t.current,'b');assert.equal(t.timer,null);
  const again=t.play();t.pause();loads[2].resolve();await again;
  assert.equal(t.current,'b');assert.equal(t.playing,false);assert.equal(t.timer,null);
});
test('the next dwell starts only after the current frame has finished loading',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {timeline,loads}=harness(100);
  timeline.catalog([a,b],b);
  const first=timeline.play();t.mock.timers.tick(500);assert.equal(loads.length,1);
  loads[0].resolve();await first;assert.equal(timeline.current,'a');
  t.mock.timers.tick(99);assert.equal(loads.length,1);
  t.mock.timers.tick(1);assert.equal(loads[1].frame.id,'b');
  timeline.pause();loads[1].resolve();
});
test('live refresh preserves a pinned frame and recovers when it expires',async()=>{
  const {timeline:t,loads}=harness();t.catalog([a,b],b);
  const pin=t.seek(0);loads[0].resolve();await pin;
  t.catalog([a,b,c],c);assert.equal(t.current,'a');assert.equal(loads.length,1);
  const fallback=t.catalog([b,c],c);assert.equal(t.pending.id,'c');
  loads[1].resolve();await fallback;assert.equal(t.current,'c');assert.ok(t.following);
});
test('failed transition leaves the displayed frame intact and permits retry',async()=>{
  const {timeline:t,loads}=harness();t.catalog([a,b],b);
  const play=t.play();loads[0].reject(new Error('missing field'));await play;
  assert.equal(t.error.message,'missing field');assert.equal(t.current,'b');assert.equal(t.playing,false);
  const retry=t.play();loads[1].resolve();await retry;assert.equal(t.current,'a');t.pause();
  t.catalog([a],a);await t.play();assert.equal(t.playing,false);
});
test('a level with no usable frames stays idle until a complete generation is available',async()=>{
  const {timeline:t,loads}=harness();
  t.catalog([],undefined,'legacy');await t.play();
  assert.equal(t.latest,undefined);assert.equal(t.playing,false);assert.equal(loads.length,0);
  const loaded=t.catalog([a],a,'legacy');assert.equal(t.pending.id,'a');
  loads[0].resolve();await loaded;assert.equal(t.current,'a');
});

test('rate changes keep dwell progress and take effect only after a pending frame is ready', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let now=0;
  t.mock.method(performance,'now',()=>now);
  const {timeline,loads}=harness();
  timeline.catalog([a,b,c],c);
  const first=timeline.play();
  timeline.setRate(.5);
  t.mock.timers.tick(8000);
  assert.equal(loads.length,1);
  loads[0].resolve();await first;
  now=2000;t.mock.timers.tick(2000); // half of the four-second slow dwell
  timeline.setRate(4); // half of the new 500 ms dwell remains
  t.mock.timers.tick(249);assert.equal(loads.length,1);
  t.mock.timers.tick(1);assert.equal(loads[1].frame.id,'b');
  timeline.pause();loads[1].resolve();
});

test('continuous scrubbing starts loads before release, coalesces positions and ignores stale responses', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {timeline,loads}=harness();
  const frames=[a,b,c,{id:'d'},{id:'e'}];
  timeline.catalog(frames,frames.at(-1));
  const autoplay=timeline.play();
  timeline.seek(1,{scrubbing:true});assert.ok(loads[0].signal.aborted);
  t.mock.timers.tick(80);timeline.seek(2,{scrubbing:true});
  t.mock.timers.tick(40);assert.equal(loads[1].frame.id,'c');
  timeline.seek(3,{scrubbing:true});assert.ok(loads[1].signal.aborted);
  timeline.seek(3);assert.equal(loads[2].frame.id,'d'); // release flushes the window
  timeline.seek(3);assert.equal(loads.length,3); // no second load of the same frame
  loads[2].resolve();await Promise.resolve();
  loads[1].resolve();loads[0].resolve();await autoplay;
  t.mock.timers.tick(6000);assert.equal(timeline.current,'d');assert.equal(loads.length,3);
  assert.equal(timeline.playing,false);assert.equal(timeline.following,false);
});

test('latest or an expired selection cancels a queued scrub', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {timeline,loads}=harness();
  timeline.catalog([a,b,c],c);
  timeline.seek(0,{scrubbing:true});await timeline.live();
  timeline.seek(0,{scrubbing:true});await timeline.catalog([b,c],c);
  t.mock.timers.tick(200);assert.equal(loads.length,0);assert.equal(timeline.queued,null);
  assert.equal(timeline.current,'c');assert.ok(timeline.following);
});
test('a prepared scrub frame is applied within input dispatch without a timer',async()=>{
  let shown;
  const t=new ForecastTimeline(frame=>{shown=frame.id},()=>{},2000,()=>true);
  t.catalog([a,b,c],c);
  const first=t.seek(0,{scrubbing:true});
  assert.equal(shown,'a');assert.equal(t.timer,null);assert.equal(t.queued,null);
  const latest=t.seek(1,{scrubbing:true});assert.equal(shown,'b');
  await Promise.all([first,latest]);assert.equal(t.current,'b');
});
