import { GeoJSONOverlay } from "./vendor.js";
import { dashPattern } from "./line-styles.js";

/** Add canvas dash styles to the pinned GeoJSON renderer without modifying its data. */
export class StyledGeoJSONOverlay extends GeoJSONOverlay {
  constructor(options, style = null) {
    super(options);
    this.linePattern = "solid";
    this.redrawTimer = null;
    const renderer = this.imageSource._canvasRenderer;
    const setStyle = renderer.setStyle.bind(renderer);
    renderer.setStyle = (style) => {
      setStyle(style);
      const ctx = renderer._ctx;
      ctx.setLineDash(
        dashPattern(this.linePattern, this.strokeWidth, true).map(
          (value) => value * renderer._invScale,
        ),
      );
      ctx.lineCap = this.linePattern === "dotted" ? "round" : "butt";
      ctx.lineJoin = "round";
    };
    if (style) this.setLineStyle(style);
  }
  setLineStyle(style) {
    const redraw =
      this.strokeStyle !== style.color ||
      this.strokeWidth !== style.width ||
      this.linePattern !== style.pattern;
    this.strokeStyle = style.color;
    this.strokeWidth = style.width;
    this.linePattern = style.pattern;
    this.opacity = style.opacity;
    if (redraw) {
      clearTimeout(this.redrawTimer);
      this.redrawTimer = setTimeout(() => {
        this.redrawTimer = null;
        if (this.isReady) this.redraw();
      }, 120);
    }
  }
}
