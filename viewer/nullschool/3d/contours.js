const GRID_KEYS = [
  "nx",
  "ny",
  "dx",
  "dy",
  "lo1",
  "la1",
  "refTime",
  "forecastTime",
];

export function scalarAt(record, lon, lat) {
  const h = record.header,
    values = record.data;
  const x = ((((lon - h.lo1) % 360) + 360) % 360) / h.dx,
    y = (h.la1 - lat) / h.dy;
  if (y < 0 || y > h.ny - 1) return NaN;
  const i = Math.floor(x),
    j = Math.min(Math.floor(y), h.ny - 2),
    fx = x - i,
    fy = y - j;
  const indices = [
    j * h.nx + i,
    j * h.nx + ((i + 1) % h.nx),
    (j + 1) * h.nx + i,
    (j + 1) * h.nx + ((i + 1) % h.nx),
  ];
  if (indices.some((id) => !Number.isFinite(values[id]))) return NaN;
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  return indices.reduce((sum, id, k) => sum + values[id] * weights[k], 0);
}

function checkGrid(reference, record) {
  if (
    !record ||
    GRID_KEYS.some((key) => record.header[key] !== reference[key]) ||
    record.data.length !== reference.nx * reference.ny
  )
    throw new Error("等值线数据的网格或预报时次不一致");
}

export function heightContourInterval(level) {
  const pressure = Number.parseFloat(level);
  return pressure >= 700
    ? 30
    : pressure >= 400
      ? 60
      : pressure >= 100
        ? 120
        : pressure >= 30
          ? 240
          : 480;
}

export function heightContourInput(profile, reference) {
  if (
    reference.layer === "surface" ||
    profile.layer !== reference.layer ||
    profile.height?.header.layer !== reference.layer
  )
    throw new Error("位势高度线需要当前等压层的高度");
  for (const record of [
    profile.height,
    profile.orography,
    profile.surface_pressure,
  ])
    checkGrid(reference, record);
  if (
    !["gpm", "m"].includes(profile.height.header.parameterUnit) ||
    profile.surface_pressure.header.parameterUnit !== "Pa"
  )
    throw new Error("位势高度或地面气压单位不匹配");
  const values = Float64Array.from(profile.height.data, (v) =>
    Number.isFinite(v) ? v : NaN,
  );
  const ground = Float64Array.from(profile.orography.data, (v) =>
    Number.isFinite(v) ? v : NaN,
  );
  const pressure =
    reference.pressureLevelHpa ?? Number.parseFloat(reference.layer);
  const mask = Uint8Array.from(
    values,
    (v, i) =>
      Number.isFinite(v) &&
      Number.isFinite(ground[i]) &&
      Number.isFinite(profile.surface_pressure.data[i]) &&
      v > ground[i] &&
      pressure * 100 <= profile.surface_pressure.data[i],
  );
  return {
    header: reference,
    values,
    ground,
    mask,
    kind: "height",
    layer: reference.layer,
    interval: heightContourInterval(reference.layer),
    wrapX: true,
  };
}

export function pressureContourInput(payload, reference, snapshot) {
  if (payload.snapshot !== snapshot || payload.reference !== "mean sea level")
    throw new Error("海平面气压的预报快照不一致");
  const record = payload.pressure;
  checkGrid(reference, record);
  const h = record.header;
  if (
    h.layer !== "mean_sea_level" ||
    h.levelType !== "meanSea" ||
    h.parameterUnit !== "Pa" ||
    h.parameterCategory !== 3 ||
    h.parameterNumber !== 1
  )
    throw new Error("等压线必须使用 PRMSL 海平面订正气压");
  const values = Float64Array.from(record.data, (v) =>
    Number.isFinite(v) ? v / 100 : NaN,
  );
  return {
    header: h,
    values,
    mask: Uint8Array.from(values, Number.isFinite),
    ground: null,
    interval: 4,
    kind: "pressure",
    layer: "mean_sea_level",
    wrapX: true,
  };
}

const CASES = {
  1: [[0, 3]],
  2: [[0, 1]],
  3: [[1, 3]],
  4: [[1, 2]],
  6: [[0, 2]],
  7: [[2, 3]],
  8: [[2, 3]],
  9: [[0, 2]],
  11: [[1, 2]],
  12: [[1, 3]],
  13: [[0, 1]],
  14: [[0, 3]],
};

/** March on original scalar values, join shared grid edges, and retain masked gaps. */
export function marchContours(input) {
  const {
    header: h,
    values,
    ground,
    mask,
    interval,
    kind,
    layer,
    wrapX = true,
  } = input;
  if (!(interval > 0) || h.nx < 2 || h.ny < 2 || values.length !== h.nx * h.ny)
    throw new Error("等值线网格或线距无效");
  const levels = new Map();
  let segmentCount = 0,
    validCells = 0;
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ];
  for (let j = 0; j < h.ny - 1; j++) {
    for (let i = 0; i < h.nx - (wrapX ? 0 : 1); i++) {
      const next = (i + 1) % h.nx;
      const ids = [
        j * h.nx + i,
        j * h.nx + next,
        (j + 1) * h.nx + next,
        (j + 1) * h.nx + i,
      ];
      if (ids.some((id) => !Number.isFinite(values[id]) || (mask && !mask[id])))
        continue;
      validCells++;
      const v = ids.map((id) => values[id]),
        min = Math.min(...v),
        max = Math.max(...v);
      if (max === min) continue;
      const corners = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      for (let n = Math.ceil(min / interval); n * interval <= max; n++) {
        const value = n * interval;
        const code = v.reduce(
          (sum, entry, index) => sum | (entry >= value ? 1 << index : 0),
          0,
        );
        if (code === 0 || code === 15) continue;
        const q =
          (v[0] - value) * (v[2] - value) - (v[1] - value) * (v[3] - value);
        const pairs =
          code === 5 || code === 10
            ? q >= 0
              ? [
                  [0, 1],
                  [2, 3],
                ]
              : [
                  [0, 3],
                  [1, 2],
                ]
            : CASES[code];
        let group = levels.get(value);
        if (!group)
          levels.set(
            value,
            (group = { nodes: new Map(), segments: [], edgeKeys: new Set() }),
          );
        const pointOnEdge = (edge) => {
          const [a, b] = edges[edge],
            t = (value - v[a]) / (v[b] - v[a]);
          const [ax, ay] = corners[a],
            [bx, by] = corners[b];
          const vertex = t < 1e-10 ? a : t > 1 - 1e-10 ? b : null;
          const key =
            vertex !== null
              ? `p:${corners[vertex][1]}:${corners[vertex][0] % h.nx}`
              : edge === 0
                ? `h:${j}:${i}`
                : edge === 2
                  ? `h:${j + 1}:${i}`
                  : edge === 1
                    ? `v:${j}:${next}`
                    : `v:${j}:${i}`;
          if (!group.nodes.has(key))
            group.nodes.set(key, {
              point: [
                h.lo1 + (ax + (bx - ax) * t) * h.dx,
                h.la1 - (ay + (by - ay) * t) * h.dy,
                ground ? ground[ids[a]] * (1 - t) + ground[ids[b]] * t : 0,
              ],
              edges: [],
            });
          return key;
        };
        for (const [a, b] of pairs) {
          const first = pointOnEdge(a),
            second = pointOnEdge(b);
          if (first === second) continue;
          const key =
            first < second ? first + "|" + second : second + "|" + first;
          if (group.edgeKeys.has(key)) continue;
          group.edgeKeys.add(key);
          const id = group.segments.length;
          group.segments.push([first, second]);
          group.nodes.get(first).edges.push(id);
          group.nodes.get(second).edges.push(id);
          if (++segmentCount > 1000000)
            throw new Error("等值线过密，已停止生成");
        }
      }
    }
  }
  const contours = [];
  for (const [value, group] of levels) {
    const used = new Uint8Array(group.segments.length);
    const walk = (start, edge) => {
      const points = [],
        first = start;
      let closed = false,
        previousLon = null;
      const append = (key) => {
        const p = group.nodes.get(key).point;
        const lon =
          previousLon === null
            ? p[0]
            : p[0] + Math.round((previousLon - p[0]) / 360) * 360;
        points.push(lon, p[1], p[2]);
        previousLon = lon;
      };
      append(start);
      while (!used[edge]) {
        used[edge] = 1;
        const ends = group.segments[edge],
          next = ends[0] === start ? ends[1] : ends[0];
        append(next);
        if (next === first) {
          closed = true;
          break;
        }
        const node = group.nodes.get(next);
        if (node.edges.length !== 2) break;
        const remaining = node.edges.find((id) => !used[id]);
        if (remaining === undefined) break;
        start = next;
        edge = remaining;
      }
      if (points.length >= 6)
        contours.push({ value, points: new Float64Array(points), closed });
    };
    for (const [key, node] of group.nodes)
      if (node.edges.length !== 2)
        for (const edge of node.edges) if (!used[edge]) walk(key, edge);
    group.segments.forEach((ends, edge) => {
      if (!used[edge]) walk(ends[0], edge);
    });
  }
  return { contours, interval, kind, layer, segmentCount, validCells };
}

export function contoursGeoJSON(result) {
  const features = [];
  const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
  for (const contour of result.contours) {
    let line = [];
    const add = () => {
      if (line.length > 1)
        features.push({
          type: "Feature",
          properties: { value: contour.value, unit: "hPa" },
          geometry: { type: "LineString", coordinates: line },
        });
      line = [];
    };
    for (let i = 0; i < contour.points.length; i += 3) {
      const point = [wrap(contour.points[i]), contour.points[i + 1]],
        previous = line.at(-1);
      if (previous && Math.abs(point[0] - previous[0]) > 180) {
        const bound = previous[0] > 0 ? 180 : -180;
        const adjusted = point[0] + (bound === 180 ? 360 : -360);
        const t = (bound - previous[0]) / (adjusted - previous[0]);
        const lat = previous[1] + (point[1] - previous[1]) * t;
        line.push([bound, lat]);
        add();
        line.push([-bound, lat]);
      }
      line.push(point);
    }
    add();
  }
  return { type: "FeatureCollection", features };
}

export class ContourTask {
  constructor(
    factory = () =>
      new Worker(new URL("./contour-worker.js", import.meta.url), {
        type: "module",
      }),
  ) {
    this.factory = factory;
    this.worker = null;
    this.finish = null;
  }
  cancel() {
    this.worker?.terminate();
    this.worker = null;
    this.finish?.(null);
    this.finish = null;
  }
  run(input) {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = this.factory();
      this.worker = worker;
      this.finish = resolve;
      const finish = (result, error) => {
        if (this.worker !== worker) return;
        worker.terminate();
        this.worker = this.finish = null;
        if (error) reject(new Error(error));
        else resolve(result);
      };
      worker.onmessage = ({ data }) => finish(data.result, data.error);
      worker.onerror = (event) =>
        finish(null, event.message || "等值线计算失败");
      const transfers = [
        input.values.buffer,
        input.mask?.buffer,
        input.ground?.buffer,
      ].filter(Boolean);
      try {
        worker.postMessage(input, transfers);
      } catch (error) {
        finish(null, error.message);
      }
    });
  }
}
