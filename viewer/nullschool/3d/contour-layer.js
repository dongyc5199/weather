import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import { geometricHeight } from "./weather.js";
import { StyledLineSegments } from "./styled-lines.js";

const RAD = Math.PI / 180;

export function contourHeight(value, ground, scale) {
  const base = geometricHeight(ground);
  return base + (geometricHeight(value) - base) * scale;
}

/** Upper contours are world-space lines; MSLP uses this class only for annotations. */
export class ContourLayer {
  constructor(
    scene,
    camera,
    {
      kind,
      color,
      opacity,
      width = 1,
      pattern = "solid",
      labels = true,
      font,
      fontSize,
      padding,
      background,
      getGround = () => 0,
    },
  ) {
    Object.assign(this, {
      camera,
      kind,
      color,
      opacity,
      font,
      fontSize,
      padding,
      background,
      getGround,
    });
    this.enabled = false;
    this.labelsVisible = labels;
    this.lineStyle = { color, opacity, width, pattern, fontSize, labels };
    this.heightScale = 1;
    this.result = null;
    this.group = new THREE.Group();
    this.group.name =
      kind === "height"
        ? "Geopotential height contours"
        : "Mean sea-level pressure labels";
    this.group.visible = false;
    scene.add(this.group);
    this.stroke = null;
    this.lineMaterial = null;
    this.line = null;
    this.candidates = [];
    this.labels = [];
    this.labelBoxes = [];
    this.materials = new Map();
    this.lastLabelUpdate = -Infinity;
    this.point = new THREE.Vector3();
    this.viewPoint = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.earth = WGS84_ELLIPSOID.clone();
    this.earth.radius.addScalar(-12000);
    this.ray = new THREE.Ray();
    this.hit = new THREE.Vector3();
  }
  clear() {
    this.result = null;
    this.group.visible = false;
    this.stroke?.dispose();
    this.stroke = null;
    this.line = null;
    this.clearLabels();
    this.candidates = [];
  }
  clearLabels() {
    for (const label of this.labels) label.removeFromParent();
    for (const { material } of this.materials.values()) {
      material.map.dispose();
      material.dispose();
    }
    this.labels = [];
    this.materials.clear();
    this.labelBoxes = [];
    this.lastLabelUpdate = -Infinity;
  }
  setLineStyle(style) {
    if (this.color !== style.color || this.fontSize !== style.fontSize)
      this.clearLabels();
    this.color = style.color;
    this.opacity = style.opacity;
    this.fontSize = style.fontSize;
    this.labelsVisible = style.labels;
    this.lineStyle = { ...style };
    this.stroke?.setStyle(style);
    for (const { material } of this.materials.values())
      material.opacity = style.opacity;
    this.lastLabelUpdate = -Infinity;
  }
  setData(result) {
    this.clear();
    this.result = result;
    // Long paths first, with multiple positions along each path for local views.
    const lines = [...result.contours].sort(
      (a, b) => b.points.length - a.points.length,
    );
    for (const contour of lines) {
      if (contour.points.length < 9) continue;
      for (let i = 3; i < contour.points.length; i += 9)
        this.candidates.push({ contour, offset: i });
    }
    if (this.kind === "height" && result.segmentCount > 0) {
      const positions = new Float32Array(result.segmentCount * 6);
      this.stroke = new StyledLineSegments(positions, this.lineStyle);
      this.line = this.stroke.object;
      this.lineMaterial = this.stroke.material;
      this.line.renderOrder = 30;
      this.line.frustumCulled = false;
      this.group.add(this.line);
      this.updateGeometry();
    }
    this.lastLabelUpdate = -Infinity;
  }
  position(contour, index, target, label = false) {
    const p = contour.points;
    let height =
      this.kind === "height"
        ? contourHeight(contour.value, p[index + 2], this.heightScale)
        : this.getGround(p[index], p[index + 1]);
    if (label) height += this.kind === "height" ? 30 : 150;
    this.lastPositionHeight = height;
    return WGS84_ELLIPSOID.getCartographicToPosition(
      p[index + 1] * RAD,
      p[index] * RAD,
      height,
      target,
    );
  }
  updateGeometry() {
    if (!this.line) return;
    const positions = this.stroke.positions;
    let offset = 0,
      heightSum = 0;
    const groups = [];
    for (const contour of this.result.contours) {
      const start = offset / 6;
      for (let i = 3; i < contour.points.length; i += 3) {
        this.position(contour, i - 3, this.point).toArray(positions, offset);
        heightSum += this.lastPositionHeight;
        this.position(contour, i, this.point).toArray(positions, offset + 3);
        heightSum += this.lastPositionHeight;
        offset += 6;
      }
      groups.push({ start, count: offset / 6 - start });
    }
    this.line.geometry.instanceCount = offset / 6;
    this.meanDisplayHeight = offset ? heightSum / (offset / 3) : 0;
    this.stroke.setGroups(groups);
    this.stroke.positionsChanged();
    this.lastLabelUpdate = -Infinity;
  }
  setHeightScale(value) {
    if (this.kind !== "height" || this.heightScale === value) return;
    this.heightScale = value;
    this.updateGeometry();
  }
  labelMaterial(value) {
    if (this.materials.has(value)) return this.materials.get(value);
    const text = `${Math.round(value)} ${this.kind === "height" ? "m" : "hPa"}`;
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d"),
      ratio = 2;
    const font = `500 ${this.fontSize * ratio}px ${this.font}`;
    ctx.font = font;
    canvas.width = Math.ceil(
      ctx.measureText(text).width + this.padding * ratio * 2,
    );
    canvas.height = (this.fontSize + this.padding * 2 + 2) * ratio;
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.color;
    ctx.fillText(text, this.padding * ratio, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      // Test the anchor's visibility below, keeping the complete label legible.
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: this.opacity,
    });
    const entry = {
      material,
      width: canvas.width / ratio,
      height: canvas.height / ratio,
    };
    this.materials.set(value, entry);
    return entry;
  }
  update(time, width, height, occupied = []) {
    this.group.visible = this.enabled && !!this.result && this.opacity > 0;
    if (!this.group.visible) return [];
    this.stroke?.updateViewport(this.camera, height, this.meanDisplayHeight);
    if (!this.labelsVisible) {
      for (const label of this.labels) label.visible = false;
      this.labelBoxes = [];
      return [];
    }
    if (time - this.lastLabelUpdate >= 200) {
      this.lastLabelUpdate = time;
      for (const label of this.labels) label.visible = false;
      const boxes = occupied.slice();
      const valuesUsed = new Map();
      let count = 0;
      this.ray.origin.copy(this.camera.position);
      for (const { contour, offset } of this.candidates) {
        if ((valuesUsed.get(contour.value) || 0) >= 2) continue;
        this.position(contour, offset, this.point, true);
        this.viewPoint.copy(this.point).project(this.camera);
        const p = this.viewPoint;
        if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 0.94 || Math.abs(p.y) > 0.91)
          continue;
        this.ray.direction
          .copy(this.point)
          .sub(this.camera.position)
          .normalize();
        WGS84_ELLIPSOID.getPositionToNormal(this.point, this.normal);
        if (Math.abs(this.normal.dot(this.ray.direction)) < 0.12) continue;
        const body = this.earth.intersectRay(this.ray, this.hit);
        if (
          body &&
          this.camera.position.distanceToSquared(body) + 1 <
            this.camera.position.distanceToSquared(this.point)
        )
          continue;
        const style = this.labelMaterial(contour.value);
        const x = ((p.x + 1) * width) / 2,
          y = ((1 - p.y) * height) / 2;
        const box = {
          left: x - style.width / 2 - 14,
          right: x + style.width / 2 + 14,
          top: y - style.height / 2 - 8,
          bottom: y + style.height / 2 + 8,
        };
        if (
          box.left < 8 ||
          box.top < 8 ||
          box.right > width - 8 ||
          box.bottom > height - 8
        )
          continue;
        if (
          boxes.some(
            (b) =>
              box.left < b.right &&
              box.right > b.left &&
              box.top < b.bottom &&
              box.bottom > b.top,
          )
        )
          continue;
        let sprite = this.labels[count];
        if (!sprite) {
          sprite = new THREE.Sprite(style.material);
          sprite.renderOrder = 35;
          this.labels.push(sprite);
          this.group.add(sprite);
        }
        sprite.material = style.material;
        sprite.position.copy(this.point);
        sprite.visible = true;
        sprite.userData.labelStyle = style;
        sprite.userData.contourValue = contour.value;
        boxes.push(box);
        valuesUsed.set(contour.value, (valuesUsed.get(contour.value) || 0) + 1);
        if (++count >= 24) break;
      }
      this.labelBoxes = boxes.slice(occupied.length);
    }
    for (const label of this.labels) {
      if (!label.visible) continue;
      const depth = -this.viewPoint
        .copy(label.position)
        .applyMatrix4(this.camera.matrixWorldInverse).z;
      const unit = (2 * depth * Math.tan((this.camera.fov * RAD) / 2)) / height;
      const style = label.userData.labelStyle;
      label.scale.set(style.width * unit, style.height * unit, 1);
    }
    return this.labelBoxes;
  }
  getState() {
    return {
      visible: this.group.visible,
      kind: this.kind,
      style: { ...this.lineStyle },
      layer: this.result?.layer || null,
      interval: this.result?.interval || null,
      paths: this.result?.contours.length || 0,
      segments: this.result?.segmentCount || 0,
      labels: this.labels
        .filter((label) => label.visible && this.group.visible)
        .map((label) => label.userData.contourValue),
    };
  }
}
