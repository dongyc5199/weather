import { THREE, LRUCache } from "./vendor.js";

export class BoundedCache {
  constructor({
    maxBytes,
    maxEntries = 2048,
    dispose = () => {},
    now = () => performance.now(),
    ttl = 3600000,
  }) {
    Object.assign(this, { maxBytes, maxEntries, dispose, now, ttl });
    this.entries = new Map();
    this.bytes = 0;
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.created > this.ttl) {
      this.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key, value, bytes) {
    this.delete(key);
    if (bytes > this.maxBytes) {
      this.dispose(value);
      return false;
    }
    this.entries.set(key, { value, bytes, created: this.now() });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries)
      this.delete(this.entries.keys().next().value);
    return true;
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.bytes -= entry.bytes;
      this.dispose(entry.value);
    }
  }
}

export class ImageResponseCache {
  constructor(maxBytes = 64 * 1024 ** 2) {
    this.cache = new BoundedCache({ maxBytes, maxEntries: 4096 });
    this.hits = 0;
    this.networkRequests = 0;
  }
  get(url, options = {}) {
    options.signal?.throwIfAborted();
    if (new Headers(options.headers).has("Authorization")) return null;
    const entry = this.cache.get(String(url));
    if (!entry) return null;
    this.hits++;
    return new Response(entry.bytes.slice(0), {
      headers: { "Content-Type": entry.type },
    });
  }
  async save(url, response, options = {}) {
    const type = response.headers.get("Content-Type") || "";
    if (
      !response.ok ||
      !type.startsWith("image/") ||
      new Headers(options.headers).has("Authorization")
    )
      return response;
    const bytes = await response.arrayBuffer();
    this.cache.set(String(url), { bytes, type }, bytes.byteLength);
    return new Response(bytes, { headers: { "Content-Type": type } });
  }
  metrics() {
    return {
      hits: this.hits,
      networkRequests: this.networkRequests,
      entries: this.cache.entries.size,
      MiB: Math.round(this.cache.bytes / 1024 ** 2),
    };
  }
}

export function containsRange(outer, inner, epsilon = 1e-8) {
  return (
    outer[0] <= inner[0] + epsilon &&
    outer[1] <= inner[1] + epsilon &&
    outer[2] >= inner[2] - epsilon &&
    outer[3] >= inner[3] - epsilon
  );
}

export function visibleImagePriority(overlay, value) {
  const match = /\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(String(value));
  if (!match) return 0;
  const [z, y, x] = match.slice(1).map(Number),
    n = 2 ** z;
  const bounds = [x / n, 1 - (y + 1) / n, (x + 1) / n, 1 - y / n];
  for (const { range, count } of overlay._visibleRegionCounts.values()) {
    if (
      count > 0 &&
      bounds[0] < range[2] &&
      bounds[2] > range[0] &&
      bounds[1] < range[3] &&
      bounds[3] > range[1]
    )
      return 1000 - z;
  }
  return -1000 - z;
}

export class SatellitePreviewCache {
  constructor() {
    this.cache = new BoundedCache({
      maxBytes: 32 * 1024 ** 2,
      maxEntries: 512,
      dispose: (entry) => entry.texture.dispose(),
    });
    this.reuses = 0;
  }
  save(range, texture) {
    if (!range || !texture?.image) return;
    const key = range.map((n) => n.toFixed(10)).join(",");
    if (this.cache.get(key)) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    if (
      typeof ImageBitmap !== "undefined" &&
      texture.image instanceof ImageBitmap
    ) {
      context.translate(0, 128);
      context.scale(1, -1);
    }
    context.drawImage(texture.image, 0, 0, 128, 128);
    const preview = new THREE.CanvasTexture(canvas);
    preview.colorSpace = THREE.SRGBColorSpace;
    preview.generateMipmaps = false;
    preview.minFilter = THREE.LinearFilter;
    this.cache.set(
      key,
      {
        key,
        range: [...range],
        texture: preview,
        area: (range[2] - range[0]) * (range[3] - range[1]),
      },
      128 * 128 * 4,
    );
  }
  find(range) {
    let best = null;
    for (const [key, entry] of this.cache.entries) {
      if (this.cache.now() - entry.created > this.cache.ttl) {
        this.cache.delete(key);
        continue;
      }
      const value = entry.value;
      if (
        containsRange(value.range, range) &&
        (!best || value.area < best.area)
      )
        best = value;
    }
    if (!best) return null;
    const result = this.cache.get(best.key);
    if (result) this.reuses++;
    return result;
  }
  metrics() {
    return {
      entries: this.cache.entries.size,
      MiB: Math.round(this.cache.bytes / 1024 ** 2),
      reuses: this.reuses,
    };
  }
}

export class RecentTileCache extends LRUCache {
  constructor(priority, now = () => performance.now()) {
    super();
    this.now = now;
    this.recent = new Map();
    this.grace = 20000;
    this.unloadPriorityCallback = (a, b) => {
      const first = this.recent.get(a) || 0,
        second = this.recent.get(b) || 0;
      return first === second ? priority(a, b) : first < second ? 1 : -1;
    };
  }
  remember(tile) {
    this.recent.set(tile, this.now());
  }
  remove(tile) {
    this.recent.delete(tile);
    return super.remove(tile);
  }
  unloadUnusedContent() {
    const temporary = [],
      now = this.now();
    // Grace is a soft rule. A hard byte/item cap always takes precedence.
    if (
      this.cachedBytes < this.maxBytesSize &&
      this.itemList.length < this.maxSize
    ) {
      for (const [tile, time] of this.recent) {
        if (!this.has(tile) || now - time > this.grace) {
          this.recent.delete(tile);
          continue;
        }
        if (!this.usedSet.has(tile) && this.loadedSet.has(tile)) {
          this.usedSet.add(tile);
          temporary.push(tile);
        }
      }
    }
    super.unloadUnusedContent();
    for (const tile of temporary) this.usedSet.delete(tile);
  }
}

export class StableDetailPlugin {
  constructor(camera) {
    this.name = "STABLE_MAP_DETAIL";
    this.camera = camera;
    this.refined = new Set();
    this.lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.lastRotation = new THREE.Quaternion();
    this.lastMovement = 0;
    this.moving = false;
    this.error = {};
  }
  init(tiles) {
    this.tiles = tiles;
    this.onVisibility = ({ tile, visible }) => {
      if (visible && tile.parent) this.refined.add(tile.parent);
      if (!visible) tiles.lruCache.remember?.(tile);
    };
    tiles.addEventListener("tile-visibility-change", this.onVisibility);
  }
  observe(time) {
    if (
      this.lastPosition.distanceToSquared(this.camera.position) > 0.01 ||
      this.lastRotation.angleTo(this.camera.quaternion) > 1e-5
    ) {
      this.lastMovement = time;
      this.lastPosition.copy(this.camera.position);
      this.lastRotation.copy(this.camera.quaternion);
    }
    this.moving = time - this.lastMovement < 250;
  }
  calculateTileViewError(tile, target) {
    if (!this.refined.has(tile)) return false;
    this.tiles.calculateTileViewError(tile, this.error);
    if (!this.error.inView) return false;
    if (this.error.error < this.tiles.errorTarget * 0.7) {
      this.refined.delete(tile);
      return false;
    }
    if (this.error.error >= this.tiles.errorTarget) return false;
    target.inView = true;
    target.error = this.tiles.errorTarget + 0.001;
    target.distance = this.error.distanceFromCamera;
    return true;
  }
  disposeTile(tile) {
    this.refined.delete(tile);
  }
  dispose() {
    this.tiles.removeEventListener("tile-visibility-change", this.onVisibility);
    this.refined.clear();
  }
}
