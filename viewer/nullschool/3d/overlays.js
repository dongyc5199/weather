import { ImageOverlayPlugin, THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { queueMapResource } from "./map-runtime.js";
const GUARDED_FETCH = Symbol("guardedOverlayFetch");

/**
 * 3d-tiles-renderer 0.5.4 leaves holes in layerInfo when a regional overlay has
 * no content for a tile but a later global overlay does. WebGL uniform uploads
 * still visit those struct slots. Initialize every slot, including absent maps.
 * Keep this adapter paired with the pinned library version and browser coverage.
 */
export class CompleteImageOverlayPlugin extends ImageOverlayPlugin {
  constructor(options = {}) {
    super(options);
    this.primaryOverlay = options.primaryOverlay;
    this.getBaseTexture = options.getBaseTexture;
    this.anisotropy = options.anisotropy || 1;
    this.refineQueue = new Set();
    this.baseTexture = null;
    this.pendingTextures = 0;
    this.initializingLayers = new Map();
    this.previewCache = options.previewCache;
    this.isInteracting = options.isInteracting || (() => false);
    this.fallbackQueue = new Set();
    this.baseAssignments = new Map();
    this.ownedBaseMaps = new WeakMap();
  }
  init(tiles) {
    super.init(tiles);
    tiles.removeEventListener(
      "tile-visibility-change",
      this._onTileVisibilityChange,
    );
    this._onTileVisibilityChange = ({ tile, visible }) => {
      if (visible) this.refineQueue.add(tile);
      if (visible) this.fallbackQueue.add(tile);
      for (const [overlay, { tileInfo }] of this.overlayInfo) {
        const info = tileInfo.get(tile);
        if (info?.range) overlay.setRegionVisible(info.range, visible, tile);
        if (
          visible &&
          info &&
          info.meshInfo.size === 0 &&
          tile.engineData?.scene
        ) {
          this._initTileSceneOverlayInfo(tile.engineData.scene, tile, overlay)
            .then(() => this._updateLayers(tile))
            .catch((error) => {
              if (error.name !== "AbortError")
                tiles.dispatchEvent({
                  type: "load-error",
                  tile,
                  overlay,
                  error,
                });
            });
        }
      }
    };
    tiles.addEventListener(
      "tile-visibility-change",
      this._onTileVisibilityChange,
    );
    this.onModelReady = ({ tile }) => {
      this._updateLayers(tile);
      this.refineQueue.add(tile);
    };
    this.onRefine = () => {
      let fallbacks = 0;
      for (const tile of this.fallbackQueue) {
        this.fallbackQueue.delete(tile);
        const image = this.overlayInfo
          .get(this.primaryOverlay)
          ?.tileInfo.get(tile);
        if (
          tile.engineData?.scene &&
          !image?.target &&
          this.tiles.visibleTiles.has(tile)
        )
          this._applyBaseTexture(tile.engineData.scene, tile);
        if (++fallbacks >= 4) break;
      }
      if (this.isInteracting()) return;
      let processed = 0;
      for (const tile of this.refineQueue) {
        this.refineQueue.delete(tile);
        if (!this.tileControllers.has(tile) || !tile.engineData?.scene)
          continue;
        if (
          tile.traversal?.inFrustum === false &&
          !tiles.visibleTiles.has(tile)
        )
          continue;
        this.expandVirtualChildren(tile.engineData.scene, tile).catch(
          (error) => {
            if (this.tileControllers.has(tile))
              tiles.dispatchEvent({ type: "load-error", tile, error });
          },
        );
        if (++processed >= 2) break;
      }
    };
    tiles.addEventListener("load-model", this.onModelReady);
    tiles.addEventListener("update-after", this.onRefine);
  }
  _applyBaseTexture(scene, tile) {
    const source = this.getBaseTexture?.();
    if (!source?.image) return;
    const projection =
      this.primaryOverlay?.isReady && this.primaryOverlay.projection;
    const region = tile.boundingVolume?.region;
    const range =
      projection && region
        ? projection.fromCartographicToNormalizedRange(
            projection.clampToBounds(region.slice(0, 4)),
          )
        : null;
    const preview =
      range && this.overlayInfo.has(this.primaryOverlay)
        ? this.previewCache?.find(range)
        : null;
    const key = preview?.key || "local-coastline";
    if (this.baseAssignments.get(tile) === key) return;
    if (!this.baseTexture) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 128;
      canvas.getContext("2d").drawImage(source.image, 0, 0, 256, 128);
      this.baseTexture = new THREE.CanvasTexture(canvas);
      this.baseTexture.colorSpace = THREE.SRGBColorSpace;
      this.baseTexture.wrapS = THREE.RepeatWrapping;
    }
    scene.updateMatrixWorld(true);
    const point = new THREE.Vector3(),
      carto = {},
      projected = [0, 0];
    const centerLongitude = region ? (region[0] + region[2]) / 2 : 0;
    scene.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position || !mesh.material)
        return;
      const position = mesh.geometry.attributes.position;
      let attribute = mesh.geometry.getAttribute("uv");
      if (
        !attribute ||
        attribute.itemSize !== 2 ||
        attribute.count !== position.count ||
        attribute.isInterleavedBufferAttribute
      ) {
        attribute = new THREE.BufferAttribute(
          new Float32Array(position.count * 2),
          2,
        );
        mesh.geometry.setAttribute("uv", attribute);
      }
      const uv = attribute.array;
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        WGS84_ELLIPSOID.getPositionToCartographic(point, carto);
        const lon =
          carto.lon +
          Math.round((centerLongitude - carto.lon) / (2 * Math.PI)) *
            2 *
            Math.PI;
        if (preview) {
          projection.fromCartographicToNormalized(lon, carto.lat, projected);
          uv[i * 2] =
            (projected[0] - preview.range[0]) /
            (preview.range[2] - preview.range[0]);
          uv[i * 2 + 1] =
            (projected[1] - preview.range[1]) /
            (preview.range[3] - preview.range[1]);
        } else {
          uv[i * 2] = (lon + Math.PI) / (2 * Math.PI);
          uv[i * 2 + 1] = (carto.lat + Math.PI / 2) / Math.PI;
        }
      }
      attribute.needsUpdate = true;
      const old = this.ownedBaseMaps.get(mesh);
      const texture = (preview?.texture || this.baseTexture).clone();
      texture.needsUpdate = true;
      if (!mesh.material.map) mesh.material.needsUpdate = true;
      mesh.material.map = texture;
      this.ownedBaseMaps.set(mesh, texture);
      const registered =
        tile.engineData?.scene === scene && tile.engineData.textures;
      if (registered) {
        const index = registered.indexOf(old);
        if (index >= 0) registered.splice(index, 1);
        registered.push(texture);
      }
      old?.dispose();
    });
    this.baseAssignments.set(tile, key);
    if (tile.engineData?.scene === scene) this.tiles.recalculateBytesUsed(tile);
  }
  _processTileModel(scene, tile, initialization = false) {
    const controller = new AbortController();
    this.tileControllers.set(tile, controller);
    this.pendingTiles.set(tile, scene);
    this.processedTiles.add(tile);
    this._applyBaseTexture(scene, tile);
    this._wrapMaterials(scene);
    this._initTileOverlayInfo(tile);
    const jobs = this.overlays.map(async (overlay) => {
      await this._initTileSceneOverlayInfo(scene, tile, overlay);
      if (
        this.tileControllers.get(tile) !== controller ||
        !this.overlayInfo.has(overlay)
      )
        return;
      this._updateLayers(tile);
      if (overlay === this.primaryOverlay) this.refineQueue.add(tile);
      this.tiles.dispatchEvent({ type: "needs-render" });
    });
    Promise.allSettled(jobs).then((results) => {
      if (this.tileControllers.get(tile) !== controller) return;
      this.pendingTiles.delete(tile);
      for (const result of results)
        if (
          result.status === "rejected" &&
          result.reason?.name !== "AbortError"
        )
          this.tiles.dispatchEvent({
            type: "load-error",
            tile,
            error: result.reason,
          });
    });
    // Geometry is ready now. Imagery and optional layers complete independently.
  }
  _initTileOverlayInfo(tile, overlay = this.overlays) {
    if (Array.isArray(overlay)) {
      overlay.forEach((item) => this._initTileOverlayInfo(tile, item));
      return;
    }
    const tileInfo = this.overlayInfo.get(overlay)?.tileInfo;
    if (tileInfo && !tileInfo.has(tile))
      tileInfo.set(tile, {
        range: null,
        target: null,
        meshInfo: new Map(),
        failed: false,
      });
    // No image prefetch for off-screen siblings or ancestors. The visible mesh
    // initializes its real range before locking image requests.
  }
  _getSplitVectors(scene, tile, center = new THREE.Vector3()) {
    new THREE.Box3().setFromObject(scene).getCenter(center);
    const info = this.overlayInfo.get(this.primaryOverlay)?.tileInfo.get(tile);
    if (!info?.target || !this.primaryOverlay.shouldSplit(info.range))
      return { directions: [], hash: "" };
    const normal = new THREE.Vector3();
    this.tiles.surface.getPositionToNormal(center, normal);
    if (normal.lengthSq() < 1e-12) normal.set(1, 0, 0);
    const axis =
      Math.abs(normal.z) > 0.99
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 0, 1);
    const u = new THREE.Vector3().crossVectors(normal, axis).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();
    return {
      directions: [u, v],
      hash: normal
        .toArray()
        .map((n) => n.toFixed(3))
        .join("_"),
    };
  }
  async expandVirtualChildren(scene, tile) {
    const controller = this.tileControllers.get(tile);
    await super.expandVirtualChildren(scene, tile);
    if (this.tileControllers.get(tile) !== controller) return;
    const imageChildren = tile.children.filter((child) =>
      String(child.content?.uri || "").includes("image_overlay_tile_split"),
    );
    if (imageChildren.length) {
      // Terrain may stop at two pixels of geometric error; imagery targets one
      // physical screen pixel per texel, including Retina displays.
      const size = new THREE.Box3()
        .setFromObject(scene)
        .getSize(new THREE.Vector3())
        .length();
      tile.geometricError = Math.max(
        tile.geometricError,
        (2 * size) / this.resolution,
      );
      imageChildren.forEach((child) => {
        child.geometricError = tile.geometricError / 2;
      });
    }
  }
  resetVirtualChildren(fullDispose = false) {
    if (fullDispose || !this.overlayInfo.has(this.primaryOverlay))
      return super.resetVirtualChildren(true);
    // Only imagery owns these subdivisions. Weather/boundary switches must not
    // dismantle a live terrain subtree or reset its shared virtual-child count.
    this.tiles.forEachLoadedModel((scene, tile) => this.refineQueue.add(tile));
  }
  disposeTile(tile) {
    this.refineQueue.delete(tile);
    this.initializingLayers.delete(tile);
    this.fallbackQueue.delete(tile);
    this.baseAssignments.delete(tile);
    super.disposeTile(tile);
  }
  deleteOverlay(overlay) {
    for (const jobs of this.initializingLayers?.values() || [])
      jobs.delete(overlay);
    super.deleteOverlay(overlay);
    if (overlay === this.primaryOverlay && this.tiles) {
      this.tiles.forEachLoadedModel((scene, tile) =>
        this._applyBaseTexture(scene, tile),
      );
    }
  }
  dispose() {
    this.tiles.removeEventListener("load-model", this.onModelReady);
    this.tiles.removeEventListener("update-after", this.onRefine);
    this.refineQueue.clear();
    this.initializingLayers.clear();
    this.fallbackQueue.clear();
    this.baseAssignments.clear();
    super.dispose();
    this.baseTexture?.dispose();
  }
  _initOverlay(overlay) {
    if (!overlay[GUARDED_FETCH]) {
      overlay.fetch = (url, options) => queueMapResource(overlay, url, options);
      overlay.downloadQueue.maxJobsPerOrigin = 8;
      overlay[GUARDED_FETCH] = true;
    }
    overlay
      .init()
      .then(() => {
        if (this.overlayInfo.has(overlay))
          overlay.setResolution(overlay.detailResolution || this.resolution);
      })
      .catch((error) =>
        this.tiles?.dispatchEvent({ type: "load-error", overlay, error }),
      );
    const jobs = [];
    for (const tile of this.processedTiles) {
      const scene = tile.engineData?.scene || this.pendingTiles.get(tile);
      if (!scene || !this.tileControllers.has(tile)) continue;
      this._initTileOverlayInfo(tile, overlay);
      jobs.push(
        this._initTileSceneOverlayInfo(scene, tile, overlay).then(() =>
          this._updateLayers(tile),
        ),
      );
    }
    Promise.allSettled(jobs).then((results) => {
      if (!this.overlayInfo.has(overlay)) return;
      for (const result of results)
        if (
          result.status === "rejected" &&
          result.reason?.name !== "AbortError"
        )
          this.tiles?.dispatchEvent({
            type: "load-error",
            overlay,
            error: result.reason,
          });
      this._markNeedsUpdate();
    });
  }
  async _initTileSceneOverlayInfo(scene, tile, overlay = this.overlays) {
    if (Array.isArray(overlay))
      return Promise.all(
        overlay.map((item) =>
          this._initTileSceneOverlayInfo(scene, tile, item),
        ),
      );
    if (
      !scene ||
      !this.overlayInfo.has(overlay) ||
      !this.tileControllers.has(tile)
    )
      return;
    if (
      tile.traversal?.inFrustum === false &&
      !this.tiles.visibleTiles.has(tile)
    )
      return;
    if (this.overlayInfo.get(overlay)?.tileInfo.get(tile)?.meshInfo.size)
      return;
    let jobs = this.initializingLayers.get(tile);
    if (!jobs) this.initializingLayers.set(tile, (jobs = new Map()));
    if (jobs.has(overlay)) return jobs.get(overlay);
    const controller = this.tileControllers.get(tile);
    const overlayGeneration = this.overlayInfo.get(overlay);
    const job = (async () => {
      await overlay.init();
      if (
        this.overlayInfo.get(overlay) !== overlayGeneration ||
        this.tileControllers.get(tile) !== controller
      )
        return;
      return super._initTileSceneOverlayInfo(scene, tile, overlay);
    })();
    jobs.set(overlay, job);
    try {
      return await job;
    } finally {
      if (jobs.get(overlay) === job) jobs.delete(overlay);
      if (jobs.size === 0 && this.initializingLayers.get(tile) === jobs)
        this.initializingLayers.delete(tile);
    }
  }
  async _fetchTileOverlayTexture(tile, overlay, info) {
    if (!this.overlayInfo.has(overlay) || !this.tileControllers.has(tile))
      return null;
    this.pendingTextures++;
    const controller = this.tileControllers.get(tile);
    const overlayState = this.overlayInfo.get(overlay);
    try {
      // Image-source locking already owns the bounded download queue. Do not
      // occupy a second queue slot while an off-screen image is downloading:
      // it can otherwise block ready textures for the new camera direction.
      const texture = await overlay.getTexture(info.range);
      if (
        controller.signal.aborted ||
        overlayState.controller.signal.aborted ||
        this.tileControllers.get(tile) !== controller ||
        this.overlayInfo.get(overlay) !== overlayState
      )
        return null;
      info.target = texture;
    } catch (error) {
      if (
        error.name !== "AbortError" &&
        !controller.signal.aborted &&
        !overlayState.controller.signal.aborted
      ) {
        info.failed = true;
        this.tiles.dispatchEvent({
          type: "load-error",
          tile,
          overlay,
          error,
          url: null,
        });
      }
      return null;
    } finally {
      this.pendingTextures--;
    }
    if (info.target) {
      info.target.anisotropy = this.anisotropy;
      if (overlay === this.primaryOverlay) {
        info.target.generateMipmaps = true;
        info.target.minFilter = THREE.LinearMipmapLinearFilter;
        this.previewCache?.save(info.range, info.target);
        for (const visible of this.tiles.visibleTiles)
          this.fallbackQueue.add(visible);
      }
      info.target.needsUpdate = true;
      if (overlay === this.primaryOverlay) this.refineQueue.add(tile);
    }
    this.onTexture?.(overlay, info.target, tile);
    return info.target;
  }
  _updateLayers(tile) {
    if (!this.tileControllers.has(tile) || !tile.engineData?.scene) return;
    super._updateLayers(tile);
    tile.engineData?.scene?.traverse((mesh) => {
      const params = this.meshParams.get(mesh);
      if (!params) return;
      params.layerInfo.value.length = this.overlays.length;
      params.layerMaps.value.length = this.overlays.length;
      for (let i = 0; i < this.overlays.length; i++) {
        const overlay = this.overlays[i],
          info = this.overlayInfo.get(overlay)?.tileInfo.get(tile);
        const texture = info?.meshInfo.has(mesh) ? info.target : null;
        params.layerInfo.value[i] = overlay;
        params.layerMaps.value[i] = texture ?? null;
        const key = `LAYER_${i}_EXISTS`,
          exists = Number(texture != null);
        if (mesh.material.defines[key] !== exists) {
          mesh.material.defines[key] = exists;
          mesh.material.needsUpdate = true;
        }
      }
    });
  }
  resetFailedOverlays() {
    const failed = [];
    for (const [overlay, { tileInfo }] of this.overlayInfo) {
      for (const [tile, info] of tileInfo) {
        if (!info.failed || !this.tileControllers.has(tile) || !info.range)
          continue;
        info.failed = false;
        overlay.releaseTexture(info.range);
        failed.push({ tile, overlay, info });
      }
    }
    requestAnimationFrame(() => {
      for (const { tile, overlay, info } of failed) {
        if (
          !this.tileControllers.has(tile) ||
          this.overlayInfo.get(overlay)?.tileInfo.get(tile) !== info
        )
          continue;
        overlay.lockTextureSafe(info.range);
        this._fetchTileOverlayTexture(tile, overlay, info).then(() =>
          this._updateLayers(tile),
        );
      }
    });
  }
  fallbackMetrics() {
    let pending = 0,
      satelliteFallback = 0;
    for (const tile of this.tiles?.visibleTiles || []) {
      if (this.overlayInfo.get(this.primaryOverlay)?.tileInfo.get(tile)?.target)
        continue;
      pending++;
      const key = this.baseAssignments.get(tile);
      if (key && key !== "local-coastline") satelliteFallback++;
    }
    return {
      pending,
      satelliteFallback,
      coastlineFallback: pending - satelliteFallback,
    };
  }
}
