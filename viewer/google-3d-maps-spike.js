(() => {
  "use strict";

  const ENGINE = "google-maps-js-3d";
  const TILESET = "google-photorealistic-3d-maps";
  const DEFAULT_GEOJSON_URL = "../examples/weather-elements.geojson";
  const DEFAULT_VIEW = { zoom: 4.65, lat: 34.85, lon: 105.8, bearing: -18, pitch: 48 };
  const MAPS_VERSION = "alpha";
  const MAPS_LIBRARY = "maps3d";
  const INTERNAL_PROPERTY_KEYS = new Set(["_earthFeatureId", "_weatherColor", "_weatherVolumeHeight", "marker-size-px"]);

  const elements = Object.fromEntries([
    "google3dMap", "statusText", "benchmarkSelect", "runBenchmark", "loadSampleWeather", "clearOverlays",
    "placeSelect", "flyToPlace", "captureMetrics", "metricsText", "keyPanel", "apiKeyInput", "loadApiKey",
  ].map((id) => [id, document.getElementById(id)]));

  const PLACE_PRESETS = [
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

  const BENCHMARK_PATHS = {
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
      detail: "检查山脉纹理、雾化和斜视地形层次。",
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

  let maps3d = null;
  let mapElement = null;
  let ready = false;
  let mapsError = "";
  let activePathId = "google-earth-p1";
  let activeCamera = { ...DEFAULT_VIEW };
  let currentGeoJson = emptyFeatureCollection();
  let overlayElements = [];
  let overlayStats = { point: 0, line: 0, polygon: 0, skipped: 0 };
  let renderMetrics = { fps: 0, frameCount: 0, lastSampleAt: 0, sampleFrames: 0 };

  init();

  async function init() {
    bootstrapControls();
    bindControls();
    exposeApi();
    startMetricsLoop();
    await loadOptionalLocalConfig();
    const key = configuredGoogleMapsApiKey();
    if (!key) {
      showKeyPanel("缺少 Google Maps JavaScript API key。");
      return;
    }
    await loadWithKey(key);
  }

  function bootstrapControls() {
    if (elements.placeSelect) {
      elements.placeSelect.innerHTML = PLACE_PRESETS.map((place) => `<option value="${place.id}">${escapeHtml(place.label)}</option>`).join("");
    }
    if (elements.benchmarkSelect) {
      elements.benchmarkSelect.innerHTML = Object.values(BENCHMARK_PATHS).map((path) => `<option value="${path.id}">${escapeHtml(path.label)}</option>`).join("");
      elements.benchmarkSelect.value = activePathId;
    }
    setControlsEnabled(false);
    setStatus("等待 Google 3D Maps。");
  }

  function bindControls() {
    elements.loadApiKey?.addEventListener("click", async () => {
      const key = String(elements.apiKeyInput?.value || "").trim();
      if (!key) return;
      await loadWithKey(key);
    });
    elements.apiKeyInput?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      const key = String(elements.apiKeyInput?.value || "").trim();
      if (key) await loadWithKey(key);
    });
    elements.runBenchmark?.addEventListener("click", async () => {
      const pathId = elements.benchmarkSelect?.value || activePathId;
      const result = await runBenchmarkPath(pathId, { duration: 1.1, settleMs: 900 });
      writeMetrics(result);
    });
    elements.loadSampleWeather?.addEventListener("click", async () => {
      await loadGeoJsonUrl(DEFAULT_GEOJSON_URL, { fit: false });
    });
    elements.clearOverlays?.addEventListener("click", () => {
      clearOverlays();
      writeMetrics(captureMetrics());
    });
    elements.flyToPlace?.addEventListener("click", () => {
      const placeId = elements.placeSelect?.value || "china";
      flyToPlace(placeId);
      writeMetrics(captureMetrics({ lightweight: true }));
    });
    elements.captureMetrics?.addEventListener("click", () => writeMetrics(captureMetrics()));
    elements.benchmarkSelect?.addEventListener("change", () => {
      activePathId = elements.benchmarkSelect.value || activePathId;
    });
  }

  async function loadWithKey(key) {
    try {
      mapsError = "";
      elements.keyPanel && (elements.keyPanel.hidden = true);
      setStatus("正在加载 Google Maps JavaScript API...");
      await loadGoogleMapsScript(key);
      maps3d = await globalThis.google.maps.importLibrary(MAPS_LIBRARY);
      createMapElement();
      setControlsEnabled(true);
      ready = true;
      setStatus("Google 3D Maps 已加载。");
      const params = new URLSearchParams(window.location.search);
      flyToCamera(cameraFromParams(params) || DEFAULT_VIEW, { duration: 0 });
      if (params.get("weather") !== "0") {
        await loadGeoJsonUrl(params.get("data") || DEFAULT_GEOJSON_URL, { fit: false, optional: true });
      }
    } catch (error) {
      mapsError = error?.message || String(error);
      showKeyPanel(`Google 3D Maps 加载失败：${mapsError}`);
      setStatus("Google 3D Maps 加载失败。");
      setControlsEnabled(false);
    }
  }

  function createMapElement() {
    if (!maps3d?.Map3DElement) throw new Error("当前 Google Maps JavaScript API 未返回 Map3DElement。");
    mapElement?.remove();
    mapElement = new maps3d.Map3DElement({
      center: latLngAltitude(DEFAULT_VIEW),
      heading: normalizeHeading(DEFAULT_VIEW.bearing),
      tilt: clamp(DEFAULT_VIEW.pitch, 0, 80),
      range: zoomToRange(DEFAULT_VIEW.zoom),
      mode: maps3d.MapMode?.HYBRID || "HYBRID",
      defaultUIHidden: true,
      gestureHandling: "GREEDY",
    });
    mapElement.style.width = "100%";
    mapElement.style.height = "100%";
    mapElement.addEventListener?.("gmp-steadychange", () => writeMetrics(captureMetrics({ lightweight: true })));
    mapElement.addEventListener?.("gmp-error", (event) => {
      mapsError = event?.error?.message || event?.message || "Google 3D Maps 初始化失败。";
      setStatus(mapsError);
      writeMetrics(captureMetrics());
    });
    elements.google3dMap.replaceChildren(mapElement);
  }

  async function loadGoogleMapsScript(apiKey) {
    if (globalThis.google?.maps?.importLibrary) return;
    await new Promise((resolve, reject) => {
      const callbackName = `__weatherGoogle3dReady_${Date.now()}`;
      const script = document.createElement("script");
      globalThis[callbackName] = () => {
        delete globalThis[callbackName];
        resolve();
      };
      const params = new URLSearchParams({
        key: apiKey,
        v: MAPS_VERSION,
        loading: "async",
        libraries: MAPS_LIBRARY,
        callback: callbackName,
        auth_referrer_policy: "origin",
        language: "zh-CN",
        region: "CN",
      });
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.onerror = () => {
        delete globalThis[callbackName];
        reject(new Error("Google Maps JavaScript API 脚本加载失败。"));
      };
      document.head.appendChild(script);
    });
  }

  async function loadOptionalLocalConfig() {
    try {
      const response = await fetch("./earth.config.local.js", { cache: "no-store" });
      if (!response.ok) return;
      const source = await response.text();
      if (source.trim()) new Function(source)();
    } catch {
      // Local config is optional for this comparison page.
    }
  }

  function configuredGoogleMapsApiKey() {
    const params = new URLSearchParams(window.location.search);
    const config = globalThis.WEATHER_EARTH_CONFIG || {};
    return String(
      params.get("googleMapsApiKey") ||
      params.get("mapsApiKey") ||
      params.get("key") ||
      config.googleMapsApiKey ||
      config.mapsApiKey ||
      ""
    ).trim();
  }

  function showKeyPanel(message) {
    if (elements.keyPanel) elements.keyPanel.hidden = false;
    setStatus(message);
  }

  function setControlsEnabled(enabled) {
    for (const element of [elements.runBenchmark, elements.loadSampleWeather, elements.clearOverlays, elements.flyToPlace, elements.captureMetrics, elements.benchmarkSelect, elements.placeSelect]) {
      if (element) element.disabled = !enabled;
    }
  }

  function setStatus(message) {
    if (elements.statusText) elements.statusText.textContent = message || "";
  }

  function flyToPlace(placeId, options = {}) {
    const place = PLACE_PRESETS.find((entry) => entry.id === placeId) || PLACE_PRESETS[0];
    return flyToCamera(place.camera, options);
  }

  function flyToCamera(camera = {}, options = {}) {
    if (!mapElement) return null;
    const normalized = normalizeCamera(camera);
    const googleCamera = googleCameraFromWeatherCamera(normalized);
    const durationMs = Math.max(0, Number(options.duration ?? 0.8) * 1000);
    try {
      if (durationMs > 0 && typeof mapElement.flyCameraTo === "function") {
        mapElement.flyCameraTo({ endCamera: googleCamera, durationMillis: durationMs });
      } else {
        applyGoogleCamera(googleCamera);
      }
    } catch {
      applyGoogleCamera(googleCamera);
    }
    activeCamera = normalized;
    setStatus(`${formatCameraLabel(normalized)} · range ${formatNumber(googleCamera.range / 1000, 1)} km`);
    return cloneJson(normalized);
  }

  function applyGoogleCamera(camera) {
    mapElement.center = camera.center;
    mapElement.heading = camera.heading;
    mapElement.tilt = camera.tilt;
    mapElement.range = camera.range;
  }

  function googleCameraFromWeatherCamera(camera) {
    return {
      center: latLngAltitude(camera),
      heading: normalizeHeading(camera.bearing),
      tilt: clamp(camera.pitch, 0, 80),
      range: zoomToRange(camera.zoom),
    };
  }

  async function runBenchmarkPath(pathOrStops = activePathId, options = {}) {
    const stops = normalizeBenchmarkStops(pathOrStops);
    const duration = Math.max(0, Number(options.duration ?? 0.9));
    const settleMs = Math.max(0, Number(options.settleMs ?? 700));
    const startedAt = new Date().toISOString();
    const results = [];
    activePathId = typeof pathOrStops === "string" ? pathOrStops : activePathId;
    for (let index = 0; index < stops.length; index += 1) {
      const stop = stops[index];
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
      engine: ENGINE,
      tileset: TILESET,
      pathId: typeof pathOrStops === "string" ? pathOrStops : "",
      stopCount: results.length,
      results,
    };
  }

  function normalizeBenchmarkStops(pathOrStops = activePathId) {
    const source = typeof pathOrStops === "string" ? BENCHMARK_PATHS[pathOrStops]?.stops || [] : pathOrStops;
    return (Array.isArray(source) ? source : []).map((entry) => {
      if (typeof entry === "string") {
        const place = PLACE_PRESETS.find((preset) => preset.id === entry) || PLACE_PRESETS[0];
        return { label: place.label, camera: normalizeCamera(place.camera) };
      }
      const place = PLACE_PRESETS.find((preset) => preset.id === (entry?.placeId || entry?.id));
      const camera = normalizeCamera(entry?.camera || place?.camera || entry || DEFAULT_VIEW);
      return { label: entry?.label || place?.label || "Camera stop", camera };
    });
  }

  function benchmarkPathState() {
    return Object.values(BENCHMARK_PATHS).map((path) => ({
      id: path.id,
      label: path.label,
      detail: path.detail,
      stopCount: path.stops.length,
      stops: normalizeBenchmarkStops(path.id).map((stop) => ({ label: stop.label, camera: cloneJson(stop.camera) })),
    }));
  }

  async function loadGeoJsonUrl(url = DEFAULT_GEOJSON_URL, options = {}) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`GeoJSON 请求失败：${response.status}`);
      const geojson = await response.json();
      setGeoJson(geojson, { ...options, name: url });
      return captureMetrics({ lightweight: true });
    } catch (error) {
      if (!options.optional) throw error;
      setStatus(`GeoJSON 未加载：${error?.message || error}`);
      return null;
    }
  }

  function setGeoJson(payload, options = {}) {
    const geojson = normalizeFeatureCollection(payload);
    currentGeoJson = geojson;
    renderGeoJson(geojson);
    if (options.fit) fitGeoJson(geojson);
    setStatus(`${options.name || "GeoJSON"} · ${geojson.features.length} features · ${overlayElements.length} overlays`);
    return { geojson: getGeoJson(), state: getState() };
  }

  function getGeoJson() {
    return cleanGeoJson(currentGeoJson);
  }

  function clearOverlays() {
    for (const overlay of overlayElements) overlay.remove?.();
    overlayElements = [];
    overlayStats = { point: 0, line: 0, polygon: 0, skipped: 0 };
    currentGeoJson = emptyFeatureCollection();
    setStatus("天气叠加层已清空。");
  }

  function renderGeoJson(geojson) {
    clearOverlays();
    currentGeoJson = geojson;
    for (const feature of geojson.features) {
      renderFeature(feature);
    }
  }

  function renderFeature(feature) {
    const geometry = feature?.geometry;
    if (!geometry) {
      overlayStats.skipped += 1;
      return;
    }
    if (geometry.type === "Point") return addPointOverlay(feature, geometry.coordinates);
    if (geometry.type === "MultiPoint") return geometry.coordinates.forEach((coordinates) => addPointOverlay(feature, coordinates));
    if (geometry.type === "LineString") return addLineOverlay(feature, geometry.coordinates);
    if (geometry.type === "MultiLineString") return geometry.coordinates.forEach((line) => addLineOverlay(feature, line));
    if (geometry.type === "Polygon") return addPolygonOverlay(feature, geometry.coordinates);
    if (geometry.type === "MultiPolygon") return geometry.coordinates.forEach((polygon) => addPolygonOverlay(feature, polygon));
    overlayStats.skipped += 1;
  }

  function addPointOverlay(feature, coordinates) {
    const point = coordinateToLatLngAltitude(coordinates, 40);
    if (!point || !maps3d?.Marker3DElement) {
      overlayStats.skipped += 1;
      return;
    }
    const props = feature.properties || {};
    const marker = new maps3d.Marker3DElement({
      position: point,
      altitudeMode: altitudeMode("RELATIVE_TO_GROUND"),
      label: String(props.label || props.name || props.weather_type || ""),
      extruded: true,
      drawsWhenOccluded: true,
    });
    appendOverlay(marker);
    overlayStats.point += 1;
  }

  function addLineOverlay(feature, coordinates) {
    const path = coordinatesToPath(coordinates);
    if (path.length < 2 || !maps3d?.Polyline3DElement) {
      overlayStats.skipped += 1;
      return;
    }
    const props = feature.properties || {};
    const line = new maps3d.Polyline3DElement({
      path,
      altitudeMode: altitudeMode("CLAMP_TO_GROUND"),
      strokeColor: cssColor(props.stroke || props["marker-color"] || "#8ef6ff", 0.92),
      strokeWidth: clamp(Number(props["stroke-width"] || 4), 1, 10),
      geodesic: true,
      drawsOccludedSegments: true,
    });
    appendOverlay(line);
    overlayStats.line += 1;
  }

  function addPolygonOverlay(feature, rings) {
    const outer = coordinatesToPath(rings?.[0] || []);
    if (outer.length < 3 || !maps3d?.Polygon3DElement) {
      overlayStats.skipped += 1;
      return;
    }
    const props = feature.properties || {};
    const polygon = new maps3d.Polygon3DElement({
      path: outer,
      innerPaths: (rings || []).slice(1).map(coordinatesToPath).filter((ring) => ring.length >= 3),
      altitudeMode: altitudeMode("CLAMP_TO_GROUND"),
      fillColor: cssColor(props.fill || props["marker-color"] || "#00d6f2", 0.34),
      strokeColor: cssColor(props.stroke || "#8ef6ff", 0.82),
      strokeWidth: clamp(Number(props["stroke-width"] || 2), 1, 8),
      geodesic: true,
      drawsOccludedSegments: false,
    });
    appendOverlay(polygon);
    overlayStats.polygon += 1;
  }

  function appendOverlay(element) {
    mapElement?.append(element);
    overlayElements.push(element);
  }

  function altitudeMode(name) {
    const fallbacks = {
      ABSOLUTE: "absolute",
      CLAMP_TO_GROUND: "clamp-to-ground",
      RELATIVE_TO_GROUND: "relative-to-ground",
      RELATIVE_TO_MESH: "relative-to-mesh",
    };
    return maps3d?.AltitudeMode?.[name] || fallbacks[name] || name;
  }

  function fitGeoJson(geojson) {
    const bounds = geoJsonBounds(geojson);
    if (!bounds) return;
    const span = Math.max(bounds.maxLon - bounds.minLon, bounds.maxLat - bounds.minLat);
    flyToCamera({
      lon: (bounds.minLon + bounds.maxLon) / 2,
      lat: (bounds.minLat + bounds.maxLat) / 2,
      zoom: span > 0 ? clamp(8.1 - Math.log2(span), 4.2, 13.5) : 9,
      bearing: -22,
      pitch: span < 2 ? 56 : 49,
    }, { duration: 0.4 });
  }

  function captureMetrics(options = {}) {
    const mapCamera = readMapCamera();
    const metrics = {
      capturedAt: new Date().toISOString(),
      engine: ENGINE,
      tileset: TILESET,
      ready,
      mapMode: "HYBRID",
      apiVersion: MAPS_VERSION,
      camera: currentCameraState(mapCamera),
      googleCamera: mapCamera,
      weather: {
        featureCount: currentGeoJson.features.length,
        overlayCount: overlayElements.length,
        overlays: { ...overlayStats },
      },
      performance: {
        fps: round(renderMetrics.fps, 1),
        frameCount: renderMetrics.frameCount,
        internalTileMetricsAvailable: false,
        note: "Google Maps JS 3D Maps does not expose Cesium-style tile memory or screen-space-error counters.",
      },
      comparison: {
        benchmarkPathId: activePathId,
        overlaySupport: "Marker3DElement, Polyline3DElement and Polygon3DElement sample mapping only.",
        productDecision: "Use this page for visual comparison; Cesium remains the full weather-editing viewer.",
      },
    };
    if (!options.lightweight) metrics.benchmarkPaths = benchmarkPathState();
    return metrics;
  }

  function getState() {
    return {
      engine: ENGINE,
      tileset: TILESET,
      mode: "HYBRID",
      ready,
      error: mapsError,
      camera: currentCameraState(),
      activePathId,
      overlayCount: overlayElements.length,
      weatherFeatureCount: currentGeoJson.features.length,
    };
  }

  function currentCameraState(mapCamera = readMapCamera()) {
    return {
      lon: numberOr(activeCamera.lon, DEFAULT_VIEW.lon),
      lat: numberOr(activeCamera.lat, DEFAULT_VIEW.lat),
      zoom: numberOr(activeCamera.zoom, DEFAULT_VIEW.zoom),
      bearing: numberOr(activeCamera.bearing, DEFAULT_VIEW.bearing),
      pitch: numberOr(activeCamera.pitch, DEFAULT_VIEW.pitch),
      google: mapCamera,
    };
  }

  function readMapCamera() {
    const center = mapElement?.center || {};
    return {
      lat: numberOr(center.lat, activeCamera.lat),
      lng: numberOr(center.lng, activeCamera.lon),
      altitude: numberOr(center.altitude, 0),
      heading: numberOr(mapElement?.heading, normalizeHeading(activeCamera.bearing)),
      tilt: numberOr(mapElement?.tilt, activeCamera.pitch),
      range: numberOr(mapElement?.range, zoomToRange(activeCamera.zoom)),
    };
  }

  function exposeApi() {
    const api = {
      getState() { return cloneJson(getState()); },
      getGeoJson() { return cloneJson(getGeoJson()); },
      setGeoJson(payload, options = {}) { return cloneJson(setGeoJson(payload, options)); },
      clearOverlays() { clearOverlays(); return cloneJson(getState()); },
      loadGeoJsonUrl(url, options = {}) { return loadGeoJsonUrl(url, options); },
      flyToCamera(camera, options = {}) { return cloneJson(flyToCamera(camera, options)); },
      flyToPlace(placeId, options = {}) { return cloneJson(flyToPlace(placeId, options)); },
      getBenchmarkPaths() { return cloneJson(benchmarkPathState()); },
      runBenchmarkPath(pathOrStops, options = {}) { return runBenchmarkPath(pathOrStops, options); },
      captureMetrics(options = {}) { return cloneJson(captureMetrics(options)); },
    };
    globalThis.google3dSpike = api;
    window.google3dSpike = api;
    document.documentElement.dataset.google3dSpikeApi = "ready";
  }

  function writeMetrics(value) {
    if (!elements.metricsText) return;
    elements.metricsText.textContent = JSON.stringify(value, null, 2);
  }

  function startMetricsLoop() {
    const tick = (now) => {
      renderMetrics.frameCount += 1;
      renderMetrics.sampleFrames += 1;
      if (!renderMetrics.lastSampleAt) renderMetrics.lastSampleAt = now;
      const elapsed = now - renderMetrics.lastSampleAt;
      if (elapsed >= 1000) {
        renderMetrics.fps = renderMetrics.sampleFrames * 1000 / elapsed;
        renderMetrics.sampleFrames = 0;
        renderMetrics.lastSampleAt = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function cameraFromParams(params) {
    const map = params.get("map");
    if (map) {
      const match = map.match(/^([0-9.]+)\/(-?[0-9.]+)\/(-?[0-9.]+)/);
      if (match) return { ...DEFAULT_VIEW, zoom: Number(match[1]), lat: Number(match[2]), lon: Number(match[3]) };
    }
    const lon = Number(params.get("lon") || params.get("lng"));
    const lat = Number(params.get("lat"));
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return {
        lon,
        lat,
        zoom: numberOr(Number(params.get("zoom")), DEFAULT_VIEW.zoom),
        bearing: numberOr(Number(params.get("bearing") || params.get("heading")), DEFAULT_VIEW.bearing),
        pitch: numberOr(Number(params.get("pitch") || params.get("tilt")), DEFAULT_VIEW.pitch),
      };
    }
    return null;
  }

  function normalizeCamera(camera = {}) {
    return {
      lon: clamp(numberOr(camera.lon ?? camera.lng ?? camera.longitude, DEFAULT_VIEW.lon), -180, 180),
      lat: clamp(numberOr(camera.lat ?? camera.latitude, DEFAULT_VIEW.lat), -85, 85),
      zoom: clamp(numberOr(camera.zoom, DEFAULT_VIEW.zoom), 0.4, 19),
      bearing: numberOr(camera.bearing ?? camera.heading, DEFAULT_VIEW.bearing),
      pitch: clamp(numberOr(camera.pitch ?? camera.tilt, DEFAULT_VIEW.pitch), 0, 80),
    };
  }

  function latLngAltitude(camera, fallbackAltitude = 0) {
    return {
      lat: clamp(numberOr(camera.lat ?? camera.latitude, DEFAULT_VIEW.lat), -85, 85),
      lng: clamp(numberOr(camera.lon ?? camera.lng ?? camera.longitude, DEFAULT_VIEW.lon), -180, 180),
      altitude: Math.max(0, numberOr(camera.altitude, fallbackAltitude)),
    };
  }

  function coordinateToLatLngAltitude(coordinates, fallbackAltitude = 0) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lat, lng: lon, altitude: Math.max(0, numberOr(coordinates[2], fallbackAltitude)) };
  }

  function coordinatesToPath(coordinates) {
    return (coordinates || []).map((coordinate) => coordinateToLatLngAltitude(coordinate, 0)).filter(Boolean);
  }

  function normalizeFeatureCollection(payload) {
    if (payload?.type === "FeatureCollection" && Array.isArray(payload.features)) return cloneJson(payload);
    if (payload?.type === "Feature") return { type: "FeatureCollection", features: [cloneJson(payload)] };
    return emptyFeatureCollection();
  }

  function emptyFeatureCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  function cleanGeoJson(geojson) {
    const clone = cloneJson(geojson || emptyFeatureCollection());
    for (const feature of clone.features || []) {
      if (!feature.properties) continue;
      for (const key of INTERNAL_PROPERTY_KEYS) delete feature.properties[key];
    }
    return clone;
  }

  function geoJsonBounds(geojson) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    visitCoordinates(geojson, (coordinates) => {
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    });
    if (!Number.isFinite(minLon)) return null;
    return { minLon, minLat, maxLon, maxLat };
  }

  function visitCoordinates(value, callback) {
    if (!value) return;
    if (value.type === "FeatureCollection") return (value.features || []).forEach((feature) => visitCoordinates(feature, callback));
    if (value.type === "Feature") return visitCoordinates(value.geometry, callback);
    const coords = value.coordinates;
    if (!Array.isArray(coords)) return;
    walkCoordinateArray(coords, callback);
  }

  function walkCoordinateArray(value, callback) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      callback(value);
      return;
    }
    value.forEach((entry) => walkCoordinateArray(entry, callback));
  }

  function cssColor(value, alpha = 1) {
    const raw = String(value || "").trim();
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (!hex) return raw || `rgba(142, 246, 255, ${alpha})`;
    let body = hex[1];
    if (body.length === 3) body = body.split("").map((char) => `${char}${char}`).join("");
    const r = parseInt(body.slice(0, 2), 16);
    const g = parseInt(body.slice(2, 4), 16);
    const b = parseInt(body.slice(4, 6), 16);
    const a = body.length === 8 ? round(parseInt(body.slice(6, 8), 16) / 255, 3) : alpha;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function zoomToRange(zoom) {
    return clamp(52000000 / Math.pow(2, numberOr(zoom, DEFAULT_VIEW.zoom)), 180, 16000000);
  }

  function normalizeHeading(value) {
    return ((numberOr(value, 0) % 360) + 360) % 360;
  }

  function formatCameraLabel(camera) {
    return `${formatNumber(camera.lon, 4)}, ${formatNumber(camera.lat, 4)} · tilt ${formatNumber(camera.pitch, 0)}°`;
  }

  function formatNumber(value, digits = 2) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "--";
  }

  function numberOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function round(value, digits = 2) {
    if (!Number.isFinite(Number(value))) return 0;
    const factor = Math.pow(10, digits);
    return Math.round(Number(value) * factor) / factor;
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
