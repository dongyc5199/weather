import { THREE, WGS84_ELLIPSOID, FAILED, UNLOADED } from "./vendor.js";

export function resetFailedMapTiles(tiles) {
  if (!tiles) return;
  if (tiles.rootLoadingState === FAILED) tiles.rootLoadingState = UNLOADED;
  if (!tiles.stats.failed) return;
  // External 3D Tiles catalogs contain raw children that have not been
  // preprocessed. The pinned loader's reset method assumes every child has
  // `internal`, which throws and can stop the application's render loop.
  tiles.traverse(
    (tile) => {
      if (tile.internal?.loadingState === FAILED)
        tile.internal.loadingState = UNLOADED;
    },
    null,
    false,
  );
  tiles.stats.failed = 0;
}

/** A local, complete globe stays behind streamed tiles for the entire session. */
export class BaseGlobe extends THREE.Mesh {
  constructor(theme) {
    const geometry = new THREE.SphereGeometry(1, 192, 96);
    const position = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      WGS84_ELLIPSOID.getCartographicToPosition(
        (uv.getY(i) - 0.5) * Math.PI,
        (uv.getX(i) - 0.5) * Math.PI * 2,
        -12000,
        point,
      );
      position.setXYZ(i, point.x, point.y, point.z);
    }
    geometry.computeBoundingSphere();
    super(
      geometry,
      new THREE.MeshBasicMaterial({
        color: theme("--earth-globe-placeholder"),
        depthWrite: false,
      }),
    );
    this.theme = theme;
    this.name = "Persistent local base globe";
    this.frustumCulled = false;
    // Coarse terrain triangles are chords and can sit inside this smoother
    // globe. Draw its color first without hiding those triangles. Add only its
    // depth afterwards so far-side weather remains occluded in missing tiles.
    this.renderOrder = -1000;
    const depth = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    );
    depth.name = "Base globe weather occlusion";
    depth.renderOrder = 1000;
    depth.frustumCulled = false;
    this.add(depth);
  }
  setCountries(collection) {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = this.theme("--earth-globe-placeholder");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this.theme("--earth-globe-land");
    for (const feature of collection.features) {
      const polygons =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      for (const rings of polygons) {
        ctx.beginPath();
        for (const ring of rings) {
          ring.forEach(([lon, lat], i) => {
            const x = ((lon + 180) / 360) * canvas.width;
            const y = ((90 - lat) / 180) * canvas.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.material.map?.dispose();
    this.material.map = texture;
    this.material.color.set("white");
    this.material.needsUpdate = true;
  }
}

export async function fetchMapResource(url, options = {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(20000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      const response = await fetcher(url, { ...options, signal });
      if (
        attempt === 0 &&
        (response.status === 429 || response.status >= 500)
      ) {
        await response.body?.cancel();
      } else if (response.ok) {
        // Include body transfer in the retry window. Returning the streamed
        // response here lets a later timeout escape into the image cache.
        const body = await response.arrayBuffer();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } else {
        return response;
      }
    } catch (error) {
      if (options.signal?.aborted || attempt === 1) throw error;
    }
  }
}

export function queueMapResource(overlay, url, options = {}, fetcher = fetch) {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  if (overlay.preprocessURL) url = overlay.preprocessURL(url);
  const cached = overlay.responseCache?.get(url, options);
  if (cached) {
    overlay.onFetchResponse?.(url, cached);
    return Promise.resolve(cached);
  }
  // Start the timeout only after the network queue admits this request.
  // Queueing behind other tiles is not a transfer failure.
  const requestedAt = performance.now();
  return overlay.downloadQueue.add(
    url,
    {
      get priority() {
        return overlay.requestPriority?.(url) ?? -requestedAt;
      },
    },
    async () => {
      let response = overlay.responseCache?.get(url, options);
      if (!response) {
        response = await fetchMapResource(url, options, (...args) => {
          if (overlay.responseCache) overlay.responseCache.networkRequests++;
          return fetcher(...args);
        });
        if (overlay.responseCache)
          response = await overlay.responseCache.save(url, response, options);
      }
      overlay.onFetchResponse?.(url, response);
      return response;
    },
    options.signal,
  );
}

export class MapRequestPlugin {
  constructor({
    rootUrl,
    rootLayer,
    cacheKey,
    localOrigin = globalThis.location?.origin,
  } = {}) {
    this.name = "MAP_REQUEST_RESILIENCE";
    this.priority = 100;
    this.rootUrl = rootUrl ? new URL("layer.json", rootUrl).href : null;
    this.rootLayer = rootLayer;
    this.terrainRoot = rootUrl;
    this.cacheKey = cacheKey;
    this.localOrigin = localOrigin;
  }
  fetchData(url, options) {
    if (this.rootLayer && String(url) === this.rootUrl) {
      return Promise.resolve(
        new Response(JSON.stringify(this.rootLayer), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    const tile =
      this.cacheKey &&
      String(url).startsWith(this.terrainRoot) &&
      /\/(\d+)\/(\d+)\/(\d+)\.terrain(?:\?|$)/.exec(String(url));
    if (tile && this.localOrigin) {
      const path = `/api/earth/3d/terrain-tile/${tile[1]}/${tile[2]}/${tile[3]}.terrain`;
      const cachedUrl = new URL(path, this.localOrigin);
      cachedUrl.searchParams.set("source", this.cacheKey);
      const { headers, ...localOptions } = options || {};
      return (async () => {
        try {
          const response = await fetchMapResource(cachedUrl.href, localOptions);
          if (response.ok) return response;
          await response.body?.cancel();
        } catch (error) {
          if (options?.signal?.aborted) throw error;
        }
        return fetchMapResource(url, options);
      })();
    }
    return fetchMapResource(url, options);
  }
}
