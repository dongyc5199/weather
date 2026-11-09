import test from "node:test";
import assert from "node:assert/strict";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { WindViewportSeeder } from "./wind-seeding.js";
import { advectWind } from "./weather.js";

const RAD = Math.PI / 180;
function cameraFor({
  aspect = 16 / 9,
  lat = 34.34,
  lon = 108.94,
  heading = 0,
  roll = 0,
  top = false,
  altitude = 180000,
  distance = 380000,
} = {}) {
  const camera = new THREE.PerspectiveCamera(42, aspect, 100, 1e9);
  const target = WGS84_ELLIPSOID.getCartographicToPosition(
    lat * RAD,
    lon * RAD,
    0,
    new THREE.Vector3(),
  );
  const east = new THREE.Vector3(),
    north = new THREE.Vector3(),
    up = new THREE.Vector3();
  WGS84_ELLIPSOID.getEastNorthUpAxes(lat * RAD, lon * RAD, east, north, up);
  camera.position.copy(target).addScaledVector(up, top ? 7000000 : altitude);
  if (!top)
    camera.position
      .addScaledVector(north, -distance * Math.cos(heading * RAD))
      .addScaledVector(east, distance * Math.sin(heading * RAD));
  camera.up.copy(top ? north : up);
  camera.lookAt(target);
  camera.rotateZ(roll * RAD);
  camera.updateMatrixWorld();
  return camera;
}

for (const options of [
  { aspect: 16 / 9 },
  { aspect: 32 / 9 },
  { aspect: 0.45 },
  { heading: 90 },
  { heading: 180, roll: 32 },
  { altitude: 60000, distance: 600000 },
  { altitude: 500000, distance: 100000 },
]) {
  test(`Full visible wind surface is seeded at ${JSON.stringify(options)}`, () => {
    const camera = cameraFor(options),
      seeder = new WindViewportSeeder(camera, () => 55000);
    seeder.maxHeight = 55000;
    seeder.prepare(1700);
    const surface = WGS84_ELLIPSOID.clone();
    surface.radius.addScalar(55000);
    const raycaster = new THREE.Raycaster(),
      hit = new THREE.Vector3();
    let expected = 0,
      actual = 0;
    const columns = new Set();
    for (let i = 0; i < 1700; i++) {
      const cell = seeder.cells[i],
        x = cell.x + cell.width / 2,
        y = cell.y + cell.height / 2;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      if (!surface.intersectRay(raycaster.ray, hit) || seeder.occluded(hit))
        continue;
      expected++;
      const seed = seeder.seed(i, () => 0.5);
      assert.ok(seed, `Missing visible screen cell at ${x}, ${y}`);
      const point = WGS84_ELLIPSOID.getCartographicToPosition(
        seed.lat * RAD,
        seed.lon * RAD,
        seed.height,
        new THREE.Vector3(),
      ).project(camera);
      assert.ok(Math.abs(point.x - x) < 0.012 && Math.abs(point.y - y) < 0.012);
      columns.add(Math.min(9, Math.floor((x + 1) * 5)));
      actual++;
    }
    assert.ok(expected > 500);
    assert.equal(actual, expected);
    assert.equal(columns.size, 10, "coverage must reach both horizontal edges");
  });
}

test("Tilted sampling follows varying HGT rather than a fixed-height shell", () => {
  const camera = cameraFor({ aspect: 2.5 });
  const heightAt = (lon, lat) =>
    45000 + 8000 * Math.sin(lon * RAD) * Math.cos(lat * RAD);
  const seeder = new WindViewportSeeder(camera, heightAt);
  seeder.maxHeight = 53000;
  seeder.prepare(1700);
  for (const y of [-0.9, -0.5, 0, 0.35])
    for (const x of [-0.95, -0.6, 0, 0.6, 0.95]) {
      const point = seeder.atScreen(x, y);
      assert.ok(point, `missing ${x},${y}`);
      assert.ok(Math.abs(point.height - heightAt(point.lon, point.lat)) < 1e-6);
    }
});

test("Pan, roll and resize use the current camera; particles leaving their screen region recycle", () => {
  const camera = cameraFor(),
    seeder = new WindViewportSeeder(camera, () => 5500);
  seeder.maxHeight = 5500;
  seeder.prepare(1700);
  const index = 200,
    seed = seeder.seed(index, () => 0.5);
  assert.ok(seed);
  const point = WGS84_ELLIPSOID.getCartographicToPosition(
    seed.lat * RAD,
    seed.lon * RAD,
    seed.height,
    new THREE.Vector3(),
  );
  assert.equal(seeder.inCell(point, index), true);
  camera.rotateZ(Math.PI / 2);
  camera.aspect = 3;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  assert.equal(seeder.prepare(1700), true);
  assert.equal(seeder.inCell(point, index), false);
  const centerCell = seeder.cells.findIndex(
    (c) => c.x <= 0 && c.x + c.width > 0 && c.y <= 0 && c.y + c.height > 0,
  );
  assert.ok(seeder.seed(centerCell, () => 0.5));
  assert.equal(seeder.prepare(1700), false);
});

test("Missing data, sky and the far side of an exaggerated shell stay empty", () => {
  const camera = cameraFor(),
    seeder = new WindViewportSeeder(camera, () => 5500);
  seeder.maxHeight = 5500;
  seeder.prepare(1700);
  assert.equal(seeder.atScreen(0, 0.99), null);
  seeder.heightAt = () => NaN;
  assert.equal(seeder.atScreen(0, 0), null);
  seeder.heightAt = () => 600000;
  seeder.maxHeight = 600000;
  assert.equal(
    seeder.atScreen(0, 0),
    null,
    "do not seed through Earth when inside the shell",
  );
});

test("Dateline and polar views retain their visible seeds", () => {
  for (const options of [
    { lon: 179.8, lat: 10, top: true },
    { lon: 20, lat: 89.5, top: true },
  ]) {
    const camera = cameraFor(options),
      seeder = new WindViewportSeeder(camera, () => 5500);
    seeder.maxHeight = 5500;
    seeder.prepare(1700);
    for (const x of [-0.4, 0, 0.4]) assert.ok(seeder.atScreen(x, 0));
  }
  const acrossPole = advectWind(20, 89.9, 0, 100, 500);
  assert.ok(Number.isFinite(acrossPole.lon) && acrossPole.lat < 90);
  const acrossDateLine = advectWind(179.9, 0, 100, 0, 500);
  assert.ok(acrossDateLine.lon > 180 && Math.abs(acrossDateLine.lat) < 1e-8);
});
