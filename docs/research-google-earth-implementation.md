# Google Earth / Photorealistic 3D Earth Implementation Research

> Scope: Google Earth itself is proprietary. This document separates public facts from implementation inferences, then maps both to this project's CesiumJS / Google Photorealistic 3D Tiles viewer.

## 1. Executive Summary

The Google Earth visual result is not a single switch or style preset. It is the combined result of:

- A global geospatial data stack: satellite imagery, aerial imagery, 3D terrain, photogrammetric 3D geometry, labels, POI, roads, borders, Street View, and historical imagery.
- A multi-resolution streaming format: imagery and 3D data are subdivided into tiles and selected by camera altitude, view, and error budget.
- A rendering engine tuned specifically for Earth: camera rules, sky, atmosphere, haze, sun/ambient balance, label placement, tile blending, texture filtering, and post-processing.
- A very large delivery system: CDN-backed tile streaming, caching, quota/session controls, and GPU/CPU/network adaptive behavior.

For this project, CesiumJS + Google Photorealistic 3D Tiles can reuse Google's public 3D mesh/textured data, but it does not reproduce the full Google Earth renderer. Closing the gap requires work in three areas: data/terms compliance, renderer quality/performance tuning, and Google Earth-like camera/visual behavior.

## 2. Public Data Model

### 2.1 Google Earth imagery types

Google's public help material says Google Earth contains satellite, aerial, 3D, and Street View imagery. It also states that imagery is collected over time from providers and platforms and is not real time. Satellite and aerial imagery can be either single-image acquisitions or mosaics made from images collected across days or months.

Important implication: if our page differs from Google Earth at a location, the reason may be dataset date, provider, tile level, or 3D coverage, not only renderer settings.

### 2.2 3D terrain and detailed 3D imagery

Google Earth Studio documentation distinguishes broad 3D terrain from detailed 3D city/natural-landmark geometry. It says most of Earth has terrain data, while detailed 3D geometry exists in many urban centers and natural landmarks. It also warns that 3D imagery has practical sharpness limits at very low altitude, especially in remote areas.

Important implication: Google Earth itself avoids or discourages some extreme close/low/street-level framing because the underlying photogrammetry can reveal texture and mesh artifacts.

### 2.3 Photorealistic 3D Tiles

Google Maps Platform describes Photorealistic 3D Tiles as a 3D mesh textured with high-resolution imagery. Public API access is through a root tileset URL consumed by a compatible 3D Tiles renderer. After the root tileset is loaded, renderer-originated tile requests are made as the user explores the scene.

In our project, `Cesium.createGooglePhotorealistic3DTileset()` hides much of the direct root URL handling through Cesium ion, but the runtime model is still the same: Cesium streams a hierarchy of textured 3D tiles.

### 2.4 Earth Engine is related but not the Earth renderer

Google Earth Engine is a planetary-scale analysis platform with a multi-petabyte catalog of satellite imagery and geospatial datasets. It powers products like Timelapse, but it should not be treated as the same thing as Google Earth's live 3D renderer. It is useful as a reference for data scale and analysis capabilities, not a drop-in rendering backend.

## 3. Likely Production Pipeline

The exact Google Earth pipeline is not public. The following is an implementation inference based on photogrammetry practice, Google public docs, and the OGC/Cesium 3D Tiles model.

1. Data acquisition
   - Satellite imagery for global coverage.
   - Aerial oblique imagery for high-detail 3D cities and terrain.
   - DEM/terrain sources and ocean/bathymetry layers.
   - Vector/business layers: labels, roads, borders, POI, search index, Street View references.

2. Pre-processing
   - Radiometric/color correction and cloud/seam management for imagery mosaics.
   - Aerial image alignment, camera calibration, structure-from-motion, dense reconstruction.
   - Mesh generation, simplification, texture atlas generation, and per-region quality checks.

3. Tiling and level of detail
   - Convert global and local content into a spatial hierarchy.
   - Each tile stores geometry/texture content plus bounding volumes and geometric error.
   - Child tiles replace or refine parent tiles as camera distance and screen-space error require.

4. Hosting and delivery
   - Root tileset/session controls.
   - CDN-backed tile payloads.
   - Client cache headers, renderer tile cache, and request scheduling.
   - Attribution metadata and licensing controls.

5. Client rendering
   - Adaptive tile selection.
   - GPU upload and cache eviction.
   - Texture filtering, lighting, fog/atmosphere, sky, sun, labels, picking, camera controls.
   - Renderer-specific fallback behavior for slow network, low memory, or weak GPU.

## 4. 3D Tiles Performance Mechanics

3D Tiles is built around hierarchical level of detail. A tileset is a JSON tree of tiles; each tile has content, child tiles, and bounding volume. Visualization software uses geometric error plus screen-space metrics like distance from camera to decide what to stream and render.

In Cesium, the central visual/performance knob is `maximumScreenSpaceError`:

- Lower value: more child tiles refine earlier, sharper image, more network/GPU/memory pressure.
- Higher value: fewer fine tiles, better FPS and faster loading, but blurrier or blockier geometry.

Other important knobs:

- `dynamicScreenSpaceError`: can reduce far-distance detail pressure, improving speed but making distant terrain less detailed.
- `cacheBytes` / overflow cache: controls tile memory budget and can force quality down when memory is exceeded.
- Request concurrency: Google recommends increasing concurrent requests to `tile.googleapis.com:443`, with `18` noted as a common optimal value for CesiumJS.
- `requestRenderMode`: useful for mostly static apps, but less helpful when the camera is continuously moving or when our own render loop drives animation.
- Resolution scale and browser pixel ratio: high-DPI rendering is sharper but fill-rate heavy.
- Antialiasing / MSAA: improves edge quality but costs GPU time.

## 5. Why Google Earth Looks Different From Our Cesium Page

### 5.1 Same data access does not mean same renderer

Google's newer 3D Maps JavaScript API provides a built-in 3D rendering experience around Google's 3D imagery. CesiumJS is a general-purpose open 3D geospatial renderer. Even when both consume Google 3D tiles, the camera controls, post-processing, tile blending, sky, labels, and overlay behavior can differ.

### 5.2 Google Earth has mature image treatment

Google Earth/Earth Studio likely applies product-specific color, haze, sky, atmosphere, imagery blending, label hierarchy, and camera constraints. Cesium can approximate these, but it will not match exactly without custom shader/post-processing work.

### 5.3 Camera framing matters

Earth Studio recommends 40-60 degree tilt for 3D data because this better matches aerial capture geometry. It also warns that high tilt and very low altitude can reduce apparent quality because more geometry enters the frame and the renderer must manage more data. Our current presets should therefore avoid extremely low, street-level, or very high-tilt shots unless the goal is inspection rather than cinematic quality.

### 5.4 Coverage and recency vary

Google Earth imagery tiles are updated at different intervals and can show seams or different detail levels by region. Remote regions and some non-urban areas may have less detailed 3D data. This affects both Google Earth and public Photorealistic 3D Tiles, but Google Earth may hide some of this better through product-specific rendering.

### 5.5 Our app adds weather overlays and custom UI behavior

Weather GeoJSON entities, focus markers, labels, and HUDs are not Google Earth elements. If they are visible during visual comparison, they make the scene read as an analysis tool rather than a pure Earth viewer.

## 6. Compliance and Product Constraints

Google Maps Platform policies matter for this project:

- Clear Google Maps attribution is required.
- Third-party renderer attribution must not overlap or obscure Google attribution.
- Google data attribution from API metadata must remain visible or available.
- Unauthorized caching, extraction, offline use, object detection, geodata extraction, and resale are restricted.

This matters because earlier UI cleanup hid credits for visual minimalism. For a production build, we must reintroduce compliant attribution in a low-noise way.

## 7. Current Project Gap Analysis

### Already aligned

- CesiumJS replaces MapLibre for the Earth engine.
- Google Photorealistic 3D Tiles has been integrated, then demoted to an optional basemap after the P2b non-Google provider pass.
- Weather data stays as WGS84 GeoJSON overlay data.
- Immersive mode can remove analysis UI and focus on the globe.
- Quality mode has been improved by lowering screen-space error and restoring full resolution.

### Remaining gaps

- Attribution is not production-compliant if Google/Cesium credits remain hidden.
- There is no quality/balanced/performance switch; parameters are hard-coded.
- No runtime FPS/tile/memory instrumentation is exposed.
- No benchmark route for representative locations and camera states.
- No native Google 3D Maps prototype to compare Google's built-in renderer against Cesium.
- No custom atmospheric/tonemapping layer that approximates Google Earth.
- Labels, POI, and local place annotations are still not Google Earth-like.
- Weather overlays need terrain-aware depth/drape behavior tuning for close-range terrain.

## 8. Recommended Implementation Roadmap

### Phase 1: Measurement before more visual tuning

Add a hidden/debug metrics layer:

- FPS and frame latency.
- Camera altitude, tilt, heading, FOV.
- Tiles loaded / loading / failed.
- `googleTileset.totalMemoryUsageInBytes` when available.
- Current `maximumScreenSpaceError`, resolution scale, pixel ratio.
- Network count and failure summary for tile requests.

Acceptance: every visual comparison screenshot must include a metrics JSON dump.

### Phase 2: Quality profiles

Implement three runtime profiles:

- Quality:
  - `maximumScreenSpaceError`: 2-3
  - `dynamicScreenSpaceError`: false
  - `resolutionScale`: 1
  - MSAA: 4
  - request concurrency: 18

- Balanced:
  - `maximumScreenSpaceError`: 5-8
  - `dynamicScreenSpaceError`: true
  - `resolutionScale`: 0.9-1 depending on DPR

- Performance:
  - `maximumScreenSpaceError`: 10-16
  - `dynamicScreenSpaceError`: true
  - `resolutionScale`: 0.75-0.85
  - lower weather overlay density/labels

Acceptance: same camera path tested on China overview, Beijing city, Qinghai-Tibet terrain, and one weather process playback.

### Phase 3: Google Earth-like camera presets

Revise camera logic:

- Keep cinematic terrain shots around 40-60 degree tilt.
- Avoid extremely low altitude unless inspecting a specific point.
- Add target-relative orbit with stable range instead of zoom-only motion.
- Add separate presets for:
  - Global overview.
  - Mountain cinematic.
  - City oblique.
  - Weather overlay analysis.

Acceptance: screenshots compare against Google Earth reference framing, not just arbitrary camera positions.

### Phase 4: Visual treatment

Tune:

- Sky color and horizon haze.
- Sun/ambient intensity.
- Tonemapping/exposure.
- Fog/atmospheric distance cues.
- Label/marker style, hiding tool markers during Earth-only view.

Acceptance: no dark, over-contrasty mountain shots; no obvious blue/black hard horizon where Google Earth shows sky/haze.

### Phase 5: Native Google 3D Maps feasibility spike

Build a separate proof-of-concept page using Google Maps JavaScript API 3D Maps:

- Load same representative camera targets.
- Add minimal weather overlays if API supports required geometry sufficiently.
- Compare:
  - Visual quality.
  - Camera freedom.
  - Weather overlay control.
  - Performance.
  - API terms and billing.

Decision rule:

- If the goal is pure Google Earth-like presentation, native Google 3D Maps may be closer.
- If the goal is advanced GIS/weather overlays, Cesium remains more controllable.

## 9. Concrete Next Changes for This Repo

Recommended next coding tasks:

1. Restore compliant attribution instead of hiding Cesium credit container.
2. Add `Cesium.RequestScheduler.requestsByServer["tile.googleapis.com:443"] = 18`.
3. Add `view.qualityProfile` to project state and URL params.
4. Add `window.weatherEarth.setQualityProfile("quality" | "balanced" | "performance")`.
5. Add benchmark helpers:
   - `window.weatherEarth.captureMetrics()`
   - `window.weatherEarth.runBenchmarkPath([...cameraStops])`
6. Add camera presets tuned to 40-60 degree Earth Studio guidance.
7. Build `viewer/google-3d-maps-spike.html` only as a comparison prototype, not as a replacement yet.

## 10. Suggested Priority

P0 should be done before more visual polishing:

- Restore compliant Google/Cesium attribution.
- Add runtime metrics and benchmark capture.
- Add request concurrency tuning for `tile.googleapis.com:443`.
- Add quality profile state so visual tuning is reproducible.

P1 should target Google Earth-like perception:

- Retune camera presets around 40-60 degree tilt.
- Add terrain/city cinematic routes for visual comparison.
- Tune light, exposure, sky, and haze with screenshots from the same camera path.

P2 should answer the product architecture question:

- Build a native Google 3D Maps spike.
- Compare it against Cesium on the same scenes and weather overlays.

## 11. Implementation Status

### P0 / P1

Implemented in `viewer/earth.html` and `viewer/earth.js`:

- Cesium/Google attribution remains visible.
- Google tile request concurrency is configurable through the quality profile.
- `quality`, `balanced`, and `performance` profiles are exposed through URL/project state and `window.weatherEarth`.
- Metrics capture and benchmark routes are available through `captureMetrics()` and `runBenchmarkPath(...)`.
- Camera presets, benchmark paths, exposure, sky atmosphere, fog, and canvas treatment have been retuned for the P1 Google Earth comparison pass.

### P2

Implemented as a separate prototype in `viewer/google-3d-maps-spike.html`:

- Loads Google Maps JavaScript API `maps3d` dynamically and creates a `Map3DElement`.
- Reads `googleMapsApiKey` from `viewer/earth.config.local.js`, URL parameters, or a temporary runtime input.
- Reuses the same representative P1 camera presets and benchmark route IDs.
- Translates sample WGS84 GeoJSON into `Marker3DElement`, `Polyline3DElement`, and `Polygon3DElement` overlays.
- Exposes `window.google3dSpike` methods for state, camera movement, GeoJSON loading, metrics capture, and benchmark playback.

Known limits of the P2 spike:

- It is not a replacement for the Cesium viewer or `WeatherEarthClient`.
- It does not implement the full weather editor, project document model, manifest playback, feature selection, validation, or postMessage compatibility.
- Google 3D Maps does not expose Cesium-style tile memory, screen-space-error, or detailed 3D Tiles counters, so performance metrics are limited to page-level FPS, camera state, and overlay counts.

Next decision: use the P2 spike to decide whether the project should remain Cesium-first or add a separate presentation-only Google renderer.

### P2b

Implemented in `viewer/earth.html` and `viewer/earth.js`:

- The main Cesium viewer now defaults to `cesium-world-terrain` instead of Google Photorealistic 3D Tiles.
- Google Photorealistic 3D Tiles remains available through `basemap=google-photorealistic-3d-tiles` and the basemap selector.
- Non-Google basemap options include `cesium-world-terrain`, `esri-world-imagery`, `openstreetmap-imagery`, and `natural-earth`.
- If a Cesium ion token is missing or a token-backed provider fails, the page continues with an OpenStreetMap or Natural Earth fallback instead of blocking the viewer.
- `view.tileset`, `view.basemap`, `earthVisual`, metrics, sharing URLs, and `setBasemap(...)` now report or restore the selected provider.

P2b decision: keep Cesium as the product engine and treat Google renderers as optional presentation/comparison surfaces, not core runtime dependencies.

## 12. Reference Links

- Google Earth Help: How images are collected  
  https://support.google.com/earth/answer/6327779
- Google Maps Platform: Photorealistic 3D Tiles  
  https://developers.google.com/maps/documentation/tile/3d-tiles
- Google Maps Platform: Work with a 3D Tiles renderer  
  https://developers.google.com/maps/documentation/tile/use-renderer
- Google Maps Platform: Map Tiles API Usage and Billing  
  https://developers.google.com/maps/documentation/tile/usage-and-billing
- Google Maps Platform: Map Tiles API Policies  
  https://developers.google.com/maps/documentation/tile/policies
- Google Maps JavaScript API: 3D Maps overview  
  https://developers.google.com/maps/documentation/javascript/3d/overview
- CesiumJS: Photorealistic 3D Tiles from Google Maps Platform  
  https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/
- Cesium: 3D Tiles Essentials  
  https://cesium.com/why-cesium/3d-tiles/3d-tiles-essentials/
- CesiumJS API: Cesium3DTileset  
  https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html
- Google Earth Studio: Best Practices  
  https://earth.google.com/studio/docs/best-practices/
- Google Earth Engine  
  https://earthengine.google.com/
