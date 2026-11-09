import {
  THREE,
  TilesRenderer,
  LRUCache,
  PriorityQueue,
  DownloadPriorityQueue,
  GLTFExtensionsPlugin,
  ImplicitTilingPlugin,
  DRACOLoader,
  MeshoptDecoder,
  WGS84_ELLIPSOID,
} from "./vendor.js";
import { fetchMapResource, resetFailedMapTiles } from "./map-runtime.js";

export function buildingsInRange(altitude, wasActive = false) {
  return altitude < (wasActive ? 100000 : 80000);
}

export function creditURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function renderBuildingCredits(container, info, prefix = " · ") {
  container.replaceChildren();
  if (!info) return;
  container.append(prefix + (info.provider || "Cesium OSM Buildings") + " · ");
  const append = (node, target) => {
    if (node.nodeType === 3) {
      target.append(node.textContent);
      return;
    }
    if (
      node.nodeType !== 1 ||
      ["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName)
    )
      return;
    let childTarget = target;
    if (node.tagName === "A") {
      const href = creditURL(node.getAttribute("href"));
      if (href) {
        childTarget = document.createElement("a");
        childTarget.href = href;
        childTarget.target = "_blank";
        childTarget.rel = "noopener noreferrer";
        target.append(childTarget);
      }
    } else if (node.tagName === "IMG") {
      const src = creditURL(node.getAttribute("src"));
      if (src && /(^|\.)cesium\.com$/.test(new URL(src).hostname)) {
        const img = document.createElement("img");
        img.src =
          src === "https://assets.ion.cesium.com/ion-credit.png"
            ? new URL("./assets/cesium-ion-credit.png", import.meta.url).href
            : src;
        img.alt =
          node.getAttribute("alt") ||
          node.getAttribute("title") ||
          "Cesium ion";
        img.className = "earth-credit-logo";
        target.append(img);
      }
      return;
    }
    for (const child of node.childNodes) append(child, childTarget);
  };
  if (info.attributions?.length) {
    info.attributions.forEach((item, index) => {
      if (index) container.append(" · ");
      const template = document.createElement("template");
      template.innerHTML = item.html;
      for (const child of template.content.childNodes) append(child, container);
    });
  } else
    container.append(
      info.credits?.join(" · ") || "© OpenStreetMap contributors",
    );
}

export class BuildingRequests {
  constructor(info, refresh) {
    this.name = "BUILDING_REQUESTS";
    this.priority = 100;
    this.info = info;
    this.refresh = refresh;
    this.refreshing = null;
    this.lastRefresh = -Infinity;
  }
  preprocessURL(value) {
    const url = new URL(value);
    const root = new URL(this.info.url);
    if (url.origin === root.origin && root.searchParams.has("v"))
      url.searchParams.set("v", root.searchParams.get("v"));
    return url.href;
  }
  async fetchData(value, options = {}) {
    const url = new URL(value),
      root = new URL(this.info.url);
    const sameOrigin = url.origin === root.origin;
    if (sameOrigin && url.pathname === root.pathname && this.info.root) {
      return new Response(JSON.stringify(this.info.root), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const request = () => {
      const headers = new Headers(options.headers);
      headers.delete("Authorization");
      if (url.origin === new URL(this.info.url).origin)
        headers.set("Authorization", "Bearer " + this.info.accessToken);
      return fetchMapResource(value, {
        ...options,
        headers: Object.fromEntries(headers),
      });
    };
    let response = await request();
    if (
      sameOrigin &&
      [401, 403].includes(response.status) &&
      performance.now() - this.lastRefresh > 30000
    ) {
      if (!this.refreshing) {
        this.lastRefresh = performance.now();
        this.refreshing = this.refresh(true)
          .then((info) => {
            this.info = info;
          })
          .finally(() => {
            this.refreshing = null;
          });
      }
      await this.refreshing;
      options.signal?.throwIfAborted();
      await response.body?.cancel();
      response = await request();
    }
    return response;
  }
}

export class BuildingsLayer {
  constructor({ parent, camera, renderer, color, onStatus, onCredits }) {
    Object.assign(this, {
      parent,
      camera,
      renderer,
      color,
      onStatus,
      onCredits,
    });
    this.onStatus = (value) => {
      if (this.status === value) return;
      this.status = value;
      onStatus(value);
    };
    this.enabled = false;
    this.active = false;
    this.tiles = null;
    this.draco = null;
    this.requests = null;
    this.info = null;
    this.loading = false;
    this.generation = 0;
    this.failures = 0;
    this.retryAt = 0;
    this.authAt = 0;
    this.lastStatusAt = 0;
    this.modelInfo = new Map();
    this.metadataController = null;
  }
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) this.retryAt = 0;
    if (!this.enabled) {
      this.disposeTiles();
      this.onStatus("");
      this.onCredits(null);
    }
  }
  async fetchInfo(refresh = false) {
    const generation = this.generation;
    const controller = new AbortController();
    this.metadataController = controller;
    const response = await fetch(
      "/api/earth/3d/buildings" + (refresh ? "?refresh=1" : ""),
      {
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(35000),
        ]),
      },
    );
    if (!response.ok) throw new Error("建筑服务暂不可用");
    const info = await response.json();
    if (
      generation !== this.generation ||
      controller.signal.aborted ||
      !this.enabled
    )
      throw new DOMException("Building layer changed", "AbortError");
    if (!info.available) {
      const error = new Error(info.message || "建筑服务暂不可用");
      error.name = "BuildingsUnavailable";
      throw error;
    }
    this.authAt = performance.now();
    this.info = info;
    this.onCredits(info);
    return info;
  }
  async start(refresh = false) {
    if (this.loading || this.tiles || !this.enabled) return;
    const generation = ++this.generation;
    this.loading = true;
    this.onStatus("3D 建筑 · 正在连接 OSM 数据…");
    try {
      const info = await this.fetchInfo(refresh || this.needsRefresh);
      this.needsRefresh = false;
      if (generation !== this.generation || !this.enabled) return;
      const tiles = new TilesRenderer(info.url);
      const cache = new LRUCache();
      cache.unloadPriorityCallback = tiles.lruCache.unloadPriorityCallback;
      cache.minSize = 64;
      cache.maxSize = 256;
      cache.minBytesSize = 64 * 1024 ** 2;
      cache.maxBytesSize = 128 * 1024 ** 2;
      tiles.lruCache = cache;
      const downloads = new DownloadPriorityQueue();
      downloads.maxJobsPerOrigin = 4;
      downloads.priorityCallback = tiles.downloadQueue.priorityCallback;
      tiles.downloadQueue = downloads;
      const parsing = new PriorityQueue();
      parsing.maxJobs = 2;
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
      tiles.registerPlugin(new ImplicitTilingPlugin());
      this.requests = new BuildingRequests(info, (force) =>
        this.fetchInfo(force),
      );
      tiles.registerPlugin(this.requests);
      tiles.errorTarget = 8;
      tiles.loadAncestors = false;
      tiles.loadSiblings = false;
      tiles.setCamera(this.camera);
      tiles.setResolutionFromRenderer(this.camera, this.renderer);
      tiles.addEventListener("load-model", ({ scene, tile }) => {
        if (this.tiles === tiles) this.styleModel(scene, tile);
      });
      tiles.addEventListener("dispose-model", ({ tile }) =>
        this.modelInfo.delete(tile),
      );
      tiles.addEventListener("load-error", () => {
        if (this.tiles !== tiles) return;
        this.failures++;
        this.retryAt = performance.now() + 30000;
        this.onStatus("3D 建筑 · 部分数据待重试");
      });
      this.tiles = tiles;
      if (this.active) this.parent.add(tiles.group);
      this.failures = 0;
      this.onStatus("3D 建筑 · 正在加载城市模型…");
    } catch (error) {
      if (generation !== this.generation || error.name === "AbortError") return;
      this.failures++;
      this.retryAt =
        error.name === "BuildingsUnavailable"
          ? Infinity
          : performance.now() + 30000;
      this.onStatus(error.message || "3D 建筑暂不可用，可重试");
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
  styleModel(scene, tile) {
    let meshes = 0,
      triangles = 0;
    const replacements = new Map();
    scene.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      mesh.userData.weatherBuilding = true;
      meshes++;
      triangles +=
        (mesh.geometry.index?.count ||
          mesh.geometry.attributes.position.count) / 3;
      const style = (material) => {
        if (material.isMeshBasicMaterial) {
          if (!replacements.has(material)) {
            const lit = new THREE.MeshStandardMaterial({
              color: material.color.clone(),
              map: material.map,
              vertexColors: material.vertexColors,
              side: material.side,
              transparent: material.transparent,
              opacity: material.opacity,
              roughness: 1,
              metalness: 0,
            });
            replacements.set(material, lit);
            tile.engineData.materials.push(lit);
          }
          material = replacements.get(material);
        }
        if (!material.userData.weatherBuildingStyled) {
          material.color?.multiply(new THREE.Color(this.color));
          material.userData.weatherBuildingStyled = true;
          material.needsUpdate = true;
        }
        return material;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(style)
        : style(mesh.material);
    });
    this.modelInfo.set(tile, { meshes, triangles });
  }
  resize() {
    this.tiles?.setResolutionFromRenderer(this.camera, this.renderer);
  }
  disposeTiles() {
    this.generation++;
    this.metadataController?.abort();
    this.tiles?.group.removeFromParent();
    this.tiles?.dispose();
    this.draco?.dispose();
    this.tiles = this.draco = this.requests = null;
    this.modelInfo.clear();
    this.loading = false;
    this.active = false;
  }
  retry() {
    this.disposeTiles();
    this.failures = 0;
    this.retryAt = 0;
    this.needsRefresh = true;
    this.renderErrors = 0;
  }
  recoverFromUpdateError(error) {
    this.lastError = String(error?.message || error).slice(0, 180);
    this.renderErrors = (this.renderErrors || 0) + 1;
    this.disposeTiles();
    this.failures = 1;
    this.retryAt =
      this.renderErrors >= 3 ? Infinity : performance.now() + 30000;
    this.onStatus("3D 建筑暂不可用，可重试");
  }
  update(time, terrainReady) {
    if (!this.enabled) return;
    const altitude = WGS84_ELLIPSOID.getPositionElevation(this.camera.position);
    const wasActive = this.active;
    const active = terrainReady && buildingsInRange(altitude, wasActive);
    this.active = active;
    if (!active) {
      this.tiles?.group.removeFromParent();
      if (wasActive && this.tiles) {
        for (const tile of [...this.tiles.loadingTiles])
          this.tiles.lruCache.remove(tile);
      }
      this.onStatus(
        terrainReady
          ? "3D 建筑 · 放大至城市尺度后显示"
          : "3D 建筑 · 等待真实地形",
      );
      return;
    }
    if (!this.tiles && !this.loading && time >= this.retryAt) this.start();
    if (this.tiles) {
      if (!this.tiles.group.parent) this.parent.add(this.tiles.group);
      this.tiles.update();
      if (time - this.authAt > 600000 && !this.refreshing) {
        const tiles = this.tiles;
        this.authAt = time;
        this.refreshing = this.fetchInfo()
          .then((info) => {
            if (this.tiles === tiles) this.requests.info = info;
          })
          .catch(() => {})
          .finally(() => {
            this.refreshing = null;
          });
      }
      if (this.failures && time >= this.retryAt) {
        this.retryAt = time + 30000;
        this.failures = 0;
        resetFailedMapTiles(this.tiles);
      }
      if (time - this.lastStatusAt > 1000) {
        this.lastStatusAt = time;
        const s = this.getState();
        this.onStatus(
          s.visibleMeshes
            ? "3D 建筑 · Cesium OSM Buildings" +
                (this.failures
                  ? " · 部分数据待重试"
                  : s.pending
                    ? " · 加载细节中"
                    : "")
            : s.pending
              ? "3D 建筑 · 正在加载城市模型…"
              : "3D 建筑 · 当前视野暂无模型",
        );
      }
    }
  }
  getState() {
    let meshes = 0,
      triangles = 0,
      visibleMeshes = 0;
    for (const [tile, info] of this.modelInfo) {
      meshes += info.meshes;
      triangles += info.triangles;
      if (this.active && this.tiles?.visibleTiles.has(tile))
        visibleMeshes += info.meshes;
    }
    const stats = this.tiles?.stats;
    return {
      enabled: this.enabled,
      active: this.active,
      loading: this.loading,
      loadedTiles: this.modelInfo.size,
      visibleTiles: this.tiles?.visibleTiles.size || 0,
      visibleMeshes,
      meshes,
      triangles,
      pending: stats
        ? stats.queued + stats.downloading + stats.parsing
        : Number(this.loading),
      cacheMiB: Math.round((this.tiles?.lruCache.cachedBytes || 0) / 1024 ** 2),
      failures: this.failures,
      lastError: this.lastError || null,
    };
  }
}
