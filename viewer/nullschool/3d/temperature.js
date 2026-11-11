import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { geometricHeight } from "./weather.js";

const RAD = Math.PI / 180;
const GRID_KEYS = [
  "nx",
  "ny",
  "lo1",
  "la1",
  "dx",
  "dy",
  "refTime",
  "forecastTime",
];

export function temperatureDisplayHeight(
  layer,
  ground,
  height,
  scale = 1,
  surfaceOffset = 2,
) {
  return layer === "surface"
    ? ground + surfaceOffset
    : ground + (height - ground) * scale;
}

/** One forecast, one pressure surface. RGBA stores the scalar (or U component),
 * ground/HGT in gpm and validity. Wind keeps V separately for vector interpolation. */
export function temperatureField(
  record,
  profile,
  { kind = "temperature", vector = null } = {},
) {
  const header = record.header,
    layer = header.layer || "surface";
  if (
    profile.layer !== layer ||
    (layer !== "surface" && profile.height?.header.layer !== layer)
  )
    throw new Error("气温与高度的气压层不一致");
  const records = [
    record,
    profile.orography,
    profile.surface_pressure,
    ...(layer === "surface" ? [] : [profile.height]),
    ...(vector ? [vector] : []),
  ];
  if (
    header.nx < 2 ||
    header.ny < 2 ||
    Math.abs(header.nx * header.dx - 360) > 1e-5
  )
    throw new Error("气温层需要完整的全球经纬度网格");
  if (
    records.some(
      (item) =>
        !item ||
        item.data.length !== header.nx * header.ny ||
        GRID_KEYS.some((key) => item.header[key] !== header[key]),
    )
  )
    throw new Error("气温与高度的网格或时次不一致");
  const pressure = header.pressureLevelHpa ?? Number.parseFloat(layer);
  const data = new Float32Array(header.nx * header.ny * 4);
  let valid = 0,
    belowGroundNodes = 0;
  for (let i = 0; i < record.data.length; i++) {
    const t = record.data[i],
      ground = profile.orography.data[i],
      p = profile.surface_pressure.data[i],
      height = layer === "surface" ? ground : profile.height.data[i];
    if (
      ![t, ground, p, height, ...(vector ? [vector.data[i]] : [])].every(
        Number.isFinite,
      )
    )
      continue;
    if (layer !== "surface" && (pressure * 100 > p || height <= ground))
      belowGroundNodes++;
    data.set([t, ground, height, 1], i * 4);
    valid++;
  }
  return {
    header,
    layer,
    data,
    valid,
    belowGroundNodes,
    kind,
    surfaceOffset: kind === "wind" ? 10 : 2,
    vector: vector
      ? Float32Array.from(vector.data, (value) =>
          Number.isFinite(value) ? value : 0,
        )
      : null,
  };
}

export function windSpeedField(wind, profile) {
  if (
    wind[0]?.header.parameterCategory !== 2 ||
    wind[0]?.header.parameterNumber !== 2 ||
    wind[1]?.header.parameterCategory !== 2 ||
    wind[1]?.header.parameterNumber !== 3 ||
    wind[0].header.layer !== wind[1].header.layer
  )
    throw new Error("风速填色需要匹配的 U/V 分量");
  return temperatureField(wind[0], profile, { kind: "wind", vector: wind[1] });
}

export function sampleTemperature(
  field,
  lon,
  lat,
  scale = 1,
  { native = false, terrainHeight } = {},
) {
  const { header: h, data } = field;
  const x = ((((lon - h.lo1) % 360) + 360) % 360) / h.dx;
  const y = (h.la1 - lat) / h.dy;
  if (y < 0 || y > h.ny - 1) return null;
  const i = Math.floor(x) % h.nx,
    j = Math.min(Math.floor(y), h.ny - 2);
  const fx = x - Math.floor(x),
    fy = y - j;
  const indices = [
    j * h.nx + i,
    j * h.nx + ((i + 1) % h.nx),
    (j + 1) * h.nx + i,
    (j + 1) * h.nx + ((i + 1) % h.nx),
  ];
  if (indices.some((index) => data[index * 4 + 3] < 0.5)) return null;
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const values = [0, 1, 2].map((channel) =>
    indices.reduce(
      (sum, index, k) => sum + data[index * 4 + channel] * weights[k],
      0,
    ),
  );
  const ground = geometricHeight(values[1]),
    height = geometricHeight(values[2]);
  const value = field.vector
    ? Math.hypot(
        values[0],
        indices.reduce(
          (sum, index, k) => sum + field.vector[index] * weights[k],
          0,
        ),
      )
    : values[0];
  const layerHeight = temperatureDisplayHeight(
    field.layer,
    ground,
    height,
    scale,
    field.surfaceOffset,
  );
  const floor = native
    ? -Infinity
    : Number.isFinite(terrainHeight)
      ? terrainHeight
      : ground;
  return {
    value,
    temperature: field.kind === "wind" ? undefined : value - 273.15,
    speed: field.kind === "wind" ? value : undefined,
    ground,
    geopotential: values[2],
    layerHeight,
    height: Math.max(layerHeight, floor),
    clampedToGround: floor > layerHeight,
  };
}

export function temperatureHeightRange(field, scale) {
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < field.data.length; i += 4) {
    if (!field.data[i + 3]) continue;
    const value = Math.max(
      geometricHeight(field.data[i + 1]),
      temperatureDisplayHeight(
        field.layer,
        geometricHeight(field.data[i + 1]),
        geometricHeight(field.data[i + 2]),
        scale,
        field.surfaceOffset,
      ),
    );
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return field.valid ? { min, max } : null;
}

export function intersectTemperature(
  field,
  ray,
  scale,
  maxHeight,
  options = {},
) {
  const shell = WGS84_ELLIPSOID.clone(),
    point = new THREE.Vector3(),
    carto = {};
  let height = maxHeight + 100,
    sample;
  for (let i = 0; i < 6; i++) {
    shell.radius.copy(WGS84_ELLIPSOID.radius).addScalar(height);
    if (!shell.intersectRay(ray, point)) return null;
    WGS84_ELLIPSOID.getPositionToCartographic(point, carto);
    sample = sampleTemperature(
      field,
      carto.lon / RAD,
      carto.lat / RAD,
      scale,
      options,
    );
    if (!sample) return null;
    const change = Math.abs(sample.height - height);
    height = sample.height;
    if (change < 0.25) break;
  }
  WGS84_ELLIPSOID.getCartographicToPosition(
    carto.lat,
    carto.lon,
    height,
    point,
  );
  shell.radius.copy(WGS84_ELLIPSOID.radius).addScalar(-12000);
  const occluder = shell.intersectRay(ray, new THREE.Vector3());
  if (
    occluder &&
    ray.origin.distanceTo(occluder) + 1 < ray.origin.distanceTo(point)
  )
    return null;
  return {
    ...carto,
    height,
    point,
    distance: ray.origin.distanceTo(point),
    temperature: sample.temperature,
    speed: sample.speed,
  };
}

const fragmentShader = `
uniform sampler2D fieldMap;
uniform sampler2D vectorMap;
uniform sampler2D paletteMap;
uniform vec2 gridSize;
uniform vec4 gridLayout;
uniform vec3 radii;
uniform vec3 rayOrigin;
uniform mat4 cameraFrame;
uniform mat4 inverseProjection;
uniform mat4 weatherProjection;
uniform vec2 paletteRange;
uniform float maxHeight;
uniform float heightScale;
uniform float surfaceLayer;
uniform float surfaceOffset;
uniform float vectorField;
uniform float layerOpacity;
uniform sampler2D terrainDepthMap;
uniform float terrainAvailable;
uniform float terrainFar;
uniform float terrainLogarithmic;
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
uniform float logDepthBufFC;
#endif
varying vec2 screenUV;

float rayDistance(vec3 origin, vec3 direction, float height) {
  vec3 r = radii + height;
  vec3 o = origin / r, d = direction / r;
  float a = dot(d, d), b = dot(o, d), c = dot(o, o) - 1.0;
  float discriminant = b * b - a * c;
  if (discriminant < 0.0) return -1.0;
  float q = -b - (b < 0.0 ? -1.0 : 1.0) * sqrt(discriminant);
  if (abs(q) < 1e-20) return -1.0;
  float t0 = q / a, t1 = c / q;
  float nearT = min(t0, t1), farT = max(t0, t1);
  return nearT > 0.0 ? nearT : farT > 0.0 ? farT : -1.0;
}
vec2 cartographic(vec3 p) {
  float a = radii.x, b = radii.z, xy = length(p.xy);
  float e2 = 1.0 - b * b / (a * a), ep2 = a * a / (b * b) - 1.0;
  float theta = atan(p.z * a, xy * b);
  float s = sin(theta), c = cos(theta);
  return vec2(atan(p.y, p.x), atan(p.z + ep2 * b * s * s * s, xy - e2 * a * c * c * c));
}
vec4 gridValue(vec2 cell) {
  return texture2D(fieldMap, (cell + 0.5) / gridSize);
}
vec4 sampleField(vec2 lonLat) {
  vec2 degrees = lonLat * (180.0 / 3.141592653589793);
  float x = mod(degrees.x - gridLayout.x + 360.0, 360.0) / gridLayout.z;
  float y = (gridLayout.y - degrees.y) / gridLayout.w;
  if (y < 0.0 || y > gridSize.y - 1.0) return vec4(0.0);
  float i = floor(x), j = min(floor(y), gridSize.y - 2.0);
  vec2 f = vec2(fract(x), y - j);
  vec4 a = gridValue(vec2(i, j)), b = gridValue(vec2(mod(i + 1.0, gridSize.x), j));
  vec4 c = gridValue(vec2(i, j + 1.0)), d = gridValue(vec2(mod(i + 1.0, gridSize.x), j + 1.0));
  if (min(min(a.a, b.a), min(c.a, d.a)) < 0.5) return vec4(0.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float geometric(float value) { return 6371000.0 * value / (6371000.0 - value); }
float sampleVector(vec2 lonLat) {
  vec2 degrees = lonLat * (180.0 / 3.141592653589793);
  float x = mod(degrees.x - gridLayout.x + 360.0, 360.0) / gridLayout.z;
  float y = clamp((gridLayout.y - degrees.y) / gridLayout.w, 0.0, gridSize.y - 1.0);
  float i = floor(x), j = min(floor(y), gridSize.y - 2.0);
  vec2 f = vec2(fract(x), y - j);
  float a = texture2D(vectorMap, (vec2(i,j)+0.5)/gridSize).r;
  float b = texture2D(vectorMap, (vec2(mod(i+1.0,gridSize.x),j)+0.5)/gridSize).r;
  float c = texture2D(vectorMap, (vec2(i,j+1.0)+0.5)/gridSize).r;
  float d = texture2D(vectorMap, (vec2(mod(i+1.0,gridSize.x),j+1.0)+0.5)/gridSize).r;
  return mix(mix(a,b,f.x), mix(c,d,f.x),f.y);
}
float displayHeight(vec4 value) {
  float ground = geometric(value.g);
  return surfaceLayer > 0.5 ? ground + surfaceOffset : ground + (geometric(value.b) - ground) * heightScale;
}
float positionHeight(vec3 p, vec2 lonLat) {
  float e2 = 1.0 - radii.z * radii.z / (radii.x * radii.x);
  float s = sin(lonLat.y), c = cos(lonLat.y);
  // Projection onto the geodetic normal stays stable near both poles.
  return length(p.xy) * c + p.z * s - radii.x * sqrt(1.0 - e2 * s * s);
}
bool layerIntersection(vec3 direction, out float distance, out vec4 value, out vec2 lonLat) {
  distance = rayDistance(rayOrigin, direction, maxHeight + 100.0);
  if (distance < 0.0) return false;
  for (int i = 0; i < 6; i++) {
    value = sampleField(cartographic(rayOrigin + direction * distance));
    if (value.a < 0.5) return false;
    float height = displayHeight(value);
    if (terrainAvailable < 0.5) height = max(height, geometric(value.g));
    float nextDistance = rayDistance(rayOrigin, direction, height);
    if (nextDistance < 0.0) return false;
    float change = abs(nextDistance - distance);
    distance = nextDistance;
    if (change < 0.25) break;
  }
  lonLat = cartographic(rayOrigin + direction * distance);
  value = sampleField(lonLat);
  if (value.a < 0.5) return false;
  float groundDistance = rayDistance(rayOrigin, direction, -12000.0);
  return !(groundDistance > 0.0 && groundDistance + 1.0 < distance);
}
void main() {
  vec4 view = inverseProjection * vec4(screenUV * 2.0 - 1.0, 0.0, 1.0);
  vec3 viewDirection = normalize(view.xyz);
  vec3 direction = normalize((cameraFrame * vec4(viewDirection, 0.0)).xyz);
  float distance;
  vec4 value;
  vec2 lonLat;
  bool valid = layerIntersection(direction,distance,value,lonLat);
  bool clamped = false;
  float groundDepth = 1.0;
  if (terrainAvailable > 0.5) {
    groundDepth = texture2D(terrainDepthMap,screenUV).r;
    if (groundDepth < 1.0) {
      float groundDistance;
      if (terrainLogarithmic > 0.5) {
        float viewZ = exp2(groundDepth * log2(terrainFar + 1.0)) - 1.0;
        groundDistance = viewZ / max(0.000001,-viewDirection.z);
      } else {
        vec4 groundView = inverseProjection * vec4(screenUV * 2.0 - 1.0,groundDepth * 2.0 - 1.0,1.0);
        groundDistance = length(groundView.xyz / groundView.w);
      }
      if (!valid || groundDistance <= distance + 1.0) {
      vec3 groundPoint = rayOrigin + direction * groundDistance;
      vec2 groundLonLat = cartographic(groundPoint);
      vec4 groundValue = sampleField(groundLonLat);
      float innerDistance = rayDistance(rayOrigin,direction,-12000.0);
      bool front = innerDistance < 0.0 || groundDistance <= innerDistance + 1.0;
      if (front && groundValue.a > 0.5 && positionHeight(groundPoint,groundLonLat) >= displayHeight(groundValue) - 1.0
          && (!valid || groundDistance <= distance + 1.0)) {
        distance = groundDistance;value = groundValue;lonLat = groundLonLat;
        valid = true;clamped = true;
      } else if (valid && groundDistance < distance - 1.0) {
        // A nearby building/low surface blocks a distant upper layer. It must
        // occlude the color even though it is too low to receive draped color.
        valid = false;
      }
      }
    }
  }
  if (!valid) discard;
  vec4 clip = weatherProjection * vec4(viewDirection * distance, 1.0);
  if (clip.w <= 0.0 || (!clamped && (clip.z < -clip.w || clip.z > clip.w))) discard;
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    gl_FragDepth = log2(1.0 + clip.w) * logDepthBufFC * 0.5;
  #else
    gl_FragDepth = 0.5 * (clip.z / clip.w) + 0.5;
  #endif
  if (clamped) gl_FragDepth = groundDepth;
  // Interpolate the vector first, just like the classic wind renderer; never
  // interpolate magnitudes across opposing winds.
  float scalar = vectorField > 0.5 ? length(vec2(value.r, sampleVector(lonLat))) : value.r;
  float colorIndex = clamp((scalar - paletteRange.x) / (paletteRange.y - paletteRange.x), 0.0, 1.0);
  vec3 color = texture2D(paletteMap, vec2((colorIndex * 255.0 + 0.5) / 256.0, 0.5)).rgb;
  gl_FragColor = vec4(color, layerOpacity);
  #include <colorspace_fragment>
}`;

/** Render the height field at each viewing ray, with its real scene depth.
 * This avoids globe-sized triangle chords sinking a 2 m surface under the ocean. */
export class TemperatureLayer {
  constructor(scene, camera, { kind = "temperature" } = {}) {
    this.camera = camera;
    this.kind = kind;
    this.enabled = false;
    this.opacity = 0.4;
    this.heightScale = 1;
    this.field = null;
    this.range = null;
    this.uniforms = {
      fieldMap: { value: null },
      vectorMap: { value: null },
      paletteMap: { value: null },
      gridSize: { value: new THREE.Vector2() },
      gridLayout: { value: new THREE.Vector4() },
      radii: { value: WGS84_ELLIPSOID.radius.clone() },
      rayOrigin: { value: new THREE.Vector3() },
      cameraFrame: { value: new THREE.Matrix4() },
      inverseProjection: { value: new THREE.Matrix4() },
      weatherProjection: { value: new THREE.Matrix4() },
      paletteRange: { value: new THREE.Vector2() },
      maxHeight: { value: 0 },
      heightScale: { value: 1 },
      surfaceLayer: { value: 0 },
      surfaceOffset: { value: kind === "wind" ? 10 : 2 },
      vectorField: { value: Number(kind === "wind") },
      layerOpacity: { value: 0.4 },
      terrainDepthMap: { value: null },
      terrainAvailable: { value: 0 },
      terrainFar: { value: 1 },
      terrainLogarithmic: { value: 0 },
    };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      fragmentShader,
      vertexShader: `varying vec2 screenUV; void main(){screenUV=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name =
      kind === "wind"
        ? "GFS wind-speed pressure surface"
        : "GFS temperature pressure surface";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  setPalette(palette) {
    if (this.palette === palette) return;
    const data = new Uint8Array(256 * 4),
      min = palette.stops[0],
      max = palette.stops.at(-1);
    let segment = 0;
    for (let i = 0; i < 256; i++) {
      const value = min + ((max - min) * i) / 255;
      while (
        segment < palette.stops.length - 2 &&
        value > palette.stops[segment + 1]
      )
        segment++;
      const t =
        (value - palette.stops[segment]) /
        (palette.stops[segment + 1] - palette.stops[segment]);
      for (let channel = 0; channel < 3; channel++)
        data[i * 4 + channel] = Math.round(
          palette.colors[segment][channel] * (1 - t) +
            palette.colors[segment + 1][channel] * t,
        );
      data[i * 4 + 3] = 255;
    }
    this.uniforms.paletteMap.value?.dispose();
    const texture = new THREE.DataTexture(data, 256, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.uniforms.paletteMap.value = texture;
    this.uniforms.paletteRange.value.set(min, max);
    this.palette = palette;
  }
  clear() {
    this.mesh.visible = false;
    this.uniforms.fieldMap.value?.dispose();
    this.uniforms.vectorMap.value?.dispose();
    this.uniforms.fieldMap.value = null;
    this.uniforms.vectorMap.value = null;
    this.field = this.range = null;
  }
  setData(record, profile) {
    this.clear();
    const field =
        this.kind === "wind"
          ? windSpeedField(record, profile)
          : temperatureField(record, profile),
      h = field.header;
    const texture = new THREE.DataTexture(
      field.data,
      h.nx,
      h.ny,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.needsUpdate = true;
    this.uniforms.fieldMap.value = texture;
    if (field.vector) {
      const vector = new THREE.DataTexture(
        field.vector,
        h.nx,
        h.ny,
        THREE.RedFormat,
        THREE.FloatType,
      );
      vector.needsUpdate = true;
      this.uniforms.vectorMap.value = vector;
    }
    this.uniforms.gridSize.value.set(h.nx, h.ny);
    this.uniforms.gridLayout.value.set(h.lo1, h.la1, h.dx, h.dy);
    this.uniforms.surfaceLayer.value = Number(field.layer === "surface");
    this.field = field;
    this.updateRange();
  }
  updateRange() {
    this.range =
      this.field && temperatureHeightRange(this.field, this.heightScale);
    this.uniforms.maxHeight.value = this.range?.max || 0;
    this.uniforms.heightScale.value = this.heightScale;
  }
  setHeightScale(value) {
    const scale = Math.max(1, Math.min(20, Number(value) || 1));
    if (this.heightScale === scale) return;
    this.heightScale = scale;
    this.updateRange();
  }
  update() {
    this.mesh.visible =
      this.enabled && this.opacity > 0 && !!this.range && !!this.palette;
    if (!this.mesh.visible) return;
    this.uniforms.layerOpacity.value = this.opacity;
    this.uniforms.rayOrigin.value.setFromMatrixPosition(
      this.camera.matrixWorld,
    );
    this.uniforms.cameraFrame.value.copy(this.camera.matrixWorld);
    this.uniforms.inverseProjection.value.copy(
      this.camera.projectionMatrixInverse,
    );
    this.uniforms.weatherProjection.value.copy(this.camera.projectionMatrix);
  }
  setTerrainDepth(texture, { far = 1, logarithmic = false } = {}) {
    this.uniforms.terrainDepthMap.value = texture;
    this.uniforms.terrainAvailable.value = Number(!!texture);
    this.uniforms.terrainFar.value = far;
    this.uniforms.terrainLogarithmic.value = Number(logarithmic);
    this.material.depthTest = !texture;
  }
  pick(ray, terrainPoint = null) {
    if (!this.mesh.visible) return null;
    const native = !!this.uniforms.terrainAvailable.value;
    const elevated = intersectTemperature(
      this.field,
      ray,
      this.heightScale,
      this.range.max,
      { native },
    );
    if (terrainPoint) {
      const carto = WGS84_ELLIPSOID.getPositionToCartographic(terrainPoint, {});
      const terrainHeight = WGS84_ELLIPSOID.getPositionElevation(terrainPoint);
      const sample = this.sample(
        carto.lon / RAD,
        carto.lat / RAD,
        terrainHeight,
      );
      const distance = ray.origin.distanceTo(terrainPoint);
      if (
        sample &&
        terrainHeight >= sample.layerHeight - 1 &&
        (!elevated || distance <= elevated.distance + 1)
      )
        return {
          ...carto,
          height: terrainHeight,
          terrainHeight,
          clampedToGround: true,
          point: terrainPoint.clone(),
          distance,
          temperature: sample.temperature,
          speed: sample.speed,
        };
      if (elevated && distance < elevated.distance - 1) return null;
    }
    return elevated;
  }
  sample(lon, lat, terrainHeight) {
    return this.field
      ? sampleTemperature(this.field, lon, lat, this.heightScale, {
          terrainHeight,
          native:
            terrainHeight === undefined &&
            !!this.uniforms.terrainAvailable.value,
        })
      : null;
  }
  dispose() {
    this.clear();
    this.uniforms.paletteMap.value?.dispose();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
  getState() {
    return {
      visible: this.mesh.visible,
      kind: this.kind,
      layer: this.field?.layer || null,
      heightScale: this.heightScale,
      heights: this.range,
      validNodes: this.field?.valid || 0,
      belowGroundNodes: this.field?.belowGroundNodes || 0,
      terrainDraping: !!this.uniforms.terrainAvailable.value,
      source: this.field
        ? this.kind === "wind"
          ? "NOAA GFS U/V/HGT/PRES"
          : "NOAA GFS TMP/HGT/PRES"
        : null,
    };
  }
}
