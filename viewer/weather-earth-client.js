(function attachWeatherEarthClient(global) {
  "use strict";

  const REQUEST_TARGET = "weather-earth";
  const RESPONSE_TARGET = "weather-earth-client";

  class WeatherEarthClient {
    constructor(frame, options = {}) {
      this.frame = typeof frame === "string" ? document.querySelector(frame) : frame;
      if (!this.frame || !this.frame.contentWindow) {
        throw new Error("WeatherEarthClient requires an iframe element.");
      }

      this.targetOrigin = options.targetOrigin || new URL(this.frame.getAttribute("src") || this.frame.src, window.location.href).origin;
      this.timeoutMs = Number(options.timeoutMs || 30000);
      this.requestSeq = 1;
      this.pending = new Map();
      this.listeners = new Map();
      this.ready = false;
      this.readyDetail = null;
      this.readyPingInFlight = null;
      this.destroyed = false;
      this.readyPromise = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      this.readyPromise.catch(() => {});
      this.handleMessage = this.handleMessage.bind(this);
      this.handleFrameLoad = this.handleFrameLoad.bind(this);
      window.addEventListener("message", this.handleMessage);
      this.frame.addEventListener("load", this.handleFrameLoad);
      window.setTimeout(() => this.pingReady({ silent: true, timeoutMs: 3000 }), 0);
    }

    destroy() {
      this.destroyed = true;
      window.removeEventListener("message", this.handleMessage);
      this.frame.removeEventListener("load", this.handleFrameLoad);
      for (const pending of this.pending.values()) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error("WeatherEarthClient destroyed."));
      }
      this.pending.clear();
      this.listeners.clear();
      if (!this.ready && this.rejectReady) {
        this.rejectReady(new Error("WeatherEarthClient destroyed before ready."));
      }
    }

    send(type, payload = {}, options = {}) {
      if (this.destroyed) {
        return Promise.reject(new Error("WeatherEarthClient destroyed."));
      }
      if (options.waitForReady !== false && type !== "ping" && type !== "get-ready") {
        const readyTimeoutMs = Number(options.readyTimeoutMs || options.timeoutMs || this.timeoutMs);
        return this.waitUntilReady({ timeoutMs: readyTimeoutMs }).then(() =>
          this.send(type, payload, { ...options, waitForReady: false })
        );
      }

      const requestId = options.requestId || `weather-earth-${this.requestSeq++}`;
      const timeoutMs = Number(options.timeoutMs || this.timeoutMs);
      const message = {
        target: REQUEST_TARGET,
        type,
        requestId,
        ...payload,
      };

      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error(`WeatherEarth request timed out: ${type}`));
        }, timeoutMs);

        this.pending.set(requestId, { resolve, reject, timer });
        this.frame.contentWindow.postMessage(message, this.targetOrigin);
      });
    }

    handleMessage(event) {
      const message = event.data;
      if (!message || typeof message !== "object" || message.target !== RESPONSE_TARGET) return;
      if (event.source !== this.frame.contentWindow) return;

      if (message.type === "event" && message.event) {
        if (message.event === "ready") {
          this.markReady(message.detail || {});
        }
        this.emit(message.event, message.detail || {});
        this.emit("*", { event: message.event, detail: message.detail || {} });
        return;
      }

      const pending = this.pending.get(message.requestId);
      if (!pending) return;

      window.clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      if (message.type === "error") {
        pending.reject(new Error(message.error || "WeatherEarth request failed."));
      } else {
        if (message.result?.ready) {
          this.markReady(message.result, { emit: true });
        }
        pending.resolve(message.result);
      }
    }

    handleFrameLoad() {
      this.pingReady({ silent: true, force: true, timeoutMs: 3000 });
    }

    markReady(detail = {}, options = {}) {
      const normalized = { ready: true, ...detail };
      const isFirstReady = !this.ready;
      this.ready = true;
      this.readyDetail = normalized;
      if (isFirstReady && this.resolveReady) {
        this.resolveReady(normalized);
      }
      if (isFirstReady && options.emit) {
        this.emit("ready", normalized);
        this.emit("*", { event: "ready", detail: normalized });
      }
      return isFirstReady;
    }

    waitUntilReady(options = {}) {
      if (this.ready) return Promise.resolve(this.readyDetail || { ready: true });
      const timeoutMs = Number(options.timeoutMs || this.timeoutMs);
      this.pingReady({ silent: true, timeoutMs: Math.min(timeoutMs, 3000) });
      return new Promise((resolve, reject) => {
        const timer = timeoutMs > 0 ? window.setTimeout(() => {
          reject(new Error("WeatherEarth iframe did not become ready in time."));
        }, timeoutMs) : 0;
        this.readyPromise.then(
          (detail) => {
            if (timer) window.clearTimeout(timer);
            resolve(detail);
          },
          (error) => {
            if (timer) window.clearTimeout(timer);
            reject(error);
          }
        );
      });
    }

    pingReady(options = {}) {
      if (this.ready) return Promise.resolve(this.readyDetail || { ready: true });
      if (this.readyPingInFlight && !options.force) return this.readyPingInFlight;
      this.readyPingInFlight = this.send("ping", {}, { waitForReady: false, timeoutMs: options.timeoutMs || 3000 })
        .then((result) => {
          if (result?.ready) this.markReady(result, { emit: true });
          return result;
        })
        .catch((error) => {
          if (!options.silent) throw error;
          return null;
        })
        .finally(() => {
          this.readyPingInFlight = null;
        });
      return this.readyPingInFlight;
    }

    on(eventName, handler) {
      if (typeof handler !== "function") {
        throw new Error("WeatherEarthClient event handler must be a function.");
      }
      const key = String(eventName || "");
      if (!this.listeners.has(key)) this.listeners.set(key, new Set());
      this.listeners.get(key).add(handler);
      return () => this.off(key, handler);
    }

    off(eventName, handler) {
      const handlers = this.listeners.get(String(eventName || ""));
      if (!handlers) return;
      handlers.delete(handler);
      if (!handlers.size) this.listeners.delete(String(eventName || ""));
    }

    emit(eventName, detail) {
      const handlers = this.listeners.get(String(eventName || ""));
      if (!handlers) return;
      for (const handler of handlers) {
        handler(detail);
      }
    }

    setGeoJson(geojson, options = {}) {
      return this.send("set-geojson", { geojson, options });
    }

    appendGeoJson(geojson, options = {}) {
      return this.send("append-geojson", { geojson, options });
    }

    createWeatherElement(element) {
      return this.send("create-weather-element", { element });
    }

    addWeatherElement(element, options = {}) {
      return this.send("add-weather-element", { element, options });
    }

    addFeature(feature, options = {}) {
      return this.send("add-feature", { feature, options });
    }

    updateFeature(id, patch, options = {}) {
      return this.send("update-feature", { id, patch, options });
    }

    deleteFeature(id, options = {}) {
      return this.send("delete-feature", { id, options });
    }

    selectFeature(id, options = {}) {
      return this.send("select-feature", { id, options });
    }

    getFeatures(options = {}) {
      return this.send("get-features", { options });
    }

    getLayers() {
      return this.send("get-layers");
    }

    getPlaces() {
      return this.send("get-places");
    }

    searchPlaces(query, options = {}) {
      return this.send("search-places", { query, options });
    }

    getFocusTarget() {
      return this.send("get-focus-target");
    }

    getSurfaceProbe() {
      return this.send("get-surface-probe");
    }

    setSurfaceProbe(point, options = {}) {
      return this.send("set-surface-probe", { point, options });
    }

    clearSurfaceProbe() {
      return this.send("clear-surface-probe");
    }

    setFocusTarget(focusTarget, options = {}) {
      return this.send("set-focus-target", { focusTarget, options });
    }

    clearFocusTarget() {
      return this.send("clear-focus-target");
    }

    setFocusOrbit(enabled) {
      return this.send("set-focus-orbit", { enabled });
    }

    getScenePresets() {
      return this.send("get-scene-presets");
    }

    setScenePreset(key, options = {}) {
      return this.send("set-scene-preset", { key, options });
    }

    getElementTypes() {
      return this.send("get-element-types");
    }

    getElementTypeState() {
      return this.send("get-element-type-state");
    }

    setElementTypeVisibility(id, visible) {
      return this.send("set-element-type-visibility", { id, visible });
    }

    setAllElementTypeVisibility(visible) {
      return this.send("set-all-element-type-visibility", { visible });
    }

    setLayerVisibility(id, visible) {
      return this.send("set-layer-visibility", { id, visible });
    }

    setWeatherOpacity(value) {
      return this.send("set-weather-opacity", { value });
    }

    setMapDetails(enabled) {
      return this.send("set-map-details", { enabled });
    }

    setTerrain(enabled) {
      return this.send("set-terrain", { enabled });
    }

    setTerrainExaggeration(value) {
      return this.send("set-terrain-exaggeration", { value });
    }

    setSunlight(enabled) {
      return this.send("set-sunlight", { enabled });
    }

    setSunlightIntensity(value) {
      return this.send("set-sunlight-intensity", { value });
    }

    setSunlightTime(time, options = {}) {
      return this.send("set-sunlight-time", { time, options });
    }

    setBuildings(enabled) {
      return this.send("set-buildings", { enabled });
    }

    setBuildingHeightScale(value) {
      return this.send("set-building-height-scale", { value });
    }

    setWeather3d(enabled) {
      return this.send("set-weather-3d", { enabled });
    }

    setWeather3dScale(value) {
      return this.send("set-weather-3d-scale", { value });
    }

    setWeatherVolume(enabled) {
      return this.send("set-weather-volume", { enabled });
    }

    setWeatherVolumeScale(value) {
      return this.send("set-weather-volume-scale", { value });
    }

    getMeasurement() {
      return this.send("get-measurement");
    }

    startMeasurement(mode = "distance") {
      return this.send("start-measurement", { mode });
    }

    addMeasurementPoint(point, options = {}) {
      return this.send("add-measurement-point", { point, options });
    }

    finishMeasurement() {
      return this.send("finish-measurement");
    }

    undoMeasurementPoint() {
      return this.send("undo-measurement-point");
    }

    clearMeasurement() {
      return this.send("clear-measurement");
    }

    getCameraTour() {
      return this.send("get-camera-tour");
    }

    setCameraTour(stops = []) {
      return this.send("set-camera-tour", { stops });
    }

    addCameraTourStop(stop = {}) {
      return this.send("add-camera-tour-stop", { stop });
    }

    playCameraTour(options = {}) {
      return this.send("play-camera-tour", { options });
    }

    stopCameraTour() {
      return this.send("stop-camera-tour");
    }

    clearCameraTour() {
      return this.send("clear-camera-tour");
    }

    loadGeoJsonUrl(url, options = {}) {
      return this.send("load-geojson-url", { url, options });
    }

    loadManifestUrl(url, options = {}) {
      return this.send("load-manifest-url", { url, options });
    }

    loadProjectUrl(url, options = {}) {
      return this.send("load-project-url", { url, options });
    }

    setBasemap(key) {
      return this.send("set-basemap", { key });
    }

    setProjection(projection) {
      return this.send("set-projection", { projection });
    }

    setImmersiveMode(enabled) {
      return this.send("set-immersive", { enabled });
    }

    getQualityProfile() {
      return this.send("get-quality-profile");
    }

    setQualityProfile(profile) {
      return this.send("set-quality-profile", { profile });
    }

    captureMetrics(options = {}) {
      return this.send("capture-metrics", { options });
    }

    runBenchmarkPath(stops = [], options = {}) {
      return this.send("run-benchmark-path", { stops, options }, { timeoutMs: options.timeoutMs || this.timeoutMs * 4 });
    }

    getBenchmarkPaths() {
      return this.send("get-benchmark-paths");
    }

    flyToPlace(placeId, options = {}) {
      return this.send("fly-to-place", { placeId, options });
    }

    flyToSearch(query, options = {}) {
      return this.send("fly-to-search", { query, options });
    }

    flyToCamera(camera, options = {}) {
      return this.send("fly-to-camera", { camera, options });
    }

    setCameraPitch(pitch, options = {}) {
      return this.send("set-camera-pitch", { pitch, options });
    }

    setTimeFilter(value, options = {}) {
      return this.send("set-time-filter", { value, options });
    }

    clearWeather() {
      return this.send("clear-weather");
    }

    getGeoJson(options = {}) {
      return this.send("get-geojson", { options });
    }

    getVisibleGeoJson(options = {}) {
      return this.getGeoJson({ ...options, visible: true });
    }

    getProject(options = {}) {
      return this.send("get-project", { options });
    }

    setProject(project, options = {}) {
      return this.send("set-project", { project, options });
    }

    standardize() {
      return this.send("standardize-weather");
    }

    validate(options = {}) {
      const { payload, ...rest } = options || {};
      return this.send("validate-geojson", { payload, options: rest });
    }

    getValidationReport(options = {}) {
      return this.send("get-validation-report", { options });
    }

    fitWeather() {
      return this.send("fit-weather");
    }

    getReady() {
      return this.send("get-ready", {}, { waitForReady: false });
    }

    getState() {
      return this.send("get-state");
    }
  }

  global.WeatherEarthClient = WeatherEarthClient;
})(window);
