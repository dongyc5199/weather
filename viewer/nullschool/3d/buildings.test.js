import test from "node:test";
import assert from "node:assert/strict";
import {
  THREE,
  TilesRenderer,
  WGS84_ELLIPSOID,
  FAILED,
  UNLOADED,
} from "./vendor.js";
import { resetFailedMapTiles } from "./map-runtime.js";
import {
  BuildingsLayer,
  BuildingRequests,
  buildingsInRange,
  creditURL,
} from "./buildings.js";

const info = {
  url: "https://assets.example/osm/tileset.json?v=4",
  accessToken: "scoped-token",
  root: { asset: { version: "1.0" }, root: { children: [] } },
};
function layerFixture() {
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 100, 1e9);
  const parent = new THREE.Group();
  const renderer = {
    getSize: (target) => target.set(1280, 720),
    getPixelRatio: () => 1,
  };
  const layer = new BuildingsLayer({
    parent,
    camera,
    renderer,
    color: "#d0d6db",
    onStatus: () => {},
    onCredits: () => {},
  });
  return { layer, camera, parent };
}

test("Building authorization is scoped to the asset origin", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response("tile");
  };
  try {
    const requests = new BuildingRequests(info, () =>
      assert.fail("unexpected refresh"),
    );
    await requests.fetchData("https://assets.example/osm/child.b3dm");
    await requests.fetchData("https://another.example/public.bin", {
      headers: { Authorization: "must-be-removed" },
    });
    assert.equal(calls[0].options.headers.authorization, "Bearer scoped-token");
    assert.equal(calls[1].options.headers.authorization, undefined);
    assert.match(
      requests.preprocessURL("https://assets.example/osm/child.b3dm"),
      /v=4/,
    );
    assert.equal(
      requests.preprocessURL("https://another.example/public.bin"),
      "https://another.example/public.bin",
    );
    const root = await requests.fetchData(info.url);
    assert.deepEqual(await root.json(), info.root);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("Building geometry is not requested at world scale or without terrain", () => {
  const { layer, camera } = layerFixture();
  let starts = 0;
  layer.start = () => starts++;
  layer.setEnabled(true);
  WGS84_ELLIPSOID.getCartographicToPosition(0, 0, 16000000, camera.position);
  layer.update(1, true);
  WGS84_ELLIPSOID.getCartographicToPosition(0, 0, 3000, camera.position);
  layer.update(2, false);
  assert.equal(starts, 0);
  layer.update(3, true);
  assert.equal(starts, 1);
  assert.equal(buildingsInRange(85000, false), false);
  assert.equal(buildingsInRange(85000, true), true);
});

test("Buildings use an independent cache and release models when switched off", async () => {
  const { layer, parent } = layerFixture();
  layer.fetchInfo = async () => info;
  layer.setEnabled(true);
  layer.active = true;
  await layer.start();
  const defaultRenderer = new TilesRenderer();
  assert.notEqual(layer.tiles.lruCache, defaultRenderer.lruCache);
  assert.equal(layer.tiles.lruCache.maxBytesSize, 128 * 1024 ** 2);
  assert.equal(layer.tiles.group.parent, parent);
  layer.setEnabled(false);
  assert.equal(parent.children.length, 0);
  assert.equal(layer.tiles, null);
  defaultRenderer.dispose();
});

test("Disabling buildings during metadata load prevents a late layer from appearing", async () => {
  const { layer, parent } = layerFixture();
  let done;
  layer.fetchInfo = () => new Promise((resolve) => (done = resolve));
  layer.setEnabled(true);
  layer.active = true;
  const pending = layer.start();
  layer.setEnabled(false);
  done(info);
  await pending;
  assert.equal(layer.tiles, null);
  assert.equal(parent.children.length, 0);
});

test("Attribution links reject executable and credential-bearing URLs", () => {
  assert.equal(creditURL("javascript:alert(1)"), null);
  assert.equal(creditURL("data:text/html,test"), null);
  assert.equal(creditURL("https://secret@example.test/"), null);
  assert.equal(
    creditURL("https://www.openstreetmap.org/copyright"),
    "https://www.openstreetmap.org/copyright",
  );
});

test("Leaving city scale cancels unfinished building downloads while keeping loaded models", () => {
  const { layer, camera, parent } = layerFixture();
  const pending = {},
    loaded = {};
  const loadingTiles = new Set([pending]);
  const removed = [];
  const group = new THREE.Group();
  parent.add(group);
  layer.tiles = {
    group,
    loadingTiles,
    lruCache: {
      remove: (tile) => {
        removed.push(tile);
        loadingTiles.delete(tile);
      },
    },
  };
  layer.modelInfo.set(loaded, { meshes: 1, triangles: 12 });
  layer.enabled = true;
  layer.active = true;
  WGS84_ELLIPSOID.getCartographicToPosition(0, 0, 16000000, camera.position);
  layer.update(1, true);
  assert.deepEqual(removed, [pending]);
  assert.equal(layer.modelInfo.has(loaded), true);
  assert.equal(group.parent, null);
});

test("Failed tile retries tolerate raw children in external building catalogs", () => {
  const failed = { internal: { loadingState: FAILED } };
  const raw = { children: [{}] };
  const tiles = {
    rootLoadingState: FAILED,
    stats: { failed: 1 },
    traverse: (fn) => [raw, ...raw.children, failed].forEach(fn),
  };
  resetFailedMapTiles(tiles);
  assert.equal(failed.internal.loadingState, UNLOADED);
  assert.equal(tiles.rootLoadingState, UNLOADED);
  assert.equal(tiles.stats.failed, 0);
  assert.equal(raw.internal, undefined);
});

test("Building update errors detach only the building layer and schedule a retry", () => {
  const { layer, parent } = layerFixture();
  const terrain = new THREE.Group();
  parent.add(terrain);
  const group = new THREE.Group();
  parent.add(group);
  layer.tiles = { group, dispose: () => {} };
  layer.enabled = true;
  layer.active = true;
  layer.recoverFromUpdateError(new Error("catalog unavailable"));
  assert.equal(terrain.parent, parent);
  assert.equal(group.parent, null);
  assert.equal(layer.tiles, null);
  assert.equal(layer.failures, 1);
  assert.ok(layer.retryAt > performance.now());
});
