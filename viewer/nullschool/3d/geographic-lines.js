import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { StyledLineSegments } from "./styled-lines.js";

const RAD = Math.PI / 180;
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function geographyPaths(value) {
  if (!value) return [];
  switch (value.type) {
    case "FeatureCollection":
      return value.features.flatMap(geographyPaths);
    case "Feature":
      return geographyPaths(value.geometry);
    case "GeometryCollection":
      return value.geometries.flatMap(geographyPaths);
    case "LineString":
      return [value.coordinates];
    case "MultiLineString":
    case "Polygon":
      return value.coordinates;
    case "MultiPolygon":
      return value.coordinates.flat();
    default:
      return [];
  }
}

/** Extract shared polygon topology before LOD simplification. */
export function administrativeBoundaries(
  data,
  { includeOuter = true, withinParent = false } = {},
) {
  const edges = new Map(),
    coordinates = new Map();
  const key = (p) =>
    `${Math.round(wrap(p[0]) * 1e6)},${Math.round(p[1] * 1e6)}`;
  for (const [owner, feature] of data.features.entries()) {
    const parent = Math.floor(Number(feature.properties?.adcode || 0) / 10000);
    for (const path of geographyPaths(feature))
      for (let i = 1; i < path.length; i++) {
        const a = key(path[i - 1]),
          b = key(path[i]);
        if (a === b) continue;
        const id = a < b ? `${a}:${b}` : `${b}:${a}`;
        coordinates.set(a, path[i - 1]);
        coordinates.set(b, path[i]);
        if (!edges.has(id))
          edges.set(id, { id, a, b, owners: new Set(), parents: new Set() });
        edges.get(id).owners.add(owner);
        edges.get(id).parents.add(parent);
      }
  }
  const adjacent = new Map();
  for (const edge of edges.values()) {
    const shared = edge.owners.size > 1;
    if (shared ? withinParent && edge.parents.size > 1 : !includeOuter)
      continue;
    for (const node of [edge.a, edge.b]) {
      if (!adjacent.has(node)) adjacent.set(node, []);
      adjacent.get(node).push(edge);
    }
  }
  const visited = new Set(),
    paths = [];
  function walk(start, first) {
    const path = [coordinates.get(start)];
    let node = start,
      edge = first;
    while (edge && !visited.has(edge.id)) {
      visited.add(edge.id);
      node = edge.a === node ? edge.b : edge.a;
      path.push(coordinates.get(node));
      const next = adjacent.get(node);
      edge =
        next.length === 2 ? next.find((item) => !visited.has(item.id)) : null;
    }
    if (path.length > 1) paths.push(path);
  }
  // Junctions are kept as endpoints so neighboring chains simplify together.
  for (const [node, list] of adjacent)
    if (list.length !== 2)
      for (const edge of list) if (!visited.has(edge.id)) walk(node, edge);
  for (const [node, list] of adjacent)
    for (const edge of list) if (!visited.has(edge.id)) walk(node, edge);
  return { type: "MultiLineString", coordinates: paths };
}

function simplify(points, tolerance) {
  if (!tolerance || points.length < 3) return points;
  const keep = new Uint8Array(points.length),
    stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [first, last] = stack.pop(),
      a = points[first],
      b = points[last];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length2 = dx * dx + dy * dy;
    let furthest = -1,
      distance2 = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const t = length2
        ? Math.max(
            0,
            Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2),
          )
        : 0;
      const d = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
      if (d > distance2) {
        distance2 = d;
        furthest = i;
      }
    }
    if (furthest >= 0) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Build fixed world-space reference lines, preserving gaps and date-line paths. */
export function geographicGeometry(data, { tolerance = 0, maxStep = 1 } = {}) {
  const values = [],
    segments = new Set(),
    groups = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3();
  const key = (p) =>
    `${Math.round(wrap(p[0]) * 1e6)},${Math.round(p[1] * 1e6)}`;
  function append(raw) {
    if (raw.length < 2) return;
    const points = simplify(raw, tolerance),
      start = values.length / 6;
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1],
        q = points[i],
        pKey = key(p),
        qKey = key(q);
      const segmentKey = pKey < qKey ? `${pKey}:${qKey}` : `${qKey}:${pKey}`;
      if (pKey === qKey || segments.has(segmentKey)) continue;
      segments.add(segmentKey);
      const delta = wrap(q[0] - p[0]);
      const span = Math.max(
        Math.abs(q[1] - p[1]),
        Math.abs(delta) * Math.max(0.05, Math.cos(((p[1] + q[1]) * RAD) / 2)),
      );
      const steps = Math.max(1, Math.ceil(span / maxStep));
      WGS84_ELLIPSOID.getCartographicToPosition(p[1] * RAD, p[0] * RAD, 0, a);
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        WGS84_ELLIPSOID.getCartographicToPosition(
          (p[1] + (q[1] - p[1]) * t) * RAD,
          (p[0] + delta * t) * RAD,
          0,
          b,
        );
        values.push(a.x, a.y, a.z, b.x, b.y, b.z);
        a.copy(b);
      }
    }
    if (values.length / 6 > start)
      groups.push({ start, count: values.length / 6 - start });
  }
  for (const path of geographyPaths(data)) {
    let part = [];
    for (const coordinate of path) {
      if (
        !Array.isArray(coordinate) ||
        !Number.isFinite(coordinate[0]) ||
        !Number.isFinite(coordinate[1]) ||
        Math.abs(coordinate[1]) > 90
      ) {
        append(part);
        part = [];
        continue;
      }
      const lon = part.length
        ? part.at(-1)[0] + wrap(coordinate[0] - part.at(-1)[0])
        : wrap(coordinate[0]);
      part.push([lon, coordinate[1]]);
    }
    append(part);
  }
  return {
    positions: new Float32Array(values),
    groups,
    segmentCount: values.length / 6,
  };
}

/** Foreground geographic annotations: unaffected by weather fill or tile loading. */
export class GeographicLineLayer {
  constructor(
    scene,
    camera,
    style,
    { name, order, haloColor, haloOpacity, haloWidth },
  ) {
    Object.assign(this, {
      camera,
      style,
      order,
      haloColor,
      haloOpacity,
      haloWidth,
    });
    this.enabled = false;
    this.source = null;
    this.levels = null;
    this.lod = "detail";
    this.group = new THREE.Group();
    this.group.name = name;
    this.group.visible = false;
    scene.add(this.group);
  }
  setEnabled(value) {
    this.enabled = Boolean(value);
    if (this.enabled && this.source && !this.levels) this.build();
    this.group.visible =
      this.enabled && !!this.levels && this.style.opacity > 0;
  }
  setData(data) {
    this.clear();
    this.source = data.detail ? data : { detail: data };
    if (this.enabled) this.build();
  }
  haloStyle() {
    return {
      ...this.style,
      color: this.haloColor,
      width: this.style.width + this.haloWidth,
      patternWidth: this.style.width,
      opacity: this.style.opacity * this.haloOpacity,
    };
  }
  build() {
    const detail = geographicGeometry(this.source.detail);
    const coarse = geographicGeometry(
      this.source.coarse || this.source.detail,
      {
        tolerance:
          this.source.coarseTolerance ?? (this.source.coarse ? 0 : 0.12),
        maxStep: 2,
      },
    );
    this.levels = {};
    for (const [key, geometry] of Object.entries({ detail, coarse })) {
      const group = new THREE.Group();
      const halo = new StyledLineSegments(
        geometry.positions,
        this.haloStyle(),
        { surfaceReference: true },
      );
      const line = new StyledLineSegments(geometry.positions, this.style, {
        surfaceReference: true,
      });
      halo.setGroups(geometry.groups);
      line.setGroups(geometry.groups);
      halo.object.renderOrder = this.order - 0.5;
      line.object.renderOrder = this.order;
      group.add(halo.object, line.object);
      this.group.add(group);
      this.levels[key] = { group, line, halo, segments: geometry.segmentCount };
    }
  }
  setLineStyle(style) {
    this.style = { ...style };
    for (const level of Object.values(this.levels || {})) {
      level.line.setStyle(this.style);
      level.halo.setStyle(this.haloStyle());
    }
  }
  update(moving, height) {
    this.group.visible =
      this.enabled && !!this.levels && this.style.opacity > 0;
    if (!this.group.visible) return;
    this.lod = moving ? "coarse" : "detail";
    for (const [key, level] of Object.entries(this.levels)) {
      level.group.visible = key === this.lod;
      if (level.group.visible) {
        level.line.updateViewport(this.camera, height);
        level.halo.updateViewport(this.camera, height);
      }
    }
  }
  clear() {
    for (const level of Object.values(this.levels || {})) {
      level.line.dispose();
      level.halo.dispose();
      level.group.removeFromParent();
    }
    this.levels = null;
    this.source = null;
    this.group.visible = false;
  }
  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
  getState() {
    return {
      visible: this.group.visible,
      ready: !!this.levels,
      lod: this.lod,
      segments: this.levels?.[this.lod]?.segments || 0,
      detailSegments: this.levels?.detail.segments || 0,
      coarseSegments: this.levels?.coarse.segments || 0,
    };
  }
}
