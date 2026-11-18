import { THREE } from './vendor.js';
import { pressureAltitude } from './cloud-data.js';
import { CLOUD_PRESSURES } from './cloud-wind-data.js';

// The same periodic five-octave volume used in the weather globe preview.
// Store it once on the GPU: no per-frame voxel generation or texture uploads.
export function cloudTurbulenceTexture() {
  const side=64, count=side**3;
  const lattice=new Float32Array(count), field=new Uint8Array(count);
  let seed=18427;
  for(let i=0;i<count;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    lattice[i]=seed/4294967296*2-1;
  }
  function noise(x,y,z,mask){
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
    const smooth=t=>t*t*(3-2*t);
    const fx=smooth(x-ix),fy=smooth(y-iy),fz=smooth(z-iz);
    function plane(k){
      const a=((iz+k)&mask)*4096,b=(iy&mask)*64,c=((iy+1)&mask)*64,i=ix&mask,j=(ix+1)&mask;
      return (lattice[a+b+i]*(1-fx)+lattice[a+b+j]*fx)*(1-fy)
        +(lattice[a+c+i]*(1-fx)+lattice[a+c+j]*fx)*fy;
    }
    return plane(0)*(1-fz)+plane(1)*fz;
  }
  for(let z=0;z<side;z++)for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    let value=0,scale=1/16,weight=1;
    for(let octave=0;octave<5;octave++){
      value+=weight*noise(x*scale+17,y*scale+31,z*scale+7,(4<<octave)-1);
      scale*=2;weight*=.82;
    }
    field[x+64*y+4096*z]=Math.round(255*Math.max(0,Math.min(1,.5+value*.22)));
  }
  const texture=new THREE.Data3DTexture(field,side,side,side);
  texture.format=THREE.RedFormat;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.wrapS=texture.wrapT=texture.wrapR=THREE.RepeatWrapping;
  texture.unpackAlignment=1;texture.needsUpdate=true;
  return texture;
}

const heights=CLOUD_PRESSURES.map(p=>pressureAltitude(p*100).toFixed(2));
export const cloudMaterialGLSL = `
  uniform highp sampler3D turbulence;
  uniform sampler2D cloudWind;
  uniform vec2 windGrid;
  uniform bool hasWind;
  uniform float flowPhase;
  vec4 windAt(vec2 geo,int level){
    vec2 uv=vec2(fract(geo.x+.5/windGrid.x),
      (float(level)+(clamp(geo.y,0.,1.)*(windGrid.y-1.)+.5)/windGrid.y)/${heights.length}.);
    return texture2D(cloudWind,uv);
  }
  vec3 transport(vec3 p,vec2 geo,float height){
    if(!hasWind)return vec3(0.);
    const float h[${heights.length}]=float[${heights.length}](${heights.join(',')});
    int k=0;
    for(int j=1;j<${heights.length-1};j++)if(height>=h[j])k=j;
    float f=clamp((height-h[k])/(h[k+1]-h[k]),0.,1.);
    vec4 wind=mix(windAt(geo,k),windAt(geo,k+1),f);
    if(wind.a<.999)return vec3(0.);
    float lon=geo.x*6.28318530718;
    vec3 east=vec3(-sin(lon),cos(lon),0.);
    vec3 north=normalize(cross(normalize(p),east));
    return east*wind.r+north*wind.g;
  }
  float vapour(vec3 q){
    float warp=texture(turbulence,q*.51).r-.5;
    vec3 warped=q+vec3(.12,-.09,.055)*warp;
    return (texture(turbulence,warped).r-.5)*1.6+
      (texture(turbulence,warped*2.71+vec3(.17,.31,.09)).r-.5)*.55;
  }
  float cloudDetail(vec3 p,vec3 velocity){
    vec3 q=p*R/21000.;
    if(dot(velocity,velocity)<.0001)return vapour(q);
    // Eight model seconds per display second. Re-anchor the fine texture
    // periodically, fading to a phase which meets the next cycle continuously.
    vec3 travel=velocity*(720./21000.);
    float moving=vapour(q-flowPhase*travel);
    if(flowPhase<.82)return moving;
    return mix(moving,vapour(q+(1.-flowPhase)*travel),smoothstep(.82,1.,flowPhase));
  }
`;
