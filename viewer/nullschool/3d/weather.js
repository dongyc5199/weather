import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { WindViewportSeeder } from "./wind-seeding.js";

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
    const i = Math.floor(x),
      j = Math.floor(y);
    if (j < 0 || j >= h.ny - 1) return null;
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
  constructor(scene, camera) {
    this.camera = camera;
    this.enabled = true;
    this.moving = false;
    this.grid = null;
    this.heightScale = 1;
    this.lastHeights = null;
    this.count = 1700;
    this.steps = 18;
    this.cursor = 0;
    this.clock = 0;
    this.tick = 0;
    this.positions = new Float32Array(this.count * this.steps * 6);
    this.birth = new Float32Array(this.count * this.steps * 2).fill(-1000);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.geometry.setAttribute(
      "birth",
      new THREE.BufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        time: { value: 0 },
        life: { value: 1.0 },
        ink: {
          value: new THREE.Color(
            getComputedStyle(document.documentElement)
              .getPropertyValue("--earth-wind-color")
              .trim(),
          ),
        },
        opacity: {
          value: Number(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--earth-wind-opacity",
            ),
          ),
        },
      },
      vertexShader: `attribute float birth; uniform float time; uniform float life; varying float alpha;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){alpha=clamp(1.0-(time-birth)/life,0.0,1.0);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      #include <logdepthbuf_vertex>
      }`,
      fragmentShader: `varying float alpha; uniform vec3 ink; uniform float opacity;
      #include <logdepthbuf_pars_fragment>
      void main(){if(alpha<0.01)discard;
      #include <logdepthbuf_fragment>
      gl_FragColor=vec4(ink,alpha*opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.particles = Array.from({ length: this.count }, () => ({
      lon: 0,
      lat: 0,
      age: 999,
      height: 0,
      maxAge: 70,
      retryAt: 0,
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
    this.geometry.attributes.birth.needsUpdate = true;
    this.particles.forEach((p) => {
      p.age = 999;
      p.retryAt = 0;
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
      heightScale: this.heightScale,
      heights: this.lastHeights,
    };
  }
  setMoving(value) {
    this.moving = value;
    this.clear();
    this.lines.visible = this.enabled && !value;
  }
  seedParticle(particle, index) {
    if (this.clock < particle.retryAt) return false;
    const seed = this.seeder.seed(index);
    if (!seed) {
      particle.age = 999;
      particle.retryAt = this.clock + 0.15 + Math.random() * 0.15;
      return false;
    }
    Object.assign(particle, seed, {
      age: 0,
      maxAge: 40 + Math.random() * 50,
      retryAt: 0,
    });
    return true;
  }
  update(dt) {
    this.clock += dt;
    this.material.uniforms.time.value = this.clock;
    const altitude = WGS84_ELLIPSOID.getPositionElevation(this.camera.position);
    this.lines.visible = this.enabled && !this.moving && !!this.grid;
    if (!this.lines.visible) return;
    this.tick += dt;
    if (this.tick < 0.035) return;
    const delta = Math.min(this.tick, 0.08);
    this.tick = 0;
    if (this.seeder.prepare(this.count)) this.clear();
    this.seeder.maxHeight = this.grid.maxDisplayHeight(this.heightScale);
    const seconds =
      delta * 34000 * Math.min(1, Math.max(0.002, altitude / 4000000));
    let minimum = Infinity,
      maximum = -Infinity,
      count = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      if (p.age > p.maxAge && !this.seedParticle(p, i)) continue;
      WGS84_ELLIPSOID.getCartographicToPosition(
        p.lat * RAD,
        p.lon * RAD,
        p.height,
        this.a,
      );
      if (!this.seeder.inCell(this.a, i)) {
        if (!this.seedParticle(p, i)) continue;
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
      this.birth[slot * 2] = this.birth[slot * 2 + 1] = this.clock;
      p.lon = nextLon;
      p.lat = nextLat;
      p.height = endHeight;
      p.age++;
    }
    this.cursor = (this.cursor + 1) % this.steps;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.birth.needsUpdate = true;
    this.lastHeights = count ? { min: minimum, max: maximum, count } : null;
  }
}
