import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LineStyleStore,
  LINE_STYLE_KEY,
  readLineStyleDefaults,
  normalizeColor,
  dashPattern,
} from "./line-styles.js";
import { StyledGeoJSONOverlay } from "./styled-overlays.js";
import { StyledLineSegments } from "./styled-lines.js";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";

const css = readFileSync(
  new URL("../styles/styles.css", import.meta.url),
  "utf8",
);
const vars = new Map(
  [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2]]),
);
const read = (key) =>
  (vars.get(key) || "").replace(/var\((--[\w-]+)\)/g, (_, name) => read(name));
const defaults = () => readLineStyleDefaults(read);
function memory() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function store(storage) {
  const overrides = new Map();
  return {
    overrides,
    preferences: new LineStyleStore({
      defaults: defaults(),
      storage,
      rootStyle: {
        setProperty: (key, value) => overrides.set(key, value),
        removeProperty: (key) => overrides.delete(key),
      },
    }),
  };
}

test("Line defaults come from the shared stylesheet and layer preferences persist independently", () => {
  const storage = memory(),
    first = store(storage);
  assert.equal(first.preferences.get("pressure").width, 1.2);
  assert.equal(first.preferences.get("countries").opacity, 0.95);
  first.preferences.set("wind", {
    color: "#F04",
    width: 3.5,
    opacity: 0.57,
    pattern: "dashed",
  });
  first.preferences.set("height", { labels: false, fontSize: 16 });
  first.preferences.set("rivers", { color: "#86dcff", pattern: "dashed", width: 1.5 });
  assert.equal(first.overrides.get("--earth-wind-color"), "#ff0044");
  const second = store(storage);
  assert.deepEqual(
    second.preferences.get("wind"),
    first.preferences.get("wind"),
  );
  assert.equal(second.preferences.get("height").labels, false);
  assert.equal(second.preferences.get("height").fontSize, 16);
  assert.deepEqual(second.preferences.get("rivers"), first.preferences.get("rivers"));
  assert.equal(
    second.preferences.get("pressure").color,
    defaults().pressure.color,
  );
  const saved = JSON.parse(storage.getItem(LINE_STYLE_KEY));
  assert.equal(saved.layers.pressure, undefined);
  assert.equal(saved.layers.height.color, undefined);
});

test("Reset removes only one layer's overrides and returns to framework defaults", () => {
  const storage = memory(),
    { preferences, overrides } = store(storage);
  preferences.set("wind", { color: "#000000" });
  preferences.set("pressure", { width: 4 });
  preferences.reset("wind");
  assert.deepEqual(preferences.get("wind"), defaults().wind);
  assert.equal(overrides.has("--earth-wind-color"), false);
  assert.equal(preferences.get("pressure").width, 4);
  preferences.reset("pressure");
  assert.equal(storage.getItem(LINE_STYLE_KEY), null);
});

test("Untrusted preferences reject CSS injection, unknown patterns, and unsafe numeric ranges", () => {
  const storage = memory();
  storage.setItem(
    LINE_STYLE_KEY,
    JSON.stringify({
      version: 1,
      layers: {
        wind: {
          color: "url(https://invalid.test/)",
          pattern: "bad; color: red",
          width: 999,
          opacity: -3,
          fontSize: Infinity,
          labels: "false",
        },
        unknown: { color: "red" },
      },
    }),
  );
  const { preferences } = store(storage),
    value = preferences.get("wind");
  assert.equal(value.color, defaults().wind.color);
  assert.equal(value.pattern, "solid");
  assert.equal(value.width, 6);
  assert.equal(value.opacity, 0);
  assert.equal(value.fontSize, 12);
  assert.throws(() => preferences.set("unknown", {}));
  assert.throws(() => preferences.set("__proto__", {}));
  assert.throws(() => preferences.get("constructor"));
  assert.equal(normalizeColor("red"), null);
});

test("Unavailable or damaged storage does not block live line styling", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const { preferences, overrides } = store(blocked);
  preferences.set("height", { color: "#00ff00", pattern: "dotted" });
  assert.equal(preferences.saved, false);
  assert.equal(overrides.get("--earth-height-contour-color"), "#00ff00");
  const damaged = memory();
  damaged.setItem(LINE_STYLE_KEY, "not JSON");
  assert.deepEqual(store(damaged).preferences.get("height"), defaults().height);
});

test("Thick line styles change material and dash geometry without changing scientific positions", () => {
  const positions = new Float32Array([6378137, -10000, 0, 6378137, 10000, 0]);
  const stroke = new StyledLineSegments(positions, defaults().height);
  const before = positions.slice();
  stroke.setStyle({
    ...defaults().height,
    color: "#ff0000",
    width: 5,
    pattern: "dotted",
    opacity: 0.4,
  });
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 1e8);
  camera.position.set(WGS84_ELLIPSOID.radius.x + 100000, 0, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(6378137, 0, 0);
  camera.updateMatrixWorld();
  stroke.updateViewport(camera, 720);
  assert.equal(stroke.object.isLineSegments2, true);
  assert.equal(stroke.material.linewidth, 5);
  assert.equal(stroke.material.dashed, true);
  assert.equal(stroke.material.opacity, 0.4);
  assert.ok(stroke.material.dashSize > 0);
  assert.ok(stroke.distances.every(Number.isFinite));
  assert.deepEqual(positions, before);
  stroke.dispose();
});

test("Raster line patterns redraw cached canvases without fetching or replacing GeoJSON", async () => {
  const geojson = { type: "FeatureCollection", features: [] };
  const overlay = new StyledGeoJSONOverlay({ geojson });
  const renderer = overlay.imageSource._canvasRenderer;
  const calls = [];
  renderer._ctx = { setLineDash: (pattern) => calls.push(pattern) };
  renderer._invScale = 0.5;
  let redraws = 0;
  overlay.isReady = true;
  overlay.redraw = () => redraws++;
  overlay.fetch = () => assert.fail("style changes must not fetch data");
  overlay.setLineStyle({
    color: "#00ff00",
    width: 2,
    opacity: 0.6,
    pattern: "dashed",
  });
  renderer.setStyle({ strokeWidth: 2 });
  assert.deepEqual(
    calls.at(-1),
    dashPattern("dashed", 2, true).map((v) => v * 0.5),
  );
  overlay.setLineStyle({
    color: "#00ff00",
    width: 2,
    opacity: 0.6,
    pattern: "dotted",
  });
  renderer.setStyle({ strokeWidth: 2 });
  assert.deepEqual(calls.at(-1), [0, 3]);
  assert.equal(renderer._ctx.lineCap, "round");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(redraws, 1);
  assert.equal(overlay.geojson, geojson);
});
