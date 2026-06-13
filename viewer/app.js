const TIMELINE_MANIFEST_URL = "../outputs/nmc-wind/manifest.json";
const DEFAULT_GEOJSON_URL = "../outputs/nmc-wind/202606101800.geojson";
const DEFAULT_IMAGE_URL =
  "https://image.nmc.cn/product/2026/06/10/STFC/SEVP_NMC_STFC_SFER_EDA_ACHN_L88_PB_20260610100000000.jpg?v=1781086389258";
const GLOBE_BASEMAP_URL = "./assets/countries.geojson";
const CHINA_BOUNDS = [
  [18, 73],
  [54, 135],
];
const GLOBE_RADIUS = 2;
const GLOBE_VIEW_CENTER = { lon: 105.645, lat: 35.86 };
const GLOBE_MAX_RING_POINTS = 120;
const GLOBE_DEFAULT_CAMERA_DISTANCE = 5.8;
const GLOBE_MIN_CAMERA_DISTANCE = 3.25;
const GLOBE_MAX_CAMERA_DISTANCE = 9.5;
const GLOBE_ROTATE_X_SENSITIVITY = 0.002;
const GLOBE_ROTATE_Y_SENSITIVITY = 0.0028;
const GLOBE_TILE_SUBDOMAINS = ["a", "b", "c", "d"];
const GLOBE_TILE_CONCURRENCY = 10;
const GLOBE_TILE_SOURCES = [
  {
    name: "CARTO Dark",
    buildTileUrl: (tile, subdomain) =>
      `https://${subdomain}.basemaps.cartocdn.com/dark_all/${tile.zoom}/${tile.x}/${tile.y}.png`,
  },
  {
    name: "OpenStreetMap",
    buildTileUrl: (tile, subdomain) =>
      `https://${subdomain}.tile.openstreetmap.org/${tile.zoom}/${tile.x}/${tile.y}.png`,
  },
];
const GLOBE_TILE_SOURCE_NAME = GLOBE_TILE_SOURCES[0].name;
const GLOBE_DETAIL_TILE_SOURCES = [
  {
    name: "CARTO Light",
    buildTileUrl: (tile, subdomain) =>
      `https://${subdomain}.basemaps.cartocdn.com/light_all/${tile.zoom}/${tile.x}/${tile.y}.png`,
  },
  {
    name: "OpenStreetMap",
    buildTileUrl: (tile, subdomain) =>
      `https://${subdomain}.tile.openstreetmap.org/${tile.zoom}/${tile.x}/${tile.y}.png`,
  },
];
const GLOBE_DETAIL_TILE_ZOOM = 7;
const GLOBE_DETAIL_TILE_DISTANCE = 4.35;
const GLOBE_LABEL_DISTANCE = 4.85;
const GLOBE_DETAIL_TILE_RADIUS = GLOBE_RADIUS * 1.008;
const WATCH_CITIES = [
  { id: "urumqi", name: "乌鲁木齐", lon: 87.6168, lat: 43.8256 },
  { id: "lhasa", name: "拉萨", lon: 91.1172, lat: 29.6469 },
  { id: "beijing", name: "北京", lon: 116.4074, lat: 39.9042 },
  { id: "hohhot", name: "呼和浩特", lon: 111.7492, lat: 40.8426 },
  { id: "harbin", name: "哈尔滨", lon: 126.6424, lat: 45.7569 },
  { id: "xining", name: "西宁", lon: 101.7782, lat: 36.6171 },
  { id: "lanzhou", name: "兰州", lon: 103.8343, lat: 36.0611 },
  { id: "chengdu", name: "成都", lon: 104.0665, lat: 30.5723 },
  { id: "shanghai", name: "上海", lon: 121.4737, lat: 31.2304 },
  { id: "guangzhou", name: "广州", lon: 113.2644, lat: 23.1291 },
];
const GLOBE_CITY_LABELS = [
  { name: "北京", lon: 116.4074, lat: 39.9042, weight: 1.2 },
  { name: "天津", lon: 117.2009, lat: 39.0842 },
  { name: "上海", lon: 121.4737, lat: 31.2304, weight: 1.2 },
  { name: "广州", lon: 113.2644, lat: 23.1291, weight: 1.1 },
  { name: "深圳", lon: 114.0579, lat: 22.5431 },
  { name: "重庆", lon: 106.5516, lat: 29.563 },
  { name: "成都", lon: 104.0665, lat: 30.5723 },
  { name: "武汉", lon: 114.3054, lat: 30.5931 },
  { name: "西安", lon: 108.9398, lat: 34.3416 },
  { name: "郑州", lon: 113.6254, lat: 34.7466 },
  { name: "济南", lon: 117.1201, lat: 36.6512 },
  { name: "南京", lon: 118.7969, lat: 32.0603 },
  { name: "杭州", lon: 120.1551, lat: 30.2741 },
  { name: "合肥", lon: 117.2272, lat: 31.8206 },
  { name: "长沙", lon: 112.9388, lat: 28.2282 },
  { name: "南昌", lon: 115.8582, lat: 28.682 },
  { name: "福州", lon: 119.2965, lat: 26.0745 },
  { name: "台北", lon: 121.5654, lat: 25.033 },
  { name: "香港", lon: 114.1694, lat: 22.3193 },
  { name: "澳门", lon: 113.5439, lat: 22.1987 },
  { name: "海口", lon: 110.1983, lat: 20.0444 },
  { name: "南宁", lon: 108.3669, lat: 22.817 },
  { name: "昆明", lon: 102.8329, lat: 24.8801 },
  { name: "贵阳", lon: 106.6302, lat: 26.647 },
  { name: "拉萨", lon: 91.1172, lat: 29.6469 },
  { name: "西宁", lon: 101.7782, lat: 36.6171 },
  { name: "兰州", lon: 103.8343, lat: 36.0611 },
  { name: "银川", lon: 106.2309, lat: 38.4872 },
  { name: "呼和浩特", lon: 111.7492, lat: 40.8426 },
  { name: "太原", lon: 112.5489, lat: 37.8706 },
  { name: "石家庄", lon: 114.5149, lat: 38.0428 },
  { name: "沈阳", lon: 123.4315, lat: 41.8057 },
  { name: "长春", lon: 125.3235, lat: 43.8171 },
  { name: "哈尔滨", lon: 126.6424, lat: 45.7569 },
  { name: "乌鲁木齐", lon: 87.6168, lat: 43.8256 },
];
const GLOBE_RIVER_LINES = [
  {
    name: "长江",
    labelLon: 113.2,
    labelLat: 30.7,
    coordinates: [
      [91.2, 33.2],
      [96.8, 32.7],
      [101.7, 30.9],
      [106.5, 29.5],
      [112.2, 30.4],
      [117.2, 31.8],
      [121.5, 31.3],
    ],
  },
  {
    name: "黄河",
    labelLon: 111.5,
    labelLat: 36.6,
    coordinates: [
      [96.0, 35.2],
      [101.6, 36.4],
      [106.3, 38.5],
      [111.1, 37.8],
      [112.7, 34.8],
      [116.5, 36.2],
      [119.1, 37.7],
    ],
  },
  {
    name: "珠江",
    labelLon: 112.6,
    labelLat: 23.5,
    coordinates: [
      [104.9, 24.7],
      [108.3, 23.4],
      [111.2, 23.1],
      [113.3, 23.1],
      [114.2, 22.7],
    ],
  },
];

const state = {
  overlayLayer: null,
  overlayBounds: null,
  locationLayer: null,
  watchPoint: null,
  locationAnalysis: null,
  pickingMapPoint: false,
  viewMode: "globe",
  globeAutoRotate: true,
  opacity: 0.58,
};

const map = L.map("map", {
  preferCanvas: false,
  zoomControl: true,
  minZoom: 3,
});

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});

const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
});

const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 17,
  attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
});

carto.addTo(map);

const chinaExtent = L.rectangle(CHINA_BOUNDS, {
  color: "#5c6770",
  weight: 1,
  dashArray: "6 6",
  fill: false,
  interactive: false,
}).addTo(map);

L.control
  .layers(
    {
      "CARTO Light": carto,
      OpenStreetMap: osm,
      OpenTopoMap: topo,
    },
    {
      "中国经纬度范围框": chinaExtent,
    },
    { collapsed: false }
  )
  .addTo(map);

const statusText = document.querySelector("#statusText");
const detailText = document.querySelector("#detailText");
const opacityInput = document.querySelector("#opacityInput");
const chinaExtentToggle = document.querySelector("#chinaExtentToggle");
const imageUrlInput = document.querySelector("#imageUrlInput");
const urlForm = document.querySelector("#urlForm");
const processUrlButton = document.querySelector("#processUrlButton");
const autoRenderToggle = document.querySelector("#autoRenderToggle");
const sourceImagePanel = document.querySelector("#sourceImagePanel");
const sourceImagePreview = document.querySelector("#sourceImagePreview");
const sourceImageMeta = document.querySelector("#sourceImageMeta");
const sourceImageButton = document.querySelector("#sourceImageButton");
const openSourceImage = document.querySelector("#openSourceImage");
const imageModal = document.querySelector("#imageModal");
const imageModalImage = document.querySelector("#imageModalImage");
const imageModalTitle = document.querySelector("#imageModalTitle");
const closeImageModal = document.querySelector("#closeImageModal");
const downloadGeoJsonButton = document.querySelector("#downloadGeoJson");
const playTimelineButton = document.querySelector("#playTimeline");
const processOverview = document.querySelector("#processOverview");
const timelineSlider = document.querySelector("#timelineSlider");
const timelineTicks = document.querySelector("#timelineTicks");
const statTime = document.querySelector("#statTime");
const statRegions = document.querySelector("#statRegions");
const statSevere = document.querySelector("#statSevere");
const statPoints = document.querySelector("#statPoints");
const trendChart = document.querySelector("#trendChart");
const trendDetail = document.querySelector("#trendDetail");
const jumpPeakTime = document.querySelector("#jumpPeakTime");
const cityImpactSummary = document.querySelector("#cityImpactSummary");
const cityImpactList = document.querySelector("#cityImpactList");
const refreshCityImpact = document.querySelector("#refreshCityImpact");
const watchCitySelect = document.querySelector("#watchCitySelect");
const watchLonInput = document.querySelector("#watchLonInput");
const watchLatInput = document.querySelector("#watchLatInput");
const analyzeWatchPoint = document.querySelector("#analyzeWatchPoint");
const watchPointResult = document.querySelector("#watchPointResult");
const watchProcessSummary = document.querySelector("#watchProcessSummary");
const watchImpactTimeline = document.querySelector("#watchImpactTimeline");
const pickMapPoint = document.querySelector("#pickMapPoint");
const shareSummaryText = document.querySelector("#shareSummaryText");
const copyShareSummary = document.querySelector("#copyShareSummary");
const shareCopyStatus = document.querySelector("#shareCopyStatus");
const mapElement = document.querySelector("#map");
const mapStage = document.querySelector(".map-stage");
const globeView = document.querySelector("#globeView");
const globeCanvas = document.querySelector("#globeCanvas");
const globeHud = document.querySelector("#globeHud");
const globeMapStatus = document.querySelector("#globeMapStatus");
const viewGlobeButton = document.querySelector("#viewGlobe");
const viewMapButton = document.querySelector("#viewMap");
const globeAutoRotateInput = document.querySelector("#globeAutoRotate");
const globeZoomInButton = document.querySelector("#globeZoomIn");
const globeZoomOutButton = document.querySelector("#globeZoomOut");

let autoRenderTimer = null;
let latestUrlRequestId = 0;
let currentSourceImageUrl = "";
let currentGeoJsonPayload = null;
let currentGeoJsonFilename = "weather-wind-regions.geojson";
let timelineTimer = null;
let timelineRequestId = 0;
let timelineManifest = null;
let hourlyWindCases = [];
let watchSeriesRequestId = 0;
let cityImpactRequestId = 0;
let currentShareSummary = "";
let cityImpactResults = [];
const timelineGeoJsonCache = new Map();
const globe = {
  initialized: false,
  renderer: null,
  scene: null,
  camera: null,
  root: null,
  earth: null,
  earthTexture: null,
  baseMapGroup: null,
  detailTileGroup: null,
  labelGroup: null,
  riverGroup: null,
  baseMapLoaded: false,
  baseMapLoading: false,
  baseMapPayload: null,
  mapTileZoom: 0,
  mapTileLoadingZoom: 0,
  mapTileRequestId: 0,
  mapTileLoadedCount: 0,
  mapTileTotalCount: 0,
  tileSourceIndex: 0,
  activeTileSourceName: GLOBE_TILE_SOURCE_NAME,
  detailTileZoom: 0,
  detailTileLoadingZoom: 0,
  detailTileRequestId: 0,
  detailTileLoadedCount: 0,
  detailTileTotalCount: 0,
  detailTileSourceIndex: 0,
  activeDetailTileSourceName: GLOBE_DETAIL_TILE_SOURCES[0].name,
  weatherGroup: null,
  watchGroup: null,
  animationId: 0,
  lastFrameTime: 0,
  cameraDistance: GLOBE_DEFAULT_CAMERA_DISTANCE,
  activePointers: new Map(),
  pinchStartDistance: 0,
  pinchStartCameraDistance: GLOBE_DEFAULT_CAMERA_DISTANCE,
  dragging: false,
  dragStart: null,
  rotationStart: null,
};

imageUrlInput.value = DEFAULT_IMAGE_URL;
setSourceImage(DEFAULT_IMAGE_URL, "默认 NMC 图片 URL");
initializeWatchCities();

document.querySelector("#loadDefault").addEventListener("click", () => loadDefaultGeoJson());
viewGlobeButton.addEventListener("click", () => setViewMode("globe"));
viewMapButton.addEventListener("click", () => setViewMode("map"));
globeAutoRotateInput.addEventListener("change", (event) => {
  state.globeAutoRotate = event.target.checked;
});
globeZoomInButton.addEventListener("click", () => {
  setGlobeCameraDistance(globe.cameraDistance - 0.45);
});
globeZoomOutButton.addEventListener("click", () => {
  setGlobeCameraDistance(globe.cameraDistance + 0.45);
});
urlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  processImageUrl(imageUrlInput.value);
});
imageUrlInput.addEventListener("input", () => {
  if (!autoRenderToggle.checked) return;
  window.clearTimeout(autoRenderTimer);
  autoRenderTimer = window.setTimeout(() => {
    const value = imageUrlInput.value.trim();
    if (isProbablyHttpUrl(value)) {
      processImageUrl(value);
    }
  }, 900);
});
document.querySelector("#fitChina").addEventListener("click", () => {
  fitChina();
});
document.querySelector("#fitOverlay").addEventListener("click", () => {
  fitOverlay();
});
document.querySelector("#fileInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const text = await file.text();
  renderGeoJson(JSON.parse(text), file.name);
});
downloadGeoJsonButton.addEventListener("click", () => {
  downloadCurrentGeoJson();
});
timelineSlider.addEventListener("input", (event) => {
  loadTimelineCase(Number(event.target.value));
});
timelineTicks.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-index]");
  if (!button) return;
  loadTimelineCase(Number(button.dataset.index));
});
playTimelineButton.addEventListener("click", () => {
  toggleTimelinePlayback();
});
trendChart.addEventListener("click", (event) => {
  const target = event.target.closest("[data-trend-index]");
  if (!target) return;
  loadTimelineCase(Number(target.dataset.trendIndex));
});
watchImpactTimeline.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-watch-index]");
  if (!target) return;
  loadTimelineCase(Number(target.dataset.watchIndex));
});
cityImpactList.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-city-id]");
  if (!target) return;
  selectWatchCity(target.dataset.cityId);
});
refreshCityImpact.addEventListener("click", () => {
  analyzeCityImpactLeaderboard();
});
copyShareSummary.addEventListener("click", () => {
  copyCurrentShareSummary();
});
jumpPeakTime.addEventListener("click", () => {
  const peakIndex = getPeakTimelineIndex("regionCount");
  if (peakIndex >= 0) {
    loadTimelineCase(peakIndex);
  }
});
watchCitySelect.addEventListener("change", () => {
  const city = WATCH_CITIES.find((item) => item.id === watchCitySelect.value);
  if (!city) return;
  setWatchInputs(city.lon, city.lat);
  updateCityImpactActive(city.id);
  analyzeCurrentWatchPoint({ fit: true });
});
watchLonInput.addEventListener("input", () => {
  watchCitySelect.value = "custom";
  updateCityImpactActive("custom");
});
watchLatInput.addEventListener("input", () => {
  watchCitySelect.value = "custom";
  updateCityImpactActive("custom");
});
analyzeWatchPoint.addEventListener("click", () => {
  analyzeCurrentWatchPoint({ fit: true });
});
pickMapPoint.addEventListener("click", () => {
  state.pickingMapPoint = !state.pickingMapPoint;
  pickMapPoint.textContent = state.pickingMapPoint ? "取消点选" : "地图点选";
  map.getContainer().classList.toggle("is-picking-point", state.pickingMapPoint);
});
sourceImageButton.addEventListener("click", () => openSourceImageModal());
openSourceImage.addEventListener("click", () => openSourceImageModal());
closeImageModal.addEventListener("click", () => closeSourceImageModal());
imageModal.addEventListener("click", (event) => {
  if (event.target === imageModal) {
    closeSourceImageModal();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSourceImageModal();
  }
});

opacityInput.addEventListener("input", (event) => {
  state.opacity = Number(event.target.value);
  if (state.overlayLayer) {
    state.overlayLayer.setStyle((feature) => styleFeature(feature));
  }
  if (currentGeoJsonPayload) {
    renderGlobeWeather(currentGeoJsonPayload, currentGeoJsonFilename);
  }
});

chinaExtentToggle.addEventListener("change", (event) => {
  if (event.target.checked) {
    chinaExtent.addTo(map);
  } else {
    chinaExtent.remove();
  }
});

map.on("click", (event) => {
  if (!state.pickingMapPoint) return;
  state.pickingMapPoint = false;
  pickMapPoint.textContent = "地图点选";
  map.getContainer().classList.remove("is-picking-point");
  watchCitySelect.value = "custom";
  setWatchInputs(event.latlng.lng, event.latlng.lat);
  analyzeCurrentWatchPoint({ fit: false, openPopup: true });
});

setViewMode("globe");

function featureColor(feature) {
  const label = feature?.properties?.label || "";
  if (label.includes("level_8")) return "#1737ff";
  if (label.includes("level_7")) return "#1b7cff";
  if (label.includes("level_6")) return "#00d6f2";
  return "#ff564a";
}

function styleFeature(feature) {
  const color = featureColor(feature);

  return {
    color,
    weight: 2,
    opacity: 0.95,
    fillColor: color,
    fillOpacity: state.opacity,
  };
}

function bindPopup(feature, layer) {
  const props = feature.properties || {};
  const bbox = Array.isArray(props.bbox_lonlat)
    ? props.bbox_lonlat.map((value) => Number(value).toFixed(4)).join(", ")
    : "无";
  layer.bindPopup(`
    <strong>${escapeHtml(props.label || "GeoJSON 区域")}</strong><br>
    面积像素: ${escapeHtml(String(props.area_px ?? "无"))}<br>
    坐标系: ${escapeHtml(props.coordinate_system || "未知")}<br>
    经纬度 bbox: ${escapeHtml(bbox)}<br>
    精度: ${escapeHtml(props.accuracy || "未知")}
  `);
}

function setViewMode(mode) {
  state.viewMode = mode === "map" ? "map" : "globe";
  const isGlobe = state.viewMode === "globe";
  mapStage.dataset.viewMode = state.viewMode;
  globeView.classList.toggle("is-active", isGlobe);
  mapElement.classList.toggle("is-active", !isGlobe);
  viewGlobeButton.classList.toggle("is-active", isGlobe);
  viewMapButton.classList.toggle("is-active", !isGlobe);
  viewGlobeButton.setAttribute("aria-pressed", String(isGlobe));
  viewMapButton.setAttribute("aria-pressed", String(!isGlobe));
  globeAutoRotateInput.disabled = !isGlobe;
  globeZoomInButton.disabled = !isGlobe;
  globeZoomOutButton.disabled = !isGlobe;

  if (isGlobe) {
    ensureGlobe();
    resizeGlobe();
  } else {
    map.invalidateSize();
    if (state.overlayBounds?.isValid()) {
      fitOverlay();
    } else {
      fitChina();
    }
  }
}

function ensureGlobe() {
  if (globe.initialized) return true;
  if (!window.THREE) {
    globeHud.innerHTML = "<span>3D 地球</span><strong>Three.js 加载失败</strong>";
    return false;
  }

  const THREE = window.THREE;
  globe.renderer = new THREE.WebGLRenderer({
    canvas: globeCanvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  globe.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  globe.renderer.setClearColor(0x020711, 0);

  globe.scene = new THREE.Scene();
  globe.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const cameraVector = lonLatToVector3(GLOBE_VIEW_CENTER.lon, GLOBE_VIEW_CENTER.lat, globe.cameraDistance);
  globe.camera.position.copy(cameraVector);
  globe.camera.lookAt(0, 0, 0);

  globe.root = new THREE.Group();
  globe.scene.add(globe.root);

  const ambient = new THREE.AmbientLight(0x6f94b5, 1.15);
  globe.scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(3, 4, 5);
  globe.scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x49d7ff, 1.4);
  rimLight.position.copy(cameraVector.clone().multiplyScalar(-1));
  globe.scene.add(rimLight);

  globe.earthTexture = createEarthTexture(null);
  globe.earth = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64),
    new THREE.MeshPhongMaterial({
      map: globe.earthTexture,
      color: 0x9bd8ff,
      shininess: 34,
      specular: 0x15364a,
    })
  );
  globe.root.add(globe.earth);
  globe.detailTileGroup = new THREE.Group();
  globe.root.add(globe.detailTileGroup);
  globe.baseMapGroup = new THREE.Group();
  globe.root.add(globe.baseMapGroup);
  globe.root.add(createGlobeGrid());
  globe.root.add(createChinaExtentLine());
  globe.riverGroup = createGlobeRiverLayer();
  globe.labelGroup = createGlobeCityLabels();
  globe.root.add(globe.riverGroup);
  globe.root.add(globe.labelGroup);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS * 1.055, 96, 64),
    new THREE.MeshBasicMaterial({
      color: 0x4ee3ff,
      transparent: true,
      opacity: 0.13,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  globe.scene.add(atmosphere);
  globe.scene.add(createStarField());

  globe.weatherGroup = new THREE.Group();
  globe.watchGroup = new THREE.Group();
  globe.root.add(globe.weatherGroup);
  globe.root.add(globe.watchGroup);

  attachGlobePointerControls();
  globe.initialized = true;
  resizeGlobe();
  loadGlobeBaseMap();
  updateGlobeRealMapTexture();
  updateGlobeDetailLayers();
  animateGlobe(0);
  return true;
}

function resizeGlobe() {
  if (!globe.initialized) return;
  const rect = globeView.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  globe.renderer.setSize(width, height, false);
  globe.camera.aspect = width / height;
  globe.camera.updateProjectionMatrix();
}

function setGlobeCameraDistance(distance) {
  globe.cameraDistance = clamp(Number(distance), GLOBE_MIN_CAMERA_DISTANCE, GLOBE_MAX_CAMERA_DISTANCE);
  if (!globe.camera) return;
  globe.camera.position.setLength(globe.cameraDistance);
  globe.camera.lookAt(0, 0, 0);
  syncGlobeDebugState();
  updateGlobeRealMapTexture();
  updateGlobeDetailLayers();
}

function positionGlobeCamera(lon, lat, distance = globe.cameraDistance) {
  globe.cameraDistance = clamp(Number(distance), GLOBE_MIN_CAMERA_DISTANCE, GLOBE_MAX_CAMERA_DISTANCE);
  if (!globe.camera) return;
  globe.camera.position.copy(lonLatToVector3(lon, lat, globe.cameraDistance));
  globe.camera.lookAt(0, 0, 0);
  syncGlobeDebugState();
  updateGlobeRealMapTexture();
  updateGlobeDetailLayers();
}

function syncGlobeDebugState() {
  if (!mapStage || !globe.root) return;
  mapStage.dataset.globeCameraDistance = globe.cameraDistance.toFixed(3);
  mapStage.dataset.globeRotationX = globe.root.rotation.x.toFixed(4);
  mapStage.dataset.globeRotationY = globe.root.rotation.y.toFixed(4);
  mapStage.dataset.globeTileZoom = String(globe.mapTileZoom || globe.mapTileLoadingZoom || 0);
}

function animateGlobe(time) {
  if (!globe.initialized) return;
  const delta = globe.lastFrameTime ? Math.min(48, time - globe.lastFrameTime) : 16;
  globe.lastFrameTime = time;
  if (state.globeAutoRotate && !globe.dragging) {
    globe.root.rotation.y += delta * globeAutoRotateSpeed();
  }
  syncGlobeDebugState();
  globe.renderer.render(globe.scene, globe.camera);
  globe.animationId = window.requestAnimationFrame(animateGlobe);
}

function globeAutoRotateSpeed() {
  const zoomScale = clamp(
    (globe.cameraDistance - GLOBE_MIN_CAMERA_DISTANCE) / (GLOBE_DEFAULT_CAMERA_DISTANCE - GLOBE_MIN_CAMERA_DISTANCE),
    0.08,
    1
  );
  return 0.000028 * zoomScale;
}

function attachGlobePointerControls() {
  globeCanvas.addEventListener("pointerdown", (event) => {
    globe.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    globeCanvas.setPointerCapture(event.pointerId);
    if (globe.activePointers.size === 1) {
      globe.dragging = true;
      globe.dragStart = { x: event.clientX, y: event.clientY };
      globe.rotationStart = { x: globe.root.rotation.x, y: globe.root.rotation.y };
    } else if (globe.activePointers.size === 2) {
      globe.dragging = false;
      globe.pinchStartDistance = getPointerPairDistance();
      globe.pinchStartCameraDistance = globe.cameraDistance;
    }
  });
  globeCanvas.addEventListener("pointermove", (event) => {
    if (!globe.activePointers.has(event.pointerId)) return;
    globe.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (globe.activePointers.size >= 2) {
      const distance = getPointerPairDistance();
      if (distance > 0 && globe.pinchStartDistance > 0) {
        setGlobeCameraDistance(globe.pinchStartCameraDistance * (globe.pinchStartDistance / distance));
      }
      return;
    }

    if (!globe.dragging || !globe.dragStart || !globe.rotationStart) return;
    const dx = event.clientX - globe.dragStart.x;
    const dy = event.clientY - globe.dragStart.y;
    const sensitivity = globeDragSensitivity();
    globe.root.rotation.y = globe.rotationStart.y + dx * sensitivity.x;
    globe.root.rotation.x = clamp(globe.rotationStart.x - dy * sensitivity.y, -0.75, 0.75);
    syncGlobeDebugState();
  });
  globeCanvas.addEventListener("pointerup", (event) => {
    finishGlobePointer(event.pointerId);
    globeCanvas.releasePointerCapture(event.pointerId);
  });
  globeCanvas.addEventListener("pointercancel", (event) => {
    finishGlobePointer(event.pointerId);
  });
  globeCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * 0.36;
      setGlobeCameraDistance(globe.cameraDistance + delta);
    },
    { passive: false }
  );
  globeCanvas.addEventListener("dblclick", () => {
    setGlobeCameraDistance(globe.cameraDistance - 0.55);
  });
}

function finishGlobePointer(pointerId) {
  globe.activePointers.delete(pointerId);
  globe.pinchStartDistance = 0;
  if (!globe.activePointers.size) {
    globe.dragging = false;
    globe.dragStart = null;
    globe.rotationStart = null;
    return;
  }
  if (globe.activePointers.size === 1) {
    const remaining = [...globe.activePointers.values()][0];
    globe.dragging = true;
    globe.dragStart = { x: remaining.x, y: remaining.y };
    globe.rotationStart = { x: globe.root.rotation.x, y: globe.root.rotation.y };
  } else {
    globe.dragging = false;
    globe.pinchStartDistance = getPointerPairDistance();
    globe.pinchStartCameraDistance = globe.cameraDistance;
  }
}

function getPointerPairDistance() {
  const pointers = [...globe.activePointers.values()];
  if (pointers.length < 2) return 0;
  return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
}

function globeDragSensitivity() {
  const zoomScale = clamp(
    (globe.cameraDistance - GLOBE_MIN_CAMERA_DISTANCE) / (GLOBE_DEFAULT_CAMERA_DISTANCE - GLOBE_MIN_CAMERA_DISTANCE),
    0.22,
    1
  );
  return {
    x: GLOBE_ROTATE_Y_SENSITIVITY * zoomScale,
    y: GLOBE_ROTATE_X_SENSITIVITY * zoomScale,
  };
}

async function loadGlobeBaseMap() {
  if (globe.baseMapLoaded || globe.baseMapLoading) return;
  globe.baseMapLoading = true;
  try {
    const response = await fetch(GLOBE_BASEMAP_URL, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`地球边界加载失败: ${response.status}`);
    }
    const payload = await response.json();
    globe.baseMapPayload = payload;
    globe.baseMapLoaded = true;
    applyGlobeBaseMap(payload);
  } catch (error) {
    globeHud.innerHTML = `<span>3D 地球</span><strong>${escapeHtml(error.message || String(error))}</strong>`;
  } finally {
    globe.baseMapLoading = false;
  }
}

function applyGlobeBaseMap(payload) {
  if (!globe.initialized || !payload) return;
  if (!globe.mapTileZoom && !globe.mapTileLoadingZoom) {
    setGlobeEarthTexture(createEarthTexture(payload));
  }

  clearThreeGroup(globe.baseMapGroup);
  globe.baseMapGroup.add(createGlobeBoundaryLayer(payload));
  updateGlobeRealMapTexture();
}

function setGlobeEarthTexture(texture) {
  if (!globe.earth || !texture) return;
  if (globe.earthTexture && globe.earthTexture !== texture) {
    globe.earthTexture.dispose?.();
  }
  globe.earthTexture = texture;
  globe.earth.material.map = texture;
  globe.earth.material.needsUpdate = true;
}

function desiredGlobeTileDetail() {
  if (globe.cameraDistance <= 4.15) {
    return { displayZoom: 7, baseZoom: 4, focusZoom: 7 };
  }
  if (globe.cameraDistance <= 6.25) {
    return { displayZoom: 6, baseZoom: 4, focusZoom: 6 };
  }
  if (globe.cameraDistance <= 7.4) {
    return { displayZoom: 4, baseZoom: 4, focusZoom: 0 };
  }
  return { displayZoom: 3, baseZoom: 3, focusZoom: 0 };
}

function updateGlobeRealMapTexture() {
  if (!globe.initialized) return;
  const targetDetail = desiredGlobeTileDetail();
  if (targetDetail.displayZoom === globe.mapTileZoom || targetDetail.displayZoom === globe.mapTileLoadingZoom) return;

  globe.mapTileRequestId += 1;
  const requestId = globe.mapTileRequestId;
  globe.mapTileLoadingZoom = targetDetail.displayZoom;
  globe.mapTileLoadedCount = 0;
  globe.mapTileTotalCount = 0;
  setGlobeMapStatus(`正在加载真实地图 L${targetDetail.displayZoom}...`);

  buildGlobeTileTexture(targetDetail, requestId)
    .then(({ texture, loadedCount, totalCount }) => {
      if (requestId !== globe.mapTileRequestId) {
        texture.dispose?.();
        return;
      }
      setGlobeEarthTexture(texture);
      globe.mapTileZoom = targetDetail.displayZoom;
      globe.mapTileLoadingZoom = 0;
      globe.mapTileLoadedCount = loadedCount;
      globe.mapTileTotalCount = totalCount;
      setGlobeMapStatus(buildGlobeMapStatus(targetDetail, loadedCount, totalCount));
      syncGlobeDebugState();
    })
  .catch((error) => {
      if (requestId !== globe.mapTileRequestId) return;
      globe.mapTileLoadingZoom = 0;
      if (globe.baseMapPayload) {
        setGlobeEarthTexture(createEarthTexture(globe.baseMapPayload));
        globe.mapTileZoom = 0;
      }
      setGlobeMapStatus(`真实地图加载失败，使用边界底图：${error.message || String(error)}`);
      syncGlobeDebugState();
    });
}

function buildGlobeMapStatus(detail, loadedCount, totalCount) {
  const focusText = detail.focusZoom ? ` + 中国 L${detail.focusZoom}` : "";
  const detailText = globe.detailTileLoadedCount
    ? ` + 近距 ${globe.activeDetailTileSourceName} ${globe.detailTileLoadedCount}/${globe.detailTileTotalCount}`
    : "";
  return `真实地图 L${detail.baseZoom}${focusText}${detailText} / ${loadedCount}/${totalCount} 瓦片`;
}

function setGlobeMapStatus(message) {
  if (globeMapStatus) {
    globeMapStatus.textContent = message;
  }
  if (mapStage) {
    mapStage.dataset.globeMapStatus = message;
  }
}

async function buildGlobeTileTexture(detail, requestId) {
  const THREE = window.THREE;
  const size = tileTextureSizeForZoom(detail.displayZoom);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  drawEarthTextureBase(context, globe.baseMapPayload);

  const tasks = [
    ...buildGlobalTileTasks(detail.baseZoom),
    ...buildFocusTileTasks(detail.focusZoom, CHINA_BOUNDS),
  ];
  globe.mapTileTotalCount = tasks.length;
  let loadedCount = 0;
  let activeTileSourceName = globe.activeTileSourceName;

  await runTileTasks(tasks, GLOBE_TILE_CONCURRENCY, async (tile) => {
    if (requestId !== globe.mapTileRequestId) return;
    const result = await loadGlobeTileImage(tile);
    activeTileSourceName = result.sourceName || activeTileSourceName;
    const image = result.image;
    drawWebMercatorTileOnEquirect(context, image, tile.zoom, tile.x, tile.y);
    loadedCount += 1;
    globe.mapTileLoadedCount = loadedCount;
    if (loadedCount === 1 || loadedCount % 16 === 0 || loadedCount === tasks.length) {
      setGlobeMapStatus(`正在加载真实地图 L${detail.displayZoom} (${activeTileSourceName})... ${loadedCount}/${tasks.length}`);
    }
  });

  if (loadedCount === 0) {
    throw new Error("全部地图瓦片加载失败");
  }

  if (requestId !== globe.mapTileRequestId) {
    throw new Error("地图瓦片请求已过期");
  }

  overlayTextureGridAndFocus(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  globe.activeTileSourceName = activeTileSourceName;
  return { texture, loadedCount, totalCount: tasks.length };
}

function updateGlobeDetailLayers() {
  if (!globe.initialized) return;
  const showTiles = globe.cameraDistance <= GLOBE_DETAIL_TILE_DISTANCE;
  const showLabels = globe.cameraDistance <= GLOBE_LABEL_DISTANCE;
  if (globe.detailTileGroup) globe.detailTileGroup.visible = showTiles;
  if (globe.riverGroup) globe.riverGroup.visible = showLabels;
  if (globe.labelGroup) globe.labelGroup.visible = showLabels;
  if (!showTiles) return;
  if (globe.detailTileZoom === GLOBE_DETAIL_TILE_ZOOM || globe.detailTileLoadingZoom === GLOBE_DETAIL_TILE_ZOOM) return;

  globe.detailTileRequestId += 1;
  const requestId = globe.detailTileRequestId;
  globe.detailTileLoadingZoom = GLOBE_DETAIL_TILE_ZOOM;
  globe.detailTileLoadedCount = 0;
  globe.detailTileTotalCount = 0;
  setGlobeMapStatus(`正在加载近距地图 L${GLOBE_DETAIL_TILE_ZOOM}...`);

  buildGlobeDetailTileLayer(GLOBE_DETAIL_TILE_ZOOM, requestId)
    .then(({ loadedCount, totalCount, sourceName }) => {
      if (requestId !== globe.detailTileRequestId) return;
      globe.detailTileZoom = GLOBE_DETAIL_TILE_ZOOM;
      globe.detailTileLoadingZoom = 0;
      globe.detailTileLoadedCount = loadedCount;
      globe.detailTileTotalCount = totalCount;
      globe.activeDetailTileSourceName = sourceName;
      setGlobeMapStatus(`真实地图 L4 + 中国 L7 + 近距 ${sourceName} / ${loadedCount}/${totalCount} 瓦片`);
      syncGlobeDebugState();
    })
    .catch((error) => {
      if (requestId !== globe.detailTileRequestId) return;
      globe.detailTileLoadingZoom = 0;
      setGlobeMapStatus(`近距地图加载失败：${error.message || String(error)}`);
      syncGlobeDebugState();
    });
}

async function buildGlobeDetailTileLayer(zoom, requestId) {
  const tasks = buildFocusTileTasks(zoom, CHINA_BOUNDS);
  globe.detailTileTotalCount = tasks.length;
  clearThreeGroup(globe.detailTileGroup);
  let loadedCount = 0;
  let sourceName = globe.activeDetailTileSourceName;

  await runTileTasks(tasks, 8, async (tile) => {
    if (requestId !== globe.detailTileRequestId) return;
    const result = await loadGlobeTileImage(tile, GLOBE_DETAIL_TILE_SOURCES, "detailTileSourceIndex");
    sourceName = result.sourceName || sourceName;
    const mesh = createGlobeTilePatch(result.image, tile);
    globe.detailTileGroup.add(mesh);
    loadedCount += 1;
    globe.detailTileLoadedCount = loadedCount;
    if (loadedCount === 1 || loadedCount % 32 === 0 || loadedCount === tasks.length) {
      setGlobeMapStatus(`正在加载近距地图 L${zoom} (${sourceName})... ${loadedCount}/${tasks.length}`);
    }
  });

  if (requestId !== globe.detailTileRequestId) {
    throw new Error("近距地图请求已过期");
  }
  if (loadedCount === 0) {
    throw new Error("全部近距地图瓦片加载失败");
  }
  return { loadedCount, totalCount: tasks.length, sourceName };
}

function createGlobeTilePatch(image, tile) {
  const THREE = window.THREE;
  const geometry = createGlobeTilePatchGeometry(tile, 8);
  const texture = new THREE.Texture(image);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
  );
}

function createGlobeTilePatchGeometry(tile, segments) {
  const THREE = window.THREE;
  const tileCount = 2 ** tile.zoom;
  const west = (tile.x / tileCount) * 360 - 180;
  const east = ((tile.x + 1) / tileCount) * 360 - 180;
  const north = tileYToLatitude(tile.y, tile.zoom);
  const south = tileYToLatitude(tile.y + 1, tile.zoom);
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let row = 0; row <= segments; row += 1) {
    const v = row / segments;
    const lat = north + (south - north) * v;
    for (let col = 0; col <= segments; col += 1) {
      const u = col / segments;
      const lon = west + (east - west) * u;
      const vector = lonLatToVector3(lon, lat, GLOBE_DETAIL_TILE_RADIUS);
      positions.push(vector.x, vector.y, vector.z);
      uvs.push(u, 1 - v);
    }
  }

  for (let row = 0; row < segments; row += 1) {
    for (let col = 0; col < segments; col += 1) {
      const a = row * (segments + 1) + col;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function tileTextureSizeForZoom(zoom) {
  if (zoom >= 7) return { width: 4096, height: 2048 };
  if (zoom >= 6) return { width: 3072, height: 1536 };
  if (zoom >= 5) return { width: 2560, height: 1280 };
  if (zoom >= 4) return { width: 2048, height: 1024 };
  if (zoom === 3) return { width: 1536, height: 768 };
  return { width: 1024, height: 512 };
}

function buildGlobalTileTasks(zoom) {
  const tileCount = 2 ** zoom;
  const tasks = [];
  for (let y = 0; y < tileCount; y += 1) {
    for (let x = 0; x < tileCount; x += 1) {
      tasks.push({ x, y, zoom });
    }
  }
  return tasks;
}

function buildFocusTileTasks(zoom, bounds) {
  if (!zoom) return [];
  const [[south, west], [north, east]] = bounds;
  const minX = clamp(lonToTileX(west, zoom), 0, 2 ** zoom - 1);
  const maxX = clamp(lonToTileX(east, zoom), 0, 2 ** zoom - 1);
  const minY = clamp(latToTileY(north, zoom), 0, 2 ** zoom - 1);
  const maxY = clamp(latToTileY(south, zoom), 0, 2 ** zoom - 1);
  const tasks = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      tasks.push({ x, y, zoom, focus: true });
    }
  }
  return tasks;
}

function lonToTileX(lon, zoom) {
  return Math.floor(((Number(lon) + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat, zoom) {
  const latRadians = (Number(lat) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(latRadians) + 1 / Math.cos(latRadians)) / Math.PI) / 2) * 2 ** zoom);
}

async function runTileTasks(tasks, concurrency, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (index < tasks.length) {
      const task = tasks[index];
      index += 1;
      try {
        await worker(task);
      } catch {
        // Missing map tiles should not break the whole globe; the fallback texture remains underneath.
      }
    }
  });
  await Promise.all(workers);
}

function loadGlobeTileImage(tile, sources = GLOBE_TILE_SOURCES, sourceIndexKey = "tileSourceIndex") {
  const subdomain = GLOBE_TILE_SUBDOMAINS[(tile.x + tile.y) % GLOBE_TILE_SUBDOMAINS.length];
  const sourceIndex = Number(globe[sourceIndexKey] || 0);

  const orderedSources = [
    ...sources.slice(sourceIndex),
    ...sources.slice(0, sourceIndex),
  ];

  return (async () => {
    let lastError = null;
    for (const source of orderedSources) {
      try {
        const image = await loadGlobeTileImageFromSource(source, tile, subdomain);
        const nextSourceIndex = sources.findIndex((item) => item.name === source.name);
        if (nextSourceIndex >= 0) {
          globe[sourceIndexKey] = nextSourceIndex;
        }
        return { image, sourceName: source.name };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`瓦片加载失败: ${tile.zoom}/${tile.x}/${tile.y}`);
  })();
}

function loadGlobeTileImageFromSource(source, tile, subdomain) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`瓦片加载失败(${source.name}): ${tile.zoom}/${tile.x}/${tile.y}`));
    image.src = source.buildTileUrl(tile, subdomain);
  });
}

function drawWebMercatorTileOnEquirect(context, image, zoom, x, y) {
  const tileCount = 2 ** zoom;
  const west = (x / tileCount) * 360 - 180;
  const east = ((x + 1) / tileCount) * 360 - 180;
  const north = tileYToLatitude(y, zoom);
  const south = tileYToLatitude(y + 1, zoom);
  const topLeft = projectTextureCoordinate(west, north, context.canvas);
  const bottomRight = projectTextureCoordinate(east, south, context.canvas);
  const width = Math.max(1, bottomRight.x - topLeft.x);
  const height = Math.max(1, bottomRight.y - topLeft.y);
  context.drawImage(image, topLeft.x, topLeft.y, width, height);
}

function tileYToLatitude(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function createEarthTexture(baseMapPayload) {
  const THREE = window.THREE;
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 768;
  const context = canvas.getContext("2d");
  drawEarthTextureBase(context, baseMapPayload);
  overlayTextureGridAndFocus(context);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function drawEarthTextureBase(context, baseMapPayload) {
  const canvas = context.canvas;
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#06152d");
  gradient.addColorStop(0.45, "#0b2c5e");
  gradient.addColorStop(1, "#071327");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawOceanTexture(context);
  if (baseMapPayload) {
    drawBaseMapTexture(context, baseMapPayload);
  }

  const glow = context.createRadialGradient(canvas.width * 0.64, canvas.height * 0.35, 40, canvas.width * 0.64, canvas.height * 0.35, 420);
  glow.addColorStop(0, "rgba(48, 228, 255, 0.22)");
  glow.addColorStop(0.45, "rgba(22, 116, 232, 0.12)");
  glow.addColorStop(1, "rgba(22, 116, 232, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function overlayTextureGridAndFocus(context) {
  const canvas = context.canvas;
  context.strokeStyle = "rgba(158, 224, 255, 0.14)";
  context.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 15) {
    const x = ((lon + 180) / 360) * canvas.width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = ((90 - lat) / 180) * canvas.height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.strokeStyle = "rgba(178, 243, 255, 0.34)";
  context.lineWidth = 2;
  drawTextureFocusLine(context, [
    [73, 18],
    [135, 18],
    [135, 54],
    [73, 54],
    [73, 18],
  ]);
}

function drawOceanTexture(context) {
  const { width, height } = context.canvas;
  context.save();
  context.globalAlpha = 0.34;
  for (let band = 0; band < 18; band += 1) {
    const y = ((band + 0.5) / 18) * height;
    const wave = Math.sin(band * 1.7) * 18;
    const gradient = context.createLinearGradient(0, y - 24, width, y + 24);
    gradient.addColorStop(0, "rgba(27, 140, 156, 0)");
    gradient.addColorStop(0.45, "rgba(60, 185, 162, 0.16)");
    gradient.addColorStop(1, "rgba(27, 140, 156, 0)");
    context.strokeStyle = gradient;
    context.lineWidth = 18 + (band % 3) * 5;
    context.beginPath();
    for (let x = -20; x <= width + 20; x += 24) {
      const offset = Math.sin(x * 0.012 + band * 0.85) * (18 + (band % 4) * 5);
      const px = x;
      const py = y + offset + wave;
      if (x === -20) {
        context.moveTo(px, py);
      } else {
        context.lineTo(px, py);
      }
    }
    context.stroke();
  }
  context.restore();
}

function drawBaseMapTexture(context, payload) {
  const features = Array.isArray(payload.features) ? payload.features : [];
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  features.forEach((feature) => {
    drawTextureGeometry(context, feature.geometry, "rgba(45, 132, 91, 0.82)", "rgba(214, 255, 248, 0.34)", 1);
  });

  context.globalCompositeOperation = "screen";
  features.forEach((feature) => {
    drawTextureGeometry(context, feature.geometry, "rgba(54, 172, 112, 0.16)", "rgba(235, 255, 252, 0.68)", 0.78);
  });
  context.restore();
}

function drawTextureGeometry(context, geometry, fillStyle, strokeStyle, lineWidth) {
  const polygons = geometryToPolygons(geometry);
  polygons.forEach((polygon) => {
    polygon.forEach((ring, ringIndex) => {
      const clean = normalizeGlobeRing(ring);
      if (clean.length < 3) return;
      drawTextureRing(context, clean);
      if (ringIndex === 0) {
        context.fillStyle = fillStyle;
        context.fill();
      }
      context.strokeStyle = strokeStyle;
      context.lineWidth = lineWidth;
      context.stroke();
    });
  });
}

function drawTextureFocusLine(context, ring) {
  context.beginPath();
  ring.forEach(([lon, lat], index) => {
    const { x, y } = projectTextureCoordinate(lon, lat, context.canvas);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
}

function drawTextureRing(context, ring) {
  context.beginPath();
  let started = false;
  let previous = null;
  ring.forEach(([lon, lat]) => {
    if (previous && Math.abs(lon - previous[0]) > 180) {
      started = false;
    }
    const { x, y } = projectTextureCoordinate(lon, lat, context.canvas);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
    previous = [lon, lat];
  });
  context.closePath();
}

function projectTextureCoordinate(lon, lat, canvas) {
  return {
    x: ((Number(lon) + 180) / 360) * canvas.width,
    y: ((90 - Number(lat)) / 180) * canvas.height,
  };
}

function createGlobeBoundaryLayer(payload) {
  const THREE = window.THREE;
  const features = Array.isArray(payload.features) ? payload.features : [];
  const positions = [];
  features.forEach((feature) => {
    geometryToPolygons(feature.geometry).forEach((polygon) => {
      polygon.forEach((ring) => {
        appendGlobeBoundarySegments(positions, normalizeGlobeRing(ring), GLOBE_RADIUS * 1.014);
      });
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const group = new THREE.Group();
  group.add(
    new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xd9fbff,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  );

  const haloGeometry = geometry.clone();
  group.add(
    new THREE.LineSegments(
      haloGeometry,
      new THREE.LineBasicMaterial({
        color: 0x4de7ff,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  );
  return group;
}

function appendGlobeBoundarySegments(positions, ring, radius) {
  if (!Array.isArray(ring) || ring.length < 2) return;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    if (!current || !next || Math.abs(current[0] - next[0]) > 180) continue;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(current[0] - next[0]), Math.abs(current[1] - next[1])) / 3));
    for (let step = 0; step < steps; step += 1) {
      const startT = step / steps;
      const endT = (step + 1) / steps;
      const start = [
        current[0] + (next[0] - current[0]) * startT,
        current[1] + (next[1] - current[1]) * startT,
      ];
      const end = [
        current[0] + (next[0] - current[0]) * endT,
        current[1] + (next[1] - current[1]) * endT,
      ];
      const startVector = lonLatToVector3(start[0], start[1], radius);
      const endVector = lonLatToVector3(end[0], end[1], radius);
      positions.push(startVector.x, startVector.y, startVector.z, endVector.x, endVector.y, endVector.z);
    }
  }
}

function createGlobeGrid() {
  const THREE = window.THREE;
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0x8be8ff,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  for (let lat = -60; lat <= 60; lat += 15) {
    group.add(createGlobeLine(buildLatitudeRing(lat), material, GLOBE_RADIUS * 1.003));
  }
  for (let lon = -180; lon < 180; lon += 15) {
    group.add(createGlobeLine(buildLongitudeRing(lon), material, GLOBE_RADIUS * 1.003));
  }
  return group;
}

function createChinaExtentLine() {
  const THREE = window.THREE;
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  const [[south, west], [north, east]] = CHINA_BOUNDS;
  const ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return createGlobeLine(interpolateLonLatRing(ring, 14), material, GLOBE_RADIUS * 1.012);
}

function createGlobeRiverLayer() {
  const THREE = window.THREE;
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0x56dfff,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  GLOBE_RIVER_LINES.forEach((river) => {
    group.add(createGlobeLine(interpolateLonLatPath(river.coordinates, 12), material, GLOBE_RADIUS * 1.025));
    group.add(createGlobeTextSprite(river.name, river.labelLon, river.labelLat, { type: "river" }));
  });
  group.visible = false;
  return group;
}

function createGlobeCityLabels() {
  const group = new THREE.Group();
  GLOBE_CITY_LABELS.forEach((city) => {
    group.add(createGlobeTextSprite(city.name, city.lon, city.lat, { weight: city.weight || 1 }));
  });
  group.visible = false;
  return group;
}

function createGlobeTextSprite(text, lon, lat, options = {}) {
  const THREE = window.THREE;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const fontSize = options.type === "river" ? 18 : 19;
  context.font = `700 ${fontSize}px sans-serif`;
  const textWidth = Math.ceil(context.measureText(text).width);
  canvas.width = Math.max(72, textWidth + 26);
  canvas.height = 34;
  context.font = `700 ${fontSize}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  if (options.type === "river") {
    context.fillStyle = "rgba(8, 36, 54, 0.58)";
    context.strokeStyle = "rgba(86, 223, 255, 0.52)";
  } else {
    context.fillStyle = "rgba(4, 15, 27, 0.62)";
    context.strokeStyle = "rgba(216, 251, 255, 0.42)";
  }
  roundedRect(context, 1.5, 4.5, canvas.width - 3, canvas.height - 9, 8);
  context.fill();
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = options.type === "river" ? "#9ff3ff" : "#f4ffff";
  context.shadowColor = "rgba(0, 0, 0, 0.65)";
  context.shadowBlur = 3;
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    })
  );
  const position = lonLatToVector3(lon, lat, GLOBE_RADIUS * (options.type === "river" ? 1.072 : 1.085));
  sprite.position.copy(position);
  const scale = (options.weight || 1) * (options.type === "river" ? 0.42 : 0.46);
  sprite.scale.set((canvas.width / canvas.height) * 0.06 * scale, 0.06 * scale, 1);
  return sprite;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createStarField() {
  const THREE = window.THREE;
  const count = 520;
  const positions = [];
  for (let index = 0; index < count; index += 1) {
    const radius = 18 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xd6f7ff,
      size: 0.035,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    })
  );
}

function buildLatitudeRing(lat) {
  const ring = [];
  for (let lon = -180; lon <= 180; lon += 3) {
    ring.push([lon, lat]);
  }
  return ring;
}

function buildLongitudeRing(lon) {
  const ring = [];
  for (let lat = -90; lat <= 90; lat += 3) {
    ring.push([lon, lat]);
  }
  return ring;
}

function interpolateLonLatRing(ring, segmentsPerEdge) {
  const points = [];
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [lonA, latA] = ring[index];
    const [lonB, latB] = ring[index + 1];
    for (let step = 0; step < segmentsPerEdge; step += 1) {
      const t = step / segmentsPerEdge;
      points.push([lonA + (lonB - lonA) * t, latA + (latB - latA) * t]);
    }
  }
  points.push(ring[ring.length - 1]);
  return points;
}

function interpolateLonLatPath(path, segmentsPerEdge) {
  const points = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const [lonA, latA] = path[index];
    const [lonB, latB] = path[index + 1];
    for (let step = 0; step < segmentsPerEdge; step += 1) {
      const t = step / segmentsPerEdge;
      points.push([lonA + (lonB - lonA) * t, latA + (latB - latA) * t]);
    }
  }
  points.push(path[path.length - 1]);
  return points;
}

function createGlobeLine(ring, material, radius) {
  const THREE = window.THREE;
  const positions = [];
  ring.forEach(([lon, lat]) => {
    const vector = lonLatToVector3(lon, lat, radius);
    positions.push(vector.x, vector.y, vector.z);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Line(geometry, material);
}

function renderGlobeWeather(payload, sourceName) {
  if (!ensureGlobe()) return;
  clearThreeGroup(globe.weatherGroup);
  const features = Array.isArray(payload?.features) ? payload.features : [];
  features.forEach((feature) => addGlobeFeature(feature));
  renderGlobeWatchMarker();
  updateGlobeHud(payload, sourceName);
}

function addGlobeFeature(feature) {
  const rings = geometryToOuterRings(feature.geometry);
  rings.forEach((ring) => addGlobeRing(feature, ring));
}

function addGlobeRing(feature, ring) {
  const THREE = window.THREE;
  const clean = normalizeGlobeRing(ring);
  if (clean.length < 3) return;
  const sampled = sampleGlobeRing(clean, GLOBE_MAX_RING_POINTS);
  const center = centroidLonLat(sampled);
  const color = new THREE.Color(featureColor(feature));
  const severity = severityRank(feature);
  const fillPositions = [];
  const centerVector = lonLatToVector3(center.lon, center.lat, GLOBE_RADIUS * 1.016);
  for (let index = 0; index < sampled.length; index += 1) {
    const current = sampled[index];
    const next = sampled[(index + 1) % sampled.length];
    const currentVector = lonLatToVector3(current[0], current[1], GLOBE_RADIUS * 1.016);
    const nextVector = lonLatToVector3(next[0], next[1], GLOBE_RADIUS * 1.016);
    fillPositions.push(
      centerVector.x,
      centerVector.y,
      centerVector.z,
      currentVector.x,
      currentVector.y,
      currentVector.z,
      nextVector.x,
      nextVector.y,
      nextVector.z
    );
  }

  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
  fillGeometry.computeVertexNormals();
  const fillMesh = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: severity >= 7 ? Math.min(0.62, state.opacity + 0.08) : Math.min(0.46, state.opacity * 0.72),
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  globe.weatherGroup.add(fillMesh);

  const outlineRing = [...sampled, sampled[0]];
  globe.weatherGroup.add(
    createGlobeLine(
      outlineRing,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: severity >= 7 ? 0.94 : 0.72,
        depthWrite: false,
      }),
      GLOBE_RADIUS * 1.021
    )
  );

  const marker = createGlobeFeatureMarker(center, color, severity);
  globe.weatherGroup.add(marker);
}

function createGlobeFeatureMarker(center, color, severity) {
  const THREE = window.THREE;
  const group = new THREE.Group();
  const normal = lonLatToVector3(center.lon, center.lat, 1).normalize();
  const position = normal.clone().multiplyScalar(GLOBE_RADIUS * 1.05);
  const markerSize = severity >= 8 ? 0.034 : severity >= 7 ? 0.026 : 0.018;
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(markerSize, 14, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  marker.position.copy(position);
  group.add(marker);

  if (severity >= 7) {
    const lineGeometry = new THREE.BufferGeometry();
    const start = normal.clone().multiplyScalar(GLOBE_RADIUS * 1.02);
    const end = normal.clone().multiplyScalar(GLOBE_RADIUS * 1.15);
    lineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([start.x, start.y, start.z, end.x, end.y, end.z], 3)
    );
    group.add(
      new THREE.Line(
        lineGeometry,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
        })
      )
    );
  }
  return group;
}

function renderGlobeWatchMarker() {
  if (!globe.initialized || !globe.watchGroup) return;
  clearThreeGroup(globe.watchGroup);
  if (!state.watchPoint) return;
  const THREE = window.THREE;
  const hit = state.locationAnalysis?.status === "hit";
  const color = new THREE.Color(hit ? "#ff9f1c" : "#55f1ff");
  const normal = lonLatToVector3(state.watchPoint.lon, state.watchPoint.lat, 1).normalize();
  const position = normal.clone().multiplyScalar(GLOBE_RADIUS * 1.078);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 18, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  marker.position.copy(position);
  globe.watchGroup.add(marker);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.075, 0.004, 8, 64),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  ring.position.copy(normal.clone().multiplyScalar(GLOBE_RADIUS * 1.075));
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  globe.watchGroup.add(ring);
}

function updateGlobeHud(payload, sourceName) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const severeCount = features.filter((feature) => severityRank(feature) >= 7).length;
  const label = parseDisplayTime(payload, sourceName);
  globeHud.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(
    String(features.length)
  )} 个风区 / ${escapeHtml(String(severeCount))} 个 7级以上</strong>`;
}

function clearThreeGroup(group) {
  if (!group) return;
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    disposeThreeObject(child);
  }
}

function disposeThreeObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => disposeThreeMaterial(material));
    } else {
      disposeThreeMaterial(child.material);
    }
  });
}

function disposeThreeMaterial(material) {
  if (!material) return;
  material.map?.dispose?.();
  material.dispose?.();
}

function lonLatToVector3(lon, lat, radius) {
  const THREE = window.THREE;
  const phi = ((90 - Number(lat)) * Math.PI) / 180;
  const theta = ((Number(lon) + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function geometryToOuterRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return Array.isArray(geometry.coordinates?.[0]) ? [geometry.coordinates[0]] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || [])
      .map((polygon) => polygon?.[0])
      .filter((ring) => Array.isArray(ring) && ring.length);
  }
  return [];
}

function normalizeGlobeRing(ring) {
  const clean = ring
    .map((coordinate) => [Number(coordinate?.[0]), Number(coordinate?.[1])])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (clean.length > 1) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      clean.pop();
    }
  }
  return clean;
}

function sampleGlobeRing(ring, maxPoints) {
  if (ring.length <= maxPoints) return ring;
  const step = Math.ceil(ring.length / maxPoints);
  return ring.filter((_, index) => index % step === 0);
}

function centroidLonLat(ring) {
  const total = ring.reduce(
    (result, coordinate) => ({
      lon: result.lon + Number(coordinate[0]),
      lat: result.lat + Number(coordinate[1]),
    }),
    { lon: 0, lat: 0 }
  );
  return {
    lon: total.lon / ring.length,
    lat: total.lat / ring.length,
  };
}

async function loadDefaultGeoJson() {
  setStatus("正在加载默认风区 GeoJSON...", "");
  const response = await fetch(DEFAULT_GEOJSON_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`加载失败: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  renderGeoJson(payload, DEFAULT_GEOJSON_URL);
}

async function initializeTimeline() {
  setStatus("正在加载大风过程清单...", TIMELINE_MANIFEST_URL);
  try {
    const response = await fetch(TIMELINE_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`清单加载失败: ${response.status} ${response.statusText}`);
    }
    timelineManifest = await response.json();
    hourlyWindCases = normalizeTimelineItems(timelineManifest.items || [], response.url);
    if (!hourlyWindCases.length) {
      throw new Error("清单中没有可播放时次");
    }
    const defaultIndex = Math.max(
      0,
      Math.min(hourlyWindCases.length - 1, Number(timelineManifest.defaultIndex || 0))
    );
    setupTimelineControls(defaultIndex);
    renderProcessOverview(timelineManifest);
    updateShareSummary();
    await loadTimelineCase(defaultIndex);
    analyzeCityImpactLeaderboard();
  } catch (error) {
    renderProcessOverview(null);
    setupTimelineControls(0);
    renderCityImpactUnavailable("暂无城市影响榜。");
    setStatus("大风过程清单加载失败，正在加载默认 GeoJSON。", error.message || String(error));
    await loadDefaultGeoJson();
  }
}

function normalizeTimelineItems(items, manifestUrl) {
  return items.map((item) => ({
    ...item,
    geojsonUrl: new URL(item.geojsonUrl, manifestUrl).href,
    imageUrl: item.imageUrl ? new URL(item.imageUrl, manifestUrl).href : "",
    downloadName: item.downloadName || `${item.id || "nmc-wind"}.geojson`,
  }));
}

function setupTimelineControls(defaultIndex) {
  const hasCases = hourlyWindCases.length > 0;
  timelineSlider.disabled = !hasCases;
  playTimelineButton.disabled = !hasCases;
  jumpPeakTime.disabled = !hasCases;
  refreshCityImpact.disabled = !hasCases;
  timelineSlider.max = String(Math.max(0, hourlyWindCases.length - 1));
  timelineSlider.value = String(defaultIndex);
  renderTimelineTicks(defaultIndex);
  renderTrendChart(defaultIndex);
}

function renderProcessOverview(manifest) {
  const summary = manifest?.summary;
  if (!summary) {
    processOverview.textContent = "暂无过程清单。";
    return;
  }
  processOverview.innerHTML = [
    overviewItem("时段", `${summary.startLabel} - ${summary.endLabel}`),
    overviewItem("峰值时次", `${summary.peakRegionTime} / ${summary.peakRegionCount}区`),
    overviewItem("7级以上峰值", `${summary.peakSevereTime} / ${summary.peakSevereCount}区`),
  ].join("");
}

function overviewItem(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

async function processImageUrl(rawUrl) {
  const url = rawUrl.trim();
  if (!isProbablyHttpUrl(url)) {
    setStatus("URL 格式不正确。", "请输入 http:// 或 https:// 开头的图片地址。");
    return;
  }

  latestUrlRequestId += 1;
  const requestId = latestUrlRequestId;
  setProcessing(true);
  setSourceImage(url, "输入 URL 原图");
  setStatus("正在下载图片并识别风区...", url);

  try {
    const response = await fetch("/api/process-nmc-wind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `处理失败: ${response.status}`);
    }
    if (requestId !== latestUrlRequestId) return;
    renderGeoJson(payload, "URL 实时处理结果");
    const props = payload.properties || {};
    setSourceImage(props.local_image_url || url, "识别所用原图");
  } catch (error) {
    if (requestId === latestUrlRequestId) {
      setStatus("URL 处理失败。", error.message || String(error));
    }
  } finally {
    if (requestId === latestUrlRequestId) {
      setProcessing(false);
    }
  }
}

async function loadTimelineCase(index) {
  if (!hourlyWindCases.length) return;
  const boundedIndex = Math.max(0, Math.min(hourlyWindCases.length - 1, index));
  const item = hourlyWindCases[boundedIndex];
  timelineRequestId += 1;
  const requestId = timelineRequestId;
  timelineSlider.value = String(boundedIndex);
  updateTimelineActiveTick(boundedIndex);
  updateTrendActiveTick(boundedIndex);
  updateWatchSeriesActiveTick(boundedIndex);
  setStatus(`正在加载 ${item.label} 风区...`, item.geojsonUrl);

  try {
    const payload = await loadTimelineGeoJson(item);
    if (requestId !== timelineRequestId) return;
    renderGeoJson(payload, item.label, { filename: item.downloadName });
    setSourceImage(item.imageUrl, `${item.label} 原图`);
  } catch (error) {
    if (requestId === timelineRequestId) {
      setStatus(`${item.label} 加载失败。`, error.message || String(error));
    }
  }
}

async function loadTimelineGeoJson(item) {
  if (timelineGeoJsonCache.has(item.geojsonUrl)) {
    return timelineGeoJsonCache.get(item.geojsonUrl);
  }
  const response = await fetch(item.geojsonUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`加载失败: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  timelineGeoJsonCache.set(item.geojsonUrl, payload);
  return payload;
}

function toggleTimelinePlayback() {
  if (timelineTimer) {
    window.clearInterval(timelineTimer);
    timelineTimer = null;
    playTimelineButton.textContent = "播放";
    return;
  }

  playTimelineButton.textContent = "暂停";
  timelineTimer = window.setInterval(() => {
    if (!hourlyWindCases.length) return;
    const nextIndex = (Number(timelineSlider.value) + 1) % hourlyWindCases.length;
    loadTimelineCase(nextIndex);
  }, 1300);
}

function renderGeoJson(payload, sourceName, options = {}) {
  if (state.overlayLayer) {
    state.overlayLayer.remove();
  }

  currentGeoJsonPayload = payload;
  currentGeoJsonFilename = options.filename || buildGeoJsonFilename(payload, sourceName);
  downloadGeoJsonButton.disabled = false;

  state.overlayLayer = L.geoJSON(payload, {
    style: styleFeature,
    onEachFeature: bindPopup,
  }).addTo(map);
  renderGlobeWeather(payload, sourceName);

  state.overlayBounds = state.overlayLayer.getBounds();
  fitOverlay();

  const features = Array.isArray(payload.features) ? payload.features : [];
  const counts = summarize(features);
  const countText = Object.entries(counts)
    .map(([label, count]) => `${label}: ${count}`)
    .join("；");
  const props = payload.properties || {};
  const residualText = props.control_point_mean_residual_m
    ? `｜控制点平均残差 ${Number(props.control_point_mean_residual_m / 1000).toFixed(1)}km`
    : "";
  const segmentationText = props.segmentation
    ? `｜精细识别 minArea=${props.segmentation.min_area_px}, epsilon=${
        props.segmentation.simplify_epsilon
      }, close=${props.segmentation.morph_close ? props.segmentation.morph_kernel_size : "off"}`
    : "";
  const urlText = props.source_url ? `｜${props.source_url}` : "";
  setStatus(
    `已加载 ${features.length} 个区域。`,
    `${sourceName}｜${countText}${residualText}${segmentationText}${urlText}`
  );
  updateStats(payload, sourceName);
  analyzeCurrentWatchPoint({ fit: false });
  updateShareSummary();
}

function downloadCurrentGeoJson() {
  if (!currentGeoJsonPayload) return;
  const text = JSON.stringify(currentGeoJsonPayload, null, 2);
  const blob = new Blob([`${text}\n`], { type: "application/geo+json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = currentGeoJsonFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildGeoJsonFilename(payload, sourceName) {
  const props = payload?.properties || {};
  const sourceUrl = String(props.source_url || "");
  const timestampMatch = sourceUrl.match(/PB_(\d{12})\d*\.jpg/i);
  if (timestampMatch) {
    return `nmc-wind-${timestampMatch[1]}.geojson`;
  }

  const sourceText = String(sourceName || "");
  const fileName = sourceText.split(/[\\/]/).pop();
  if (fileName && /\.(geo)?json$/i.test(fileName)) {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  return `weather-wind-regions-${stamp}.geojson`;
}

function renderTimelineTicks(activeIndex = Number(timelineSlider.value) || 0) {
  timelineTicks.innerHTML = hourlyWindCases.map(
    (item, index) =>
      `<button type="button" data-index="${index}" class="${index === activeIndex ? "is-active" : ""}">${escapeHtml(
        item.label.slice(6)
      )}</button>`
  ).join("");
}

function updateTimelineActiveTick(index) {
  timelineTicks.querySelectorAll("button[data-index]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.index) === index);
  });
}

function renderTrendChart(activeIndex = Number(timelineSlider.value) || 0) {
  if (!hourlyWindCases.length) {
    trendChart.textContent = "暂无趋势数据。";
    trendDetail.textContent = "等待过程清单。";
    return;
  }

  const width = 320;
  const height = 148;
  const padding = { top: 14, right: 14, bottom: 30, left: 30 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const countMax = Math.max(
    1,
    ...hourlyWindCases.map((item) => Math.max(Number(item.regionCount || 0), Number(item.severeCount || 0)))
  );
  const areaMax = Math.max(1, ...hourlyWindCases.map((item) => Number(item.totalAreaPx || 0)));
  const xAt = (index) =>
    padding.left + (hourlyWindCases.length === 1 ? plotWidth / 2 : (index * plotWidth) / (hourlyWindCases.length - 1));
  const yCountAt = (value) => padding.top + plotHeight - (Number(value || 0) / countMax) * plotHeight;
  const yAreaAt = (value) => padding.top + plotHeight - (Number(value || 0) / areaMax) * plotHeight;
  const regionPoints = hourlyWindCases
    .map((item, index) => `${xAt(index).toFixed(1)},${yCountAt(item.regionCount).toFixed(1)}`)
    .join(" ");
  const severePoints = hourlyWindCases
    .map((item, index) => `${xAt(index).toFixed(1)},${yCountAt(item.severeCount).toFixed(1)}`)
    .join(" ");
  const barWidth = Math.max(8, plotWidth / hourlyWindCases.length / 2.4);

  trendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="风区数量、7级以上数量和面积趋势">
      <line class="trend-axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${
        padding.left + plotWidth
      }" y2="${padding.top + plotHeight}" />
      <line class="trend-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${
        padding.top + plotHeight
      }" />
      <text class="trend-axis-label" x="0" y="${padding.top + 4}">${escapeHtml(String(countMax))}</text>
      <text class="trend-axis-label" x="8" y="${padding.top + plotHeight + 4}">0</text>
      ${hourlyWindCases
        .map((item, index) => {
          const x = xAt(index);
          const y = yAreaAt(item.totalAreaPx);
          const heightValue = padding.top + plotHeight - y;
          return `<rect class="trend-area-bar" data-trend-index="${index}" x="${(x - barWidth / 2).toFixed(
            1
          )}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${heightValue.toFixed(1)}">
            <title>${escapeHtml(item.label)} 面积 ${escapeHtml(formatAreaPx(item.totalAreaPx))}</title>
          </rect>`;
        })
        .join("")}
      <polyline class="trend-line trend-region-line" points="${regionPoints}" />
      <polyline class="trend-line trend-severe-line" points="${severePoints}" />
      ${hourlyWindCases
        .map((item, index) => {
          const x = xAt(index);
          const regionY = yCountAt(item.regionCount);
          const severeY = yCountAt(item.severeCount);
          const activeClass = index === activeIndex ? " is-active" : "";
          return `
            <line class="trend-hour-line${activeClass}" data-trend-index="${index}" x1="${x.toFixed(
              1
            )}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${padding.top + plotHeight}" />
            <circle class="trend-point trend-region-point${activeClass}" data-trend-index="${index}" cx="${x.toFixed(
              1
            )}" cy="${regionY.toFixed(1)}" r="${index === activeIndex ? 4.8 : 3.5}">
              <title>${escapeHtml(item.label)} 风区 ${escapeHtml(String(item.regionCount || 0))}</title>
            </circle>
            <circle class="trend-point trend-severe-point${activeClass}" data-trend-index="${index}" cx="${x.toFixed(
              1
            )}" cy="${severeY.toFixed(1)}" r="${index === activeIndex ? 4.5 : 3.2}">
              <title>${escapeHtml(item.label)} 7级以上 ${escapeHtml(String(item.severeCount || 0))}</title>
            </circle>
            <text class="trend-time-label" data-trend-index="${index}" x="${x.toFixed(1)}" y="${height - 9}">${escapeHtml(
              item.label.slice(6, 8)
            )}</text>
          `;
        })
        .join("")}
    </svg>
  `;
  updateTrendActiveTick(activeIndex);
}

function updateTrendActiveTick(index) {
  if (!hourlyWindCases.length) return;
  trendChart.querySelectorAll("[data-trend-index]").forEach((element) => {
    element.classList.toggle("is-active", Number(element.dataset.trendIndex) === index);
  });
  const item = hourlyWindCases[index];
  if (!item) return;
  trendDetail.innerHTML = `<strong>${escapeHtml(item.label)}</strong><span>风区 ${escapeHtml(
    String(item.regionCount ?? "--")
  )}</span><span>7级以上 ${escapeHtml(String(item.severeCount ?? "--"))}</span><span>面积 ${escapeHtml(
    formatAreaPx(item.totalAreaPx)
  )}</span>`;
}

function getPeakTimelineIndex(metricName) {
  if (!hourlyWindCases.length) return -1;
  return hourlyWindCases.reduce(
    (bestIndex, item, index) =>
      Number(item[metricName] || 0) > Number(hourlyWindCases[bestIndex]?.[metricName] || 0) ? index : bestIndex,
    0
  );
}

function formatAreaPx(value) {
  const number = Number(value || 0);
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万px`;
  return `${Math.round(number)}px`;
}

function updateShareSummary() {
  currentShareSummary = buildShareSummaryText();
  shareSummaryText.textContent = currentShareSummary;
  copyShareSummary.disabled = !currentShareSummary || currentShareSummary === "等待过程数据。";
  shareCopyStatus.textContent = "";
}

function buildShareSummaryText() {
  const lines = [];
  const summary = timelineManifest?.summary;
  const title = timelineManifest?.title || "大风过程";

  if (summary) {
    lines.push(
      `${title}：${summary.startLabel}-${summary.endLabel}，风区峰值出现在${summary.peakRegionTime}（${summary.peakRegionCount}区），7级以上峰值出现在${summary.peakSevereTime}（${summary.peakSevereCount}区）。`
    );
  }

  if (statTime.textContent && statTime.textContent !== "--") {
    lines.push(
      `当前查看 ${statTime.textContent}：识别风区 ${statRegions.textContent || "--"} 个，其中 7级以上 ${
        statSevere.textContent || "--"
      } 个。`
    );
  }

  const affectedCities = cityImpactResults.filter((result) => result.hitCount > 0);
  if (affectedCities.length) {
    const topCity = affectedCities[0];
    lines.push(`城市影响榜：${affectedCities.length} 个重点城市被覆盖，${topCity.city.name} 覆盖 ${topCity.hitCount} 小时。`);
  } else if (cityImpactResults.length) {
    const nearestCity = cityImpactResults[0];
    lines.push(`城市影响榜：重点城市暂无覆盖，${nearestCity.city.name} 距风区最近约 ${formatDistance(nearestCity.nearestDistanceMeters)}。`);
  }

  const watchName = getWatchPointDisplayName();
  const processText = compactText(watchProcessSummary.textContent);
  const currentWatchText = compactText(watchPointResult.textContent);
  if (watchName && processText && !isPlaceholderText(processText)) {
    lines.push(`关注地点 ${watchName}：${processText}。`);
  } else if (watchName && currentWatchText && !isPlaceholderText(currentWatchText)) {
    lines.push(`关注地点 ${watchName}：${currentWatchText}。`);
  }

  if (!lines.length) {
    return "等待过程数据。";
  }
  lines.push("注：该结果由天气图色块识别生成，适合过程复盘、展示和人工校对。");
  return lines.join("\n");
}

function getWatchPointDisplayName() {
  if (watchCitySelect.value && watchCitySelect.value !== "custom") {
    const option = watchCitySelect.options[watchCitySelect.selectedIndex];
    return option?.textContent || "";
  }
  const lon = Number(watchLonInput.value);
  const lat = Number(watchLatInput.value);
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return `${lon.toFixed(4)}, ${lat.toFixed(4)}`;
  }
  return "";
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPlaceholderText(value) {
  return /等待|正在|暂无/.test(value);
}

async function copyCurrentShareSummary() {
  if (!currentShareSummary || currentShareSummary === "等待过程数据。") return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(currentShareSummary);
    } else {
      fallbackCopyText(currentShareSummary);
    }
    shareCopyStatus.textContent = "已复制摘要。";
  } catch (error) {
    try {
      fallbackCopyText(currentShareSummary);
      shareCopyStatus.textContent = "已复制摘要。";
    } catch {
      shareCopyStatus.textContent = "复制失败，请手动选择文本。";
    }
  }
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) {
    throw new Error("copy command failed");
  }
}

function updateStats(payload, sourceName) {
  const features = Array.isArray(payload.features) ? payload.features : [];
  const severeCount = features.filter((feature) => {
    const label = feature?.properties?.label || "";
    return /level_(7|8|9|1[0-3])/.test(label);
  }).length;
  const pointCount = features.reduce((total, feature) => total + countCoordinates(feature?.geometry), 0);

  statTime.textContent = parseDisplayTime(payload, sourceName);
  statRegions.textContent = String(features.length);
  statSevere.textContent = String(severeCount);
  statPoints.textContent = String(pointCount);
}

async function analyzeCityImpactLeaderboard() {
  cityImpactRequestId += 1;
  const requestId = cityImpactRequestId;
  if (!hourlyWindCases.length) {
    renderCityImpactUnavailable("暂无城市影响榜。");
    return;
  }

  refreshCityImpact.disabled = true;
  cityImpactSummary.textContent = "正在扫描重点城市...";
  cityImpactList.innerHTML = "";

  try {
    const payloads = [];
    for (const item of hourlyWindCases) {
      payloads.push(await loadTimelineGeoJson(item));
    }
    if (requestId !== cityImpactRequestId) return;
    cityImpactResults = WATCH_CITIES.map((city) => summarizeCityImpact(city, payloads)).sort(compareCityImpact);
    renderCityImpactResults(cityImpactResults);
  } catch (error) {
    if (requestId === cityImpactRequestId) {
      renderCityImpactUnavailable(error.message || String(error));
    }
  } finally {
    if (requestId === cityImpactRequestId) {
      refreshCityImpact.disabled = !hourlyWindCases.length;
    }
  }
}

function summarizeCityImpact(city, payloads) {
  const point = { lon: city.lon, lat: city.lat };
  const hourlyResults = payloads.map((payload, index) => ({
    index,
    label: hourlyWindCases[index]?.label || `#${index + 1}`,
    analysis: analyzePointAgainstGeoJson(point, payload),
  }));
  const hits = hourlyResults.filter((result) => result.analysis.status === "hit");
  const nearest = hourlyResults.reduce((best, result) => {
    const distance = result.analysis.nearest?.distanceMeters;
    if (!Number.isFinite(distance)) return best;
    return !best || distance < best.analysis.nearest.distanceMeters ? result : best;
  }, null);
  const strongest = hits.reduce((best, result) => {
    const bestRank = best ? maxSeverityRank(best.analysis.hits) : -1;
    const currentRank = maxSeverityRank(result.analysis.hits);
    return currentRank > bestRank ? result : best;
  }, null);

  return {
    city,
    hitCount: hits.length,
    firstHitLabel: hits[0]?.label || "",
    lastHitLabel: hits[hits.length - 1]?.label || "",
    maxSeverity: strongest ? maxSeverityRank(strongest.analysis.hits) : 0,
    strongestLabel: strongest?.label || "",
    strongestSummary: strongest ? summarizeLabels(strongest.analysis.hits) : "",
    nearestLabel: nearest?.label || "",
    nearestDistanceMeters: nearest?.analysis.nearest?.distanceMeters ?? Infinity,
  };
}

function compareCityImpact(a, b) {
  if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
  if (b.maxSeverity !== a.maxSeverity) return b.maxSeverity - a.maxSeverity;
  return a.nearestDistanceMeters - b.nearestDistanceMeters;
}

function renderCityImpactUnavailable(message) {
  cityImpactResults = [];
  cityImpactSummary.textContent = message;
  cityImpactList.innerHTML = "";
}

function renderCityImpactResults(results) {
  const affected = results.filter((result) => result.hitCount > 0);
  if (affected.length) {
    const top = affected[0];
    cityImpactSummary.innerHTML = `<strong>${escapeHtml(String(affected.length))} 个城市被覆盖</strong><span>最明显 ${
      escapeHtml(top.city.name)
    } / ${escapeHtml(String(top.hitCount))} 小时</span>`;
  } else if (results.length) {
    const nearest = results[0];
    cityImpactSummary.innerHTML = `<strong>暂无城市被覆盖</strong><span>最近 ${escapeHtml(
      nearest.city.name
    )} / ${escapeHtml(formatDistance(nearest.nearestDistanceMeters))}</span>`;
  } else {
    cityImpactSummary.textContent = "暂无城市影响榜。";
  }

  cityImpactList.innerHTML = results
    .map((result, index) => cityImpactItemHtml(result, index))
    .join("");
  updateCityImpactActive(watchCitySelect.value);
  updateShareSummary();
}

function cityImpactItemHtml(result, index) {
  const isHit = result.hitCount > 0;
  const title = isHit
    ? `${result.hitCount}小时覆盖`
    : `最近 ${formatDistance(result.nearestDistanceMeters)}`;
  const detail = isHit
    ? `${result.firstHitLabel.slice(6)}-${result.lastHitLabel.slice(6)} / ${result.strongestSummary}`
    : `${result.nearestLabel.slice(6)} / 未覆盖`;
  return `<button type="button" data-city-id="${escapeHtml(result.city.id)}" class="${[
    "city-impact-item",
    isHit ? "is-hit" : "is-clear",
  ].join(" ")}">
    <span class="city-rank">${index + 1}</span>
    <span class="city-name">${escapeHtml(result.city.name)}</span>
    <strong>${escapeHtml(title)}</strong>
    <small>${escapeHtml(detail)}</small>
  </button>`;
}

function updateCityImpactActive(cityId) {
  cityImpactList.querySelectorAll("button[data-city-id]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.cityId === cityId);
  });
}

function selectWatchCity(cityId) {
  const city = WATCH_CITIES.find((item) => item.id === cityId);
  if (!city) return;
  watchCitySelect.value = city.id;
  setWatchInputs(city.lon, city.lat);
  updateCityImpactActive(city.id);
  analyzeCurrentWatchPoint({ fit: true });
}

function initializeWatchCities() {
  watchCitySelect.innerHTML = [
    '<option value="custom">自定义坐标</option>',
    ...WATCH_CITIES.map((city) => `<option value="${escapeHtml(city.id)}">${escapeHtml(city.name)}</option>`),
  ].join("");
  const defaultCity = WATCH_CITIES[0];
  watchCitySelect.value = defaultCity.id;
  setWatchInputs(defaultCity.lon, defaultCity.lat);
}

function setWatchInputs(lon, lat) {
  watchLonInput.value = Number(lon).toFixed(4);
  watchLatInput.value = Number(lat).toFixed(4);
}

function readWatchPoint() {
  const lon = Number(watchLonInput.value);
  const lat = Number(watchLatInput.value);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error("经纬度不完整。");
  }
  if (lon < 70 || lon > 140 || lat < 15 || lat > 55) {
    throw new Error("经纬度超出当前中国地图分析范围。");
  }
  return { lon, lat };
}

function analyzeCurrentWatchPoint(options = {}) {
  let point;
  try {
    point = readWatchPoint();
  } catch (error) {
    state.watchPoint = null;
    state.locationAnalysis = null;
    renderWatchResult(null, null, error.message || String(error));
    renderWatchSeriesError(error.message || String(error));
    clearLocationLayer();
    return;
  }

  state.watchPoint = point;
  if (!currentGeoJsonPayload) {
    state.locationAnalysis = null;
    renderWatchResult(point, null, "等待风区 GeoJSON。");
    renderLocationLayer(point, null, options);
    return;
  }

  const analysis = analyzePointAgainstGeoJson(point, currentGeoJsonPayload);
  state.locationAnalysis = analysis;
  renderWatchResult(point, analysis, "");
  renderLocationLayer(point, analysis, options);
  analyzeWatchPointSeries(point);
}

async function analyzeWatchPointSeries(point) {
  watchSeriesRequestId += 1;
  const requestId = watchSeriesRequestId;
  if (!hourlyWindCases.length) {
    renderWatchSeriesUnavailable("暂无逐小时过程数据。");
    return;
  }

  watchProcessSummary.textContent = "正在分析该地点的逐小时影响...";
  watchImpactTimeline.innerHTML = "";

  try {
    const results = [];
    for (let index = 0; index < hourlyWindCases.length; index += 1) {
      const item = hourlyWindCases[index];
      const payload = await loadTimelineGeoJson(item);
      const analysis = analyzePointAgainstGeoJson(point, payload);
      results.push({
        index,
        label: item.label,
        analysis,
      });
    }
    if (requestId !== watchSeriesRequestId) return;
    renderWatchSeriesResults(point, results);
  } catch (error) {
    if (requestId === watchSeriesRequestId) {
      renderWatchSeriesError(error.message || String(error));
    }
  }
}

function analyzePointAgainstGeoJson(point, payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const hits = features.filter((feature) => isPointInGeometry(point, feature.geometry));
  if (hits.length) {
    return {
      status: "hit",
      hits: hits.sort((a, b) => severityRank(b) - severityRank(a)),
      nearest: null,
    };
  }

  const nearest = features.reduce((result, feature) => {
    const distance = minDistanceToGeometryMeters(point, feature.geometry);
    if (!Number.isFinite(distance.meters)) return result;
    if (!result || distance.meters < result.distanceMeters) {
      return {
        feature,
        distanceMeters: distance.meters,
        nearestLatLng: distance.latlng,
      };
    }
    return result;
  }, null);

  return { status: "clear", hits: [], nearest };
}

function renderWatchResult(point, analysis, errorText) {
  watchPointResult.className = "watch-result";
  if (errorText) {
    watchPointResult.textContent = errorText;
    return;
  }
  if (!point || !analysis) {
    watchPointResult.textContent = "等待选择地点。";
    return;
  }

  const coordinateText = `${point.lon.toFixed(4)}, ${point.lat.toFixed(4)}`;
  if (analysis.status === "hit") {
    const hitSummary = summarizeLabels(analysis.hits);
    watchPointResult.classList.add("is-hit");
    watchPointResult.innerHTML = `<strong>受影响</strong><br>${escapeHtml(coordinateText)} 位于 ${escapeHtml(
      hitSummary
    )} 风区内。`;
    return;
  }

  watchPointResult.classList.add("is-clear");
  if (analysis.nearest) {
    const label = displayLevel(analysis.nearest.feature?.properties?.label || "风区");
    watchPointResult.innerHTML = `<strong>未覆盖</strong><br>${escapeHtml(coordinateText)} 距最近 ${escapeHtml(
      label
    )} 风区约 ${escapeHtml(formatDistance(analysis.nearest.distanceMeters))}。`;
  } else {
    watchPointResult.innerHTML = `<strong>未覆盖</strong><br>${escapeHtml(coordinateText)} 附近没有可分析风区。`;
  }
}

function renderWatchSeriesUnavailable(message) {
  watchProcessSummary.textContent = message;
  watchImpactTimeline.innerHTML = "";
  updateShareSummary();
}

function renderWatchSeriesError(message) {
  watchProcessSummary.textContent = message;
  watchImpactTimeline.innerHTML = "";
  updateShareSummary();
}

function renderWatchSeriesResults(point, results) {
  const hits = results.filter((result) => result.analysis.status === "hit");
  const nearest = results.reduce((best, result) => {
    const distance = result.analysis.nearest?.distanceMeters;
    if (!Number.isFinite(distance)) return best;
    return !best || distance < best.analysis.nearest.distanceMeters ? result : best;
  }, null);

  if (hits.length) {
    const strongest = hits.reduce((best, result) => {
      const bestRank = best ? maxSeverityRank(best.analysis.hits) : -1;
      const currentRank = maxSeverityRank(result.analysis.hits);
      return currentRank > bestRank ? result : best;
    }, null);
    watchProcessSummary.innerHTML = `<strong>过程影响 ${escapeHtml(String(hits.length))} 小时</strong><span>最强 ${
      strongest ? escapeHtml(strongest.label) : "--"
    } / ${escapeHtml(summarizeLabels(strongest?.analysis?.hits || []))}</span>`;
  } else if (nearest) {
    const label = displayLevel(nearest.analysis.nearest.feature?.properties?.label || "风区");
    watchProcessSummary.innerHTML = `<strong>过程未覆盖</strong><span>最近 ${escapeHtml(
      nearest.label
    )}，距 ${escapeHtml(label)} 约 ${escapeHtml(formatDistance(nearest.analysis.nearest.distanceMeters))}</span>`;
  } else {
    watchProcessSummary.innerHTML = "<strong>过程未覆盖</strong><span>没有可分析风区。</span>";
  }

  const activeIndex = Number(timelineSlider.value);
  watchImpactTimeline.innerHTML = results
    .map((result) => {
      const isHit = result.analysis.status === "hit";
      const isActive = result.index === activeIndex;
      const label = isHit
        ? summarizeLabels(result.analysis.hits)
        : result.analysis.nearest
          ? formatDistance(result.analysis.nearest.distanceMeters)
          : "无";
      return `<button type="button" data-watch-index="${result.index}" class="${[
        "watch-hour",
        isHit ? "is-hit" : "is-clear",
        isActive ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}">
        <span>${escapeHtml(result.label.slice(6))}</span>
        <strong>${escapeHtml(label)}</strong>
      </button>`;
    })
    .join("");
  updateShareSummary();
}

function updateWatchSeriesActiveTick(index) {
  watchImpactTimeline.querySelectorAll("button[data-watch-index]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.watchIndex) === index);
  });
}

function renderLocationLayer(point, analysis, options = {}) {
  clearLocationLayer();
  state.locationLayer = L.featureGroup().addTo(map);
  renderGlobeWatchMarker();

  const hit = analysis?.status === "hit";
  const marker = L.circleMarker([point.lat, point.lon], {
    radius: 7,
    color: hit ? "#d65914" : "#05738a",
    weight: 3,
    fillColor: hit ? "#f59e0b" : "#20b6ca",
    fillOpacity: 0.95,
  })
    .bindPopup(buildWatchPopup(point, analysis))
    .addTo(state.locationLayer);

  const highlightedFeatures = hit ? analysis.hits : analysis?.nearest?.feature ? [analysis.nearest.feature] : [];
  if (highlightedFeatures.length) {
    L.geoJSON(
      { type: "FeatureCollection", features: highlightedFeatures },
      {
        interactive: false,
        style: {
          color: hit ? "#d65914" : "#05738a",
          weight: hit ? 4 : 3,
          dashArray: hit ? "" : "5 4",
          fill: false,
          opacity: 0.95,
        },
      }
    ).addTo(state.locationLayer);
  }

  if (!hit && analysis?.nearest?.nearestLatLng) {
    L.polyline(
      [
        [point.lat, point.lon],
        [analysis.nearest.nearestLatLng.lat, analysis.nearest.nearestLatLng.lng],
      ],
      {
        color: "#05738a",
        weight: 2,
        dashArray: "3 4",
        opacity: 0.8,
      }
    ).addTo(state.locationLayer);
  }

  if (options.openPopup) {
    marker.openPopup();
  }
  if (options.fit) {
    const bounds = state.locationLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [42, 42], maxZoom: 8 });
    } else {
      map.setView([point.lat, point.lon], Math.max(map.getZoom(), 6));
    }
  }
}

function clearLocationLayer() {
  if (state.locationLayer) {
    state.locationLayer.remove();
    state.locationLayer = null;
  }
  renderGlobeWatchMarker();
}

function buildWatchPopup(point, analysis) {
  if (analysis?.status === "hit") {
    return `<strong>关注地点</strong><br>${escapeHtml(point.lon.toFixed(4))}, ${escapeHtml(
      point.lat.toFixed(4)
    )}<br>位于 ${escapeHtml(summarizeLabels(analysis.hits))} 风区内`;
  }
  const distance = analysis?.nearest ? formatDistance(analysis.nearest.distanceMeters) : "无";
  return `<strong>关注地点</strong><br>${escapeHtml(point.lon.toFixed(4))}, ${escapeHtml(
    point.lat.toFixed(4)
  )}<br>最近风区距离: ${escapeHtml(distance)}`;
}

function summarizeLabels(features) {
  const counts = features.reduce((result, feature) => {
    const label = displayLevel(feature?.properties?.label || "风区");
    result[label] = (result[label] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts)
    .map(([label, count]) => `${label}x${count}`)
    .join("、");
}

function displayLevel(label) {
  const match = String(label).match(/level_(\d+)/);
  return match ? `${match[1]}级` : String(label || "风区");
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "未知";
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(meters < 100000 ? 1 : 0)}km`;
}

function severityRank(feature) {
  const match = String(feature?.properties?.label || "").match(/level_(\d+)/);
  return match ? Number(match[1]) : 0;
}

function maxSeverityRank(features) {
  return features.reduce((maxRank, feature) => Math.max(maxRank, severityRank(feature)), 0);
}

function isPointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return isPointInPolygon(point, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => isPointInPolygon(point, polygon));
  }
  return false;
}

function isPointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return false;
  const [outerRing, ...holes] = polygon;
  if (!isPointInRing(point, outerRing)) return false;
  return !holes.some((ring) => isPointInRing(point, ring));
}

function isPointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  const x = point.lon;
  const y = point.lat;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const current = ring[i];
    const previous = ring[j];
    if (!Array.isArray(current) || !Array.isArray(previous)) continue;
    const xi = Number(current[0]);
    const yi = Number(current[1]);
    const xj = Number(previous[0]);
    const yj = Number(previous[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function minDistanceToGeometryMeters(point, geometry) {
  const polygons = geometryToPolygons(geometry);
  return polygons.reduce(
    (best, polygon) =>
      polygon.reduce((ringBest, ring) => {
        const distance = minDistanceToRingMeters(point, ring);
        return distance.meters < ringBest.meters ? distance : ringBest;
      }, best),
    { meters: Infinity, latlng: null }
  );
}

function geometryToPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates || []];
  if (geometry.type === "MultiPolygon") return geometry.coordinates || [];
  return [];
}

function minDistanceToRingMeters(point, ring) {
  if (!Array.isArray(ring) || ring.length < 2) {
    return { meters: Infinity, latlng: null };
  }
  return ring.reduce((best, coordinate, index) => {
    if (index === 0) return best;
    const previous = ring[index - 1];
    const distance = distancePointToSegmentMeters(point, previous, coordinate);
    return distance.meters < best.meters ? distance : best;
  }, { meters: Infinity, latlng: null });
}

function distancePointToSegmentMeters(point, start, end) {
  if (!Array.isArray(start) || !Array.isArray(end)) {
    return { meters: Infinity, latlng: null };
  }
  const metersPerLon = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const metersPerLat = 110574;
  const ax = (Number(start[0]) - point.lon) * metersPerLon;
  const ay = (Number(start[1]) - point.lat) * metersPerLat;
  const bx = (Number(end[0]) - point.lon) * metersPerLon;
  const by = (Number(end[1]) - point.lat) * metersPerLat;
  if (![ax, ay, bx, by].every(Number.isFinite)) {
    return { meters: Infinity, latlng: null };
  }

  const dx = bx - ax;
  const dy = by - ay;
  const denom = dx * dx + dy * dy;
  const t = denom === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denom));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return {
    meters: Math.hypot(cx, cy),
    latlng: {
      lng: point.lon + cx / metersPerLon,
      lat: point.lat + cy / metersPerLat,
    },
  };
}

function countCoordinates(geometry) {
  return geometryToPolygons(geometry).reduce(
    (total, polygon) =>
      total +
      polygon.reduce((polygonTotal, ring) => polygonTotal + (Array.isArray(ring) ? ring.length : 0), 0),
    0
  );
}

function parseDisplayTime(payload, sourceName) {
  const props = payload?.properties || {};
  const sourceUrl = String(props.source_url || "");
  const sourceMatch = sourceUrl.match(/PB_(\d{10})\d*\.jpg/i);
  if (sourceMatch) {
    const year = Number(sourceMatch[1].slice(0, 4));
    const month = Number(sourceMatch[1].slice(4, 6));
    const day = Number(sourceMatch[1].slice(6, 8));
    const hour = Number(sourceMatch[1].slice(8, 10));
    const date = new Date(Date.UTC(year, month - 1, day, hour + 8));
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(
      2,
      "0"
    )} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
  }
  const knownCase = hourlyWindCases.find((item) => item.label === sourceName || item.geojsonUrl === sourceName);
  if (knownCase) return knownCase.label;
  return sourceName || "--";
}

function setSourceImage(imageUrl, label) {
  if (!imageUrl) return;
  currentSourceImageUrl = imageUrl;
  sourceImagePanel.hidden = false;
  sourceImagePreview.src = imageUrl;
  imageModalImage.src = imageUrl;
  imageModalTitle.textContent = label || "原始图片";
  sourceImageMeta.textContent = label || imageUrl;
}

function openSourceImageModal() {
  if (!currentSourceImageUrl) return;
  imageModal.classList.add("is-open");
  imageModal.setAttribute("aria-hidden", "false");
}

function closeSourceImageModal() {
  imageModal.classList.remove("is-open");
  imageModal.setAttribute("aria-hidden", "true");
}

window.weatherGeoViewer = {
  getState() {
    const center = map.getCenter();
    const bounds = map.getBounds();
    return {
      center: { lat: center.lat, lng: center.lng },
      zoom: map.getZoom(),
      bounds: {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      overlayLayers: state.overlayLayer ? state.overlayLayer.getLayers().length : 0,
      geoJsonFilename: currentGeoJsonPayload ? currentGeoJsonFilename : null,
      stats: {
        time: statTime.textContent,
        regions: statRegions.textContent,
        severe: statSevere.textContent,
        points: statPoints.textContent,
      },
      timelineIndex: Number(timelineSlider.value),
      trendDetail: trendDetail.textContent,
      shareSummary: currentShareSummary,
      viewMode: state.viewMode,
      globe: {
        initialized: globe.initialized,
        autoRotate: state.globeAutoRotate,
        baseMapLoaded: globe.baseMapLoaded,
        cameraDistance: globe.cameraDistance,
        mapTileZoom: globe.mapTileZoom,
        mapTileLoadingZoom: globe.mapTileLoadingZoom,
        mapTileLoadedCount: globe.mapTileLoadedCount,
        mapTileTotalCount: globe.mapTileTotalCount,
        detailTileZoom: globe.detailTileZoom,
        detailTileLoadingZoom: globe.detailTileLoadingZoom,
        detailTileLoadedCount: globe.detailTileLoadedCount,
        detailTileTotalCount: globe.detailTileTotalCount,
        detailTileChildren: globe.detailTileGroup?.children?.length ?? 0,
        labelVisible: globe.labelGroup?.visible ?? false,
        labelChildren: globe.labelGroup?.children?.length ?? 0,
        riverVisible: globe.riverGroup?.visible ?? false,
        riverChildren: globe.riverGroup?.children?.length ?? 0,
        mapStatus: globeMapStatus?.textContent || "",
        rotationX: globe.root?.rotation?.x ?? null,
        rotationY: globe.root?.rotation?.y ?? null,
      },
      cityImpact: {
        count: cityImpactResults.length,
        affectedCount: cityImpactResults.filter((result) => result.hitCount > 0).length,
        topCity: cityImpactResults[0]?.city?.name || null,
      },
      watchPoint: state.watchPoint,
      watchProcessSummary: watchProcessSummary.textContent,
      watchProcessHours: watchImpactTimeline.querySelectorAll("button[data-watch-index]").length,
      locationAnalysis: state.locationAnalysis
        ? {
            status: state.locationAnalysis.status,
            hitCount: state.locationAnalysis.hits.length,
            nearestDistanceMeters: state.locationAnalysis.nearest?.distanceMeters ?? null,
          }
        : null,
      overlayBounds: state.overlayBounds?.isValid()
        ? {
            west: state.overlayBounds.getWest(),
            south: state.overlayBounds.getSouth(),
            east: state.overlayBounds.getEast(),
            north: state.overlayBounds.getNorth(),
          }
        : null,
    };
  },
};

function fitChina() {
  if (state.viewMode === "globe") {
    ensureGlobe();
    state.globeAutoRotate = false;
    globeAutoRotateInput.checked = false;
    if (globe.root) {
      globe.root.rotation.x = 0;
      globe.root.rotation.y = 0;
    }
    positionGlobeCamera(GLOBE_VIEW_CENTER.lon, GLOBE_VIEW_CENTER.lat, GLOBE_MIN_CAMERA_DISTANCE);
    return;
  }
  map.invalidateSize();
  map.fitBounds(CHINA_BOUNDS, { padding: [24, 24] });
}

function fitOverlay() {
  map.invalidateSize();
  if (state.overlayBounds?.isValid()) {
    map.fitBounds(state.overlayBounds, { padding: [34, 34] });
  }
}

function summarize(features) {
  return features.reduce((result, feature) => {
    const label = feature?.properties?.label || "unknown";
    result[label] = (result[label] || 0) + 1;
    return result;
  }, {});
}

function setStatus(main, detail) {
  statusText.textContent = main;
  detailText.textContent = detail;
}

function setProcessing(isProcessing) {
  processUrlButton.disabled = isProcessing;
  processUrlButton.textContent = isProcessing ? "处理中..." : "识别并渲染";
}

function isProbablyHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

initializeTimeline().catch((error) => {
  setStatus("页面初始化失败。", error.message || String(error));
});

window.addEventListener("load", () => {
  requestAnimationFrame(() => {
    map.invalidateSize();
    resizeGlobe();
    if (state.overlayBounds?.isValid()) {
      fitOverlay();
    } else {
      fitChina();
    }
  });
});

window.addEventListener("resize", () => {
  resizeGlobe();
  if (state.viewMode === "map") {
    map.invalidateSize();
  }
});
