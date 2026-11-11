import test from "node:test";
import assert from "node:assert/strict";
import {
  gridSampler,
  geometricHeight,
  windDisplayHeight,
  WindLayer,
} from "./weather.js";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { fetchMapResource } from "./map-runtime.js";

const header = {
  nx: 4,
  ny: 3,
  lo1: 0,
  la1: 90,
  dx: 90,
  dy: 90,
  refTime: "2026-11-07T18:00:00Z",
  forecastTime: 4,
  layer: "500hPa",
  pressureLevelHpa: 500,
};
const record = (value, extra = {}) => ({
  header: { ...header, ...extra },
  data: Array(12).fill(value),
});
const grid = () => gridSampler([record(3), record(4)], [record(280)]);
const profile = () => ({
  layer: "500hPa",
  orography: record(1000, { layer: "surface" }),
  surface_pressure: record(85000, { layer: "surface" }),
  height: record(5500),
});

function animatedWind() {
  const camera = new THREE.PerspectiveCamera(42, 1.5, 100, 1e8);
  WGS84_ELLIPSOID.getCartographicToPosition(
    0.55,
    1.8,
    4000000,
    camera.position,
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const previousDocument = globalThis.document;
  const previousStyle = globalThis.getComputedStyle;
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (key) => (key.endsWith("color") ? "#ffffff" : "0.8"),
  });
  let wind;
  try {
    wind = new WindLayer(new THREE.Scene(), camera, null, {
      capacity: 128,
      steps: 32,
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousStyle;
  }
  const g = grid();
  g.setHeightProfile(profile());
  wind.setViewport(1200, 800);
  wind.setGrid(g);
  for (let i = 0; i < 4; i++) wind.update(0.04);
  assert.ok(wind.birth.some((value) => value > 0));
  return wind;
}

test("Point selection and a held pointer keep wind flowing without clearing its history", () => {
  const wind = animatedWind();
  const births = wind.birth.slice();
  const time = wind.material.uniforms.time.value;
  wind.setMoving(true);
  wind.update(0.04);
  assert.equal(wind.lines.visible, true);
  assert.ok(wind.material.uniforms.time.value > time);
  assert.ok(wind.birth.some((value) => value > time));
  assert.ok(wind.birth.some((value, i) => value > 0 && value === births[i]));
  // Holding longer than the tail lifetime must keep supplying fresh segments.
  for (let i = 0; i < 60; i++) wind.update(0.04);
  assert.ok(Math.abs(Math.max(...wind.birth) - wind.clock) < 0.001);
  assert.ok(wind.lastHeights.count > wind.count * 0.8);
  const heldBirths = wind.birth.slice();
  wind.setMoving(false);
  assert.deepEqual(wind.birth, heldBirths);
});

test("Animation keeps a 40 ms remainder and recovers from slow frames without stale trails", () => {
  const wind = animatedWind(),
    cursor = wind.cursor;
  for (let i = 0; i < 60; i++) wind.update(1 / 60);
  assert.equal(wind.cursor, (cursor + 25) % wind.steps);
  assert.ok(Math.abs(wind.tick) < 1e-6);
  for (let i = 0; i < 30; i++) wind.update(0.1);
  assert.ok(wind.tick < 0.04);
  assert.ok(Math.abs(Math.max(...wind.birth) - wind.clock) < 0.001);
});

test("Dragging hides wind until release, then replaces the old hemisphere's trails", () => {
  const wind = animatedWind();
  const time = wind.clock,
    births = wind.birth.slice();
  wind.setMoving(true);
  wind.camera.position.negate();
  wind.camera.lookAt(0, 0, 0);
  wind.camera.updateMatrixWorld();
  wind.update(0.04);
  assert.equal(wind.lines.visible, false);
  assert.equal(wind.moving, true);
  assert.equal(wind.viewChanging, true);
  assert.deepEqual(wind.birth, births);
  wind.update(0.5); // A stationary pointer is still holding the drag.
  assert.equal(wind.lines.visible, false);
  wind.setMoving(false);
  wind.update(0.1);
  assert.equal(wind.lines.visible, false);
  wind.update(0.2);
  assert.equal(wind.lines.visible, true);
  assert.equal(wind.viewChanging, false);
  assert.ok(wind.seeder.origin.distanceTo(wind.camera.position) < 1e-6);
  assert.ok(wind.lastHeights.count > wind.count * 0.8);
  assert.ok(wind.birth.some((birth) => birth > time));
  assert.ok(wind.birth.every((birth) => birth < 0 || birth > time));
  const point = new THREE.Vector3();
  const visible = wind.particles.slice(0, wind.count).filter((p) => {
    WGS84_ELLIPSOID.getCartographicToPosition(
      (p.lat * Math.PI) / 180,
      (p.lon * Math.PI) / 180,
      p.height,
      point,
    );
    return p.age < p.maxAge && wind.seeder.inView(point);
  });
  assert.ok(visible.length > wind.count * 0.8);
});

test("Wheel bursts and camera damping keep wind hidden until the view settles", () => {
  const wind = animatedWind(),
    oldScale = wind.presentation.bounds.projectionScale;
  wind.setMoving(true);
  wind.setMoving(false); // The controls emit these in one wheel event.
  WGS84_ELLIPSOID.getCartographicToPosition(
    0.55,
    1.8,
    250000,
    wind.camera.position,
  );
  wind.camera.lookAt(0, 0, 0);
  wind.camera.updateMatrixWorld();
  wind.update(1 / 60);
  assert.equal(wind.lines.visible, false);
  assert.equal(wind.overview, false);
  assert.equal(wind.material.depthTest, true);
  assert.ok(wind.presentation.bounds.projectionScale > oldScale * 4);
  // No new input event; inertial camera motion must bypass the idle 250 ms throttle.
  WGS84_ELLIPSOID.getCartographicToPosition(
    0.55,
    1.8,
    7000000,
    wind.camera.position,
  );
  wind.camera.lookAt(0, 0, 0);
  wind.camera.updateMatrixWorld();
  wind.update(1 / 60);
  assert.equal(wind.lines.visible, false);
  assert.equal(wind.overview, true);
  assert.equal(wind.material.depthTest, false);
  assert.ok(wind.presentation.bounds.projectionScale < oldScale);
  const previous = wind.presentation.bounds.projectionScale;
  wind.camera.fov = 30;
  wind.camera.updateProjectionMatrix();
  wind.update(1 / 60);
  assert.ok(wind.presentation.bounds.projectionScale > previous);
  assert.equal(wind.lines.visible, false);
  // Keep moving after the wheel's end event: no premature reappearance.
  for (let i = 0; i < 20; i++) {
    wind.camera.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.001);
    wind.camera.lookAt(0, 0, 0);
    wind.camera.updateMatrixWorld();
    wind.update(1 / 60);
    assert.equal(wind.lines.visible, false);
  }
  wind.update(0.1);
  assert.equal(wind.lines.visible, false);
  wind.update(0.1);
  assert.equal(wind.lines.visible, true);
});

test("Depth-plane adjustments and numerical camera jitter do not hide idle wind", () => {
  const wind = animatedWind();
  wind.camera.near = 10;
  wind.camera.far = 2e8;
  wind.camera.updateProjectionMatrix();
  wind.camera.position.x += 1e-7;
  wind.camera.updateMatrixWorld();
  wind.update(0.04);
  assert.equal(wind.lines.visible, true);
  assert.equal(wind.viewChanging, false);
});

test("Disabling wind during a drag cannot reveal it when the camera settles", () => {
  const wind = animatedWind();
  wind.setMoving(true);
  wind.camera.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.2);
  wind.camera.lookAt(0, 0, 0);
  wind.camera.updateMatrixWorld();
  wind.update(0.04);
  wind.enabled = false;
  wind.setMoving(false);
  wind.update(0.5);
  assert.equal(wind.lines.visible, false);
  const resumeTime = wind.clock;
  wind.enabled = true;
  wind.update(0.04);
  assert.equal(wind.lines.visible, true);
  assert.ok(wind.birth.every((birth) => birth < 0 || birth > resumeTime - 0.1));
});

test("Changing wind appearance retains the live particle positions and trail history", () => {
  const wind = animatedWind(),
    positions = wind.positions.slice(),
    births = wind.birth.slice();
  const grid = wind.grid;
  wind.setLineStyle({
    color: "#00ff00",
    width: 4,
    opacity: 0.5,
    pattern: "dashed",
  });
  wind.updateLineViewport(720);
  assert.deepEqual(wind.positions, positions);
  assert.deepEqual(wind.birth, births);
  assert.equal(wind.grid, grid);
  assert.equal(wind.material.linewidth, 4);
  assert.equal(wind.lines.isLineSegments2, true);
});

test("Changing wind data or display height still clears obsolete trails", () => {
  const wind = animatedWind();
  wind.setHeightScale(2);
  assert.ok(wind.birth.every((value) => value < 0));
  wind.update(0.04);
  assert.ok(wind.birth.some((value) => value > 0));
  wind.setGrid(null);
  wind.update(0.04);
  assert.equal(wind.lines.visible, false);
  assert.ok(wind.birth.every((value) => value < 0));
});

test("GFS layer geometry follows HGT, retains vector direction and wraps the date line", () => {
  const g = grid();
  g.setHeightProfile(profile());
  assert.deepEqual(g.sample(-180, 30), g.sample(180, 30));
  assert.equal(g.sample(100, 30).speed, 5);
  const h = g.heightAt(100, 30);
  assert.ok(Math.abs(h.geopotential - 5500) < 1e-8);
  assert.ok(windDisplayHeight("500hPa", h, 1) > 5500);
  assert.ok(windDisplayHeight("500hPa", h, 1) < 5510);
  assert.ok(windDisplayHeight("500hPa", h, 10) > 45000);
  assert.ok(
    Math.abs(windDisplayHeight("surface", h, 20) - geometricHeight(1000) - 10) <
      1e-8,
  );
});

test("Underground pressure levels and missing height samples do not produce wind lines", () => {
  const g = grid(),
    p = profile();
  p.surface_pressure = record(48000);
  g.setHeightProfile(p);
  assert.equal(g.heightAt(100, 30).belowGround, true);
  assert.ok(Number.isNaN(windDisplayHeight("500hPa", g.heightAt(100, 30))));
  p.height.data.fill(null);
  assert.equal(g.heightAt(100, 30), null);
});

test("Never mix height from another forecast or pressure level", () => {
  const g = grid(),
    p = profile();
  p.height.header.forecastTime++;
  assert.throws(() => g.setHeightProfile(p), /时次/);
  const other = profile();
  other.layer = "850hPa";
  assert.throws(() => g.setHeightProfile(other), /气压层/);
});

test("Temperature queries remain valid without wind vectors and at the polar grid boundary", () => {
  const g = gridSampler([record(null), record(null)], [record(280)]);
  assert.equal(g.sample(100, 30), null);
  for (const latitude of [90, 30, -90])
    assert.ok(Math.abs(g.temperatureAt(100, latitude) - 6.85) < 1e-8);
});

test("Transient tile failures retry, while cancellation never starts another request", async () => {
  let calls = 0;
  const response = await fetchMapResource(
    "https://example.test/tile",
    {},
    async () => {
      calls++;
      return new Response("", { status: calls === 1 ? 503 : 200 });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchMapResource(
      "https://example.test/tile",
      { signal: controller.signal },
      () => {
        throw new Error("must not fetch");
      },
    ),
    { name: "AbortError" },
  );
});

test("A failure after response headers retries the body transfer", async () => {
  let calls = 0;
  const response = await fetchMapResource(
    "https://example.test/tile",
    {},
    async () => {
      calls++;
      if (calls === 1)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("connection lost during body"));
            },
          }),
        );
      return new Response("complete tile");
    },
  );
  assert.equal(await response.text(), "complete tile");
  assert.equal(calls, 2);
});
