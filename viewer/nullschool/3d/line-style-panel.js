import {
  LINE_STYLE_LAYERS,
  normalizeColor,
  dashPattern,
} from "./line-styles.js";

const CHECKBOX = {
  wind: "wind",
  height: "height-contours",
  pressure: "isobars",
  countries: "countries",
  provinces: "provinces",
  cities: "cities",
  rivers: "rivers",
};

export function mountLineStylePanel(store, onChange) {
  const $ = (id) => document.getElementById(id);
  const layer = $("line-style-layer"),
    color = $("line-style-color"),
    hex = $("line-style-hex"),
    width = $("line-style-width"),
    opacity = $("line-style-opacity"),
    pattern = $("line-style-pattern"),
    labels = $("line-style-labels"),
    size = $("line-style-label-size"),
    status = $("line-style-status");
  for (const [key, value] of Object.entries(LINE_STYLE_LAYERS)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = value.name;
    layer.append(option);
  }
  const scope = () => {
    const target = $(CHECKBOX[layer.value]);
    $("line-style-scope").textContent =
      target.checked && !target.disabled
        ? "调整后实时预览"
        : "图层当前未开启；开启后使用此样式";
  };
  const sync = () => {
    const key = layer.value,
      style = store.get(key),
      spec = LINE_STYLE_LAYERS[key];
    color.value = hex.value = style.color;
    hex.removeAttribute("aria-invalid");
    width.value = style.width;
    opacity.value = Math.round(style.opacity * 100);
    pattern.value = style.pattern;
    labels.checked = style.labels;
    size.value = style.fontSize;
    $("line-style-width-value").value = style.width.toFixed(1);
    $("line-style-opacity-value").value = Math.round(style.opacity * 100) + "%";
    $("line-style-label-value").value = style.fontSize + " px";
    $("line-style-label-options").hidden = !spec.labels;
    scope();
    const preview = $("line-style-preview-path");
    preview.setAttribute("stroke", style.color);
    preview.setAttribute("stroke-width", style.width);
    preview.setAttribute("stroke-opacity", style.opacity);
    preview.setAttribute(
      "stroke-dasharray",
      dashPattern(style.pattern, style.width, true).join(" "),
    );
    preview.setAttribute(
      "stroke-linecap",
      style.pattern === "dotted" ? "round" : "butt",
    );
  };
  const apply = (patch) => {
    const key = layer.value,
      style = store.set(key, patch);
    onChange(key, style);
    sync();
    status.textContent = store.saved
      ? "已保存到本浏览器"
      : "已应用；当前浏览器无法保存，刷新后将恢复默认";
  };
  layer.addEventListener("change", () => {
    sync();
    status.textContent = "";
  });
  color.addEventListener("input", () => apply({ color: color.value }));
  hex.addEventListener("input", () => {
    const value = normalizeColor(hex.value);
    if (value && hex.value.trim().length === 7) apply({ color: value });
  });
  hex.addEventListener("change", () => {
    const value = normalizeColor(hex.value);
    if (!value) {
      hex.setAttribute("aria-invalid", "true");
      status.textContent = "请输入有效颜色，例如 #FFD166";
    } else if (value !== store.get(layer.value).color) apply({ color: value });
  });
  width.addEventListener("input", () => apply({ width: Number(width.value) }));
  opacity.addEventListener("input", () =>
    apply({ opacity: Number(opacity.value) / 100 }),
  );
  pattern.addEventListener("change", () => apply({ pattern: pattern.value }));
  labels.addEventListener("change", () => apply({ labels: labels.checked }));
  size.addEventListener("input", () => apply({ fontSize: Number(size.value) }));
  $("line-style-reset").addEventListener("click", () => {
    const key = layer.value,
      style = store.reset(key);
    onChange(key, style);
    sync();
    status.textContent = store.saved
      ? "已恢复本层默认样式"
      : "本次已恢复默认，浏览器未能保存";
  });
  const requested = new URLSearchParams(location.search).get("styles");
  if (Object.hasOwn(LINE_STYLE_LAYERS, requested)) {
    layer.value = requested;
    $("menu").classList.remove("invisible");
    $("menu").setAttribute("aria-hidden", "false");
    $("show-menu").setAttribute("aria-expanded", "true");
    $("line-style-settings").open = true;
    requestAnimationFrame(() =>
      $("line-style-settings").scrollIntoView({ block: "start" }),
    );
  }
  sync();
  return { sync: scope };
}
