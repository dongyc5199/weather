import test from "node:test";
import assert from "node:assert/strict";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { geometricHeight, gridSampler, windDisplayHeight } from "./weather.js";
import {
  TemperatureLayer,
  temperatureField,
  sampleTemperature,
  temperatureHeightRange,
  intersectTemperature,
  windSpeedField,
} from "./temperature.js";
import { heightContourInput, marchContours } from "./contours.js";

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

const vectors = (layer = "500hPa") => [
  record(3, { layer, parameterCategory: 2, parameterNumber: 2 }),
  record(4, { layer, parameterCategory: 2, parameterNumber: 3 }),
];

test("Wind speed interpolates U/V before magnitude and matches the particle sampler", () => {
  const { profile } = data(),
    wind = vectors();
  wind[0].data[0] = wind[0].data[4] = 10;
  wind[0].data[1] = wind[0].data[5] = -10;
  wind[1].data.fill(0);
  const field = windSpeedField(wind, profile);
  const midpoint = sampleTemperature(field, 45, 45);
  assert.equal(midpoint.speed, 0); // Averaging magnitudes would incorrectly report 10 m/s.
  const grid = gridSampler(wind, [record(280)]);
  for (const [lon, lat] of [
    [0, 45],
    [22.5, 30],
    [180, -45],
    [-180, 30],
  ])
    assert.ok(
      Math.abs(
        sampleTemperature(field, lon, lat).speed - grid.sample(lon, lat).speed,
      ) < 1e-6,
    );
});

test("Wind-speed surface shares pressure heights, but surface wind remains 10 m above ground", () => {
  for (const layer of ["surface", "500hPa"]) {
    const { profile } = data(layer),
      field = windSpeedField(vectors(layer), profile);
    const grid = gridSampler(vectors(layer), [record(280, { layer })]);
    grid.setHeightProfile(profile);
    for (const scale of [1, 20]) {
      const point = sampleTemperature(field, 90, 0, scale);
      assert.equal(point.speed, 5);
      assert.ok(
        Math.abs(
          point.height - windDisplayHeight(layer, grid.heightAt(90, 0), scale),
        ) < 1e-6,
      );
    }
  }
});

test("Wind speed rejects mismatched components and masks missing vectors", () => {
  const { profile } = data();
  for (const mutate of [
    (v) => v[1].header.forecastTime++,
    (v) => {
      v[1].header.layer = "850hPa";
    },
    (v) => {
      v[1].header.parameterNumber = 2;
    },
    (v) => v[1].data.pop(),
  ]) {
    const wind = vectors();
    mutate(wind);
    assert.throws(() => windSpeedField(wind, profile));
  }
  const wind = vectors();
  wind[1].data[5] = null;
  assert.equal(
    sampleTemperature(windSpeedField(wind, profile), 100, -10),
    null,
  );
});

test("Terrain depth is shared by both fill types and is owned by the compositor", () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  const speed = new TemperatureLayer(scene, camera, { kind: "wind" });
  const temp = new TemperatureLayer(scene, camera);
  const { profile } = data();
  speed.setData(vectors(), profile);
  const disposed = [];
  for (const name of ["fieldMap", "vectorMap"])
    speed.uniforms[name].value.addEventListener("dispose", () =>
      disposed.push(name),
    );
  const depth = new THREE.DepthTexture(1, 1);
  let depthDisposed = false;
  depth.addEventListener("dispose", () => {
    depthDisposed = true;
  });
  speed.setTerrainDepth(depth, { far: 1e8, logarithmic: true });
  temp.setTerrainDepth(depth, { far: 1e8, logarithmic: true });
  assert.equal(speed.material.depthTest, false);
  assert.equal(temp.material.depthTest, false);
  speed.setTerrainDepth(null);
  assert.equal(speed.material.depthTest, true);
  speed.clear();
  assert.deepEqual(disposed, ["fieldMap", "vectorMap"]);
  assert.equal(depthDisposed, false);
});
function data(layer = "500hPa") {
  const temperature = record(280, { layer });
  const profile = {
    layer,
    orography: record(1000, { layer: "surface" }),
    surface_pressure: record(85000, { layer: "surface" }),
    height: layer === "surface" ? null : record(5500, { layer }),
  };
  return { temperature, profile };
}

test("Temperature follows the same forecast HGT as wind, including vertical exaggeration", () => {
  const { temperature, profile } = data();
  // A varying pressure surface must not become a constant-height sphere.
  profile.height.data[5] = 5700;
  const field = temperatureField(temperature, profile);
  const wind = gridSampler([record(3), record(4)], [temperature]);
  wind.setHeightProfile(profile);
  for (const scale of [1, 10, 20]) {
    const value = sampleTemperature(field, 60, 30, scale);
    assert.ok(
      Math.abs(
        value.height -
          windDisplayHeight("500hPa", wind.heightAt(60, 30), scale),
      ) < 0.01,
    );
    assert.ok(Math.abs(value.temperature - 6.85) < 0.001);
    assert.ok(
      temperatureHeightRange(field, scale).max >
        temperatureHeightRange(field, scale).min,
    );
  }
});

test("Surface temperature is 2 m above model ground and stays there when height scale changes", () => {
  const { temperature, profile } = data("surface");
  const field = temperatureField(temperature, profile);
  for (const scale of [1, 20]) {
    const value = sampleTemperature(field, 90, 0, scale);
    assert.ok(Math.abs(value.height - geometricHeight(1000) - 2) < 1e-6);
  }
});

test("Fill still masks genuinely missing data instead of bridging gaps", () => {
  for (const change of [
    (t, p) => {
      t.data[5] = null;
    },
    (t, p) => {
      p.height.data[5] = null;
    },
  ]) {
    const { temperature, profile } = data();
    change(temperature, profile);
    const field = temperatureField(temperature, profile);
    assert.equal(field.valid, 11);
    assert.equal(sampleTemperature(field, 100, -10), null);
    assert.ok(sampleTemperature(field, 250, -10));
  }
});

test("Below-ground pressure values remain available for ground-clamped fill", () => {
  const { temperature, profile } = data();
  profile.orography.data[5] = 6000;
  profile.surface_pressure.data[5] = 48000;
  const field = temperatureField(temperature, profile);
  assert.equal(field.valid, 12);
  assert.equal(field.belowGroundNodes, 1);
  const point = sampleTemperature(field, 90, 0);
  assert.ok(Math.abs(point.height - geometricHeight(6000)) < 0.001);
  assert.equal(point.geopotential, 5500);
  assert.ok(point.clampedToGround);
  const actual = sampleTemperature(field, 90, 0, 1, { terrainHeight: 7000 });
  assert.equal(actual.height, 7000);
});

test("Picking chooses the actual higher ground while leaving the native HGT value intact", () => {
  const camera = new THREE.PerspectiveCamera(),
    layer = new TemperatureLayer(new THREE.Scene(), camera);
  const { temperature, profile } = data();
  layer.setData(temperature, profile);
  layer.setPalette({
    stops: [200, 300],
    colors: [
      [0, 0, 255],
      [255, 0, 0],
    ],
  });
  layer.setTerrainDepth(new THREE.DepthTexture(1, 1));
  layer.enabled = true;
  layer.update();
  const origin = WGS84_ELLIPSOID.getCartographicToPosition(
    0,
    0,
    100000,
    new THREE.Vector3(),
  );
  const ray = new THREE.Ray(origin, new THREE.Vector3(-1, 0, 0));
  const highGround = WGS84_ELLIPSOID.getCartographicToPosition(
    0,
    0,
    6500,
    new THREE.Vector3(),
  );
  const hit = layer.pick(ray, highGround);
  assert.ok(hit.clampedToGround);
  assert.ok(Math.abs(hit.height - 6500) < 0.01);
  assert.equal(layer.sample(0, 0, hit.terrainHeight).geopotential, 5500);
  const lowGround = WGS84_ELLIPSOID.getCartographicToPosition(
    0,
    0,
    1000,
    new THREE.Vector3(),
  );
  assert.ok(
    Math.abs(layer.pick(ray, lowGround).height - geometricHeight(5500)) < 0.01,
  );
});

test("A nearby building below an upper layer occludes picking the distant fill", () => {
  const layer = new TemperatureLayer(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
  );
  const { temperature, profile } = data();
  layer.setData(temperature, profile);
  layer.setPalette({
    stops: [200, 300],
    colors: [
      [0, 0, 255],
      [255, 0, 0],
    ],
  });
  layer.setTerrainDepth(new THREE.DepthTexture(1, 1));
  layer.enabled = true;
  layer.update();
  const origin = WGS84_ELLIPSOID.getCartographicToPosition(
    0,
    0,
    1000,
    new THREE.Vector3(),
  );
  const ray = new THREE.Ray(origin, new THREE.Vector3(1, 0, 0));
  assert.ok(layer.pick(ray)); // The high layer is visible through unobstructed sky.
  const roof = WGS84_ELLIPSOID.getCartographicToPosition(
    0,
    0,
    1200,
    new THREE.Vector3(),
  );
  assert.equal(layer.pick(ray, roof), null);
});

test("Ground-clamped coloring cannot change contour values, gaps or generated lines", () => {
  const { temperature, profile } = data();
  profile.height.header.parameterUnit = "gpm";
  profile.surface_pressure.header.parameterUnit = "Pa";
  profile.height.data = profile.height.data.map((_, i) => 5400 + (i % 4) * 80);
  profile.orography.data[5] = 6000;
  profile.surface_pressure.data[5] = 48000;
  const original = structuredClone(profile),
    before = heightContourInput(profile, temperature.header);
  const field = temperatureField(temperature, profile);
  sampleTemperature(field, 90, 0, 20, { terrainHeight: 7000 });
  assert.equal(field.valid, 12);
  const after = heightContourInput(profile, temperature.header);
  assert.equal(before.mask[5], 0);
  assert.equal(after.mask[5], 0);
  assert.deepEqual(profile, original);
  assert.deepEqual(marchContours(after), marchContours(before));
});

test("Temperature cannot combine a different layer, forecast time or grid with its heights", () => {
  for (const change of [
    (p) => {
      p.layer = "850hPa";
    },
    (p) => {
      p.height.header.layer = "850hPa";
    },
    (p) => {
      p.height.header.forecastTime++;
    },
    (p) => {
      p.orography.header.dx = 45;
    },
    (p) => {
      p.surface_pressure.data.pop();
    },
  ]) {
    const { temperature, profile } = data();
    change(profile);
    assert.throws(() => temperatureField(temperature, profile), /不一致/);
  }
});

test("Temperature interpolation wraps the date line and includes both poles", () => {
  const { temperature, profile } = data();
  const field = temperatureField(temperature, profile);
  assert.deepEqual(
    sampleTemperature(field, -180, 30),
    sampleTemperature(field, 180, 30),
  );
  assert.ok(sampleTemperature(field, 120, 90));
  assert.ok(sampleTemperature(field, 120, -90));
});

test("Picking intersects the elevated temperature surface and rejects the far side below it", () => {
  const { temperature, profile } = data();
  const field = temperatureField(temperature, profile);
  const origin = WGS84_ELLIPSOID.getCartographicToPosition(
    0,
    0,
    100000,
    new THREE.Vector3(),
  );
  const ray = new THREE.Ray(origin, new THREE.Vector3(-1, 0, 0));
  const hit = intersectTemperature(
    field,
    ray,
    1,
    temperatureHeightRange(field, 1).max,
  );
  assert.ok(Math.abs(hit.height - geometricHeight(5500)) < 0.001);
  assert.ok(hit.distance < 100000 - 5000);
  ray.origin.copy(
    WGS84_ELLIPSOID.getCartographicToPosition(0, 0, 2000, new THREE.Vector3()),
  );
  assert.equal(
    intersectTemperature(field, ray, 1, temperatureHeightRange(field, 1).max),
    null,
  );
  ray.direction.set(1, 0, 0);
  assert.ok(
    intersectTemperature(field, ray, 1, temperatureHeightRange(field, 1).max),
  );
});

test("Temperature releases stale data immediately and is independent of basemap geometry", () => {
  const scene = new THREE.Scene(),
    layer = new TemperatureLayer(scene, new THREE.PerspectiveCamera());
  const { temperature, profile } = data();
  layer.setPalette({
    stops: [200, 300],
    colors: [
      [0, 0, 255],
      [255, 0, 0],
    ],
  });
  layer.enabled = true;
  layer.setData(temperature, profile);
  layer.update();
  assert.equal(layer.mesh.parent, scene);
  assert.equal(layer.mesh.visible, true);
  assert.equal(layer.material.depthTest, true);
  const texture = layer.uniforms.fieldMap.value;
  let disposed = false;
  texture.addEventListener("dispose", () => {
    disposed = true;
  });
  layer.clear();
  layer.update();
  assert.equal(disposed, true);
  assert.equal(layer.mesh.visible, false);
  assert.equal(layer.getState().layer, null);
});
