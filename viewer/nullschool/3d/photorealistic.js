import {
  TilesRenderer,
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
  DRACOLoader,
  MeshoptDecoder,
  DownloadPriorityQueue,
  PriorityQueue,
} from "./vendor.js";
import { RecentTileCache } from "./map-streaming.js";

export class PhotorealisticRequests extends GoogleCloudAuthPlugin {
  constructor(url) {
    const root = new URL(url);
    if (
      root.origin !== "https://tile.googleapis.com" ||
      root.username ||
      root.password ||
      root.pathname !== "/v1/3dtiles/root.json" ||
      !root.searchParams.get("key")
    )
      throw new Error("Google 实景三维入口无效");
    super({
      apiToken: root.searchParams.get("key"),
      autoRefreshToken: true,
      useRecommendedSettings: false,
    });
    root.searchParams.delete("key");
    this.rootURL = root.href;
  }
  async fetchData(value, options = {}) {
    const url = new URL(value);
    if (
      url.origin !== "https://tile.googleapis.com" ||
      url.username ||
      url.password ||
      !url.pathname.startsWith("/v1/3dtiles/")
    )
      throw new Error("Google 实景三维请求源无效");
    const headers = new Headers(options.headers);
    headers.delete("Authorization");
    const timeout = AbortSignal.timeout(30000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      // Use the provider's live session and HTTP cache policy. Do not route this
      // data through the Esri response cache or the local terrain tile store.
      const result = await super.fetchData(url.href, {
        ...options,
        headers,
        signal,
      });
      if (result instanceof Response && !result.ok)
        throw new Error(`Google 实景三维 HTTP ${result.status}`);
      return result;
    } catch (error) {
      // The pinned auth helper retains a rejected refresh promise otherwise.
      this.auth._tokenRefreshPromise = null;
      throw error;
    }
  }
}

export class PhotorealisticSurface {
  constructor(info, camera, renderer) {
    this.info = info;
    this.models = new Map();
    const requests = new PhotorealisticRequests(info.url);
    const tiles = new TilesRenderer(requests.rootURL);
    this.tiles = tiles;
    const cache = new RecentTileCache(tiles.lruCache.unloadPriorityCallback);
    cache.minSize = 600;
    cache.maxSize = 800;
    cache.minBytesSize = 480 * 1024 ** 2;
    cache.maxBytesSize = 512 * 1024 ** 2;
    tiles.lruCache = cache;
    const download = new DownloadPriorityQueue();
    download.maxJobsPerOrigin = 12;
    download.priorityCallback = tiles.downloadQueue.priorityCallback;
    tiles.downloadQueue = download;
    const parsing = new PriorityQueue();
    parsing.maxJobs = 3;
    parsing.priorityCallback = tiles.parseQueue.priorityCallback;
    tiles.parseQueue = parsing;
    this.draco = new DRACOLoader(tiles.manager);
    this.draco.setDecoderPath(
      new URL("./decoders/draco/", import.meta.url).href,
    );
    this.draco.setWorkerLimit(2);
    tiles.registerPlugin(
      new GLTFExtensionsPlugin({
        dracoLoader: this.draco,
        meshoptDecoder: MeshoptDecoder,
        autoDispose: false,
      }),
    );
    tiles.registerPlugin(requests);
    // Keep the same geometric detail per CSS pixel on Retina displays; the
    // framebuffer still renders at full DPR. Otherwise DPR 2 increases the
    // tile demand for the same city view and churns the bounded model cache.
    tiles.errorTarget = 6 * renderer.getPixelRatio();
    tiles.loadAncestors = true;
    tiles.loadSiblings = false;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.addEventListener("load-model", ({ tile, scene }) => {
      let meshes = 0,
        texturedMeshes = 0;
      scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        meshes++;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        if (materials.some((material) => material?.map)) texturedMeshes++;
        mesh.userData.weatherPhotorealistic = true;
      });
      // Preserve the source's baked facade/roof textures and materials.
      this.models.set(tile, { meshes, texturedMeshes });
    });
    tiles.addEventListener("dispose-model", ({ tile }) =>
      this.models.delete(tile),
    );
  }
  getState() {
    let visibleMeshes = 0,
      texturedMeshes = 0;
    for (const tile of this.tiles.visibleTiles) {
      const info = this.models.get(tile);
      visibleMeshes += info?.meshes || 0;
      texturedMeshes += info?.texturedMeshes || 0;
    }
    return {
      provider: "Google Maps",
      loadedTiles: this.models.size,
      visibleMeshes,
      texturedMeshes,
    };
  }
  credits() {
    return this.tiles
      .getAttributions()
      .filter((item) => item.type === "string")
      .map((item) => item.value)
      .filter(Boolean)
      .join(" · ");
  }
  resize(camera, renderer) {
    this.tiles.setResolutionFromRenderer(camera, renderer);
    this.tiles.errorTarget = 6 * renderer.getPixelRatio();
  }
  dispose() {
    this.draco.dispose();
    this.models.clear();
  }
}
