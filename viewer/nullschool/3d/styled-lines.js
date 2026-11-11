import {
  THREE,
  WGS84_ELLIPSOID,
  LineMaterial,
  LineSegments2,
  LineSegmentsGeometry,
} from "./vendor.js";
import { dashPattern } from "./line-styles.js";
import {
  WIND_STEP_SECONDS,
  WIND_TRAIL_MAX_PIXELS,
} from "./wind-presentation.js";

/** Instanced, screen-width strokes; native WebGL lines are commonly fixed at 1 px. */
export class StyledLineSegments {
  constructor(
    positions,
    style,
    {
      birth = null,
      intensity = null,
      segmentLengths = null,
      wind = false,
      caps = true,
      surfaceReference = false,
    } = {},
  ) {
    this.positions = positions;
    this.segmentLengths = segmentLengths;
    this.geometry = new LineSegmentsGeometry().setPositions(positions);
    if (!caps) this.geometry.setIndex([2, 4, 3, 4, 5, 3]);
    this.geometry.attributes.instanceStart.data.setUsage(
      THREE.DynamicDrawUsage,
    );
    this.distances = new Float32Array(positions.length / 3);
    const distances = new THREE.InstancedInterleavedBuffer(
      this.distances,
      2,
    ).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute(
      "instanceDistanceStart",
      new THREE.InterleavedBufferAttribute(distances, 1, 0),
    );
    this.geometry.setAttribute(
      "instanceDistanceEnd",
      new THREE.InterleavedBufferAttribute(distances, 1, 1),
    );
    this.material = new LineMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      worldUnits: false,
      alphaToCoverage: false,
    });
    this.material.uniforms.strokeDots = { value: 0 };
    this.material.uniforms.strokeDotRadius = { value: 1 };
    this.material.fragmentShader =
      "uniform float strokeDots; uniform float strokeDotRadius;\n" +
      this.material.fragmentShader.replace(
        "#include <logdepthbuf_fragment>",
        `#ifdef USE_DASH
        if (strokeDots > 0.5) {
          float along = (mod(vLineDistance + dashOffset, dashSize + gapSize) - dashSize * 0.5) / max(strokeDotRadius, 0.00001);
          if (vUv.x * vUv.x + along * along > 1.0) discard;
        }
      #endif
      #include <logdepthbuf_fragment>`,
      );
    if (birth) {
      const birthdays = new THREE.InstancedInterleavedBuffer(birth, 2).setUsage(
        THREE.DynamicDrawUsage,
      );
      this.geometry.setAttribute(
        "instanceBirth",
        new THREE.InterleavedBufferAttribute(birthdays, 1, 0),
      );
      this.material.uniforms.time = { value: 0 };
      this.material.uniforms.life = { value: 1 };
      this.material.vertexShader =
        "attribute float instanceBirth; varying float strokeBirth;\n" +
        this.material.vertexShader.replace(
          "void main() {",
          "void main() { strokeBirth = instanceBirth;",
        );
      this.material.fragmentShader =
        "uniform float time; uniform float life; varying float strokeBirth;\n" +
        (wind
          ? "uniform float windStep; uniform float windTrailPixels; varying float windSegmentPixels;\n"
          : "") +
        // Bound the visible tail in CSS pixels as well as seconds: fast winds
        // should not paint long white ribbons when the map is zoomed in.
        this.material.fragmentShader.replace(
          "float alpha = opacity;",
          wind
            ? `float age = max(0.0, time - strokeBirth);
               float duration = min(life, max(windStep, windTrailPixels * windStep / max(0.1, windSegmentPixels)));
               float progress = clamp(age / max(0.001, duration), 0.0, 1.0);
               float fade = pow(1.0 - progress, 1.6);
               float radius = mix(1.0, 0.45, progress);
               float edge = 1.0 - smoothstep(radius * 0.5, radius, abs(vUv.x));
               float alpha = opacity * fade * edge;
               if(alpha < 0.01) discard;`
            : "float fade = clamp(1.0 - (time - strokeBirth) / life, 0.0, 1.0); if (fade < 0.01) discard; float alpha = opacity * fade;",
        );
    }
    if (intensity) {
      this.geometry.setAttribute(
        "instanceIntensity",
        new THREE.InstancedBufferAttribute(intensity, 1).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
      this.material.vertexShader =
        "attribute float instanceIntensity; varying float strokeIntensity;\n" +
        this.material.vertexShader.replace(
          "void main() {",
          "void main() { strokeIntensity = instanceIntensity;",
        );
      this.material.fragmentShader =
        "varying float strokeIntensity;\n" +
        this.material.fragmentShader.replace(
          "gl_FragColor = vec4( diffuseColor.rgb, alpha );",
          "gl_FragColor = vec4( diffuseColor.rgb * strokeIntensity, alpha );",
        );
    }
    if (wind) {
      this.material.uniforms.windStep = { value: WIND_STEP_SECONDS };
      this.material.uniforms.windTrailPixels = { value: WIND_TRAIL_MAX_PIXELS };
      this.material.uniforms.windViewport = { value: new THREE.Vector2(1, 1) };
      this.material.uniforms.windOverview = { value: 0 };
      this.material.uniforms.windCameraPosition = {
        value: new THREE.Vector3(),
      };
      this.material.uniforms.windOccluder = {
        value: WGS84_ELLIPSOID.radius.clone().addScalar(-12000),
      };
      this.material.vertexShader =
        "varying vec3 windWorldPosition; uniform vec2 windViewport; varying float windSegmentPixels;\n" +
        this.material.vertexShader
          .replace(
            "void main() {",
            "void main() { windWorldPosition = (modelMatrix * vec4(position.y < 0.5 ? instanceStart : instanceEnd, 1.0)).xyz;",
          )
          .replace(
            "vec3 ndcEnd = clipEnd.xyz / clipEnd.w;",
            `vec3 ndcEnd = clipEnd.xyz / clipEnd.w;
           windSegmentPixels = length((ndcEnd.xy - ndcStart.xy) * windViewport * 0.5);`,
          );
      this.material.fragmentShader =
        "uniform float windOverview; uniform vec3 windCameraPosition; uniform vec3 windOccluder; varying vec3 windWorldPosition;\n" +
        this.material.fragmentShader.replace(
          "void main() {",
          `void main() {
          if (windOverview > 0.5) {
            vec3 o = windCameraPosition / windOccluder;
            vec3 d = (windWorldPosition - windCameraPosition) / windOccluder;
            float t = -dot(o, d) / max(dot(d, d), 1e-20);
            if (t > 0.0 && t < 1.0 && dot(o + t * d, o + t * d) < 1.0) discard;
          }`,
        );
    }
    if (surfaceReference) {
      this.material.depthTest = false;
      this.material.uniforms.referenceCamera = { value: new THREE.Vector3() };
      this.material.uniforms.referenceRadii = {
        value: WGS84_ELLIPSOID.radius.clone(),
      };
      this.material.vertexShader =
        "varying vec3 referencePosition;\n" +
        this.material.vertexShader.replace(
          "void main() {",
          "void main() { referencePosition = (modelMatrix * vec4(position.y < 0.5 ? instanceStart : instanceEnd, 1.0)).xyz;",
        );
      this.material.fragmentShader =
        "uniform vec3 referenceCamera; uniform vec3 referenceRadii; varying vec3 referencePosition;\n" +
        this.material.fragmentShader.replace(
          "void main() {",
          `void main() {
          vec3 unitPosition = normalize(referencePosition / referenceRadii);
          vec3 surfacePosition = unitPosition * referenceRadii;
          vec3 surfaceNormal = unitPosition / referenceRadii;
          if (dot(referenceCamera - surfacePosition, surfaceNormal) <= 0.0) discard;
        `,
        );
    }
    this.object = new LineSegments2(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.groups = [{ start: 0, count: positions.length / 6 }];
    this.cursor = 0;
    this.dirty = true;
    this.period = 1;
    this.ray = new THREE.Ray();
    this.shell = WGS84_ELLIPSOID.clone();
    this.hit = new THREE.Vector3();
    this.setStyle(style);
  }
  setStyle(style) {
    this.style = {
      color: "#ffffff",
      width: 1,
      opacity: 1,
      pattern: "solid",
      ...style,
    };
    this.material.color.set(this.style.color);
    this.material.opacity = this.style.opacity;
    this.material.linewidth = this.style.width;
    this.material.dashed = this.style.pattern !== "solid";
    this.material.uniforms.strokeDots.value = Number(
      this.style.pattern === "dotted",
    );
    this.dirty = true;
  }
  setGroups(groups) {
    this.groups = groups;
    this.dirty = true;
  }
  positionsChanged(cursor = 0, activeSegments = this.positions.length / 6) {
    this.cursor = cursor;
    const upload = (buffer, count) => {
      buffer.clearUpdateRanges();
      buffer.addUpdateRange(0, count);
      buffer.needsUpdate = true;
    };
    upload(this.geometry.attributes.instanceStart.data, activeSegments * 6);
    if (this.geometry.attributes.instanceBirth)
      upload(this.geometry.attributes.instanceBirth.data, activeSegments * 2);
    if (this.geometry.attributes.instanceIntensity)
      upload(this.geometry.attributes.instanceIntensity, activeSegments);
    this.dirty = true;
  }
  updateViewport(camera, height, surfaceHeight = 0) {
    this.material.uniforms.windCameraPosition?.value.copy(camera.position);
    this.material.uniforms.referenceCamera?.value.copy(camera.position);
    this.material.uniforms.windViewport?.value.set(
      height * camera.aspect,
      height,
    );
    if (!this.material.dashed) return;
    this.ray.origin.copy(camera.position);
    this.ray.direction.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.shell.radius.copy(WGS84_ELLIPSOID.radius).addScalar(surfaceHeight);
    const hit = this.shell.intersectRay(this.ray, this.hit);
    const elevation = WGS84_ELLIPSOID.getPositionElevation(camera.position);
    const depth = hit
      ? camera.position.distanceTo(hit)
      : Math.max(1000, Math.abs(elevation - surfaceHeight));
    const unit = Math.max(
      0.01,
      (2 * depth * Math.tan((camera.fov * Math.PI) / 360)) /
        Math.max(1, height),
    );
    const pattern = dashPattern(
      this.style.pattern,
      this.style.patternWidth ?? this.style.width,
    );
    const period = (pattern[0] + pattern[1]) * unit;
    if (Math.abs(period / this.period - 1) > 0.01) this.dirty = true;
    this.period = period;
    this.material.dashSize = pattern[0] * unit;
    this.material.gapSize = pattern[1] * unit;
    this.material.uniforms.strokeDotRadius.value =
      this.style.width * unit * 0.5;
    if (!this.dirty) return;
    // Bound the phase per segment instead of accumulating Float32 distances
    // around the entire globe, which loses small dashes at close zoom.
    for (const { start, count, ring = false } of this.groups) {
      let phase = 0;
      for (let k = 0; k < count; k++) {
        const segment = start + (ring ? (k + this.cursor) % count : k),
          i = segment * 6;
        const p = this.positions;
        const length = this.segmentLengths
          ? this.segmentLengths[segment]
          : Math.hypot(
              p[i + 3] - p[i],
              p[i + 4] - p[i + 1],
              p[i + 5] - p[i + 2],
            );
        this.distances[segment * 2] = phase;
        this.distances[segment * 2 + 1] = phase + length;
        phase = (phase + length) % period;
      }
    }
    this.geometry.attributes.instanceDistanceStart.data.needsUpdate = true;
    this.dirty = false;
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}
