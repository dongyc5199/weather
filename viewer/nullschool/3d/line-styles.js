export const LINE_STYLE_KEY = "weather-earth.line-styles.v1";
export const LINE_STYLE_LAYERS = {
  wind: { name: "风线", prefix: "--earth-wind-", color: "--earth-wind-color" },
  height: {
    name: "位势高度线",
    prefix: "--earth-height-contour-",
    color: "--earth-height-contour-color",
    labels: true,
  },
  pressure: {
    name: "海平面等压线",
    prefix: "--earth-pressure-contour-",
    color: "--earth-pressure-contour-color",
    labels: true,
  },
  countries: {
    name: "国家边界",
    prefix: "--earth-country-line-",
    color: "--earth-country-line",
  },
  provinces: {
    name: "省级边界",
    prefix: "--earth-province-line-",
    color: "--earth-province-line",
  },
  cities: {
    name: "市级边界",
    prefix: "--earth-city-line-",
    color: "--earth-city-line",
  },
  rivers: {
    name: "河流与湖泊",
    prefix: "--earth-river-line-",
    color: "--earth-river-line",
  },
};
export const STYLE_LIMITS = {
  width: [0.5, 6],
  opacity: [0, 1],
  fontSize: [10, 20],
};
export const LINE_PATTERNS = ["solid", "dashed", "dotted"];
const fields = ["color", "width", "opacity", "pattern", "labels", "fontSize"];

export function normalizeColor(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text))
    return "#" + [...text.slice(1)].map((c) => c + c).join("");
  return null;
}

function variable(layer, field) {
  const spec = LINE_STYLE_LAYERS[layer];
  return field === "color"
    ? spec.color
    : spec.prefix +
        ({ labels: "labels-visible", fontSize: "label-size" }[field] || field);
}

export function sanitizeLineStyle(value, defaults) {
  const result = { ...defaults };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  result.color = normalizeColor(value.color) || defaults.color;
  if (LINE_PATTERNS.includes(value.pattern)) result.pattern = value.pattern;
  for (const [key, [min, max]] of Object.entries(STYLE_LIMITS)) {
    if (
      value[key] === "" ||
      value[key] === null ||
      typeof value[key] === "boolean"
    )
      continue;
    const number = Number(value[key]);
    if (Number.isFinite(number)) {
      const precision = key === "opacity" ? 100 : key === "width" ? 10 : 1;
      result[key] =
        Math.round(Math.max(min, Math.min(max, number)) * precision) /
        precision;
    }
  }
  if (typeof value.labels === "boolean") result.labels = value.labels;
  return result;
}

export function readLineStyleDefaults(read) {
  const result = {};
  for (const layer of Object.keys(LINE_STYLE_LAYERS)) {
    const raw = Object.fromEntries(
      fields.map((key) => [key, read(variable(layer, key)).trim()]),
    );
    raw.labels = raw.labels !== "0";
    result[layer] = sanitizeLineStyle(raw, {
      color: "#ffffff",
      width: 1,
      opacity: 1,
      pattern: "solid",
      labels: true,
      fontSize: 12,
    });
  }
  return result;
}

export class LineStyleStore {
  constructor({ defaults, rootStyle, storage }) {
    Object.assign(this, { defaults, rootStyle, storage });
    this.styles = structuredClone(defaults);
    this.saved = !!storage;
    try {
      const value = JSON.parse(storage?.getItem(LINE_STYLE_KEY) || "null");
      if (
        value?.version === 1 &&
        value.layers &&
        typeof value.layers === "object"
      )
        for (const layer of Object.keys(LINE_STYLE_LAYERS))
          this.styles[layer] = sanitizeLineStyle(
            value.layers[layer],
            defaults[layer],
          );
    } catch {
      this.saved = false;
    }
    for (const layer of Object.keys(LINE_STYLE_LAYERS)) this.syncRoot(layer);
  }
  get(layer) {
    if (!Object.hasOwn(LINE_STYLE_LAYERS, layer))
      throw new Error("Unknown line layer");
    return { ...this.styles[layer] };
  }
  all() {
    return structuredClone(this.styles);
  }
  syncRoot(layer) {
    for (const key of fields) {
      if (this.styles[layer][key] === this.defaults[layer][key])
        this.rootStyle.removeProperty(variable(layer, key));
      else
        this.rootStyle.setProperty(
          variable(layer, key),
          String(
            key === "labels"
              ? Number(this.styles[layer][key])
              : this.styles[layer][key],
          ),
        );
    }
  }
  save() {
    const layers = {};
    for (const layer of Object.keys(LINE_STYLE_LAYERS)) {
      const changed = Object.fromEntries(
        fields
          .filter(
            (key) => this.styles[layer][key] !== this.defaults[layer][key],
          )
          .map((key) => [key, this.styles[layer][key]]),
      );
      if (Object.keys(changed).length) layers[layer] = changed;
    }
    try {
      if (!this.storage) throw new Error("storage unavailable");
      if (Object.keys(layers).length)
        this.storage.setItem(
          LINE_STYLE_KEY,
          JSON.stringify({ version: 1, layers }),
        );
      else this.storage.removeItem(LINE_STYLE_KEY);
      this.saved = true;
    } catch {
      this.saved = false;
    }
    return this.saved;
  }
  set(layer, patch) {
    if (!Object.hasOwn(LINE_STYLE_LAYERS, layer))
      throw new Error("Unknown line layer");
    this.styles[layer] = sanitizeLineStyle(
      { ...this.styles[layer], ...patch },
      this.defaults[layer],
    );
    this.syncRoot(layer);
    this.save();
    return this.get(layer);
  }
  reset(layer) {
    if (!Object.hasOwn(LINE_STYLE_LAYERS, layer))
      throw new Error("Unknown line layer");
    this.styles[layer] = { ...this.defaults[layer] };
    this.syncRoot(layer);
    this.save();
    return this.get(layer);
  }
}

export function dashPattern(pattern, width, roundDots = false) {
  if (pattern === "dashed")
    return [Math.max(6, width * 4), Math.max(4, width * 2.5)];
  if (pattern === "dotted")
    return roundDots ? [0, width * 3] : [width, width * 2];
  return [];
}
