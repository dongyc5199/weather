import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import {
  windScreenBounds,
  windPresentation,
  windMotionScale,
  windIntensity,
  windSpeedColor,
  WIND_STEP_SECONDS,
  WIND_CAPACITY,
} from "./wind-presentation.js";

function footprint(width, height, altitude = 16000000) {
  const camera = new THREE.PerspectiveCamera(42, width / height, 1, 1e9);
  camera.position.set(WGS84_ELLIPSOID.radius.x + altitude, 0, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return { camera, bounds: windScreenBounds(camera, width, height) };
}

test("Overview density follows the visible globe, not empty sky or framebuffer pixels", () => {
  const a = footprint(1200, 800).bounds;
  const b = footprint(2400, 800).bounds;
  assert.ok(Math.abs(a.width - b.width) < 1e-6);
  assert.ok(Math.abs(a.height - a.width) < 1e-6);
  assert.ok(Math.abs(a.coverage - Math.PI / 4) < 0.03);
  const p = windPresentation(a, { width: 1200 }, 16000000);
  const wide = windPresentation(
    b,
    { width: 2400, devicePixelRatio: 2 },
    16000000,
  );
  assert.equal(p.count, wide.count);
  assert.ok(
    Math.abs(p.expectedVisible - Math.sqrt(a.width * a.height) * 8) < 128,
  );
  assert.ok(
    windPresentation(
      footprint(1200, 800, 32000000).bounds,
      { width: 1200 },
      32000000,
    ).count < p.count,
  );
  assert.ok(
    windPresentation(a, { width: 1200, mobile: true }, 16000000).count <
      p.count,
  );
});

test("Wind motion follows angular zoom, with bounded close-up density and speed", () => {
  const b = footprint(1200, 800).bounds;
  const p = windPresentation(b, { width: 1200 }, 16000000);
  const metersPerDegree = (6371000 * Math.PI) / 180;
  assert.equal(p.timeScale, windMotionScale(b.projectionScale));
  // Live Nullschool, 4309 px/radian, 2026-11-09: measured 0.346 CSS pixels
  // per m/s per simulation step. This rejects the old 0.86 px regional speed.
  const pixelsPerStepPerMps =
    (4309 * windMotionScale(4309) * WIND_STEP_SECONDS) / 6371000;
  assert.ok(Math.abs(pixelsPerStepPerMps - 0.346) < 0.002);
  const degreesPerStep =
    (windMotionScale(4309) * WIND_STEP_SECONDS) / metersPerDegree;
  assert.ok(
    degreesPerStep <
      (windMotionScale(430) * WIND_STEP_SECONDS) / metersPerDegree,
  );
  assert.ok(Math.abs(p.trailSeconds - 1.8) < 1e-10);
  const near = windPresentation(b, { width: 1200 }, 1000);
  assert.ok(near.count < p.count && near.timeScale < p.timeScale);
  assert.equal(near.trailSeconds, 0.65);
  assert.equal(
    windPresentation(
      { width: 8000, height: 4000, coverage: 0.5 },
      { width: 8000 },
      1e7,
    ).count,
    WIND_CAPACITY,
  );
  assert.equal(
    windPresentation({ width: 0, height: 0, coverage: 0 }, { width: 1200 }, 1e7)
      .count,
    0,
  );
});

test("A clipped globe keeps its angular magnification when regional zoom changes", () => {
  const a = footprint(1280, 720, 1400000).bounds;
  const b = footprint(1280, 720, 700000).bounds;
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  assert.ok(Math.abs(b.projectionScale / a.projectionScale - 2) < 0.001);
  assert.ok(
    windMotionScale(b.projectionScale) < windMotionScale(a.projectionScale),
  );
});

test("Projected bounds stay clipped when the globe is off-center or behind the camera", () => {
  const { camera } = footprint(1200, 800);
  camera.rotateY(0.2);
  camera.updateMatrixWorld();
  const shifted = windScreenBounds(camera, 1200, 800);
  assert.ok(shifted.box.every((v) => v >= -1 && v <= 1));
  assert.ok(Math.abs(shifted.box[0] + shifted.box[2]) > 0.1);
  camera.rotateY(Math.PI);
  camera.updateMatrixWorld();
  assert.equal(windScreenBounds(camera, 1200, 800).width, 0);
});

test("Wind fill palette agrees with the bundled classic implementation", () => {
  const context = vm.createContext({
    URL,
    document: {
      currentScript: { src: "http://localhost/libs/earth/1.0.0/micro.js" },
    },
    navigator: { userAgent: "test" },
    Backbone: { Model: { extend: () => function () {} } },
  });
  vm.runInContext(
    readFileSync(
      new URL("../libs/earth/1.0.0/micro.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  for (let speed = 0; speed <= 100; speed += 0.25) {
    const expected = context.µ.extendedSinebowColor(speed / 100, 255);
    windSpeedColor(speed).forEach((value, i) =>
      assert.ok(Math.abs(value - expected[i]) <= 1),
    );
  }
});

test("Particle intensity uses a fine 0–15 m/s ramp without the old 1 m/s bands", () => {
  for (const [speed, grey] of [
    [0, 85],
    [7.5, 170],
    [15, 255],
    [50, 255],
  ]) {
    const color = new THREE.Color().setRGB(windIntensity(speed), 0, 0);
    assert.ok(
      Math.abs(color.getRGB({}, THREE.SRGBColorSpace).r * 255 - grey) < 0.01,
    );
  }
  assert.ok(windIntensity(7.4) < windIntensity(7.5));
  assert.ok(windIntensity(7.5) < windIntensity(7.6));
});
