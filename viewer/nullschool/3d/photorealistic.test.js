import test from "node:test";
import assert from "node:assert/strict";
import { THREE } from "./vendor.js";
import {
  PhotorealisticRequests,
  PhotorealisticSurface,
} from "./photorealistic.js";
import { CompleteImageOverlayPlugin } from "./overlays.js";

test("Google visualization credentials stay on the Google tile origin", async () => {
  const requests = new PhotorealisticRequests(
    "https://tile.googleapis.com/v1/3dtiles/root.json?key=scoped-key",
  );
  assert.ok(!requests.rootURL.includes("scoped-key"));
  requests.auth.authURL = requests.rootURL;
  requests.auth.sessionToken = "session";
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response("tile");
  };
  try {
    await requests.fetchData(
      "https://tile.googleapis.com/v1/3dtiles/tile.glb",
      { headers: { Authorization: "Bearer unrelated" } },
    );
    assert.equal(calls[0].url.searchParams.get("key"), "scoped-key");
    assert.equal(calls[0].url.searchParams.get("session"), "session");
    assert.equal(calls[0].options.headers.has("Authorization"), false);
    await assert.rejects(
      requests.fetchData("https://unrelated.example/tile.glb"),
    );
    await assert.rejects(
      requests.fetchData("http://tile.googleapis.com/v1/3dtiles/tile.glb"),
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("Photorealistic models retain their roof/facade texture and material with weather overlays", () => {
  const camera = new THREE.PerspectiveCamera();
  const renderer = { getSize: (v) => v.set(1200, 800), getPixelRatio: () => 1 };
  const photo = new PhotorealisticSurface(
    { url: "https://tile.googleapis.com/v1/3dtiles/root.json?key=key" },
    camera,
    renderer,
  );
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  scene.add(mesh);
  const tile = { engineData: { scene } };
  const overlay = new CompleteImageOverlayPlugin({
    enableTileSplitting: false,
    primaryOverlay: null,
  });
  photo.tiles.registerPlugin(overlay);
  overlay.processTileModel(scene, tile);
  photo.tiles.dispatchEvent({ type: "load-model", tile, scene });
  photo.tiles.visibleTiles.add(tile);
  assert.equal(mesh.material, material);
  assert.equal(mesh.material.map, texture);
  assert.equal(photo.getState().texturedMeshes, 1);
  assert.equal(overlay.enableTileSplitting, false);
  assert.equal(photo.tiles.getPluginByName("MAP_REQUEST_RESILIENCE"), null);
  const normalThreshold = photo.tiles.errorTarget;
  renderer.getPixelRatio = () => 2;
  photo.resize(camera, renderer);
  assert.equal(photo.tiles.errorTarget, normalThreshold * 2);
  photo.dispose();
});
