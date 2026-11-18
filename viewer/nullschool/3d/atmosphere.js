import { THREE, WGS84_ELLIPSOID } from "./vendor.js";

/** A thin optical limb at real atmospheric scale; no enlarged cloud geometry. */
export class AtmosphereLayer {
  constructor(theme) {
    this.scene = new THREE.Scene();
    this.screenCamera = new THREE.Camera();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        eye: { value: new THREE.Vector3() },
        fade: { value: 0 },
        lightDirection: { value: new THREE.Vector3() },
        ambient: {
          value: Number(theme("--earth-globe-light-ambient")) || 0.72,
        },
        directional: {
          value: Number(theme("--earth-globe-light-directional")) || 0.28,
        },
        atmosphereHeight: { value: Number(theme("--earth-atmosphere-height")) },
        strength: { value: Number(theme("--earth-atmosphere-opacity")) },
        atmosphereColor: {
          value: new THREE.Color(theme("--earth-atmosphere-color")),
        },
      },
      vertexShader:
        "varying vec2 screenUV;void main(){screenUV=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader: `
        uniform mat4 inverseProjection;uniform mat4 cameraWorld;uniform vec3 eye;
        uniform vec3 atmosphereColor;uniform float atmosphereHeight;uniform float strength;uniform float fade;
        varying vec2 screenUV;
        void main(){
          vec4 view=inverseProjection*vec4(screenUV*2.-1.,0.,1.);
          vec3 ray=normalize((cameraWorld*vec4(normalize(view.xyz),0.)).xyz);
          vec3 radii=vec3(6378137.,6378137.,6356752.314245);
          vec3 o=eye/radii,d=normalize(ray/radii);
          float b=dot(o,d);if(b>=0.)discard;
          float impact=sqrt(max(0.,dot(o,o)-b*b));
          float thickness=atmosphereHeight/6371000.;
          if(impact>1.+thickness)discard;
          float outside=(1.-smoothstep(1.,1.+thickness,impact))*smoothstep(.995,1.,impact);
          float inside=pow(smoothstep(.8,1.,impact),4.)*.12;
          float alpha=clamp((outside+inside)*strength*fade,0.,.5);
          gl_FragColor=vec4(atmosphereColor,alpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.surfaceScene = new THREE.Scene();
    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: this.material.uniforms,
      vertexShader: this.material.vertexShader,
      fragmentShader: `
        uniform mat4 inverseProjection;uniform mat4 cameraWorld;uniform vec3 eye;uniform vec3 lightDirection;
        uniform float fade;uniform float ambient;uniform float directional;varying vec2 screenUV;
        void main(){
          vec4 view=inverseProjection*vec4(screenUV*2.-1.,0.,1.);
          vec3 ray=normalize((cameraWorld*vec4(normalize(view.xyz),0.)).xyz);
          vec3 radii=vec3(6378137.,6378137.,6356752.314245);
          vec3 o=eye/radii,d=normalize(ray/radii);
          float b=dot(o,d),h=b*b-dot(o,o)+1.;if(b>=0. || h<0.)discard;
          vec3 p=o+d*(-b-sqrt(h));vec3 normal=normalize(p/radii);
          float diffuse=max(0.,dot(normal,lightDirection));
          float shade=ambient+directional*diffuse;
          gl_FragColor=vec4(vec3(mix(1.,shade,fade)),1.);
        }`,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.surfaceMesh = new THREE.Mesh(this.geometry, this.surfaceMaterial);
    this.surfaceMesh.frustumCulled = false;
    this.surfaceScene.add(this.surfaceMesh);
  }
  prepare(camera, enabled) {
    if (!enabled) return false;
    const altitude = WGS84_ELLIPSOID.getPositionElevation(camera.position);
    const t = Math.max(0, Math.min(1, (altitude - 150000) / 1000000));
    if (t === 0) return false;
    const u = this.material.uniforms;
    u.fade.value = t * t * (3 - 2 * t);
    u.inverseProjection.value.copy(camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(camera.matrixWorld);
    u.eye.value.copy(camera.position);
    u.lightDirection.value
      .copy(camera.position)
      .normalize()
      .addScaledVector(
        new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
        -1.5,
      )
      .addScaledVector(
        new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
        1.1,
      )
      .normalize();
    return true;
  }
  renderSurface(renderer, camera, enabled) {
    if (!this.prepare(camera, enabled)) return;
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.render(this.surfaceScene, this.screenCamera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }
  render(renderer, camera, enabled) {
    if (!this.prepare(camera, enabled)) return;
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.render(this.scene, this.screenCamera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.surfaceMaterial.dispose();
  }
}
