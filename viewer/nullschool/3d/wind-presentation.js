import { THREE, WGS84_ELLIPSOID } from "./vendor.js";

// The fill palette follows the bundled cambecc/earth implementation (MIT).
// Motion is calibrated separately against live Nullschool at matched map scales;
// the older height/60000 rule makes regional views move much too fast.
export const WIND_STEP_SECONDS = 0.04;
export const WIND_HISTORY_STEPS = 48;
export const WIND_TRAIL_MAX_PIXELS = 96;
export const WIND_VIEW_SETTLE_SECONDS = 0.18;
export const WIND_CAPACITY = 10000;
const R = 6371000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v) => {
  const t = clamp(v, 0, 1);
  return t * t * (3 - 2 * t);
};

export function windScreenBounds(camera, width, height, layerHeight = 0) {
  const radius = WGS84_ELLIPSOID.radius.x + Math.max(0, layerHeight);
  const center = new THREE.Vector3().applyMatrix4(camera.matrixWorldInverse);
  let box = [-1, -1, 1, 1];
  if (center.z >= radius)
    return { box: [0, 0, 0, 0], width: 0, height: 0, coverage: 0 };
  const denominator = center.z * center.z - radius * radius;
  if (center.z < -radius && denominator > 0) {
    const edges = (axis, scale, offset) => {
      const spread = radius * Math.sqrt(axis * axis + denominator);
      return [
        ((-axis * center.z - spread) / denominator) * scale - offset,
        ((-axis * center.z + spread) / denominator) * scale - offset,
      ];
    };
    const p = camera.projectionMatrix.elements;
    const x = edges(center.x, p[0], p[8]),
      y = edges(center.y, p[5], p[9]);
    box = [
      clamp(x[0], -1, 1),
      clamp(y[0], -1, 1),
      clamp(x[1], -1, 1),
      clamp(y[1], -1, 1),
    ];
  }
  const w = Math.max(0, ((box[2] - box[0]) * width) / 2),
    h = Math.max(0, ((box[3] - box[1]) * height) / 2);
  if (!w || !h) return { box, width: 0, height: 0, coverage: 0 };
  // Estimate how much of the clipped rectangle is globe rather than sky.
  const sphere = new THREE.Sphere(new THREE.Vector3(), radius),
    raycaster = new THREE.Raycaster(),
    hit = new THREE.Vector3();
  let covered = 0;
  for (let j = 0; j < 12; j++)
    for (let i = 0; i < 12; i++) {
      raycaster.setFromCamera(
        new THREE.Vector2(
          box[0] + ((i + 0.5) / 12) * (box[2] - box[0]),
          box[1] + ((j + 0.5) / 12) * (box[3] - box[1]),
        ),
        camera,
      );
      if (raycaster.ray.intersectSphere(sphere, hit)) covered++;
    }
  // Equivalent orthographic scale at the viewing ray, in CSS pixels/radian.
  // Keep the un-clipped angular scale: bounds.width stops changing once zooming
  // in fills the screen, but the projection's magnification keeps increasing.
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const shell = WGS84_ELLIPSOID.clone();
  shell.radius.addScalar(Math.max(0, layerHeight));
  const centerHit = shell.intersectRay(raycaster.ray, hit);
  const depth = centerHit
    ? raycaster.ray.origin.distanceTo(centerHit)
    : Math.max(
        1,
        Math.abs(
          WGS84_ELLIPSOID.getPositionElevation(camera.position) - layerHeight,
        ),
      );
  const projectionScale =
    (R * height * camera.projectionMatrix.elements[5]) / (2 * depth);
  return { box, width: w, height: h, coverage: covered / 144, projectionScale };
}

export function windMotionScale(projectionScale) {
  const scale = clamp(projectionScale, 100, 1e8);
  const angularStep = (Math.log(scale) / Math.log(100)) ** 5 / scale;
  return (((R * Math.PI) / 180) * angularStep) / WIND_STEP_SECONDS;
}

export function windPresentation(
  bounds,
  viewport,
  altitude,
  capacity = WIND_CAPACITY,
) {
  const overview = smooth(
    Math.log(Math.max(1, altitude) / 200000) / Math.log(10),
  );
  const mobile = viewport.mobile ? 0.75 : 1;
  const nearCount = clamp((1700 * viewport.width) / 1200, 900, 2800) * mobile;
  const overviewCount = Math.sqrt(bounds.width * bounds.height) * 8 * mobile;
  const count = bounds.width
    ? Math.min(
        capacity,
        Math.ceil(
          (nearCount * (1 - overview) + overviewCount * overview) / 128,
        ) * 128,
      )
    : 0;
  const nearTimeScale = 34000 * clamp(altitude / 4000000, 0.002, 1);
  const overviewTimeScale = windMotionScale(
    bounds.projectionScale ?? Math.max(100, bounds.height / 2),
  );
  return {
    count,
    blend: overview,
    trailSeconds: 0.65 + 1.15 * overview,
    timeScale: clamp(
      nearTimeScale * (1 - overview) + overviewTimeScale * overview,
      1,
      100000,
    ),
    bounds,
    expectedVisible: count,
  };
}

export function windIntensity(speed) {
  const grey = (85 + Math.round(clamp(speed / 15, 0, 1) * 170)) / 255;
  return grey <= 0.04045 ? grey / 12.92 : ((grey + 0.055) / 1.055) ** 2.4;
}

export function windSpeedColor(speed) {
  const x = clamp(speed / 100, 0, 1),
    boundary = 0.45;
  const sinebow = (hue) => {
    const angle = hue * Math.PI * 1.25,
      s = Math.sin(angle),
      c = Math.cos(angle);
    return [
      Math.floor(Math.max(0, -c) * 255),
      Math.floor(Math.max(s, 0) * 255),
      Math.floor(Math.max(c, 0, -s) * 255),
    ];
  };
  if (x <= boundary) return sinebow(x / boundary);
  const base = sinebow(1),
    t = (x - boundary) / (1 - boundary);
  return base.map((value) => Math.floor(value + (255 - value) * t));
}

export const WIND_SPEED_PALETTE = {
  unit: "m/s",
  stops: Array.from({ length: 256 }, (_, i) => (i * 100) / 255),
  colors: Array.from({ length: 256 }, (_, i) =>
    windSpeedColor((i * 100) / 255),
  ),
};
