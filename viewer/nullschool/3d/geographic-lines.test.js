import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import {
  geographicGeometry,
  geographyPaths,
  GeographicLineLayer,
  administrativeBoundaries,
} from "./geographic-lines.js";

const line = (coordinates) => ({ type: "LineString", coordinates });
const style = { color: "#eef1f4", width: 1.1, opacity: 0.95, pattern: "solid" };
const options = {
  name: "test boundaries",
  order: 28,
  haloColor: "#06111e",
  haloOpacity: 0.55,
  haloWidth: 1.2,
};

test("Shared jagged province borders are joined once before both LODs simplify", () => {
  const data = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { adcode: 110000 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1.1, 0.5],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: { adcode: 120000 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [1, 0],
              [2, 0],
              [2, 1],
              [1, 1],
              [1.1, 0.5],
              [1, 0],
            ],
          ],
        },
      },
    ],
  };
  const interior = administrativeBoundaries(data, { includeOuter: false });
  assert.equal(interior.coordinates.length, 1);
  assert.equal(geographicGeometry(interior, { maxStep: 10 }).segmentCount, 2);
  assert.equal(
    geographicGeometry(interior, { tolerance: 0.12, maxStep: 10 }).segmentCount,
    1,
  );
  const all = administrativeBoundaries(data);
  assert.ok(geographicGeometry(all, { maxStep: 10 }).segmentCount > 2);
  // City layers omit higher-level shared borders only when that level is on.
  assert.equal(
    administrativeBoundaries(data, { includeOuter: false, withinParent: true })
      .coordinates.length,
    0,
  );
});

test("Actual China province topology omits the external outline when countries are enabled", () => {
  const data = JSON.parse(
    readFileSync(
      new URL("../data/geography/china-provinces.geojson", import.meta.url),
      "utf8",
    ),
  );
  const inside = administrativeBoundaries(data, { includeOuter: false });
  const all = administrativeBoundaries(data, { includeOuter: true });
  const count = (d) => d.coordinates.reduce((n, p) => n + p.length - 1, 0);
  assert.ok(count(inside) > 8000);
  assert.ok(count(all) > count(inside) + 6000);
  for (const tolerance of [0, 0.12]) {
    const built = geographicGeometry(inside, { tolerance, maxStep: 10 }),
      segments = new Set();
    for (let i = 0; i < built.positions.length; i += 6) {
      const a = Array.from(built.positions.slice(i, i + 3)).join(","),
        b = Array.from(built.positions.slice(i + 3, i + 6)).join(",");
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      assert.ok(!segments.has(key));
      segments.add(key);
    }
  }
});

test("Both water-detail levels retain the Yellow and Yangtze river geometry", () => {
  const data = JSON.parse(
    readFileSync(
      new URL("../data/geography/reference-lines.json", import.meta.url),
      "utf8",
    ),
  );
  for (const lod of ["detail", "coarse"]) {
    const names = new Set(
      data.rivers[lod].features.map((feature) => feature.properties.name),
    );
    for (const name of ["Huang", "Chang Jiang", "Yangtze"])
      assert.ok(names.has(name), `${lod}: ${name}`);
  }
  const detail = geographicGeometry(data.rivers.detail);
  const coarse = geographicGeometry(data.rivers.coarse, {
    tolerance: data.rivers.coarseTolerance,
    maxStep: 2,
  });
  assert.ok(coarse.segmentCount > 100);
  assert.ok(coarse.segmentCount < detail.segmentCount / 3);
});

test("Geography supports polygon holes and collections without joining separate rivers", () => {
  const data = {
    type: "GeometryCollection",
    geometries: [
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
          [
            [0.2, 0.2],
            [0.4, 0.2],
            [0.2, 0.4],
            [0.2, 0.2],
          ],
        ],
      },
      {
        type: "MultiLineString",
        coordinates: [
          [
            [10, 0],
            [11, 0],
          ],
          [
            [20, 0],
            [21, 0],
          ],
        ],
      },
    ],
  };
  assert.equal(geographyPaths(data).length, 4);
  const built = geographicGeometry(data, { maxStep: 10 });
  assert.equal(built.groups.length, 4);
  assert.equal(built.segmentCount, 8);
  const missing = geographicGeometry(
    line([
      [0, 0],
      [1, 0],
      [NaN, 0],
      [10, 0],
      [11, 0],
    ]),
  );
  assert.equal(missing.groups.length, 2);
  assert.equal(missing.segmentCount, 2);
});

test("Shared administrative edges are drawn once, including reversed geometry", () => {
  const built = geographicGeometry({
    type: "MultiLineString",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      [
        [2, 0],
        [1, 0],
        [0, 0],
      ],
    ],
  });
  assert.equal(built.segmentCount, 2);
});

test("Date-line geography takes the short route and stays on the reference ellipsoid", () => {
  const built = geographicGeometry(
    line([
      [179, 30],
      [-179, 30],
    ]),
  );
  const point = new THREE.Vector3(),
    end = new THREE.Vector3();
  assert.equal(built.segmentCount, 2);
  for (let i = 0; i < built.positions.length; i += 6) {
    point.fromArray(built.positions, i);
    end.fromArray(built.positions, i + 3);
    assert.ok(point.distanceTo(end) < 120000);
    assert.ok(Math.abs(WGS84_ELLIPSOID.getPositionElevation(point)) < 1);
  }
});

test("Movement switches to a simplified layer without hiding or changing weather depth", () => {
  const layer = new GeographicLineLayer(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(42, 1.5, 1, 1e8),
    style,
    options,
  );
  layer.setEnabled(true);
  const path = Array.from({ length: 101 }, (_, i) => [
    i * 0.01,
    Math.sin(i) * 0.005,
  ]);
  layer.setData(line(path));
  layer.update(false, 800);
  assert.equal(layer.getState().lod, "detail");
  assert.equal(layer.getState().visible, true);
  const detail = layer.getState().segments;
  layer.update(true, 800);
  assert.equal(layer.getState().visible, true);
  assert.equal(layer.getState().lod, "coarse");
  assert.ok(layer.getState().segments < detail / 5);
  assert.equal(layer.levels.coarse.line.material.depthTest, false);
  assert.equal(layer.levels.coarse.line.material.depthWrite, false);
  assert.ok(layer.levels.coarse.line.object.renderOrder > 20);
  layer.update(false, 800);
  assert.equal(layer.getState().segments, detail);
  layer.dispose();
});

test("Disabled geography builds lazily; style changes keep geometry and matching halo dashes", () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(42, 1.5, 1, 1e8);
  camera.position.set(10000000, 0, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const layer = new GeographicLineLayer(scene, camera, style, options);
  layer.setData(
    line([
      [0, 0],
      [1, 1],
    ]),
  );
  assert.equal(layer.levels, null);
  layer.setEnabled(true);
  const geometry = layer.levels.detail.line.geometry;
  layer.setLineStyle({
    ...style,
    color: "#00ffcc",
    width: 3,
    pattern: "dashed",
    opacity: 0.7,
  });
  layer.update(false, 800);
  assert.equal(layer.levels.detail.line.geometry, geometry);
  assert.equal(layer.levels.detail.line.material.linewidth, 3);
  assert.equal(layer.levels.detail.halo.material.linewidth, 4.2);
  assert.equal(
    layer.levels.detail.line.material.dashSize,
    layer.levels.detail.halo.material.dashSize,
  );
  assert.equal(
    layer.levels.detail.line.material.gapSize,
    layer.levels.detail.halo.material.gapSize,
  );
  layer.setEnabled(false);
  layer.update(false, 800);
  assert.equal(layer.getState().visible, false);
  layer.dispose();
  assert.equal(scene.children.length, 0);
});
