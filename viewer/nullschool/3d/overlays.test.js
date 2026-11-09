import test from "node:test";
import assert from "node:assert/strict";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { CompleteImageOverlayPlugin } from "./overlays.js";
import { queueMapResource, MapRequestPlugin } from "./map-runtime.js";

function deferredOverlay() {
  let resolve;
  const pending = new Promise((done) => (resolve = done));
  const primary = {};
  const plugin = new CompleteImageOverlayPlugin({ primaryOverlay: primary });
  const updates = [];
  plugin.overlays = [primary];
  plugin.overlayInfo.set(primary, {});
  plugin.tiles = { dispatchEvent: (event) => updates.push(event.type) };
  plugin._wrapMaterials = () => {};
  plugin._initTileOverlayInfo = () => {};
  plugin._initTileSceneOverlayInfo = () => pending;
  plugin._updateLayers = () => updates.push("texture-applied");
  return { plugin, resolve, updates };
}

test("A slow image download does not block terrain geometry readiness", async () => {
  const { plugin, resolve, updates } = deferredOverlay();
  const tile = { engineData: { scene: new THREE.Group() } };
  assert.equal(plugin.processTileModel(tile.engineData.scene, tile), undefined);
  assert.deepEqual(updates, []);
  resolve();
  await new Promise((done) => setImmediate(done));
  assert.ok(updates.includes("texture-applied"));
  assert.ok(plugin.refineQueue.has(tile));
});

test("A late image cannot modify a disposed terrain tile", async () => {
  const { plugin, resolve, updates } = deferredOverlay();
  const tile = { engineData: { scene: new THREE.Group() } };
  plugin.processTileModel(tile.engineData.scene, tile);
  plugin.tileControllers.delete(tile);
  resolve();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(updates, []);
  assert.equal(plugin.refineQueue.has(tile), false);
});

test("Weather layer changes preserve the imagery subdivision tree", () => {
  const primary = { shouldSplit: () => true };
  const weather = {
    shouldSplit: () => {
      throw new Error("weather must not own refinement");
    },
  };
  const plugin = new CompleteImageOverlayPlugin({ primaryOverlay: primary });
  const scene = new THREE.Group();
  scene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(100, 100, 100),
      new THREE.MeshBasicMaterial(),
    ),
  );
  scene.position.set(6378137, 0, 0);
  scene.updateMatrixWorld();
  const children = [
    { id: "existing native child" },
    { id: "existing imagery child" },
  ];
  const tile = { engineData: { scene }, children };
  plugin.tiles = {
    surface: WGS84_ELLIPSOID,
    forEachLoadedModel: (fn) => fn(scene, tile),
  };
  plugin.overlayInfo.set(primary, {
    tileInfo: new Map([[tile, { target: {}, range: [0, 0, 1, 1] }]]),
  });
  const before = plugin._getSplitVectors(scene, tile);
  plugin.overlayInfo.set(weather, { tileInfo: new Map() });
  plugin.resetVirtualChildren();
  plugin.overlayInfo.delete(weather);
  plugin.resetVirtualChildren();
  assert.equal(tile.children, children);
  assert.equal(tile.children.length, 2);
  assert.equal(plugin._getSplitVectors(scene, tile).hash, before.hash);
  assert.equal(before.directions.length, 2);
});

test("The tile transfer timeout starts after leaving the queue", async () => {
  let run;
  const original = AbortSignal.timeout;
  let deadlines = 0;
  AbortSignal.timeout = (ms) => {
    deadlines++;
    return original(ms);
  };
  try {
    const overlay = {
      downloadQueue: {
        add: (url, item, job) => {
          run = job;
          return "queued";
        },
      },
    };
    const state = queueMapResource(
      overlay,
      "https://example.test/tile",
      {},
      async () => new Response("image"),
    );
    assert.equal(state, "queued");
    assert.equal(deadlines, 0);
    assert.equal(await (await run()).text(), "image");
    assert.equal(deadlines, 1);
  } finally {
    AbortSignal.timeout = original;
  }
});

test("The cached terrain directory avoids an additional remote round trip", async () => {
  const directory = { tiles: ["{z}/{x}/{y}.terrain"], maxzoom: 15 };
  const plugin = new MapRequestPlugin({
    rootUrl: "https://terrain.example/asset/",
    rootLayer: directory,
  });
  const response = await plugin.fetchData(
    new URL("https://terrain.example/asset/layer.json"),
    {},
  );
  assert.deepEqual(await response.json(), directory);
});

test("Image-only children refine for one-pixel texels while retaining native children", async () => {
  const plugin = new CompleteImageOverlayPlugin({ resolution: 512 });
  const scene = new THREE.Mesh(
    new THREE.BoxGeometry(1024, 1024, 100),
    new THREE.MeshBasicMaterial(),
  );
  const imageChild = {
    content: { uri: "./child.image_overlay_tile_split" },
    geometricError: 1,
  };
  const nativeChild = { content: { uri: "native.terrain" }, geometricError: 7 };
  const tile = {
    refine: "REPLACE",
    children: [imageChild, nativeChild],
    internal: { virtualChildCount: 1 },
    geometricError: 2,
  };
  plugin.tileControllers.set(tile, new AbortController());
  await plugin.expandVirtualChildren(scene, tile);
  assert.ok(tile.geometricError > 5);
  assert.equal(imageChild.geometricError, tile.geometricError / 2);
  assert.equal(nativeChild.geometricError, 7);
});

test("Terrain tile cache requests never forward the provider credential to localhost", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response("mesh");
  };
  try {
    const plugin = new MapRequestPlugin({
      rootUrl: "https://terrain.example/asset/",
      cacheKey: "a".repeat(64),
      localOrigin: "http://127.0.0.1:8080",
    });
    const response = await plugin.fetchData(
      "https://terrain.example/asset/2/3/1.terrain?v=1",
      { headers: { Authorization: "Bearer private" } },
    );
    assert.equal(await response.text(), "mesh");
    assert.ok(
      calls[0].url.startsWith(
        "http://127.0.0.1:8080/api/earth/3d/terrain-tile/2/3/1.terrain?source=",
      ),
    );
    assert.equal(calls[0].options.headers, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
