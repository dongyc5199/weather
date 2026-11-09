(() => {
  "use strict";

  const ENGINE = "maplibre-globe";
  const DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
  const DEFAULT_GEOJSON_URL = "../examples/open-data-weather-elements.geojson";
  const DEFAULT_MANIFEST_URL = "../examples/open-data-weather-manifest.json";
  const REQUEST_TARGET = "weather-earth";
  const RESPONSE_TARGET = "weather-earth-client";
  const TIME_FILTER_ALL = "__all__";
  const FEATURE_ID_PROPERTY = "_earthFeatureId";
  const INTERNAL_KEYS = new Set([FEATURE_ID_PROPERTY, "_weatherColor", "_weatherOpacity", "_weatherWidth", "_weatherRadius", "_weatherLabel"]);
  const RAINVIEWER_WEATHER_MAPS_URL = "https://api.rainviewer.com/public/weather-maps.json";
  const NASA_GIBS_CLOUD_LAYER = "Himawari_AHI_Band3_Red_Visible_1km";
  const NASA_GIBS_IR_LAYER = "Himawari_AHI_Band13_Clean_Infrared";
  const WEATHER_SOURCE_ID = "weather-data";
  const WEATHER_LAYERS = ["weather-fill", "weather-outline", "weather-line", "weather-point", "weather-label"];
  const DEFAULT_VIEW = { zoom: 1.42, lat: 28, lon: 105, bearing: -8, pitch: 0 };
  const WEATHER_TYPES = {
    "wind-region": { color: "#00d6f2", opacity: 0.46, order: 10 },
    "rain-region": { color: "#2f80ff", opacity: 0.48, order: 20 },
    warning: { color: "#ffbd59", opacity: 0.9, order: 30 },
    station: { color: "#31d7ff", opacity: 0.95, order: 40 },
    front: { color: "#f5f7ff", opacity: 0.86, order: 50 },
    "pressure-center": { color: "#b28cff", opacity: 0.95, order: 60 },
    track: { color: "#8ef6ff", opacity: 0.88, order: 70 },
  };
  const LEVEL_STYLES = {
    level_6: { color: "#00d6f2", opacity: 0.5, order: 60 },
    "6级": { color: "#00d6f2", opacity: 0.5, order: 60 },
    level_7: { color: "#ffbd59", opacity: 0.56, order: 70 },
    "7级": { color: "#ffbd59", opacity: 0.56, order: 70 },
    level_8: { color: "#ff4d4d", opacity: 0.62, order: 80 },
    "8级": { color: "#ff4d4d", opacity: 0.62, order: 80 },
    orange: { color: "#ff8f3d", opacity: 0.72, order: 65 },
    red: { color: "#ff3b4e", opacity: 0.78, order: 75 },
    heavy: { color: "#2f80ff", opacity: 0.58, order: 30 },
  };
  const RASTER_TYPES = {
    cloud: { id: "cloud", layerId: "raster-cloud", label: "云图", opacity: 0.62, maxzoom: 12 },
    radar: { id: "radar", layerId: "raster-radar", label: "雷达", opacity: 0.68, maxzoom: 7 },
  };

  const $ = (id) => document.getElementById(id);
  const elements = {
    map: $("map"),
    starCanvas: $("starCanvas"),
    loadDefaultWeather: $("loadDefaultWeather"),
    fitWeather: $("fitWeather"),
    geoJsonUrlInput: $("geoJsonUrlInput"),
    loadGeoJsonUrl: $("loadGeoJsonUrl"),
    manifestUrlInput: $("manifestUrlInput"),
    loadManifestUrl: $("loadManifestUrl"),
    playManifest: $("playManifest"),
    timeRange: $("timeRange"),
    timeLabel: $("timeLabel"),
    weatherOpacity: $("weatherOpacity"),
    toggleCloud: $("toggleCloud"),
    toggleRadar: $("toggleRadar"),
    autoRotate: $("autoRotate"),
    clearWeather: $("clearWeather"),
    sourceName: $("sourceName"),
    featureCount: $("featureCount"),
    statusText: $("statusText"),
    detailText: $("detailText"),
  };
  const params = new URLSearchParams(window.location.search);

  let map = null;
  let readyEmitted = false;
  let eventSeq = 1;
  let currentGeoJson = emptyFeatureCollection();
  let displayedGeoJson = emptyFeatureCollection();
  let currentGeoJsonName = "weather-globe.geojson";
  let currentSourceLabel = "";
  let activeTimeFilter = TIME_FILTER_ALL;
  let currentWeatherOpacity = 0.46;
  let manifestFrames = [];
  let manifestIndex = 0;
  let manifestTimer = 0;
  let autoRotateEnabled = params.get("rotate") !== "0";
  let userInteracting = false;
  let spinChanging = false;
  let interactionTimer = 0;
  let lastSpinAt = 0;
  let rasterOverlays = Object.fromEntries(Object.values(RASTER_TYPES).map((type) => [type.id, { ...type, loaded: false, visible: true, url: "", mode: "template", opacity: type.opacity, sourceLabel: "", validTime: "" }]));

  async function init() {
    exposeApi();
    await loadOptionalLocalConfig();
    drawStars();
    window.addEventListener("resize", drawStars);
    bindControls();
    if (!globalThis.maplibregl) {
      setStatus("MapLibre 加载失败。", "请检查 CDN 网络访问。");
      markReady("maplibre-missing");
      return;
    }
    initMap();
  }

  async function loadOptionalLocalConfig() {
    try {
      const response = await fetch("./earth.config.local.js", { cache: "no-store" });
      if (!response.ok) return;
      const source = await response.text();
      if (source.trim()) new Function(source)();
    } catch {
      // Local config is optional.
    }
  }

  function initMap() {
    map = new maplibregl.Map({
      container: elements.map,
      style: DEFAULT_STYLE,
      center: [DEFAULT_VIEW.lon, DEFAULT_VIEW.lat],
      zoom: DEFAULT_VIEW.zoom,
      bearing: DEFAULT_VIEW.bearing,
      pitch: DEFAULT_VIEW.pitch,
      projection: { type: "globe" },
      attributionControl: false,
      maplibreLogo: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    if (maplibregl.GlobeControl) map.addControl(new maplibregl.GlobeControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("movestart", () => {
      if (spinChanging) return;
      userInteracting = true;
      window.clearTimeout(interactionTimer);
    });
    map.on("moveend", () => {
      if (spinChanging) return;
      window.clearTimeout(interactionTimer);
      interactionTimer = window.setTimeout(() => { userInteracting = false; }, 900);
    });
    map.on("load", () => {
      try { map.setProjection({ type: "globe" }); } catch {}
      addWeatherLayers();
      applyInitialView();
      markReady("maplibre-ready");
      initializeFromUrl();
      requestAnimationFrame(spinLoop);
    });
  }

  function addWeatherLayers() {
    if (map.getSource(WEATHER_SOURCE_ID)) return;
    map.addSource(WEATHER_SOURCE_ID, { type: "geojson", data: emptyFeatureCollection() });
    map.addLayer({
      id: "weather-fill",
      type: "fill",
      source: WEATHER_SOURCE_ID,
      filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      paint: {
        "fill-color": ["get", "_weatherColor"],
        "fill-opacity": ["get", "_weatherOpacity"],
      },
    });
    map.addLayer({
      id: "weather-outline",
      type: "line",
      source: WEATHER_SOURCE_ID,
      filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      paint: {
        "line-color": ["get", "_weatherColor"],
        "line-opacity": 0.9,
        "line-width": 1.2,
      },
    });
    map.addLayer({
      id: "weather-line",
      type: "line",
      source: WEATHER_SOURCE_ID,
      filter: ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
      paint: {
        "line-color": ["get", "_weatherColor"],
        "line-opacity": ["get", "_weatherOpacity"],
        "line-width": ["get", "_weatherWidth"],
      },
    });
    map.addLayer({
      id: "weather-point",
      type: "circle",
      source: WEATHER_SOURCE_ID,
      filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
      paint: {
        "circle-color": ["get", "_weatherColor"],
        "circle-opacity": ["get", "_weatherOpacity"],
        "circle-radius": ["get", "_weatherRadius"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.88,
        "circle-stroke-width": 1.5,
      },
    });
    map.addLayer({
      id: "weather-label",
      type: "symbol",
      source: WEATHER_SOURCE_ID,
      filter: ["all", ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false], ["has", "_weatherLabel"]],
      layout: {
        "text-field": ["get", "_weatherLabel"],
        "text-size": 12,
        "text-offset": [0, -1.3],
        "text-anchor": "bottom",
      },
      paint: {
        "text-color": "#f8fbff",
        "text-halo-color": "rgba(0, 0, 0, 0.72)",
        "text-halo-width": 1.4,
      },
    });
  }

  function bindControls() {
    elements.loadDefaultWeather?.addEventListener("click", () => loadGeoJsonFromUrl(DEFAULT_GEOJSON_URL, "默认开放数据", { fit: true }));
    elements.fitWeather?.addEventListener("click", () => fitCurrentGeoJson());
    elements.loadGeoJsonUrl?.addEventListener("click", () => loadGeoJsonFromUrl(elements.geoJsonUrlInput.value || DEFAULT_GEOJSON_URL, "", { fit: true }));
    elements.loadManifestUrl?.addEventListener("click", () => loadManifestFromUrl(elements.manifestUrlInput.value || DEFAULT_MANIFEST_URL, { fit: true }));
    elements.playManifest?.addEventListener("click", () => toggleManifestPlayback());
    elements.timeRange?.addEventListener("input", () => setManifestIndex(Number(elements.timeRange.value), { fit: false }));
    elements.weatherOpacity?.addEventListener("input", () => setWeatherOpacity(elements.weatherOpacity.value));
    elements.toggleCloud?.addEventListener("click", () => toggleRasterOverlay("cloud"));
    elements.toggleRadar?.addEventListener("click", () => toggleRasterOverlay("radar"));
    elements.autoRotate?.addEventListener("change", () => {
      autoRotateEnabled = elements.autoRotate.checked;
      emitWeatherEarthEvent("scenechange", { autoRotate: autoRotateEnabled });
    });
    elements.clearWeather?.addEventListener("click", () => clearWeatherLayers());
    if (elements.autoRotate) elements.autoRotate.checked = autoRotateEnabled;
  }

  function applyInitialView() {
    const view = parseMapParam(params.get("map"));
    if (!view || !map) return;
    map.jumpTo({
      center: [view.lon, view.lat],
      zoom: view.zoom,
      bearing: view.bearing ?? map.getBearing(),
      pitch: view.pitch ?? map.getPitch(),
    });
  }

  async function initializeFromUrl() {
    try {
      if (params.get("weather") === "0" || params.get("basemapOnly") === "1") {
        setStatus("纯底图视图。", "未加载业务天气。");
      } else if (params.get("manifest")) {
        await loadManifestFromUrl(params.get("manifest"), { fit: !params.get("map") });
      } else if (params.get("data")) {
        await loadGeoJsonFromUrl(params.get("data"), "", { fit: !params.get("map") });
      } else {
        await loadGeoJsonFromUrl(DEFAULT_GEOJSON_URL, "默认开放数据", { fit: false, silentNotFound: true });
      }
      if (params.get("time")) setTimeFilter(params.get("time"), { fit: false });
      if (params.get("raster") === "live" || params.get("rasterOverlays") === "live") {
        await Promise.allSettled([loadLiveRasterOverlay("cloud"), loadLiveRasterOverlay("radar")]);
      }
    } catch (error) {
      setStatus("初始化数据失败。", error.message || String(error));
    }
  }

  async function loadGeoJsonFromUrl(url, label = "", options = {}) {
    const value = String(url || "").trim();
    if (!value) throw new Error("GeoJSON URL 为空。");
    setStatus("正在加载 GeoJSON...", value);
    const response = await fetch(value, { cache: "no-store" });
    if (!response.ok) {
      if (options.silentNotFound) return null;
      throw new Error(`GeoJSON ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    return setWeatherGeoJson(payload, label || readableNameFromUrl(response.url || value) || "weather.geojson", {
      fit: options.fit === true,
      sourceLabel: value,
    });
  }

  function setWeatherGeoJson(payload, name = "weather.geojson", options = {}) {
    currentGeoJson = normalizeFeatureCollection(payload);
    ensureFeatureIds(currentGeoJson);
    currentGeoJsonName = name || currentGeoJson.name || "weather.geojson";
    currentSourceLabel = options.sourceLabel || currentGeoJsonName;
    renderWeather();
    updateUi();
    if (options.fit) fitCurrentGeoJson();
    setStatus("GeoJSON 已加载。", `${currentGeoJsonName} / ${currentGeoJson.features.length} 个要素`);
    emitWeatherEarthChange("geojson-load");
    return weatherEarthApi.getState();
  }

  function clearWeatherLayers() {
    currentGeoJson = emptyFeatureCollection();
    displayedGeoJson = emptyFeatureCollection();
    currentGeoJsonName = "weather-globe.geojson";
    currentSourceLabel = "";
    activeTimeFilter = TIME_FILTER_ALL;
    renderWeather();
    updateUi();
    emitWeatherEarthChange("weather-clear");
    return weatherEarthApi.getState();
  }

  function renderWeather() {
    displayedGeoJson = {
      ...currentGeoJson,
      features: currentGeoJson.features.filter(isFeatureVisible).map(prepareFeature),
    };
    const source = map?.getSource(WEATHER_SOURCE_ID);
    if (source?.setData) source.setData(displayedGeoJson);
    updateUi();
  }

  async function loadManifestFromUrl(url, options = {}) {
    const value = String(url || "").trim();
    if (!value) throw new Error("Manifest URL 为空。");
    setStatus("正在加载天气过程...", value);
    const response = await fetch(value, { cache: "no-store" });
    if (!response.ok) throw new Error(`Manifest ${response.status} ${response.statusText}`);
    const manifest = await response.json();
    manifestFrames = normalizeManifestFrames(manifest, response.url || value);
    const requestedTime = params.get("time");
    const requestedIndex = requestedTime ? manifestFrames.findIndex((frame) => frame.label === requestedTime || frame.time === requestedTime) : -1;
    manifestIndex = requestedIndex >= 0 ? requestedIndex : Number.isFinite(Number(manifest.defaultIndex)) ? Number(manifest.defaultIndex) : Math.max(0, manifestFrames.findIndex((frame) => frame.default || frame.peak));
    if (manifestIndex < 0) manifestIndex = 0;
    updateManifestUi();
    if (manifestFrames.length) await setManifestIndex(manifestIndex, { fit: options.fit === true });
    setStatus("天气过程已加载。", `${manifestFrames.length} 个时次`);
    return weatherEarthApi.getState();
  }

  function normalizeManifestFrames(manifest, baseUrl) {
    const raw = Array.isArray(manifest?.items) ? manifest.items : Array.isArray(manifest?.frames) ? manifest.frames : [];
    return raw.map((item, index) => {
      const geojsonUrl = item.geojsonUrl || item.url || item.path || item.geojson;
      return {
        ...item,
        index,
        label: String(item.label || item.time || item.valid_time || `时次 ${index + 1}`),
        time: String(item.time || item.valid_time || item.label || ""),
        geojsonUrl: geojsonUrl ? new URL(geojsonUrl, baseUrl).href : "",
      };
    }).filter((frame) => frame.geojsonUrl);
  }

  async function setManifestIndex(index, options = {}) {
    if (!manifestFrames.length) return weatherEarthApi.getState();
    manifestIndex = clamp(Math.round(Number(index)), 0, manifestFrames.length - 1);
    const frame = manifestFrames[manifestIndex];
    await loadGeoJsonFromUrl(frame.geojsonUrl, frame.label, { fit: options.fit === true });
    activeTimeFilter = TIME_FILTER_ALL;
    updateManifestUi();
    return weatherEarthApi.getState();
  }

  function toggleManifestPlayback() {
    if (!manifestFrames.length) return;
    if (manifestTimer) {
      window.clearInterval(manifestTimer);
      manifestTimer = 0;
      updateManifestUi();
      return;
    }
    manifestTimer = window.setInterval(() => setManifestIndex((manifestIndex + 1) % manifestFrames.length, { fit: false }), 1600);
    updateManifestUi();
  }

  function setTimeFilter(value, options = {}) {
    const next = String(value || TIME_FILTER_ALL);
    activeTimeFilter = next === "all" ? TIME_FILTER_ALL : next;
    const frameIndex = manifestFrames.findIndex((frame) => frame.label === next || frame.time === next);
    if (frameIndex >= 0 && frameIndex !== manifestIndex) return setManifestIndex(frameIndex, options);
    renderWeather();
    if (options.fit) fitCurrentGeoJson();
    emitWeatherEarthEvent("filterchange", { time: activeTimeFilter });
    return weatherEarthApi.getState();
  }

  function updateManifestUi() {
    const hasFrames = manifestFrames.length > 0;
    if (elements.timeRange) {
      elements.timeRange.disabled = !hasFrames;
      elements.timeRange.max = String(Math.max(0, manifestFrames.length - 1));
      elements.timeRange.value = String(manifestIndex);
    }
    if (elements.timeLabel) elements.timeLabel.textContent = hasFrames ? manifestFrames[manifestIndex]?.label || "--" : "等待过程";
    if (elements.playManifest) elements.playManifest.textContent = manifestTimer ? "暂停" : "播放";
  }

  function prepareFeature(feature) {
    const next = cloneJson(feature);
    next.properties = { ...(next.properties || {}) };
    const type = weatherTypeId(next);
    const severity = severityStyle(next);
    const typeStyle = WEATHER_TYPES[type] || {};
    const explicitColor = next.properties["marker-color"] || next.properties.color || next.properties.fill || next.properties.stroke;
    next.properties._weatherColor = String(explicitColor || severity?.color || typeStyle.color || "#00d6f2");
    next.properties._weatherOpacity = featureOpacity(next, severity, typeStyle);
    next.properties._weatherWidth = Number(next.properties["stroke-width"] || next.properties.width || (type === "front" ? 3 : 2.4));
    next.properties._weatherRadius = Number(next.properties["marker-size-px"] || next.properties["marker-size"] || (type === "station" ? 6 : 7));
    const label = featureLabel(next);
    if (label) next.properties._weatherLabel = label;
    return next;
  }

  function isFeatureVisible(feature) {
    if (activeTimeFilter === TIME_FILTER_ALL) return true;
    const time = featureTime(feature);
    return time === activeTimeFilter || !time;
  }

  function weatherTypeId(feature) {
    const raw = String(feature?.properties?.weather_type || "").trim();
    if (raw) return raw;
    const type = feature?.geometry?.type || "";
    if (type.includes("Polygon")) return "wind-region";
    if (type.includes("LineString")) return "track";
    return "warning";
  }

  function featureOpacity(feature, severity, typeStyle) {
    const explicit = Number(feature?.properties?.opacity ?? feature?.properties?.fill_opacity ?? feature?.properties?.["fill-opacity"]);
    if (Number.isFinite(explicit)) return clamp(explicit, 0.08, 0.95);
    return clamp(Number(severity?.opacity ?? typeStyle.opacity ?? currentWeatherOpacity), 0.08, 0.95);
  }

  function setWeatherOpacity(value) {
    currentWeatherOpacity = clamp(Number(value), 0.15, 0.9);
    renderWeather();
    emitWeatherEarthEvent("layerchange", { opacity: currentWeatherOpacity });
    return { opacity: currentWeatherOpacity, state: weatherEarthApi.getState() };
  }

  function severityStyle(feature) {
    const key = severityKey(feature);
    return LEVEL_STYLES[key] || null;
  }

  function severityKey(feature) {
    const props = feature?.properties || {};
    const raw = props.level ?? props.intensity ?? props.warning_level ?? props.warningLevel ?? props.wind_level ?? props.windLevel;
    if (raw !== undefined && raw !== "") return normalizeSeverityKey(raw);
    const observed = Number(props.observed_value ?? props.wind_speed ?? props.wind ?? props.value);
    if (Number.isFinite(observed)) {
      if (observed >= 20.8) return "level_8";
      if (observed >= 17.2) return "level_7";
      if (observed >= 13.9) return "level_6";
    }
    return "";
  }

  function normalizeSeverityKey(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "";
    if (LEVEL_STYLES[text]) return text;
    const number = text.match(/(\d+)/);
    if (number && Number(number[1]) >= 8) return "level_8";
    if (number && Number(number[1]) === 7) return "level_7";
    if (number && Number(number[1]) === 6) return "level_6";
    if (text.includes("red") || text.includes("红")) return "red";
    if (text.includes("orange") || text.includes("橙")) return "orange";
    if (text.includes("heavy") || text.includes("暴雨") || text.includes("强")) return "heavy";
    return text;
  }

  function featureLabel(feature) {
    const props = feature.properties || {};
    return String(props.name || props.label || props.city || props.station_id || props.warning_type || "").trim();
  }

  function featureTime(feature) {
    const props = feature.properties || {};
    return String(props.time || props.valid_time || props.validTime || props.forecast_time || props.datetime || props.timestamp || "");
  }

  async function toggleRasterOverlay(typeId) {
    const state = rasterOverlays[typeId];
    if (!state) return null;
    if (state.loaded) return clearRasterOverlay(typeId);
    return loadLiveRasterOverlay(typeId);
  }

  async function loadLiveRasterOverlay(typeId) {
    const config = typeId === "radar" ? await resolveLiveRadarOverlay() : resolveLiveCloudOverlay();
    return setRasterOverlay(typeId, config);
  }

  function resolveLiveCloudOverlay() {
    const configured = configuredWeatherTileOverlay("cloud") || configuredWeatherTileOverlay("infrared");
    if (configured) return configured;
    const date = recentGibsDate();
    return {
      url: "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
      mode: "wms",
      layers: NASA_GIBS_CLOUD_LAYER,
      parameters: { time: date, transparent: true, format: "image/png" },
      opacity: RASTER_TYPES.cloud.opacity,
      maxzoom: RASTER_TYPES.cloud.maxzoom,
      sourceLabel: "NASA GIBS 可见光云图",
      validTime: date,
    };
  }

  async function resolveLiveRadarOverlay() {
    const configured = configuredWeatherTileOverlay("radar") || configuredGoogleWeatherMapOverlay("radar");
    if (configured) return configured;
    const response = await fetch(RAINVIEWER_WEATHER_MAPS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`RainViewer ${response.status} ${response.statusText}`);
    const payload = await response.json();
    const frames = [...(payload?.radar?.past || []), ...(payload?.radar?.nowcast || [])].filter((frame) => frame?.path);
    const frame = frames.at(-1);
    if (!frame) throw new Error("RainViewer 暂无可用雷达帧。");
    const host = String(payload.host || "https://tilecache.rainviewer.com").replace(/\/$/, "");
    return {
      url: `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
      mode: "template",
      opacity: RASTER_TYPES.radar.opacity,
      maxzoom: RASTER_TYPES.radar.maxzoom,
      sourceLabel: "RainViewer 最新雷达",
      validTime: frame.time ? new Date(frame.time * 1000).toISOString() : "",
    };
  }

  async function setRasterOverlay(typeId, input = {}) {
    const base = RASTER_TYPES[typeId];
    if (!base || !map) throw new Error(`Unknown raster overlay: ${typeId}`);
    if (input === false || input?.enabled === false) return clearRasterOverlay(typeId);
    const config = normalizeRasterOverlayInput(typeId, input);
    if (!config.url) throw new Error(`${base.label} URL 为空。`);
    clearRasterOverlay(typeId, { silent: true });
    const sourceId = `${base.layerId}-source`;
    const layerId = base.layerId;
    const source = rasterSourceForConfig(config);
    map.addSource(sourceId, source);
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      paint: { "raster-opacity": clamp(Number(config.opacity ?? base.opacity), 0, 1) },
    }, map.getLayer("weather-fill") ? "weather-fill" : undefined);
    rasterOverlays[typeId] = {
      ...base,
      loaded: true,
      visible: true,
      url: config.url,
      mode: config.mode,
      opacity: clamp(Number(config.opacity ?? base.opacity), 0, 1),
      sourceLabel: config.sourceLabel || config.source || base.label,
      validTime: config.validTime || "",
    };
    updateUi();
    emitWeatherEarthEvent("rasteroverlaychange", { overlays: rasterOverlayState() });
    setStatus(`${base.label}已加载。`, rasterOverlays[typeId].sourceLabel);
    return { overlay: rasterOverlays[typeId], state: weatherEarthApi.getState() };
  }

  function clearRasterOverlay(typeId, options = {}) {
    const base = RASTER_TYPES[typeId];
    if (!base || !map) return null;
    const sourceId = `${base.layerId}-source`;
    if (map.getLayer(base.layerId)) map.removeLayer(base.layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    rasterOverlays[typeId] = { ...base, loaded: false, visible: true, url: "", mode: "template", opacity: base.opacity, sourceLabel: "", validTime: "" };
    updateUi();
    if (!options.silent) emitWeatherEarthEvent("rasteroverlaychange", { overlays: rasterOverlayState() });
    return { overlay: rasterOverlays[typeId], state: weatherEarthApi.getState() };
  }

  function rasterSourceForConfig(config) {
    if (config.mode === "wms") {
      return { type: "raster", tiles: [wmsTileUrl(config)], tileSize: 256, maxzoom: Number(config.maxzoom || config.maximumLevel || 12) };
    }
    if (config.mode === "single") {
      const [w, s, e, n] = normalizeBounds(config.bounds);
      return { type: "image", url: config.url, coordinates: [[w, n], [e, n], [e, s], [w, s]] };
    }
    return { type: "raster", tiles: [config.providerUrl || config.url], tileSize: 256, maxzoom: Number(config.maxzoom || config.maximumLevel || 12) };
  }

  function wmsTileUrl(config) {
    const params = new URLSearchParams({
      service: "WMS",
      request: "GetMap",
      version: "1.3.0",
      layers: config.layers || "",
      styles: "",
      format: "image/png",
      transparent: "true",
      crs: "EPSG:3857",
      width: "256",
      height: "256",
      bbox: "{bbox-epsg-3857}",
      ...(config.parameters || {}),
    });
    return `${config.url}?${params.toString().replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`;
  }

  function normalizeRasterOverlayInput(typeId, input = {}) {
    const next = { ...input };
    next.mode = normalizeRasterMode(next.mode);
    next.url = normalizeRasterTileUrlTemplate(next.url || next.providerUrl || next.template || "");
    if (next.source === "Google Weather" || next.url.includes("weather.googleapis.com")) {
      next.url = appendGoogleWeatherApiKey(stripGoogleWeatherApiKey(next.url));
      next.mode = "template";
      next.maxzoom = next.maxzoom || next.maximumLevel || 16;
    }
    next.opacity = next.opacity ?? RASTER_TYPES[typeId]?.opacity;
    return next;
  }

  function configuredWeatherTileOverlay(kind) {
    const config = globalThis.WEATHER_EARTH_CONFIG || {};
    const tiles = config.weatherTiles || config.rasterTiles || {};
    const aliases = kind === "infrared" ? ["infrared", "ir", "cloudInfrared"] : [kind];
    const raw = firstPresent(
      ...aliases.map((name) => params.get(`${name}TileUrl`) || params.get(`${name}Tiles`)),
      ...aliases.map((name) => tiles[name] || config[`${name}TileUrl`])
    );
    if (!raw) return null;
    const tile = typeof raw === "string" ? { url: raw } : raw;
    if (!tile?.url) return null;
    return { mode: "template", opacity: RASTER_TYPES[kind === "radar" ? "radar" : "cloud"].opacity, maxzoom: 16, sourceLabel: `${kind} 瓦片`, ...tile };
  }

  function configuredGoogleWeatherMapOverlay(kind) {
    const config = globalThis.WEATHER_EARTH_CONFIG || {};
    const mapTypes = config.googleWeatherMapTypes || {};
    const mapType = String(params.get(`${kind}GoogleMapType`) || mapTypes[kind] || config.googleWeatherMapType || "").trim();
    const key = configuredGoogleWeatherApiKey();
    if (!mapType || !key) return null;
    return {
      url: `https://weather.googleapis.com/v1/mapTypes/${encodeURIComponent(mapType)}/mapTiles/{z}/{x}/{y}`,
      mode: "template",
      opacity: RASTER_TYPES[kind === "radar" ? "radar" : "cloud"].opacity,
      maxzoom: 16,
      source: "Google Weather",
      sourceLabel: `Google Weather ${mapType}`,
    };
  }

  function rasterOverlayState() {
    return Object.values(rasterOverlays).map(({ id, layerId, label, loaded, visible, url, mode, opacity, sourceLabel, validTime }) => ({ id, layerId, label, loaded, visible, url, mode, opacity, sourceLabel, validTime }));
  }

  function fitCurrentGeoJson() {
    const bounds = geoJsonBounds(displayedGeoJson.features.length ? displayedGeoJson : currentGeoJson);
    if (!bounds || !map) return weatherEarthApi.getState();
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 72, duration: 650, maxZoom: 7.5 });
    return weatherEarthApi.getState();
  }

  function updateUi() {
    if (elements.sourceName) elements.sourceName.textContent = currentGeoJsonName || "等待数据";
    if (elements.featureCount) elements.featureCount.textContent = `${displayedGeoJson.features.length || currentGeoJson.features.length} 个要素`;
    elements.toggleCloud?.classList.toggle("is-active", Boolean(rasterOverlays.cloud?.loaded));
    elements.toggleRadar?.classList.toggle("is-active", Boolean(rasterOverlays.radar?.loaded));
    updateManifestUi();
  }

  function setStatus(title, detail = "") {
    if (elements.statusText) elements.statusText.textContent = title || "";
    if (elements.detailText) elements.detailText.textContent = detail || "";
  }

  function spinLoop(now) {
    if (map && autoRotateEnabled && !userInteracting) {
      const delta = lastSpinAt ? Math.min(0.8, (now - lastSpinAt) / 1000) : 0;
      if (delta > 0) {
        spinChanging = true;
        map.setBearing(map.getBearing() + delta * 0.45);
        spinChanging = false;
      }
    }
    lastSpinAt = now;
    requestAnimationFrame(spinLoop);
  }

  function drawStars() {
    const canvas = elements.starCanvas;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const count = Math.round((width * height) / 4600);
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < count; i += 1) {
      const x = random() * width;
      const y = random() * height;
      const r = 0.55 + random() * 1.45;
      const alpha = 0.28 + random() * 0.65;
      ctx.beginPath();
      ctx.fillStyle = `rgba(220, 238, 255, ${alpha})`;
      ctx.shadowColor = "rgba(120, 184, 255, 0.8)";
      ctx.shadowBlur = random() > 0.72 ? 8 : 2;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function exposeApi() {
    globalThis.weatherEarth = weatherEarthApi;
    window.weatherEarth = weatherEarthApi;
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
    getGeoJson(options = {}) { return cloneJson(currentExportGeoJson(options)); },
    setGeoJson(payload, options = {}) { return setWeatherGeoJson(payload, options.name || "external-weather.geojson", { fit: options.fit === true, sourceLabel: options.sourceLabel || "外部 API" }); },
    async loadGeoJsonUrl(url, options = {}) { await loadGeoJsonFromUrl(url, options.label || options.name || "", { fit: options.fit === true }); return this.getState(); },
    async loadManifestUrl(url, options = {}) { await loadManifestFromUrl(url, options); return this.getState(); },
    async setRasterOverlay(type, input = {}) { return setRasterOverlay(type, input); },
    clearRasterOverlay(type) { return clearRasterOverlay(type); },
    setTimeFilter(value, options = {}) { return setTimeFilter(value, options); },
    fitWeather() { return fitCurrentGeoJson(); },
    clearWeather() { return clearWeatherLayers(); },
  };

  async function handleClientRequest(message) {
    const options = message.options || {};
    switch (message.type) {
      case "ping":
      case "get-ready": return weatherEarthApi.getReady();
      case "set-geojson": return weatherEarthApi.setGeoJson(message.geojson || message.payload, options);
      case "load-geojson-url": return weatherEarthApi.loadGeoJsonUrl(message.url, options);
      case "load-manifest-url": return weatherEarthApi.loadManifestUrl(message.url, options);
      case "set-raster-overlay": return weatherEarthApi.setRasterOverlay(message.id || message.typeId || message.overlayType || message.kind, message.overlay || message.payload || message);
      case "set-time-filter": return weatherEarthApi.setTimeFilter(message.value || message.time, options);
      case "fit-weather": return weatherEarthApi.fitWeather();
      case "get-state": return weatherEarthApi.getState();
      case "get-geojson": return weatherEarthApi.getGeoJson(options);
      case "clear-weather": return weatherEarthApi.clearWeather();
      default: throw new Error(`Unsupported WeatherEarth request: ${message.type}`);
    }
  }

  function weatherEarthReadyDetail(reason = "ready") {
    return { ready: readyEmitted, reason, engine: ENGINE, mapLoaded: Boolean(map), styleLoaded: Boolean(map?.isStyleLoaded?.()), methods: Object.keys(weatherEarthApi) };
  }

  function markReady(reason = "ready") {
    if (readyEmitted) return weatherEarthReadyDetail(reason);
    readyEmitted = true;
    emitWeatherEarthEvent("ready", weatherEarthReadyDetail(reason), { includeState: false });
    return weatherEarthReadyDetail(reason);
  }

  function weatherEarthState() {
    const center = map?.getCenter?.();
    return {
      ready: readyEmitted,
      engine: ENGINE,
      projection: "globe",
      map: center ? { lon: center.lng, lat: center.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() } : null,
      hasWeather: currentGeoJson.features.length > 0,
      featureCount: currentGeoJson.features.length,
      displayedFeatureCount: displayedGeoJson.features.length,
      timeFilter: activeTimeFilter,
      manifest: { count: manifestFrames.length, index: manifestIndex, playing: Boolean(manifestTimer), frame: manifestFrames[manifestIndex] || null },
      rasterOverlays: rasterOverlayState(),
      source: { name: currentGeoJsonName, label: currentSourceLabel },
      autoRotate: autoRotateEnabled,
    };
  }

  function emitWeatherEarthEvent(name, detail = {}, options = {}) {
    const message = {
      target: RESPONSE_TARGET,
      type: "event",
      event: name,
      eventId: `maplibre-globe-${eventSeq++}`,
      detail: options.includeState === false ? detail : { ...detail, state: weatherEarthState() },
    };
    if (window.parent && window.parent !== window) window.parent.postMessage(message, "*");
  }

  function emitWeatherEarthChange(reason) {
    emitWeatherEarthEvent("change", { reason, featureCount: currentGeoJson.features.length, displayedFeatureCount: displayedGeoJson.features.length });
  }

  function currentExportGeoJson(options = {}) {
    const source = options.visible ? displayedGeoJson : currentGeoJson;
    const collection = normalizeFeatureCollection(source);
    collection.features = collection.features.map(cleanFeature);
    return collection;
  }

  function cleanFeature(feature) {
    const next = cloneJson(feature);
    next.properties = { ...(next.properties || {}) };
    for (const key of INTERNAL_KEYS) delete next.properties[key];
    return next;
  }

  function normalizeFeatureCollection(payload) {
    if (payload?.type === "FeatureCollection" && Array.isArray(payload.features)) return cloneJson(payload);
    if (payload?.type === "Feature") return { type: "FeatureCollection", features: [cloneJson(payload)] };
    return emptyFeatureCollection();
  }

  function emptyFeatureCollection() {
    return { type: "FeatureCollection", name: "weather-globe.geojson", metadata: { projection: "WGS84 lon/lat", schema: "weather-earth-geojson-v1" }, features: [] };
  }

  function ensureFeatureIds(collection) {
    collection.features.forEach((feature, index) => {
      feature.properties = { ...(feature.properties || {}) };
      feature.properties[FEATURE_ID_PROPERTY] ||= String(feature.id ?? `feature-${index + 1}`);
    });
  }

  function geoJsonBounds(collection) {
    const coords = [];
    for (const feature of collection.features || []) collectCoordinates(feature.geometry?.coordinates, coords);
    const valid = coords.filter((coord) => validLonLat(coord[0], coord[1]));
    if (!valid.length) return null;
    const lons = valid.map((coord) => Number(coord[0]));
    const lats = valid.map((coord) => Number(coord[1]));
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }

  function collectCoordinates(value, out) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      out.push(value);
      return;
    }
    value.forEach((item) => collectCoordinates(item, out));
  }

  function parseMapParam(value) {
    const parts = String(value || "").split(/[\/,\s]+/).map(Number);
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
    return { zoom: parts[0], lat: parts[1], lon: parts[2], bearing: parts[3], pitch: parts[4] };
  }

  function normalizeRasterMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    if (mode === "wms") return "wms";
    if (mode === "single" || mode === "image") return "single";
    return "template";
  }

  function normalizeRasterTileUrlTemplate(url) {
    return String(url || "").trim().replace(/\{zoom\}/g, "{z}").replace(/\{coord\.x\}/g, "{x}").replace(/\{coord\.y\}/g, "{y}");
  }

  function configuredGoogleWeatherApiKey() {
    const config = globalThis.WEATHER_EARTH_CONFIG || {};
    return String(params.get("googleWeatherApiKey") || params.get("weatherApiKey") || config.googleWeatherApiKey || config.weatherApiKey || "").trim();
  }

  function appendGoogleWeatherApiKey(url) {
    const key = configuredGoogleWeatherApiKey();
    if (!key || !url || /[?&]key=/.test(url)) return url;
    return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
  }

  function stripGoogleWeatherApiKey(url) {
    const raw = String(url || "");
    if (!raw.includes("weather.googleapis.com")) return raw;
    return raw.replace(/([?&])key=[^&]*&?/, "$1").replace(/[?&]$/, "");
  }

  function normalizeBounds(value) {
    const parts = Array.isArray(value) ? value.map(Number) : String(value || "-180,-85,180,85").split(/[,\s]+/).map(Number);
    return parts.length === 4 && parts.every(Number.isFinite) ? parts : [-180, -85, 180, 85];
  }

  function recentGibsDate() {
    const date = new Date();
    if (date.getUTCHours() < 6) date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function readableNameFromUrl(value) {
    try { return decodeURIComponent(new URL(value, window.location.href).pathname.split("/").pop() || "weather.geojson"); } catch { return "weather.geojson"; }
  }

  function firstPresent(...values) {
    return values.find((value) => value != null && value !== "");
  }

  function validLonLat(lon, lat) {
    return Number.isFinite(Number(lon)) && Number.isFinite(Number(lat)) && Math.abs(Number(lon)) <= 180 && Math.abs(Number(lat)) <= 90;
  }

  function clamp(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  init();
})();
