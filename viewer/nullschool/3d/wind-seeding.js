import { THREE, WGS84_ELLIPSOID } from "./vendor.js";

const RAD = Math.PI / 180;

/** Seed on the visible wind surface, rather than a longitude/latitude box. */
export class WindViewportSeeder {
  constructor(camera, heightAt) {
    this.camera = camera;
    this.heightAt = heightAt;
    this.maxHeight = 0;
    this.shell = WGS84_ELLIPSOID.clone();
    this.occluder = WGS84_ELLIPSOID.radius.clone().addScalar(-12000);
    this.raycaster = new THREE.Raycaster();
    this.origin = new THREE.Vector3();
    this.hit = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.screen = new THREE.Vector3();
    this.ndc = new THREE.Vector2();
    this.carto = {};
    this.cells = [];
    this.aspect = 0;
    this.count = 0;
  }

  prepare(count) {
    this.origin.setFromMatrixPosition(this.camera.matrixWorld);
    if (this.count === count && this.aspect === this.camera.aspect)
      return false;
    this.aspect = this.camera.aspect;
    this.count = count;
    // Every row spans the full width, including when count is not divisible by rows.
    const rows = Math.max(1, Math.round(Math.sqrt(count / this.aspect)));
    this.cells = Array.from({ length: count }, (_, i) => {
      const row = Math.floor((i * rows) / count);
      const first = Math.ceil((row * count) / rows);
      const columns = Math.ceil(((row + 1) * count) / rows) - first;
      const x = -1 + (2 * (i - first)) / columns;
      const y = -1 + (2 * row) / rows;
      return { x, y, width: 2 / columns, height: 2 / rows };
    });
    return true;
  }

  occluded(point) {
    // Segment-to-ellipsoid test. Reject the far side if the camera is inside a
    // very highly exaggerated wind shell. Match the persistent base globe.
    const r = this.occluder,
      o = this.origin;
    const ox = o.x / r.x,
      oy = o.y / r.y,
      oz = o.z / r.z;
    const dx = (point.x - o.x) / r.x,
      dy = (point.y - o.y) / r.y,
      dz = (point.z - o.z) / r.z;
    const t = -(ox * dx + oy * dy + oz * dz) / (dx * dx + dy * dy + dz * dz);
    return (
      t > 0 &&
      t < 1 &&
      (ox + t * dx) ** 2 + (oy + t * dy) ** 2 + (oz + t * dz) ** 2 < 1
    );
  }

  atScreen(x, y) {
    this.raycaster.setFromCamera(this.ndc.set(x, y), this.camera);
    let height = this.maxHeight;
    // Follow the sampled HGT surface. The final position always uses the actual
    // field value; the offset ellipsoid is only an intersection search aid.
    for (let iteration = 0; iteration < 6; iteration++) {
      this.shell.radius.copy(WGS84_ELLIPSOID.radius).addScalar(height);
      if (!this.shell.intersectRay(this.raycaster.ray, this.hit)) return null;
      WGS84_ELLIPSOID.getPositionToCartographic(this.hit, this.carto);
      const nextHeight = this.heightAt(
        this.carto.lon / RAD,
        this.carto.lat / RAD,
      );
      if (!Number.isFinite(nextHeight)) return null;
      const difference = Math.abs(nextHeight - height);
      height = nextHeight;
      if (difference < 0.5) break;
    }
    WGS84_ELLIPSOID.getCartographicToPosition(
      this.carto.lat,
      this.carto.lon,
      height,
      this.position,
    );
    this.screen.copy(this.position).project(this.camera);
    if (this.screen.z < -1 || this.screen.z > 1 || this.occluded(this.position))
      return null;
    // Near a tangent or a discontinuity in the height mask, reject an unstable
    // solution instead of moving its seed into a different screen region.
    if (Math.hypot(this.screen.x - x, this.screen.y - y) > 0.012) return null;
    return { lon: this.carto.lon / RAD, lat: this.carto.lat / RAD, height };
  }

  seed(index, random = Math.random) {
    const cell = this.cells[index];
    for (let attempt = 0; attempt < 3; attempt++) {
      const seed = this.atScreen(
        cell.x + random() * cell.width,
        cell.y + random() * cell.height,
      );
      if (seed) return seed;
    }
    return null;
  }

  inCell(point, index, margin = 2) {
    this.screen.copy(point).project(this.camera);
    const c = this.cells[index],
      p = this.screen;
    return (
      p.z >= -1 &&
      p.z <= 1 &&
      Math.abs(p.x) <= 1.04 &&
      Math.abs(p.y) <= 1.04 &&
      p.x >= c.x - margin * c.width &&
      p.x <= c.x + (1 + margin) * c.width &&
      p.y >= c.y - margin * c.height &&
      p.y <= c.y + (1 + margin) * c.height &&
      !this.occluded(point)
    );
  }
}
