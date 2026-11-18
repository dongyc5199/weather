import test from "node:test";
import assert from "node:assert/strict";
import { pressureAltitude, cloudBandTexture } from "./cloud-data.js";
function band() {
  const header = {
    nx: 4,
    ny: 1,
    dx: 90,
    dy: 90,
    lo1: 0,
    la1: 90,
    refTime: "2026-11-11T00:00Z",
    forecastTime: 3,
  };
  const record = (data) => ({ header: { ...header }, data });
  return {
    cover: record([100, 0, null, 70]),
    bottom: record([90000, 90000, 90000, 50000]),
    top: record([70000, 70000, 70000, 70000]),
  };
}
test("Cloud reconstruction preserves clear, missing and inverted vertical columns", () => {
  const result = cloudBandTexture(band());
  assert.equal(result.cloudy, 1);
  assert.equal(result.pixels[0], 1);
  assert.equal(result.pixels[4], 0);
  assert.equal(result.pixels[11], 0);
  assert.equal(result.pixels[15], 0);
  assert.ok(result.pixels[2] > result.pixels[1]);
});
test("Cloud bands from another grid or forecast must never be mixed", () => {
  for (const key of ["forecastTime", "nx", "refTime"]) {
    const b = band();
    b.top.header[key] = "other";
    assert.throws(() => cloudBandTexture(b), /identity/);
  }
  const b = band();
  b.top.data.pop();
  assert.throws(() => cloudBandTexture(b), /Incomplete/);
});
test("Pressure altitude handles missing values rather than inventing a cloud height", () => {
  assert.equal(pressureAltitude(null), null);
  assert.equal(pressureAltitude(0), null);
  assert.equal(pressureAltitude(NaN), null);
  assert.ok(Math.abs(pressureAltitude(101325)) < 1);
  assert.ok(pressureAltitude(25000) > pressureAltitude(50000));
});

test("Cloud detail follows camera altitude continuously and never scales cloud heights", async () => {
  const { cloudViewDetail } = await import("./cloud-data.js");
  assert.equal(cloudViewDetail(16000000).mode, "cloud-cover");
  assert.equal(cloudViewDetail(1000000).mode, "cloud-cover");
  for (const altitude of [100000, 300000, 1000000])
    assert.equal(cloudViewDetail(altitude).volume, 0);
  assert.equal(cloudViewDetail(50000).mode, "layered");
  assert.equal(cloudViewDetail(10000).mode, "volume");
  let previous = cloudViewDetail(0).volume;
  for (let altitude = 100; altitude <= 100000; altitude += 100) {
    const current = cloudViewDetail(altitude).volume;
    assert.ok(current <= previous && current >= 0 && current <= 1);
    assert.ok(Math.abs(current - previous) < 0.01);
    previous = current;
  }
  assert.equal(cloudViewDetail(NaN).volume, 0);
});

test("Known coverage survives masked cloud heights for the orbital projection only", () => {
  const input = band();
  input.top.data[0] = null;
  const result = cloudBandTexture(input);
  assert.equal(result.pixels[0], 1);
  assert.equal(result.pixels[3], 0);
  assert.equal(result.cloudy, 0);
});

test("A satellite overview fades out below its viewing altitude regardless of model availability",async()=>{
 const {cloudViewDetail}=await import('./cloud-data.js');
 for(const altitude of [0,1000,6000,12000,25000]) assert.equal(cloudViewDetail(altitude).satellite,0);
 assert.equal(cloudViewDetail(65000).satellite,1);
 assert.equal(cloudViewDetail(16000000).satellite,1);
 for(let altitude=0;altitude<=100000;altitude+=1000){const d=cloudViewDetail(altitude);assert.ok(Math.abs(d.volume+d.satellite-1)<1e-9);}
});
test("Motion budgets stay bounded on Retina and restore stationary detail",async()=>{
 const {cloudRenderPlan}=await import('./cloud-data.js');
 const moving=cloudRenderPlan(3024,1900,1,true),still=cloudRenderPlan(3024,1900,1,false);
 assert.equal(moving.width,448);assert.equal(moving.steps,64);
 assert.equal(still.width,768);assert.equal(still.steps,128);
 assert.ok(Math.abs(moving.width/moving.height-3024/1900)<.01);
 assert.equal(cloudRenderPlan(3024,1900,0,true).steps,0);
 assert.equal(cloudRenderPlan(3024,1900,.001,true).width,2048);
 assert.equal(cloudRenderPlan(3024,1900,.1,true).width,448); // The orbital image stays detailed during initial volume fade.
});
