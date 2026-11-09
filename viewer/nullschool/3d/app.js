import {
  THREE,
  TilesRenderer,
  GlobeControls,
  WGS84_ELLIPSOID,
  QuantizedMeshPlugin,
  GeneratedSurfacePlugin,
  XYZTilesOverlay,
  GeoJSONOverlay,
  WMSTilesOverlay,
} from "./vendor.js";
import { gridSampler, WindLayer } from "./weather.js";
import { CompleteImageOverlayPlugin } from "./overlays.js";
import {
  BaseGlobe,
  MapRequestPlugin,
  resetFailedMapTiles,
} from "./map-runtime.js";
import { BuildingsLayer, renderBuildingCredits } from "./buildings.js";
import { PhotorealisticSurface } from "./photorealistic.js";
import {
  ImageResponseCache,
  SatellitePreviewCache,
  RecentTileCache,
  StableDetailPlugin,
  visibleImagePriority,
} from "./map-streaming.js";

const $ = (id) => document.getElementById(id),
  RAD = Math.PI / 180;
const theme = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const levels = [
  "surface",
  "1000hPa",
  "850hPa",
  "700hPa",
  "500hPa",
  "250hPa",
  "70hPa",
  "10hPa",
];
const query = new URLSearchParams(location.search);
const loadMetrics = {
  startedAt: performance.now(),
  firstTerrainMs: null,
  firstImageryMs: null,
  imageryZooms: {},
  textureSize: 0,
};
const state = {
  basemap: query.get("basemap") === "terrain" ? "terrain" : "google",
  level: levels.includes(query.get("level")) ? query.get("level") : "surface",
  manifest: null,
  grid: null,
  profile: null,
  heightStatus: "正在加载风层高度…",
  weatherStatus: "",
  mapFailures: 0,
  mapBootstrapError: null,
  terrain: false,
  terrainReady: false,
  models: 0,
  imageryResponses: 0,
  cloud: false,
  cloudObservation: null,
  selected: null,
  errors: [],
  ready: false,
};
let tiles,
  photoSurface,
  overlays,
  weatherOverlay,
  cloudOverlay,
  terrainInfo,
  surfaceVersion = 0,
  weatherVersion = 0,
  cloudVersion = 0;
let activeFrame = null,
  paused = false,
  lastRender = performance.now(),
  lastStatus = 0,
  pointerDown = null,
  cloudRefreshAt = 0;
let cloudLoading = false,
  terrainRefreshAt = 0;
let mapRetryAt = 0;
let palette = null;
const imageResponses = new ImageResponseCache();
const imagePreviews = new SatellitePreviewCache();
let mapStability;
const geo = {};
const scene = new THREE.Scene();
scene.background = new THREE.Color(theme("--earth-scene-background"));
scene.add(new THREE.AmbientLight(theme("--earth-scene-light"), 2.1));
const terrainLight = new THREE.DirectionalLight(
  theme("--earth-scene-light"),
  1.1,
);
scene.add(terrainLight);
const camera = new THREE.PerspectiveCamera(
  42,
  innerWidth / innerHeight,
  100,
  1e9,
);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$("three-stage").append(renderer.domElement);
const fallback = new BaseGlobe(theme);
scene.add(fallback);
const surfaceGroup = new THREE.Group();
surfaceGroup.name = "Terrain and buildings";
scene.add(surfaceGroup);
const controls = new GlobeControls(surfaceGroup, camera, renderer.domElement);
controls.minDistance = 150;
controls.maxDistance = 35000000;
controls.cameraRadius = 100;
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.enableDoubleTapZoom = true;
controls.zoomSpeed = 1.25;
const winds = new WindLayer(scene, camera);
const buildings = new BuildingsLayer({
  parent: surfaceGroup,
  camera,
  renderer,
  color: theme("--earth-building-tint"),
  onStatus: (text) => {
    $("three-building-status").textContent = text;
  },
  onCredits: (info) => renderBuildingCredits($("building-credit"), info),
});
const marker = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({
    color: theme("--earth-probe-color"),
    depthTest: true,
  }),
);
marker.visible = false;
marker.renderOrder = 100;
scene.add(marker);

const satellite = new XYZTilesOverlay({
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  levels: 20,
  projection: "EPSG:3857",
  opacity: 1,
});
satellite.responseCache = imageResponses;
satellite.requestPriority = (url) => visibleImagePriority(satellite, url);
satellite.onFetchResponse = (url, r) => {
  if (r.ok) {
    state.imageryResponses++;
    const zoom = /\/tile\/(\d+)\//.exec(String(url))?.[1];
    if (zoom)
      loadMetrics.imageryZooms[zoom] =
        (loadMetrics.imageryZooms[zoom] || 0) + 1;
  }
};
const admin = {
  countries: new GeoJSONOverlay({
    url: "../data/geography/countries.geojson",
    strokeStyle: theme("--earth-country-line"),
    strokeWidth: 0.7,
    fillStyle: "transparent",
    opacity: 0.64,
  }),
  provinces: new GeoJSONOverlay({
    url: "../data/geography/china-provinces.geojson",
    strokeStyle: theme("--earth-province-line"),
    strokeWidth: 0.6,
    fillStyle: "transparent",
    opacity: 0.52,
  }),
  cities: new GeoJSONOverlay({
    url: "../data/geography/china-cities.geojson",
    strokeStyle: theme("--earth-city-line"),
    strokeWidth: 0.6,
    fillStyle: "transparent",
    opacity: 0,
  }),
};
for (const layer of Object.values(admin)) layer.detailResolution = 256;

function date(value) {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}
function error(message) {
  state.errors.push(message);
  $("three-map-status").textContent = message;
}
async function json(url, timeout = 25000) {
  const r = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function preset(name) {
  controls.resetState();
  winds.clear();
  let lat = 26,
    lon = 105,
    height = 16000000;
  if (name === "china") {
    lat = 34;
    lon = 106;
    height = 7000000;
  }
  if (["city", "buildings", "osaka"].includes(name)) {
    const osaka = name === "osaka";
    lat = osaka ? 34.6907 : 34.26;
    lon = osaka ? 135.4935 : 108.95;
    const target = WGS84_ELLIPSOID.getCartographicToPosition(
      lat * RAD,
      lon * RAD,
      osaka ? 30 : 400,
      new THREE.Vector3(),
    );
    const east = new THREE.Vector3(),
      north = new THREE.Vector3(),
      up = new THREE.Vector3();
    WGS84_ELLIPSOID.getEastNorthUpAxes(lat * RAD, lon * RAD, east, north, up);
    camera.position
      .copy(target)
      .addScaledVector(up, osaka ? 900 : name === "buildings" ? 650 : 2400)
      .addScaledVector(
        north,
        osaka ? -1100 : name === "buildings" ? -1200 : -2600,
      )
      .addScaledVector(east, osaka ? 750 : name === "buildings" ? 450 : 900);
    camera.up.copy(up);
    camera.lookAt(target);
  } else if (name === "everest") {
    lat = 27.9881;
    lon = 86.925;
    const target = WGS84_ELLIPSOID.getCartographicToPosition(
      lat * RAD,
      lon * RAD,
      8848,
      new THREE.Vector3(),
    );
    const east = new THREE.Vector3(),
      north = new THREE.Vector3(),
      up = new THREE.Vector3();
    WGS84_ELLIPSOID.getEastNorthUpAxes(lat * RAD, lon * RAD, east, north, up);
    camera.position
      .copy(target)
      .addScaledVector(up, 15000)
      .addScaledVector(north, -33000)
      .addScaledVector(east, 14000);
    camera.up.copy(up);
    camera.lookAt(target);
  } else if (name === "layers") {
    lat = 34.34;
    lon = 108.94;
    const target = WGS84_ELLIPSOID.getCartographicToPosition(
      lat * RAD,
      lon * RAD,
      0,
      new THREE.Vector3(),
    );
    const east = new THREE.Vector3(),
      north = new THREE.Vector3(),
      up = new THREE.Vector3();
    WGS84_ELLIPSOID.getEastNorthUpAxes(lat * RAD, lon * RAD, east, north, up);
    camera.position
      .copy(target)
      .addScaledVector(up, 180000)
      .addScaledVector(north, -380000)
      .addScaledVector(east, 80000);
    camera.up.copy(up);
    camera.lookAt(target);
  } else {
    WGS84_ELLIPSOID.getCartographicToPosition(
      lat * RAD,
      lon * RAD,
      height,
      camera.position,
    );
    camera.up.set(
      -Math.sin(lat * RAD) * Math.cos(lon * RAD),
      -Math.sin(lat * RAD) * Math.sin(lon * RAD),
      Math.cos(lat * RAD),
    );
    camera.lookAt(0, 0, 0);
  }
  camera.updateMatrixWorld();
  controls.setCamera(camera);
  controls.adjustCamera(camera);
  controls.resetState();
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("highlighted", b.dataset.view === name));
  const url = new URL(location);
  url.searchParams.set("view", name);
  history.replaceState(null, "", url);
}

function weatherPath(kind) {
  const m = state.manifest;
  return (
    m?.layers?.[state.level]?.files?.[kind] ||
    (state.level === "surface" ? m?.files?.[kind] : null)
  );
}

async function buildSurface(useTerrain, basemap = state.basemap) {
  const version = ++surfaceVersion;
  state.requestedBasemap = basemap;
  state.mapBootstrapError = null;
  const photo = basemap === "google";
  let photoInfo;
  $("three-map-status").textContent = photo
    ? "正在连接 Google 实景三维…"
    : useTerrain
      ? "正在加载真实地形…"
      : "正在加载卫星底图…";
  if (photo) {
    try {
      photoInfo = await json("/api/earth/3d/photorealistic");
      if (!photoInfo.available) throw new Error(photoInfo.message);
    } catch (err) {
      if (version !== surfaceVersion) return;
      state.mapBootstrapError = err.message || "Google 实景三维暂不可用";
      state.mapFailures++;
      error(state.mapBootstrapError);
      return;
    }
    if (version !== surfaceVersion) return;
  } else if (useTerrain) {
    try {
      terrainInfo = await json("/api/earth/3d/terrain");
    } catch {
      terrainInfo = { available: false };
    }
    if (version !== surfaceVersion) return;
    terrainRefreshAt = performance.now();
    if (!terrainInfo.available) {
      useTerrain = false;
      $("terrain").checked = false;
      error("地形服务暂不可用，显示椭球底图");
    }
  }
  if (tiles) {
    tiles.group.removeFromParent();
    tiles.dispose();
  }
  photoSurface?.dispose();
  photoSurface = null;
  state.models = 0;
  state.ready = false;
  state.mapFailures = 0;
  state.terrainReady = false;
  state.terrain = useTerrain || photo;
  state.basemap = basemap;
  fallback.visible = !photo;
  buildings.setEnabled(!photo && $("buildings").checked);
  if (photo) {
    photoSurface = new PhotorealisticSurface(photoInfo, camera, renderer);
    tiles = photoSurface.tiles;
  } else {
    tiles = new TilesRenderer(useTerrain ? terrainInfo.url : null);
    const cache = new RecentTileCache(tiles.lruCache.unloadPriorityCallback);
    cache.maxSize = 700;
    cache.minSize = 630;
    cache.maxBytesSize = 0.4 * 1024 ** 3;
    cache.minBytesSize = 0.395 * 1024 ** 3;
    tiles.lruCache = cache;
    if (useTerrain) {
      tiles.fetchOptions.headers = {
        Authorization: "Bearer " + terrainInfo.accessToken,
      };
      tiles.registerPlugin(new QuantizedMeshPlugin());
    } else {
      tiles.registerPlugin(
        new GeneratedSurfacePlugin({
          overlay: satellite,
          projection: "ellipsoid",
        }),
      );
    }
  }
  mapStability = new StableDetailPlugin(camera);
  tiles.registerPlugin(mapStability);
  overlays = new CompleteImageOverlayPlugin({
    resolution: 512,
    enableTileSplitting: !photo,
    primaryOverlay: photo ? null : satellite,
    getBaseTexture: photo ? null : () => fallback.material.map,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    previewCache: photo ? null : imagePreviews,
    isInteracting: () => mapStability.moving,
    overlays: [
      ...(!photo && $("satellite").checked ? [satellite] : []),
      ...Object.entries(admin)
        .filter(([key]) => $(key).checked)
        .map(([, layer]) => layer),
    ],
  });
  tiles.registerPlugin(overlays);
  overlays.onTexture = (overlay, texture) => {
    if (overlay !== satellite || !texture) return;
    loadMetrics.firstImageryMs ??= Math.round(
      performance.now() - loadMetrics.startedAt,
    );
    loadMetrics.textureSize = Math.max(
      loadMetrics.textureSize,
      texture.image?.width || 0,
    );
  };
  if (!photo)
    tiles.registerPlugin(
      new MapRequestPlugin(
        useTerrain
          ? {
              rootUrl: terrainInfo.url,
              rootLayer: terrainInfo.layer,
              cacheKey: terrainInfo.terrain_cache_key,
            }
          : {},
      ),
    );
  if (!photo) tiles.errorTarget = 2;
  tiles.loadAncestors = true;
  tiles.loadSiblings = !photo;
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.addEventListener("load-model", () => {
    loadMetrics.firstTerrainMs ??= Math.round(
      performance.now() - loadMetrics.startedAt,
    );
    state.models++;
    state.terrainReady = useTerrain || photo;
    if (photo)
      loadMetrics.firstImageryMs ??= Math.round(
        performance.now() - loadMetrics.startedAt,
      );
    state.ready = true;
  });
  tiles.addEventListener("load-error", (event) => {
    const message = event.error?.message || "图层加载失败";
    state.errors.push(message.replace(/Bearer\s+\S+/g, "[redacted]"));
    state.mapFailures++;
    $("three-map-status").textContent =
      "部分瓦片加载失败，正在保留已加载的地图";
  });
  surfaceGroup.add(tiles.group);
  controls.setScene(surfaceGroup);
  controls.setEllipsoid(WGS84_ELLIPSOID, tiles.group);
  activeFrame = surfaceGroup;
  if (weatherOverlay && $("temperature").checked)
    overlays.addOverlay(weatherOverlay, 10);
  if (cloudOverlay && state.cloud) overlays.addOverlay(cloudOverlay, 20);
  $("terrain-options").hidden = photo;
  $("building-options").hidden = photo;
  $("photo-note").hidden = !photo;
  $("base-credit").hidden = photo;
  $("tile-credit").textContent = "";
  renderBuildingCredits($("provider-credit"), photoInfo, "");
  document.querySelectorAll("[data-basemap]").forEach((button) => {
    button.classList.toggle("highlighted", button.dataset.basemap === basemap);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.basemap === basemap),
    );
  });
  const url = new URL(location);
  url.searchParams.set("basemap", basemap);
  history.replaceState(null, "", url);
  applyLayerOpacity();
}

async function retryMap() {
  mapRetryAt = performance.now();
  if (!tiles || state.mapBootstrapError) {
    await buildSurface($("terrain").checked, state.requestedBasemap).catch(
      (err) => error(err.message),
    );
    return;
  }
  if (state.terrain && !photoSurface) await refreshTerrainAuthorization();
  resetFailedMapTiles(tiles);
  overlays?.resetFailedOverlays();
  state.mapFailures = 0;
}

function applyLayerOpacity() {
  const include = (layer, enabled, order) => {
    if (!layer || !overlays) return;
    const present = overlays.overlays.includes(layer);
    if (enabled && !present) overlays.addOverlay(layer, order);
    if (!enabled && present) overlays.deleteOverlay(layer);
  };
  satellite.opacity = $("satellite").checked ? 1 : 0;
  include(satellite, !photoSurface && $("satellite").checked, 0);
  for (const key of Object.keys(admin)) {
    admin[key].opacity = $(key).checked
      ? key === "countries"
        ? 0.64
        : key === "provinces"
          ? 0.52
          : 0.48
      : 0;
    include(
      admin[key],
      $(key).checked,
      key === "countries" ? 1 : key === "provinces" ? 2 : 3,
    );
  }
  if (weatherOverlay)
    weatherOverlay.opacity = $("temperature").checked
      ? Number($("weather-opacity").value)
      : 0;
  if (cloudOverlay) cloudOverlay.opacity = $("cloud").checked ? 0.58 : 0;
  include(weatherOverlay, $("temperature").checked, 10);
  include(cloudOverlay, $("cloud").checked, 20);
  $("three-scale-row").hidden = !$("temperature").checked;
  if ($("temperature").checked) drawLegend();
  winds.enabled = $("wind").checked;
  $("opacity-value").value =
    Math.round(Number($("weather-opacity").value) * 100) + "%";
}

async function drawLegend() {
  if (!palette) {
    try {
      palette = await json("/api/earth/3d/palette");
    } catch {
      return;
    }
  }
  const canvas = $("three-scale"),
    rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const ctx = canvas.getContext("2d"),
    gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  const min = palette.stops[0],
    max = palette.stops.at(-1);
  palette.stops.forEach((stop, i) =>
    gradient.addColorStop(
      (stop - min) / (max - min),
      `rgb(${palette.colors[i].join(",")})`,
    ),
  );
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

async function loadWeather() {
  const version = ++weatherVersion;
  winds.clear();
  winds.setGrid(null);
  state.grid = null;
  state.profile = null;
  $("three-height-status").textContent = "正在加载风场与对应高度…";
  if (state.selected) showPoint(state.selected);
  if (weatherOverlay) {
    overlays?.deleteOverlay(weatherOverlay);
    weatherOverlay = null;
  }
  const level = state.level;
  $("three-data-status").textContent =
    "正在加载 " + (level === "surface" ? "地面" : level) + " 风场与气温…";
  document.querySelectorAll("[data-level]").forEach((b) => {
    const active = b.dataset.level === level;
    b.classList.toggle("highlighted", active);
    b.setAttribute("aria-pressed", String(active));
  });
  try {
    const paths = [weatherPath("wind"), weatherPath("temp")];
    if (paths.some((p) => !p)) throw new Error("这一高度的数据还未准备好");
    const [wind, temp] = await Promise.all(
      paths.map((path) => json("../" + path)),
    );
    if (version !== weatherVersion) return;
    const grid = gridSampler(wind, temp);
    if ((grid.header.layer || "surface") !== level)
      throw new Error("气压层不匹配");
    state.grid = grid;
    state.profile = null;
    state.heightStatus = "正在加载同批次 GFS 风层高度…";
    $("three-height-status").textContent = state.heightStatus;
    loadHeights(version, grid, level, state.manifest.id);
    if (weatherOverlay) overlays?.deleteOverlay(weatherOverlay);
    weatherOverlay = new XYZTilesOverlay({
      url: `/api/earth/3d/grid/${state.manifest.id}/${level}/temp/{z}/{x}/{y}.png`,
      projection: "EPSG:4326",
      levels: 9,
      opacity: 0,
    });
    weatherOverlay.detailResolution = 256;
    if ($("temperature").checked) overlays?.addOverlay(weatherOverlay, 10);
    applyLayerOpacity();
    $("three-date").textContent = date(state.manifest.valid_time);
    $("three-run").textContent = date(state.manifest.run_time);
    $("three-valid").textContent =
      `GFS · ${level === "surface" ? "地面" : level} · ${date(state.manifest.valid_time)}`;
    state.weatherStatus = "风场与气温：0.5° 网格，同批次预报";
    $("three-data-status").textContent = state.weatherStatus;
    $("classic-link").href =
      `../#current/wind/${level === "surface" ? "surface/level" : "isobaric/" + level}/overlay=${$("temperature").checked ? "temp" : "default"}`;
    const u = new URL(location);
    u.searchParams.set("level", level);
    history.replaceState(null, "", u);
    if (state.selected) showPoint(state.selected);
  } catch (e) {
    if (version === weatherVersion)
      $("three-data-status").textContent = "天气加载失败：" + e.message;
  }
}

async function loadHeights(version, grid, level, snapshot) {
  try {
    const profile = await json(
      `/api/earth/3d/height/${snapshot}/${level}`,
      120000,
    );
    if (version !== weatherVersion) return;
    grid.setHeightProfile(profile);
    state.profile = profile;
    winds.setGrid(grid);
    updateHeightLabel();
    if (state.selected) showPoint(state.selected);
  } catch {
    if (version !== weatherVersion) return;
    state.heightStatus = "对应高度暂不可用，风线暂停；可重试";
    $("three-height-status").textContent = state.heightStatus;
  }
}

function updateHeightLabel() {
  const scale = Number($("height-scale").value);
  winds.setHeightScale(scale);
  $("height-scale-value").value = scale + "×";
  const url = new URL(location);
  url.searchParams.set("heightScale", scale);
  history.replaceState(null, "", url);
  if (!state.profile) return;
  state.heightStatus =
    state.level === "surface"
      ? "地面风：GFS 地形以上 10 m"
      : `${state.level} · GFS 位势高度 · ${scale === 1 ? "真实比例" : "垂直距离放大 " + scale + " 倍"}`;
  $("three-height-status").textContent = state.heightStatus;
}

async function refreshWeather() {
  try {
    const status = await json("/api/earth/status");
    if (!status.manifest) return;
    const changed = state.manifest?.id !== status.manifest.id;
    state.manifest = status.manifest;
    if (changed) await loadWeather();
  } catch {
    $("three-data-status").textContent = "天气更新暂不可用，保留已加载的预报";
  }
}

async function loadCloud() {
  if (!$("cloud").checked) {
    cloudVersion++;
    state.cloud = false;
    applyLayerOpacity();
    $("three-cloud-time").textContent = "";
    return;
  }
  if (cloudLoading) return;
  const version = ++cloudVersion;
  cloudLoading = true;
  cloudRefreshAt = performance.now();
  $("refresh-cloud").disabled = true;
  $("three-cloud-time").textContent = "正在读取卫星观测时刻…";
  try {
    const info = await json("/api/earth/3d/cloud", 40000);
    if (version !== cloudVersion) return;
    const observationLabel =
      (info.stale ? "更新暂不可用 · 缓存观测 " : "红外观测 · ") +
      date(info.observation_time);
    if (cloudOverlay && state.cloudObservation === info.observation_time) {
      state.cloud = true;
      applyLayerOpacity();
      $("three-cloud-time").textContent = observationLabel;
      return;
    }
    if (cloudOverlay) overlays?.deleteOverlay(cloudOverlay);
    const url = new URL(info.wms_url);
    url.searchParams.set("TIME", info.observation_time);
    cloudOverlay = new WMSTilesOverlay({
      url: url.href,
      layer: info.layer,
      crs: "EPSG:4326",
      version: "1.3.0",
      transparent: true,
      format: "image/png",
      levels: 9,
      opacity: 0.58,
    });
    overlays?.addOverlay(cloudOverlay, 20);
    state.cloud = true;
    state.cloudObservation = info.observation_time;
    $("three-cloud-time").textContent = observationLabel;
    $("cloud-credit").textContent = " · NASA GIBS / JMA";
  } catch {
    if (version !== cloudVersion) return;
    if (cloudOverlay && state.cloudObservation) {
      state.cloud = true;
      $("three-cloud-time").textContent =
        "更新失败 · 保留观测 " + date(state.cloudObservation);
    } else {
      state.cloud = false;
      $("cloud").checked = false;
      $("three-cloud-time").textContent = "云图暂不可用，可重试";
    }
    applyLayerOpacity();
  } finally {
    cloudLoading = false;
    $("refresh-cloud").disabled = false;
    if (version !== cloudVersion && $("cloud").checked) loadCloud();
  }
}

async function refreshTerrainAuthorization() {
  terrainRefreshAt = performance.now();
  const current = tiles;
  try {
    const info = await json("/api/earth/3d/terrain");
    if (current === tiles && state.terrain && info.available) {
      terrainInfo = info;
      tiles.fetchOptions.headers.Authorization = "Bearer " + info.accessToken;
      resetFailedMapTiles(tiles);
    }
  } catch {
    /* Existing terrain stays available while the provider recovers. */
  }
}

function ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > lat !== b[1] > lat &&
      lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function featureAt(collection, lon, lat) {
  return collection?.features.find((f) => {
    const polygons =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates
          : [];
    return polygons.some(
      (rings) =>
        ringContains(rings[0], lon, lat) &&
        !rings.slice(1).some((ring) => ringContains(ring, lon, lat)),
    );
  });
}
function showPoint(point) {
  state.selected = point;
  $("location").hidden = false;
  const lon = point.lon / RAD,
    lat = point.lat / RAD;
  $("location-coord").textContent =
    `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
  const names = ["countries", "provinces", "cities"]
    .map((k) => featureAt(geo[k], lon, lat)?.properties.name)
    .filter(Boolean);
  $("three-place").textContent = [...new Set(names)].join(" · ");
  const w = state.grid?.sample(lon, lat);
  $("three-point-wind").textContent = w
    ? `风 | ${((Math.atan2(-w.u, -w.v) / RAD + 360) % 360).toFixed(0)}° · ${(w.speed * 3.6).toFixed(0)} km/h`
    : "";
  $("three-point-temp").textContent =
    w && Number.isFinite(w.temp) ? `气温 | ${w.temp.toFixed(1)} °C` : "";
  const height = state.grid?.heightAt(lon, lat);
  $("three-point-layer").textContent = height
    ? state.level === "surface"
      ? "风层 | 地面以上 10 m"
      : `风层 | ${state.level} · 位势高度约 ${(height.geopotential / 1000).toFixed(2)} km${height.belowGround ? "（低于地面，不绘制风线）" : ""}`
    : "";
  $("three-point-height").textContent = point.photoHit
    ? "Google Maps · 实景三维表面"
    : point.buildingHit
      ? `OSM 建筑表面高程（近似） | ${Math.round(point.height)} m`
      : point.terrainHit &&
          WGS84_ELLIPSOID.getPositionElevation(camera.position) < 500000
        ? `地形高程（近似） | ${Math.round(point.height)} m`
        : "放大后可查看地形高程";
  WGS84_ELLIPSOID.getCartographicToPosition(
    point.lat,
    point.lon,
    point.height + 40,
    marker.position,
  );
  marker.visible = true;
}

renderer.domElement.addEventListener(
  "pointerdown",
  (e) => (pointerDown = [e.clientX, e.clientY]),
);
renderer.domElement.addEventListener("pointerup", (e) => {
  if (
    !pointerDown ||
    Math.hypot(e.clientX - pointerDown[0], e.clientY - pointerDown[1]) > 5
  )
    return;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      (e.clientX / innerWidth) * 2 - 1,
      1 - (e.clientY / innerHeight) * 2,
    ),
    camera,
  );
  const hit = activeFrame
    ? raycaster.intersectObject(activeFrame, true)[0]
    : null;
  const point =
    hit?.point ||
    WGS84_ELLIPSOID.intersectRay(raycaster.ray, new THREE.Vector3());
  if (point)
    showPoint({
      ...WGS84_ELLIPSOID.getPositionToCartographic(point, {}),
      terrainHit:
        !!hit && state.terrain && !hit.object.userData.weatherBuilding,
      buildingHit: !!hit?.object.userData.weatherBuilding,
      photoHit: !!hit?.object.userData.weatherPhotorealistic,
    });
});
controls.addEventListener("start", () => {
  winds.setMoving(true);
});
controls.addEventListener("end", () => {
  winds.setMoving(false);
});
$("location-close").addEventListener("click", () => {
  state.selected = null;
  $("location").hidden = true;
  marker.visible = false;
});
$("show-menu").addEventListener("click", () => {
  const open = $("menu").classList.toggle("invisible") === false;
  $("menu").setAttribute("aria-hidden", String(!open));
  $("show-menu").setAttribute("aria-expanded", String(open));
  if (open) drawLegend();
});
new ResizeObserver(() => {
  if ($("temperature").checked) drawLegend();
}).observe($("three-scale"));
for (const key of [
  "satellite",
  "countries",
  "provinces",
  "cities",
  "wind",
  "temperature",
])
  $(key).addEventListener("change", applyLayerOpacity);
$("weather-opacity").addEventListener("input", applyLayerOpacity);
$("height-scale").addEventListener("input", updateHeightLabel);
$("retry-map").addEventListener("click", retryMap);
$("retry-height").addEventListener("click", () => {
  if (state.grid && state.manifest)
    loadHeights(weatherVersion, state.grid, state.level, state.manifest.id);
});
$("terrain").addEventListener("change", () =>
  buildSurface($("terrain").checked),
);
$("buildings").addEventListener("change", async () => {
  buildings.setEnabled($("buildings").checked);
  const url = new URL(location);
  url.searchParams.set("buildings", $("buildings").checked ? "1" : "0");
  history.replaceState(null, "", url);
  if ($("buildings").checked && !$("terrain").checked) {
    $("terrain").checked = true;
    await buildSurface(true);
  }
});
$("retry-buildings").addEventListener("click", () => buildings.retry());
$("cloud").addEventListener("change", loadCloud);
$("refresh-cloud").addEventListener("click", () => {
  $("cloud").checked = true;
  loadCloud();
});
document.querySelectorAll("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    preset(b.dataset.view);
    if (b.dataset.view === "osaka" && state.requestedBasemap !== "google")
      buildSurface(true, "google").catch((err) => error(err.message));
  }),
);
document.querySelectorAll("[data-basemap]").forEach((button) =>
  button.addEventListener("click", () => {
    if (button.dataset.basemap !== state.requestedBasemap)
      buildSurface($("terrain").checked, button.dataset.basemap).catch((err) =>
        error(err.message),
      );
  }),
);
for (const level of levels) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button";
  button.dataset.level = level;
  button.textContent = level === "surface" ? "Sfc" : level.replace("hPa", "");
  button.title = level === "surface" ? "10 米风 / 2 米气温" : level;
  button.addEventListener("click", () => {
    state.level = level;
    loadWeather();
  });
  $("three-heights").append(button, " ");
}
$("three-heights").append("hPa");
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  if (photoSurface) photoSurface.resize(camera, renderer);
  else tiles?.setResolutionFromRenderer(camera, renderer);
  buildings.resize();
});
document.addEventListener("visibilitychange", () => {
  paused = document.hidden;
  lastRender = performance.now();
});

function frame(time) {
  requestAnimationFrame(frame);
  if (paused) return;
  const dt = Math.min((time - lastRender) / 1000, 0.1);
  lastRender = time;
  controls.update(dt);
  camera.updateMatrixWorld();
  terrainLight.position.copy(camera.position).normalize();
  mapStability?.observe(time);
  tiles?.update();
  try {
    buildings.update(time, state.terrain && state.terrainReady);
  } catch (error) {
    buildings.recoverFromUpdateError(error);
  }
  winds.update(dt);
  if (marker.visible) {
    const distance = camera.position.distanceTo(marker.position);
    marker.scale.setScalar(Math.max(20, distance * 0.003));
  }
  renderer.render(scene, camera);
  if (time - lastStatus > 1500) {
    lastStatus = time;
    const pending =
      (tiles?.stats.downloading || 0) +
      (tiles?.stats.parsing || 0) +
      (overlays?.pendingTextures || 0);
    if (state.mapBootstrapError)
      $("three-map-status").textContent = state.mapBootstrapError;
    else if (state.models > 0)
      $("three-map-status").textContent =
        (photoSurface
          ? "Google Maps · 实景三维（含建筑）"
          : state.terrain
            ? `真实地形 · ${$("satellite").checked ? "卫星影像" : "地形底色"}`
            : "椭球底图 · 地形关闭") +
        (state.mapFailures
          ? " · 部分瓦片待重试"
          : pending
            ? " · 加载细节中"
            : "");
    else
      $("three-map-status").textContent =
        state.basemap === "google"
          ? state.mapFailures
            ? "Google 实景三维暂不可用 · 自动重试"
            : "Google Maps · 正在加载实景三维…"
          : state.mapFailures
            ? "地图服务暂不可用 · 本地底图 · 自动重试"
            : "本地底图 · 正在加载地图细节";
    $("retry-map").hidden = !state.mapFailures;
    $("retry-height").hidden = !!state.profile;
    $("retry-buildings").hidden = !buildings.enabled || !buildings.failures;
    if (photoSurface) {
      const credits = photoSurface.credits();
      $("tile-credit").textContent = credits ? " · " + credits : "";
    }
    if (query.has("debug"))
      $("three-stage").dataset.debugMetrics =
        JSON.stringify(performanceMetrics());
  }
  if (state.mapFailures && time - mapRetryAt > 20000) retryMap();
  if (state.cloud && !cloudLoading && time - cloudRefreshAt > 300000)
    loadCloud();
  if (state.terrain && !photoSurface && time - terrainRefreshAt > 600000)
    refreshTerrainAuthorization();
}

function performanceMetrics() {
  const visibleImageryLevels = {};
  for (const tile of tiles?.visibleTiles || []) {
    const info = overlays?.overlayInfo.get(satellite)?.tileInfo.get(tile);
    if (info?.target && info.range) {
      const level = satellite.calculateLevel(info.range);
      visibleImageryLevels[level] = (visibleImageryLevels[level] || 0) + 1;
    }
  }
  return {
    basemap: state.basemap,
    photorealistic: photoSurface?.getState() || null,
    elapsedMs: Math.round(performance.now() - loadMetrics.startedAt),
    firstTerrainMs: loadMetrics.firstTerrainMs,
    firstImageryMs: loadMetrics.firstImageryMs,
    imageryZooms: loadMetrics.imageryZooms,
    textureSize: loadMetrics.textureSize,
    models: state.models,
    visibleTiles: tiles?.visibleTiles.size,
    pending: tiles
      ? {
          queued: tiles.stats.queued,
          downloading: tiles.stats.downloading,
          parsing: tiles.stats.parsing,
        }
      : null,
    cacheMiB: Math.round((tiles?.lruCache.cachedBytes || 0) / 2 ** 20),
    activeOverlays: overlays?.overlays.length,
    pendingTextures: overlays?.pendingTextures || 0,
    visibleImageryLevels,
    imageryCache: imageResponses.metrics(),
    previewCache: imagePreviews.metrics(),
    imageryFallback: photoSurface ? null : overlays?.fallbackMetrics(),
    mapMoving: mapStability?.moving,
    buildings: buildings.getState(),
    errors: state.errors.slice(-4),
  };
}
window.weatherEarth3D = {
  captureMetrics: performanceMetrics,
  getState: () => ({
    engine: "three",
    basemap: state.basemap,
    photorealistic: photoSurface?.getState() || null,
    level: state.level,
    manifest: state.manifest?.id,
    validTime: state.manifest?.valid_time,
    ready: state.ready,
    terrain: state.terrain,
    terrainReady: state.terrainReady,
    loadedModels: state.models,
    visibleTiles: tiles?.visibleTiles.size,
    imageryResponses: state.imageryResponses,
    cloud: state.cloud,
    cloudObservation: state.cloudObservation,
    heightSource: state.profile?.source,
    heightScale: winds.heightScale,
    heightStatus: state.heightStatus,
    mapFailures: state.mapFailures,
    baseGlobeVisible: fallback.visible,
    wind: winds.getState(),
    buildings: buildings.getState(),
    errors: state.errors.slice(-8),
    admin: Object.fromEntries(
      Object.keys(admin).map((k) => [
        k,
        { enabled: $(k).checked, count: geo[k]?.features.length || 0 },
      ]),
    ),
    cameraHeight: WGS84_ELLIPSOID.getPositionElevation(camera.position),
  }),
  flyTo: preset,
};

if (query.has("debug")) {
  window.weatherEarth3D.debug = {
    captureView: () => {
      const pivot = controls.getPivotPoint(new THREE.Vector3());
      return { position: camera.position.toArray(), pivot: pivot.toArray() };
    },
    orbitView: (view, degrees) => {
      const pivot = new THREE.Vector3().fromArray(view.pivot);
      const up = WGS84_ELLIPSOID.getPositionToNormal(
        pivot,
        new THREE.Vector3(),
      );
      camera.position
        .fromArray(view.position)
        .sub(pivot)
        .applyAxisAngle(up, degrees * RAD)
        .add(pivot);
      camera.up.copy(up);
      camera.lookAt(pivot);
      camera.updateMatrixWorld();
      controls.setCamera(camera);
      controls.resetState();
      winds.clear();
    },
  };
}

$("height-scale").value = Math.max(
  1,
  Math.min(20, Number(query.get("heightScale")) || 1),
);
$("buildings").checked = query.get("buildings") !== "0";
buildings.setEnabled(state.basemap !== "google" && $("buildings").checked);
updateHeightLabel();
preset(
  [
    "china",
    "world",
    "everest",
    "layers",
    "city",
    "buildings",
    "osaka",
  ].includes(query.get("view"))
    ? query.get("view")
    : "china",
);
requestAnimationFrame(frame);
buildSurface(true).catch((err) => error(err.message || "地图初始化失败"));
for (const [key, file] of Object.entries({
  countries: "countries",
  provinces: "china-provinces",
  cities: "china-cities",
})) {
  json("../data/geography/" + file + ".geojson")
    .then((data) => {
      geo[key] = data;
      if (key === "countries") fallback.setCountries(data);
    })
    .catch(() => error("行政区划加载失败"));
}
refreshWeather();
setInterval(refreshWeather, 60000);
