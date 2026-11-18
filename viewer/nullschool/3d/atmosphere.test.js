import test from "node:test";
import assert from "node:assert/strict";
import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { AtmosphereLayer } from "./atmosphere.js";
const theme = (name) =>
  ({
    "--earth-atmosphere-color": "#4b8cdb",
    "--earth-atmosphere-height": "80000",
    "--earth-atmosphere-opacity": ".32",
  })[name];
function cameraAt(height) {
  const camera = new THREE.PerspectiveCamera(42, 1.5, 100, 1e9);
  WGS84_ELLIPSOID.getCartographicToPosition(0.5, 1, height, camera.position);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}
test("The orbital atmosphere leaves boundary-only mode and close terrain unobstructed", () => {
  const layer = new AtmosphereLayer(theme);
  let renders = 0;
  const renderer = {
    autoClear: true,
    render() {
      renders++;
      assert.equal(this.autoClear, false);
    },
  };
  layer.render(renderer, cameraAt(16000000), false);
  assert.equal(renders, 0);
  layer.render(renderer, cameraAt(10000), true);
  assert.equal(renders, 0);
  layer.render(renderer, cameraAt(16000000), true);
  assert.equal(renders, 1);
  assert.equal(renderer.autoClear, true);
  assert.equal(layer.material.uniforms.fade.value, 1);
  layer.dispose();
});
test("Atmosphere compositing restores the renderer if drawing fails", () => {
  const layer = new AtmosphereLayer(theme);
  const renderer = {
    autoClear: true,
    render() {
      throw new Error("draw failed");
    },
  };
  assert.throws(
    () => layer.render(renderer, cameraAt(16000000), true),
    /draw failed/,
  );
  assert.equal(renderer.autoClear, true);
  layer.dispose();
});
