import { THREE } from "./vendor.js";

/** Capture the displayed ground once, preserving its depth for weather lines. */
export class WeatherCompositor {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = null;
    this.size = new THREE.Vector2();
    this.active = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.material = new THREE.ShaderMaterial({
      uniforms: { baseColor: { value: null }, baseDepth: { value: null } },
      vertexShader: `varying vec2 uvScreen; void main(){uvScreen=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: `uniform sampler2D baseColor; uniform sampler2D baseDepth; varying vec2 uvScreen;
        void main(){
          gl_FragColor=texture2D(baseColor,uvScreen);
          gl_FragDepth=texture2D(baseDepth,uvScreen).r;
          #include <colorspace_fragment>
        }`,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      toneMapped: false,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.quad = new THREE.Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }
  ensureTarget(destination) {
    const renderer = this.renderer;
    if (destination) this.size.set(destination.width, destination.height);
    else renderer.getDrawingBufferSize(this.size);
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
        depthBuffer: true,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      this.target.texture.colorSpace = THREE.SRGBColorSpace;
      this.target.depthTexture = new THREE.DepthTexture(
        this.size.x,
        this.size.y,
        THREE.UnsignedIntType,
      );
      this.target.depthTexture.minFilter = this.target.depthTexture.magFilter =
        THREE.NearestFilter;
      this.material.uniforms.baseColor.value = this.target.texture;
      this.material.uniforms.baseDepth.value = this.target.depthTexture;
    }
    // Retina already supplies sub-CSS-pixel samples. Avoid multiplying a full
    // Retina color/depth target by MSAA as well.
    const samples =
      renderer.getPixelRatio() > 1
        ? 0
        : Math.min(4, renderer.capabilities.maxSamples);
    if (this.target.samples !== samples) {
      this.target.samples = samples;
      this.target.dispose();
    }
    this.target.setSize(this.size.x, this.size.y);
  }
  render(groundScene, fillScene, weatherScene, camera, layers) {
    const renderer = this.renderer,
      destination = renderer.getRenderTarget(),
      autoClear = renderer.autoClear;
    this.active = layers.some((layer) => layer.mesh.visible);
    try {
      if (this.active) {
        this.ensureTarget(destination);
        renderer.setRenderTarget(this.target);
        renderer.autoClear = true;
        renderer.render(groundScene, camera);
        renderer.setRenderTarget(destination);
        renderer.render(this.scene, this.camera);
        for (const layer of layers)
          layer.setTerrainDepth(this.target.depthTexture, {
            far: camera.far,
            logarithmic: renderer.capabilities.logarithmicDepthBuffer,
          });
      } else {
        for (const layer of layers) layer.setTerrainDepth(null);
        renderer.autoClear = true;
        renderer.render(groundScene, camera);
      }
      // The depth copied above is only terrain/building depth. Fill never
      // writes into it, so contours retain their original height and occlusion.
      renderer.autoClear = false;
      if (this.active) renderer.render(fillScene, camera);
      renderer.render(weatherScene, camera);
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(destination);
    }
  }
  getState() {
    return {
      active: this.active,
      width: this.target?.width || 0,
      height: this.target?.height || 0,
      samples: this.target?.samples || 0,
    };
  }
  dispose() {
    this.target?.dispose();
    this.target = null;
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
