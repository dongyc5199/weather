import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { WindViewportSeeder } from "./wind-seeding.js";
import { StyledLineSegments } from "./styled-lines.js";
import {
  WIND_CAPACITY,
  WIND_HISTORY_STEPS,
  WIND_STEP_SECONDS,
  WIND_VIEW_SETTLE_SECONDS,
  windScreenBounds,
  windPresentation,
  windIntensity,
} from "./wind-presentation.js";

const R = 6371000;
const RAD = Math.PI / 180;

export function geometricHeight(geopotential) {
  return (R * geopotential) / (R - geopotential);
}

export function windDisplayHeight(level, height, scale = 1) {
  if (!height || height.belowGround) return NaN;
  if (level === "surface") return height.ground + 10;
  return height.ground + (height.geometric - height.ground) * scale;
}

export function advectWind(lon, lat, u, v, seconds) {
  const speed = Math.hypot(u, v);
  if (speed === 0) return { lon, lat };
  const distance = (speed * seconds) / R,
    latitude = lat * RAD;
  const sinLat = Math.sin(latitude),
    cosLat = Math.cos(latitude);
  const sinD = Math.sin(distance),
    cosD = Math.cos(distance);
  const nextLat = Math.asin(
    Math.max(-1, Math.min(1, sinLat * cosD + (cosLat * sinD * v) / speed)),
  );
  return {
    lat: nextLat / RAD,
    lon:
      lon +
      Math.atan2(
        (u / speed) * sinD * cosLat,
        cosD - sinLat * Math.sin(nextLat),
      ) /
        RAD,
  };
}

export function gridSampler(wind, temp) {
  const h = wind[0].header,
    u = wind[0].data,
    v = wind[1].data,
    t = temp[0].data;
  let profile = null;
  let maximumHeight = 0,
    minimumGround = 0,
    maximumGround = 0;
  for (const record of [...wind, ...temp]) {
    const x = record.header;
    if (
      [
        "nx",
        "ny",
        "lo1",
        "la1",
        "dx",
        "dy",
        "refTime",
        "forecastTime",
        "layer",
      ].some((k) => x[k] !== h[k])
    )
      throw new Error("风场和气温网格不一致");
  }
  function interpolateAt(arr, lon, lat) {
    const x = ((((lon - h.lo1) % 360) + 360) % 360) / h.dx,
      y = (h.la1 - lat) / h.dy;
    if (y < 0 || y > h.ny - 1) return null;
    const i = Math.floor(x),
      j = Math.min(Math.floor(y), h.ny - 2);
    const f = x - i,
      g = y - j,
      a = j * h.nx + i,
      b = j * h.nx + ((i + 1) % h.nx),
      c = a + h.nx,
      d = b + h.nx;
    const weights = [(1 - f) * (1 - g), f * (1 - g), (1 - f) * g, f * g],
      indices = [a, b, c, d];
    return indices.some((k) => arr[k] === null || !Number.isFinite(arr[k]))
      ? NaN
      : indices.reduce((s, k, n) => s + arr[k] * weights[n], 0);
  }
  return {
    header: h,
    setHeightProfile(value) {
      if (value.layer !== (h.layer || "surface"))
        throw new Error("风场与高度的气压层不一致");
      for (const record of [
        value.orography,
        value.surface_pressure,
        ...(value.height ? [value.height] : []),
      ]) {
        if (
          !record ||
          record.data.length !== h.nx * h.ny ||
          [
            "nx",
            "ny",
            "lo1",
            "la1",
            "dx",
            "dy",
            "refTime",
            "forecastTime",
          ].some((k) => record.header[k] !== h[k])
        )
          throw new Error("风场与高度的网格或时次不一致");
      }
      if (
        h.layer !== "surface" &&
        (!value.height || value.height.header.layer !== h.layer)
      )
        throw new Error("缺少当前气压层的位势高度");
      profile = value;
      minimumGround = Infinity;
      maximumGround = -Infinity;
      maximumHeight = -Infinity;
      value.orography.data.forEach((height, i) => {
        if (Number.isFinite(height)) {
          const ground = geometricHeight(height);
          minimumGround = Math.min(minimumGround, ground);
          maximumGround = Math.max(maximumGround, ground);
        }
        const hgt = value.height?.data[i];
        if (Number.isFinite(hgt))
          maximumHeight = Math.max(maximumHeight, geometricHeight(hgt));
      });
    },
    maxDisplayHeight(scale) {
      return h.layer === "surface"
        ? maximumGround + 10
        : maximumHeight * scale - minimumGround * (scale - 1);
    },
    temperatureAt(lon, lat) {
      const value = interpolateAt(t, lon, lat);
      return Number.isFinite(value) ? value - 273.15 : NaN;
    },
    heightAt(lon, lat) {
      if (!profile) return null;
      const groundH = interpolateAt(profile.orography.data, lon, lat);
      const surfaceP = interpolateAt(profile.surface_pressure.data, lon, lat);
      const geopotential = profile.height
        ? interpolateAt(profile.height.data, lon, lat)
        : groundH + 10;
      if (![groundH, surfaceP, geopotential].every(Number.isFinite))
        return null;
      const ground = geometricHeight(groundH),
        geometric = geometricHeight(geopotential);
      const pressure = h.pressureLevelHpa ?? Number.parseFloat(h.layer);
      return {
        geopotential,
        ground,
        geometric,
        belowGround:
          profile.layer !== "surface" &&
          (pressure * 100 > surfaceP || geometric <= ground),
      };
    },
    sample(lon, lat) {
      const east = interpolateAt(u, lon, lat),
        north = interpolateAt(v, lon, lat),
        kelvin = interpolateAt(t, lon, lat);
      return Number.isFinite(east) && Number.isFinite(north)
        ? {
            u: east,
            v: north,
            speed: Math.hypot(east, north),
            temp: kelvin - 273.15,
          }
        : null;
    },
  };
}

export class WindLayer {
  constructor(
    scene,
    camera,
    style = null,
    { capacity = WIND_CAPACITY, steps = WIND_HISTORY_STEPS } = {},
  ) {
    this.camera = camera;
    this.enabled = true;
    this.moving = false;
    this.grid = null;
    this.heightScale = 1;
    this.lastHeights = null;
    this.capacity = capacity;
    this.count = Math.min(1700, capacity);
    this.steps = steps;
    this.viewport = null;
    this.presentation = null;
    this.presentationDirty = true;
    this.lastPresentation = -Infinity;
    this.lastCameraMatrix = new THREE.Matrix4();
    this.lastProjectionMatrix = new THREE.Matrix4();
    this.viewInitialized = false;
    this.viewChanging = false;
    this.viewQuietUntil = 0;
    this.overview = false;
    this.cursor = 0;
    this.clock = 0;
    this.tick = 0;
    this.positions = new Float32Array(capacity * this.steps * 6);
    this.birth = new Float32Array(capacity * this.steps * 2).fill(-1000);
    this.intensity = new Float32Array(capacity * this.steps);
    this.segmentLengths = new Float64Array(capacity * this.steps);
    const defaults = style || {
      color: getComputedStyle(document.documentElement)
        .getPropertyValue("--earth-wind-color")
        .trim(),
      opacity: Number(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--earth-wind-opacity",
        ),
      ),
      width:
        Number(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--earth-wind-width",
          ),
        ) || 1.8,
      pattern: "solid",
    };
    this.stroke = new StyledLineSegments(this.positions, defaults, {
      birth: this.birth,
      intensity: this.intensity,
      segmentLengths: this.segmentLengths,
      wind: true,
      caps: false,
    });
    this.particleGroups = Array.from({ length: capacity }, (_, i) => ({
      start: i * this.steps,
      count: this.steps,
      ring: true,
    }));
    this.stroke.setGroups(this.particleGroups.slice(0, this.count));
    this.geometry = this.stroke.geometry;
    this.material = this.stroke.material;
    this.lines = this.stroke.object;
    this.geometry.instanceCount = this.count * this.steps;
    scene.add(this.lines);
    this.particles = Array.from({ length: capacity }, () => ({
      lon: 0,
      lat: 0,
      age: 999,
      height: 0,
      maxAge: 70,
      retryAt: 0,
      fresh: true,
    }));
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.seeder = new WindViewportSeeder(camera, (lon, lat) =>
      windDisplayHeight(
        this.grid.header.layer,
        this.grid.heightAt(lon, lat),
        this.heightScale,
      ),
    );
  }
  clear() {
    this.birth.fill(-1000);
    this.geometry.attributes.instanceBirth.data.needsUpdate = true;
    this.segmentLengths.fill(0);
    this.tick = 0;
    this.presentationDirty = true;
    this.particles.forEach((p) => {
      p.age = 999;
      p.retryAt = 0;
      p.fresh = true;
    });
  }
  setGrid(grid) {
    this.clear();
    this.grid = grid;
  }
  setHeightScale(value) {
    const scale = Math.max(1, Math.min(20, Number(value) || 1));
    if (scale !== this.heightScale) this.clear();
    this.heightScale = scale;
  }
  getState() {
    return {
      visible: this.lines.visible,
      moving: this.moving,
      viewChanging: this.viewChanging,
      heightScale: this.heightScale,
      heights: this.lastHeights,
      style: { ...this.stroke.style },
      particles: this.count,
      overview: this.overview,
      trailSeconds: this.material.uniforms.life.value,
      timeScale: this.presentation?.timeScale || null,
      footprint: this.presentation?.bounds || null,
    };
  }
  setLineStyle(style) {
    this.stroke.setStyle(style);
  }
  updateLineViewport(height) {
    if (!this.lines.visible) return;
    const surface = this.lastHeights
      ? (this.lastHeights.min + this.lastHeights.max) / 2
      : 0;
    this.stroke.updateViewport(this.camera, height, surface);
  }
  setViewport(width, height, mobile = false) {
    this.viewport = { width, height, mobile };
    this.presentationDirty = true;
  }
  updatePresentation() {
    if (
      !this.grid ||
      !this.viewport ||
      (!this.presentationDirty && this.clock - this.lastPresentation < 0.25)
    )
      return;
    this.presentationDirty = false;
    this.lastPresentation = this.clock;
    const altitude = WGS84_ELLIPSOID.getPositionElevation(this.camera.position);
    const bounds = windScreenBounds(
      this.camera,
      this.viewport.width,
      this.viewport.height,
      this.grid.maxDisplayHeight(this.heightScale),
    );
    this.presentation = windPresentation(
      bounds,
      this.viewport,
      altitude,
      this.capacity,
    );
    if (this.count !== this.presentation.count) {
      this.count = this.presentation.count;
      this.stroke.setGroups(this.particleGroups.slice(0, this.count));
      this.geometry.instanceCount = this.count * this.steps;
    }
    this.material.uniforms.life.value = Math.min(
      this.steps * WIND_STEP_SECONDS,
      this.presentation.trailSeconds,
    );
    this.overview = altitude > (this.overview ? 600000 : 1000000);
    this.material.depthTest = !this.overview;
    this.material.uniforms.windOverview.value = Number(this.overview);
  }
  setMoving(value) {
    if (this.moving !== Boolean(value)) this.presentationDirty = true;
    this.moving = Boolean(value);
    if (!this.moving && this.viewChanging)
      this.viewQuietUntil = this.clock + WIND_VIEW_SETTLE_SECONDS;
  }
  viewMoved() {
    const current = this.camera.matrixWorld.elements;
    const previous = this.lastCameraMatrix.elements;
    const angularTolerance =
      (2 * Math.tan((this.camera.fov * Math.PI) / 360) * 0.02) /
      Math.max(1, this.viewport?.height || 800);
    const positionTolerance = Math.max(
      0.01,
      Math.abs(WGS84_ELLIPSOID.getPositionElevation(this.camera.position)) *
        angularTolerance,
    );
    const translated =
      Math.hypot(
        current[12] - previous[12],
        current[13] - previous[13],
        current[14] - previous[14],
      ) > positionTolerance;
    const rotated = [0, 1, 2, 4, 5, 6, 8, 9, 10].some(
      (i) => Math.abs(current[i] - previous[i]) > angularTolerance,
    );
    // Near/far planes change as terrain loads, without changing the visible
    // viewpoint. Only focal length, aspect and projection offsets suspend wind.
    const projected = [0, 5, 8, 9, 12, 13].some(
      (i) =>
        Math.abs(
          this.camera.projectionMatrix.elements[i] -
            this.lastProjectionMatrix.elements[i],
        ) > 1e-8,
    );
    const moved = this.viewInitialized && (translated || rotated || projected);
    this.lastCameraMatrix.copy(this.camera.matrixWorld);
    this.lastProjectionMatrix.copy(this.camera.projectionMatrix);
    this.viewInitialized = true;
    return moved;
  }
  seedParticle(particle) {
    if (this.clock < particle.retryAt) return false;
    const seed = this.seeder.seedRandom();
    if (!seed) {
      particle.age = 999;
      particle.retryAt = this.clock + 0.15 + Math.random() * 0.15;
      return false;
    }
    Object.assign(particle, seed, {
      age: particle.fresh ? Math.floor(Math.random() * 100) : 0,
      maxAge: 100,
      retryAt: 0,
      fresh: false,
    });
    return true;
  }
  update(dt) {
    const enabled = this.enabled && !!this.grid && this.material.opacity > 0;
    this.clock += dt;
    this.material.uniforms.time.value = this.clock;
    if (this.viewMoved()) {
      this.viewChanging = true;
      this.viewQuietUntil = this.clock + WIND_VIEW_SETTLE_SECONDS;
      this.presentationDirty = true;
    }
    this.lines.visible = enabled && !this.viewChanging;
    this.updatePresentation();
    if (this.viewChanging) {
      // Pointer-down alone does not hide the layer. After actual camera motion,
      // stay hidden through the drag, wheel bursts and their inertial movement.
      if (!enabled || this.moving || this.clock < this.viewQuietUntil) return;
      this.viewChanging = false;
      this.clear();
      this.updatePresentation();
      // Show only the newly sampled view; a short warm-up makes the new heads
      // visible immediately instead of flashing the old view's trail buffer.
      for (let step = 2; step >= 0; step--)
        this.evolve(WIND_STEP_SECONDS, this.clock - step * WIND_STEP_SECONDS);
      this.lines.visible = true;
      return;
    }
    if (!this.lines.visible) return;
    // Skip elapsed simulation time after a slow frame rather than accumulate a
    // permanent backlog whose newly drawn segments are already expired.
    this.tick = Math.min(this.tick + dt, 2 * WIND_STEP_SECONDS);
    let steps = 0;
    while (this.tick + 1e-8 >= WIND_STEP_SECONDS && steps++ < 2) {
      const born = this.clock - this.tick + WIND_STEP_SECONDS;
      this.tick -= WIND_STEP_SECONDS;
      this.evolve(WIND_STEP_SECONDS, born);
    }
  }
  evolve(delta, born) {
    const altitude = WGS84_ELLIPSOID.getPositionElevation(this.camera.position);
    this.seeder.prepare(this.count, this.presentation?.bounds.box);
    this.seeder.maxHeight = this.grid.maxDisplayHeight(this.heightScale);
    const seconds =
      delta *
      (this.presentation?.timeScale ||
        34000 * Math.min(1, Math.max(0.002, altitude / 4000000)));
    let minimum = Infinity,
      maximum = -Infinity,
      count = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      if (p.age >= p.maxAge && !this.seedParticle(p)) continue;
      WGS84_ELLIPSOID.getCartographicToPosition(
        p.lat * RAD,
        p.lon * RAD,
        p.height,
        this.a,
      );
      if (!this.seeder.inView(this.a)) {
        if (!this.seedParticle(p)) continue;
        WGS84_ELLIPSOID.getCartographicToPosition(
          p.lat * RAD,
          p.lon * RAD,
          p.height,
          this.a,
        );
      }
      const w = this.grid.sample(p.lon, p.lat);
      if (!w) {
        p.age = 999;
        continue;
      }
      const { lat: nextLat, lon: nextLon } = advectWind(
        p.lon,
        p.lat,
        w.u,
        w.v,
        seconds,
      );
      const end = this.grid.heightAt(nextLon, nextLat);
      const startHeight = p.height;
      const endHeight = windDisplayHeight(
        this.grid.header.layer,
        end,
        this.heightScale,
      );
      if (!Number.isFinite(startHeight) || !Number.isFinite(endHeight)) {
        p.age = 999;
        continue;
      }
      minimum = Math.min(minimum, startHeight);
      maximum = Math.max(maximum, startHeight);
      count++;
      // Match the selected isobaric surface, with optional labelled vertical exaggeration.
      WGS84_ELLIPSOID.getCartographicToPosition(
        nextLat * RAD,
        nextLon * RAD,
        endHeight,
        this.b,
      );
      const slot = i * this.steps + this.cursor;
      this.a.toArray(this.positions, slot * 6);
      this.b.toArray(this.positions, slot * 6 + 3);
      this.birth[slot * 2] = this.birth[slot * 2 + 1] = born;
      this.intensity[slot] = windIntensity(w.speed);
      this.segmentLengths[slot] = this.a.distanceTo(this.b);
      p.lon = nextLon;
      p.lat = nextLat;
      p.height = endHeight;
      p.age++;
    }
    this.cursor = (this.cursor + 1) % this.steps;
    this.stroke.positionsChanged(this.cursor, this.count * this.steps);
    this.lastHeights = count ? { min: minimum, max: maximum, count } : null;
  }
}
