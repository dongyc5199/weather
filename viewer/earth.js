(() => {
  "use strict";

  const ENGINE = "cesium";
  const GOOGLE_TILESET_MODE = "google-photorealistic-3d-tiles";
  const DEFAULT_TILESET_MODE = "esri-world-imagery";
  const TILESET_MODE = DEFAULT_TILESET_MODE;
  const FALLBACK_TILESET_MODE = "openstreetmap-imagery";
  const BASEMAP_PROVIDERS = {
    "cesium-world-terrain": {
      id: "cesium-world-terrain",
      label: "Cesium World Terrain",
      shortLabel: "Cesium World Terrain",
      provider: "Cesium ion / CesiumJS",
      mode: "terrain-imagery",
      requiresIonToken: true,
      supportsTerrain: true,
      supportsBuildings: false,
      detail: "Cesium 全球高程地形 + 影像底图，不依赖 Google Maps API。",
    },
    "esri-world-imagery": {
      id: "esri-world-imagery",
      label: "Esri World Imagery",
      shortLabel: "Esri World Imagery",
      provider: "ArcGIS MapServer / CesiumJS",
      mode: "imagery-globe",
      supportsTerrain: false,
      supportsBuildings: false,
      detail: "ArcGIS 世界影像球面底图，无 Google 依赖；地形用 Cesium 椭球。",
    },
    "openstreetmap-imagery": {
      id: "openstreetmap-imagery",
      label: "OpenStreetMap",
      shortLabel: "OpenStreetMap",
      provider: "OpenStreetMap / CesiumJS",
      mode: "imagery-globe",
      supportsTerrain: false,
      supportsBuildings: false,
      detail: "开放街道瓦片球面底图，适合无 token 的开发兜底。",
    },
    "natural-earth": {
      id: "natural-earth",
      label: "本地基础底图",
      shortLabel: "Local Globe",
      provider: "Generated local texture / CesiumJS",
      mode: "local-imagery-globe",
      supportsTerrain: false,
      supportsBuildings: false,
      detail: "本地生成的低分辨率地球纹理，完全不依赖外部地图服务。",
    },
    [GOOGLE_TILESET_MODE]: {
      id: GOOGLE_TILESET_MODE,
      label: "Google Photorealistic 3D Tiles",
      shortLabel: "Google 3D Tiles",
      provider: "Google / Cesium ion",
      mode: "photogrammetry-3d-tiles",
      requiresIonToken: true,
      supportsTerrain: true,
      supportsBuildings: true,
      detail: "Google 摄影测量 3D Tiles，仅作为可选写实底座。",
    },
  };
  const PROJECT_SCHEMA = "weather-earth-project-v1";
  const DEFAULT_GEOJSON_URL = "../outputs/nmc-wind/202606101800.geojson";
  const DEFAULT_MANIFEST_URL = "../outputs/nmc-wind/manifest.json";
  const DEFAULT_VIEW = { zoom: 1.25, lat: 28, lon: 105, bearing: 0, pitch: 0 };
  const DEFAULT_NARROW_VIEW = { ...DEFAULT_VIEW, zoom: 0.7 };
  const TIME_FILTER_ALL = "__all__";
  const FEATURE_ID_PROPERTY = "_earthFeatureId";
  const INTERNAL_PROPERTY_KEYS = new Set([FEATURE_ID_PROPERTY, "_weatherColor", "_weatherVolumeHeight", "marker-size-px"]);
  const REQUEST_TARGET = "weather-earth";
  const RESPONSE_TARGET = "weather-earth-client";
  const TOKEN_STORAGE_KEY = "weather-earth-cesium-ion-token";
  const INLINE_SHARE_MAX_URL_LENGTH = 120000;
  const INLINE_PROJECT_SHARE_MAX_URL_LENGTH = 180000;
  const DEFAULT_WEATHER_OPACITY = 0.42;
  const DEFAULT_TERRAIN_EXAGGERATION = 1.25;
  const DEFAULT_SUNLIGHT_INTENSITY = 0.38;
  const DEFAULT_BUILDING_HEIGHT_SCALE = 1;
  const DEFAULT_WEATHER_3D_SCALE = 0.86;
  const DEFAULT_WEATHER_VOLUME_SCALE = 0.55;
  const DEFAULT_AUTO_ROTATE = false;
  const DEFAULT_IMMERSIVE = true;
  const AUTO_ROTATE_DEGREES_PER_SECOND = 0.45;
  const FOCUS_ORBIT_DEGREES_PER_SECOND = 5.5;
  const TILE_SERVER_KEY = "tile.googleapis.com:443";
  const DEFAULT_QUALITY_PROFILE = "quality";
  const QUALITY_PROFILES = {
    quality: {
      id: "quality",
      label: "Quality",
      detail: "Google Earth-like detail priority for screenshots and close terrain views.",
      maximumScreenSpaceError: 3,
      dynamicScreenSpaceError: false,
      globeMaximumScreenSpaceError: 2,
      resolutionScale: 1,
      msaaSamples: 4,
      requestsByServer: 18,
      cacheBytes: 536870912,
    },
    balanced: {
      id: "balanced",
      label: "Balanced",
      detail: "Mixed visual quality and interaction performance for normal review.",
      maximumScreenSpaceError: 6,
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: 0.00278,
      dynamicScreenSpaceErrorFactor: 3,
      globeMaximumScreenSpaceError: 4,
      resolutionScale: 0.92,
      msaaSamples: 2,
      requestsByServer: 18,
      cacheBytes: 402653184,
    },
    performance: {
      id: "performance",
      label: "Performance",
      detail: "Lower tile and pixel pressure for weak GPU or slow network.",
      maximumScreenSpaceError: 12,
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: 0.0038,
      dynamicScreenSpaceErrorFactor: 5,
      globeMaximumScreenSpaceError: 6,
      resolutionScale: 0.78,
      msaaSamples: 1,
      requestsByServer: 12,
      cacheBytes: 268435456,
    },
  };
  const SUNLIGHT_BASE_INTENSITY = 0.95;
  const SUNLIGHT_RANGE_INTENSITY = 1.35;
  const SUNLIGHT_DISABLED_INTENSITY = 0.8;
  const EARTH_VISUAL_TREATMENT = {
    id: "google-earth-p1",
    label: "Google Earth P1",
    exposure: 0.96,
    skyBox: true,
    skyAtmosphere: { hueShift: 0, saturationShift: -0.04, brightnessShift: 0.08 },
    groundAtmosphere: { hueShift: -0.02, saturationShift: 0.04, brightnessShift: 0.06, lightIntensity: 5.6 },
    fog: { enabled: true, density: 0.00016, minimumBrightness: 0.08, screenSpaceErrorFactor: 2.4 },
  };
  const CAMERA_UI_UPDATE_INTERVAL_MS = 150;
  const URL_UPDATE_DEBOUNCE_MS = 500;
  const POINTER_PROBE_INTERVAL_MS = 90;
  const CAMERA_INTERACTION_IDLE_MS = 260;
  const CAMERA_INTERACTION_QUALITY = {
    maximumScreenSpaceError: 10,
    dynamicScreenSpaceErrorDensity: 0.0038,
    dynamicScreenSpaceErrorFactor: 5,
    globeMaximumScreenSpaceError: 6,
    resolutionScale: 0.82,
    msaaSamples: 1,
  };
  const CAMERA_CONTROL_INERTIA = {
    spin: 0.86,
    translate: 0.88,
    zoom: 0.72,
  };
  const CAMERA_PITCH_MIN = 0;
  const CAMERA_PITCH_MAX = 85;
  const CAMERA_PITCH_DRAG_DEGREES_PER_PIXEL = 0.14;
  const CAMERA_BEARING_DRAG_DEGREES_PER_PIXEL = 0.18;
  const CAMERA_PITCH_WHEEL_DEGREES_PER_PIXEL = 0.035;
  const SUNLIGHT_REALTIME_SYNC_INTERVAL_MS = 60000;
  const KEYBOARD_PAN_HEIGHT_FACTOR = 0.16;
  const KEYBOARD_PAN_MIN_METERS_PER_SECOND = 35;
  const KEYBOARD_PAN_MAX_METERS_PER_SECOND = 900000;
  const KEYBOARD_ZOOM_LEVELS_PER_SECOND = 1.8;
  const KEYBOARD_ROTATE_DEGREES_PER_SECOND = 88;
  const KEYBOARD_TILT_DEGREES_PER_SECOND = 54;
  const KEYBOARD_OBLIQUE_PITCH = 55;

  const ELEMENT_IDS = [
    "earthMap", "projectionGlobe", "projectionMap", "scenePresetShowcase", "scenePresetAudit", "scenePresetCity",
    "scenePresetInfo", "loadDefaultWeather", "fitWeather", "placePreset", "flyToPlace", "locationSearchInput",
    "locationSearchButton", "locationSearchInfo", "focusCurrentView", "clearFocusTarget", "autoRotateGlobe",
    "focusOrbitEnabled", "baseMapStyle", "immersiveBaseMapStyle", "mapDetailsEnabled", "immersiveMapDetailsEnabled",
    "mapDetailsInfo", "terrainEnabled", "immersiveTerrainEnabled", "terrainExaggeration", "terrainInfo",
    "sunlightEnabled", "immersiveSunlightEnabled", "sunlightIntensity", "sunlightInfo", "buildingsEnabled",
    "immersiveBuildingsEnabled", "buildingHeightScale", "buildingInfo", "addCameraTourStop", "playCameraTour",
    "clearCameraTour", "cameraTourSummary", "cameraTourList", "geoJsonUrlInput", "loadGeoJsonUrl", "geoJsonFileInput",
    "saveBrowserDraft", "restoreBrowserDraft", "normalizeWeatherGeoJson", "dataInfo", "downloadProject",
    "projectFileInput", "downloadGeoJson", "downloadVisibleGeoJson", "copyShareUrl", "copyInlineShareUrl",
    "copyProjectShareUrl", "clearWeather", "shareUrlText", "weatherOpacity", "immersiveWeatherOpacity",
    "immersiveWeatherOpacityValue", "weather3dEnabled", "weather3dScale", "weather3dInfo", "weatherVolumeEnabled",
    "weatherVolumeScale", "weatherVolumeInfo", "drawPoint", "drawLine", "drawPolygon", "drawWeatherType",
    "drawColor", "drawName", "finishDraw", "undoDrawPoint", "cancelDraw", "drawStatus", "measureDistance",
    "measureArea", "finishMeasure", "undoMeasurePoint", "clearMeasure", "measureStatus", "clearFeatureSelection",
    "selectedFeatureStatus", "selectedWeatherType", "selectedColor", "selectedName", "selectedProperties",
    "selectedGeometry", "applyWeatherTemplate", "formatSelectedProperties", "formatSelectedGeometry",
    "updateSelectedFeature", "deleteSelectedFeature", "featureSearch", "featureListSummary", "featureList",
    "fitSelectedFeature", "timeFilterSelect", "immersiveTimeFilterSelect", "resetTimeFilter", "immersiveTimeAll",
    "showUntimedFeatures", "timeFilterSummary", "showAllElementTypes", "hideAllElementTypes", "elementTypeSummary",
    "elementTypeList", "geoJsonEditor", "applyGeoJsonEditor", "formatGeoJsonEditor", "validationSummary",
    "validateGeoJson", "downloadValidationReport", "processTimeline", "processSummary", "loadManifestUrl",
    "manifestUrlInput", "loadDefaultManifest", "playManifest", "resetManifest", "immersiveProcessPanel",
    "immersiveProcessPrev", "immersiveProcessPlay", "immersiveProcessTime", "immersiveProcessRange",
    "immersiveProcessNext", "immersiveSearchInput", "immersiveSearchButton", "immersiveExitPanel",
    "immersiveFocusCenter", "immersiveFocusOrbit", "immersiveAddTourStop", "immersivePlayTour", "immersiveTourCount",
    "cameraZoomIn", "cameraZoomOut", "cameraRotateLeft", "cameraRotateRight", "cameraTiltUp", "cameraTiltDown",
    "cameraPitchSlider", "cameraHome", "toggleImmersive", "earthMenuPanel", "earthMenuWorkbench", "earthMenuReset",
    "earthMenuTopDown", "earthMenuOblique", "cameraNorth", "compassNeedle", "cameraCenter", "cameraAltitude",
    "cameraHeading", "cameraPitch", "cameraZoom", "pointerPosition", "pointerElevation", "cameraTourCaption",
    "projectionBadge", "sourceBadge", "earthOverview", "earthOverviewSvg", "earthOverviewChinaOutline",
    "earthOverviewWeatherExtent", "earthOverviewFocusDot", "earthOverviewCameraHeading", "earthOverviewCameraDot",
    "earthOverviewLabel", "statusTitle", "statusDetail"
  ];

  const elements = Object.fromEntries(ELEMENT_IDS.map((id) => [id, document.getElementById(id)]));
  const Cesium = globalThis.Cesium;

  const WEATHER_ELEMENT_TYPES = [
    { id: "wind-region", label: "风区", geometry: "Polygon", color: "#00d6f2", aliases: ["wind", "gale", "polygon"], properties: { weather_type: "wind-region", level: "6级", time: "", source: "manual" } },
    { id: "rain-region", label: "降水区", geometry: "Polygon", color: "#2f80ff", aliases: ["rain", "precipitation"], properties: { weather_type: "rain-region", intensity: "", time: "", source: "manual" } },
    { id: "temperature-region", label: "温度区", geometry: "Polygon", color: "#ff6f5e", aliases: ["temperature", "heat"], properties: { weather_type: "temperature-region", value: "", time: "", source: "manual" } },
    { id: "warning", label: "预警点", geometry: "Point", color: "#ffbd59", aliases: ["alert", "station", "point"], properties: { weather_type: "warning", level: "橙色", time: "", source: "manual" } },
    { id: "track", label: "路径", geometry: "LineString", color: "#8ef6ff", aliases: ["path", "line", "route"], properties: { weather_type: "track", time: "", source: "manual" } },
  ];

  const EARTH_PLACE_PRESETS = [
    { id: "china", label: "中国全景", camera: DEFAULT_VIEW },
    { id: "beijing", label: "北京城市斜视", aliases: ["北京", "beijing", "city"], camera: { zoom: 13.85, lat: 39.9242, lon: 116.4074, bearing: -28, pitch: 54 } },
    { id: "shanghai", label: "上海城市斜视", aliases: ["上海", "shanghai"], camera: { zoom: 13.75, lat: 31.2204, lon: 121.4737, bearing: -30, pitch: 54 } },
    { id: "guangzhou", label: "广州城市斜视", aliases: ["广州", "guangzhou"], camera: { zoom: 13.65, lat: 23.1291, lon: 113.2644, bearing: -24, pitch: 53 } },
    { id: "qinghai-tibet", label: "青藏高原山地", aliases: ["青藏", "高原", "tibet", "plateau"], camera: { zoom: 7.75, lat: 31.45, lon: 88.4, bearing: -36, pitch: 56 } },
    { id: "xinjiang", label: "新疆山地斜视", aliases: ["新疆", "xinjiang", "mountain"], camera: { zoom: 7.95, lat: 43.8, lon: 87.6, bearing: -26, pitch: 55 } },
    { id: "taihang", label: "太行山地形", aliases: ["太行", "taihang"], camera: { zoom: 9.65, lat: 39.08, lon: 113.55, bearing: -32, pitch: 56 } },
    { id: "hengduan", label: "横断山谷地", aliases: ["横断", "hengduan", "valley"], camera: { zoom: 9.45, lat: 27.85, lon: 99.95, bearing: -30, pitch: 57 } },
    { id: "south-china-sea", label: "南海视角", aliases: ["南海", "south china sea"], camera: { zoom: 5.55, lat: 16.6, lon: 112.4, bearing: -18, pitch: 48 } },
    { id: "shenzhen", label: "深圳城市斜视", aliases: ["深圳", "shenzhen"], camera: { zoom: 13.95, lat: 22.5431, lon: 114.0579, bearing: -24, pitch: 54 } },
    { id: "chengdu", label: "成都平原斜视", aliases: ["成都", "chengdu"], camera: { zoom: 12.9, lat: 30.6023, lon: 104.0665, bearing: -25, pitch: 53 } },
    { id: "lhasa", label: "拉萨河谷", aliases: ["拉萨", "lhasa"], camera: { zoom: 12.1, lat: 29.6469, lon: 91.1172, bearing: -28, pitch: 55 } },
  ];

  const EARTH_BENCHMARK_PATHS = {
    "google-earth-p1": {
      id: "google-earth-p1",
      label: "Google Earth P1 对比路径",
      detail: "覆盖全国、山地、城市和天气分析四类视角。",
      stops: [
        { placeId: "china", label: "全国概览" },
        { placeId: "qinghai-tibet", label: "山地地形" },
        { placeId: "beijing", label: "城市斜视" },
        { label: "天气叠加分析", camera: { zoom: 5.35, lat: 36.2, lon: 106.2, bearing: -20, pitch: 50 } },
      ],
    },
    "terrain-cinematic": {
      id: "terrain-cinematic",
      label: "山地地形电影路径",
      detail: "专门检查山脉纹理、雾化和斜视地形层次。",
      stops: [{ placeId: "qinghai-tibet" }, { placeId: "xinjiang" }, { placeId: "taihang" }, { placeId: "hengduan" }],
    },
    "city-oblique": {
      id: "city-oblique",
      label: "城市斜视路径",
      detail: "检查摄影测量建筑、城市纹理和中低空相机距离。",
      stops: [{ placeId: "beijing" }, { placeId: "shanghai" }, { placeId: "shenzhen" }, { placeId: "guangzhou" }],
    },
    "weather-analysis": {
      id: "weather-analysis",
      label: "天气叠加分析路径",
      detail: "检查天气 GeoJSON 与 3D 地球之间的可读性。",
      stops: [{ placeId: "china" }, { label: "中东部天气", camera: { zoom: 5.8, lat: 34.4, lon: 113.2, bearing: -18, pitch: 48 } }, { placeId: "south-china-sea" }],
    },
  };

  const SCENE_PRESETS = {
    showcase: {
      label: "展示",
      detail: "Cesium Globe 三维地球，天气作为轻量叠加层。",
      settings: { projection: "globe", basemap: TILESET_MODE, terrain: true, sunlight: false, buildings: true, weather3d: true, weatherVolume: false, weatherOpacity: 0.42, autoRotate: false, sunlightIntensity: 0.38, weather3dScale: 0.86, weatherVolumeScale: 0.55 },
    },
    audit: {
      label: "校验",
      detail: "保持 Cesium 三维底座，降低 3D 干扰并提高天气面透明度。",
      settings: { projection: "globe", basemap: TILESET_MODE, terrain: true, sunlight: false, buildings: true, weather3d: false, weatherVolume: false, weatherOpacity: 0.68, autoRotate: false, sunlightIntensity: 0.72, weather3dScale: 1, weatherVolumeScale: 1 },
    },
    city: {
      label: "城市",
      detail: "城市尺度天气标记；Google 摄影测量建筑仅在可选 Google 底座下可用。",
      settings: { projection: "globe", basemap: TILESET_MODE, terrain: true, sunlight: true, buildings: true, weather3d: true, weatherVolume: true, weatherOpacity: 0.42, autoRotate: false, sunlightIntensity: 0.66, weather3dScale: 1, weatherVolumeScale: 0.66 },
    },
  };

  const WEATHER_LAYERS = [
    { id: "weather-regions", label: "天气面", geometry: new Set(["Polygon", "MultiPolygon"]) },
    { id: "weather-lines", label: "路径线", geometry: new Set(["LineString", "MultiLineString"]) },
    { id: "weather-points", label: "点标记", geometry: new Set(["Point", "MultiPoint"]) },
  ];

  let viewer = null;
  let googleTileset = null;
  let activeImageryLayer = null;
  let activeTerrainProvider = null;
  let tilesetStatus = "not-loaded";
  let tilesetError = "";
  let activeBaseMapFallback = "";
  let tokenPanel = null;
  let basemapLoadSeq = 0;
  let localGlobeTextureUrl = "";
  let eventSeq = 1;
  let readyEmitted = false;
  let currentGeoJson = emptyFeatureCollection();
  let displayedGeoJson = emptyFeatureCollection();
  let currentGeoJsonName = "weather-earth.geojson";
  let currentGeoJsonMeta = {};
  let currentShareSourceType = "";
  let currentShareSourceValue = "";
  let currentProjection = "globe";
  let currentBaseMapKey = TILESET_MODE;
  let activeQualityProfile = DEFAULT_QUALITY_PROFILE;
  let activeScenePreset = "showcase";
  let mapDetailsEnabled = true;
  let terrainEnabled = true;
  let terrainExaggeration = DEFAULT_TERRAIN_EXAGGERATION;
  let sunlightEnabled = false;
  let sunlightIntensity = DEFAULT_SUNLIGHT_INTENSITY;
  let sunlightTimeMode = "realtime";
  let sunlightTimeIso = "";
  let sunlightTimeLabel = "当前时间";
  let sunlightTimeSource = "browser-clock";
  let lastSunlightClockSyncAt = 0;
  let buildingsEnabled = true;
  let buildingHeightScale = DEFAULT_BUILDING_HEIGHT_SCALE;
  let weather3dEnabled = true;
  let weather3dScale = DEFAULT_WEATHER_3D_SCALE;
  let weatherVolumeEnabled = false;
  let weatherVolumeScale = DEFAULT_WEATHER_VOLUME_SCALE;
  let autoRotateEnabled = DEFAULT_AUTO_ROTATE;
  let focusOrbitEnabled = false;
  let immersiveEnabled = DEFAULT_IMMERSIVE;
  let earthMenuOpen = false;
  let activeTimeFilter = TIME_FILTER_ALL;
  let showUntimedFeatures = true;
  let focusTarget = null;
  let surfaceProbe = null;
  let cameraAngleDrag = null;
  let lastLocationSearch = null;
  let measurementState = { mode: "", active: false, finalized: true, coordinates: [], lengthMeters: 0, areaSqMeters: 0 };
  let cameraTourStops = [];
  let cameraTourPlaying = false;
  let cameraTourTimer = 0;
  let cameraTourIndex = -1;
  let manifestFrames = [];
  let manifestIndex = 0;
  let manifestPlaying = false;
  let manifestTimer = 0;
  let drawMode = "";
  let drawCoordinates = [];
  let selectedFeatureId = "";
  let pointerLonLat = null;
  let lastCamera = { ...DEFAULT_VIEW };
  let currentWeatherOpacity = DEFAULT_WEATHER_OPACITY;
  let weatherEntities = [];
  let utilityEntities = [];
  let drawEntities = [];
  let measurementEntities = [];
  let earthSkyBox = null;
  let layerVisibility = new Map(WEATHER_LAYERS.map((layer) => [layer.id, true]));
  let elementTypeVisibility = new Map(WEATHER_ELEMENT_TYPES.map((type) => [type.id, true]));
  let cameraUiUpdateQueued = false;
  let lastCameraUiUpdateAt = 0;
  let keyboardNavigationKeys = new Set();
  let keyboardNavigationModifiers = { shift: false, alt: false, ctrl: false, meta: false };
  let keyboardNavigationCamera = null;
  let cameraInteractionActive = false;
  let cameraInteractionReason = "";
  let cameraInteractionStartedAt = 0;
  let cameraInteractionRestoreTimer = 0;
  let interactionQualityActive = false;
  let pointerProbeLastAt = 0;
  let replaceUrlQueuedDuringInteraction = false;
  let replaceUrlTimer = 0;
  let renderMetrics = { frameCount: 0, fps: 0, frameLatencyMs: 0, lastFrameAt: 0, sampleStartedAt: 0, sampleFrameCount: 0 };

  async function init() {
    bootstrapControls();
    exposeApi();
    await loadOptionalLocalConfig();
    if (!Cesium) {
      setStatus("Cesium 加载失败。", "请检查 CesiumJS CDN 网络访问。");
      markReady("cesium-missing");
      return;
    }
    currentBaseMapKey = initialBaseMapKeyFromUrl();
    initViewer();
    bindDomEvents();
    initializeFromUrl();
    updateAllUi();
    markReady("cesium-ready");
  }

  async function loadOptionalLocalConfig() {
    try {
      const response = await fetch("./earth.config.local.js", { cache: "no-store" });
      if (!response.ok) return;
      const source = await response.text();
      if (source.trim()) new Function(source)();
    } catch {
      // Local config is optional; missing files should not block the viewer.
    }
  }

  function initViewer() {
    configureCesiumRequestScheduler();
    viewer = new Cesium.Viewer(elements.earthMap, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      vrButton: false,
      requestRenderMode: false,
      useBrowserRecommendedResolution: false,
      baseLayer: false,
      imageryProvider: false,
    });
    configureCreditContainer();
    applyQualityProfileToViewer();
    applyEarthVisualTreatment();
    configureCameraController();
    const initialCamera = defaultCameraView();
    lastCamera = initialCamera;
    setCameraLookAt(initialCamera);
    applyCesiumLighting();
    syncSunlightClock({ force: true });
    bindCesiumEvents();
    loadBaseMapProvider(currentBaseMapKey);
    scheduleRenderLoop();
  }

  function bindCesiumEvents() {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const lonLat = screenToLonLat(movement.position);
      if (!lonLat) return;
      if (drawMode) {
        addDrawPoint(lonLat);
        return;
      }
      if (measurementState.active) {
        addMeasurementPointTool(lonLat);
        return;
      }
      const picked = viewer.scene.pick(movement.position);
      const id = picked?.id?.__weatherFeatureId || picked?.primitive?.id?.__weatherFeatureId || "";
      if (id) {
        selectFeatureById(id, { fit: false });
      } else {
        setSurfaceProbeFromLngLat(lonLat, { source: "click" });
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement) => {
      const lonLat = screenToLonLat(movement.position);
      if (lonLat) setFocusTargetState({ ...lonLat, label: "聚焦目标" }, { eventReason: "double-click" });
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    handler.setInputAction((movement) => {
      updatePointerProbeFromScreen(movement.endPosition);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    viewer.camera.changed.addEventListener(() => {
      if (cameraInteractionActive) endCameraInteractionSoon();
      scheduleCameraUiUpdate();
      scheduleReplaceUrlState();
    });
    bindCameraInteractionGestures();
    bindCameraAngleGestures();
  }

  function configureCameraController() {
    if (!viewer?.scene?.screenSpaceCameraController) return;
    const controller = viewer.scene.screenSpaceCameraController;
    controller.minimumZoomDistance = 80;
    controller.maximumZoomDistance = 45000000;
    if ("inertiaSpin" in controller) controller.inertiaSpin = CAMERA_CONTROL_INERTIA.spin;
    if ("inertiaTranslate" in controller) controller.inertiaTranslate = CAMERA_CONTROL_INERTIA.translate;
    if ("inertiaZoom" in controller) controller.inertiaZoom = CAMERA_CONTROL_INERTIA.zoom;
  }

  function bindCameraInteractionGestures() {
    const canvas = viewer?.scene?.canvas;
    if (!canvas) return;
    canvas.addEventListener("pointerdown", handleCameraInteractionPointerDown, { capture: true });
    canvas.addEventListener("pointerup", endCameraInteractionSoon, { capture: true });
    canvas.addEventListener("pointercancel", endCameraInteractionSoon, { capture: true });
    canvas.addEventListener("pointerleave", endCameraInteractionSoon, { capture: true });
    canvas.addEventListener("wheel", handleCameraInteractionWheel, { capture: true, passive: true });
  }

  function handleCameraInteractionPointerDown(event) {
    if (!viewer || event.defaultPrevented) return;
    beginCameraInteraction(event.button === 2 ? "right-drag" : "drag");
  }

  function handleCameraInteractionWheel(event) {
    if (!viewer || event.defaultPrevented) return;
    beginCameraInteraction(event.shiftKey || event.altKey ? "tilt-wheel" : "wheel");
    endCameraInteractionSoon();
  }

  function bindCameraAngleGestures() {
    const canvas = viewer?.scene?.canvas;
    if (!canvas) return;
    canvas.addEventListener("contextmenu", handleCameraAngleContextMenu);
    canvas.addEventListener("pointerdown", handleCameraAnglePointerDown, { capture: true });
    canvas.addEventListener("pointermove", handleCameraAnglePointerMove, { capture: true });
    canvas.addEventListener("pointerup", endCameraAnglePointerDrag, { capture: true });
    canvas.addEventListener("pointercancel", endCameraAnglePointerDrag, { capture: true });
    canvas.addEventListener("wheel", handleCameraAngleWheel, { capture: true, passive: false });
  }

  function handleCameraAngleContextMenu(event) {
    stopCameraGestureEvent(event);
  }

  function handleCameraAnglePointerDown(event) {
    if (!viewer || event.button !== 2 || drawMode || measurementState.active) return;
    beginCameraInteraction("right-drag");
    const canvas = viewer.scene.canvas;
    cameraAngleDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camera: currentCameraState(),
      controllerEnabled: viewer.scene.screenSpaceCameraController.enableInputs,
    };
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    canvas.classList.add("is-angle-dragging");
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    stopCameraGestureEvent(event);
  }

  function handleCameraAnglePointerMove(event) {
    if (!cameraAngleDrag || cameraAngleDrag.pointerId !== event.pointerId || !viewer) return;
    if ((event.buttons & 2) !== 2) {
      endCameraAnglePointerDrag(event);
      return;
    }
    const dx = event.clientX - cameraAngleDrag.startX;
    const dy = event.clientY - cameraAngleDrag.startY;
    const nextCamera = {
      ...cameraAngleDrag.camera,
      bearing: cameraAngleDrag.camera.bearing + dx * CAMERA_BEARING_DRAG_DEGREES_PER_PIXEL,
      pitch: clamp(cameraAngleDrag.camera.pitch - dy * CAMERA_PITCH_DRAG_DEGREES_PER_PIXEL, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX),
    };
    setCameraAngle(nextCamera, { duration: 0 });
    stopCameraGestureEvent(event);
  }

  function endCameraAnglePointerDrag(event) {
    if (!cameraAngleDrag || !viewer) return;
    const canvas = viewer.scene.canvas;
    try {
      if (!canvas.hasPointerCapture || canvas.hasPointerCapture(cameraAngleDrag.pointerId)) {
        canvas.releasePointerCapture?.(cameraAngleDrag.pointerId);
      }
    } catch {}
    canvas.classList.remove("is-angle-dragging");
    viewer.scene.screenSpaceCameraController.enableInputs = cameraAngleDrag.controllerEnabled;
    cameraAngleDrag = null;
    scheduleCameraUiUpdate();
    scheduleReplaceUrlState();
    endCameraInteractionSoon();
    if (event) stopCameraGestureEvent(event);
  }

  function handleCameraAngleWheel(event) {
    if (!viewer || drawMode || measurementState.active || !(event.shiftKey || event.altKey)) return;
    const deltaY = normalizeWheelDeltaY(event);
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.01) return;
    const pitchDelta = clamp(-deltaY * CAMERA_PITCH_WHEEL_DEGREES_PER_PIXEL, -6, 6);
    const camera = currentCameraState();
    beginCameraInteraction("tilt-wheel");
    setCameraAngle({ ...camera, pitch: clamp(camera.pitch + pitchDelta, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX) }, { duration: 0 });
    endCameraInteractionSoon();
    stopCameraGestureEvent(event);
  }

  function normalizeWheelDeltaY(event) {
    if (event.deltaMode === 1) return event.deltaY * 16;
    if (event.deltaMode === 2) return event.deltaY * 120;
    return event.deltaY;
  }

  function stopCameraGestureEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function beginCameraInteraction(reason = "camera") {
    if (!viewer) return;
    window.clearTimeout(cameraInteractionRestoreTimer);
    cameraInteractionRestoreTimer = 0;
    cameraInteractionReason = reason;
    if (!cameraInteractionActive) {
      cameraInteractionActive = true;
      cameraInteractionStartedAt = performance.now();
      viewer.scene.canvas.classList.add("is-camera-interacting");
    }
    if (!interactionQualityActive) {
      interactionQualityActive = true;
      applyQualityProfileToViewer();
      applyQualityProfileToTileset();
    }
  }

  function endCameraInteractionSoon() {
    if (!cameraInteractionActive && !interactionQualityActive) return;
    window.clearTimeout(cameraInteractionRestoreTimer);
    cameraInteractionRestoreTimer = window.setTimeout(finishCameraInteraction, CAMERA_INTERACTION_IDLE_MS);
  }

  function finishCameraInteraction() {
    window.clearTimeout(cameraInteractionRestoreTimer);
    cameraInteractionRestoreTimer = 0;
    if (!cameraInteractionActive && !interactionQualityActive) return;
    cameraInteractionActive = false;
    cameraInteractionReason = "";
    cameraInteractionStartedAt = 0;
    interactionQualityActive = false;
    viewer?.scene?.canvas?.classList.remove("is-camera-interacting");
    applyQualityProfileToViewer();
    applyQualityProfileToTileset();
    scheduleCameraUiUpdate();
    if (replaceUrlQueuedDuringInteraction) {
      replaceUrlQueuedDuringInteraction = false;
      scheduleReplaceUrlState();
    }
  }

  function updatePointerProbeFromScreen(position, options = {}) {
    const now = performance.now();
    if (!options.force && cameraInteractionActive && now - pointerProbeLastAt < POINTER_PROBE_INTERVAL_MS) return;
    pointerProbeLastAt = now;
    pointerLonLat = screenToLonLat(position);
    scheduleCameraUiUpdate();
  }

  async function loadBaseMapProvider(key = currentBaseMapKey, options = {}) {
    if (!viewer || !Cesium) return;
    const requestedKey = normalizeBaseMapKey(key);
    const sequence = ++basemapLoadSeq;
    const provider = baseMapProvider(requestedKey);
    currentBaseMapKey = provider.id;
    activeBaseMapFallback = "";
    removeTokenPanel();
    clearBaseMapLayers();
    try {
      tilesetStatus = "loading";
      tilesetError = "";
      setStatus("正在加载地球底座...", provider.label);
      if (provider.id === GOOGLE_TILESET_MODE) {
        await loadGoogleTilesetProvider(configuredIonToken());
      } else if (provider.id === "cesium-world-terrain") {
        await loadWorldTerrainProvider(configuredIonToken());
      } else {
        await loadImageryGlobeProvider(provider.id);
      }
      if (sequence !== basemapLoadSeq) return;
      tilesetStatus = "ready";
      tilesetError = "";
      setStatus("地球底座已加载。", provider.detail);
      updateSourceBadges();
      updateAllUi();
      viewer.scene.requestRender();
      if (options.notify) emitWeatherEarthEvent("basemapchange", { tileset: tilesetState(), state: weatherEarthState() });
    } catch (error) {
      if (sequence !== basemapLoadSeq) return;
      tilesetStatus = "error";
      tilesetError = error?.message || String(error);
      await fallbackToOpenBaseMap(provider, tilesetError, options);
    }
  }

  async function fallbackToOpenBaseMap(provider, reason, options = {}) {
    activeBaseMapFallback = FALLBACK_TILESET_MODE;
    currentBaseMapKey = provider.id;
    clearBaseMapLayers();
    try {
      await loadImageryGlobeProvider(FALLBACK_TILESET_MODE);
      tilesetStatus = provider.requiresIonToken && !configuredIonToken() ? "missing-token" : "fallback";
      tilesetError = reason || "";
      const message = provider.requiresIonToken && !configuredIonToken()
        ? `${provider.label} 需要 Cesium ion token，已使用 OpenStreetMap 兜底。`
        : `${provider.label} 加载失败，已使用 OpenStreetMap 兜底。`;
      if (provider.requiresIonToken && !configuredIonToken()) showTokenPanel(message, provider.id);
      setStatus("已切换到开放底座。", message);
    } catch (fallbackError) {
      tilesetStatus = "error";
      tilesetError = `${reason || ""} / fallback: ${fallbackError?.message || fallbackError}`;
      await loadLocalNaturalEarth();
      setStatus("已切换到本地低分辨率底图。", tilesetError);
    }
    updateSourceBadges();
    updateAllUi();
    viewer?.scene?.requestRender();
    if (options.notify) emitWeatherEarthEvent("basemapchange", { tileset: tilesetState(), state: weatherEarthState() });
  }

  function clearBaseMapLayers() {
    if (!viewer || !Cesium) return;
    if (googleTileset) {
      viewer.scene.primitives.remove(googleTileset);
      googleTileset = null;
    }
    if (viewer.imageryLayers) {
      viewer.imageryLayers.removeAll();
      activeImageryLayer = null;
    }
    activeTerrainProvider = new Cesium.EllipsoidTerrainProvider();
    viewer.terrainProvider = activeTerrainProvider;
    if (viewer.scene.globe) viewer.scene.globe.show = true;
  }

  async function loadGoogleTilesetProvider(token = configuredIonToken()) {
    if (!token) throw new Error("需要 Cesium ion token 才能加载 Google Photorealistic 3D Tiles。");
    Cesium.Ion.defaultAccessToken = token;
    if (typeof Cesium.createGooglePhotorealistic3DTileset !== "function") {
      throw new Error("当前 CesiumJS 版本不支持 createGooglePhotorealistic3DTileset。");
    }
    if (viewer.scene.globe) viewer.scene.globe.show = false;
    googleTileset = await Cesium.createGooglePhotorealistic3DTileset();
    googleTileset.show = true;
    applyQualityProfileToTileset();
    viewer.scene.primitives.add(googleTileset);
  }

  async function loadWorldTerrainProvider(token = configuredIonToken()) {
    if (!token) throw new Error("需要 Cesium ion token 才能加载 Cesium World Terrain。");
    Cesium.Ion.defaultAccessToken = token;
    try {
      await addImageryProvider(await createImageryProvider("esri-world-imagery"));
    } catch {
      await addImageryProvider(await createImageryProvider(FALLBACK_TILESET_MODE));
    }
    activeTerrainProvider = await createWorldTerrainProvider();
    applyTerrainProviderState();
    if (viewer.scene.globe) {
      viewer.scene.globe.show = true;
      viewer.scene.globe.enableLighting = sunlightEnabled;
    }
  }

  async function loadImageryGlobeProvider(key) {
    await addImageryProvider(await createImageryProvider(key));
    activeTerrainProvider = new Cesium.EllipsoidTerrainProvider();
    viewer.terrainProvider = activeTerrainProvider;
    if (viewer.scene.globe) viewer.scene.globe.show = true;
  }

  async function loadLocalNaturalEarth() {
    clearBaseMapLayers();
    await addImageryProvider(createNaturalEarthImageryProvider());
    activeBaseMapFallback = "natural-earth";
    if (viewer?.scene?.globe) viewer.scene.globe.show = true;
  }

  async function createWorldTerrainProvider() {
    if (Cesium.CesiumTerrainProvider?.fromIonAssetId) {
      return Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
        requestVertexNormals: true,
        requestWaterMask: true,
      });
    }
    if (typeof Cesium.createWorldTerrainAsync === "function") {
      return Cesium.createWorldTerrainAsync({
        requestVertexNormals: true,
        requestWaterMask: true,
      });
    }
    if (typeof Cesium.createWorldTerrain === "function") {
      return Cesium.createWorldTerrain({
        requestVertexNormals: true,
        requestWaterMask: true,
      });
    }
    throw new Error("当前 CesiumJS 版本不支持 Cesium World Terrain。");
  }

  async function createImageryProvider(key) {
    if (key === "esri-world-imagery" && Cesium.ArcGisMapServerImageryProvider?.fromUrl) {
      return Cesium.ArcGisMapServerImageryProvider.fromUrl("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer");
    }
    if (key === "natural-earth") return createNaturalEarthImageryProvider();
    if (Cesium.OpenStreetMapImageryProvider) {
      return new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: "© OpenStreetMap contributors",
      });
    }
    return new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maximumLevel: 19,
      credit: "© OpenStreetMap contributors",
    });
  }

  function createNaturalEarthImageryProvider() {
    const options = {
      rectangle: Cesium.Rectangle.MAX_VALUE,
      credit: "Local generated globe texture",
    };
    const url = localGlobeTextureDataUrl();
    if (Cesium.SingleTileImageryProvider?.fromUrl) {
      return Cesium.SingleTileImageryProvider.fromUrl(url, options);
    }
    return new Cesium.SingleTileImageryProvider({ url, ...options });
  }

  function localGlobeTextureDataUrl() {
    if (localGlobeTextureUrl) return localGlobeTextureUrl;
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const width = canvas.width;
    const height = canvas.height;
    const x = (lon) => ((lon + 180) / 360) * width;
    const y = (lat) => ((90 - lat) / 180) * height;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#09213d");
    gradient.addColorStop(0.42, "#0d4f89");
    gradient.addColorStop(0.58, "#0d5c98");
    gradient.addColorStop(1, "#061a32");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const drawPolygon = (points, fill, stroke = "rgba(255,255,255,0.06)") => {
      ctx.beginPath();
      points.forEach(([lon, lat], index) => {
        const px = x(lon);
        const py = y(lat);
        if (index) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    const land = "#2f7041";
    const highland = "rgba(125, 111, 72, 0.46)";
    const arid = "rgba(169, 132, 82, 0.48)";
    const ice = "rgba(232, 244, 250, 0.8)";
    drawPolygon([[-168, 72], [-142, 62], [-124, 50], [-126, 34], [-104, 20], [-84, 9], [-62, 18], [-54, 46], [-74, 58], [-96, 70], [-132, 74]], land);
    drawPolygon([[-82, 12], [-74, -5], [-81, -20], [-70, -54], [-52, -56], [-38, -26], [-42, -4], [-58, 10]], "#357647");
    drawPolygon([[-18, 35], [6, 58], [42, 68], [96, 72], [146, 58], [176, 50], [160, 28], [112, 16], [76, 7], [46, 22], [28, 38], [8, 36]], land);
    drawPolygon([[-17, 33], [9, 34], [34, 21], [51, 8], [43, -28], [20, -35], [2, -29], [-14, 4]], "#7a6c3d");
    drawPolygon([[35, 32], [62, 39], [92, 34], [102, 24], [82, 7], [62, 18]], arid, "");
    drawPolygon([[58, 11], [96, 22], [108, 10], [104, -9], [86, -12], [76, 4]], "#3e7a44");
    drawPolygon([[110, 5], [130, 6], [146, -8], [139, -38], [116, -42], [102, -23]], "#9b7d4c");
    drawPolygon([[-52, 82], [-22, 78], [-18, 64], [-42, 58], [-62, 70]], ice);
    drawPolygon([[-180, -64], [-90, -72], [0, -66], [90, -72], [180, -64], [180, -90], [-180, -90]], ice);
    drawPolygon([[-125, 48], [-109, 42], [-103, 28], [-118, 28]], highland, "");
    drawPolygon([[68, 40], [100, 42], [106, 28], [76, 27]], highland, "");
    drawPolygon([[15, 28], [33, 26], [30, 10], [8, 12]], arid, "");

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) {
      ctx.beginPath();
      ctx.moveTo(x(lon), 0);
      ctx.lineTo(x(lon), height);
      ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y(lat));
      ctx.lineTo(width, y(lat));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    localGlobeTextureUrl = canvas.toDataURL("image/png");
    return localGlobeTextureUrl;
  }

  async function addImageryProvider(provider) {
    activeImageryLayer = viewer.imageryLayers.addImageryProvider(await provider);
    return activeImageryLayer;
  }

  function configureCreditContainer() {
    const container = viewer?.cesiumWidget?.creditContainer;
    if (!container) return;
    container.style.display = "";
    container.classList.add("cesium-attribution");
  }

  function configureCesiumRequestScheduler() {
    const scheduler = Cesium?.RequestScheduler;
    const settings = activeQualitySettings();
    if (!scheduler || !settings.requestsByServer) return;
    scheduler.requestsByServer[TILE_SERVER_KEY] = settings.requestsByServer;
  }

  function normalizeQualityProfileKey(value) {
    const key = String(value || "").trim().toLowerCase();
    if (QUALITY_PROFILES[key]) return key;
    if (key === "high" || key === "best" || key === "google-earth") return "quality";
    if (key === "normal" || key === "default") return "balanced";
    if (key === "low" || key === "fast") return "performance";
    return DEFAULT_QUALITY_PROFILE;
  }

  function activeQualitySettings() {
    return QUALITY_PROFILES[activeQualityProfile] || QUALITY_PROFILES[DEFAULT_QUALITY_PROFILE];
  }

  function activeRenderQualitySettings() {
    const settings = activeQualitySettings();
    if (!interactionQualityActive) return settings;
    return {
      ...settings,
      maximumScreenSpaceError: Math.max(settings.maximumScreenSpaceError, CAMERA_INTERACTION_QUALITY.maximumScreenSpaceError),
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: Math.max(settings.dynamicScreenSpaceErrorDensity || 0, CAMERA_INTERACTION_QUALITY.dynamicScreenSpaceErrorDensity),
      dynamicScreenSpaceErrorFactor: Math.max(settings.dynamicScreenSpaceErrorFactor || 0, CAMERA_INTERACTION_QUALITY.dynamicScreenSpaceErrorFactor),
      globeMaximumScreenSpaceError: Math.max(settings.globeMaximumScreenSpaceError || 2, CAMERA_INTERACTION_QUALITY.globeMaximumScreenSpaceError),
      resolutionScale: Math.min(settings.resolutionScale, CAMERA_INTERACTION_QUALITY.resolutionScale),
      msaaSamples: Math.min(settings.msaaSamples, CAMERA_INTERACTION_QUALITY.msaaSamples),
    };
  }

  function applyQualityProfileToViewer() {
    if (!viewer) return;
    const settings = activeRenderQualitySettings();
    viewer.resolutionScale = settings.resolutionScale;
    if ("msaaSamples" in viewer.scene) viewer.scene.msaaSamples = settings.msaaSamples;
    if (viewer.scene.globe && "maximumScreenSpaceError" in viewer.scene.globe) {
      viewer.scene.globe.maximumScreenSpaceError = settings.globeMaximumScreenSpaceError;
    }
    if (viewer.scene?.requestRender) viewer.scene.requestRender();
  }

  function applyQualityProfileToTileset() {
    if (!googleTileset) return;
    const settings = activeRenderQualitySettings();
    googleTileset.maximumScreenSpaceError = settings.maximumScreenSpaceError;
    googleTileset.dynamicScreenSpaceError = settings.dynamicScreenSpaceError;
    if (settings.dynamicScreenSpaceError) {
      googleTileset.dynamicScreenSpaceErrorDensity = settings.dynamicScreenSpaceErrorDensity;
      googleTileset.dynamicScreenSpaceErrorFactor = settings.dynamicScreenSpaceErrorFactor;
    }
    if ("cacheBytes" in googleTileset && settings.cacheBytes) {
      googleTileset.cacheBytes = settings.cacheBytes;
    }
  }

  function applyEarthVisualTreatment() {
    if (!viewer || !Cesium) return;
    const scene = viewer.scene;
    const treatment = EARTH_VISUAL_TREATMENT;
    scene.highDynamicRange = true;
    scene.backgroundColor = Cesium.Color.fromCssColorString("#03070d");
    scene.exposure = treatment.exposure;
    if (treatment.skyBox && Cesium.SkyBox) {
      earthSkyBox ||= createEarthSkyBox();
      scene.skyBox = earthSkyBox;
      scene.skyBox.show = true;
    } else if (scene.skyBox) {
      scene.skyBox.show = false;
    }
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.show = true;
      if ("hueShift" in scene.skyAtmosphere) scene.skyAtmosphere.hueShift = treatment.skyAtmosphere.hueShift;
      if ("saturationShift" in scene.skyAtmosphere) scene.skyAtmosphere.saturationShift = treatment.skyAtmosphere.saturationShift;
      if ("brightnessShift" in scene.skyAtmosphere) scene.skyAtmosphere.brightnessShift = treatment.skyAtmosphere.brightnessShift;
    }
    if (scene.globe) {
      if ("showGroundAtmosphere" in scene.globe) scene.globe.showGroundAtmosphere = true;
      if ("atmosphereHueShift" in scene.globe) scene.globe.atmosphereHueShift = treatment.groundAtmosphere.hueShift;
      if ("atmosphereSaturationShift" in scene.globe) scene.globe.atmosphereSaturationShift = treatment.groundAtmosphere.saturationShift;
      if ("atmosphereBrightnessShift" in scene.globe) scene.globe.atmosphereBrightnessShift = treatment.groundAtmosphere.brightnessShift;
      if ("atmosphereLightIntensity" in scene.globe) scene.globe.atmosphereLightIntensity = treatment.groundAtmosphere.lightIntensity;
    }
    if (scene.fog) {
      scene.fog.enabled = treatment.fog.enabled;
      scene.fog.density = treatment.fog.density;
      scene.fog.minimumBrightness = treatment.fog.minimumBrightness;
      if ("screenSpaceErrorFactor" in scene.fog) scene.fog.screenSpaceErrorFactor = treatment.fog.screenSpaceErrorFactor;
    }
  }

  function createEarthSkyBox() {
    return new Cesium.SkyBox({
      sources: {
        positiveX: starFieldDataUrl(11),
        negativeX: starFieldDataUrl(23),
        positiveY: starFieldDataUrl(37),
        negativeY: starFieldDataUrl(41),
        positiveZ: starFieldDataUrl(53),
        negativeZ: starFieldDataUrl(67),
      },
    });
  }

  function starFieldDataUrl(seed) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#000207";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let state = seed >>> 0;
    const next = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < 160; i += 1) {
      const x = next() * canvas.width;
      const y = next() * canvas.height;
      const radius = 0.25 + next() * 0.55;
      const alpha = 0.1 + next() * 0.32;
      ctx.beginPath();
      ctx.fillStyle = `rgba(235, 246, 255, ${alpha.toFixed(3)})`;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas.toDataURL("image/png");
  }

  function setQualityProfile(profile, options = {}) {
    const next = normalizeQualityProfileKey(profile);
    const changed = next !== activeQualityProfile;
    activeQualityProfile = next;
    configureCesiumRequestScheduler();
    applyQualityProfileToViewer();
    applyQualityProfileToTileset();
    if (changed || options.forceEvent) {
      updateAllUi();
      scheduleReplaceUrlState();
      emitWeatherEarthEvent("qualitychange", { qualityProfile: qualityProfileState(), metrics: captureMetrics() });
    }
    return qualityProfileState();
  }

  function configuredIonToken() {
    const params = new URLSearchParams(window.location.search);
    const config = globalThis.WEATHER_EARTH_CONFIG || {};
    return String(
      params.get("cesiumIonToken") ||
      params.get("ionToken") ||
      config.cesiumIonToken ||
      config.ionToken ||
      sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
      ""
    ).trim();
  }

  function showTokenPanel(message, providerId = currentBaseMapKey) {
    if (!elements.earthMap) return;
    removeTokenPanel();
    const provider = baseMapProvider(providerId);
    tokenPanel = document.createElement("div");
    tokenPanel.className = "cesium-token-panel";
    tokenPanel.innerHTML = `
      <strong>需要 Cesium ion token</strong>
      <p>${escapeHtml(message)}</p>
      <label>
        <span>临时 token</span>
        <input type="password" autocomplete="off" placeholder="Cesium ion access token" />
      </label>
      <div>
        <button type="button" data-action="load-token">加载 ${escapeHtml(provider.shortLabel)}</button>
        <button type="button" data-action="dismiss-token" class="secondary">稍后配置</button>
      </div>
      <small>本输入只保存到当前浏览器会话；没有 token 时页面会继续使用开放底座。</small>
    `;
    elements.earthMap.appendChild(tokenPanel);
    tokenPanel.querySelector("[data-action='load-token']").addEventListener("click", () => {
      const token = tokenPanel.querySelector("input").value.trim();
      if (!token) return;
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      loadBaseMapProvider(provider.id, { notify: true });
    });
    tokenPanel.querySelector("[data-action='dismiss-token']").addEventListener("click", removeTokenPanel);
  }

  function removeTokenPanel() {
    tokenPanel?.remove();
    tokenPanel = null;
  }

  function bootstrapControls() {
    if (elements.weatherOpacity) currentWeatherOpacity = Number(elements.weatherOpacity.value || DEFAULT_WEATHER_OPACITY);
    if (elements.immersiveWeatherOpacity) elements.immersiveWeatherOpacity.value = String(currentWeatherOpacity);
    if (elements.placePreset) {
      elements.placePreset.innerHTML = EARTH_PLACE_PRESETS.map((place) => `<option value="${place.id}">${place.label}</option>`).join("");
    }
    for (const select of [elements.baseMapStyle, elements.immersiveBaseMapStyle]) {
      if (select) {
        select.innerHTML = baseMapOptionsHtml();
      }
    }
    elements.manifestUrlInput && (elements.manifestUrlInput.value = DEFAULT_MANIFEST_URL);
    elements.geoJsonUrlInput && (elements.geoJsonUrlInput.value = DEFAULT_GEOJSON_URL);
  }

  function bindDomEvents() {
    on(elements.projectionGlobe, "click", () => setProjection("globe"));
    on(elements.projectionMap, "click", () => setProjection("globe"));
    on(elements.scenePresetShowcase, "click", () => applyScenePreset("showcase"));
    on(elements.scenePresetAudit, "click", () => applyScenePreset("audit"));
    on(elements.scenePresetCity, "click", () => applyScenePreset("city"));
    on(elements.loadDefaultWeather, "click", () => loadDefaultWeather());
    on(elements.fitWeather, "click", () => fitCurrentGeoJson());
    on(elements.flyToPlace, "click", () => flyToPlace(elements.placePreset?.value || "china"));
    on(elements.locationSearchButton, "click", () => flyToSearch(elements.locationSearchInput?.value || ""));
    on(elements.locationSearchInput, "keydown", (event) => { if (event.key === "Enter") flyToSearch(elements.locationSearchInput.value); });
    on(elements.immersiveSearchButton, "click", () => flyToSearch(elements.immersiveSearchInput?.value || ""));
    on(elements.immersiveSearchInput, "keydown", (event) => { if (event.key === "Enter") flyToSearch(elements.immersiveSearchInput.value); });
    on(elements.focusCurrentView, "click", () => focusCurrentCameraCenter());
    on(elements.immersiveFocusCenter, "click", () => focusCurrentCameraCenter());
    on(elements.clearFocusTarget, "click", () => clearFocusTargetState({ eventReason: "focus-clear" }));
    on(elements.autoRotateGlobe, "change", () => setAutoRotate(Boolean(elements.autoRotateGlobe.checked)));
    on(elements.focusOrbitEnabled, "change", () => setFocusOrbitEnabled(Boolean(elements.focusOrbitEnabled.checked)));
    on(elements.immersiveFocusOrbit, "click", () => setFocusOrbitEnabled(!focusOrbitEnabled));
    on(elements.baseMapStyle, "change", () => setBaseMapStyle(elements.baseMapStyle.value));
    on(elements.immersiveBaseMapStyle, "change", () => setBaseMapStyle(elements.immersiveBaseMapStyle.value));
    on(elements.mapDetailsEnabled, "change", () => setMapDetailsEnabled(Boolean(elements.mapDetailsEnabled.checked)));
    on(elements.immersiveMapDetailsEnabled, "change", () => setMapDetailsEnabled(Boolean(elements.immersiveMapDetailsEnabled.checked)));
    on(elements.terrainEnabled, "change", () => setTerrainEnabled(Boolean(elements.terrainEnabled.checked)));
    on(elements.immersiveTerrainEnabled, "change", () => setTerrainEnabled(Boolean(elements.immersiveTerrainEnabled.checked)));
    on(elements.terrainExaggeration, "input", () => setTerrainExaggeration(elements.terrainExaggeration.value));
    on(elements.sunlightEnabled, "change", () => setSunlightEnabled(Boolean(elements.sunlightEnabled.checked)));
    on(elements.immersiveSunlightEnabled, "change", () => setSunlightEnabled(Boolean(elements.immersiveSunlightEnabled.checked)));
    on(elements.sunlightIntensity, "input", () => setSunlightIntensity(elements.sunlightIntensity.value));
    on(elements.buildingsEnabled, "change", () => setBuildingsEnabled(Boolean(elements.buildingsEnabled.checked)));
    on(elements.immersiveBuildingsEnabled, "change", () => setBuildingsEnabled(Boolean(elements.immersiveBuildingsEnabled.checked)));
    on(elements.buildingHeightScale, "input", () => setBuildingHeightScale(elements.buildingHeightScale.value));
    on(elements.addCameraTourStop, "click", () => addCurrentCameraTourStop());
    on(elements.immersiveAddTourStop, "click", () => addCurrentCameraTourStop({ label: `沉浸镜头 ${cameraTourStops.length + 1}` }));
    on(elements.playCameraTour, "click", () => playCameraTourPlayback());
    on(elements.immersivePlayTour, "click", () => playCameraTourPlayback());
    on(elements.clearCameraTour, "click", () => clearCameraTourStops());
    on(elements.loadGeoJsonUrl, "click", () => loadGeoJsonFromUrl(elements.geoJsonUrlInput?.value || ""));
    on(elements.geoJsonFileInput, "change", () => loadGeoJsonFromFile(elements.geoJsonFileInput.files?.[0]));
    on(elements.saveBrowserDraft, "click", () => saveBrowserDraft());
    on(elements.restoreBrowserDraft, "click", () => restoreBrowserDraft());
    on(elements.normalizeWeatherGeoJson, "click", () => normalizeCurrentWeatherGeoJson());
    on(elements.downloadProject, "click", () => downloadProjectDocument());
    on(elements.projectFileInput, "change", () => loadProjectFromFile(elements.projectFileInput.files?.[0]));
    on(elements.downloadGeoJson, "click", () => downloadJsonPayload(currentExportGeoJson(), geoJsonFileName(currentGeoJsonName), "application/geo+json;charset=utf-8"));
    on(elements.downloadVisibleGeoJson, "click", () => downloadJsonPayload(currentExportGeoJson({ visible: true }), geoJsonFileName(currentGeoJsonName, "visible"), "application/geo+json;charset=utf-8"));
    on(elements.copyShareUrl, "click", () => copyShareUrl(buildShareUrl()));
    on(elements.copyInlineShareUrl, "click", () => copyShareUrl(buildInlineDataShareUrl()));
    on(elements.copyProjectShareUrl, "click", () => copyShareUrl(buildInlineProjectShareUrl()));
    on(elements.clearWeather, "click", () => clearWeatherLayers());
    on(elements.weatherOpacity, "input", () => setWeatherOpacity(elements.weatherOpacity.value));
    on(elements.immersiveWeatherOpacity, "input", () => setWeatherOpacity(elements.immersiveWeatherOpacity.value));
    on(elements.weather3dEnabled, "change", () => setWeather3dEnabled(Boolean(elements.weather3dEnabled.checked)));
    on(elements.weather3dScale, "input", () => setWeather3dScale(elements.weather3dScale.value));
    on(elements.weatherVolumeEnabled, "change", () => setWeatherVolumeEnabled(Boolean(elements.weatherVolumeEnabled.checked)));
    on(elements.weatherVolumeScale, "input", () => setWeatherVolumeScale(elements.weatherVolumeScale.value));
    on(elements.drawPoint, "click", () => startDrawMode("Point"));
    on(elements.drawLine, "click", () => startDrawMode("LineString"));
    on(elements.drawPolygon, "click", () => startDrawMode("Polygon"));
    on(elements.finishDraw, "click", () => finishDrawFeature());
    on(elements.undoDrawPoint, "click", () => undoDrawPoint());
    on(elements.cancelDraw, "click", () => cancelDrawMode());
    on(elements.measureDistance, "click", () => startMeasureMode("distance"));
    on(elements.measureArea, "click", () => startMeasureMode("area"));
    on(elements.finishMeasure, "click", () => finishMeasurementTool());
    on(elements.undoMeasurePoint, "click", () => undoMeasurePoint());
    on(elements.clearMeasure, "click", () => clearMeasurementState());
    on(elements.clearFeatureSelection, "click", () => selectFeatureById(""));
    on(elements.applyWeatherTemplate, "click", () => applySelectedWeatherTemplate());
    on(elements.formatSelectedProperties, "click", () => formatTextareaJson(elements.selectedProperties));
    on(elements.formatSelectedGeometry, "click", () => formatTextareaJson(elements.selectedGeometry));
    on(elements.updateSelectedFeature, "click", () => updateSelectedFeatureFromEditor());
    on(elements.deleteSelectedFeature, "click", () => deleteWeatherFeature(selectedFeatureId));
    on(elements.fitSelectedFeature, "click", () => fitFeatureById(selectedFeatureId));
    on(elements.featureSearch, "input", () => renderFeatureList());
    on(elements.timeFilterSelect, "change", () => setTimeFilter(elements.timeFilterSelect.value));
    on(elements.immersiveTimeFilterSelect, "change", () => setTimeFilter(elements.immersiveTimeFilterSelect.value));
    on(elements.resetTimeFilter, "click", () => setTimeFilter(TIME_FILTER_ALL));
    on(elements.immersiveTimeAll, "click", () => setTimeFilter(TIME_FILTER_ALL));
    on(elements.showUntimedFeatures, "change", () => { showUntimedFeatures = Boolean(elements.showUntimedFeatures.checked); renderWeather(); emitWeatherEarthChange("untimedchange"); });
    on(elements.showAllElementTypes, "click", () => setAllElementTypeVisibility(true));
    on(elements.hideAllElementTypes, "click", () => setAllElementTypeVisibility(false));
    on(elements.applyGeoJsonEditor, "click", () => applyGeoJsonEditor());
    on(elements.formatGeoJsonEditor, "click", () => formatTextareaJson(elements.geoJsonEditor));
    on(elements.validateGeoJson, "click", () => updateValidationSummary(true));
    on(elements.downloadValidationReport, "click", () => downloadJsonPayload(buildValidationReport(), "weather-earth-validation-report.json", "application/json;charset=utf-8"));
    on(elements.loadManifestUrl, "click", () => loadManifestFromUrl(elements.manifestUrlInput?.value || DEFAULT_MANIFEST_URL));
    on(elements.loadDefaultManifest, "click", () => loadManifestFromUrl(DEFAULT_MANIFEST_URL));
    on(elements.playManifest, "click", () => toggleManifestPlayback());
    on(elements.resetManifest, "click", () => resetManifest());
    on(elements.immersiveProcessPlay, "click", () => toggleManifestPlayback());
    on(elements.immersiveProcessPrev, "click", () => stepManifest(-1));
    on(elements.immersiveProcessNext, "click", () => stepManifest(1));
    on(elements.immersiveProcessRange, "input", () => setManifestIndex(Number(elements.immersiveProcessRange.value)));
    on(elements.cameraZoomIn, "click", () => zoomCamera(-0.8));
    on(elements.cameraZoomOut, "click", () => zoomCamera(0.8));
    on(elements.cameraRotateLeft, "click", () => rotateCamera(-12));
    on(elements.cameraRotateRight, "click", () => rotateCamera(12));
    on(elements.cameraTiltUp, "click", () => tiltCamera(8));
    on(elements.cameraTiltDown, "click", () => tiltCamera(-8));
    on(elements.cameraPitchSlider, "input", () => setCameraPitch(elements.cameraPitchSlider.value, { duration: 0 }));
    on(elements.cameraHome, "click", () => resetCameraView({ duration: 0.45 }));
    on(elements.cameraNorth, "click", () => flyToCamera({ ...currentCameraState(), bearing: 0 }));
    on(elements.toggleImmersive, "click", () => toggleEarthMenu());
    on(elements.earthMenuWorkbench, "click", () => { setEarthMenuOpen(false); applyImmersiveMode(false); });
    on(elements.earthMenuReset, "click", () => { setEarthMenuOpen(false); resetCameraView({ duration: 0.45 }); });
    on(elements.earthMenuTopDown, "click", () => { setEarthMenuOpen(false); setCameraTopDown({ duration: 0.35 }); });
    on(elements.earthMenuOblique, "click", () => { setEarthMenuOpen(false); toggleCameraOblique({ duration: 0.35 }); });
    on(elements.immersiveExitPanel, "click", () => applyImmersiveMode(false));
    on(elements.earthOverview, "click", () => flyToCamera(defaultCameraView()));
    document.addEventListener("pointerdown", handleEarthMenuPointerDown, true);
    window.addEventListener("keydown", handleKeyboard);
    window.addEventListener("keyup", handleKeyboardKeyUp);
    window.addEventListener("blur", clearKeyboardNavigation);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearKeyboardNavigation(); });
  }

  function initializeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    applyInitialFlags(params);
    if (params.get("project")) {
      loadProjectFromParam(params.get("project"));
    } else if (params.get("manifest")) {
      loadManifestFromUrl(params.get("manifest"));
    } else if (params.get("data")) {
      loadGeoJsonFromUrl(params.get("data"), "", { shareType: "data", shareValue: params.get("data") });
    } else if (params.get("weather") === "0" || params.get("weather") === "false") {
      setStatus("纯 Cesium 地球视图。", "未加载默认天气 GeoJSON。");
    } else {
      loadDefaultWeather({ silentNotFound: true });
    }
    const map = parseMapParam(params.get("map"));
    if (map) flyToCamera(map, { duration: 0 });
  }

  function initialBaseMapKeyFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return normalizeBaseMapKey(params.get("basemap") || params.get("tileset") || params.get("provider") || currentBaseMapKey);
  }

  function applyInitialFlags(params) {
    if (params.get("terrain") === "0" || params.get("terrain") === "false") terrainEnabled = false;
    if (isFiniteNumber(params.get("terrainExag"))) terrainExaggeration = clamp(Number(params.get("terrainExag")), 0.3, 2.5);
    if (params.get("sunlight") === "1" || params.get("sunlight") === "true") sunlightEnabled = true;
    if (params.get("sunlight") === "0" || params.get("sunlight") === "false") sunlightEnabled = false;
    if (isFiniteNumber(params.get("sunlightIntensity"))) sunlightIntensity = clamp(Number(params.get("sunlightIntensity")), 0.2, 1);
    if (params.get("buildings") === "0" || params.get("buildings") === "false") buildingsEnabled = false;
    if (isFiniteNumber(params.get("buildingScale"))) buildingHeightScale = clamp(Number(params.get("buildingScale")), 0.5, 2);
    if (params.get("weather3d") === "0" || params.get("weather3d") === "false") weather3dEnabled = false;
    if (isFiniteNumber(params.get("weather3dScale"))) weather3dScale = clamp(Number(params.get("weather3dScale")), 0.4, 2.5);
    if (params.get("weatherVolume") === "0" || params.get("weatherVolume") === "false") weatherVolumeEnabled = false;
    if (isFiniteNumber(params.get("weatherVolumeScale"))) weatherVolumeScale = clamp(Number(params.get("weatherVolumeScale")), 0.25, 2.5);
    if (params.get("rotate") === "0" || params.get("rotate") === "false") autoRotateEnabled = false;
    if (params.get("focusOrbit") === "1" || params.get("focusOrbit") === "true") focusOrbitEnabled = true;
    if (params.get("immersive") === "1" || params.get("immersive") === "true") immersiveEnabled = true;
    if (params.get("immersive") === "0" || params.get("immersive") === "false") immersiveEnabled = false;
    if (params.get("basemap") || params.get("tileset") || params.get("provider")) currentBaseMapKey = normalizeBaseMapKey(params.get("basemap") || params.get("tileset") || params.get("provider"));
    if (params.get("quality") || params.get("qualityProfile")) setQualityProfile(params.get("quality") || params.get("qualityProfile"), { forceEvent: false });
    if (params.get("time")) activeTimeFilter = params.get("time");
    if (params.get("sunTime") || params.get("sunlightTime")) {
      setSunlightTime(params.get("sunTime") || params.get("sunlightTime"), { source: "url", fallbackRealtime: true });
    } else if (params.get("time")) {
      syncSunlightClockFromActiveTime({ source: "url-time", notify: false });
    }
    if (params.get("untimed") === "0" || params.get("untimed") === "false") showUntimedFeatures = false;
    if (isFiniteNumber(params.get("opacity"))) currentWeatherOpacity = clamp(Number(params.get("opacity")), 0.15, 0.9);
  }

  async function loadDefaultWeather(options = {}) {
    try {
      await loadGeoJsonFromUrl(DEFAULT_GEOJSON_URL, "默认风区", { shareType: "", shareValue: "", silentNotFound: options.silentNotFound });
    } catch (error) {
      if (!options.silentNotFound) setStatus("默认风区加载失败。", error.message || String(error));
    }
  }

  async function loadGeoJsonFromUrl(url, label = "", options = {}) {
    const value = String(url || "").trim();
    if (!value) {
      setStatus("GeoJSON URL 为空。", "请输入 GeoJSON 地址。");
      return;
    }
    setStatus("正在加载 GeoJSON...", value);
    const response = await fetch(value, { cache: "no-store" });
    if (!response.ok) {
      if (options.silentNotFound) return;
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    setWeatherGeoJson(payload, label || readableNameFromUrl(response.url || value) || "weather.geojson", {
      fit: options.fit !== false,
      persist: true,
      sourceType: options.shareType || "url",
      sourceValue: options.shareValue || value,
      sourceLabel: label || value,
    });
    setShareSource(options.shareType || "data", options.shareValue || value);
  }

  async function loadGeoJsonFromFile(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      setWeatherGeoJson(payload, file.name, { fit: true, persist: true, sourceType: "file", sourceLabel: file.name });
      setStatus("本地 GeoJSON 已加载。", file.name);
    } catch (error) {
      setStatus("本地 GeoJSON 加载失败。", error.message || String(error));
    } finally {
      if (elements.geoJsonFileInput) elements.geoJsonFileInput.value = "";
    }
  }

  function setWeatherGeoJson(payload, name = "weather.geojson", options = {}) {
    currentGeoJson = normalizeFeatureCollection(payload);
    currentGeoJsonName = name || currentGeoJson.name || "weather.geojson";
    currentGeoJsonMeta = {
      sourceType: options.sourceType || "manual",
      sourceValue: options.sourceValue || "",
      sourceLabel: options.sourceLabel || currentGeoJsonName,
      loadedAt: new Date().toISOString(),
    };
    ensureFeatureIds(currentGeoJson);
    syncDynamicElementTypes();
    if (options.persist) saveSessionGeoJson();
    if (options.syncEditor !== false) syncGeoJsonEditor();
    renderWeather();
    updateAllUi();
    setStatus("GeoJSON 已加载。", `${currentGeoJsonName} / ${currentGeoJson.features.length} 个要素`);
    if (options.fit) fitCurrentGeoJson();
    emitWeatherEarthChange(options.eventReason || "geojson-load");
    return weatherEarthApi.getState();
  }

  function appendWeatherGeoJson(payload, name = currentGeoJsonName, options = {}) {
    const next = normalizeFeatureCollection(payload);
    ensureFeatureIds(next);
    currentGeoJson.features.push(...next.features);
    currentGeoJsonName = name || currentGeoJsonName;
    syncDynamicElementTypes();
    renderWeather();
    updateAllUi();
    if (options.fit) fitCurrentGeoJson();
    emitWeatherEarthChange("geojson-append");
    return weatherEarthApi.getState();
  }

  function clearWeatherLayers() {
    currentGeoJson = emptyFeatureCollection();
    displayedGeoJson = emptyFeatureCollection();
    selectedFeatureId = "";
    currentGeoJsonName = "weather-earth.geojson";
    currentGeoJsonMeta = {};
    setShareSource("", "");
    renderWeather();
    syncGeoJsonEditor();
    updateAllUi();
    emitWeatherEarthChange("weather-clear");
    return weatherEarthApi.getState();
  }

  function renderWeather() {
    removeEntityList(weatherEntities);
    weatherEntities = [];
    displayedGeoJson = currentExportGeoJson({ visible: true });
    for (const feature of displayedGeoJson.features) {
      renderFeature(feature);
    }
    renderUtilityLayers();
    updateAllUi();
    viewer?.scene.requestRender();
  }

  function renderFeature(feature) {
    const geometry = feature.geometry;
    if (!geometry) return;
    const id = feature.properties?.[FEATURE_ID_PROPERTY] || "";
    const color = featureColor(feature);
    const alpha = currentWeatherOpacity;
    if (geometry.type === "Point") renderPointFeature(feature, geometry.coordinates, color, id);
    if (geometry.type === "MultiPoint") geometry.coordinates.forEach((coord) => renderPointFeature(feature, coord, color, id));
    if (geometry.type === "LineString") renderLineFeature(feature, geometry.coordinates, color, id);
    if (geometry.type === "MultiLineString") geometry.coordinates.forEach((line) => renderLineFeature(feature, line, color, id));
    if (geometry.type === "Polygon") renderPolygonFeature(feature, geometry.coordinates, color, id, alpha);
    if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => renderPolygonFeature(feature, polygon, color, id, alpha));
  }

  function renderPointFeature(feature, coordinate, color, featureId) {
    if (!validLonLat(coordinate?.[0], coordinate?.[1])) return;
    const lon = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    const label = featureLabel(feature);
    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 45),
      point: {
        pixelSize: 12,
        color: color.withAlpha(0.95),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: label ? {
        text: label,
        font: "600 13px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.72),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
    });
    attachEntityFeature(entity, featureId);
    weatherEntities.push(entity);
    if (weather3dEnabled) {
      const height = 900 * weather3dScale;
      const beacon = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height / 2),
        cylinder: {
          length: height,
          topRadius: 18,
          bottomRadius: 42,
          material: color.withAlpha(0.25),
          outline: true,
          outlineColor: color.withAlpha(0.45),
        },
      });
      attachEntityFeature(beacon, featureId);
      weatherEntities.push(beacon);
    }
  }

  function renderLineFeature(feature, coordinates, color, featureId) {
    const positions = coordinatesToPositions(coordinates);
    if (positions.length < 2) return;
    const entity = viewer.entities.add({
      polyline: {
        positions,
        width: 4,
        material: color.withAlpha(0.85),
        clampToGround: true,
      },
    });
    attachEntityFeature(entity, featureId);
    weatherEntities.push(entity);
    const label = featureLabel(feature);
    const center = centerOfCoordinates(coordinates);
    if (label && center) {
      const labelEntity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 80),
        label: {
          text: label,
          font: "600 13px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      attachEntityFeature(labelEntity, featureId);
      weatherEntities.push(labelEntity);
    }
  }

  function renderPolygonFeature(feature, rings, color, featureId, alpha) {
    if (!rings?.[0]?.length) return;
    const hierarchy = polygonHierarchy(rings);
    if (!hierarchy) return;
    const volumeHeight = weatherVolumeEnabled ? featureVolumeHeight(feature) : 0;
    const entity = viewer.entities.add({
      polygon: {
        hierarchy,
        material: color.withAlpha(weatherVolumeEnabled ? Math.min(0.42, alpha) : alpha),
        outline: false,
        perPositionHeight: false,
        height: weatherVolumeEnabled ? 80 : 10,
        extrudedHeight: weatherVolumeEnabled ? volumeHeight : undefined,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    attachEntityFeature(entity, featureId);
    weatherEntities.push(entity);
    const outline = viewer.entities.add({
      polyline: {
        positions: coordinatesToPositions(rings[0]),
        width: featureId === selectedFeatureId ? 5 : 2,
        material: (featureId === selectedFeatureId ? Cesium.Color.WHITE : color).withAlpha(0.95),
        clampToGround: true,
      },
    });
    attachEntityFeature(outline, featureId);
    weatherEntities.push(outline);
    const label = featureLabel(feature);
    const center = centerOfCoordinates(rings[0]);
    if (label && center) {
      const labelEntity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, Math.max(volumeHeight, 180)),
        label: {
          text: label,
          font: "700 13px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.82),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      attachEntityFeature(labelEntity, featureId);
      weatherEntities.push(labelEntity);
    }
  }

  function attachEntityFeature(entity, featureId) {
    entity.__weatherFeatureId = featureId;
    if (entity.id) entity.id.__weatherFeatureId = featureId;
  }

  function renderUtilityLayers() {
    removeEntityList(utilityEntities);
    utilityEntities = [];
    renderFocusTarget();
    renderSurfaceProbe();
    renderSelectionOutline();
    renderDrawDraft();
    renderMeasurement();
  }

  function renderFocusTarget() {
    if (!focusTarget || !validLonLat(focusTarget.lon, focusTarget.lat)) return;
    const color = Cesium.Color.CYAN;
    utilityEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(focusTarget.lon, focusTarget.lat, 120),
      ellipse: {
        semiMajorAxis: 36000,
        semiMinorAxis: 36000,
        material: color.withAlpha(0.08),
        outline: true,
        outlineColor: color.withAlpha(0.9),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: focusTarget.label || "聚焦目标",
        font: "700 14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
    utilityEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(focusTarget.lon, focusTarget.lat, 1600),
      cylinder: {
        length: 3200,
        topRadius: 120,
        bottomRadius: 360,
        material: color.withAlpha(0.18),
        outline: true,
        outlineColor: color.withAlpha(0.5),
      },
    }));
  }

  function renderSurfaceProbe() {
    if (!surfaceProbe || !validLonLat(surfaceProbe.lon, surfaceProbe.lat)) return;
    utilityEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(surfaceProbe.lon, surfaceProbe.lat, 90),
      point: {
        pixelSize: 9,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: surfaceProbe.label || formatLngLat(surfaceProbe.lon, surfaceProbe.lat),
        font: "600 12px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, 18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
  }

  function renderSelectionOutline() {
    const feature = findFeatureById(selectedFeatureId);
    if (!feature?.geometry) return;
    forEachCoordinateSet(feature.geometry, (coordinates, type) => {
      if (type === "Point") {
        utilityEntities.push(viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], 140),
          ellipse: {
            semiMajorAxis: 1200,
            semiMinorAxis: 1200,
            material: Cesium.Color.WHITE.withAlpha(0.08),
            outline: true,
            outlineColor: Cesium.Color.WHITE,
          },
        }));
      } else if (type === "LineString") {
        const positions = coordinatesToPositions(coordinates);
        if (positions.length > 1) {
          utilityEntities.push(viewer.entities.add({ polyline: { positions, width: 7, material: Cesium.Color.WHITE.withAlpha(0.92), clampToGround: true } }));
        }
      } else if (type === "Polygon") {
        const positions = coordinatesToPositions(coordinates[0]);
        if (positions.length > 2) {
          utilityEntities.push(viewer.entities.add({ polyline: { positions, width: 5, material: Cesium.Color.WHITE.withAlpha(0.96), clampToGround: true } }));
        }
      }
    });
  }

  function renderDrawDraft() {
    removeEntityList(drawEntities);
    drawEntities = [];
    if (!drawMode || !drawCoordinates.length) return;
    const color = cssColor(elements.drawColor?.value || "#ffbd59");
    const positions = coordinatesToPositions(drawCoordinates.map((p) => [p.lon, p.lat]));
    for (const point of drawCoordinates) {
      drawEntities.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 60),
        point: { pixelSize: 8, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      }));
    }
    if (drawMode === "LineString" && positions.length > 1) {
      drawEntities.push(viewer.entities.add({ polyline: { positions, width: 3, material: color.withAlpha(0.9), clampToGround: true } }));
    }
    if (drawMode === "Polygon" && positions.length > 2) {
      const closed = [...drawCoordinates.map((p) => [p.lon, p.lat]), [drawCoordinates[0].lon, drawCoordinates[0].lat]];
      drawEntities.push(viewer.entities.add({
        polygon: { hierarchy: polygonHierarchy([closed]), material: color.withAlpha(0.25), height: 20 },
      }));
      drawEntities.push(viewer.entities.add({ polyline: { positions: coordinatesToPositions(closed), width: 3, material: color.withAlpha(0.9), clampToGround: true } }));
    }
  }

  function renderMeasurement() {
    removeEntityList(measurementEntities);
    measurementEntities = [];
    const coords = measurementState.coordinates;
    if (!coords.length) return;
    const positions = coordinatesToPositions(coords.map((p) => [p.lon, p.lat]));
    coords.forEach((point) => {
      measurementEntities.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 80),
        point: { pixelSize: 8, color: Cesium.Color.LIME, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      }));
    });
    if (positions.length > 1) {
      measurementEntities.push(viewer.entities.add({ polyline: { positions, width: 3, material: Cesium.Color.LIME.withAlpha(0.95), clampToGround: true } }));
    }
    if (measurementState.mode === "area" && positions.length > 2) {
      measurementEntities.push(viewer.entities.add({ polygon: { hierarchy: polygonHierarchy([coords.map((p) => [p.lon, p.lat])]), material: Cesium.Color.LIME.withAlpha(0.12), height: 15 } }));
    }
  }

  function removeEntityList(list) {
    if (!viewer) return;
    for (const entity of list) viewer.entities.remove(entity);
    list.length = 0;
  }

  function setProjection(projection) {
    currentProjection = "globe";
    setStatus("Cesium Globe 使用三维地球。", projection === "mercator" ? "旧平面参数已兼容读取，但渲染固定为 Cesium 3D。" : "三维地球模式。");
    updateAllUi();
    emitWeatherEarthEvent("projectionchange", { projection: currentProjection });
    return currentProjection;
  }

  async function setBaseMapStyle(key) {
    currentBaseMapKey = normalizeBaseMapKey(key);
    await loadBaseMapProvider(currentBaseMapKey, { notify: true });
    updateAllUi();
    return currentBaseMapKey;
  }

  function normalizeBaseMapKey(key) {
    const normalized = String(key || "").trim().toLowerCase();
    if (BASEMAP_PROVIDERS[normalized]) return normalized;
    if (normalized === "google" || normalized === "google-3d" || normalized === "photorealistic") return GOOGLE_TILESET_MODE;
    if (normalized === "world-terrain" || normalized === "terrain" || normalized === "cesium") return DEFAULT_TILESET_MODE;
    if (normalized === "osm" || normalized === "openstreetmap") return "openstreetmap-imagery";
    if (normalized === "esri" || normalized === "arcgis" || normalized === "satellite") return "esri-world-imagery";
    if (normalized === "naturalearth" || normalized === "local") return "natural-earth";
    return TILESET_MODE;
  }

  function baseMapProvider(key = currentBaseMapKey) {
    return BASEMAP_PROVIDERS[normalizeBaseMapKey(key)] || BASEMAP_PROVIDERS[TILESET_MODE];
  }

  function activeBaseMapProvider() {
    return baseMapProvider(activeBaseMapFallback || currentBaseMapKey);
  }

  function baseMapOptionsHtml() {
    return Object.values(BASEMAP_PROVIDERS)
      .map((provider) => `<option value="${provider.id}">${escapeHtml(provider.label)}</option>`)
      .join("");
  }

  function applyScenePreset(key, options = {}) {
    const preset = SCENE_PRESETS[key] || SCENE_PRESETS.showcase;
    activeScenePreset = key in SCENE_PRESETS ? key : "showcase";
    const settings = preset.settings;
    currentProjection = "globe";
    currentBaseMapKey = TILESET_MODE;
    terrainEnabled = settings.terrain;
    sunlightEnabled = settings.sunlight;
    buildingsEnabled = settings.buildings;
    weather3dEnabled = settings.weather3d;
    weatherVolumeEnabled = settings.weatherVolume;
    autoRotateEnabled = settings.autoRotate;
    currentWeatherOpacity = settings.weatherOpacity;
    sunlightIntensity = settings.sunlightIntensity;
    weather3dScale = settings.weather3dScale;
    weatherVolumeScale = settings.weatherVolumeScale;
    loadBaseMapProvider(currentBaseMapKey, { notify: options.notify !== false });
    applyCesiumLighting();
    renderWeather();
    updateAllUi();
    if (options.notify !== false) emitWeatherEarthEvent("scenechange", { scenePreset: scenePresetState() });
    return scenePresetState();
  }

  function setMapDetailsEnabled(enabled) {
    mapDetailsEnabled = Boolean(enabled);
    const provider = baseMapProvider(currentBaseMapKey);
    setStatus(mapDetailsEnabled ? "地图细节已开启。" : "地图细节状态已记录。", provider.detail);
    updateAllUi();
    emitWeatherEarthEvent("mapdetailschange", { mapDetails: mapDetailState() });
    return mapDetailState();
  }

  function setTerrainEnabled(enabled) {
    terrainEnabled = Boolean(enabled);
    applyTerrainProviderState();
    updateAllUi();
    emitWeatherEarthEvent("terrainchange", { terrain: terrainState() });
    return terrainState();
  }

  function setTerrainExaggeration(value) {
    terrainExaggeration = clamp(Number(value), 0.3, 2.5);
    applyTerrainProviderState();
    updateAllUi();
    emitWeatherEarthEvent("terrainchange", { terrain: terrainState() });
    return terrainState();
  }

  function applyTerrainProviderState() {
    if (!viewer || !Cesium || baseMapProvider(currentBaseMapKey).id === GOOGLE_TILESET_MODE) return;
    if (baseMapProvider(currentBaseMapKey).supportsTerrain && activeTerrainProvider && terrainEnabled) {
      viewer.terrainProvider = activeTerrainProvider;
    } else {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
    if ("verticalExaggeration" in viewer.scene) viewer.scene.verticalExaggeration = terrainEnabled ? terrainExaggeration : 1;
    if (viewer.scene.globe && "terrainExaggeration" in viewer.scene.globe) {
      viewer.scene.globe.terrainExaggeration = terrainEnabled ? terrainExaggeration : 1;
    }
    viewer.scene.requestRender?.();
  }

  function setSunlightEnabled(enabled) {
    sunlightEnabled = Boolean(enabled);
    applyCesiumLighting();
    syncSunlightClock({ force: true });
    updateAllUi();
    emitWeatherEarthEvent("sunlightchange", { sunlight: sunlightState() });
    return sunlightState();
  }

  function setSunlightIntensity(value) {
    sunlightIntensity = clamp(Number(value), 0.2, 1);
    applyCesiumLighting();
    updateAllUi();
    emitWeatherEarthEvent("sunlightchange", { sunlight: sunlightState() });
    return sunlightState();
  }

  function applyCesiumLighting() {
    if (!viewer || !Cesium) return;
    applyEarthVisualTreatment();
    viewer.scene.sun.show = sunlightEnabled;
    viewer.scene.moon.show = sunlightEnabled;
    viewer.scene.skyAtmosphere.show = true;
    if (viewer.scene.globe) viewer.scene.globe.enableLighting = sunlightEnabled;
    try {
      viewer.scene.light = new Cesium.SunLight({
        intensity: sunlightEnabled
          ? SUNLIGHT_BASE_INTENSITY + sunlightIntensity * SUNLIGHT_RANGE_INTENSITY
          : SUNLIGHT_DISABLED_INTENSITY
      });
    } catch {
      // Older Cesium builds may not expose SunLight constructor.
    }
  }

  function syncSunlightClock(options = {}) {
    if (!viewer || !Cesium) return sunlightState();
    const now = performance.now();
    if (!options.force && sunlightTimeMode === "realtime" && now - lastSunlightClockSyncAt < SUNLIGHT_REALTIME_SYNC_INTERVAL_MS) {
      return sunlightState();
    }
    const date = sunlightTimeMode === "weather-time" && sunlightTimeIso ? new Date(sunlightTimeIso) : new Date();
    if (!validDate(date)) return sunlightState();
    const julianDate = Cesium.JulianDate.fromDate(date);
    viewer.clock.currentTime = julianDate;
    viewer.clock.shouldAnimate = sunlightEnabled && sunlightTimeMode === "realtime";
    viewer.clock.multiplier = 1;
    if (sunlightTimeMode === "realtime") {
      sunlightTimeIso = date.toISOString();
      sunlightTimeLabel = "当前时间";
      sunlightTimeSource = "browser-clock";
    }
    lastSunlightClockSyncAt = now;
    updateSunlightInfoText();
    viewer.scene.requestRender?.();
    return sunlightState();
  }

  function syncSunlightClockFromActiveTime(options = {}) {
    if (activeTimeFilter === TIME_FILTER_ALL) return setSunlightRealtime(options);
    return setSunlightTime(activeTimeFilter, { ...options, source: options.source || "time-filter", fallbackRealtime: true });
  }

  function setSunlightRealtime(options = {}) {
    sunlightTimeMode = "realtime";
    sunlightTimeLabel = "当前时间";
    sunlightTimeSource = options.source || "browser-clock";
    syncSunlightClock({ force: true });
    if (options.notify) emitWeatherEarthEvent("sunlightchange", { sunlight: sunlightState() });
    return sunlightState();
  }

  function setSunlightTime(value, options = {}) {
    const raw = String(value ?? "").trim();
    if (!raw || raw === TIME_FILTER_ALL || raw.toLowerCase() === "realtime" || raw.toLowerCase() === "now") {
      return setSunlightRealtime({ ...options, source: options.source || "manual-realtime" });
    }
    const date = parseWeatherTimeToDate(raw);
    if (!date) {
      if (options.fallbackRealtime) return setSunlightRealtime({ ...options, source: "unparsed-time" });
      throw new Error(`无法解析太阳时间: ${raw}`);
    }
    sunlightTimeMode = "weather-time";
    sunlightTimeIso = date.toISOString();
    sunlightTimeLabel = raw;
    sunlightTimeSource = options.source || "manual";
    syncSunlightClock({ force: true });
    if (options.notify) emitWeatherEarthEvent("sunlightchange", { sunlight: sunlightState() });
    return sunlightState();
  }

  function setBuildingsEnabled(enabled) {
    buildingsEnabled = Boolean(enabled);
    updateAllUi();
    emitWeatherEarthEvent("buildingchange", { buildings: buildingState() });
    return buildingState();
  }

  function setBuildingHeightScale(value) {
    buildingHeightScale = clamp(Number(value), 0.5, 2);
    updateAllUi();
    emitWeatherEarthEvent("buildingchange", { buildings: buildingState() });
    return buildingState();
  }

  function setWeather3dEnabled(enabled) {
    weather3dEnabled = Boolean(enabled);
    renderWeather();
    emitWeatherEarthEvent("weather3dchange", { weather3d: weather3dState() });
    return weather3dState();
  }

  function setWeather3dScale(value) {
    weather3dScale = clamp(Number(value), 0.4, 2.5);
    renderWeather();
    emitWeatherEarthEvent("weather3dchange", { weather3d: weather3dState() });
    return weather3dState();
  }

  function setWeatherVolumeEnabled(enabled) {
    weatherVolumeEnabled = Boolean(enabled);
    renderWeather();
    emitWeatherEarthEvent("weathervolumechange", { weatherVolume: weatherVolumeState() });
    return weatherVolumeState();
  }

  function setWeatherVolumeScale(value) {
    weatherVolumeScale = clamp(Number(value), 0.25, 2.5);
    renderWeather();
    emitWeatherEarthEvent("weathervolumechange", { weatherVolume: weatherVolumeState() });
    return weatherVolumeState();
  }

  function setWeatherOpacity(value) {
    currentWeatherOpacity = clamp(Number(value), 0.15, 0.9);
    renderWeather();
    return currentWeatherOpacity;
  }

  function setAutoRotate(enabled) {
    autoRotateEnabled = Boolean(enabled);
    updateAllUi();
    return autoRotateEnabled;
  }

  function setFocusOrbitEnabled(enabled) {
    focusOrbitEnabled = Boolean(enabled);
    updateAllUi();
    emitWeatherEarthEvent("focusorbitchange", { focusOrbit: focusOrbitState() });
    return focusOrbitState();
  }

  function applyImmersiveMode(enabled) {
    immersiveEnabled = Boolean(enabled);
    if (!immersiveEnabled) earthMenuOpen = false;
    updateAllUi();
    emitWeatherEarthEvent("immersivechange", { immersive: immersiveModeState() });
    return immersiveModeState();
  }

  function toggleEarthMenu() {
    if (!immersiveEnabled) {
      applyImmersiveMode(true);
      return false;
    }
    return setEarthMenuOpen(!earthMenuOpen);
  }

  function setEarthMenuOpen(open) {
    earthMenuOpen = Boolean(open) && immersiveEnabled;
    updateEarthMenuUi();
    return earthMenuOpen;
  }

  function updateEarthMenuUi() {
    const open = immersiveEnabled && earthMenuOpen;
    const shell = document.querySelector(".earth-shell");
    shell?.classList.toggle("is-immersive", immersiveEnabled);
    shell?.classList.toggle("is-earth-menu-open", open);
    if (elements.earthMenuPanel) elements.earthMenuPanel.hidden = !open;
    if (elements.toggleImmersive) {
      elements.toggleImmersive.setAttribute("aria-expanded", open ? "true" : "false");
      const label = immersiveEnabled ? (open ? "关闭地球菜单" : "打开地球菜单") : "进入沉浸地球";
      elements.toggleImmersive.setAttribute("aria-label", label);
      elements.toggleImmersive.title = label;
    }
    setPressed(elements.toggleImmersive, open);
  }

  function scheduleRenderLoop() {
    let lastTime = performance.now();
    function tick(now) {
      const seconds = Math.min(0.05, (now - lastTime) / 1000);
      updateRenderMetrics(now, now - lastTime);
      lastTime = now;
      if (viewer) {
        if (sunlightEnabled) syncSunlightClock();
        if (updateKeyboardNavigation(seconds)) {
          scheduleCameraUiUpdate(now);
          scheduleReplaceUrlState();
        } else if (cameraInteractionActive) {
          scheduleCameraUiUpdate(now);
        } else if (focusOrbitEnabled && focusTarget) {
          rotateAroundFocus(seconds);
          scheduleCameraUiUpdate(now);
        } else if (autoRotateEnabled) {
          viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(-AUTO_ROTATE_DEGREES_PER_SECOND * seconds));
          scheduleCameraUiUpdate(now);
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function updateRenderMetrics(now, frameLatencyMs) {
    if (!renderMetrics.sampleStartedAt) renderMetrics.sampleStartedAt = now;
    renderMetrics.frameCount += 1;
    renderMetrics.sampleFrameCount += 1;
    renderMetrics.frameLatencyMs = frameLatencyMs;
    renderMetrics.lastFrameAt = now;
    const elapsed = now - renderMetrics.sampleStartedAt;
    if (elapsed >= 1000) {
      renderMetrics.fps = renderMetrics.sampleFrameCount * 1000 / elapsed;
      renderMetrics.sampleStartedAt = now;
      renderMetrics.sampleFrameCount = 0;
    }
  }

  function rotateAroundFocus(seconds) {
    const camera = currentCameraState();
    const nextBearing = camera.bearing + FOCUS_ORBIT_DEGREES_PER_SECOND * seconds;
    flyToCamera({ ...camera, lon: focusTarget.lon, lat: focusTarget.lat, bearing: nextBearing }, { duration: 0 });
  }

  function flyToPlace(placeId, options = {}) {
    const place = EARTH_PLACE_PRESETS.find((entry) => entry.id === placeId) || EARTH_PLACE_PRESETS[0];
    const camera = placeCamera(place);
    lastLocationSearch = { id: place.id, label: place.label, camera, source: "preset" };
    if (options.focus !== false) setFocusTargetState({ lon: camera.lon, lat: camera.lat, label: place.label, id: place.id }, { notify: false });
    flyToCamera(camera, options);
    updateAllUi();
    emitWeatherEarthEvent("searchchange", { locationSearch: publicLocationSearchResult(lastLocationSearch) });
    return cloneJson(lastLocationSearch);
  }

  function placeCamera(place) {
    return { ...(place?.id === "china" ? defaultCameraView() : place?.camera || DEFAULT_VIEW) };
  }

  function defaultCameraView() {
    const width = Number(window.innerWidth) || 1440;
    const height = Number(window.innerHeight) || 900;
    const shortSide = Math.min(width, height);
    const narrowFactor = clamp((720 - shortSide) / 360, 0, 1);
    const zoom = DEFAULT_VIEW.zoom + (DEFAULT_NARROW_VIEW.zoom - DEFAULT_VIEW.zoom) * narrowFactor;
    return { ...DEFAULT_VIEW, zoom };
  }

  function flyToSearch(query, options = {}) {
    const raw = String(query || "").trim();
    if (!raw) return null;
    const lonLat = parseLonLat(raw);
    if (lonLat) {
      const camera = { lon: lonLat.lon, lat: lonLat.lat, zoom: 12.5, bearing: -18, pitch: 55 };
      lastLocationSearch = { id: "coordinate", label: formatLngLat(lonLat.lon, lonLat.lat), camera, source: "coordinate" };
      setFocusTargetState({ ...lonLat, label: lastLocationSearch.label }, { notify: false });
      flyToCamera(camera, options);
      updateAllUi();
      emitWeatherEarthEvent("searchchange", { locationSearch: publicLocationSearchResult(lastLocationSearch) });
      return cloneJson(lastLocationSearch);
    }
    const lower = raw.toLowerCase();
    const place = EARTH_PLACE_PRESETS.find((entry) =>
      entry.id.toLowerCase() === lower ||
      entry.label.includes(raw) ||
      (entry.aliases || []).some((alias) => String(alias).toLowerCase().includes(lower))
    );
    if (!place) {
      setStatus("未找到地点。", raw);
      return null;
    }
    return flyToPlace(place.id, options);
  }

  function benchmarkPathState() {
    return Object.values(EARTH_BENCHMARK_PATHS).map((path) => ({
      id: path.id,
      label: path.label,
      detail: path.detail,
      stopCount: path.stops.length,
      stops: normalizeBenchmarkStops(path.id).map((stop) => ({
        label: stop.label,
        camera: cloneJson(stop.camera),
      })),
    }));
  }

  function flyToCamera(camera = {}, options = {}) {
    if (!viewer) return null;
    const normalized = normalizeCamera(camera);
    if (options.duration === 0) {
      setCameraLookAt(normalized);
    } else {
      flyCameraLookAt(normalized, Number(options.duration ?? 1.35));
    }
    lastCamera = normalized;
    return cloneJson(normalized);
  }

  function cameraViewOptions(camera) {
    const target = cameraTarget(camera);
    const offset = cameraOffset(camera);
    return {
      target,
      offset,
      destination: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, zoomToHeight(camera.zoom)),
      orientation: cameraOrientation(camera),
    };
  }

  function setCameraLookAt(camera) {
    const { target, offset, destination, orientation } = cameraViewOptions(camera);
    if (Cesium.HeadingPitchRange && viewer.camera.lookAt && viewer.camera.lookAtTransform) {
      viewer.camera.lookAt(target, offset);
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      return;
    }
    viewer.camera.setView({ destination, orientation });
  }

  function flyCameraLookAt(camera, duration) {
    const { target, offset, destination, orientation } = cameraViewOptions(camera);
    if (Cesium.BoundingSphere && Cesium.HeadingPitchRange && viewer.camera.flyToBoundingSphere) {
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
        offset,
        duration,
      });
      return;
    }
    viewer.camera.flyTo({ destination, orientation, duration });
  }

  function cameraTarget(camera) {
    return Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 0);
  }

  function cameraOffset(camera) {
    return new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(camera.bearing || 0),
      Cesium.Math.toRadians(-90 + clamp(Number(camera.pitch ?? 45), 0, 85)),
      zoomToHeight(camera.zoom)
    );
  }

  function cameraOrientation(camera) {
    return {
      heading: Cesium.Math.toRadians(camera.bearing || 0),
      pitch: Cesium.Math.toRadians(-90 + clamp(Number(camera.pitch ?? 45), 0, 85)),
      roll: 0,
    };
  }

  function normalizeCamera(camera = {}) {
    const center = camera.center || {};
    const lon = Number(camera.lon ?? camera.lng ?? center.lon ?? center.lng ?? lastCamera.lon ?? DEFAULT_VIEW.lon);
    const lat = Number(camera.lat ?? center.lat ?? lastCamera.lat ?? DEFAULT_VIEW.lat);
    return {
      lon: clampLon(lon),
      lat: clamp(lat, -85, 85),
      zoom: clamp(Number(camera.zoom ?? lastCamera.zoom ?? DEFAULT_VIEW.zoom), 0.4, 19),
      bearing: Number.isFinite(Number(camera.bearing)) ? Number(camera.bearing) : lastCamera.bearing || 0,
      pitch: clamp(Number(camera.pitch ?? lastCamera.pitch ?? DEFAULT_VIEW.pitch), 0, 85),
    };
  }

  function currentCameraState() {
    if (!viewer) return { ...lastCamera, map: serializeMapParam(lastCamera) };
    const center = cameraCenterLonLat() || { lon: lastCamera.lon, lat: lastCamera.lat };
    const carto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    const range = cameraRangeToCenter(center) || carto.height;
    const pitch = cameraGroundPitch(center) ?? clamp(90 + Cesium.Math.toDegrees(viewer.camera.pitch), CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
    const camera = {
      lon: center.lon,
      lat: center.lat,
      zoom: heightToZoom(range),
      bearing: normalizeBearing(Cesium.Math.toDegrees(viewer.camera.heading)),
      pitch,
    };
    camera.map = serializeMapParam(camera);
    return camera;
  }

  function cameraRangeToCenter(center) {
    if (!viewer || !center || !validLonLat(center.lon, center.lat)) return 0;
    try {
      const target = Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 0);
      return Cesium.Cartesian3.distance(viewer.camera.positionWC, target);
    } catch {
      return 0;
    }
  }

  function cameraGroundPitch(center) {
    if (!viewer || !center || !validLonLat(center.lon, center.lat)) return null;
    try {
      const cartographic = Cesium.Cartographic.fromDegrees(center.lon, center.lat, 0);
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormalCartographic(cartographic, new Cesium.Cartesian3());
      const localDown = Cesium.Cartesian3.negate(normal, new Cesium.Cartesian3());
      const dot = clamp(Cesium.Cartesian3.dot(viewer.camera.directionWC, localDown), -1, 1);
      return clamp(Cesium.Math.toDegrees(Math.acos(dot)), CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
    } catch {
      return null;
    }
  }

  function cameraCenterLonLat() {
    if (!viewer) return null;
    const canvas = viewer.scene.canvas;
    const point = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    return screenToLonLat(point) || cameraPositionLonLat();
  }

  function cameraPositionLonLat() {
    const carto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    return { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) };
  }

  function zoomCamera(delta) {
    const camera = currentCameraState();
    flyToCamera({ ...camera, zoom: clamp(camera.zoom - delta, 0.4, 19) }, { duration: 0.35 });
  }

  function rotateCamera(delta) {
    const camera = currentCameraState();
    setCameraAngle({ ...camera, bearing: camera.bearing + delta }, { duration: 0.35 });
  }

  function tiltCamera(delta) {
    const camera = currentCameraState();
    setCameraPitch(camera.pitch + delta, { duration: 0.35 });
  }

  function setCameraPitch(pitch, options = {}) {
    const camera = currentCameraState();
    return setCameraAngle({ ...camera, pitch: clamp(Number(pitch), CAMERA_PITCH_MIN, CAMERA_PITCH_MAX) }, options);
  }

  function setCameraAngle(camera, options = {}) {
    const normalized = normalizeCamera(camera);
    normalized.pitch = clamp(normalized.pitch, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
    flyToCamera(normalized, { duration: Number(options.duration ?? 0) });
    scheduleCameraUiUpdate();
    viewer?.scene?.requestRender();
    return normalized;
  }

  function updateKeyboardNavigation(seconds) {
    if (!viewer || !keyboardNavigationKeys.size || isTypingTarget(document.activeElement)) return false;
    const keys = keyboardNavigationKeys;
    const camera = keyboardNavigationCamera || normalizeCamera(lastCamera);
    let next = { ...camera };
    let moved = false;
    const shiftMode = keyboardNavigationModifiers.shift;
    const left = keys.has("ArrowLeft") ? 1 : 0;
    const right = keys.has("ArrowRight") ? 1 : 0;
    const up = keys.has("ArrowUp") ? 1 : 0;
    const down = keys.has("ArrowDown") ? 1 : 0;
    if (shiftMode) {
      const bearingDelta = (right - left) * KEYBOARD_ROTATE_DEGREES_PER_SECOND * seconds;
      const pitchDelta = (up - down) * KEYBOARD_TILT_DEGREES_PER_SECOND * seconds;
      if (bearingDelta || pitchDelta) {
        next.bearing += bearingDelta;
        next.pitch = clamp(next.pitch + pitchDelta, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
        moved = true;
      }
    } else {
      const forwardAxis = up - down;
      const rightAxis = right - left;
      if (forwardAxis || rightAxis) {
        const length = Math.hypot(forwardAxis, rightAxis) || 1;
        const meters = keyboardPanMetersPerSecond(camera) * seconds;
        next = panCameraByMeters(next, meters * forwardAxis / length, meters * rightAxis / length);
        moved = true;
      }
    }
    const zoomAxis = (keys.has("Equal") || keys.has("NumpadAdd") || keys.has("PageUp") ? 1 : 0) -
      (keys.has("Minus") || keys.has("NumpadSubtract") || keys.has("PageDown") ? 1 : 0);
    if (zoomAxis) {
      next.zoom = clamp(next.zoom + zoomAxis * KEYBOARD_ZOOM_LEVELS_PER_SECOND * seconds, 0.4, 19);
      moved = true;
    }
    if (!moved) return false;
    keyboardNavigationCamera = next;
    beginCameraInteraction("keyboard");
    setCameraAngle(next, { duration: 0 });
    return true;
  }

  function keyboardPanMetersPerSecond(camera) {
    return clamp(zoomToHeight(camera.zoom) * KEYBOARD_PAN_HEIGHT_FACTOR, KEYBOARD_PAN_MIN_METERS_PER_SECOND, KEYBOARD_PAN_MAX_METERS_PER_SECOND);
  }

  function panCameraByMeters(camera, forwardMeters, rightMeters) {
    const heading = Cesium.Math.toRadians(camera.bearing || 0);
    const eastMeters = Math.sin(heading) * forwardMeters + Math.cos(heading) * rightMeters;
    const northMeters = Math.cos(heading) * forwardMeters - Math.sin(heading) * rightMeters;
    const metersPerDegreeLat = 111320;
    const cosLat = Math.max(0.08, Math.cos(Cesium.Math.toRadians(camera.lat)));
    return {
      ...camera,
      lon: clampLon(camera.lon + eastMeters / (metersPerDegreeLat * cosLat)),
      lat: clamp(camera.lat + northMeters / metersPerDegreeLat, -85, 85),
    };
  }

  function resetCameraView(options = {}) {
    return flyToCamera(defaultCameraView(), options);
  }

  function setCameraTopDown(options = {}) {
    const camera = currentCameraState();
    return flyToCamera({ ...camera, bearing: 0, pitch: 0 }, options);
  }

  function toggleCameraOblique(options = {}) {
    const camera = currentCameraState();
    const pitch = camera.pitch < 24 ? KEYBOARD_OBLIQUE_PITCH : 0;
    return flyToCamera({ ...camera, pitch }, options);
  }

  function focusCurrentCameraCenter() {
    const center = cameraCenterLonLat();
    if (center) setFocusTargetState({ ...center, label: "当前中心" });
  }

  function setFocusTargetState(target, options = {}) {
    const lon = Number(target?.lon ?? target?.lng ?? target?.coordinates?.[0]);
    const lat = Number(target?.lat ?? target?.coordinates?.[1]);
    if (!validLonLat(lon, lat)) return null;
    focusTarget = {
      id: target.id || "focus-target",
      lon,
      lat,
      label: target.label || target.name || "聚焦目标",
      createdAt: target.createdAt || new Date().toISOString(),
    };
    renderUtilityLayers();
    updateAllUi();
    if (options.eventReason !== false && options.notify !== false) emitWeatherEarthEvent("focuschange", { focusTarget: publicFocusTarget(focusTarget) });
    return publicFocusTarget(focusTarget);
  }

  function clearFocusTargetState(options = {}) {
    focusTarget = null;
    focusOrbitEnabled = false;
    renderUtilityLayers();
    updateAllUi();
    if (options.eventReason !== false) emitWeatherEarthEvent("focuschange", { focusTarget: null });
  }

  function setSurfaceProbeFromLngLat(point, options = {}) {
    const lon = Number(point?.lon ?? point?.lng ?? point?.coordinates?.[0]);
    const lat = Number(point?.lat ?? point?.coordinates?.[1]);
    if (!validLonLat(lon, lat)) return null;
    surfaceProbe = {
      lon,
      lat,
      label: point.label || formatLngLat(lon, lat),
      source: options.source || "manual",
      createdAt: new Date().toISOString(),
    };
    renderUtilityLayers();
    emitWeatherEarthEvent("surfaceprobechange", { surfaceProbe: publicSurfaceProbe(surfaceProbe) });
    return publicSurfaceProbe(surfaceProbe);
  }

  function closeSurfaceProbe() {
    surfaceProbe = null;
    renderUtilityLayers();
    emitWeatherEarthEvent("surfaceprobechange", { surfaceProbe: null });
  }

  function startDrawMode(mode) {
    drawMode = mode;
    drawCoordinates = [];
    setStatus("开始绘制。", mode === "Point" ? "点击地球添加点。" : "点击地球添加节点，完成后保存。");
    updateDrawUi();
  }

  function addDrawPoint(point) {
    drawCoordinates.push({ lon: point.lon, lat: point.lat });
    if (drawMode === "Point" && drawCoordinates.length > 1) drawCoordinates = [drawCoordinates.at(-1)];
    renderDrawDraft();
    updateDrawUi();
  }

  function undoDrawPoint() {
    drawCoordinates.pop();
    renderDrawDraft();
    updateDrawUi();
  }

  function cancelDrawMode() {
    drawMode = "";
    drawCoordinates = [];
    removeEntityList(drawEntities);
    updateDrawUi();
  }

  function finishDrawFeature() {
    if (!drawMode) return null;
    if (drawMode === "Point" && drawCoordinates.length < 1) return null;
    if (drawMode === "LineString" && drawCoordinates.length < 2) return null;
    if (drawMode === "Polygon" && drawCoordinates.length < 3) return null;
    const type = elements.drawWeatherType?.value || (drawMode === "Point" ? "warning" : drawMode === "LineString" ? "track" : "wind-region");
    const color = elements.drawColor?.value || elementTypeById(type)?.color || "#ffbd59";
    let geometry;
    if (drawMode === "Point") geometry = { type: "Point", coordinates: [drawCoordinates[0].lon, drawCoordinates[0].lat] };
    if (drawMode === "LineString") geometry = { type: "LineString", coordinates: drawCoordinates.map((p) => [p.lon, p.lat]) };
    if (drawMode === "Polygon") {
      const ring = drawCoordinates.map((p) => [p.lon, p.lat]);
      ring.push([drawCoordinates[0].lon, drawCoordinates[0].lat]);
      geometry = { type: "Polygon", coordinates: [ring] };
    }
    const feature = normalizeFeature({
      type: "Feature",
      properties: { weather_type: type, name: elements.drawName?.value || elementTypeById(type)?.label || "天气元素", "marker-color": color, source: "manual" },
      geometry,
    });
    cancelDrawMode();
    return addWeatherFeature(feature, { select: true, fitSelected: false });
  }

  function startMeasureMode(mode = "distance") {
    measurementState = { mode: mode === "area" ? "area" : "distance", active: true, finalized: false, coordinates: [], lengthMeters: 0, areaSqMeters: 0 };
    setStatus("开始测量。", measurementState.mode === "area" ? "点击地球添加面积边界。" : "点击地球添加距离节点。");
    renderMeasurement();
    updateMeasurementUi();
  }

  function addMeasurementPointTool(point) {
    const lon = Number(point?.lon ?? point?.lng ?? point?.coordinates?.[0]);
    const lat = Number(point?.lat ?? point?.coordinates?.[1]);
    if (!validLonLat(lon, lat)) return measureState();
    if (!measurementState.active) startMeasureMode("distance");
    measurementState.coordinates.push({ lon, lat });
    recalcMeasurement();
    renderMeasurement();
    updateMeasurementUi();
    emitWeatherEarthEvent("measurementchange", { measurement: measureState() });
    return measureState();
  }

  function undoMeasurePoint() {
    measurementState.coordinates.pop();
    recalcMeasurement();
    renderMeasurement();
    updateMeasurementUi();
    return measureState();
  }

  function finishMeasurementTool() {
    measurementState.active = false;
    measurementState.finalized = true;
    updateMeasurementUi();
    emitWeatherEarthEvent("measurementchange", { measurement: measureState() });
    return measureState();
  }

  function clearMeasurementState() {
    measurementState = { mode: "", active: false, finalized: true, coordinates: [], lengthMeters: 0, areaSqMeters: 0 };
    renderMeasurement();
    updateMeasurementUi();
    emitWeatherEarthEvent("measurementchange", { measurement: measureState() });
    return measureState();
  }

  function recalcMeasurement() {
    const coords = measurementState.coordinates;
    measurementState.lengthMeters = 0;
    for (let i = 1; i < coords.length; i += 1) measurementState.lengthMeters += distanceMeters(coords[i - 1], coords[i]);
    measurementState.areaSqMeters = measurementState.mode === "area" && coords.length > 2 ? polygonAreaSqMeters(coords) : 0;
  }

  function selectFeatureById(id, options = {}) {
    selectedFeatureId = id && findFeatureById(id) ? id : "";
    renderUtilityLayers();
    updateSelectedFeatureEditor();
    renderFeatureList();
    if (options.fit === true && selectedFeatureId) fitFeatureById(selectedFeatureId);
    return selectedFeature();
  }

  function addWeatherFeature(feature, options = {}) {
    const normalized = normalizeFeature(feature);
    currentGeoJson.features.push(normalized);
    syncDynamicElementTypes();
    renderWeather();
    syncGeoJsonEditor();
    if (options.select) selectFeatureById(normalized.properties[FEATURE_ID_PROPERTY], { fit: options.fitSelected });
    emitWeatherEarthChange("feature-add");
    return { id: normalized.properties[FEATURE_ID_PROPERTY], feature: publicFeatureEnvelope(normalized).feature, state: weatherEarthApi.getState() };
  }

  function updateWeatherFeature(id, patch, options = {}) {
    const feature = findFeatureById(id);
    if (!feature) throw new Error(`Weather feature not found: ${id || ""}`);
    if (patch?.type === "Feature") {
      feature.properties = { ...normalizeProperties(patch.properties), [FEATURE_ID_PROPERTY]: id };
      feature.geometry = cloneJson(patch.geometry);
    } else {
      if (patch?.properties) feature.properties = { ...feature.properties, ...normalizeProperties(patch.properties), [FEATURE_ID_PROPERTY]: id };
      if (patch?.geometry) feature.geometry = cloneJson(patch.geometry);
    }
    renderWeather();
    syncGeoJsonEditor();
    updateAllUi();
    if (options.fit) fitFeatureById(id);
    emitWeatherEarthChange("feature-update");
    return { id, feature: publicFeatureEnvelope(feature).feature, state: weatherEarthApi.getState() };
  }

  function deleteWeatherFeature(id) {
    const index = currentGeoJson.features.findIndex((feature) => feature.properties?.[FEATURE_ID_PROPERTY] === id);
    if (index < 0) throw new Error(`Weather feature not found: ${id || ""}`);
    const [deleted] = currentGeoJson.features.splice(index, 1);
    if (selectedFeatureId === id) selectedFeatureId = "";
    renderWeather();
    syncGeoJsonEditor();
    updateAllUi();
    emitWeatherEarthChange("feature-delete");
    return { id, deleted: publicFeatureEnvelope(deleted).feature, state: weatherEarthApi.getState() };
  }

  function updateSelectedFeatureFromEditor() {
    if (!selectedFeatureId) return;
    try {
      const properties = JSON.parse(elements.selectedProperties.value || "{}");
      const geometry = JSON.parse(elements.selectedGeometry.value || "null");
      if (elements.selectedName?.value) properties.name = elements.selectedName.value;
      if (elements.selectedColor?.value) properties["marker-color"] = elements.selectedColor.value;
      if (elements.selectedWeatherType?.value) properties.weather_type = elements.selectedWeatherType.value;
      updateWeatherFeature(selectedFeatureId, { properties, geometry });
      setStatus("要素已更新。", selectedFeatureId);
    } catch (error) {
      setStatus("要素更新失败。", error.message || String(error));
    }
  }

  function applySelectedWeatherTemplate() {
    const feature = findFeatureById(selectedFeatureId);
    const type = elements.selectedWeatherType?.value;
    const template = elementTypeById(type);
    if (!feature || !template) return;
    feature.properties = { ...template.properties, ...feature.properties, weather_type: type, "marker-color": template.color, [FEATURE_ID_PROPERTY]: selectedFeatureId };
    updateSelectedFeatureEditor();
  }

  function createWeatherElement(input = {}) {
    const weatherType = input.weatherType || input.weather_type || input.type || "warning";
    const template = elementTypeById(weatherType) || elementTypeById("warning");
    const color = input.color || input["marker-color"] || template.color;
    const properties = {
      ...template.properties,
      ...input.properties,
      weather_type: weatherType,
      name: input.name || input.label || template.label,
      time: input.time ?? input.valid_time ?? input.properties?.time ?? "",
      level: input.level ?? input.properties?.level ?? template.properties.level,
      "marker-color": color,
    };
    let geometry = input.geometry;
    if (!geometry) {
      if (validLonLat(input.lon ?? input.lng, input.lat)) geometry = { type: "Point", coordinates: [Number(input.lon ?? input.lng), Number(input.lat)] };
      else if (Array.isArray(input.coordinates)) {
        const coords = input.coordinates;
        if (template.geometry === "Polygon") {
          const ring = coords.map((pair) => [Number(pair[0]), Number(pair[1])]).filter((pair) => validLonLat(pair[0], pair[1]));
          if (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) ring.push([...ring[0]]);
          geometry = { type: "Polygon", coordinates: [ring] };
        } else if (template.geometry === "LineString") {
          geometry = { type: "LineString", coordinates: coords };
        }
      }
    }
    return publicFeatureEnvelope(normalizeFeature({ type: "Feature", properties, geometry: geometry || { type: "Point", coordinates: [DEFAULT_VIEW.lon, DEFAULT_VIEW.lat] } })).feature;
  }

  function addWeatherElement(input, options = {}) {
    return addWeatherFeature(createWeatherElement(input), options);
  }

  function setTimeFilter(value, options = {}) {
    activeTimeFilter = value || TIME_FILTER_ALL;
    syncSunlightClockFromActiveTime({ source: options.sunlightSource || "time-filter", notify: options.notify !== false });
    renderWeather();
    if (options.notify !== false) emitWeatherEarthEvent("filterchange", { activeTimeFilter });
    return activeTimeFilter;
  }

  async function loadManifestFromUrl(url = DEFAULT_MANIFEST_URL, options = {}) {
    const value = String(url || DEFAULT_MANIFEST_URL).trim();
    try {
      setStatus("正在加载天气过程...", value);
      const response = await fetch(value, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const manifest = await response.json();
      manifestFrames = normalizeManifestFrames(manifest, response.url || value);
      manifestIndex = Math.max(0, manifestFrames.findIndex((frame) => frame.default || frame.peak));
      if (manifestIndex < 0) manifestIndex = 0;
      setShareSource("manifest", value);
      renderManifestControls();
      if (manifestFrames.length) await setManifestIndex(manifestIndex, { fit: options.fit !== false });
      setStatus("天气过程已加载。", `${manifestFrames.length} 个时次`);
    } catch (error) {
      setStatus("天气过程加载失败。", error.message || String(error));
    }
    return weatherEarthApi.getState();
  }

  function normalizeManifestFrames(manifest, baseUrl) {
    const raw = Array.isArray(manifest?.items) ? manifest.items : Array.isArray(manifest?.frames) ? manifest.frames : [];
    return raw.map((frame, index) => {
      const geojsonUrl = frame.geojsonUrl || frame.geojson || frame.url || frame.href;
      return {
        ...frame,
        index,
        label: frame.label || frame.time || frame.validTime || frame.valid_time || `时次 ${index + 1}`,
        time: frame.time || frame.validTime || frame.valid_time || "",
        geojsonUrl: geojsonUrl ? new URL(geojsonUrl, baseUrl).href : "",
        imageUrl: frame.imageUrl || frame.image || "",
      };
    }).filter((frame) => frame.geojsonUrl);
  }

  async function setManifestIndex(index, options = {}) {
    if (!manifestFrames.length) return;
    manifestIndex = clamp(Math.round(Number(index)), 0, manifestFrames.length - 1);
    const frame = manifestFrames[manifestIndex];
    await loadGeoJsonFromUrl(frame.geojsonUrl, frame.label, { fit: options.fit === true, shareType: "manifest", shareValue: currentShareSourceValue || DEFAULT_MANIFEST_URL });
    if (frame.time) setTimeFilter(frame.time, { notify: false });
    else setSunlightTime(frame.label || frame.geojsonUrl, { source: "manifest-frame", fallbackRealtime: true });
    renderManifestControls();
  }

  function stepManifest(delta) {
    if (!manifestFrames.length) return;
    setManifestIndex((manifestIndex + delta + manifestFrames.length) % manifestFrames.length, { fit: false });
  }

  function toggleManifestPlayback() {
    if (!manifestFrames.length) return;
    manifestPlaying = !manifestPlaying;
    if (manifestPlaying) {
      manifestTimer = window.setInterval(() => stepManifest(1), 1600);
    } else {
      window.clearInterval(manifestTimer);
      manifestTimer = 0;
    }
    renderManifestControls();
  }

  function resetManifest() {
    manifestPlaying = false;
    window.clearInterval(manifestTimer);
    manifestTimer = 0;
    manifestIndex = 0;
    if (manifestFrames.length) setManifestIndex(0, { fit: true });
    renderManifestControls();
  }

  function renderManifestControls() {
    const hasFrames = manifestFrames.length > 0;
    setHidden(elements.immersiveProcessPanel, !hasFrames);
    setDisabled(elements.playManifest, !hasFrames);
    setDisabled(elements.resetManifest, !hasFrames);
    setDisabled(elements.immersiveProcessPlay, !hasFrames);
    setDisabled(elements.immersiveProcessPrev, !hasFrames);
    setDisabled(elements.immersiveProcessNext, !hasFrames);
    if (elements.processSummary) elements.processSummary.textContent = hasFrames ? `${manifestFrames.length} 个时次 / 当前 ${manifestFrames[manifestIndex]?.label || "--"}` : "未加载天气过程。";
    if (elements.immersiveProcessTime) elements.immersiveProcessTime.textContent = hasFrames ? manifestFrames[manifestIndex]?.label || "--" : "等待过程";
    if (elements.immersiveProcessRange) {
      elements.immersiveProcessRange.max = String(Math.max(0, manifestFrames.length - 1));
      elements.immersiveProcessRange.value = String(manifestIndex);
      elements.immersiveProcessRange.disabled = !hasFrames;
    }
    if (elements.playManifest) elements.playManifest.textContent = manifestPlaying ? "暂停" : "播放";
    if (elements.immersiveProcessPlay) elements.immersiveProcessPlay.textContent = manifestPlaying ? "暂停" : "播放";
    if (elements.processTimeline) {
      elements.processTimeline.innerHTML = manifestFrames.map((frame, index) => `<button type="button" data-frame="${index}" class="${index === manifestIndex ? "is-active" : ""}">${escapeHtml(frame.label)}</button>`).join("");
      elements.processTimeline.querySelectorAll("[data-frame]").forEach((button) => {
        button.addEventListener("click", () => setManifestIndex(Number(button.dataset.frame), { fit: false }));
      });
    }
  }

  function buildWeatherEarthProject(options = {}) {
    const geojson = currentExportGeoJson({ raw: false });
    const name = options.name || currentGeoJsonName || geojson.name || "weather-earth.geojson";
    return {
      type: "WeatherEarthProject",
      schema: PROJECT_SCHEMA,
      version: 1,
      name,
      savedAt: new Date().toISOString(),
      app: "weather-earth",
      view: {
        engine: ENGINE,
        tileset: tilesetState(),
        qualityProfile: qualityProfileState(),
        scenePreset: scenePresetState(),
        projection: currentProjection,
        basemap: currentBaseMapKey,
        basemapLabel: baseMapProvider(currentBaseMapKey).label,
        immersive: immersiveModeState(),
        autoRotate: autoRotateEnabled,
        focusOrbit: focusOrbitState(),
        activeTimeFilter,
        showUntimedFeatures,
        weatherOpacity: currentWeatherOpacity,
        mapDetails: mapDetailState(),
        terrain: terrainState(),
        sunlight: sunlightState(),
        buildings: buildingState(),
        weather3d: weather3dState(),
        weatherVolume: weatherVolumeState(),
        locationSearch: publicLocationSearchResult(lastLocationSearch),
        focusTarget: publicFocusTarget(focusTarget),
        surfaceProbe: publicSurfaceProbe(surfaceProbe),
        measurement: measureState(),
        cameraTour: cameraTourState({ includeRuntime: false }),
        camera: currentCameraState(),
      },
      source: { ...currentGeoJsonMeta, name: currentGeoJsonName },
      share: { sourceType: currentShareSourceType, sourceValue: currentShareSourceValue },
      layers: weatherLayerState().map(({ id, label, visible }) => ({ id, label, visible })),
      elementTypes: elementTypeState().map(({ id, label, visible }) => ({ id, label, visible })),
      geojson,
    };
  }

  function normalizeWeatherEarthProject(payload) {
    if (!payload || typeof payload !== "object") throw new Error("Project document must be a JSON object.");
    if (payload.type === "WeatherEarthProject" || payload.schema === PROJECT_SCHEMA || payload.geojson || payload.data?.geojson) {
      const geojson = normalizeFeatureCollection(payload.geojson || payload.data?.geojson || emptyFeatureCollection());
      return {
        ...payload,
        type: "WeatherEarthProject",
        schema: payload.schema || PROJECT_SCHEMA,
        name: payload.name || payload.source?.name || geojson.name || "weather-earth.geojson",
        view: payload.view || {},
        source: payload.source || {},
        share: payload.share || {},
        layers: Array.isArray(payload.layers) ? payload.layers : [],
        elementTypes: Array.isArray(payload.elementTypes) ? payload.elementTypes : [],
        geojson,
      };
    }
    return { type: "WeatherEarthProject", schema: PROJECT_SCHEMA, version: 1, name: payload.name || "weather.geojson", savedAt: new Date().toISOString(), app: "weather-earth", view: {}, source: {}, share: {}, layers: [], elementTypes: [], geojson: normalizeFeatureCollection(payload) };
  }

  async function applyWeatherEarthProject(payload, options = {}) {
    const project = normalizeWeatherEarthProject(payload);
    const view = project.view || {};
    activeScenePreset = view.scenePreset?.current || view.scenePreset?.id || activeScenePreset;
    currentProjection = "globe";
    currentBaseMapKey = normalizeBaseMapKey(view.basemap || view.tileset?.id || TILESET_MODE);
    await loadBaseMapProvider(currentBaseMapKey);
    setQualityProfile(view.qualityProfile?.id || view.qualityProfile || view.quality || activeQualityProfile, { forceEvent: false });
    autoRotateEnabled = Boolean(view.autoRotate ?? autoRotateEnabled);
    focusOrbitEnabled = Boolean(view.focusOrbit?.enabled ?? view.focusOrbit ?? focusOrbitEnabled);
    showUntimedFeatures = Boolean(view.showUntimedFeatures ?? showUntimedFeatures);
    currentWeatherOpacity = Number(view.weatherOpacity ?? currentWeatherOpacity);
    applyProjectToggleState(view);
    applyProjectLayerState(project.layers);
    applyElementTypeVisibilityState(project.elementTypes);
    applyProjectFocusTargetState(view);
    applyProjectMeasurementState(view);
    applyProjectCameraTourState(view);
    setWeatherGeoJson(project.geojson, project.name || options.name || "weather-earth-project.geojson", {
      persist: options.persist !== false,
      fit: false,
      sourceType: "project",
      sourceLabel: options.sourceLabel || project.name || "项目文档",
      syncEditor: options.syncEditor !== false,
      eventReason: options.eventReason || "project-load",
    });
    if (view.activeTimeFilter) {
      setTimeFilter(view.activeTimeFilter, { notify: false });
    } else if (!projectHasFixedSunlightTime(view)) {
      setTimeFilter(TIME_FILTER_ALL, { notify: false });
    }
    if (view.camera || view.map || view.zoom) flyToCamera(view.camera || view, { duration: 0 });
    applyImmersiveMode(Boolean(view.immersive?.enabled ?? view.immersive ?? immersiveEnabled));
    renderWeather();
    emitWeatherEarthChange(options.eventReason || "project-load");
    return weatherEarthApi.getState();
  }

  function applyProjectToggleState(view) {
    const terrain = view.terrain && typeof view.terrain === "object" ? view.terrain : {};
    terrainEnabled = Boolean(terrain.enabled ?? view.terrainEnabled ?? terrainEnabled);
    terrainExaggeration = clamp(Number(terrain.exaggeration ?? view.terrainExaggeration ?? terrainExaggeration), 0.3, 2.5);
    const sunlight = view.sunlight && typeof view.sunlight === "object" ? view.sunlight : {};
    sunlightEnabled = Boolean(sunlight.enabled ?? view.sunlightEnabled ?? sunlightEnabled);
    sunlightIntensity = clamp(Number(sunlight.intensity ?? sunlight.opacity ?? view.sunlightIntensity ?? sunlightIntensity), 0.2, 1);
    applyProjectSunlightTimeState(sunlight);
    const mapDetails = view.mapDetails && typeof view.mapDetails === "object" ? view.mapDetails : {};
    mapDetailsEnabled = Boolean(mapDetails.enabled ?? view.mapDetailsEnabled ?? mapDetailsEnabled);
    const buildings = view.buildings && typeof view.buildings === "object" ? view.buildings : {};
    buildingsEnabled = Boolean(buildings.enabled ?? view.buildingsEnabled ?? buildingsEnabled);
    buildingHeightScale = clamp(Number(buildings.heightScale ?? buildings.height_scale ?? view.buildingHeightScale ?? buildingHeightScale), 0.5, 2);
    const weather3d = view.weather3d && typeof view.weather3d === "object" ? view.weather3d : {};
    weather3dEnabled = Boolean(weather3d.enabled ?? view.weather3dEnabled ?? weather3dEnabled);
    weather3dScale = clamp(Number(weather3d.scale ?? weather3d.heightScale ?? view.weather3dScale ?? weather3dScale), 0.4, 2.5);
    const weatherVolume = view.weatherVolume && typeof view.weatherVolume === "object" ? view.weatherVolume : {};
    weatherVolumeEnabled = Boolean(weatherVolume.enabled ?? view.weatherVolumeEnabled ?? weatherVolumeEnabled);
    weatherVolumeScale = clamp(Number(weatherVolume.scale ?? weatherVolume.heightScale ?? view.weatherVolumeScale ?? weatherVolumeScale), 0.25, 2.5);
    applyCesiumLighting();
  }

  function applyProjectSunlightTimeState(sunlight = {}) {
    const mode = sunlight.clockMode || sunlight.timeMode || sunlight.time?.mode;
    const value = sunlight.currentTime || sunlight.time?.currentTime || sunlight.time?.iso || sunlight.timeIso || sunlight.label;
    if (mode === "weather-time" && value) {
      setSunlightTime(value, { source: "project", fallbackRealtime: true });
    } else if (mode === "realtime") {
      setSunlightRealtime({ source: "project" });
    }
  }

  function projectHasFixedSunlightTime(view = {}) {
    const sunlight = view.sunlight && typeof view.sunlight === "object" ? view.sunlight : {};
    return Boolean((sunlight.clockMode === "weather-time" || sunlight.timeMode === "weather-time" || sunlight.time?.mode === "weather-time") &&
      (sunlight.currentTime || sunlight.time?.currentTime || sunlight.time?.iso || sunlight.timeIso || sunlight.label));
  }

  async function loadProjectFromFile(file) {
    if (!file) return;
    try {
      await applyWeatherEarthProject(JSON.parse(await file.text()), { name: file.name, sourceLabel: file.name, persist: true });
      setStatus("项目文档已加载。", file.name);
    } catch (error) {
      setStatus("项目文档加载失败。", error.message || String(error));
    } finally {
      if (elements.projectFileInput) elements.projectFileInput.value = "";
    }
  }

  async function loadProjectFromUrl(url, label = "", options = {}) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    await applyWeatherEarthProject(await response.json(), { name: label || readableNameFromUrl(response.url || url), sourceLabel: label || url, persist: options.persist !== false });
    setShareSource("project", options.shareValue || url);
  }

  async function loadProjectFromParam(rawValue, options = {}) {
    const value = safeDecode(rawValue).trim();
    try {
      if (/^https?:\/\//i.test(value) || value.startsWith("./") || value.startsWith("../") || value.startsWith("/")) {
        await loadProjectFromUrl(value, readableNameFromUrl(value), { shareValue: value, ...options });
      } else if (value.startsWith("data:")) {
        const response = await fetch(value);
        await applyWeatherEarthProject(await response.json(), { sourceLabel: "project data URI", persist: true });
        setShareSource("project", value);
      } else {
        await applyWeatherEarthProject(JSON.parse(value), { sourceLabel: "URL 内联项目文档", persist: true });
        setShareSource("project", value);
      }
    } catch (error) {
      setStatus("URL 项目文档加载失败。", error.message || String(error));
      loadDefaultWeather({ silentNotFound: true });
    }
  }

  function downloadProjectDocument() {
    const project = buildWeatherEarthProject();
    downloadJsonPayload(project, projectDocumentFileName(project.name), "application/json;charset=utf-8");
    setStatus("项目文档已下载。", `${project.name} / ${(project.geojson.features || []).length} 个要素`);
  }

  function currentExportGeoJson(options = {}) {
    const source = options.visible ? displayedGeoJson : currentGeoJson;
    const collection = normalizeFeatureCollection(source);
    collection.features = collection.features.map((feature) => publicFeatureEnvelope(feature).feature);
    if (collection.metadata) collection.metadata = cloneJson(collection.metadata);
    return collection;
  }

  function buildValidationReport(options = {}) {
    const validation = validateWeatherGeoJson(options.payload || currentGeoJson, options);
    return {
      type: "WeatherEarthValidationReport",
      generatedAt: new Date().toISOString(),
      engine: ENGINE,
      tileset: tilesetState(),
      source: currentGeoJsonMeta,
      view: weatherEarthState(),
      validation,
    };
  }

  function validateWeatherGeoJson(payload = currentGeoJson) {
    const collection = normalizeFeatureCollection(payload);
    const errors = [];
    const warnings = [];
    const counts = {};
    collection.features.forEach((feature, index) => {
      const geometry = feature.geometry;
      if (!geometry || !geometry.type) errors.push({ index, message: "缺少 geometry。" });
      else if (!["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"].includes(geometry.type)) errors.push({ index, message: `不支持的 geometry: ${geometry.type}` });
      if (!feature.properties?.weather_type) warnings.push({ index, message: "缺少 properties.weather_type。" });
      if (!feature.properties?.time && !feature.properties?.valid_time && !feature.properties?.validTime) warnings.push({ index, message: "缺少时次字段。" });
      const type = feature.properties?.weather_type || geometry?.type || "unknown";
      counts[type] = (counts[type] || 0) + 1;
      forEachGeometryCoordinate(geometry, (coord) => {
        if (!validLonLat(coord[0], coord[1])) errors.push({ index, message: `坐标越界: ${coord[0]}, ${coord[1]}` });
      });
    });
    return { ok: errors.length === 0, errors, warnings, summary: { featureCount: collection.features.length, counts }, issues: [...errors, ...warnings] };
  }

  function normalizeCurrentWeatherGeoJson() {
    currentGeoJson.metadata = { ...(currentGeoJson.metadata || {}), schema: "weather-earth-geojson-v1", projection: "WGS84 lon/lat", normalized_by: "weather-earth-cesium" };
    currentGeoJson.features.forEach((feature) => {
      feature.properties ||= {};
      feature.properties.weather_type ||= inferWeatherType(feature);
      feature.properties.name ||= elementTypeById(feature.properties.weather_type)?.label || "天气元素";
      feature.properties["marker-color"] ||= elementTypeById(feature.properties.weather_type)?.color || "#00d6f2";
    });
    renderWeather();
    syncGeoJsonEditor();
    updateAllUi();
    return currentExportGeoJson();
  }

  function saveBrowserDraft() {
    localStorage.setItem("weather-earth-draft-geojson", JSON.stringify(currentExportGeoJson()));
    setStatus("草稿已保存。", currentGeoJsonName);
    updateAllUi();
  }

  function restoreBrowserDraft() {
    const raw = localStorage.getItem("weather-earth-draft-geojson");
    if (!raw) return;
    setWeatherGeoJson(JSON.parse(raw), "browser-draft.geojson", { fit: true, persist: true, sourceType: "draft", sourceLabel: "浏览器草稿" });
  }

  function saveSessionGeoJson() {
    sessionStorage.setItem("weather-earth-current-geojson", JSON.stringify(currentExportGeoJson()));
  }

  function syncGeoJsonEditor() {
    if (elements.geoJsonEditor) elements.geoJsonEditor.value = JSON.stringify(currentExportGeoJson(), null, 2);
  }

  function applyGeoJsonEditor() {
    try {
      setWeatherGeoJson(JSON.parse(elements.geoJsonEditor.value || "{}"), "editor.geojson", { fit: true, persist: true, sourceType: "editor", sourceLabel: "编辑器" });
    } catch (error) {
      setStatus("GeoJSON 文本解析失败。", error.message || String(error));
    }
  }

  function updateAllUi() {
    syncControlValues();
    updateSourceBadges();
    updateCameraHud();
    updateDataDocumentInfo();
    updateTimeFilterControls();
    renderElementTypeList();
    renderFeatureList();
    updateSelectedFeatureEditor();
    updateDrawUi();
    updateMeasurementUi();
    updateValidationSummary(false);
    updateCameraTourUi();
    updateOverview();
    renderManifestControls();
  }

  function syncControlValues() {
    setActive(elements.projectionGlobe, true);
    setActive(elements.projectionMap, false);
    setActive(elements.scenePresetShowcase, activeScenePreset === "showcase");
    setActive(elements.scenePresetAudit, activeScenePreset === "audit");
    setActive(elements.scenePresetCity, activeScenePreset === "city");
    if (elements.scenePresetInfo) elements.scenePresetInfo.textContent = SCENE_PRESETS[activeScenePreset]?.detail || "";
    setChecked(elements.autoRotateGlobe, autoRotateEnabled);
    setChecked(elements.focusOrbitEnabled, focusOrbitEnabled);
    setPressed(elements.immersiveFocusOrbit, focusOrbitEnabled);
    setValue(elements.baseMapStyle, currentBaseMapKey);
    setValue(elements.immersiveBaseMapStyle, currentBaseMapKey);
    setChecked(elements.mapDetailsEnabled, mapDetailsEnabled);
    setChecked(elements.immersiveMapDetailsEnabled, mapDetailsEnabled);
    setChecked(elements.terrainEnabled, terrainEnabled);
    setChecked(elements.immersiveTerrainEnabled, terrainEnabled);
    setValue(elements.terrainExaggeration, terrainExaggeration);
    setChecked(elements.sunlightEnabled, sunlightEnabled);
    setChecked(elements.immersiveSunlightEnabled, sunlightEnabled);
    setValue(elements.sunlightIntensity, sunlightIntensity);
    setChecked(elements.buildingsEnabled, buildingsEnabled);
    setChecked(elements.immersiveBuildingsEnabled, buildingsEnabled);
    setValue(elements.buildingHeightScale, buildingHeightScale);
    setChecked(elements.weather3dEnabled, weather3dEnabled);
    setValue(elements.weather3dScale, weather3dScale);
    setChecked(elements.weatherVolumeEnabled, weatherVolumeEnabled);
    setValue(elements.weatherVolumeScale, weatherVolumeScale);
    setValue(elements.weatherOpacity, currentWeatherOpacity);
    setValue(elements.immersiveWeatherOpacity, currentWeatherOpacity);
    if (elements.immersiveWeatherOpacityValue) elements.immersiveWeatherOpacityValue.textContent = `${Math.round(currentWeatherOpacity * 100)}%`;
    setChecked(elements.showUntimedFeatures, showUntimedFeatures);
    const provider = baseMapProvider(currentBaseMapKey);
    const activeProvider = activeBaseMapProvider();
    const fallbackText = activeBaseMapFallback ? ` / 当前兜底：${activeProvider.label}` : "";
    if (elements.baseMapInfo) elements.baseMapInfo.textContent = `${provider.detail}${fallbackText}`;
    if (elements.mapDetailsInfo) elements.mapDetailsInfo.textContent = mapDetailsEnabled ? `${activeProvider.label} 细节显示已开启。` : "地图细节显示状态已关闭。";
    if (elements.terrainInfo) elements.terrainInfo.textContent = activeProvider.supportsTerrain
      ? (terrainEnabled ? `Cesium Globe 地形开启 / 强度 ${terrainExaggeration.toFixed(2)}` : "地形关闭，使用椭球表面。")
      : "当前底座不提供独立地形；天气仍贴合地球表面。";
    updateSunlightInfoText();
    if (elements.buildingInfo) elements.buildingInfo.textContent = activeProvider.supportsBuildings
      ? (buildingsEnabled ? "摄影测量建筑随 3D Tiles 加载。" : "建筑显示状态已关闭记录；摄影测量底座不回退。")
      : "当前非 Google 底座不提供摄影测量城市建筑。";
    if (elements.weather3dInfo) elements.weather3dInfo.textContent = weather3dEnabled ? `点状天气光柱 / 高度 ${weather3dScale.toFixed(2)}` : "点状 3D 标记关闭。";
    if (elements.weatherVolumeInfo) elements.weatherVolumeInfo.textContent = weatherVolumeEnabled ? `面状风区体块 / 高度 ${weatherVolumeScale.toFixed(2)}` : "面状风区体块关闭。";
    setDisabled(elements.downloadGeoJson, !currentGeoJson.features.length);
    setDisabled(elements.downloadVisibleGeoJson, !displayedGeoJson.features.length);
    setDisabled(elements.copyInlineShareUrl, !currentGeoJson.features.length);
    setDisabled(elements.copyProjectShareUrl, !currentGeoJson.features.length);
    setDisabled(elements.normalizeWeatherGeoJson, !currentGeoJson.features.length);
    setDisabled(elements.saveBrowserDraft, !currentGeoJson.features.length);
    setDisabled(elements.restoreBrowserDraft, !localStorage.getItem("weather-earth-draft-geojson"));
    if (!immersiveEnabled) earthMenuOpen = false;
    updateEarthMenuUi();
  }

  function updateSourceBadges() {
    const provider = activeBaseMapProvider();
    if (elements.projectionBadge) elements.projectionBadge.textContent = "Cesium 3D";
    if (elements.sourceBadge) {
      elements.sourceBadge.textContent = tilesetStatus === "ready"
        ? provider.shortLabel
        : tilesetStatus === "missing-token"
          ? `${provider.shortLabel} fallback`
          : tilesetStatus === "error"
            ? "Basemap error"
            : provider.shortLabel;
    }
  }

  function scheduleCameraUiUpdate(now = performance.now()) {
    if (cameraUiUpdateQueued) return;
    const elapsed = now - lastCameraUiUpdateAt;
    const delay = Math.max(0, CAMERA_UI_UPDATE_INTERVAL_MS - elapsed);
    cameraUiUpdateQueued = true;
    window.setTimeout(() => {
      cameraUiUpdateQueued = false;
      lastCameraUiUpdateAt = performance.now();
      const camera = currentCameraState();
      lastCamera = camera;
      updateCameraHud(camera);
      updateOverview(camera);
    }, delay);
  }

  function updateCameraHud(camera = currentCameraState()) {
    if (elements.cameraCenter) elements.cameraCenter.textContent = formatLngLat(camera.lon, camera.lat);
    if (elements.cameraAltitude) elements.cameraAltitude.textContent = formatDistance(zoomToHeight(camera.zoom));
    if (elements.cameraHeading) elements.cameraHeading.textContent = `${Math.round(camera.bearing)}°`;
    if (elements.cameraPitch) elements.cameraPitch.textContent = `${Math.round(camera.pitch)}°`;
    if (elements.cameraPitchSlider) elements.cameraPitchSlider.value = String(Math.round(camera.pitch));
    if (elements.cameraZoom) elements.cameraZoom.textContent = camera.zoom.toFixed(2);
    if (elements.pointerPosition) elements.pointerPosition.textContent = pointerLonLat ? formatLngLat(pointerLonLat.lon, pointerLonLat.lat) : "--";
    if (elements.pointerElevation) elements.pointerElevation.textContent = pointerLonLat ? activeBaseMapProvider().shortLabel : "--";
    if (elements.compassNeedle) elements.compassNeedle.style.transform = `rotate(${camera.bearing}deg)`;
  }

  function updateDataDocumentInfo() {
    if (!elements.dataInfo) return;
    const bounds = geoJsonBounds(currentGeoJson);
    const validation = validateWeatherGeoJson(currentGeoJson);
    elements.dataInfo.innerHTML = `
      <div><strong>${escapeHtml(currentGeoJsonName)}</strong></div>
      <div>引擎：CesiumJS / ${escapeHtml(activeBaseMapProvider().shortLabel)}</div>
      <div>要素：${currentGeoJson.features.length} / 当前显示 ${displayedGeoJson.features.length}</div>
      <div>范围：${bounds ? `${formatLngLat(bounds.west, bounds.south)} - ${formatLngLat(bounds.east, bounds.north)}` : "--"}</div>
      <div>质量：${validation.errors.length} 错误 / ${validation.warnings.length} 提示</div>
    `;
  }

  function sunlightClockText() {
    if (sunlightTimeMode === "weather-time") return `太阳时间 ${sunlightTimeLabel || formatSunlightIso(sunlightTimeIso)}`;
    return `太阳时间实时同步 ${formatSunlightIso(sunlightTimeIso)}`;
  }

  function updateSunlightInfoText() {
    if (elements.sunlightInfo) elements.sunlightInfo.textContent = sunlightEnabled ? `Cesium 太阳光照开启 / 强度 ${sunlightIntensity.toFixed(2)} / ${sunlightClockText()}` : "光照关闭。";
  }

  function formatSunlightIso(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (!validDate(date)) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function updateTimeFilterControls() {
    const times = uniqueTimes(currentGeoJson.features);
    const options = [`<option value="${TIME_FILTER_ALL}">全部时次</option>`, ...times.map((time) => `<option value="${escapeHtml(time)}">${escapeHtml(time)}</option>`)].join("");
    for (const select of [elements.timeFilterSelect, elements.immersiveTimeFilterSelect]) {
      if (!select) continue;
      const old = select.value;
      select.innerHTML = options;
      select.value = times.includes(activeTimeFilter) ? activeTimeFilter : TIME_FILTER_ALL;
      if (old !== select.value) activeTimeFilter = select.value;
      select.disabled = times.length === 0;
    }
    setDisabled(elements.resetTimeFilter, activeTimeFilter === TIME_FILTER_ALL);
    setDisabled(elements.immersiveTimeAll, activeTimeFilter === TIME_FILTER_ALL);
    if (elements.timeFilterSummary) elements.timeFilterSummary.textContent = times.length ? `${times.length} 个时次 / 当前 ${activeTimeFilter === TIME_FILTER_ALL ? "全部" : activeTimeFilter}` : "等待含时次的 GeoJSON。";
  }

  function renderElementTypeList() {
    const types = elementTypeState();
    if (elements.elementTypeSummary) elements.elementTypeSummary.textContent = types.length ? `${types.filter((type) => type.visible).length}/${types.length} 类型可见` : "等待天气元素。";
    if (!elements.elementTypeList) return;
    elements.elementTypeList.innerHTML = types.map((type) => `
      <label class="element-type-row">
        <input type="checkbox" data-type="${type.id}" ${type.visible ? "checked" : ""} />
        <span class="type-swatch" style="background:${type.color}"></span>
        <span>${escapeHtml(type.label)}</span>
        <small>${type.count}</small>
      </label>
    `).join("");
    elements.elementTypeList.querySelectorAll("[data-type]").forEach((input) => {
      input.addEventListener("change", () => setElementTypeVisibility(input.dataset.type, input.checked));
    });
  }

  function renderFeatureList() {
    if (!elements.featureList) return;
    const query = String(elements.featureSearch?.value || "").trim().toLowerCase();
    const list = currentGeoJson.features.filter((feature) => {
      const text = `${featureLabel(feature)} ${feature.properties?.weather_type || ""} ${feature.geometry?.type || ""}`.toLowerCase();
      return !query || text.includes(query);
    });
    if (elements.featureListSummary) elements.featureListSummary.textContent = list.length ? `${list.length} 个要素` : "暂无要素。";
    elements.featureList.innerHTML = list.slice(0, 160).map((feature) => {
      const id = feature.properties?.[FEATURE_ID_PROPERTY] || "";
      const active = id === selectedFeatureId ? " is-active" : "";
      return `<button type="button" class="feature-list-item${active}" data-feature-id="${id}">
        <strong>${escapeHtml(featureLabel(feature) || "未命名")}</strong>
        <span>${escapeHtml(feature.properties?.weather_type || inferWeatherType(feature))} / ${escapeHtml(feature.geometry?.type || "")}</span>
      </button>`;
    }).join("");
    elements.featureList.querySelectorAll("[data-feature-id]").forEach((button) => {
      button.addEventListener("click", () => selectFeatureById(button.dataset.featureId, { fit: true }));
    });
  }

  function updateSelectedFeatureEditor() {
    const feature = findFeatureById(selectedFeatureId);
    const enabled = Boolean(feature);
    setDisabled(elements.clearFeatureSelection, !enabled);
    setDisabled(elements.fitSelectedFeature, !enabled);
    setDisabled(elements.selectedWeatherType, !enabled);
    setDisabled(elements.selectedColor, !enabled);
    setDisabled(elements.selectedName, !enabled);
    setDisabled(elements.selectedProperties, !enabled);
    setDisabled(elements.selectedGeometry, !enabled);
    setDisabled(elements.applyWeatherTemplate, !enabled);
    setDisabled(elements.formatSelectedProperties, !enabled);
    setDisabled(elements.formatSelectedGeometry, !enabled);
    setDisabled(elements.updateSelectedFeature, !enabled);
    setDisabled(elements.deleteSelectedFeature, !enabled);
    if (!feature) {
      if (elements.selectedFeatureStatus) elements.selectedFeatureStatus.textContent = "点击地图上的天气要素进行编辑。";
      return;
    }
    if (elements.selectedFeatureStatus) elements.selectedFeatureStatus.textContent = `${featureLabel(feature) || "未命名"} / ${selectedFeatureId}`;
    if (elements.selectedWeatherType) elements.selectedWeatherType.value = feature.properties?.weather_type || inferWeatherType(feature);
    if (elements.selectedColor) elements.selectedColor.value = cssColorHex(feature.properties?.["marker-color"] || feature.properties?.color || elementTypeById(feature.properties?.weather_type)?.color || "#ffbd59");
    if (elements.selectedName) elements.selectedName.value = featureLabel(feature) || "";
    if (elements.selectedProperties) elements.selectedProperties.value = JSON.stringify(publicProperties(feature.properties || {}), null, 2);
    if (elements.selectedGeometry) elements.selectedGeometry.value = JSON.stringify(feature.geometry, null, 2);
  }

  function updateDrawUi() {
    setActive(elements.drawPoint, drawMode === "Point");
    setActive(elements.drawLine, drawMode === "LineString");
    setActive(elements.drawPolygon, drawMode === "Polygon");
    setDisabled(elements.finishDraw, !drawMode || (drawMode === "Point" ? drawCoordinates.length < 1 : drawMode === "LineString" ? drawCoordinates.length < 2 : drawCoordinates.length < 3));
    setDisabled(elements.undoDrawPoint, !drawCoordinates.length);
    setDisabled(elements.cancelDraw, !drawMode);
    if (elements.drawStatus) elements.drawStatus.textContent = drawMode ? `${drawMode} / ${drawCoordinates.length} 个点` : "未开始绘制。";
  }

  function updateMeasurementUi() {
    setActive(elements.measureDistance, measurementState.active && measurementState.mode === "distance");
    setActive(elements.measureArea, measurementState.active && measurementState.mode === "area");
    setDisabled(elements.finishMeasure, !measurementState.active || measurementState.coordinates.length < 2);
    setDisabled(elements.undoMeasurePoint, !measurementState.coordinates.length);
    setDisabled(elements.clearMeasure, !measurementState.coordinates.length);
    if (elements.measureStatus) {
      elements.measureStatus.textContent = measurementState.coordinates.length
        ? `${measurementState.mode === "area" ? "面积" : "距离"} / ${formatDistance(measurementState.lengthMeters)}${measurementState.areaSqMeters ? ` / ${formatArea(measurementState.areaSqMeters)}` : ""}`
        : "未开始测量。";
    }
  }

  function updateValidationSummary(verbose) {
    if (!elements.validationSummary) return;
    const validation = validateWeatherGeoJson(currentGeoJson);
    elements.validationSummary.textContent = currentGeoJson.features.length
      ? `${validation.ok ? "通过" : "有错误"} / ${validation.summary.featureCount} 要素 / ${validation.errors.length} 错误 / ${validation.warnings.length} 提示`
      : "等待 GeoJSON。";
    if (verbose) setStatus(validation.ok ? "GeoJSON 校验通过。" : "GeoJSON 校验发现问题。", `${validation.errors.length} 错误 / ${validation.warnings.length} 提示`);
  }

  function updateCameraTourUi() {
    setDisabled(elements.playCameraTour, !cameraTourStops.length);
    setDisabled(elements.immersivePlayTour, !cameraTourStops.length);
    setDisabled(elements.clearCameraTour, !cameraTourStops.length);
    if (elements.cameraTourSummary) elements.cameraTourSummary.textContent = cameraTourStops.length ? `${cameraTourStops.length} 个视角书签` : "暂无视角书签。";
    if (elements.immersiveTourCount) elements.immersiveTourCount.textContent = String(cameraTourStops.length);
    if (elements.cameraTourList) {
      elements.cameraTourList.innerHTML = cameraTourStops.map((stop, index) => `<button type="button" data-stop="${index}" class="${index === cameraTourIndex ? "is-active" : ""}"><strong>${escapeHtml(stop.label || `镜头 ${index + 1}`)}</strong><span>${escapeHtml(stop.time || "")}</span></button>`).join("");
      elements.cameraTourList.querySelectorAll("[data-stop]").forEach((button) => button.addEventListener("click", () => flyToCamera(cameraTourStops[Number(button.dataset.stop)].camera)));
    }
  }

  function updateOverview(camera = currentCameraState()) {
    if (elements.earthOverviewLabel) {
      elements.earthOverviewLabel.textContent = `${camera.zoom.toFixed(1)} / ${Math.round(camera.bearing)}°`;
    }
    if (elements.earthOverviewCameraDot) {
      const x = ((camera.lon - 72) / (136 - 72)) * 220;
      const y = 138 - ((camera.lat - 16) / (55 - 16)) * 138;
      elements.earthOverviewCameraDot.setAttribute("cx", String(clamp(x, 0, 220)));
      elements.earthOverviewCameraDot.setAttribute("cy", String(clamp(y, 0, 138)));
    }
    if (elements.earthOverviewFocusDot) {
      if (focusTarget) {
        const x = ((focusTarget.lon - 72) / (136 - 72)) * 220;
        const y = 138 - ((focusTarget.lat - 16) / (55 - 16)) * 138;
        elements.earthOverviewFocusDot.hidden = false;
        elements.earthOverviewFocusDot.setAttribute("cx", String(clamp(x, 0, 220)));
        elements.earthOverviewFocusDot.setAttribute("cy", String(clamp(y, 0, 138)));
        elements.earthOverviewFocusDot.setAttribute("r", "5");
      } else {
        elements.earthOverviewFocusDot.hidden = true;
      }
    }
  }

  function addCurrentCameraTourStop(options = {}) {
    const camera = currentCameraState();
    cameraTourStops.push({ label: options.label || `镜头 ${cameraTourStops.length + 1}`, time: activeTimeFilter !== TIME_FILTER_ALL ? activeTimeFilter : "", camera, duration: 2 });
    updateCameraTourUi();
    emitWeatherEarthEvent("tourchange", { cameraTour: cameraTourState() });
    return cameraTourState();
  }

  function setCameraTourStops(stops = []) {
    cameraTourStops = stops.map((stop, index) => ({ label: stop.label || `镜头 ${index + 1}`, time: stop.time || "", camera: normalizeCamera(stop.camera || stop), duration: Number(stop.duration || 2) }));
    updateCameraTourUi();
    return cameraTourState();
  }

  function playCameraTourPlayback(options = {}) {
    if (!cameraTourStops.length) return cameraTourState();
    stopCameraTourPlayback();
    cameraTourPlaying = true;
    cameraTourIndex = 0;
    const playNext = () => {
      if (!cameraTourPlaying) return;
      const stop = cameraTourStops[cameraTourIndex];
      if (!stop) return stopCameraTourPlayback();
      if (stop.time) setTimeFilter(stop.time, { notify: false });
      flyToCamera(stop.camera, { duration: options.duration || stop.duration || 2 });
      if (elements.cameraTourCaption) {
        elements.cameraTourCaption.querySelector("strong").textContent = stop.label || `镜头 ${cameraTourIndex + 1}`;
        elements.cameraTourCaption.querySelector("small").textContent = stop.time || "";
      }
      updateCameraTourUi();
      cameraTourIndex += 1;
      cameraTourTimer = window.setTimeout(playNext, Number(stop.duration || 2) * 1000 + 600);
    };
    playNext();
    return cameraTourState();
  }

  function stopCameraTourPlayback() {
    cameraTourPlaying = false;
    window.clearTimeout(cameraTourTimer);
    cameraTourTimer = 0;
    cameraTourIndex = -1;
    updateCameraTourUi();
    return cameraTourState();
  }

  function clearCameraTourStops() {
    stopCameraTourPlayback();
    cameraTourStops = [];
    updateCameraTourUi();
    emitWeatherEarthEvent("tourchange", { cameraTour: cameraTourState() });
    return cameraTourState();
  }

  function fitCurrentGeoJson() {
    const bounds = geoJsonBounds(displayedGeoJson.features.length ? displayedGeoJson : currentGeoJson);
    if (!bounds) return;
    flyToBounds(bounds);
  }

  function fitFeatureById(id) {
    const feature = findFeatureById(id);
    if (!feature) return;
    const bounds = geoJsonBounds({ type: "FeatureCollection", features: [feature] });
    if (bounds) flyToBounds(bounds);
  }

  function flyToBounds(bounds) {
    const lon = (bounds.west + bounds.east) / 2;
    const lat = (bounds.south + bounds.north) / 2;
    const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south, 0.01);
    const zoom = clamp(Math.log2(260 / span), 2, 14.5);
    flyToCamera({ lon, lat, zoom, bearing: -18, pitch: span < 1 ? 58 : 46 });
  }

  function weatherEarthState() {
    const camera = currentCameraState();
    return {
      ready: readyEmitted,
      engine: ENGINE,
      scenePreset: scenePresetState(),
      benchmarkPaths: benchmarkPathState(),
      qualityProfile: qualityProfileState(),
      visualTreatment: visualTreatmentState(),
      projection: currentProjection,
      basemap: currentBaseMapKey,
      basemapLabel: baseMapProvider(currentBaseMapKey).label,
      immersive: immersiveModeState(),
      autoRotate: autoRotateEnabled,
      focusOrbit: focusOrbitState(),
      center: { lon: camera.lon, lat: camera.lat },
      zoom: camera.zoom,
      bearing: camera.bearing,
      pitch: camera.pitch,
      camera: { ...camera, center: { lon: camera.lon, lat: camera.lat } },
      hasWeather: Boolean(currentGeoJson.features.length),
      featureCount: currentGeoJson.features.length,
      displayedFeatureCount: displayedGeoJson.features.length,
      dataMeta: cloneJson(currentGeoJsonMeta),
      activeTimeFilter,
      weatherOpacity: currentWeatherOpacity,
      earthVisual: earthVisualState(),
      metrics: captureMetrics({ lightweight: true }),
      mapDetails: mapDetailState(),
      terrain: terrainState(),
      sunlight: sunlightState(),
      buildings: buildingState(),
      weather3d: weather3dState(),
      weatherVolume: weatherVolumeState(),
      locationSearch: publicLocationSearchResult(lastLocationSearch),
      focusTarget: publicFocusTarget(focusTarget),
      surfaceProbe: publicSurfaceProbe(surfaceProbe),
      measurement: measureState(),
      cameraTour: cameraTourState(),
      layers: weatherLayerState(),
      elementTypes: elementTypeState(),
      status: elements.statusTitle?.textContent || "",
      mapStatus: elements.statusDetail?.textContent || "",
    };
  }

  function earthVisualState() {
    const provider = baseMapProvider(currentBaseMapKey);
    return {
      mode: provider.id === GOOGLE_TILESET_MODE ? "cesium-3d-tiles" : "cesium-globe",
      engine: ENGINE,
      provider: "CesiumJS",
      tileset: tilesetState(),
      qualityProfile: qualityProfileState(),
      visualTreatment: visualTreatmentState(),
      photogrammetry: provider.id === GOOGLE_TILESET_MODE,
      atmosphere: true,
      sunlight: sunlightState(),
      terrain: terrainState(),
      buildings: buildingState(),
      projection: currentProjection,
    };
  }

  function tilesetState() {
    const provider = baseMapProvider(currentBaseMapKey);
    const activeProvider = activeBaseMapProvider();
    return {
      id: provider.id,
      label: provider.label,
      provider: provider.provider,
      activeId: activeProvider.id,
      activeLabel: activeProvider.label,
      fallback: activeBaseMapFallback || "",
      mode: provider.mode,
      status: tilesetStatus,
      error: tilesetError,
      requiresIonToken: Boolean(provider.requiresIonToken),
      tokenConfigured: Boolean(configuredIonToken()),
      qualityProfile: activeQualityProfile,
      maximumScreenSpaceError: googleTileset?.maximumScreenSpaceError ?? activeQualitySettings().maximumScreenSpaceError,
      dynamicScreenSpaceError: googleTileset?.dynamicScreenSpaceError ?? activeQualitySettings().dynamicScreenSpaceError,
    };
  }

  function qualityProfileState() {
    const settings = activeQualitySettings();
    return {
      id: activeQualityProfile,
      label: settings.label,
      detail: settings.detail,
      maximumScreenSpaceError: settings.maximumScreenSpaceError,
      dynamicScreenSpaceError: settings.dynamicScreenSpaceError,
      globeMaximumScreenSpaceError: settings.globeMaximumScreenSpaceError,
      resolutionScale: settings.resolutionScale,
      msaaSamples: settings.msaaSamples,
      requestsByServer: currentBaseMapKey === GOOGLE_TILESET_MODE ? settings.requestsByServer : null,
      tileServer: currentBaseMapKey === GOOGLE_TILESET_MODE ? TILE_SERVER_KEY : null,
      available: Object.values(QUALITY_PROFILES).map((profile) => ({
        id: profile.id,
        label: profile.label,
        detail: profile.detail,
        maximumScreenSpaceError: profile.maximumScreenSpaceError,
        dynamicScreenSpaceError: profile.dynamicScreenSpaceError,
        globeMaximumScreenSpaceError: profile.globeMaximumScreenSpaceError,
        resolutionScale: profile.resolutionScale,
        msaaSamples: profile.msaaSamples,
        requestsByServer: profile.requestsByServer,
      })),
    };
  }

  function captureMetrics(options = {}) {
    const canvas = viewer?.scene?.canvas;
    const creditContainer = viewer?.cesiumWidget?.creditContainer;
    const memoryBytes = numberOrNull(googleTileset?.totalMemoryUsageInBytes);
    const metrics = {
      capturedAt: new Date().toISOString(),
      engine: ENGINE,
      ready: readyEmitted,
      qualityProfile: qualityProfileState(),
      camera: currentCameraState(),
      display: {
        devicePixelRatio: numberOrNull(window.devicePixelRatio),
        resolutionScale: numberOrNull(viewer?.resolutionScale),
        msaaSamples: numberOrNull(viewer?.scene?.msaaSamples),
        globeMaximumScreenSpaceError: numberOrNull(viewer?.scene?.globe?.maximumScreenSpaceError),
        canvasClientWidth: numberOrNull(canvas?.clientWidth),
        canvasClientHeight: numberOrNull(canvas?.clientHeight),
        canvasWidth: numberOrNull(canvas?.width),
        canvasHeight: numberOrNull(canvas?.height),
      },
      performance: {
        fps: round(renderMetrics.fps, 1),
        frameLatencyMs: round(renderMetrics.frameLatencyMs, 1),
        frameCount: renderMetrics.frameCount,
      },
      interaction: {
        active: cameraInteractionActive,
        qualityActive: interactionQualityActive,
        reason: cameraInteractionReason,
        durationMs: cameraInteractionActive ? Math.round(performance.now() - cameraInteractionStartedAt) : 0,
        pointerProbeIntervalMs: POINTER_PROBE_INTERVAL_MS,
        urlUpdateDeferred: replaceUrlQueuedDuringInteraction,
      },
      tileset: {
        ...tilesetState(),
        memoryBytes,
        memoryMB: memoryBytes === null ? null : round(memoryBytes / 1048576, 1),
        tilesLoaded: Boolean(googleTileset?.tilesLoaded),
        cacheBytes: numberOrNull(googleTileset?.cacheBytes),
      },
      scene: {
        highDynamicRange: Boolean(viewer?.scene?.highDynamicRange),
        skyAtmosphere: Boolean(viewer?.scene?.skyAtmosphere?.show),
        visualTreatment: visualTreatmentState(),
        primitives: numberOrNull(viewer?.scene?.primitives?.length),
      },
      weather: {
        featureCount: currentGeoJson.features.length,
        displayedFeatureCount: displayedGeoJson.features.length,
        entityCount: weatherEntities.length,
        utilityEntityCount: utilityEntities.length,
        opacity: currentWeatherOpacity,
      },
      attribution: {
        creditContainerVisible: creditContainer ? getComputedStyle(creditContainer).display !== "none" : false,
      },
    };
    if (!options.lightweight) metrics.resources = tileResourceSummary();
    return metrics;
  }

  async function runBenchmarkPath(stops = [], options = {}) {
    const path = normalizeBenchmarkStops(stops);
    const duration = Math.max(0, Number(options.duration ?? 1.1));
    const settleMs = Math.max(0, Number(options.settleMs ?? 900));
    const startedAt = new Date().toISOString();
    const results = [];
    for (let index = 0; index < path.length; index += 1) {
      const stop = path[index];
      flyToCamera(stop.camera, { duration });
      await delay(duration * 1000 + settleMs);
      results.push({
        index,
        label: stop.label,
        requestedCamera: cloneJson(stop.camera),
        camera: currentCameraState(),
        metrics: captureMetrics(),
      });
    }
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      qualityProfile: qualityProfileState(),
      stopCount: results.length,
      results,
    };
  }

  function normalizeBenchmarkStops(stops = []) {
    const source = benchmarkStopSource(stops);
    return source.map((entry, index) => {
      if (typeof entry === "string") {
        const place = EARTH_PLACE_PRESETS.find((preset) => preset.id === entry) || EARTH_PLACE_PRESETS[0];
        return { label: place.label, camera: normalizeCamera(place.camera) };
      }
      const placeId = entry?.placeId || entry?.id;
      const place = placeId ? EARTH_PLACE_PRESETS.find((preset) => preset.id === placeId) : null;
      return {
        label: entry?.label || place?.label || `Benchmark ${index + 1}`,
        camera: normalizeCamera(entry?.camera || place?.camera || entry || DEFAULT_VIEW),
      };
    });
  }

  function benchmarkStopSource(stops = []) {
    if (typeof stops === "string") {
      return EARTH_BENCHMARK_PATHS[stops]?.stops || [stops];
    }
    if (Array.isArray(stops) && stops.length) return stops;
    return EARTH_BENCHMARK_PATHS["google-earth-p1"].stops;
  }

  function tileResourceSummary() {
    const entries = typeof performance?.getEntriesByType === "function" ? performance.getEntriesByType("resource") : [];
    const domains = basemapResourceDomains();
    const tileEntries = entries.filter((entry) => domains.some((domain) => String(entry.name || "").includes(domain)));
    const recentCutoff = performance.now() - 30000;
    const recent = tileEntries.filter((entry) => Number(entry.startTime || 0) >= recentCutoff);
    const sum = (items, key) => items.reduce((total, entry) => total + (Number(entry[key]) || 0), 0);
    return {
      tileServer: currentBaseMapKey === GOOGLE_TILESET_MODE ? TILE_SERVER_KEY : null,
      domains,
      requestsByServer: currentBaseMapKey === GOOGLE_TILESET_MODE ? Cesium?.RequestScheduler?.requestsByServer?.[TILE_SERVER_KEY] ?? null : null,
      count: tileEntries.length,
      recentCount: recent.length,
      transferSizeBytes: Math.round(sum(tileEntries, "transferSize")),
      encodedBodySizeBytes: Math.round(sum(tileEntries, "encodedBodySize")),
      decodedBodySizeBytes: Math.round(sum(tileEntries, "decodedBodySize")),
      totalDurationMs: round(sum(tileEntries, "duration"), 1),
      recentDurationMs: round(sum(recent, "duration"), 1),
    };
  }

  function basemapResourceDomains() {
    const provider = activeBaseMapProvider();
    if (provider.id === GOOGLE_TILESET_MODE) return ["tile.googleapis.com"];
    if (provider.id === "cesium-world-terrain") return ["assets.ion.cesium.com", "api.cesium.com", "arcgisonline.com", "tile.openstreetmap.org"];
    if (provider.id === "esri-world-imagery") return ["arcgisonline.com"];
    if (provider.id === "openstreetmap-imagery") return ["tile.openstreetmap.org"];
    return [];
  }

  function scenePresetState() {
    return {
      current: activeScenePreset,
      label: SCENE_PRESETS[activeScenePreset]?.label || "",
      detail: SCENE_PRESETS[activeScenePreset]?.detail || "",
      available: Object.entries(SCENE_PRESETS).map(([id, preset]) => ({ id, label: preset.label, detail: preset.detail })),
    };
  }

  function visualTreatmentState() {
    const sky = viewer?.scene?.skyAtmosphere || {};
    const fog = viewer?.scene?.fog || {};
    return {
      id: EARTH_VISUAL_TREATMENT.id,
      label: EARTH_VISUAL_TREATMENT.label,
      exposure: numberOrNull(viewer?.scene?.exposure),
      skyAtmosphere: {
        enabled: Boolean(viewer?.scene?.skyAtmosphere?.show),
        hueShift: numberOrNull(sky.hueShift),
        saturationShift: numberOrNull(sky.saturationShift),
        brightnessShift: numberOrNull(sky.brightnessShift),
      },
      fog: {
        enabled: Boolean(fog.enabled),
        density: numberOrNull(fog.density),
        minimumBrightness: numberOrNull(fog.minimumBrightness),
        screenSpaceErrorFactor: numberOrNull(fog.screenSpaceErrorFactor),
      },
    };
  }

  function mapDetailState() {
    const provider = activeBaseMapProvider();
    return { enabled: mapDetailsEnabled, provider: provider.label, mode: mapDetailsEnabled ? provider.mode : "state-recorded" };
  }

  function terrainState() {
    const provider = baseMapProvider(currentBaseMapKey);
    const activeProvider = activeBaseMapProvider();
    return {
      enabled: terrainEnabled && activeProvider.supportsTerrain && tilesetStatus === "ready",
      requested: terrainEnabled,
      exaggeration: Number(terrainExaggeration.toFixed(2)),
      source: provider.id,
      activeSource: activeProvider.id,
      mode: activeProvider.supportsTerrain ? (terrainEnabled ? "cesium-terrain-provider" : "ellipsoid") : "ellipsoid",
    };
  }

  function sunlightState() {
    return {
      enabled: sunlightEnabled,
      intensity: Number(sunlightIntensity.toFixed(2)),
      mode: sunlightEnabled ? "cesium-sun-light" : "off",
      clockMode: sunlightTimeMode,
      currentTime: sunlightTimeIso || "",
      label: sunlightTimeLabel,
      source: sunlightTimeSource,
      autoUpdate: sunlightTimeMode === "realtime",
    };
  }

  function buildingState() {
    const provider = baseMapProvider(currentBaseMapKey);
    const activeProvider = activeBaseMapProvider();
    return {
      enabled: buildingsEnabled && activeProvider.supportsBuildings && tilesetStatus === "ready",
      requested: buildingsEnabled,
      heightScale: Number(buildingHeightScale.toFixed(2)),
      source: provider.id,
      activeSource: activeProvider.id,
      mode: activeProvider.supportsBuildings ? (buildingsEnabled ? "photogrammetry-3d-tiles" : "state-off") : "not-available",
    };
  }

  function weather3dState() {
    return { enabled: weather3dEnabled, scale: Number(weather3dScale.toFixed(2)), mode: weather3dEnabled ? "cesium-cylinder-entities" : "off" };
  }

  function weatherVolumeState() {
    return { enabled: weatherVolumeEnabled, scale: Number(weatherVolumeScale.toFixed(2)), mode: weatherVolumeEnabled ? "cesium-extruded-polygons" : "off" };
  }

  function focusOrbitState() {
    return { enabled: focusOrbitEnabled, targetId: focusTarget?.id || "", degreesPerSecond: FOCUS_ORBIT_DEGREES_PER_SECOND };
  }

  function immersiveModeState() {
    return { enabled: immersiveEnabled };
  }

  function measureState() {
    return {
      mode: measurementState.mode,
      active: measurementState.active,
      finalized: measurementState.finalized,
      coordinates: measurementState.coordinates.map((p) => [p.lon, p.lat]),
      lengthMeters: Math.round(measurementState.lengthMeters),
      areaSqMeters: Math.round(measurementState.areaSqMeters),
    };
  }

  function cameraTourState(options = {}) {
    return {
      playing: options.includeRuntime === false ? false : cameraTourPlaying,
      index: options.includeRuntime === false ? -1 : cameraTourIndex,
      stops: cameraTourStops.map((stop) => cloneJson(stop)),
    };
  }

  function weatherLayerState() {
    return WEATHER_LAYERS.map((layer) => ({ id: layer.id, label: layer.label, visible: layerVisibility.get(layer.id) !== false }));
  }

  function elementTypeState() {
    const counts = {};
    currentGeoJson.features.forEach((feature) => {
      const type = feature.properties?.weather_type || inferWeatherType(feature);
      counts[type] = (counts[type] || 0) + 1;
    });
    const ids = new Set([...WEATHER_ELEMENT_TYPES.map((type) => type.id), ...Object.keys(counts)]);
    return [...ids].map((id) => {
      const type = elementTypeById(id) || { id, label: id, color: "#8ef6ff" };
      return { id, label: type.label || id, color: type.color || "#8ef6ff", visible: elementTypeVisibility.get(id) !== false, count: counts[id] || 0 };
    });
  }

  function setElementTypeVisibility(id, visible) {
    elementTypeVisibility.set(id, Boolean(visible));
    renderWeather();
    emitWeatherEarthEvent("filterchange", { elementTypes: elementTypeState() });
    return elementTypeState().find((type) => type.id === id);
  }

  function setAllElementTypeVisibility(visible) {
    for (const type of elementTypeState()) elementTypeVisibility.set(type.id, Boolean(visible));
    renderWeather();
    emitWeatherEarthEvent("filterchange", { elementTypes: elementTypeState() });
    return elementTypeState();
  }

  function setWeatherLayerVisibility(id, visible) {
    layerVisibility.set(id, Boolean(visible));
    renderWeather();
    emitWeatherEarthEvent("layerchange", { layers: weatherLayerState() });
    return weatherLayerState().find((layer) => layer.id === id);
  }

  function applyProjectLayerState(layers = []) {
    for (const layer of layers || []) {
      if (layer?.id) layerVisibility.set(layer.id, layer.visible !== false);
    }
  }

  function applyElementTypeVisibilityState(types = []) {
    if (!Array.isArray(types) || !types.length) return;
    for (const type of types) {
      if (type?.id) elementTypeVisibility.set(type.id, type.visible !== false);
    }
  }

  function applyProjectFocusTargetState(view = {}) {
    const raw = view.focusTarget && typeof view.focusTarget === "object" ? view.focusTarget : null;
    focusTarget = raw && validLonLat(Number(raw.lon), Number(raw.lat)) ? { ...raw, lon: Number(raw.lon), lat: Number(raw.lat) } : null;
  }

  function applyProjectMeasurementState(view = {}) {
    const raw = view.measurement && typeof view.measurement === "object" ? view.measurement : null;
    if (!raw) return;
    const coordinates = Array.isArray(raw.coordinates) ? raw.coordinates.map((coord) => ({ lon: Number(coord[0] ?? coord.lon), lat: Number(coord[1] ?? coord.lat) })).filter((coord) => validLonLat(coord.lon, coord.lat)) : [];
    measurementState = { mode: raw.mode === "area" ? "area" : "distance", active: false, finalized: true, coordinates, lengthMeters: 0, areaSqMeters: 0 };
    recalcMeasurement();
  }

  function applyProjectCameraTourState(view = {}) {
    const raw = view.cameraTour && typeof view.cameraTour === "object" ? view.cameraTour : {};
    if (Array.isArray(raw.stops)) setCameraTourStops(raw.stops);
  }

  function weatherFeatureList(options = {}) {
    const source = options.visible ? displayedGeoJson.features : currentGeoJson.features;
    return source.map((feature) => publicFeatureEnvelope(feature));
  }

  function selectedFeature() {
    const feature = findFeatureById(selectedFeatureId);
    return feature ? publicFeatureEnvelope(feature) : null;
  }

  function exposeApi() {
    globalThis.weatherEarth = weatherEarthApi;
    window.weatherEarth = weatherEarthApi;
    document.documentElement.dataset.weatherEarthApi = "ready";
    document.documentElement.dataset.weatherEarthMethods = Object.keys(weatherEarthApi).join(",");
    window.addEventListener("message", async (event) => {
      const message = event.data;
      if (!message || typeof message !== "object" || message.target !== REQUEST_TARGET) return;
      try {
        const result = await handleClientRequest(message);
        event.source?.postMessage({ target: RESPONSE_TARGET, type: "response", requestId: message.requestId, result }, event.origin || "*");
      } catch (error) {
        event.source?.postMessage({ target: RESPONSE_TARGET, type: "error", requestId: message.requestId, error: error?.message || String(error) }, event.origin || "*");
      }
    });
  }

  const weatherEarthApi = {
    getReady() { return cloneJson(weatherEarthReadyDetail("api")); },
    getState() { return cloneJson(weatherEarthState()); },
    getQualityProfile() { return cloneJson(qualityProfileState()); },
    setQualityProfile(profile) { const qualityProfile = setQualityProfile(profile); return { qualityProfile: cloneJson(qualityProfile), state: this.getState() }; },
    captureMetrics(options = {}) { return cloneJson(captureMetrics(options)); },
    async runBenchmarkPath(stops = [], options = {}) { return cloneJson(await runBenchmarkPath(stops, options)); },
    getBenchmarkPaths() { return cloneJson(benchmarkPathState()); },
    getPlaces() { return cloneJson(EARTH_PLACE_PRESETS); },
    getScenePresets() { return cloneJson(scenePresetState().available); },
    setScenePreset(key) { const scenePreset = applyScenePreset(key, { eventReason: "external-scene-preset" }); return { scenePreset: cloneJson(scenePreset), state: this.getState() }; },
    searchPlaces(query, options = {}) { return cloneJson(searchEarthPlaces(query, options)); },
    getFocusTarget() { return cloneJson(publicFocusTarget(focusTarget)); },
    getSurfaceProbe() { return cloneJson(publicSurfaceProbe(surfaceProbe)); },
    setSurfaceProbe(point, options = {}) { const probe = setSurfaceProbeFromLngLat(point, { ...options, source: options.source || "external-surface-probe" }); return { surfaceProbe: cloneJson(probe), state: this.getState() }; },
    clearSurfaceProbe() { closeSurfaceProbe(); return { surfaceProbe: null, state: this.getState() }; },
    getGeoJson(options = {}) { return currentExportGeoJson(options); },
    getProject(options = {}) { return cloneJson(buildWeatherEarthProject(options)); },
    setGeoJson(payload, options = {}) { return setWeatherGeoJson(payload, options.name || "external-weather.geojson", { persist: options.persist === true, fit: options.fit === true, sourceType: options.sourceType || "external-api", sourceValue: options.sourceValue || "", sourceLabel: options.sourceLabel || "外部 API" }); },
    appendGeoJson(payload, options = {}) { return appendWeatherGeoJson(payload, options.name || currentGeoJsonName, options); },
    createWeatherElement(input) { return cloneJson(createWeatherElement(input)); },
    addWeatherElement(input, options = {}) { return addWeatherElement(input, options); },
    async setProject(payload, options = {}) { return applyWeatherEarthProject(payload, { ...options, sourceLabel: options.sourceLabel || options.name || "外部项目文档", eventReason: options.eventReason || "external-project" }); },
    addFeature(feature, options = {}) { return addWeatherFeature(feature, options); },
    updateFeature(id, patch, options = {}) { return updateWeatherFeature(id, patch, options); },
    deleteFeature(id) { return deleteWeatherFeature(id); },
    selectFeature(id, options = {}) { selectFeatureById(id, { fit: options.fit === true }); const selected = selectedFeature(); if (!selected) throw new Error(`Weather feature not found: ${id || ""}`); return { selected, state: this.getState() }; },
    getFeatures(options = {}) { return cloneJson(weatherFeatureList(options)); },
    getLayers() { return cloneJson(weatherLayerState()); },
    getElementTypes() { return cloneJson(elementTypeState()); },
    getElementTypeState() { return cloneJson(elementTypeState()); },
    setElementTypeVisibility(id, visible) { const type = setElementTypeVisibility(id, visible); return { type: cloneJson(type), state: this.getState() }; },
    setAllElementTypeVisibility(visible) { const types = setAllElementTypeVisibility(visible); return { types: cloneJson(types), state: this.getState() }; },
    setLayerVisibility(id, visible) { const layer = setWeatherLayerVisibility(id, visible); return { layer: cloneJson(layer), state: this.getState() }; },
    setWeatherOpacity(value) { const opacity = setWeatherOpacity(value); return { opacity, state: this.getState() }; },
    setMapDetails(enabled) { const mapDetails = setMapDetailsEnabled(enabled); return { mapDetails, state: this.getState() }; },
    setTerrain(enabled) { const terrain = setTerrainEnabled(enabled); return { terrain, state: this.getState() }; },
    setTerrainExaggeration(value) { const terrain = setTerrainExaggeration(value); return { terrain, state: this.getState() }; },
    setSunlight(enabled) { const sunlight = setSunlightEnabled(enabled); return { sunlight, state: this.getState() }; },
    setSunlightIntensity(value) { const sunlight = setSunlightIntensity(value); return { sunlight, state: this.getState() }; },
    setSunlightTime(value, options = {}) { const sunlight = setSunlightTime(value, { ...options, notify: options.notify !== false }); updateAllUi(); return { sunlight, state: this.getState() }; },
    setBuildings(enabled) { const buildings = setBuildingsEnabled(enabled); return { buildings, state: this.getState() }; },
    setBuildingHeightScale(value) { const buildings = setBuildingHeightScale(value); return { buildings, state: this.getState() }; },
    setWeather3d(enabled) { const weather3d = setWeather3dEnabled(enabled); return { weather3d, state: this.getState() }; },
    setWeather3dScale(value) { const weather3d = setWeather3dScale(value); return { weather3d, state: this.getState() }; },
    setWeatherVolume(enabled) { const weatherVolume = setWeatherVolumeEnabled(enabled); return { weatherVolume, state: this.getState() }; },
    setWeatherVolumeScale(value) { const weatherVolume = setWeatherVolumeScale(value); return { weatherVolume, state: this.getState() }; },
    setFocusTarget(target, options = {}) { const focus = setFocusTargetState(target, { ...options, eventReason: "external-focus-target" }); return { focusTarget: cloneJson(focus), state: this.getState() }; },
    clearFocusTarget() { clearFocusTargetState({ eventReason: "external-focus-clear" }); return { focusTarget: null, state: this.getState() }; },
    setFocusOrbit(enabled) { const focusOrbit = setFocusOrbitEnabled(enabled); return { focusOrbit, state: this.getState() }; },
    getMeasurement() { return cloneJson(measureState()); },
    startMeasurement(mode = "distance") { startMeasureMode(mode); return { measurement: cloneJson(measureState()), state: this.getState() }; },
    addMeasurementPoint(point, options = {}) { return { measurement: cloneJson(addMeasurementPointTool(point, options)), state: this.getState() }; },
    finishMeasurement() { return { measurement: cloneJson(finishMeasurementTool()), state: this.getState() }; },
    undoMeasurementPoint() { return { measurement: cloneJson(undoMeasurePoint()), state: this.getState() }; },
    clearMeasurement() { return { measurement: cloneJson(clearMeasurementState()), state: this.getState() }; },
    getCameraTour() { return cloneJson(cameraTourState()); },
    setCameraTour(stops = []) { return { cameraTour: cloneJson(setCameraTourStops(stops)), state: this.getState() }; },
    addCameraTourStop(stop = {}) { cameraTourStops.push({ label: stop.label || `镜头 ${cameraTourStops.length + 1}`, time: stop.time || "", camera: normalizeCamera(stop.camera || stop), duration: Number(stop.duration || 2) }); updateCameraTourUi(); return { cameraTour: cloneJson(cameraTourState()), state: this.getState() }; },
    playCameraTour(options = {}) { return { cameraTour: cloneJson(playCameraTourPlayback(options)), state: this.getState() }; },
    stopCameraTour() { return { cameraTour: cloneJson(stopCameraTourPlayback()), state: this.getState() }; },
    clearCameraTour() { return { cameraTour: cloneJson(clearCameraTourStops()), state: this.getState() }; },
    async loadGeoJsonUrl(url, options = {}) { await loadGeoJsonFromUrl(url, options.label || options.name || "", { fit: options.fit === true, shareValue: options.shareValue }); return this.getState(); },
    async loadManifestUrl(url, options = {}) { await loadManifestFromUrl(url, options); return this.getState(); },
    async loadProjectUrl(url, options = {}) { await loadProjectFromUrl(url, options.label || options.name || "", { ...options, shareValue: options.shareValue }); return this.getState(); },
    clearWeather() { return clearWeatherLayers(); },
    standardize() { return normalizeCurrentWeatherGeoJson(); },
    validate(options = {}) { return cloneJson(validateWeatherGeoJson(options.payload || currentGeoJson, options)); },
    getValidationReport(options = {}) { return cloneJson(buildValidationReport(options)); },
    async setBasemap(key) { await setBaseMapStyle(key); return this.getState(); },
    setProjection(projection) { setProjection(projection); return this.getState(); },
    setImmersiveMode(enabled) { const immersive = applyImmersiveMode(enabled); return { immersive, state: this.getState() }; },
    flyToPlace(placeId, options = {}) { return cloneJson(flyToPlace(placeId, options)); },
    flyToSearch(query, options = {}) { return cloneJson(flyToSearch(query, options)); },
    flyToCamera(camera, options = {}) { return cloneJson(flyToCamera(camera, options)); },
    setCameraPitch(pitch, options = {}) { const camera = setCameraPitch(pitch, options); return { camera: cloneJson(camera), state: this.getState() }; },
    setTimeFilter(value, options = {}) { const selected = setTimeFilter(value, options); return { selected, state: this.getState() }; },
    fitWeather() { fitCurrentGeoJson(); return this.getState(); },
  };

  async function handleClientRequest(message) {
    const options = message.options || {};
    switch (message.type) {
      case "ping":
      case "get-ready": return weatherEarthApi.getReady();
      case "set-geojson": return weatherEarthApi.setGeoJson(message.geojson || message.payload, options);
      case "append-geojson": return weatherEarthApi.appendGeoJson(message.geojson || message.payload, options);
      case "create-weather-element": return weatherEarthApi.createWeatherElement(message.element || message.feature || message.payload);
      case "add-weather-element": return weatherEarthApi.addWeatherElement(message.element || message.feature || message.payload, options);
      case "add-feature": return weatherEarthApi.addFeature(message.feature || message.payload, options);
      case "update-feature": return weatherEarthApi.updateFeature(message.id || message.featureId, message.patch || message.feature || message.payload, options);
      case "delete-feature": return weatherEarthApi.deleteFeature(message.id || message.featureId, options);
      case "select-feature": return weatherEarthApi.selectFeature(message.id || message.featureId, options);
      case "get-features": return weatherEarthApi.getFeatures(options);
      case "get-layers": return weatherEarthApi.getLayers();
      case "get-quality-profile": return weatherEarthApi.getQualityProfile();
      case "set-quality-profile": return weatherEarthApi.setQualityProfile(message.profile || message.qualityProfile || message.value);
      case "capture-metrics": return weatherEarthApi.captureMetrics(options);
      case "run-benchmark-path": return weatherEarthApi.runBenchmarkPath(message.stops || message.path || message.payload || [], options);
      case "get-benchmark-paths": return weatherEarthApi.getBenchmarkPaths();
      case "get-element-types": return weatherEarthApi.getElementTypes();
      case "get-element-type-state": return weatherEarthApi.getElementTypeState();
      case "set-element-type-visibility": return weatherEarthApi.setElementTypeVisibility(message.id || message.typeId || message.weatherType, message.visible);
      case "set-all-element-type-visibility": return weatherEarthApi.setAllElementTypeVisibility(message.visible);
      case "set-layer-visibility": return weatherEarthApi.setLayerVisibility(message.id || message.layerId, message.visible);
      case "set-weather-opacity": return weatherEarthApi.setWeatherOpacity(message.value ?? message.opacity);
      case "set-map-details": return weatherEarthApi.setMapDetails(message.enabled ?? message.value);
      case "set-terrain": return weatherEarthApi.setTerrain(message.enabled ?? message.value);
      case "set-terrain-exaggeration": return weatherEarthApi.setTerrainExaggeration(message.value ?? message.exaggeration);
      case "set-sunlight": return weatherEarthApi.setSunlight(message.enabled ?? message.value);
      case "set-sunlight-intensity": return weatherEarthApi.setSunlightIntensity(message.value ?? message.intensity ?? message.opacity);
      case "set-sunlight-time": return weatherEarthApi.setSunlightTime(message.time ?? message.value, options);
      case "set-buildings": return weatherEarthApi.setBuildings(message.enabled ?? message.value);
      case "set-building-height-scale": return weatherEarthApi.setBuildingHeightScale(message.value ?? message.heightScale ?? message.scale);
      case "set-weather-3d": return weatherEarthApi.setWeather3d(message.enabled ?? message.value);
      case "set-weather-3d-scale": return weatherEarthApi.setWeather3dScale(message.value ?? message.heightScale ?? message.scale);
      case "set-weather-volume": return weatherEarthApi.setWeatherVolume(message.enabled ?? message.value);
      case "set-weather-volume-scale": return weatherEarthApi.setWeatherVolumeScale(message.value ?? message.heightScale ?? message.scale);
      case "get-measurement": return weatherEarthApi.getMeasurement();
      case "start-measurement": return weatherEarthApi.startMeasurement(message.mode || message.value);
      case "add-measurement-point": return weatherEarthApi.addMeasurementPoint(message.point || message.coordinate || message.coordinates || message.payload, options);
      case "finish-measurement": return weatherEarthApi.finishMeasurement();
      case "undo-measurement-point": return weatherEarthApi.undoMeasurementPoint();
      case "clear-measurement": return weatherEarthApi.clearMeasurement();
      case "get-camera-tour": return weatherEarthApi.getCameraTour();
      case "set-camera-tour": return weatherEarthApi.setCameraTour(message.stops || message.cameraTour?.stops || message.payload || []);
      case "add-camera-tour-stop": return weatherEarthApi.addCameraTourStop(message.stop || message.camera || message.payload || {});
      case "play-camera-tour": return weatherEarthApi.playCameraTour(options);
      case "stop-camera-tour": return weatherEarthApi.stopCameraTour();
      case "clear-camera-tour": return weatherEarthApi.clearCameraTour();
      case "load-geojson-url": return weatherEarthApi.loadGeoJsonUrl(message.url, options);
      case "load-manifest-url": return weatherEarthApi.loadManifestUrl(message.url, options);
      case "load-project-url": return weatherEarthApi.loadProjectUrl(message.url, options);
      case "set-basemap": return weatherEarthApi.setBasemap(message.key || message.basemap);
      case "set-projection": return weatherEarthApi.setProjection(message.projection);
      case "set-immersive": return weatherEarthApi.setImmersiveMode(message.enabled ?? message.value);
      case "set-time-filter": return weatherEarthApi.setTimeFilter(message.value || message.time, options);
      case "clear-weather": return weatherEarthApi.clearWeather();
      case "get-geojson": return weatherEarthApi.getGeoJson(options);
      case "get-project": return weatherEarthApi.getProject(options);
      case "set-project": return weatherEarthApi.setProject(message.project || message.payload, options);
      case "standardize-weather": return weatherEarthApi.standardize();
      case "validate-geojson": return weatherEarthApi.validate({ ...options, payload: message.geojson || message.payload });
      case "get-validation-report": return weatherEarthApi.getValidationReport(options);
      case "fit-weather": return weatherEarthApi.fitWeather();
      case "get-state": return weatherEarthApi.getState();
      case "get-places": return weatherEarthApi.getPlaces();
      case "get-scene-presets": return weatherEarthApi.getScenePresets();
      case "set-scene-preset": return weatherEarthApi.setScenePreset(message.key || message.scene || message.preset || message.value, options);
      case "search-places": return weatherEarthApi.searchPlaces(message.query || message.value || "", options);
      case "get-focus-target": return weatherEarthApi.getFocusTarget();
      case "get-surface-probe": return weatherEarthApi.getSurfaceProbe();
      case "set-surface-probe": return weatherEarthApi.setSurfaceProbe(message.point || message.coordinate || message.coordinates || message.payload, options);
      case "clear-surface-probe": return weatherEarthApi.clearSurfaceProbe();
      case "set-focus-target": return weatherEarthApi.setFocusTarget(message.focusTarget || message.targetPoint || message.point || message.payload, options);
      case "clear-focus-target": return weatherEarthApi.clearFocusTarget();
      case "set-focus-orbit": return weatherEarthApi.setFocusOrbit(message.enabled ?? message.value);
      case "fly-to-place": return weatherEarthApi.flyToPlace(message.id || message.placeId || message.value, options);
      case "fly-to-search": return weatherEarthApi.flyToSearch(message.query || message.value || "", options);
      case "fly-to-camera": return weatherEarthApi.flyToCamera(message.camera || message.payload, options);
      case "set-camera-pitch": return weatherEarthApi.setCameraPitch(message.pitch ?? message.value, options);
      default: throw new Error(`Unsupported WeatherEarth request: ${message.type}`);
    }
  }

  function weatherEarthReadyDetail(reason = "ready") {
    return { ready: readyEmitted, reason, engine: ENGINE, mapLoaded: Boolean(viewer), styleLoaded: ["ready", "fallback", "missing-token"].includes(tilesetStatus), methods: Object.keys(weatherEarthApi), tileset: tilesetState(), qualityProfile: qualityProfileState() };
  }

  function markReady(reason = "ready") {
    if (readyEmitted) return weatherEarthReadyDetail(reason);
    readyEmitted = true;
    emitWeatherEarthEvent("ready", weatherEarthReadyDetail(reason), { includeState: false });
    return weatherEarthReadyDetail(reason);
  }

  function emitWeatherEarthChange(reason = "change") {
    updateAllUi();
    emitWeatherEarthEvent("change", { reason, featureCount: currentGeoJson.features.length, displayedFeatureCount: displayedGeoJson.features.length });
  }

  function emitWeatherEarthEvent(eventName, detail = {}, options = {}) {
    const eventDetail = {
      ...detail,
      engine: ENGINE,
      sequence: eventSeq++,
      timestamp: new Date().toISOString(),
      state: options.includeState === false ? undefined : cloneJson(weatherEarthState()),
    };
    const message = { target: RESPONSE_TARGET, type: "event", event: eventName, detail: eventDetail };
    window.dispatchEvent(new CustomEvent(`weather-earth:${eventName}`, { detail: eventDetail }));
    window.dispatchEvent(new CustomEvent("weather-earth:event", { detail: message }));
    if (window.parent && window.parent !== window) window.parent.postMessage(message, "*");
  }

  function searchEarthPlaces(query) {
    const raw = String(query || "").trim();
    if (!raw) return [];
    const lower = raw.toLowerCase();
    const coordinate = parseLonLat(raw);
    if (coordinate) return [{ id: "coordinate", label: formatLngLat(coordinate.lon, coordinate.lat), camera: { ...coordinate, zoom: 12.5, bearing: -18, pitch: 55 }, source: "coordinate" }];
    return EARTH_PLACE_PRESETS.filter((place) => place.id.toLowerCase().includes(lower) || place.label.includes(raw) || (place.aliases || []).some((alias) => String(alias).toLowerCase().includes(lower))).map((place) => cloneJson(place));
  }

  function publicLocationSearchResult(result) {
    return result ? cloneJson(result) : null;
  }

  function publicFocusTarget(target) {
    return target ? cloneJson(target) : null;
  }

  function publicSurfaceProbe(probe) {
    return probe ? cloneJson(probe) : null;
  }

  function normalizeFeatureCollection(payload) {
    if (!payload || typeof payload !== "object") return emptyFeatureCollection();
    if (payload.type === "FeatureCollection") {
      const collection = cloneJson(payload);
      collection.features = Array.isArray(collection.features) ? collection.features.map(normalizeFeature).filter(Boolean) : [];
      return collection;
    }
    if (payload.type === "Feature") return { type: "FeatureCollection", name: payload.properties?.name || "weather.geojson", features: [normalizeFeature(payload)] };
    if (Array.isArray(payload.features)) return { type: "FeatureCollection", features: payload.features.map(normalizeFeature).filter(Boolean) };
    return emptyFeatureCollection();
  }

  function normalizeFeature(feature) {
    if (!feature || typeof feature !== "object") return null;
    const normalized = {
      type: "Feature",
      properties: normalizeProperties(feature.properties || {}),
      geometry: cloneJson(feature.geometry || null),
    };
    normalized.properties[FEATURE_ID_PROPERTY] ||= feature.id || `weather-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    normalized.properties.weather_type ||= inferWeatherType(normalized);
    normalized.properties["marker-color"] ||= elementTypeById(normalized.properties.weather_type)?.color || "#00d6f2";
    return normalized;
  }

  function normalizeProperties(properties) {
    return properties && typeof properties === "object" ? cloneJson(properties) : {};
  }

  function ensureFeatureIds(collection) {
    collection.features.forEach((feature) => {
      feature.properties ||= {};
      feature.properties[FEATURE_ID_PROPERTY] ||= `weather-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      feature.properties.weather_type ||= inferWeatherType(feature);
    });
  }

  function emptyFeatureCollection() {
    return { type: "FeatureCollection", name: "weather-earth.geojson", metadata: { projection: "WGS84 lon/lat", schema: "weather-earth-geojson-v1" }, features: [] };
  }

  function publicFeatureEnvelope(feature) {
    return { id: feature.properties?.[FEATURE_ID_PROPERTY] || "", feature: { type: "Feature", properties: publicProperties(feature.properties || {}), geometry: cloneJson(feature.geometry || null) } };
  }

  function publicProperties(properties) {
    return Object.fromEntries(Object.entries(properties || {}).filter(([key]) => !INTERNAL_PROPERTY_KEYS.has(key)));
  }

  function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function parseWeatherTimeToDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const isoWithZone = raw.match(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/);
    if (isoWithZone) {
      const parsed = new Date(raw);
      return validDate(parsed) ? parsed : null;
    }
    const compact = raw.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(?:[^\d]|$)/) || raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if (compact) return localDate(Number(compact[1]), Number(compact[2]), Number(compact[3]), Number(compact[4]), Number(compact[5]));
    const compactDate = raw.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/) || raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactDate) return localDate(Number(compactDate[1]), Number(compactDate[2]), Number(compactDate[3]));
    const full = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[ T\s]+(\d{1,2})(?::?(\d{2}))?)?/);
    if (full) return localDate(Number(full[1]), Number(full[2]), Number(full[3]), Number(full[4] || 0), Number(full[5] || 0));
    const md = raw.match(/(?:^|[^\d])(\d{1,2})[-/月](\d{1,2})(?:日)?(?:[ T\s]+(\d{1,2})(?::?(\d{2}))?)?/);
    if (md) {
      const year = new Date().getFullYear();
      return localDate(year, Number(md[1]), Number(md[2]), Number(md[3] || 0), Number(md[4] || 0));
    }
    const fallback = new Date(raw);
    return validDate(fallback) ? fallback : null;
  }

  function localDate(year, month, day, hour = 0, minute = 0) {
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (!validDate(date)) return null;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return null;
    return date;
  }

  function validDate(date) {
    return date instanceof Date && Number.isFinite(date.getTime());
  }

  function featureLabel(feature) {
    return feature?.properties?.name || feature?.properties?.label || feature?.properties?.title || feature?.properties?.weather_type || "";
  }

  function featureColor(feature) {
    return cssColor(feature?.properties?.["marker-color"] || feature?.properties?.color || feature?.properties?.stroke || elementTypeById(feature?.properties?.weather_type)?.color || "#00d6f2");
  }

  function featureVolumeHeight(feature) {
    const props = feature.properties || {};
    const explicit = Number(props.height ?? props.volume_height ?? props.altitude);
    if (Number.isFinite(explicit) && explicit > 0) return explicit * weatherVolumeScale;
    const level = String(props.level || props.wind_level || "");
    const match = level.match(/(\d+)/);
    const base = match ? Number(match[1]) * 450 : 2400;
    return Math.max(800, base * weatherVolumeScale);
  }

  function inferWeatherType(feature) {
    const geometry = feature?.geometry?.type || "";
    if (geometry.includes("Polygon")) return "wind-region";
    if (geometry.includes("LineString")) return "track";
    return "warning";
  }

  function elementTypeById(id) {
    return WEATHER_ELEMENT_TYPES.find((type) => type.id === id || type.aliases?.includes(id));
  }

  function syncDynamicElementTypes() {
    currentGeoJson.features.forEach((feature) => {
      const id = feature.properties?.weather_type || inferWeatherType(feature);
      if (!elementTypeVisibility.has(id)) elementTypeVisibility.set(id, true);
    });
  }

  function isFeatureVisible(feature) {
    const type = feature.properties?.weather_type || inferWeatherType(feature);
    if (elementTypeVisibility.get(type) === false) return false;
    if (layerVisibility.get(layerIdForGeometry(feature.geometry?.type)) === false) return false;
    const time = featureTime(feature);
    if (activeTimeFilter !== TIME_FILTER_ALL && time !== activeTimeFilter) {
      if (!time && showUntimedFeatures) return true;
      return false;
    }
    if (!time && !showUntimedFeatures) return false;
    return true;
  }

  function layerIdForGeometry(type = "") {
    if (type.includes("Polygon")) return "weather-regions";
    if (type.includes("LineString")) return "weather-lines";
    return "weather-points";
  }

  function featureTime(feature) {
    const props = feature.properties || {};
    return props.time || props.valid_time || props.validTime || props.forecast_time || props.datetime || props.timestamp || "";
  }

  function uniqueTimes(features) {
    return [...new Set(features.map(featureTime).filter(Boolean))].sort();
  }

  function findFeatureById(id) {
    if (!id) return null;
    return currentGeoJson.features.find((feature) => feature.properties?.[FEATURE_ID_PROPERTY] === id) || null;
  }

  function coordinatesToPositions(coordinates = []) {
    return coordinates.filter((coord) => validLonLat(coord?.[0], coord?.[1])).map((coord) => Cesium.Cartesian3.fromDegrees(Number(coord[0]), Number(coord[1]), Number(coord[2] || 0)));
  }

  function polygonHierarchy(rings = []) {
    if (!rings.length) return null;
    const outer = coordinatesToPositions(rings[0]);
    if (outer.length < 3) return null;
    const holes = rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(coordinatesToPositions(ring))).filter((hole) => hole.positions.length >= 3);
    return new Cesium.PolygonHierarchy(outer, holes);
  }

  function centerOfCoordinates(coordinates = []) {
    const points = coordinates.filter((coord) => validLonLat(coord?.[0], coord?.[1]));
    if (!points.length) return null;
    return {
      lon: points.reduce((sum, coord) => sum + Number(coord[0]), 0) / points.length,
      lat: points.reduce((sum, coord) => sum + Number(coord[1]), 0) / points.length,
    };
  }

  function forEachCoordinateSet(geometry, callback) {
    if (!geometry) return;
    if (geometry.type === "Point") callback(geometry.coordinates, "Point");
    if (geometry.type === "MultiPoint") geometry.coordinates.forEach((coord) => callback(coord, "Point"));
    if (geometry.type === "LineString") callback(geometry.coordinates, "LineString");
    if (geometry.type === "MultiLineString") geometry.coordinates.forEach((line) => callback(line, "LineString"));
    if (geometry.type === "Polygon") callback(geometry.coordinates, "Polygon");
    if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => callback(polygon, "Polygon"));
  }

  function forEachGeometryCoordinate(geometry, callback) {
    forEachCoordinateSet(geometry, (coordinates, type) => {
      if (type === "Point") callback(coordinates);
      if (type === "LineString") coordinates.forEach(callback);
      if (type === "Polygon") coordinates.flat().forEach(callback);
    });
  }

  function geoJsonBounds(collection) {
    const features = collection?.type === "FeatureCollection" ? collection.features : collection?.features || [];
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    features.forEach((feature) => forEachGeometryCoordinate(feature.geometry, (coord) => {
      if (!validLonLat(coord?.[0], coord?.[1])) return;
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat);
    }));
    return Number.isFinite(west) ? { west, south, east, north } : null;
  }

  function screenToLonLat(position) {
    if (!viewer || !position) return null;
    let cartesian;
    if (viewer.scene.pickPositionSupported) {
      try { cartesian = viewer.scene.pickPosition(position); } catch { cartesian = null; }
    }
    if (!Cesium.defined(cartesian)) cartesian = viewer.camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84);
    if (!Cesium.defined(cartesian)) return null;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    return { lon: clampLon(Cesium.Math.toDegrees(carto.longitude)), lat: clamp(Cesium.Math.toDegrees(carto.latitude), -90, 90) };
  }

  function zoomToHeight(zoom) {
    return clamp(44000000 / Math.pow(2, Number(zoom) || 0), 120, 42000000);
  }

  function heightToZoom(height) {
    return clamp(Math.log2(44000000 / Math.max(120, Number(height) || 120)), 0.4, 19);
  }

  function parseMapParam(raw) {
    if (!raw) return null;
    const [zoomText, latText, lonText, bearingText = "0", pitchText = "0"] = String(raw).split("/");
    const zoom = Number(zoomText), lat = Number(latText), lon = Number(lonText), bearing = Number(bearingText), pitch = Number(pitchText);
    return [zoom, lat, lon, bearing, pitch].every(Number.isFinite) && validLonLat(lon, lat) ? { zoom, lat, lon, bearing, pitch } : null;
  }

  function serializeMapParam(camera) {
    const parts = [round(camera.zoom, 2), round(camera.lat, 5), round(camera.lon, 5)];
    if (Math.abs(camera.bearing || 0) > 0.1 || Math.abs(camera.pitch || 0) > 0.1) parts.push(round(camera.bearing || 0, 1), round(camera.pitch || 0, 0));
    return parts.join("/");
  }

  function parseLonLat(raw) {
    const match = String(raw).trim().match(/(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const a = Number(match[1]), b = Number(match[2]);
    const lon = Math.abs(a) <= 90 && Math.abs(b) > 90 ? b : a;
    const lat = Math.abs(a) <= 90 && Math.abs(b) > 90 ? a : b;
    return validLonLat(lon, lat) ? { lon, lat } : null;
  }

  function distanceMeters(a, b) {
    const radius = 6371008.8;
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function polygonAreaSqMeters(points) {
    if (points.length < 3) return 0;
    const radius = 6378137;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p1 = points[i], p2 = points[(i + 1) % points.length];
      sum += toRad(p2.lon - p1.lon) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
    }
    return Math.abs(sum * radius * radius / 2);
  }

  function buildShareUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("map", serializeMapParam(currentCameraState()));
    url.searchParams.set("basemap", currentBaseMapKey);
    url.searchParams.set("quality", activeQualityProfile);
    if (currentShareSourceType && currentShareSourceValue) url.searchParams.set(currentShareSourceType, currentShareSourceValue);
    if (activeTimeFilter !== TIME_FILTER_ALL) url.searchParams.set("time", activeTimeFilter);
    if (activeTimeFilter === TIME_FILTER_ALL && sunlightTimeMode === "weather-time" && sunlightTimeIso) url.searchParams.set("sunTime", sunlightTimeIso);
    if (!showUntimedFeatures) url.searchParams.set("untimed", "0");
    if (!autoRotateEnabled) url.searchParams.set("rotate", "0");
    if (focusOrbitEnabled) url.searchParams.set("focusOrbit", "1");
    if (immersiveEnabled) url.searchParams.set("immersive", "1");
    if (!terrainEnabled) url.searchParams.set("terrain", "0");
    if (!sunlightEnabled) url.searchParams.set("sunlight", "0");
    if (!buildingsEnabled) url.searchParams.set("buildings", "0");
    if (!weather3dEnabled) url.searchParams.set("weather3d", "0");
    if (!weatherVolumeEnabled) url.searchParams.set("weatherVolume", "0");
    return url.toString();
  }

  function buildInlineDataShareUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("map", serializeMapParam(currentCameraState()));
    url.searchParams.set("basemap", currentBaseMapKey);
    url.searchParams.set("quality", activeQualityProfile);
    url.searchParams.set("data", `data:application/geo+json,${encodeURIComponent(JSON.stringify(currentExportGeoJson()))}`);
    const result = url.toString();
    if (elements.shareUrlText && result.length > INLINE_SHARE_MAX_URL_LENGTH) elements.shareUrlText.textContent = `数据链接过大：${result.length} 字符。建议下载 GeoJSON。`;
    return result;
  }

  function buildInlineProjectShareUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("basemap", currentBaseMapKey);
    url.searchParams.set("quality", activeQualityProfile);
    url.searchParams.set("project", JSON.stringify(buildWeatherEarthProject()));
    const result = url.toString();
    if (elements.shareUrlText && result.length > INLINE_PROJECT_SHARE_MAX_URL_LENGTH) elements.shareUrlText.textContent = `项目链接过大：${result.length} 字符。建议下载项目文档。`;
    return result;
  }

  function replaceUrlState() {
    if (!history.replaceState) return;
    window.clearTimeout(replaceUrlTimer);
    replaceUrlTimer = 0;
    const url = buildShareUrl();
    history.replaceState(null, "", url);
    if (elements.shareUrlText) elements.shareUrlText.textContent = url;
  }

  function scheduleReplaceUrlState() {
    if (!history.replaceState) return;
    if (cameraInteractionActive) {
      replaceUrlQueuedDuringInteraction = true;
      return;
    }
    window.clearTimeout(replaceUrlTimer);
    replaceUrlTimer = window.setTimeout(replaceUrlState, URL_UPDATE_DEBOUNCE_MS);
  }

  async function copyShareUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      if (elements.shareUrlText) elements.shareUrlText.textContent = url;
      setStatus("分享链接已复制。", url.length > 120 ? `${url.slice(0, 120)}...` : url);
    } catch {
      if (elements.shareUrlText) elements.shareUrlText.textContent = url;
    }
  }

  function setShareSource(type, value) {
    currentShareSourceType = type || "";
    currentShareSourceValue = value || "";
    replaceUrlState();
  }

  function downloadJsonPayload(payload, filename, mimeType) {
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function geoJsonFileName(name, suffix = "") {
    const base = String(name || "weather").replace(/\.(geo)?json$/i, "").replace(/[^\w.-]+/g, "-");
    return `${base || "weather"}${suffix ? `-${suffix}` : ""}.geojson`;
  }

  function projectDocumentFileName(name) {
    return `${String(name || "weather-earth").replace(/\.(geo)?json$/i, "").replace(/[^\w.-]+/g, "-")}.weather-earth-project.json`;
  }

  function readableNameFromUrl(url) {
    try {
      const pathname = new URL(url, window.location.href).pathname;
      return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
    } catch {
      return "";
    }
  }

  function formatTextareaJson(textarea) {
    if (!textarea) return;
    try {
      textarea.value = JSON.stringify(JSON.parse(textarea.value || "{}"), null, 2);
    } catch (error) {
      setStatus("JSON 格式化失败。", error.message || String(error));
    }
  }

  function handleKeyboard(event) {
    if (isTypingTarget(document.activeElement)) return;
    keyboardNavigationModifiers = { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey };
    const code = normalizedKeyboardCode(event);
    if (code === "Escape" && earthMenuOpen) { stopKeyboardEvent(event); setEarthMenuOpen(false); return; }
    if (isContinuousNavigationCode(code)) {
      if (!keyboardNavigationKeys.size) keyboardNavigationCamera = normalizeCamera(lastCamera);
      keyboardNavigationKeys.add(code);
      stopKeyboardEvent(event);
      return;
    }
    if (event.repeat) return;
    if (code === "KeyH" || code === "KeyR") { stopKeyboardEvent(event); resetCameraView(); return; }
    if (code === "KeyN") { stopKeyboardEvent(event); flyToCamera({ ...currentCameraState(), bearing: 0 }); return; }
    if (code === "KeyU") { stopKeyboardEvent(event); setCameraTopDown(); return; }
    if (code === "KeyO") { stopKeyboardEvent(event); toggleCameraOblique(); return; }
    if (code === "Space" && manifestFrames.length) { stopKeyboardEvent(event); toggleManifestPlayback(); return; }
    if (code === "BracketLeft") { stopKeyboardEvent(event); stepManifest(-1); return; }
    if (code === "BracketRight") { stopKeyboardEvent(event); stepManifest(1); }
  }

  function handleEarthMenuPointerDown(event) {
    if (!earthMenuOpen) return;
    if (elements.earthMenuPanel?.contains(event.target) || elements.toggleImmersive?.contains(event.target)) return;
    setEarthMenuOpen(false);
  }

  function handleKeyboardKeyUp(event) {
    keyboardNavigationModifiers = { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey };
    const code = normalizedKeyboardCode(event);
    if (isContinuousNavigationCode(code)) {
      keyboardNavigationKeys.delete(code);
      if (!keyboardNavigationKeys.size) finishKeyboardNavigation();
      stopKeyboardEvent(event);
    }
  }

  function finishKeyboardNavigation() {
    keyboardNavigationCamera = null;
    if (viewer) lastCamera = currentCameraState();
    endCameraInteractionSoon();
  }

  function clearKeyboardNavigation() {
    keyboardNavigationKeys.clear();
    keyboardNavigationModifiers = { shift: false, alt: false, ctrl: false, meta: false };
    finishKeyboardNavigation();
  }

  function normalizedKeyboardCode(event) {
    if (event.code === "Equal" || event.key === "+" || event.key === "=") return "Equal";
    if (event.code === "Minus" || event.key === "-") return "Minus";
    if (event.code === "NumpadAdd") return "NumpadAdd";
    if (event.code === "NumpadSubtract") return "NumpadSubtract";
    return event.code || event.key;
  }

  function isContinuousNavigationCode(code) {
    return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Equal", "Minus", "NumpadAdd", "NumpadSubtract", "PageUp", "PageDown"].includes(code);
  }

  function stopKeyboardEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function isTypingTarget(element) {
    return ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName) || Boolean(element?.isContentEditable);
  }

  function setStatus(title, detail = "") {
    if (elements.statusTitle) elements.statusTitle.textContent = title;
    if (elements.statusDetail) elements.statusDetail.textContent = detail;
  }

  function on(element, event, handler) {
    element?.addEventListener(event, handler);
  }

  function setActive(element, active) {
    element?.classList.toggle("is-active", Boolean(active));
  }

  function setPressed(element, active) {
    if (element) element.setAttribute("aria-pressed", active ? "true" : "false");
    setActive(element, active);
  }

  function setDisabled(element, disabled) {
    if (element) element.disabled = Boolean(disabled);
  }

  function setChecked(element, checked) {
    if (element) element.checked = Boolean(checked);
  }

  function setValue(element, value) {
    if (element) element.value = String(value);
  }

  function setHidden(element, hidden) {
    if (element) element.hidden = Boolean(hidden);
  }

  function cssColor(value) {
    try { return Cesium.Color.fromCssColorString(String(value || "#00d6f2")); } catch { return Cesium.Color.CYAN; }
  }

  function cssColorHex(value) {
    const text = String(value || "#ffbd59");
    return /^#[0-9a-f]{6}$/i.test(text) ? text : "#ffbd59";
  }

  function validLonLat(lon, lat) {
    return Number.isFinite(Number(lon)) && Number.isFinite(Number(lat)) && Number(lon) >= -180 && Number(lon) <= 180 && Number(lat) >= -90 && Number(lat) <= 90;
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function clampLon(value) {
    let lon = Number(value);
    while (lon < -180) lon += 360;
    while (lon > 180) lon -= 360;
    return lon;
  }

  function normalizeBearing(value) {
    let bearing = Number(value) || 0;
    while (bearing < -180) bearing += 360;
    while (bearing > 180) bearing -= 360;
    return bearing;
  }

  function isFiniteNumber(value) {
    return value !== null && value !== "" && Number.isFinite(Number(value));
  }

  function numberOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function toRad(value) {
    return Number(value) * Math.PI / 180;
  }

  function round(value, decimals = 0) {
    const factor = 10 ** decimals;
    return Math.round(Number(value) * factor) / factor;
  }

  function formatLngLat(lon, lat) {
    return `${Number(lon).toFixed(4)}, ${Number(lat).toFixed(4)}`;
  }

  function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(meters > 100000 ? 0 : 1)} km` : `${Math.round(meters)} m`;
  }

  function formatArea(area) {
    return area >= 1000000 ? `${(area / 1000000).toFixed(1)} km²` : `${Math.round(area)} m²`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function safeDecode(value) {
    try { return decodeURIComponent(String(value || "")); } catch { return String(value || ""); }
  }

  init();
})();
