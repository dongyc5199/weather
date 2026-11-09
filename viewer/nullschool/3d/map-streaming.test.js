import test from "node:test";
import assert from "node:assert/strict";
import { THREE, XYZTilesOverlay, WGS84_ELLIPSOID } from "./vendor.js";
import {
  BoundedCache,
  ImageResponseCache,
  SatellitePreviewCache,
  RecentTileCache,
  StableDetailPlugin,
  visibleImagePriority,
} from "./map-streaming.js";
import { queueMapResource } from "./map-runtime.js";
import { CompleteImageOverlayPlugin } from "./overlays.js";

test("Retained image bytes obey LRU, byte limits and expiry", () => {
  let now = 0;
  const disposed = [];
  const cache = new BoundedCache({
    maxBytes: 10,
    ttl: 100,
    now: () => now,
    dispose: (value) => disposed.push(value),
  });
  cache.set("a", "a", 4);
  cache.set("b", "b", 4);
  assert.equal(cache.get("a"), "a");
  cache.set("c", "c", 4);
  assert.equal(cache.get("b"), null);
  assert.equal(cache.bytes, 8);
  now = 101;
  assert.equal(cache.get("a"), null);
  assert.equal(cache.bytes, 4);
  cache.set("huge", "huge", 11);
  assert.equal(cache.get("huge"), null);
  assert.deepEqual(disposed, ["b", "a", "huge"]);
});

test("Returning to a downloaded image bypasses both network and a busy queue", async () => {
  let queued = 0,
    network = 0;
  const overlay = {
    responseCache: new ImageResponseCache(1024),
    downloadQueue: {
      add: async (url, item, job) => {
        queued++;
        return job();
      },
    },
  };
  const fetcher = async () => {
    network++;
    return new Response("jpeg", { headers: { "Content-Type": "image/jpeg" } });
  };
  assert.equal(
    await (
      await queueMapResource(overlay, "https://example.test/tile", {}, fetcher)
    ).text(),
    "jpeg",
  );
  overlay.downloadQueue.add = () =>
    assert.fail("cache hit must not wait in a network queue");
  assert.equal(
    await (
      await queueMapResource(overlay, "https://example.test/tile", {}, fetcher)
    ).text(),
    "jpeg",
  );
  assert.equal(queued, 1);
  assert.equal(network, 1);
  assert.equal(overlay.responseCache.hits, 1);
});

test("Authentication-bearing and failed responses are not stored as public imagery", async () => {
  const cache = new ImageResponseCache(1024);
  await cache.save(
    "protected",
    new Response("private", { headers: { "Content-Type": "image/png" } }),
    { headers: { Authorization: "Bearer private" } },
  );
  await cache.save(
    "failed",
    new Response("error", {
      status: 503,
      headers: { "Content-Type": "image/png" },
    }),
  );
  assert.equal(cache.get("protected"), null);
  assert.equal(cache.get("failed"), null);
});

test("Fallback chooses the tightest covering satellite image and preserves its source", () => {
  const previews = new SatellitePreviewCache();
  const coarse = {
    key: "world",
    range: [0, 0, 1, 1],
    area: 1,
    texture: { dispose() {} },
  };
  const local = {
    key: "city",
    range: [0.4, 0.4, 0.6, 0.6],
    area: 0.04,
    texture: { dispose() {} },
  };
  previews.cache.set("world", coarse, 4);
  previews.cache.set("city", local, 4);
  assert.equal(previews.find([0.45, 0.45, 0.55, 0.55]), local);
  assert.equal(previews.find([0.1, 0.1, 0.2, 0.2]), coarse);
  assert.equal(previews.find([-1, 0, 0.2, 0.2]), null);
});

test("Recently visible tiles survive soft cleanup; the hard cap still evicts", () => {
  let now = 0;
  const removed = [];
  const cache = new RecentTileCache(
    () => 0,
    () => now,
  );
  cache.minSize = 0;
  cache.maxSize = 10;
  cache.minBytesSize = 4;
  cache.maxBytesSize = 20;
  const old = {},
    recent = {};
  cache.add(old, (item) => removed.push(item));
  cache.setMemoryUsage(old, 6);
  cache.setLoaded(old, true);
  cache.add(recent, (item) => removed.push(item));
  cache.setMemoryUsage(recent, 6);
  cache.setLoaded(recent, true);
  cache.markAllUnused();
  cache.remember(recent);
  cache.unloadUnusedContent();
  assert.equal(cache.has(recent), true);
  assert.equal(cache.has(old), false);
  cache.maxBytesSize = 4;
  cache.minBytesSize = 2;
  cache.markAllUnused();
  cache.unloadUnusedContent();
  assert.equal(cache.has(recent), false);
});

test("LOD retains an existing split around the threshold, then coarsens once outside the band", () => {
  const camera = new THREE.PerspectiveCamera(),
    plugin = new StableDetailPlugin(camera),
    tile = {};
  let error = 1.9;
  plugin.tiles = {
    errorTarget: 2,
    calculateTileViewError: (tile, target) =>
      Object.assign(target, { inView: true, error, distanceFromCamera: 1000 }),
  };
  plugin.refined.add(tile);
  const target = {};
  assert.equal(plugin.calculateTileViewError(tile, target), true);
  assert.ok(target.error > 2);
  error = 1.5;
  assert.equal(plugin.calculateTileViewError(tile, target), true);
  error = 1.3;
  assert.equal(plugin.calculateTileViewError(tile, target), false);
  assert.equal(plugin.refined.has(tile), false);
});

test("Fine subdivision waits for the camera to settle", () => {
  const camera = new THREE.PerspectiveCamera(),
    plugin = new StableDetailPlugin(camera);
  plugin.observe(1000);
  assert.equal(plugin.moving, true);
  plugin.observe(1300);
  assert.equal(plugin.moving, false);
  camera.rotateY(0.2);
  plugin.observe(1310);
  assert.equal(plugin.moving, true);
});

test("Image priorities follow the current visible regions rather than submission time", () => {
  const overlay = {
    _visibleRegionCounts: new Map([
      ["view", { range: [0, 0.5, 0.5, 1], count: 1 }],
    ]),
  };
  const northWest = "https://example.test/MapServer/tile/1/0/0";
  const southEast = "https://example.test/MapServer/tile/1/1/1";
  assert.ok(
    visibleImagePriority(overlay, northWest) >
      visibleImagePriority(overlay, southEast),
  );
  overlay._visibleRegionCounts.set("view", {
    range: [0.5, 0, 1, 0.5],
    count: 1,
  });
  assert.ok(
    visibleImagePriority(overlay, southEast) >
      visibleImagePriority(overlay, northWest),
  );
});

test("A ready visible overlay is not blocked behind another overlay's download", async () => {
  const plugin = new CompleteImageOverlayPlugin();
  const tile = {};
  const overlay = { getTexture: async () => ({ needsUpdate: false }) };
  const info = { range: [0, 0, 1, 1], target: null, meshInfo: new Map() };
  plugin.tileControllers.set(tile, new AbortController());
  plugin.overlayInfo.set(overlay, {
    controller: new AbortController(),
    tileInfo: new Map([[tile, info]]),
  });
  plugin.tiles = { visibleTiles: new Set(), dispatchEvent: () => {} };
  plugin.processQueue = {
    add: () =>
      assert.fail("ready image should not enter the blocked processing queue"),
  };
  assert.ok(await plugin._fetchTileOverlayTexture(tile, overlay, info));
  assert.ok(info.target);
  assert.equal(plugin.pendingTextures, 0);
});

test("Inherited imagery is projected to the child terrain without shifting its coordinates", async () => {
  const satellite = new XYZTilesOverlay({
    url: "https://example.test/{z}/{x}/{y}.jpg",
    projection: "EPSG:3857",
  });
  await satellite.init();
  const region = [1, 0.4, 1.02, 0.42, 0, 0];
  const range = satellite.projection.fromCartographicToNormalizedRange(
    region.slice(0, 4),
  );
  const preview = {
    key: "parent",
    range,
    texture: new THREE.Texture({ width: 128, height: 128 }),
  };
  const plugin = new CompleteImageOverlayPlugin({
    primaryOverlay: satellite,
    getBaseTexture: () => ({ image: {} }),
    previewCache: { find: () => preview },
  });
  plugin.baseTexture = new THREE.Texture({ width: 256, height: 128 });
  plugin.overlayInfo.set(satellite, { tileInfo: new Map() });
  const points = [
    [1, 0.4],
    [1.02, 0.42],
  ];
  const positions = points.flatMap(([lon, lat]) =>
    WGS84_ELLIPSOID.getCartographicToPosition(
      lat,
      lon,
      0,
      new THREE.Vector3(),
    ).toArray(),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const scene = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const tile = { boundingVolume: { region }, engineData: {} };
  plugin._applyBaseTexture(scene, tile);
  const uv = geometry.attributes.uv.array;
  assert.ok(Math.abs(uv[0]) < 1e-4 && Math.abs(uv[1]) < 1e-4);
  assert.ok(Math.abs(uv[2] - 1) < 1e-4 && Math.abs(uv[3] - 1) < 1e-4);
  const map = scene.material.map;
  plugin._applyBaseTexture(scene, tile);
  assert.equal(
    scene.material.map,
    map,
    "unchanged fallback must not create more textures",
  );
  geometry.dispose();
  scene.material.dispose();
  map.dispose();
  plugin.baseTexture.dispose();
  preview.texture.dispose();
});
