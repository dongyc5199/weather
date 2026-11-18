import { THREE, WGS84_ELLIPSOID } from "./vendor.js";
import {
  cloudBandTexture,
  cloudViewDetail,
  cloudRenderPlan,
  CLOUD_VIEW_LIMITS,
} from "./cloud-data.js";

import { cloudMaterialGLSL, cloudTurbulenceTexture } from "./cloud-material.js";
import { CLOUD_PRESSURES } from "./cloud-wind-data.js";

const MOTION_FRAME_MS = 150;
const FLOW_CYCLE_SECONDS = 90;
const EARTH_RADIUS = 6371000;
const REGION_BANDS = 64;
function latitudeBand(z) {
  return Math.max(0, Math.min(REGION_BANDS - 1, Math.floor((z + 1) * REGION_BANDS / 2)));
}

const vertex = `
  varying vec2 screenUV;
  void main() {screenUV=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}
`;
// Lossless snapshot of the exact depth samples used by the cloud rays.
// RGBA8 works without a floating-point render-target extension.
const depthPacking = `
  vec4 packCloudDepth(float z) {
    uint b=floatBitsToUint(z);
    return vec4(uvec4(b,b>>8,b>>16,b>>24)&uvec4(255u))/255.;
  }
  float unpackCloudDepth(vec4 px) {
    uvec4 b=uvec4(round(px*255.));
    return uintBitsToFloat(b.x|(b.y<<8)|(b.z<<16)|(b.w<<24));
  }`;
const fragment = `
  uniform sampler2D convectiveField;
  uniform vec2 convectiveGridSize;
  uniform float convectiveMix;
  uniform vec4 fieldLayout;
  uniform bool hasColumnField;
  uniform int coreCount;
  uniform vec4 coreBounds[32];
  uniform vec4 coreSpheres[32];
  uniform sampler2D reference;
  uniform sampler2D terrainDepth, previousDepth;
  uniform bool depthCorrection;
  ${depthPacking}
  uniform bool hasReference;
  uniform float observationMix;
  uniform bool hasTerrain;
  uniform bool logarithmic;
  uniform float cameraFar;
  uniform float cameraNear;
  uniform float volumeBlend;
  uniform float overviewBlend;
  uniform float stepBudget;
  uniform mat4 inverseProjection;
  uniform mat4 cameraWorld;
  uniform vec3 eye;
  uniform vec3 lightDirection;
  varying vec2 screenUV;
  const float R=6371000.;
  const vec3 RADII=vec3(6378137.,6378137.,6356752.314245);
  float hash(vec3 p) {
    p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z);
  }
  ${cloudMaterialGLSL}
  vec2 sphere(vec3 origin,vec3 direction,float radius) {
    float b=dot(origin,direction),c=dot(origin,origin)-radius*radius;
    float d=b*b-c;if(d<0.) return vec2(1.,-1.);
    float root=sqrt(d); return vec2(-b-root,-b+root);
  }
  bool forwardHit(vec2 interval) {
    // A miss is (1,-1), not a point one Earth radius away in the sky.
    return interval.y>interval.x && interval.x>0.;
  }
  vec2 geographicUV(vec3 p) {
    return vec2(atan(p.y,p.x)/6.28318530718,.5-atan(p.z*RADII.x,length(p.xy)*RADII.z)/3.14159265359);
  }
  vec4 columnAt(vec3 p) {
    vec2 geo=geographicUV(p);
    float longitude=geo.x*360.,latitude=90.-geo.y*180.;
    float x=mod(longitude-fieldLayout.x+360.,360.)/fieldLayout.z;
    float y=(fieldLayout.y-latitude)/fieldLayout.w;
    if(y<0. || y>convectiveGridSize.y-1.)return vec4(0.);
    if(convectiveGridSize.x*fieldLayout.z<359.99 && x>convectiveGridSize.x-1.)return vec4(0.);
    vec4 cell=texture2D(convectiveField,(vec2(x,y)+.5)/convectiveGridSize);
    if(cell.a<.015)return vec4(0.);
    // Normalize interpolated valid weights so missing neighbours cannot lower cloud heights.
    return vec4(cell.r/cell.a,cell.g/cell.a*25000.,cell.b/cell.a*25000.,cell.a);
  }
  float localDensity(vec3 p,vec4 column,vec4 observation,vec3 velocity) {
    float altitude=(length(p)-1.)*R;
    if(!hasColumnField || column.a<.015 || observation.a<.95 || observation.r<.01 ||
       altitude<=column.g || altitude>=column.b)return 0.;
    float thickness=column.b-column.g, f=(altitude-column.g)/max(1.,thickness);
    float rough=cloudDetail(p,velocity);
    // The coarse shell is supplied by the data. Erode its margins in 3D, so
    // thin veils and deep columns have a continuous surface and distinct bases.
    float deep=smoothstep(1200.,7000.,thickness);
    float floorFraction=clamp(.035-.05*rough,0.,.10);
    float lid=clamp(.84+.07*observation.r+mix(.10,.29,deep)*rough,.54,1.);
    float lower=smoothstep(floorFraction,floorFraction+.09,f);
    float upper=1.-smoothstep(lid-mix(.10,.19,deep),lid,f);
    float threshold=mix(.62,.08,smoothstep(.2,.8,f));
    float footprint=smoothstep(threshold-.10,threshold+.10,observation.r+.17*rough);
    float moisture=clamp(.68+.65*rough+.22*column.r,.06,1.2);
    return lower*upper*footprint*moisture*sqrt(clamp(column.r,0.,1.))*
      smoothstep(.015,.55,column.a)*observation.r*smoothstep(.02,.15,observation.r)*convectiveMix;
  }
  float density(vec3 p,vec3 velocity) {
    vec2 geo=geographicUV(p);
    vec4 observation=hasReference?texture2D(reference,vec2(fract(geo.x+.5),geo.y)):vec4(1.);
    return localDensity(p,columnAt(p),observation,velocity);
  }
  vec4 observedCover(vec3 origin,vec3 direction,out float valid,out float cloudDistance) {
    valid=0.;cloudDistance=1e20;
    // Distant imagery is a 2D geographic projection, independent of coarse cloud-height grids.
    vec2 hit=sphere(origin,direction,1.);
    if(!forwardHit(hit))return vec4(0.);
    vec3 p=origin+direction*hit.x;
    if(hasColumnField){
      // Once cloud heights arrive, align the 2D representation with the same top field.
      // A ground decal and an elevated volume cannot blend coherently during zoom.
      for(int i=0;i<2;i++){
        vec4 column=columnAt(p);
        if(column.a<.015)break;
        vec2 lifted=sphere(origin,direction,1.+column.b*convectiveMix/R);
        if(!forwardHit(lifted))return vec4(0.);
        hit=lifted;p=origin+direction*hit.x;
      }
    }
    cloudDistance=hit.x;
    vec2 geoPoint=geographicUV(p);
    vec4 observed=texture2D(reference,vec2(fract(geoPoint.x+.5),geoPoint.y));
    valid=observed.a;
    float alpha=(1.-exp(-observed.r*2.6))*smoothstep(.15,.55,abs(dot(normalize(p),direction)));
    float diffuse=max(0.,dot(normalize(p),normalize(lightDirection/RADII)));
    float brightness=.74+.24*diffuse;
    // Soft self-shadow inferred from observed optical structure, not procedural cloud shapes.
    vec2 geo=geographicUV(p),uv=vec2(fract(geo.x+.5),geo.y);
    float adjacent=texture2D(reference,uv+vec2(-1.5/4096.,-1./2048.)).r;
    brightness*=1.-max(0.,adjacent-observed.r)*.25;
    return vec4(vec3(brightness)*alpha,alpha);
  }
  float terrainLimit(float z,float scale,float viewZ){
    if(z>=.999999)return 1e20;
    float depth=logarithmic?exp2(z*log2(cameraFar+1.))-1.:
      cameraNear*cameraFar/(cameraFar-z*(cameraFar-cameraNear));
    return depth/max(.0001,-viewZ)*scale;
  }
  void main() {
    // A mid-clip point avoids far-plane w rounding to zero at large far/near ratios.
    vec4 view=inverseProjection*vec4(screenUV*2.-1.,0.,1.);
    vec3 viewRay=normalize(view.xyz);
    vec3 worldRay=normalize((cameraWorld*vec4(viewRay,0.)).xyz);
    vec3 origin=eye/RADII;
    float rayScale=length(worldRay/RADII);
    vec3 direction=normalize(worldRay/RADII);
    vec2 shell=sphere(origin,direction,1.+25000./R);
    float start=max(0.,shell.x),end=shell.y;
    if(end<=start){gl_FragColor=vec4(0.);return;}
    vec2 surface=sphere(origin,direction,1.);
    if(forwardHit(surface)) end=min(end,surface.x);
    float limit=1e20,oldLimit=1e20;
    if(hasTerrain){
      float z=texture2D(terrainDepth,screenUV).r;
      limit=terrainLimit(z,rayScale,viewRay.z);
      if(depthCorrection){
        float oldZ=unpackCloudDepth(texture2D(previousDepth,screenUV));
        if(z==oldZ)discard;
        oldLimit=terrainLimit(oldZ,rayScale,viewRay.z);
      }
    }
    if(end<=start){gl_FragColor=vec4(0.);return;}
    float sourceDistance=1e20,sourceValid=0.;
    vec4 overview=hasReference && overviewBlend>.001?observedCover(origin,direction,sourceValid,sourceDistance):vec4(0.);
    // Satellite imagery is an orbital projection, never paint on nearby sea/terrain.
    overview*=sourceValid*observationMix*overviewBlend;
    bool overviewChanged=overview.a>0. && ((sourceDistance<=limit)!=(sourceDistance<=oldLimit));
    if(sourceDistance>limit)overview=vec4(0.);
    if(volumeBlend<=.001 || coreCount==0 || !hasColumnField){gl_FragColor=overview;return;}
    // Representation blending is camera based; a core radius must not become a visible mask.
    float rayBlend=volumeBlend;
    // Only march ray segments intersecting a conservative bound around real cores.
    vec2 occupied=vec2(1e20,-1e20);
    for(int i=0;i<32;i++){
      if(i>=coreCount)break;
      vec2 hit=sphere(origin-coreSpheres[i].xyz,direction,coreSpheres[i].w);
      if(hit.y<=max(0.,hit.x))continue;
      vec2 top=sphere(origin,direction,1.+coreBounds[i].y/R);
      if(top.y<=max(0.,top.x))continue;
      hit=vec2(max(start,max(0.,max(hit.x,top.x))),min(end,min(hit.y,top.y)));
      vec2 bottom=sphere(origin,direction,1.+coreBounds[i].x/R);
      if(bottom.y>bottom.x){
        if(hit.x>bottom.x && hit.x<bottom.y)hit.x=bottom.y;
        else if(hit.y>bottom.x && hit.y<bottom.y)hit.y=bottom.x;
      }
      if(hit.y>hit.x){
        occupied.x=min(occupied.x,hit.x);occupied.y=max(occupied.y,hit.y);
      }
    }
    start=max(start,occupied.x);end=min(end,occupied.y);
    // Never march a regional/horizon-sized column with a near-cloud sample budget.
    end=min(end,${CLOUD_VIEW_LIMITS.maxRayDistance.toFixed(1)}*rayScale);
    // A different ground depth behind the complete cloud segment has exactly
    // the same optical solution. Keep the cached raw pixel in that case.
    if(depthCorrection && !overviewChanged &&
       (min(limit,oldLimit)>=end || max(limit,oldLimit)<=start))discard;
    end=min(limit,end);
    if(end<=start){gl_FragColor=overview;return;}
    float jitter=hash(vec3(gl_FragCoord.xy,0.));
    vec4 accumulated=vec4(0.);
    float cursor=start,opticalSamples=0.;
    // Empty traversal and optical sampling have separate budgets. Clear pixels must not
    // exhaust the detail budget before a thin observed anvil is reached.
    for(int i=0;i<256;i++){
      if(opticalSamples>=stepBudget || cursor>=end)break;
      vec3 p=origin+direction*cursor;
      float altitude=(length(p)-1.)*R;
      vec4 column=columnAt(p);
      if(column.a<.015){cursor+=2500.*rayScale;continue;}
      vec2 geo=geographicUV(p);
      vec4 observed=hasReference?texture2D(reference,vec2(fract(geo.x+.5),geo.y)):vec4(1.);
      if(observed.a<.95 || observed.r<.01){cursor+=2500.*rayScale;continue;}
      float low=column.g;
      if(observed.r<.48){
        float support=clamp((.48-observed.r)/.54,0.,1.);
        float fraction=.2+.6*(.5-sin(asin(1.-2.*support)/3.));
        low=mix(column.g,column.b,fraction);
      }
      float radial=dot(normalize(p),direction);
      if(altitude<=low || altitude>=column.b){
        float jump=observed.r<.48?1000.:2500.;
        if(radial<-.01 && altitude>=column.b)jump=min(jump,max(25.,(altitude-column.b)/(-radial)*.65));
        if(radial>.01 && altitude<=low)jump=min(jump,max(25.,(low-altitude)/radial*.65));
        cursor+=jump*rayScale;continue;
      }
      float stepMetres=min((end-cursor)/rayScale,clamp((column.b-column.g)/8.,25.,160.));
      p+=direction*(jitter*.25*stepMetres*rayScale);
      vec3 velocity=transport(p,geo,altitude);
      float d=localDensity(p,column,observed,velocity)*(1.-smoothstep(${(CLOUD_VIEW_LIMITS.maxRayDistance*.8).toFixed(1)},${CLOUD_VIEW_LIMITS.maxRayDistance.toFixed(1)},cursor/rayScale));
      if(d>.001){
        opticalSamples++;
        // Integrate along the light ray as well as along the camera ray.
        // A thick bank shadows its interior while a thin fringe transmits light.
        float reach=clamp((column.b-column.g)*.14,120.,850.);
        vec3 lightStep=normalize(lightDirection/RADII)*(reach/R);
        float shadow=(d*.15+density(p+lightStep,velocity)*.52+density(p+lightStep*2.7,velocity)*.33)
          *clamp(reach/190.,.85,3.8);
        float fraction=clamp((altitude-column.g)/max(1.,column.b-column.g),0.,1.);
        float overhead=(1.-fraction)*column.r*observed.r;
        float illumination=clamp(.09+.12*fraction+.80*exp(-shadow*1.85-overhead*1.65),0.,1.);
        vec3 color=mix(vec3(.065,.105,.16),vec3(.97,.985,1.),illumination);
        float alpha=1.-exp(-d*stepMetres/115.);
        accumulated.rgb+=(1.-accumulated.a)*alpha*color;
        accumulated.a+=(1.-accumulated.a)*alpha;
        if(accumulated.a>.985)break;
      }
      cursor+=(d>.001?stepMetres:max(stepMetres,clamp((column.b-column.g)*.11,25.,400.)))*rayScale;
    }
    gl_FragColor=overview+accumulated*rayBlend;
  }
`;

/** Integrates light through the cloud volume along each camera ray. */
export class CloudLayer {
  constructor() {
    this.scene = new THREE.Scene();
    this.screenCamera = new THREE.Camera();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.emptyReference = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    this.emptyReference.needsUpdate = true;
    this.reference = null;
    this.textures = [];
    this.snapshot = null;
    this.counts = [];
    this.viewDetail = cloudViewDetail(Infinity);
    this.cameraAltitude = Infinity;
    this.cores = [];
    this.regionBands = [];
    this.maxBoundRadius = 0;
    this.lastMotionAt = -Infinity;
    this.moving = false;
    this.lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.lastQuaternion = new THREE.Quaternion();
    this.selectionView = new THREE.Matrix4();
    this.selectionProjection = new THREE.Matrix4();
    this.selectionValid = false;
    this.frustum = new THREE.Frustum();
    this.frustumMatrix = new THREE.Matrix4();
    this.windSnapshot = null;
    this.windLevels = [];
    this.flowSeconds = 0;
    this.lastCloudDraw = null;
    this.lastOpticalFrame = -Infinity;
    this.blendStartedAt = null;
    this.integrations = 0;
    this.stepBudget = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        convectiveField: { value: this.emptyReference },
        convectiveGridSize: { value: new THREE.Vector2(1, 1) },
        convectiveMix: { value: 0 },
        fieldLayout: { value: new THREE.Vector4(0,90,.25,.25) },
        hasColumnField: { value: false },
        turbulence: { value: null },
        cloudWind: { value: this.emptyReference },
        windGrid: { value: new THREE.Vector2(1,1) },
        hasWind: { value: false },
        flowPhase: { value: 0 },
        coreCount: { value: 0 },
        coreBounds: { value: Array.from({length:32},()=>new THREE.Vector4()) },
        coreSpheres: { value: Array.from({length:32},()=>new THREE.Vector4()) },
        reference: { value: this.emptyReference },
        hasReference: { value: false },
        observationMix: { value: 0 },
        terrainDepth: { value: null },
        previousDepth: { value: this.emptyReference },
        depthCorrection: { value: false },
        hasTerrain: { value: false },
        logarithmic: { value: true },
        cameraFar: { value: 1e9 },
        cameraNear: { value: 100 },
        volumeBlend: { value: 0 },
        overviewBlend: { value: 1 },
        stepBudget: { value: 128 },
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        eye: { value: new THREE.Vector3() },
        lightDirection: { value: new THREE.Vector3() },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
    this.compositeScene = new THREE.Scene();
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: { cloudColor: { value: null }, previousColor: {value:null}, fraction: {value:1} },
      vertexShader: vertex,
      fragmentShader: `uniform sampler2D cloudColor,previousColor;uniform float fraction;varying vec2 screenUV;
        void main(){vec4 c=texture2D(cloudColor,screenUV);
          if(fraction<1.)c=mix(texture2D(previousColor,screenUV),c,fraction);gl_FragColor=vec4(c.rgb/max(c.a,.0001),c.a);
          #include <colorspace_fragment>
          gl_FragColor.rgb*=gl_FragColor.a;}`,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.composite = new THREE.Mesh(this.geometry, this.compositeMaterial);
    this.composite.frustumCulled = false;
    this.compositeScene.add(this.composite);
    this.filterMaterial = new THREE.ShaderMaterial({
      uniforms: { source: {value:null}, texel: {value:new THREE.Vector2()}, close: {value:0} },
      vertexShader: vertex,
      fragmentShader: `uniform sampler2D source;uniform vec2 texel;uniform float close;varying vec2 screenUV;
        void main(){
          float alpha=close<.5?0.:1.;vec3 sum=vec3(0.);float weight=0.;
          for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
            vec4 c=texture2D(source,screenUV+vec2(float(x),float(y))*texel);
            alpha=close<.5?max(alpha,c.a):min(alpha,c.a);sum+=c.rgb;weight+=c.a;
          }
          gl_FragColor=vec4(sum/max(weight,.0001)*alpha,alpha);
        }`,
      depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false,
    });
    this.filterScene = new THREE.Scene();
    this.filterQuad = new THREE.Mesh(this.geometry,this.filterMaterial);
    this.filterQuad.frustumCulled = false;
    this.filterScene.add(this.filterQuad);
    this.depthCopyScene = new THREE.Scene();
    this.depthCopyMaterial = new THREE.ShaderMaterial({
      uniforms: { source: { value: null } }, vertexShader: vertex,
      fragmentShader: `uniform sampler2D source;varying vec2 screenUV;
        ${depthPacking}
        void main(){gl_FragColor=packCloudDepth(texture2D(source,screenUV).r);}`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
    const depthQuad=new THREE.Mesh(this.geometry,this.depthCopyMaterial);
    depthQuad.frustumCulled=false;this.depthCopyScene.add(depthQuad);
    this.opticalFrames=new Map();
    this.depthCorrections=0;
    this.filterTarget = null;
    this.target = null;
    this.drawingSize = new THREE.Vector2();
    this.lastView = "";
    this.dirty = true;
  }
  get enabled() {
    return this.mesh.visible;
  }
  set enabled(value) {
    const visible = !!value && !!this.snapshot;
    if (this.mesh.visible !== visible) {
      this.mesh.visible = visible;
      this.lastCloudDraw = null;
      this.blendStartedAt = null;
      this.dirty = true;
    }
  }
  updateView(camera) {
    camera.updateMatrixWorld();
    this.cameraAltitude = WGS84_ELLIPSOID.getPositionElevation(camera.position);
    this.viewDetail = cloudViewDetail(this.cameraAltitude);
    if (this.lastPosition.distanceToSquared(camera.position) > .0001 ||
        1 - Math.abs(this.lastQuaternion.dot(camera.quaternion)) > 1e-12 ||
        camera.fov !== this.lastFov || camera.aspect !== this.lastAspect || camera.zoom !== this.lastZoom) {
      this.lastMotionAt = performance.now();
      this.lastPosition.copy(camera.position);
      this.lastQuaternion.copy(camera.quaternion);
      this.lastFov = camera.fov;
      this.lastAspect = camera.aspect;
      this.lastZoom = camera.zoom;
    }
    this.moving = performance.now() - this.lastMotionAt < 240;
    if (this.selectionValid && this.selectionView.equals(camera.matrixWorld) &&
        this.selectionProjection.equals(camera.projectionMatrix)) return;
    this.selectionView.copy(camera.matrixWorld);
    this.selectionProjection.copy(camera.projectionMatrix);
    this.selectionValid = true;
    if (this.viewDetail.volume === 0) {
      this.candidateRegions = 0;
      this.material.uniforms.coreCount.value = 0;
      return;
    }
    this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);
    const direction=camera.position.clone().divide(new THREE.Vector3(6378137,6378137,6356752.314245)).normalize();
    const forward=camera.getWorldDirection(new THREE.Vector3());
    // A chord's length is at least its z component. These bands conservatively
    // exclude distant regions even at the poles or across the date line.
    const reach = (this.maxBoundRadius + CLOUD_VIEW_LIMITS.maxRayDistance) / EARTH_RADIUS;
    const first = latitudeBand(direction.z - reach);
    const last = latitudeBand(direction.z + reach);
    const candidates = [];
    const offset = new THREE.Vector3();
    for (let band = first; band <= last; band++) {
      for (const core of this.regionBands[band] || []) {
        const range = (core.boundRadius + CLOUD_VIEW_LIMITS.maxRayDistance) / EARTH_RADIUS;
        if (direction.distanceToSquared(core.direction) >= range * range ||
            !this.frustum.intersectsSphere(core.worldBound)) continue;
        offset.copy(core.worldBound.center).sub(camera.position);
        const along = offset.dot(forward);
        const score = offset.addScaledVector(forward, -Math.max(0, along)).length() + Math.max(0, -along);
        candidates.push({core, score});
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    this.candidateRegions = candidates.length;
    const nearby=candidates.slice(0,candidates.length>32?31:32);
    const u=this.material.uniforms;
    u.coreCount.value=nearby.length;
    nearby.forEach(({core},i)=>{
      u.coreBounds.value[i].set(core.bottom,core.top,core.anvil_radius,core.cover);
      u.coreSpheres.value[i].set(core.center.x,core.center.y,core.center.z,core.boundRadius/6371000);
    });
    if (candidates.length>32) {
      // Merge the tail conservatively instead of making the uniform budget a visible cut.
      const box=new THREE.Box3(),extent=new THREE.Vector3();
      let bottom=25000,top=0;
      for(const {core} of candidates.slice(31)){
        extent.setScalar(core.boundRadius/6371000);
        box.expandByPoint(core.center.clone().sub(extent));box.expandByPoint(core.center.clone().add(extent));
        bottom=Math.min(bottom,core.bottom);top=Math.max(top,core.top);
      }
      const sphere=box.getBoundingSphere(new THREE.Sphere());
      u.coreSpheres.value[31].set(sphere.center.x,sphere.center.y,sphere.center.z,sphere.radius);
      u.coreBounds.value[31].set(bottom,top,0,1);u.coreCount.value=32;
    }
  }
  get requiresTerrainDepth() {
    return (
      this.enabled &&
      (this.volumeSnapshot === this.snapshot ||
        this.convectionSnapshot === this.snapshot) &&
      this.material.uniforms.hasColumnField.value &&
      this.material.uniforms.coreCount.value > 0 &&
      this.viewDetail.volume > 0
    );
  }
  setTerrainDepth(texture, options = {}) {
    const u=this.material.uniforms;
    u.terrainDepth.value=texture;
    u.logarithmic.value=!!options.logarithmic;
    if(options.far)u.cameraFar.value=options.far;
  }
  setWindField({snapshot,width,height,buffer,levels,maxSpeed}) {
    if(snapshot!==this.snapshot || snapshot!==this.convectionSnapshot) return false;
    if(!Number.isInteger(width) || !Number.isInteger(height) || width<2 || height<2 ||
       width*height>1000000 || buffer.byteLength!==width*height*CLOUD_PRESSURES.length*8 ||
       !Array.isArray(levels) || !levels.every(level=>CLOUD_PRESSURES.includes(level)) ||
       !Number.isFinite(maxSpeed) || maxSpeed<0) throw new Error("Invalid cloud wind field");
    const texture=new THREE.DataTexture(new Uint16Array(buffer),width,height*CLOUD_PRESSURES.length,
      THREE.RGBAFormat,THREE.HalfFloatType);
    texture.wrapS=THREE.RepeatWrapping;
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
    this.windTexture?.dispose();this.windTexture=texture;
    this.windSnapshot=snapshot;this.windLevels=levels;
    const u=this.material.uniforms;
    u.cloudWind.value=texture;u.windGrid.value.set(width,height);
    u.hasWind.value=maxSpeed>0 && levels.length>0;
    this.dirty=true;
    return true;
  }
  setDepthRevision(revision) {
    this.depthRevision = revision;
  }
  setData(profile) {
    if (profile.bands.length !== 3)
      throw new Error("Three cloud bands are required");
    const bands = profile.bands.map(cloudBandTexture);
    if (this.snapshot !== profile.snapshot) {
      this.reference?.dispose();
      this.reference = null;
      this.referenceTime = null;
      this.observationSource = null;
      this.material.uniforms.observationMix.value = 0;
    }
    const retainedConvection =
      this.convectionSnapshot === profile.snapshot
        ? {
            texture: this.convectiveTexture,
            cores: this.cores,
            regionBands: this.regionBands,
            maxBoundRadius: this.maxBoundRadius,
            pointUrl: this.pointUrl,
            fieldHeader: this.fieldHeader,
            shapeSnapshot: this.shapeSnapshot,
            count: this.convectiveCount,
            loadedAt: this.convectiveLoadedAt,
            size: this.material.uniforms.convectiveGridSize.value.clone(),
            mix: this.material.uniforms.convectiveMix.value,
          }
        : null;
    if (retainedConvection) this.convectiveTexture = null;
    this.clear(this.windSnapshot===profile.snapshot);
    if (retainedConvection) {
      this.convectiveTexture = retainedConvection.texture;
      this.cores = retainedConvection.cores;
      this.regionBands = retainedConvection.regionBands;
      this.maxBoundRadius = retainedConvection.maxBoundRadius;
      this.pointUrl = retainedConvection.pointUrl;
      this.fieldHeader = retainedConvection.fieldHeader;
      this.shapeSnapshot = retainedConvection.shapeSnapshot;
      this.convectionSnapshot = profile.snapshot;
      this.convectiveCount = retainedConvection.count;
      this.convectiveLoadedAt = retainedConvection.loadedAt;
      this.material.uniforms.convectiveField.value = retainedConvection.texture || this.emptyReference;
      this.material.uniforms.convectiveGridSize.value.copy(
        retainedConvection.size,
      );
      this.material.uniforms.convectiveMix.value = retainedConvection.mix;
      this.material.uniforms.hasColumnField.value = !!retainedConvection.texture;
      if (this.fieldHeader)
        this.material.uniforms.fieldLayout.value.set(this.fieldHeader.lo1,this.fieldHeader.la1,this.fieldHeader.dx,this.fieldHeader.dy);
    }
    this.snapshot = profile.snapshot;
    this.volumeSnapshot = profile.snapshot;
    this.volumeLoadedAt = performance.now();
    this.counts = bands.map((b) => b.cloudy);
    bands.forEach((band) => {
      const texture = new THREE.DataTexture(
        Uint16Array.from(band.pixels, (value) =>
          THREE.DataUtils.toHalfFloat(value),
        ),
        band.nx,
        band.ny,
        THREE.RGBAFormat,
        THREE.HalfFloatType,
      );
      texture.wrapS = THREE.RepeatWrapping;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      this.textures.push(texture);
    });
    this.material.uniforms.reference.value =
      this.reference || this.emptyReference;
    this.material.uniforms.hasReference.value = !!this.reference;
    this.dirty = true;
  }
  setConvection(profile) {
    if (profile.snapshot !== this.snapshot)
      throw new Error("Convective snapshot mismatch");
    const band = profile.column ? cloudBandTexture(profile.column) : null;
    this.cores = (profile.cores || []).filter(core=>
      [core.lon,core.lat,core.bottom,core.top,core.radius,core.anvil_radius,core.cover].every(Number.isFinite) &&
      core.top>core.bottom && core.radius>0 && core.anvil_radius>=core.radius
    ).map(core=>{
      const latitude=core.lat*Math.PI/180,longitude=core.lon*Math.PI/180;
      // Scaled ellipsoid direction uses geocentric latitude, matching the ray marcher.
      const z=Math.atan(Math.tan(latitude)*6356752.314245/6378137);
      const direction=new THREE.Vector3(Math.cos(z)*Math.cos(longitude),Math.cos(z)*Math.sin(longitude),Math.sin(z));
      const center=direction.clone().multiplyScalar(1+(core.top+core.bottom)/2/6371000);
      const boundRadius=Math.hypot(Math.max(core.radius,core.anvil_radius)*1.3,(core.top-core.bottom)/2)+250;
      const worldBound=new THREE.Sphere(center.clone().multiply(new THREE.Vector3(6378137,6378137,6356752.314245)),boundRadius*6378137/6371000);
      return {...core,direction,center,boundRadius,worldBound};
    });
    this.regionBands = Array.from({length: REGION_BANDS}, () => []);
    this.maxBoundRadius = 0;
    for (const core of this.cores) {
      this.regionBands[latitudeBand(core.direction.z)].push(core);
      this.maxBoundRadius = Math.max(this.maxBoundRadius, core.boundRadius);
    }
    const texture = band ? new THREE.DataTexture(
      Uint16Array.from(band.pixels, (v) => THREE.DataUtils.toHalfFloat(v)),
      band.nx,
      band.ny,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    ) : null;
    if (texture) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
    }
    this.convectiveTexture?.dispose();
    this.convectiveTexture = texture;
    this.convectionSnapshot = profile.snapshot;
    this.convectiveCount = band?.cloudy || this.cores.length;
    this.pointUrl = profile.point_url || null;
    this.material.uniforms.convectiveField.value = texture || this.emptyReference;
    this.material.uniforms.convectiveGridSize.value.set(band?.nx || 1, band?.ny || 1);
    this.fieldHeader = profile.column?.cover.header || null;
    this.material.uniforms.hasColumnField.value = !!texture;
    if (this.fieldHeader)
      this.material.uniforms.fieldLayout.value.set(this.fieldHeader.lo1,this.fieldHeader.la1,this.fieldHeader.dx,this.fieldHeader.dy);
    this.convectiveLoadedAt = performance.now();
    if (this.volumeSnapshot !== profile.snapshot)
      this.volumeLoadedAt = this.convectiveLoadedAt;
    this.material.uniforms.convectiveMix.value = 0;
    this.selectionValid = false;
    this.dirty = true;
  }
  setShape(profile, bytes) {
    const h = profile.grid;
    if (profile.snapshot !== this.snapshot) throw new Error("Cloud shape snapshot mismatch");
    if (profile.encoding !== "rgba16f-le" || profile.height_range_m !== 25000 ||
        !h || ![h.nx,h.ny,h.dx,h.dy,h.lo1,h.la1].every(Number.isFinite) ||
        !Number.isInteger(h.nx) || !Number.isInteger(h.ny) ||
        h.nx<2 || h.ny<2 || h.nx*h.ny>3000000 || h.dx<=0 || h.dy<=0 ||
        bytes.byteLength !== h.nx*h.ny*8)
      throw new Error("Invalid cloud column field");
    if (!Array.isArray(profile.regions) || profile.regions.some(row=>
      row.length!==5 || !row.every(Number.isFinite) || row[2]<0 || row[3]<=row[2] || row[3]>25000 || row[4]<=0))
      throw new Error("Invalid cloud sampling bounds");
    if (profile.run_time && (h.refTime!==profile.run_time ||
        h.forecastTime!==(Date.parse(profile.valid_time)-Date.parse(profile.run_time))/3600000))
      throw new Error("Cloud field time mismatch");
    const pixels = new Uint16Array(bytes);
    const texture = new THREE.DataTexture(pixels,h.nx,h.ny,THREE.RGBAFormat,THREE.HalfFloatType);
    texture.wrapS = h.nx*h.dx>=359.99 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const cores = profile.regions.map(([lon,lat,bottom,top,radius])=>({lon,lat,bottom,top,radius,anvil_radius:radius,cover:1}));
    this.setConvection({...profile,cores});
    this.convectiveTexture = texture;
    this.fieldHeader = h;
    this.material.uniforms.convectiveField.value = texture;
    this.material.uniforms.convectiveGridSize.value.set(h.nx,h.ny);
    this.material.uniforms.fieldLayout.value.set(h.lo1,h.la1,h.dx,h.dy);
    this.material.uniforms.hasColumnField.value = true;
    this.shapeSnapshot = profile.snapshot;
    this.dirty = true;
  }
  sampleConvection(lon, lat) {
    if (!this.convectiveTexture || this.convectionSnapshot !== this.snapshot)
      return null;
    const image = this.convectiveTexture.image;
    const x =
      Math.round(((((lon % 360) + 360) % 360) / 360) * image.width) %
      image.width;
    const y = Math.max(
      0,
      Math.min(
        image.height - 1,
        Math.round(((90 - lat) / 180) * (image.height - 1)),
      ),
    );
    const i = (y * image.width + x) * 4,
      read = (offset) => THREE.DataUtils.fromHalfFloat(image.data[i + offset]);
    if (read(3) < 0.95 || read(0) <= 0.001) return null;
    return {
      bottom: read(1) * 25000,
      top: read(2) * 25000,
      cover: read(0) * 100,
      source: "GFS convective cloud diagnostics",
    };
  }
  async setObservation(info, accept = () => true) {
    if (!accept()) return false;
    if (
      this.snapshot === info.snapshot &&
      this.referenceTime === info.observation_time &&
      this.reference
    )
      return true;
    const loader=new THREE.TextureLoader();
    let texture;
    if(info.render_texture_url){
      try { texture=await loader.loadAsync(info.render_texture_url); }
      catch {
        if(!accept())return false;
        texture=await loader.loadAsync(info.texture_url);
      }
    }else texture=await loader.loadAsync(info.texture_url);
    if (!accept()) {
      texture.dispose();
      return false;
    }
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    if (this.snapshot !== info.snapshot) this.clear();
    this.snapshot = info.snapshot;
    this.reference?.dispose();
    this.reference = texture;
    this.referenceTime = info.observation_time;
    this.observationSource = info.source;
    this.observationLoadedAt = performance.now();
    this.material.uniforms.observationMix.value = 0;
    this.material.uniforms.reference.value = texture;
    this.material.uniforms.hasReference.value = true;
    this.dirty = true;
    return true;
  }

  saveTerrainDepth(renderer,width,height){
    if(!this.depthSnapshot){
      this.depthSnapshot=new THREE.WebGLRenderTarget(width,height,{depthBuffer:false,stencilBuffer:false,
        minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
    }
    this.depthSnapshot.setSize(width,height);
    this.depthCopyMaterial.uniforms.source.value=this.material.uniforms.terrainDepth.value;
    renderer.setRenderTarget(this.depthSnapshot);
    renderer.autoClear=true;
    renderer.render(this.depthCopyScene,this.screenCamera);
    this.material.uniforms.previousDepth.value=this.depthSnapshot.texture;
  }

  drawOpticalFrame(renderer,target,settings,correction){
    const u=this.material.uniforms;
    let frame=this.opticalFrames.get(target);
    if(!frame){frame={};this.opticalFrames.set(target,frame);}
    if(!correction)frame.settings=settings;
    const {volume,observation,convection,phase}=frame.settings;
    u.volumeBlend.value=volume;
    u.observationMix.value=observation;
    u.convectiveMix.value=convection;
    u.flowPhase.value=phase;
    u.depthCorrection.value=correction;
    const filtered=volume>.5;
    let raw=target;
    if(filtered && u.hasTerrain.value && !this.moving){
      // Corrections discard unchanged rays. Keep their unfiltered radiance
      // so neighbouring pixels can be filtered again without repeated erosion.
      frame.raw??=target.clone();
      frame.raw.setSize(target.width,target.height);
      raw=frame.raw;
    }
    renderer.setRenderTarget(raw);renderer.autoClear=!correction;
    renderer.render(this.scene,this.screenCamera);
    u.depthCorrection.value=false;
    if(filtered){
      this.filterTarget??=target.clone();
      this.filterTarget.setSize(target.width,target.height);
      const f=this.filterMaterial.uniforms;
      f.texel.value.set(1/target.width,1/target.height);
      f.source.value=raw.texture;f.close.value=0;
      renderer.autoClear=true;renderer.setRenderTarget(this.filterTarget);
      renderer.render(this.filterScene,this.screenCamera);
      f.source.value=this.filterTarget.texture;f.close.value=1;
      renderer.setRenderTarget(target);renderer.render(this.filterScene,this.screenCamera);
    }
  }

  render(renderer, camera, viewPrepared = false) {
    if (!this.enabled) return;
    const now=performance.now();
    const dt=this.lastCloudDraw===null?0:Math.min(.15,(now-this.lastCloudDraw)/1000);
    this.lastCloudDraw=now;
    const destination = renderer.getRenderTarget(),
      autoClear = renderer.autoClear;
    renderer.getDrawingBufferSize(this.drawingSize);
    if (!viewPrepared) this.updateView(camera);
    const mix = this.reference
      ? Math.min(1, (performance.now() - this.observationLoadedAt) / 500)
      : 0;

    const ready =
      !!this.snapshot &&
      (this.volumeSnapshot === this.snapshot ||
        this.convectionSnapshot === this.snapshot);
    const convectiveMix = this.convectionSnapshot === this.snapshot && !!this.snapshot
      ? Math.min(1, (performance.now() - this.convectiveLoadedAt) / 800)
      : 0;

    const volumeFade = ready
      ? Math.min(1, (performance.now() - this.volumeLoadedAt) / 800)
      : 0;
    const volumeBlend = this.material.uniforms.hasColumnField.value && this.material.uniforms.coreCount.value > 0 ? this.viewDetail.volume * volumeFade : 0;

    if (this.material.uniforms.overviewBlend.value !== this.viewDetail.satellite)
      this.dirty = true;
    this.material.uniforms.overviewBlend.value = this.viewDetail.satellite;
    if (volumeBlend === 0 && this.viewDetail.satellite === 0) {
      this.stepBudget = 0;
      this.material.uniforms.volumeBlend.value=0;
      return;
    }
    if(volumeBlend>0 && !this.turbulenceTexture){
      this.turbulenceTexture=cloudTurbulenceTexture();
      this.material.uniforms.turbulence.value=this.turbulenceTexture;
    }
    const animate=volumeBlend>0 && this.material.uniforms.hasWind.value && !this.moving;
    if(animate) this.flowSeconds=(this.flowSeconds+dt)%FLOW_CYCLE_SECONDS;
    const plan = cloudRenderPlan(this.drawingSize.x, this.drawingSize.y, volumeBlend, this.moving);
    const {width, height} = plan;
    this.stepBudget = plan.steps;
    if (this.material.uniforms.stepBudget.value !== plan.steps) this.dirty = true;
    this.material.uniforms.stepBudget.value = plan.steps;
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: false,
        stencilBuffer: false,
      });
      this.compositeMaterial.uniforms.cloudColor.value = this.target.texture;
    }
    if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
      this.dirty = true;
    }
    const view =
      camera.matrixWorld.elements.join(",") +
      camera.projectionMatrix.elements.join(",");
    try {
      const u=this.material.uniforms;
      const withDepth=volumeBlend>.001 && !!u.terrainDepth.value;
      const depthModeChanged=withDepth!==this.usedDepth ||
        (withDepth && this.usedLogDepth!==u.logarithmic.value);
      u.hasTerrain.value=withDepth;
      const depthChanged=withDepth && (this.appliedDepthRevision!==this.depthRevision ||
        this.appliedDepthTexture!==u.terrainDepth.value);
      const canPatch=withDepth && !this.moving;
      const newView=this.dirty || view!==this.lastView || depthModeChanged ||
        (canPatch && !this.depthComparable) || (!canPatch && depthChanged);
      const fading=u.observationMix.value!==mix || u.convectiveMix.value!==convectiveMix ||
        u.volumeBlend.value!==volumeBlend;
      const tick=(animate || fading) && now-this.lastOpticalFrame>=MOTION_FRAME_MS;
      if(newView || tick){
        this.blendStartedAt=null;
        if(!newView){
          this.previousTarget??=this.target.clone();
          [this.target,this.previousTarget]=[this.previousTarget,this.target];
          this.target.setSize(width,height);
          this.blendStartedAt=now;
          if(depthChanged)this.drawOpticalFrame(renderer,this.previousTarget,null,true);
        }
        u.inverseProjection.value.copy(camera.projectionMatrixInverse);
        u.cameraWorld.value.copy(camera.matrixWorld);
        u.eye.value.copy(camera.position);
        u.cameraNear.value=camera.near;
        u.lightDirection.value.copy(camera.position).normalize()
          .addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),-1.5)
          .addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),1.1).normalize();
        const settings={volume:volumeBlend,observation:mix,convection:convectiveMix,phase:this.flowSeconds/FLOW_CYCLE_SECONDS};
        this.drawOpticalFrame(renderer,this.target,settings,false);
        this.lastOpticalFrame=now;this.lastView=view;this.dirty=false;this.integrations++;
      }else if(depthChanged){
        // Correct both displayed endpoints at their ORIGINAL times. Tile
        // revisions never advance, cancel or restart the interpolation clock.
        if(this.blendStartedAt!==null && now-this.blendStartedAt<MOTION_FRAME_MS)
          this.drawOpticalFrame(renderer,this.previousTarget,null,true);
        this.drawOpticalFrame(renderer,this.target,null,true);
      }
      if(depthChanged && !newView)this.depthCorrections++;
      if(canPatch && (newView || depthChanged))this.saveTerrainDepth(renderer,width,height);
      this.depthComparable=canPatch;
      this.usedDepth=withDepth;this.usedLogDepth=u.logarithmic.value;
      this.appliedDepthRevision=this.depthRevision;this.appliedDepthTexture=u.terrainDepth.value;
      const composite=this.compositeMaterial.uniforms;
      composite.cloudColor.value=this.target.texture;
      composite.previousColor.value=this.previousTarget?.texture || this.target.texture;
      composite.fraction.value=this.blendStartedAt!==null
        ? Math.min(1,(now-this.blendStartedAt)/MOTION_FRAME_MS) : 1;
      renderer.setRenderTarget(destination);
      renderer.autoClear = false;
      renderer.render(this.compositeScene, this.screenCamera);
    } finally {
      renderer.setRenderTarget(destination);
      renderer.autoClear = autoClear;
    }
  }
  clear(keepWind=false) {
    this.blendStartedAt=null;this.lastCloudDraw=null;
    if(!keepWind){
      this.windTexture?.dispose();this.windTexture=null;this.windSnapshot=null;this.windLevels=[];
      this.flowSeconds=0;this.material.uniforms.flowPhase.value=0;
      this.material.uniforms.hasWind.value=false;this.material.uniforms.cloudWind.value=this.emptyReference;
    }
    this.textures.forEach((t) => t.dispose());
    this.textures = [];
    this.snapshot = null;
    this.volumeSnapshot = null;
    this.volumeLoadedAt = null;
    this.convectiveTexture?.dispose();
    this.convectiveTexture = null;
    this.convectionSnapshot = null;
    this.shapeSnapshot = null;
    this.fieldHeader = null;
    this.material.uniforms.hasColumnField.value = false;
    this.pointUrl = null;
    this.cores = [];
    this.regionBands = [];
    this.maxBoundRadius = 0;
    this.selectionValid = false;
    this.material.uniforms.coreCount.value = 0;
    this.material.uniforms.convectiveField.value = this.emptyReference;
    this.material.uniforms.convectiveGridSize.value.set(1, 1);
    this.material.uniforms.convectiveMix.value = 0;
    this.counts = [];
    this.material.uniforms.volumeBlend.value = 0;
    this.dirty = true;
  }
  getState() {
    return {
      enabled: this.enabled,
      snapshot: this.snapshot,
      renderer: "camera-adaptive cloud volume",
      mode:
        this.material.uniforms.volumeBlend.value === 0
          ? "cloud-cover"
          : this.material.uniforms.volumeBlend.value >= 0.99
            ? "volume"
            : "transition",
      volumeDataReady: !!this.snapshot && this.material.uniforms.hasColumnField.value && this.convectionSnapshot === this.snapshot,
      maxVolumeDistance: CLOUD_VIEW_LIMITS.maxRayDistance,
      maxRayDistance: CLOUD_VIEW_LIMITS.maxRayDistance,
      revision: "observed-volume-v8",
      windSnapshot: this.windSnapshot,
      windLevels: this.windLevels,
      advectingDetail: this.enabled && !this.moving && this.material.uniforms.hasWind.value && this.material.uniforms.volumeBlend.value>0,
      motionPhase: this.material.uniforms.flowPhase.value,
      convectiveBlend: this.material.uniforms.convectiveMix.value,
      convectiveDataReady:
        this.convectionSnapshot === this.snapshot && !!this.snapshot,
      inferredCores: this.shapeSnapshot === this.snapshot ? 0 : this.cores.length,
      geographicRegions: this.shapeSnapshot === this.snapshot ? this.cores.length : 0,
      nearbyRegions: this.material.uniforms.coreCount.value,
      candidateRegions: this.candidateRegions || 0,
      nearbyCores: this.material.uniforms.coreCount.value,
      convectiveCells: this.convectiveCount || 0,
      cameraAltitude: this.cameraAltitude,
      volumeBlend: this.material.uniforms.volumeBlend.value,
      detailBlend: this.viewDetail.detail,
      satelliteBlend: this.material.uniforms.overviewBlend.value,
      moving: this.moving,
      integrations: this.integrations,
      depthCorrections: this.depthCorrections,
      steps:
        this.material.uniforms.volumeBlend.value === 0
          ? 0
          : this.stepBudget,
      traversalBudget: 256,
      renderSize: this.target ? [this.target.width, this.target.height] : null,
      cloudyCells: this.counts,
      satelliteObservation: !!this.reference,
      observationSource: this.observationSource || null,
      observationMix: this.material.uniforms.observationMix.value,
      referenceTime: this.referenceTime || null,
      heightReference: "approximate pressure altitude, unscaled",
    };
  }
  dispose() {
    this.clear();
    for(const frame of this.opticalFrames.values())frame.raw?.dispose();
    this.opticalFrames.clear();
    this.depthCopyMaterial.dispose();
    this.depthSnapshot?.dispose();
    this.previousTarget?.dispose();
    this.turbulenceTexture?.dispose();
    this.target?.dispose();
    this.filterTarget?.dispose();
    this.filterMaterial.dispose();
    this.material.dispose();
    this.compositeMaterial.dispose();
    this.geometry.dispose();
    this.reference?.dispose();
    this.emptyReference.dispose();
  }
}
