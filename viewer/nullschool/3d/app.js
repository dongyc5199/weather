import {
  THREE,
  TilesRenderer,
  GlobeControls,
  WGS84_ELLIPSOID,
  QuantizedMeshPlugin,
  GeneratedSurfacePlugin,
  XYZTilesOverlay,
} from "./vendor.js";
import { gridSampler, WindLayer } from "./weather.js";
import { DataLoader, weatherResources } from "./data-loading.js";
import { PlaybackCache, playbackProduct } from "./playback-cache.js";
import { ForecastTimeline } from "./forecast-timeline.js";
import { CloudLayer } from "./cloud-layer.js";
import { CLOUD_VIEW_LIMITS } from "./cloud-data.js";
import { AtmosphereLayer } from "./atmosphere.js";
import { TemperatureLayer } from "./temperature.js";
import { WeatherCompositor } from "./weather-compositor.js";
import { WIND_SPEED_PALETTE } from "./wind-presentation.js";
import { StyledGeoJSONOverlay } from "./styled-overlays.js";
import {
  GeographicLineLayer,
  administrativeBoundaries,
} from "./geographic-lines.js";
import { LineStyleStore, readLineStyleDefaults } from "./line-styles.js";
import { mountLineStylePanel } from "./line-style-panel.js";
import { ContourLayer } from "./contour-layer.js";
import {
  ContourTask,
  heightContourInput,
  pressureContourInput,
  contoursGeoJSON,
  scalarAt,
} from "./contours.js";
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
// Keep completed descriptions out of the controls and show actionable loading feedback.
const loadStatus = $("three-load-status");
function updateLoadStatus() {
  loadStatus.querySelectorAll("p").forEach((row) => {
    row.classList.toggle(
      "status-idle",
      !/加载|正在|等待|失败|不可用|重试|错误/.test(
        row.querySelector("span")?.textContent ?? row.textContent,
      ) && !row.querySelector("button:not([hidden])"),
    );
  });
  const rows = [...loadStatus.querySelectorAll("p")].filter(
    (row) => !row.hidden && !row.classList.contains("status-idle"),
  );
  const failed = rows.find((row) => /失败|不可用|错误/.test(row.textContent));
  const pending = rows.find((row) => /正在|加载/.test(row.textContent));
  const active = failed || pending || rows[0];
  const retry = !!loadStatus.querySelector("button:not([hidden])");
  const text = active?.textContent.trim() || "";
  const subject = /高度/.test(text)
    ? "高度"
    : /等压|气压/.test(text)
      ? "气压"
      : /等值|等高/.test(text)
        ? "等值线"
        : /建筑/.test(text)
          ? "建筑"
          : /云|卫星观测/.test(text)
            ? "云图"
            : /风|气温|填色|天气/.test(text)
              ? "天气"
              : "地图";
  const message = ["three-history-status","three-preview-status"].includes(active?.id) ? text : failed
    ? `${subject}暂不可用`
    : pending
      ? `加载${subject}…`
      : active
        ? `等待${subject}…`
        : retry
          ? "图层待重试"
          : "";
  const summary = $("three-load-summary");
  if (summary.textContent !== message) summary.textContent = message;
  loadStatus.title = rows.map((row) => row.textContent.trim()).join("\n");
  loadStatus.dataset.active = String(!!active || retry);
  loadStatus.dataset.state =
    failed || (!pending && retry) ? "error" : "loading";
  const retryId = /高度|天气/.test(subject)
    ? "retry-height"
    : /建筑/.test(subject)
      ? "retry-buildings"
      : /气压|等值线/.test(subject)
        ? "retry-contours"
        : "retry-map";
  const visibleRetries = [...loadStatus.querySelectorAll("button")].filter(
    (button) => !button.hidden,
  );
  const primaryRetry =
    visibleRetries.find((button) => button.id === retryId) || visibleRetries[0];
  visibleRetries.forEach((button) =>
    button.classList.toggle("status-secondary-retry", button !== primaryRetry),
  );
}
new MutationObserver(updateLoadStatus).observe(loadStatus, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["hidden"],
});
updateLoadStatus();
let debugCameraHold = false;
let styleStorage = null;
try {
  styleStorage = window.localStorage;
} catch {
  /* Session styling remains available. */
}
const lineStyles = new LineStyleStore({
  defaults: readLineStyleDefaults(theme),
  rootStyle: document.documentElement.style,
  storage: styleStorage,
});
let lineStylePanel = null;
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
  weather: null,
  cloud: null,
};
const state = {
  basemap: ["none", "terrain"].includes(query.get("basemap"))
    ? "none"
    : "google",
  level: levels.includes(query.get("level")) ? query.get("level") : "surface",
  manifest: null,
  grid: null,
  temperatureRecord: null,
  windRecords: null,
  temperatureError: false,
  heightContourError: false,
  isobarError: false,
  profile: null,
  heightStatus: "正在加载风温层高度…",
  weatherStatus: "",
  mapFailures: 0,
  mapBootstrapError: null,
  terrain: false,
  terrainReady: false,
  models: 0,
  mapDepthVersion: 0,
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
let cloudVolumeController = null,
  cloudVolumeLoading = false,
  cloudVolumeRetryAt = 0;
let cloudLoading = false,
  terrainRefreshAt = 0;
let mapRetryAt = 0;
let palette = null, paletteRequest=null;
function loadPalette(){
  if(palette)return Promise.resolve(palette);
  if(!paletteRequest)paletteRequest=json("/api/earth/3d/palette").then(value=>palette=value).finally(()=>{paletteRequest=null});
  return paletteRequest;
}
let contourSnapshot = null,
  heightContourKey = null,
  heightContourRequestKey = null,
  isobarSnapshot = null,
  isobarRecord = null,
  isobarOverlay = null,
  pressureLoadingSnapshot = null,
  pressureController = null,
  heightContourGeneration = 0,
  isobarGeneration = 0;
const heightContourTask = new ContourTask(),
  isobarTask = new ContourTask();
const imageResponses = new ImageResponseCache();
const imagePreviews = new SatellitePreviewCache();
let mapStability;
const geo = {};
const scene = new THREE.Scene();
const fillScene = new THREE.Scene();
const weatherScene = new THREE.Scene();
scene.background = new THREE.Color(theme("--earth-scene-background"));
scene.add(new THREE.AmbientLight(theme("--earth-scene-light"), 2.1));
const terrainLight = new THREE.DirectionalLight(
  theme("--earth-scene-light"),
  1.1,
);
scene.add(terrainLight);
const stage = $("three-stage");
let stageWidth = stage.clientWidth,
  stageHeight = stage.clientHeight;
const camera = new THREE.PerspectiveCamera(
  42,
  stageWidth / stageHeight,
  100,
  1e9,
);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(stageWidth, stageHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const weatherCompositor = new WeatherCompositor(renderer);
$("three-stage").append(renderer.domElement);
const fallback = new BaseGlobe(theme);
scene.add(fallback);
const surfaceGroup = new THREE.Group();
surfaceGroup.name = "Terrain and buildings";
scene.add(surfaceGroup);
const controls = new GlobeControls(surfaceGroup, camera, renderer.domElement);
renderer.domElement.addEventListener("pointerdown", () => {
  debugCameraHold = false;
});
renderer.domElement.addEventListener(
  "wheel",
  () => {
    debugCameraHold = false;
  },
  { passive: true },
);
controls.minDistance = 150;
controls.maxDistance = 35000000;
controls.cameraRadius = 100;
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.enableDoubleTapZoom = true;
controls.zoomSpeed = 1.25;
let clouds = new CloudLayer();
const atmosphere = new AtmosphereLayer(theme);
const winds = new WindLayer(weatherScene, camera, lineStyles.get("wind"));
winds.setViewport(
  stageWidth,
  stageHeight,
  matchMedia("(pointer: coarse)").matches,
);
winds.lines.renderOrder = 20;
const temperatures = new TemperatureLayer(fillScene, camera);
const windSpeeds = new TemperatureLayer(fillScene, camera, { kind: "wind" });
windSpeeds.setPalette(WIND_SPEED_PALETTE);
const contourStyle = {
  opacity: Number(theme("--earth-contour-opacity")),
  font: theme("--earth-ui-font"),
  fontSize: Number(theme("--earth-contour-label-size")),
  padding: Number(theme("--earth-contour-label-padding")),
  background: theme("--earth-floating-background"),
};
const heightContours = new ContourLayer(weatherScene, camera, {
  ...contourStyle,
  ...lineStyles.get("height"),
  kind: "height",
});
const isobarLabels = new ContourLayer(weatherScene, camera, {
  ...contourStyle,
  ...lineStyles.get("pressure"),
  kind: "pressure",
  getGround: (lon, lat) => state.grid?.heightAt(lon, lat)?.ground || 0,
});
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
weatherScene.add(marker);

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
const admin = Object.fromEntries(
  [
    ["countries", 28],
    ["provinces", 26],
    ["cities", 24],
    ["rivers", 22],
  ].map(([key, order]) => [
    key,
    new GeographicLineLayer(weatherScene, camera, lineStyles.get(key), {
      name: `Geographic reference ${key}`,
      order,
      haloColor: theme("--earth-reference-halo-color"),
      haloOpacity: Number(theme("--earth-reference-halo-opacity")),
      haloWidth: Number(theme("--earth-reference-halo-width")),
    }),
  ]),
);
const adminTopologyModes = {};
function syncAdministrativeTopology() {
  const country =
    $("countries").checked && lineStyles.get("countries").opacity > 0;
  const province =
    $("provinces").checked && lineStyles.get("provinces").opacity > 0;
  for (const key of ["provinces", "cities"]) {
    if (!geo[key]) continue;
    const options =
      key === "provinces"
        ? { includeOuter: !country }
        : { includeOuter: !country && !province, withinParent: province };
    const mode = JSON.stringify({
      ...options,
      parentReady: key === "cities" && !!geo.provinces,
    });
    if (adminTopologyModes[key] === mode) continue;
    adminTopologyModes[key] = mode;
    if (key === "cities" && geo.provinces) {
      const geometries = [
        administrativeBoundaries(geo.cities, {
          includeOuter: false,
          withinParent: true,
        }),
      ];
      // Reuse the same province topology for city-level outer boundaries,
      // rather than independently simplified outlines from each city file.
      if (!province)
        geometries.push(
          administrativeBoundaries(geo.provinces, { includeOuter: !country }),
        );
      admin[key].setData({ type: "GeometryCollection", geometries });
    } else admin[key].setData(administrativeBoundaries(geo[key], options));
  }
}

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
const dataLoader = new DataLoader();
const json = (url, timeout, signal) => dataLoader.json(url, timeout, signal);

function preset(name) {
  debugCameraHold = false;
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

function weatherPath(kind, m, level) {
  return (
    m?.layers?.[level]?.files?.[kind] ||
    (level === "surface" ? m?.files?.[kind] : null)
  );
}

async function buildSurface(useTerrain, basemap = state.basemap) {
  const version = ++surfaceVersion;
  state.requestedBasemap = basemap;
  state.mapBootstrapError = null;
  const photo = basemap === "google";
  if (basemap === "none") {
    if (tiles) {
      tiles.group.removeFromParent();
      tiles.dispose();
    }
    photoSurface?.dispose();
    photoSurface = null;
    tiles = null;
    overlays = null;
    mapStability = null;
    buildings.setEnabled(false);
    state.basemap = "none";
    state.terrain = state.terrainReady = false;
    state.models = state.mapFailures = 0;
    state.ready = true;
    fallback.visible = true;
    fallback.material.colorWrite = false;
    controls.setScene(fallback);
    controls.setEllipsoid(WGS84_ELLIPSOID, fallback);
    activeFrame = fallback;
    $("three-map-status").textContent = "";
    $("three-building-status").textContent = "";
    $("retry-map").hidden = $("retry-buildings").hidden = true;
    $("terrain-options").hidden = $("building-options").hidden = true;
    $("base-credit").hidden = true;
    $("tile-credit").textContent =
      $("provider-credit").textContent =
      $("building-credit").textContent =
        "";
    syncBasemapControls();
    applyLayerOpacity();
    return;
  }
  fallback.material.colorWrite = true;
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
    overlays: !photo && $("satellite").checked ? [satellite] : [],
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
    state.mapDepthVersion++;
    state.terrainReady = useTerrain || photo;
    if (photo)
      loadMetrics.firstImageryMs ??= Math.round(
        performance.now() - loadMetrics.startedAt,
      );
    state.ready = true;
  });
  for (const event of ["tile-visibility-change", "dispose-model"])
    tiles.addEventListener(event, () => state.mapDepthVersion++);
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
  if (isobarOverlay && $("isobars").checked)
    overlays.addOverlay(isobarOverlay, 5);
  $("terrain-options").hidden = photo;
  $("building-options").hidden = photo;
  $("photo-note").hidden = !photo;
  $("base-credit").hidden = photo;
  $("tile-credit").textContent = "";
  renderBuildingCredits($("provider-credit"), photoInfo, "");
  syncBasemapControls();
  applyLayerOpacity();
}

function syncBasemapControls() {
  const basemap = state.basemap;
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
  syncAdministrativeTopology();
  const include = (layer, enabled, order) => {
    if (!layer || !overlays) return;
    const present = overlays.overlays.includes(layer);
    if (enabled && !present) overlays.addOverlay(layer, order);
    if (!enabled && present) overlays.deleteOverlay(layer);
  };
  satellite.opacity = $("satellite").checked ? 1 : 0;
  include(satellite, state.basemap === "terrain" && $("satellite").checked, 0);
  for (const key of Object.keys(admin)) {
    admin[key].setEnabled($(key).checked);
  }
  temperatures.enabled = $("temperature").checked;
  temperatures.opacity = Number($("weather-opacity").value);
  windSpeeds.enabled = $("wind-speed").checked;
  windSpeeds.opacity = Number($("weather-opacity").value);
  clouds.enabled = $("cloud").checked && state.cloud;
  include(isobarOverlay, $("isobars").checked, 5);
  $("three-scale-row").hidden = $("color-none").checked;
  $("three-field-status").hidden = $("color-none").checked;
  if (!$("color-none").checked) drawLegend();
  updateFieldStatus();
  winds.enabled = $("wind").checked;
  $("opacity-value").value =
    Math.round(Number($("weather-opacity").value) * 100) + "%";
  const url = new URL(location);
  url.searchParams.set("rivers", $("rivers").checked ? "1" : "0");
  url.searchParams.set("temperature", $("temperature").checked ? "1" : "0");
  url.searchParams.set(
    "color",
    $("wind-speed").checked
      ? "wind"
      : $("temperature").checked
        ? "temp"
        : "none",
  );
  history.replaceState(null, "", url);
  $("classic-link").href =
    `../#current/wind/${state.level === "surface" ? "surface/level" : "isobaric/" + state.level}/overlay=${$("temperature").checked ? "temp" : $("wind-speed").checked ? "default" : "off"}`;
  applyContours();
  lineStylePanel?.sync();
}

function applyLineStyle(layer, style) {
  if (layer === "wind") winds.setLineStyle(style);
  else if (layer === "height") heightContours.setLineStyle(style);
  else if (layer === "pressure") {
    isobarLabels.setLineStyle(style);
    isobarOverlay?.setLineStyle(style);
  } else if (Object.hasOwn(admin, layer)) {
    admin[layer].setLineStyle(style);
    admin[layer].setEnabled($(layer).checked);
    syncAdministrativeTopology();
  }
}

function clearHeightContours() {
  heightContourGeneration++;
  heightContourTask.cancel();
  heightContourKey = heightContourRequestKey = null;
  heightContours.clear();
  state.heightContourError = false;
}

function clearIsobars() {
  isobarGeneration++;
  pressureController?.abort();
  pressureController = null;
  pressureLoadingSnapshot = null;
  isobarTask.cancel();
  if (isobarOverlay) overlays?.deleteOverlay(isobarOverlay);
  isobarOverlay = isobarRecord = isobarSnapshot = null;
  isobarLabels.clear();
  state.isobarError = false;
}

function applyContours() {
  const height = $("height-contours").checked,
    pressure = $("isobars").checked;
  $("height-contours").disabled = state.level === "surface";
  heightContours.enabled = height && state.level !== "surface";
  isobarLabels.enabled = pressure;
  $("height-contour-status").hidden = !height;
  $("isobar-status").hidden = !pressure;
  if (!height) {
    heightContourGeneration++;
    heightContourTask.cancel();
    heightContourRequestKey = null;
  } else ensureHeightContours();
  if (!pressure) {
    isobarGeneration++;
    pressureController?.abort();
    pressureController = null;
    pressureLoadingSnapshot = null;
    isobarTask.cancel();
  } else loadIsobars();
  const url = new URL(location);
  url.searchParams.set("heightContours", height ? "1" : "0");
  url.searchParams.set("isobars", pressure ? "1" : "0");
  history.replaceState(null, "", url);
}

async function ensureHeightContours() {
  if (!$("height-contours").checked) return;
  if (state.level === "surface") {
    $("height-contour-status").textContent =
      "位势高度线用于等压层；地面可开启海平面等压线";
    return;
  }
  if (!state.profile || !state.grid) {
    $("height-contour-status").textContent = "位势高度线等待当前层高度…";
    return;
  }
  const key = state.manifest.id + ":" + state.level;
  if (heightContourKey === key || heightContourRequestKey === key) return;
  const generation = ++heightContourGeneration;
  heightContourRequestKey = key;
  $("height-contour-status").textContent = "正在生成位势高度线…";
  try {
    const cached=previewDisplayed && previews.get(state.manifest,previewWeatherKey())?.contours;
    const result = cached || await heightContourTask.run(heightContourInput(state.profile, state.grid.header));
    if (
      !result ||
      generation !== heightContourGeneration ||
      !$("height-contours").checked
    )
      return;
    heightContours.setData(result);
    heightContourKey = key;
    state.heightContourError = false;
    $("height-contour-status").textContent =
      `${result.layer} 位势高度线 · 间距 ${result.interval} m · 标注为原始值`;
  } catch {
    if (generation !== heightContourGeneration) return;
    state.heightContourError = true;
    $("height-contour-status").textContent = "位势高度线暂不可用，可重试";
  } finally {
    if (generation === heightContourGeneration) heightContourRequestKey = null;
  }
}

async function loadIsobars() {
  if (!$("isobars").checked || !state.manifest) return;
  const snapshot = state.manifest.id;
  if (isobarSnapshot === snapshot || pressureLoadingSnapshot === snapshot)
    return;
  if (!state.grid) {
    $("isobar-status").textContent = "海平面等压线等待当前预报…";
    return;
  }
  const reference = state.grid.header,
    generation = ++isobarGeneration;
  pressureController?.abort();
  const controller = new AbortController();
  pressureController = controller;
  pressureLoadingSnapshot = snapshot;
  $("isobar-status").textContent = "正在读取同批次海平面气压…";
  try {
    const cached=previewDisplayed && previews.get(state.manifest,"pressure");
    const data = cached || (previewDisplayed ? await playbackProduct(state.manifest,"pressure",controller.signal) : await json(
      `/api/earth/3d/pressure/${snapshot}`,
      120000,
      controller.signal,
    ));
    if (generation !== isobarGeneration || snapshot !== state.manifest.id)
      return;
    const result = data.contours || await isobarTask.run(
      pressureContourInput(data, reference, snapshot),
    );
    if (
      !result ||
      generation !== isobarGeneration ||
      snapshot !== state.manifest.id ||
      !$("isobars").checked
    )
      return;
    const layer = new StyledGeoJSONOverlay(
      {
        geojson: contoursGeoJSON(result),
        fillStyle: "transparent",
      },
      lineStyles.get("pressure"),
    );
    layer.detailResolution = 256;
    if (isobarOverlay) overlays?.deleteOverlay(isobarOverlay);
    isobarOverlay = layer;
    isobarRecord = data.pressure;
    isobarSnapshot = snapshot;
    isobarLabels.setData(result);
    overlays?.addOverlay(layer, 5);
    state.isobarError = false;
    $("isobar-status").textContent =
      "海平面等压线 · 间距 4 hPa · 与风温场同批次";
    if (state.selected) showPoint(state.selected);
  } catch (error) {
    if (generation !== isobarGeneration || error.name === "AbortError") return;
    state.isobarError = true;
    $("isobar-status").textContent = "同批次海平面气压暂不可用，可重试";
  } finally {
    if (generation === isobarGeneration) {
      pressureLoadingSnapshot = null;
      pressureController = null;
    }
  }
}

async function drawLegend() {
  const wind = $("wind-speed").checked;
  if (!wind && !palette) {
    try {
      palette = await loadPalette();
    } catch {
      return;
    }
  }
  const colors = wind ? WIND_SPEED_PALETTE : palette;
  if (wind !== $("wind-speed").checked || $("color-none").checked) return;
  if (!colors) return;
  $("three-scale-title").textContent = wind ? "风速 | 0 km/h" : "气温 | −80°C";
  $("three-scale-end").textContent = wind ? "360 km/h" : "55°C";
  const canvas = $("three-scale"),
    rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const ctx = canvas.getContext("2d"),
    gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  const min = colors.stops[0],
    max = colors.stops.at(-1);
  colors.stops.forEach((stop, i) =>
    gradient.addColorStop(
      (stop - min) / (max - min),
      `rgb(${colors.colors[i].join(",")})`,
    ),
  );
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

async function readWeatherFrame(manifest, level, signal) {
  const paths = ["wind", "temp"].map(kind => weatherPath(kind,manifest,level));
  if (paths.some(path => !path)) throw new Error("这一高度的数据还未准备好");
  const [wind,temp,profile]=await weatherResources(json,{
    wind:"../"+paths[0],temp:"../"+paths[1],height:`/api/earth/3d/height/${manifest.id}/${level}`,
  },signal);
  signal.throwIfAborted();
  const grid=gridSampler(wind,temp);
  if ((grid.header.layer || "surface") !== level || Date.parse(grid.header.refTime) !== Date.parse(manifest.run_time) ||
      grid.header.forecastTime !== manifest.forecast_hour) throw new Error("风温场时次或气压层不匹配");
  if (!profile.error) grid.setHeightProfile(profile);
  return {wind,temp,profile,grid};
}

let weatherController;
async function loadWeather(prepared=null) {
  weatherController?.abort();
  weatherController = new AbortController();
  const version = ++weatherVersion;
  const started = performance.now();
  clearHeightContours();
  if (contourSnapshot !== state.manifest?.id) {
    clearIsobars();
    contourSnapshot = state.manifest?.id;
  }
  winds.clear();
  winds.setGrid(null);
  state.grid = null;
  state.temperatureRecord = null;
  state.windRecords = null;
  state.temperatureError = false;
  state.profile = null;
  temperatures.clear();
  windSpeeds.clear();
  $("three-height-status").textContent = "正在加载风温场与对应高度…";
  $("three-field-status").textContent = "填色等待对应高度…";
  applyContours();
  if (state.selected) showPoint(state.selected);
  const level = state.level;
  $("three-data-status").textContent =
    "正在加载 " + (level === "surface" ? "地面" : level) + " 风场与气温…";
  document.querySelectorAll("[data-level]").forEach((b) => {
    const active = b.dataset.level === level;
    b.classList.toggle("highlighted", active);
    b.setAttribute("aria-pressed", String(active));
  });
  try {
    const frame = prepared || await readWeatherFrame(state.manifest,level,weatherController.signal);
    if (version !== weatherVersion) return;
    const {wind,temp,profile,grid}=frame;
    state.grid = grid;
    state.temperatureRecord = temp[0];
    state.windRecords = wind;
    state.profile = null;
    state.heightStatus = "正在加载同批次 GFS 风温层高度…";
    $("three-height-status").textContent = state.heightStatus;
    if (profile.error) {
      state.heightStatus = "对应高度暂不可用，风温层暂停；可重试";
      $("three-height-status").textContent = state.heightStatus;
    } else {
      applyHeights(version, grid, profile, true);
      loadMetrics.weather = { snapshot: state.manifest.id, level, readyMs: Math.round(performance.now() - started) };
    }
    applyLayerOpacity();
    $("earth-active-context").textContent =
      `GFS · ${level === "surface" ? "地面" : level.replace("hPa", " hPa")}`;
    $("three-date").textContent = date(state.manifest.valid_time);
    $("three-run").textContent = date(state.manifest.run_time);
    $("three-valid").textContent =
      `GFS · ${level === "surface" ? "地面" : level} · ${date(state.manifest.valid_time)}`;
    state.weatherStatus = `风场与气温：${grid.header.dx}° 网格，同批次预报`;
    $("three-data-status").textContent = state.weatherStatus;
    $("classic-link").href =
      `../#current/wind/${level === "surface" ? "surface/level" : "isobaric/" + level}/overlay=${$("temperature").checked ? "temp" : $("wind-speed").checked ? "default" : "off"}`;
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
    applyHeights(version, grid, profile);
  } catch {
    if (version !== weatherVersion) return;
    state.heightStatus = "对应高度暂不可用，风温层暂停；可重试";
    $("three-height-status").textContent = state.heightStatus;
    $("three-field-status").textContent = "风速与气温填色等待对应高度，可重试";
  }
}

function applyHeights(version, grid, profile, validated=false) {
  if (!validated) grid.setHeightProfile(profile);
  state.profile = profile;
  winds.setGrid(grid);
  windSpeeds.setData(state.windRecords, profile);
  updateHeightLabel();
  updateFieldStatus();
  loadTemperature(version, state.temperatureRecord, profile);
  ensureHeightContours();
  if (state.selected) showPoint(state.selected);
}

async function loadTemperature(version, record, profile) {
  try {
    const colors = palette || (await loadPalette());
    if (version !== weatherVersion) return;
    palette = colors;
    temperatures.setPalette(colors);
    temperatures.setData(record, profile);
    state.temperatureError = false;
    updateFieldStatus();
    if (state.selected) showPoint(state.selected);
  } catch {
    if (version !== weatherVersion) return;
    temperatures.clear();
    state.temperatureError = true;
    updateFieldStatus();
  }
}

function updateFieldStatus() {
  const wind = $("wind-speed").checked,
    layer = wind ? windSpeeds : temperatures;
  if (!layer.field) {
    $("three-field-status").textContent = "填色等待对应高度，可重试";
    return;
  }
  $("three-field-status").textContent = wind
    ? state.level === "surface"
      ? "风速：模式地形以上 10 m"
      : `风速：${state.level} · 与经典模式同一色标`
    : state.level === "surface"
      ? "气温面：模式地形以上 2 m"
      : `气温面：${state.level} 位势高度面`;
  $("three-field-status").textContent += " · 低于地形时贴地";
}

function updateHeightLabel() {
  const scale = Number($("height-scale").value);
  winds.setHeightScale(scale);
  temperatures.setHeightScale(scale);
  windSpeeds.setHeightScale(scale);
  heightContours.setHeightScale(scale);
  $("height-scale-value").value = scale + "×";
  const url = new URL(location);
  url.searchParams.set("heightScale", scale);
  history.replaceState(null, "", url);
  if (!state.profile) return;
  state.heightStatus =
    state.level === "surface"
      ? "模式地形以上：风 10 m · 气温 2 m"
      : `${state.level} · GFS 位势高度 · ${scale === 1 ? "真实比例" : "垂直距离放大 " + scale + " 倍"}`;
  $("three-height-status").textContent = state.heightStatus;
  if (state.selected) showPoint(state.selected);
}

const timeFormat=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
let previewDisplayed=false, draggingTime=false, refineTimer=null, refinement=null;
let previewNear=false, preparedFor=[], previewCatalogKey="";
const previews=new PlaybackCache(readPreview, publishPreviewCatalog);
function previewReady(frame){
  if(!previews.has(frame))return false;
  const volume=previews.get(frame,"volume");
  return !volume || volume.shape.observation_time===previews.get(frame,"observation")?.info.observation_time;
}
const timeline=new ForecastTimeline(switchForecast, renderTimeline, 2000,previewReady);
function renderTimeline(){
  const {frames,current,pending,queued,playing,following}=timeline;
  const status=pending && !previews.has(pending)?"正在加载天气时次…":timeline.error?"天气时次不可用："+timeline.error.message:"";
  if($("three-playback-status").textContent!==status)$("three-playback-status").textContent=status;
  const index=frames.findIndex(f=>f.id===(queued?.id || pending?.id || current));
  const slider=$("earth-time-range");
  slider.max=String(Math.max(0,frames.length-1));
  slider.value=String(Math.max(0,index));
  slider.disabled=frames.length<2;
  $("earth-time-speed").value=String(timeline.rate);
  const play=$("earth-time-play");
  play.textContent=playing?"暂停":"播放";
  play.setAttribute("aria-label",playing?"暂停时间播放":"按时间播放天气");
  play.disabled=frames.length<2;
  $("earth-time-live").disabled=!timeline.latest || (following && !pending && current===timeline.latest.id);
  const shown=queued || (!playing && !following && pending ? frames[index] : state.manifest);
  const shownTime=Date.parse(shown?.valid_time);
  $("earth-time-value").textContent=Number.isFinite(shownTime)?timeFormat.format(shownTime):"—";
  slider.setAttribute("aria-valuetext",frames[index]?date(frames[index].valid_time)+" 北京时间":"无可用时次");
}
async function readObservation(manifest,signal){
  const info=await json(`/api/earth/3d/cloud-observation/${manifest.id}?display=ra-v1`,180000,signal);
  if(info.snapshot!==manifest.id || info.model_valid_time!==manifest.valid_time)
    throw new Error("云图时次不匹配");
  return info;
}
async function readCloudShape(snapshot,signal){
  const profile=await json(`/api/earth/3d/cloud-shape/${snapshot}?renderer=6.1`,180000,signal);
  if(profile.shape_version!==3 || profile.snapshot!==snapshot)throw new Error("Cloud shape revision mismatch");
  const field=await dataLoader.binary(profile.field_url+"?renderer=6.1",180000,signal);
  return {profile,field};
}
async function prepareCloudFrame(layer,manifest,near,signal){
  const info=await readObservation(manifest,signal);
  await layer.setObservation(info,()=>!signal.aborted);
  signal.throwIfAborted();
  if(near){
    const {profile,field}=await readCloudShape(manifest.id,signal);
    signal.throwIfAborted();
    if(profile.observation_time!==info.observation_time)throw new Error("云图与云高时次不匹配");
    layer.setShape(profile,field);
    layer.enabled=true;
    layer.updateView(camera);
    if(layer.requiresTerrainDepth){
      const wind=await readCloudWind(manifest,signal);
      signal.throwIfAborted();
      layer.setWindField(wind);
    }
  }
  return info;
}
async function preparedContours(input,signal){
  const task=new ContourTask(),stop=()=>task.cancel();
  signal.addEventListener("abort",stop,{once:true});
  try{signal.throwIfAborted();const result=await task.run(input);signal.throwIfAborted();return result}
  finally{signal.removeEventListener("abort",stop);task.cancel()}
}
async function readPreview(manifest,product,signal){
  const level=product.replace(/-contours$/,"");
  const packet=await playbackProduct(manifest,level,signal);
  if(level==="pressure"){
    packet.contours=await preparedContours(pressureContourInput(packet,packet.pressure.header,manifest.id),signal);
  }else if(level!=="observation" && level!=="volume"){
    await loadPalette();signal.throwIfAborted();
    packet.grid=gridSampler(packet.wind,packet.temp);
    packet.grid.setHeightProfile(packet.profile);
    if(product!==level)packet.contours=await preparedContours(heightContourInput(packet.profile,packet.grid.header),signal);
  }
  return packet;
}
function previewWeatherKey(){
  return state.level+(state.level!=="surface" && $("height-contours").checked?"-contours":"");
}
function cancelRefinement(){
  clearTimeout(refineTimer);refineTimer=null;refinement?.abort();refinement=null;
}
function refineAfterInteraction(){
  cancelRefinement();
  if(!previewDisplayed || timeline.playing || draggingTime)return;
  const manifest=state.manifest;
  refineTimer=setTimeout(async()=>{
    if(state.manifest!==manifest || timeline.playing || timeline.pending || draggingTime)return;
    const controller=new AbortController();refinement=controller;
    try{await loadDetailedForecast(manifest,controller.signal)}
    catch{/* The matching prepared frame remains visible if higher detail is unavailable. */}
    finally{if(refinement===controller)refinement=null}
  },300);
}
function switchForecast(manifest,signal){
  cancelRefinement();
  if(!previewReady(manifest))return loadDetailedForecast(manifest,signal);
  const weather=previews.get(manifest,previewWeatherKey());
  cloudVersion++;cancelCloudVolume();
  previewDisplayed=true;state.manifest=manifest;
  state.cloud=false;state.cloudObservation=null;clouds.enabled=false;
  $("cloud-observation-label").hidden=true;
  if($("cloud").checked){
    const {info,image}=previews.get(manifest,"observation");
    clouds.attachObservation(info,new THREE.Texture(image),true);
    const volume=previews.get(manifest,"volume");
    if(volume){clouds.setShape(volume.shape,volume.field);clouds.setWindField(volume.wind)}
    clouds.finishSnapshotFade();displayObservation(info,performance.now());
  }
  const applied=loadWeather(weather);
  refineAfterInteraction();
  return applied;
}
async function loadDetailedForecast(manifest,signal){
  const level=state.level, started=performance.now();
  const siblings=new AbortController(), loadSignal=AbortSignal.any([signal,siblings.signal]);
  let candidate=$("cloud").checked ? new CloudLayer() : null;
  try{
    const near=WGS84_ELLIPSOID.getPositionElevation(camera.position)<=CLOUD_VIEW_LIMITS.preloadAltitude;
    const [weather,info]=await Promise.all([
      readWeatherFrame(manifest,level,loadSignal),
      candidate ? prepareCloudFrame(candidate,manifest,near,loadSignal) : null,
      $("isobars").checked ? json(`/api/earth/3d/pressure/${manifest.id}`,120000,loadSignal) : null,
    ]);
    signal.throwIfAborted();
    if(weather.profile.error)throw new Error("缺少该时次的气压层高度");
    // All essential layers are ready. Replace the displayed time, grids and
    // cloud together in this task, keeping the prior frame visible until now.
    if(previewDisplayed && state.manifest?.id===manifest.id)clearIsobars();
    previewDisplayed=false;
    cloudVersion++;cancelCloudVolume();
    state.manifest=manifest;
    state.cloud=false;state.cloudObservation=null;clouds.enabled=false;
    $("cloud-observation-label").hidden=true;
    if(candidate){
      const old=clouds;clouds=candidate;candidate=null;old.dispose();
      clouds.finishSnapshotFade();displayObservation(info,started);
    }
    await loadWeather(weather);
  }finally{
    siblings.abort();
    candidate?.dispose();
  }
}
let publishedFrames=[], publishedLatest=null;
function publishPreviewCatalog(){
  if(!publishedLatest)return;
  const ready=preparedFor.filter(frame=>previews.has(frame));
  const remaining=previews.preparing;
  const status=ready.length===preparedFor.length?"":remaining
    ? `正在准备时间轴 · ${ready.length}/${preparedFor.length}`
    : `部分时次暂不可用 · ${ready.length}/${preparedFor.length}`;
  if($("three-preview-status").textContent!==status)$("three-preview-status").textContent=status;
  // Publish prepared hours progressively, but never renumber the stops under
  // a held pointer. Live mode still owns the actual published forecast.
  if(draggingTime)return;
  const anchor=timeline.pending?.id || timeline.current || state.manifest?.id;
  const waitingForAnchor=remaining && preparedFor.some(f=>f.id===anchor) && !ready.some(f=>f.id===anchor);
  const visible=waitingForAnchor ? [] : ready;
  const latest=remaining ? (visible.find(f=>f.id===publishedLatest.id) || visible.at(-1)) :
    (visible.length ? (preparedFor.find(f=>f.id===publishedLatest.id) || preparedFor.at(-1)) : null);
  const key=previewWeatherKey()+"|"+visible.map(f=>f.id).join("|")+"|"+(latest?.id||"");
  if(key===previewCatalogKey)return;
  previewCatalogKey=key;
  timeline.catalog(visible,latest,state.manifest?.id);
}
function updateLevelTimeline(){
  if(!publishedLatest || draggingTime)return;
  preparedFor=publishedFrames.filter(f=>weatherPath("wind",f,state.level)&&weatherPath("temp",f,state.level));
  const products=[previewWeatherKey()];
  if($("cloud").checked)products.push("observation");
  if($("cloud").checked && previewNear)products.push("volume");
  if($("isobars").checked)products.push("pressure");
  previews.configure(preparedFor,products,state.manifest?.id);
  publishPreviewCatalog();
}
let refreshVersion=0, refreshTimer=null;
async function refreshWeather() {
  const version=++refreshVersion;
  clearTimeout(refreshTimer);
  let nextPoll=60000;
  try {
    const status=await json("/api/earth/status?timeline=1");
    if(version!==refreshVersion)return;
    const history=status.history;
    let progress="";
    if(history && history.ready<history.total){
      nextPoll=history.loading?5000:15000;
      progress=history.loading ? `正在补齐时次 · ${history.ready}/${history.total}` : `等待补齐时次 · ${history.ready}/${history.total}`;
    }
    $("three-history-status").textContent=progress;
    if(!status.manifest){
      $("three-data-status").textContent=status.updating?"正在准备天气数据…":"天气数据暂不可用，可重试";
      return;
    }
    const first=!state.manifest;
    if(first)state.manifest=status.manifest;
    const forecastLabel=$("forecast-label");
    forecastLabel.textContent=status.last_error?"缓存预报":"预报";
    forecastLabel.title=status.last_error?"本次更新失败，显示最近可用的预报":"";
    publishedLatest=status.manifest;
    publishedFrames=status.timeline || [publishedLatest];
    updateLevelTimeline();
    if(first){
      loadWeather();
      if($("cloud").checked)loadCloud();
    }
  } catch {
    if(version===refreshVersion)$("three-data-status").textContent="天气更新暂不可用，保留已加载的预报";
  } finally {
    if(version===refreshVersion)refreshTimer=setTimeout(refreshWeather,nextPoll);
  }
}

const recentCloudWinds=new Map();
async function readCloudWind(manifest,signal){
  signal.throwIfAborted();
  const cached=recentCloudWinds.get(manifest.id);
  if(cached)return cached;
  const worker=new Worker(new URL('./cloud-wind-worker.js',import.meta.url),{type:'module'});
  let abort;
  try{
    const result=await new Promise((resolve,reject)=>{
      abort=()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
      worker.onmessage=({data})=>{
        if(data.error || data.snapshot!==manifest.id)reject(new Error(data.error || '云层风场时次不匹配'));
        else resolve(data);
      };
      worker.onerror=()=>reject(new Error('云层风场不可用'));
      worker.postMessage(manifest);
    });
    signal.throwIfAborted();
    recentCloudWinds.set(manifest.id,result);
    if(recentCloudWinds.size>3)recentCloudWinds.delete(recentCloudWinds.keys().next().value);
    return result;
  }finally{
    signal.removeEventListener('abort',abort);
    worker.terminate();
  }
}
let cloudWindController=null, cloudWindRetryAt=0;
function cancelCloudWind(){
  cloudWindController?.abort();cloudWindController=null;cloudWindRetryAt=0;
}
async function ensureCloudWind(){
  const manifest=state.manifest;
  if(cloudWindController && clouds.cameraAltitude>CLOUD_VIEW_LIMITS.preloadAltitude)cancelCloudWind();
  if(!manifest || !clouds.requiresTerrainDepth || clouds.convectionSnapshot!==manifest.id ||
     clouds.windSnapshot===manifest.id || cloudWindController || performance.now()<cloudWindRetryAt)return;
  const controller=new AbortController();
  cloudWindController=controller;
  try{
    const data=await readCloudWind(manifest,controller.signal);
    if(!controller.signal.aborted && state.manifest?.id===manifest.id)clouds.setWindField(data);
  }catch{
    if(!controller.signal.aborted)cloudWindRetryAt=performance.now()+60000;
  }finally{
    if(cloudWindController===controller)cloudWindController=null;
  }
}

function cancelCloudVolume() {
  cancelCloudWind();
  cloudVolumeController?.abort();
  cloudVolumeController = null;
  cloudVolumeLoading = false;
  cloudVolumeRetryAt = 0;
}

async function ensureCloudVolume() {
  if (
    !$("cloud").checked ||
    !state.cloud ||
    !state.manifest ||
    clouds.snapshot !== state.manifest.id ||
    (previewDisplayed && draggingTime) || cloudVolumeLoading ||
    WGS84_ELLIPSOID.getPositionElevation(camera.position) >
      CLOUD_VIEW_LIMITS.preloadAltitude ||
    clouds.convectionSnapshot === state.manifest.id ||
    performance.now() < cloudVolumeRetryAt
  )
    return;
  const snapshot = state.manifest.id,
    version = cloudVersion;
  const controller = new AbortController();
  cloudVolumeController = controller;
  cloudVolumeLoading = true;
  $("three-cloud-time").textContent = "正在预载近景云高，继续显示观测云图…";
  try {
    const {profile,field}=await readCloudShape(snapshot,controller.signal);
    if (
      controller.signal.aborted ||
      version !== cloudVersion ||
      state.manifest.id !== snapshot
    )
      return;
    clouds.setShape(profile, field);
    clouds.enabled = state.cloud;
    if (state.selected) showPoint(state.selected);
    $("three-cloud-time").textContent =
      "GMGSI 观测云 · " + date(state.cloudObservation);
  } catch {
    if (!controller.signal.aborted && version === cloudVersion) {
      cloudVolumeRetryAt = performance.now() + 60000;
      $("three-cloud-time").textContent = "近景云高暂不可用，保留观测云图";
    }
  } finally {
    if (cloudVolumeController === controller) {
      cloudVolumeLoading = false;
      cloudVolumeController = null;
    }
  }
}

function displayObservation(info,started){
  state.cloud = true;
  clouds.enabled = true;
  loadMetrics.cloud = { snapshot:info.snapshot, readyMs: Math.round(performance.now() - started) };
  state.cloudObservation = info.observation_time;
  $("cloud-observation-label").textContent =
    "云图 " + date(info.observation_time);
  $("cloud-observation-label").title = info.source + " · 诊断云区遮罩";
  $("cloud-observation-label").hidden = false;
  $("cloud").closest("label").title =
    info.source +
    " · " +
    date(info.observation_time) +
    " · 远景卫星图，近景自动体积云";
  $("three-cloud-time").textContent =
    "GMGSI 观测云 · " + date(info.observation_time);
  $("cloud-credit").textContent = " · NOAA GMGSI observations / GFS";
  ensureCloudVolume();
}

async function loadCloud() {
  if (!$("cloud").checked) {
    cloudVersion++;
    cancelCloudVolume();
    state.cloud = false;
    clouds.enabled = false;
    $("cloud-observation-label").hidden = true;
    $("three-cloud-time").textContent = "";
    return;
  }
  if (!state.manifest) {
    $("three-cloud-time").textContent = "云图等待天气数据…";
    return;
  }
  if (cloudLoading) return;
  cancelCloudVolume();
  const version = ++cloudVersion,
    snapshot = state.manifest.id;
  cloudLoading = true;
  cloudRefreshAt = performance.now();
  const started = performance.now();
  $("refresh-cloud").disabled = true;
  $("three-cloud-time").textContent = "正在加载卫星观测云图…";
  try {
    const info=await readObservation(state.manifest);
    if(version!==cloudVersion || state.manifest.id!==snapshot)return;
    const attached = await clouds.setObservation(
      info,
      () => version === cloudVersion && state.manifest.id === snapshot,
    );
    if (!attached) return;
    displayObservation(info,started);
  } catch {
    if (version !== cloudVersion) return;
    state.cloud = clouds.snapshot === snapshot && !!clouds.reference;
    clouds.enabled = state.cloud;
    $("three-cloud-time").textContent = state.cloud
      ? "观测更新失败，保留同批次云图"
      : "卫星云图暂不可用，可重试";
  } finally {
    cloudLoading = false;
    $("refresh-cloud").disabled = false;
    if (version !== cloudVersion && $("cloud").checked && (!state.cloud || clouds.snapshot!==state.manifest?.id)) loadCloud();
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
  let temperaturePoint;
  if (point.temperatureHit || point.windSpeedHit) {
    temperaturePoint = (point.windSpeedHit ? windSpeeds : temperatures).sample(
      point.lon / RAD,
      point.lat / RAD,
      point.terrainHeight,
    );
    if (temperaturePoint) point = { ...point, height: temperaturePoint.height };
  }
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
    ? (w.speed === 0 ? "风 | 静风" : `风 | ${(Math.round(Math.atan2(-w.u, -w.v) / RAD) + 360) % 360}° · ${(w.speed * 3.6).toFixed(0)} km/h`)
    : "";
  const temperature = state.grid?.temperatureAt(lon, lat);
  $("three-point-temp").textContent = Number.isFinite(temperature)
    ? `气温 | ${temperature.toFixed(1)} °C`
    : "";
  const pressure =
    isobarRecord && $("isobars").checked
      ? scalarAt(isobarRecord, lon, lat) / 100
      : NaN;
  $("three-point-pressure").textContent = Number.isFinite(pressure)
    ? `海平面气压 | ${pressure.toFixed(1)} hPa`
    : "";
  const height = state.grid?.heightAt(lon, lat);
  $("three-point-layer").textContent = height
    ? state.level === "surface"
      ? "气象层 | 地面风 10 m · 气温 2 m"
      : `气象层 | ${state.level} · 位势高度约 ${(height.geopotential / 1000).toFixed(2)} km${height.belowGround ? "（位于地下，填色贴地；风线及等值线不绘制）" : ""}`
    : "";
  $("three-point-height").textContent =
    point.temperatureHit || point.windSpeedHit
      ? temperaturePoint
        ? `${point.windSpeedHit ? "风速" : "气温"}${temperaturePoint.clampedToGround ? "填色贴地" : "面显示高度"} | ${Math.round(point.height)} m`
        : "填色面高度待更新"
      : point.photoHit
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
  marker.visible =
    !(point.temperatureHit || point.windSpeedHit) || !!temperaturePoint;
  const cloudPoint = $("three-point-cloud");
  cloudPoint.hidden =
    !state.cloud || clouds.convectionSnapshot !== state.manifest?.id;
  if (!cloudPoint.hidden) {
    const describe = column => column
      ? `对流云（模式）| 云底 ${(column.bottom / 1000).toFixed(2)} km · 云顶 ${(column.top / 1000).toFixed(2)} km`
      : "对流云高 | 该点暂无有效模式诊断";
    if (clouds.pointUrl && !previewDisplayed) {
      const snapshot = state.manifest.id;
      const lon = ((point.lon / RAD + 540) % 360) - 180, lat = point.lat / RAD;
      cloudPoint.textContent = "正在读取该点云高…";
      json(`${clouds.pointUrl}?lon=${lon}&lat=${lat}`).then(result => {
        if (state.selected === point && snapshot === state.manifest?.id && !cloudPoint.hidden)
          cloudPoint.textContent = describe(result.point);
      }).catch(() => {
        if (state.selected === point && snapshot === state.manifest?.id && !cloudPoint.hidden)
          cloudPoint.textContent = "对流云高暂不可用";
      });
    } else {
      cloudPoint.textContent = describe(clouds.sampleConvection(point.lon / RAD, point.lat / RAD));
    }
  }
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
      ((e.clientX - renderer.domElement.getBoundingClientRect().left) /
        stageWidth) *
        2 -
        1,
      1 -
        ((e.clientY - renderer.domElement.getBoundingClientRect().top) /
          stageHeight) *
          2,
    ),
    camera,
  );
  const hit = activeFrame
    ? raycaster.intersectObject(activeFrame, true)[0]
    : null;
  const temperatureHit = temperatures.pick(raycaster.ray, hit?.point);
  const windSpeedHit = windSpeeds.pick(raycaster.ray, hit?.point);
  if (windSpeedHit && (!hit || windSpeedHit.distance <= hit.distance + 1)) {
    showPoint({
      lat: windSpeedHit.lat,
      lon: windSpeedHit.lon,
      height: windSpeedHit.height,
      windSpeedHit: true,
      terrainHeight: windSpeedHit.terrainHeight,
    });
    return;
  }
  if (temperatureHit && (!hit || temperatureHit.distance <= hit.distance + 1)) {
    showPoint({
      lat: temperatureHit.lat,
      lon: temperatureHit.lon,
      height: temperatureHit.height,
      temperatureHit: true,
      terrainHeight: temperatureHit.terrainHeight,
    });
    return;
  }
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
  document.body.classList.toggle("earth-controls-open", open);
  $("show-menu").textContent = open ? "专注地球" : "图层设置";
  $("show-menu").setAttribute(
    "aria-label",
    open ? "收起图层面板，专注地球" : "展开图层设置",
  );
  if (open) drawLegend();
});
// Local panel navigation preserves each setting and its scroll position.
const panelTabs = [
  ...document.querySelectorAll(".earth-panel-tabs [role=tab]"),
];
function selectPanel(tab, focus = false) {
  const previousIndex = panelTabs.findIndex(
    (item) => item.getAttribute("aria-selected") === "true",
  );
  const nextIndex = panelTabs.indexOf(tab);
  if (nextIndex === previousIndex) {
    if (focus) tab.focus();
    return;
  }
  // CSS moves the same indicator, so a new click interrupts from its current position.
  tab.parentElement.style.setProperty("--earth-panel-index", nextIndex);
  panelTabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    const content = $(item.getAttribute("aria-controls"));
    content.getAnimations().forEach((animation) => animation.cancel());
    content.hidden = !selected;
  });
  const panel = $(tab.getAttribute("aria-controls"));
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const motion = getComputedStyle(tab.parentElement);
    const distance = parseFloat(
      motion.getPropertyValue("--earth-panel-travel"),
    );
    panel.animate(
      [
        {
          opacity: 0,
          transform: `translateX(${nextIndex > previousIndex ? distance : -distance}px)`,
        },
        { opacity: 1, transform: "translateX(0)" },
      ],
      {
        duration: parseFloat(motion.getPropertyValue("--earth-panel-duration")),
        easing: motion.getPropertyValue("--earth-feedback-easing").trim(),
      },
    );
  }
  if (focus) tab.focus();
}
panelTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectPanel(tab));
  tab.addEventListener("keydown", (event) => {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % panelTabs.length
        : event.key === "ArrowLeft"
          ? (index + panelTabs.length - 1) % panelTabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? panelTabs.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      selectPanel(panelTabs[next], true);
    }
  });
});
$("earth-reset-view").addEventListener("click", () => preset("world"));
for (const [id, delta] of [
  ["earth-zoom-in", -150],
  ["earth-zoom-out", 150],
]) {
  $(id).addEventListener("click", () => {
    const box = renderer.domElement.getBoundingClientRect();
    renderer.domElement.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: delta,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    document.body.classList.contains("earth-controls-open") &&
    !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")
  ) {
    $("show-menu").click();
    $("show-menu").focus();
  }
});
new ResizeObserver(() => {
  if (!$("color-none").checked) drawLegend();
}).observe($("three-scale"));
for (const key of [
  "satellite",
  "countries",
  "provinces",
  "cities",
  "rivers",
  "wind",
  "temperature",
  "wind-speed",
  "color-none",
])
  $(key).addEventListener("change", applyLayerOpacity);
$("weather-opacity").addEventListener("input", applyLayerOpacity);
for (const key of ["height-contours", "isobars"])
  $(key).addEventListener("change", () => {
    cancelRefinement();timeline.pause();updateLevelTimeline();applyLayerOpacity();refineAfterInteraction();
    if (state.selected) showPoint(state.selected);
  });
$("retry-contours").addEventListener("click", () => {
  state.heightContourError = state.isobarError = false;
  if (!state.profile && state.grid)
    loadHeights(weatherVersion, state.grid, state.level, state.manifest.id);
  applyContours();
});
$("height-scale").addEventListener("input", updateHeightLabel);
$("retry-map").addEventListener("click", retryMap);
$("retry-height").addEventListener("click", () => {
  if (!state.manifest) { refreshWeather(); return; }
  if (state.grid) loadHeights(weatherVersion, state.grid, state.level, state.manifest.id);
  else loadWeather();
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
function changeCloudChoice() {
  cancelRefinement();timeline.pause();updateLevelTimeline();
  const url=new URL(location);
  if($("cloud").checked)url.searchParams.set("cloud","1");
  else url.searchParams.delete("cloud");
  history.replaceState(null,"",url);
  loadCloud();
  refineAfterInteraction();
}
$("cloud").addEventListener("change", changeCloudChoice);
$("refresh-cloud").addEventListener("click", () => {
  $("cloud").checked = true;
  changeCloudChoice();
});
$("earth-time-play").addEventListener("click",()=>{
  if(timeline.playing){timeline.pause();refineAfterInteraction()}
  else{cancelRefinement();timeline.play()}
});
$("earth-time-speed").addEventListener("change",e=>timeline.setRate(Number(e.target.value)));
const timeRange=$("earth-time-range");
timeRange.addEventListener("pointerdown",()=>{
  draggingTime=true;cancelRefinement();
  if(timeline.playing || timeline.pending)timeline.pause();
});
function finishDrag(){
  if(!draggingTime)return;
  draggingTime=false;
  setTimeout(()=>{if(!draggingTime)updateLevelTimeline()},0);
  refineAfterInteraction();
}
window.addEventListener("pointerup",finishDrag);
window.addEventListener("pointercancel",finishDrag);
window.addEventListener("blur",finishDrag);
timeRange.addEventListener("input",()=>timeline.seek(Number(timeRange.value),{scrubbing:true}));
timeRange.addEventListener("change",()=>timeline.seek(Number(timeRange.value)));
$("earth-time-live").addEventListener("click",async()=>{await timeline.live();refineAfterInteraction()});
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
  button.setAttribute(
    "aria-label",
    level === "surface" ? "地面" : level.replace("hPa", " hPa"),
  );
  button.addEventListener("click", () => {
    if (state.level === level && state.profile) return;
    timeline.pause();
    const upgradeCloud=previewDisplayed && $("cloud").checked;
    cancelRefinement();previewDisplayed=false;state.level = level;
    updateLevelTimeline();
    if (state.manifest) loadWeather();
    if(upgradeCloud)loadCloud();
  });
  $("three-heights").append(button);
}
function resizeStage() {
  stageWidth = stage.clientWidth;
  stageHeight = stage.clientHeight;
  camera.aspect = stageWidth / stageHeight;
  camera.fov =
    (2 / RAD) * Math.atan(Math.tan(21 * RAD) / Math.min(1, camera.aspect));
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(stageWidth, stageHeight);
  winds.setViewport(
    stageWidth,
    stageHeight,
    matchMedia("(pointer: coarse)").matches,
  );
  if (photoSurface) photoSurface.resize(camera, renderer);
  else tiles?.setResolutionFromRenderer(camera, renderer);
  buildings.resize();
}
new ResizeObserver(resizeStage).observe(stage);
window.addEventListener("resize", resizeStage);
document.addEventListener("visibilitychange", () => {
  paused = document.hidden;
  if(paused && timeline.playing)timeline.pause();
  lastRender = performance.now();
});

function frame(time) {
  requestAnimationFrame(frame);
  if (paused) return;
  const dt = Math.min((time - lastRender) / 1000, 0.1);
  lastRender = time;
  if (!debugCameraHold) controls.update(dt);
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
  winds.updateLineViewport(stageHeight);
  windSpeeds.update();
  temperatures.update();
  // On imagery, reference lines recede at orbital scale without changing saved layer choices.
  const orbitalWeight =
    state.basemap === "google"
      ? THREE.MathUtils.smoothstep(
          WGS84_ELLIPSOID.getPositionElevation(camera.position),
          2000000,
          8000000,
        )
      : 0;
  for (const [key, layer] of Object.entries(admin)) {
    const quiet = key === "countries" ? 0.65 : key === "rivers" ? 0.8 : 1;
    layer.update(
      !!mapStability?.moving || (winds.moving && winds.viewChanging),
      stageHeight,
      1 - quiet * orbitalWeight,
    );
  }
  const occupied =
    heightContours.enabled || isobarLabels.enabled
      ? [
          "menu",
          "location",
          "sponsor",
          "three-load-status",
          "earth-pressure-dock",
          "earth-time-dock",
        ]
          .map((id) => $(id))
          .filter(
            (element) =>
              !element.hidden && !element.classList.contains("invisible"),
          )
          .map((element) => {
            const box = element.getBoundingClientRect();
            const viewport = stage.getBoundingClientRect();
            return {
              left: box.left - viewport.left,
              right: box.right - viewport.left,
              top: box.top - viewport.top,
              bottom: box.bottom - viewport.top,
              width: box.width,
              height: box.height,
            };
          })
      : [];
  const heightBoxes = heightContours.update(
    time,
    stageWidth,
    stageHeight,
    occupied,
  );
  isobarLabels.update(
    time,
    stageWidth,
    stageHeight,
    occupied.concat(heightBoxes || []),
  );
  if (marker.visible) {
    const distance = camera.position.distanceTo(marker.position);
    marker.scale.setScalar(Math.max(20, distance * 0.003));
  }
  if (clouds.enabled) clouds.updateView(camera);
  clouds.setDepthRevision(`${surfaceVersion}:${state.mapDepthVersion}:${buildings.modelInfo.size}:${state.terrainReady}`);
  weatherCompositor.render(scene, fillScene, weatherScene, camera, [
    temperatures,
    windSpeeds,
    clouds,
  ]);
  atmosphere.renderSurface(
    renderer,
    camera,
    state.basemap === "google" && $("color-none").checked,
  );
  const nearPreview=$("cloud").checked && clouds.cameraAltitude <= CLOUD_VIEW_LIMITS.preloadAltitude*(previewNear?1.08:1);
  if(nearPreview!==previewNear){previewNear=nearPreview;updateLevelTimeline()}
  ensureCloudVolume();
  ensureCloudWind();
  clouds.render(renderer, camera, true);
  atmosphere.render(renderer, camera, state.basemap === "google");
  if (time - lastStatus > 1500) {
    lastStatus = time;
    const pending =
      (tiles?.stats.downloading || 0) +
      (tiles?.stats.parsing || 0) +
      (overlays?.pendingTextures || 0);
    if (state.basemap === "none") $("three-map-status").textContent = "";
    else if (state.mapBootstrapError)
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
    $("retry-height").hidden = !!state.profile && !state.temperatureError;
    $("retry-contours").hidden =
      !($("height-contours").checked && state.heightContourError) &&
      !($("isobars").checked && state.isobarError);
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
  if (!previewDisplayed && state.cloud && !cloudLoading && time - cloudRefreshAt > 300000)
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
    temperature: temperatures.getState(),
    windSpeed: windSpeeds.getState(),
    colorSurface: weatherCompositor.getState(),
    contours: {
      height: heightContours.getState(),
      pressure: {
        ...isobarLabels.getState(),
        snapshot: isobarSnapshot,
        loading: !!pressureLoadingSnapshot,
      },
    },
    elapsedMs: Math.round(performance.now() - loadMetrics.startedAt),
    firstTerrainMs: loadMetrics.firstTerrainMs,
    firstImageryMs: loadMetrics.firstImageryMs,
    imageryZooms: loadMetrics.imageryZooms,
    textureSize: loadMetrics.textureSize,
    dataLoading: { weather: loadMetrics.weather, cloud: loadMetrics.cloud, cache: dataLoader.metrics() },
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
    lineStyles: lineStyles.all(),
    basemap: state.basemap,
    photorealistic: photoSurface?.getState() || null,
    temperature: temperatures.getState(),
    windSpeed: windSpeeds.getState(),
    colorSurface: weatherCompositor.getState(),
    contours: {
      height: heightContours.getState(),
      pressure: {
        ...isobarLabels.getState(),
        snapshot: isobarSnapshot,
        loading: !!pressureLoadingSnapshot,
      },
    },
    level: state.level,
    manifest: state.manifest?.id,
    validTime: state.manifest?.valid_time,
    timeline: {playing:timeline.playing, following:timeline.following, rate:timeline.rate, prepared:preparedFor.filter(previewReady).length, preview:previewDisplayed, pending:timeline.pending?.id || null,
      available:timeline.frames.map(f=>f.valid_time)},
    ready: state.ready,
    terrain: state.terrain,
    terrainReady: state.terrainReady,
    loadedModels: state.models,
    visibleTiles: tiles?.visibleTiles.size,
    imageryResponses: state.imageryResponses,
    cloud: state.cloud,
    cloudVolume: clouds.getState(),
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
        {
          enabled: $(k).checked,
          count: geo[k]?.features.length || 0,
          ...admin[k].getState(),
        },
      ]),
    ),
    cameraHeight: WGS84_ELLIPSOID.getPositionElevation(camera.position),
  }),
  flyTo: preset,
};

if (query.has("debug")) {
  window.weatherEarth3D.debug = {
    setOverview: (lon, lat, altitude, tilt = 0, lookHeight = 0) => {
      controls.resetState();
      WGS84_ELLIPSOID.getCartographicToPosition(
        lat * RAD,
        lon * RAD,
        altitude,
        camera.position,
      );
      camera.up.set(
        -Math.sin(lat * RAD) * Math.cos(lon * RAD),
        -Math.sin(lat * RAD) * Math.sin(lon * RAD),
        Math.cos(lat * RAD),
      );
      if (tilt) {
        const target = WGS84_ELLIPSOID.getCartographicToPosition(
          lat * RAD,
          lon * RAD,
          0,
          new THREE.Vector3(),
        );
        const east = new THREE.Vector3(
          -Math.sin(lon * RAD),
          Math.cos(lon * RAD),
          0,
        );
        camera.position
          .sub(target)
          .applyAxisAngle(east, tilt * RAD)
          .add(target);
        const viewTarget = WGS84_ELLIPSOID.getCartographicToPosition(
          lat * RAD,
          lon * RAD,
          lookHeight,
          new THREE.Vector3(),
        );
        camera.lookAt(viewTarget);
      } else camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      controls.setCamera(camera);
      controls.resetState();
      debugCameraHold = tilt !== 0;
      if (debugCameraHold) {
        WGS84_ELLIPSOID.getPositionToNormal(camera.position,camera.up);
        camera.lookAt(
          WGS84_ELLIPSOID.getCartographicToPosition(
            lat * RAD,
            lon * RAD,
            lookHeight,
            new THREE.Vector3(),
          ),
        );
        camera.updateMatrixWorld();
        // A held view skips controls.update(), so refresh clipping after the debug jump.
        controls.adjustCamera(camera);
      }
      winds.clear();
    },
    captureView: () => {
      const pivot = controls.getPivotPoint(new THREE.Vector3());
      return {
        position: camera.position.toArray(),
        pivot: pivot.toArray(),
        direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
        matrixWorld: camera.matrixWorld.toArray(),
        inverseProjection: camera.projectionMatrixInverse.toArray(),
        fov: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
      };
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
$("cloud").checked = query.get("cloud") === "1";
$("buildings").checked = query.get("buildings") !== "0";
$("temperature").checked = query.get("temperature") === "1";
$("wind-speed").checked =
  query.get("color") === "wind" ||
  (!query.has("color") &&
    !$("temperature").checked &&
    query.get("windSpeed") !== "0");
if (query.get("color") === "temp") $("temperature").checked = true;
if (query.get("color") === "none")
  $("temperature").checked = $("wind-speed").checked = false;
$("color-none").checked = !$("temperature").checked && !$("wind-speed").checked;
$("height-contours").checked = query.get("heightContours") === "1";
$("isobars").checked = query.get("isobars") === "1";
$("rivers").checked = query.get("rivers") !== "0";
for (const key of Object.keys(admin)) admin[key].setEnabled($(key).checked);
lineStylePanel = mountLineStylePanel(lineStyles, applyLineStyle);
buildings.setEnabled(false);
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
      if (key === "countries") {
        fallback.setCountries(data);
        if (!admin.countries.source) admin.countries.setData(data);
      } else syncAdministrativeTopology();
    })
    .catch(() => error("行政区划加载失败"));
}
json("../data/geography/reference-lines.json")
  .then((data) => {
    if (data.schema !== 1) throw new Error("Unsupported geography data");
    admin.countries.setData(data.countries);
    admin.rivers.setData(data.rivers);
    geo.rivers = data.rivers.detail;
  })
  .catch(() => error("边界与河流数据加载失败"));
refreshWeather();
