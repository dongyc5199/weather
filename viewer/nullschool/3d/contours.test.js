import test from "node:test";
import assert from "node:assert/strict";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import {
  marchContours,
  contoursGeoJSON,
  heightContourInput,
  pressureContourInput,
  scalarAt,
  ContourTask,
} from "./contours.js";
import { ContourLayer, contourHeight } from "./contour-layer.js";
import { geometricHeight } from "./weather.js";

const fixture = (values, nx = 3, ny = 3, extra = {}) => ({
  header: { nx, ny, lo1: 0, la1: ny - 1, dx: 1, dy: 1 },
  values: Float64Array.from(values),
  interval: 1,
  kind: "height",
  layer: "500hPa",
  wrapX: false,
  ...extra,
});

test("Marching squares produces a closed contour and retains gaps at missing cells", () => {
  const input = fixture([0, 0, 0, 0, 2, 0, 0, 0, 0]);
  const result = marchContours(input);
  const loop = result.contours.find((line) => line.value === 1);
  assert.equal(loop.closed, true);
  assert.equal(loop.points.length, 15);
  assert.deepEqual([...loop.points.slice(0, 3)], [...loop.points.slice(-3)]);
  input.values[0] = NaN;
  const cut = marchContours(input).contours.find((line) => line.value === 1);
  assert.equal(cut.closed, false);
  assert.equal(cut.points.length, 12);
});

test("Saddle cases use the bilinear decider instead of crossing contour segments", () => {
  for (const [values, connectedCorner] of [
    [[2, -1, -1, 2], "right"],
    [[1, -2, -2, 1], "left"],
  ]) {
    const result = marchContours(fixture(values, 2, 2, { interval: 10 }));
    assert.equal(result.contours.length, 2);
    const top = result.contours.find(
      (line) => line.points[1] === 1 || line.points[4] === 1,
    );
    assert.ok(
      [...top.points]
        .filter((_, i) => i % 3 === 0)
        .includes(connectedCorner === "right" ? 1 : 0),
    );
  }
});

test("Shared boundary contours are not duplicated at exact grid values", () => {
  const result = marchContours(fixture([0, 1, 0, 0, 1, 0, 0, 1, 0]));
  assert.equal(result.segmentCount, 2);
  assert.equal(result.contours.length, 1);
});

test("Periodic contour edges join at zero longitude and GeoJSON splits at the date line", () => {
  const input = fixture([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0], 4, 3, {
    wrapX: true,
  });
  input.header.dx = 90;
  const loop = marchContours(input).contours.find((line) => line.value === 1);
  assert.equal(loop.closed, true);
  const geojson = contoursGeoJSON({
    contours: [
      {
        value: 1004,
        points: new Float64Array([179, 10, 0, 181, 12, 0, 182, 13, 0]),
      },
    ],
  });
  assert.equal(geojson.features.length, 2);
  assert.deepEqual(geojson.features[0].geometry.coordinates.at(-1), [180, 11]);
  assert.deepEqual(geojson.features[1].geometry.coordinates[0], [-180, 11]);
});

const header = {
  nx: 4,
  ny: 3,
  lo1: 0,
  la1: 90,
  dx: 90,
  dy: 90,
  refTime: "2026-11-09T00:00:00Z",
  forecastTime: 3,
  layer: "500hPa",
  pressureLevelHpa: 500,
};
const record = (value, extra = {}) => ({
  header: { ...header, ...extra },
  data: Array(12).fill(value),
});
function profile() {
  return {
    layer: "500hPa",
    height: record(5500, { parameterUnit: "gpm" }),
    orography: record(1000, { layer: "surface" }),
    surface_pressure: record(85000, { layer: "surface", parameterUnit: "Pa" }),
  };
}

test("Height contours use raw HGT, screen underground samples, and reject a different forecast", () => {
  const source = profile();
  source.surface_pressure.data[5] = 48000;
  const input = heightContourInput(source, header);
  assert.equal(input.interval, 60);
  assert.equal(input.values[0], 5500);
  assert.equal(input.mask[5], 0);
  source.height.header.forecastTime = 4;
  assert.throws(() => heightContourInput(source, header), /时次/);
});

test("Sea-level contours require PRMSL and convert Pa to hPa exactly once", () => {
  const pressure = record(101200, {
    layer: "mean_sea_level",
    levelType: "meanSea",
    parameterUnit: "Pa",
    parameterCategory: 3,
    parameterNumber: 1,
  });
  const source = { snapshot: "same", reference: "mean sea level", pressure };
  const input = pressureContourInput(source, header, "same");
  assert.equal(input.interval, 4);
  assert.equal(input.values[0], 1012);
  assert.equal(scalarAt(pressure, -180, -90), 101200);
  assert.throws(() => pressureContourInput(source, header, "other"), /快照/);
  pressure.header.layer = "surface";
  assert.throws(() => pressureContourInput(source, header, "same"), /海平面/);
});

test("Changing height scale moves contour geometry without changing its numerical value", () => {
  const input = fixture(
    [5400, 5520, 5640, 5400, 5520, 5640, 5400, 5520, 5640],
    3,
    3,
    { interval: 60, ground: new Float64Array(9).fill(1000) },
  );
  const result = marchContours(input);
  const layer = new ContourLayer(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    { kind: "height", color: "#ffd166", opacity: 1 },
  );
  layer.setData(result);
  const first = layer.line.geometry.attributes.instanceStart;
  const before = WGS84_ELLIPSOID.getPositionElevation(
    new THREE.Vector3().fromBufferAttribute(first, 0),
  );
  const values = result.contours.map((line) => line.value);
  layer.setHeightScale(20);
  const after = WGS84_ELLIPSOID.getPositionElevation(
    new THREE.Vector3().fromBufferAttribute(first, 0),
  );
  assert.ok(after > before + 70000);
  assert.deepEqual(
    result.contours.map((line) => line.value),
    values,
  );
  assert.equal(contourHeight(5500, 1000, 1), geometricHeight(5500));
  layer.clear();
  assert.equal(layer.group.visible, false);
});

test("Cancelled contour workers cannot restore an obsolete field", async () => {
  const workers = [];
  const task = new ContourTask(() => {
    const worker = {
      postMessage() {},
      terminate() {
        this.terminated = true;
      },
    };
    workers.push(worker);
    return worker;
  });
  const first = task.run(fixture([0, 1, 0, 1], 2, 2));
  const second = task.run(fixture([0, 1, 0, 1], 2, 2));
  assert.equal(await first, null);
  workers[0].onmessage({ data: { result: "old" } });
  workers[1].onmessage({ data: { result: "current" } });
  assert.equal(await second, "current");
  assert.ok(workers.every((worker) => worker.terminated));
});

test("Far-side contour labels are culled before displaying whole text annotations", () => {
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 1, 1e8);
  camera.position.set(WGS84_ELLIPSOID.radius.x + 4000000, 0, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const layer = new ContourLayer(new THREE.Scene(), camera, {
    kind: "height",
    color: "#ffd166",
    opacity: 1,
  });
  layer.labelMaterial = () => ({
    material: new THREE.SpriteMaterial({ depthTest: false }),
    width: 60,
    height: 20,
  });
  layer.setData({
    kind: "height",
    layer: "500hPa",
    interval: 60,
    segmentCount: 4,
    contours: [
      { value: 5580, points: new Float64Array([0, -1, 0, 0, 0, 0, 0, 1, 0]) },
      {
        value: 5700,
        points: new Float64Array([180, -1, 0, 180, 0, 0, 180, 1, 0]),
      },
    ],
  });
  layer.enabled = true;
  layer.update(1000, 1280, 720);
  assert.deepEqual(layer.getState().labels, [5580]);
  assert.equal(layer.lineMaterial.depthTest, true);
});
