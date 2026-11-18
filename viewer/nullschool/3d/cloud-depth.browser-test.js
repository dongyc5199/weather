import { THREE } from './vendor.js';
import { CloudLayer } from './cloud-layer.js';

// Compare incremental corrections with an independent, full render at each
// saved optical time. Move terrain in front of, through, and behind the cloud.
export function checkCloudDepthCorrections(logarithmic=true){
  const size=96,renderer=new THREE.WebGLRenderer({antialias:false});
  renderer.setPixelRatio(1);renderer.setSize(size,size);
  const layer=new CloudLayer(),snapshot='terrain-occlusion';
  const camera=new THREE.PerspectiveCamera(65,1,100,1e6);
  camera.position.set(6378137+16000,0,0);camera.up.set(0,0,1);camera.lookAt(0,0,0);
  const data=new Float32Array(size*size).fill(1);
  const depth=new THREE.DataTexture(data,size,size,THREE.RedFormat,THREE.FloatType);
  depth.needsUpdate=true;
  const referenceTarget=new THREE.WebGLRenderTarget(size,size,{depthBuffer:false,stencilBuffer:false});
  const read=target=>{
    const out=new Uint8Array(size*size*4);
    renderer.readRenderTargetPixels(target,0,0,size,size,out);
    return out;
  };
  try{
    layer.snapshot=snapshot;layer.enabled=true;
    const observation=new THREE.DataTexture(new Uint8Array([215,0,0,255]),1,1);
    observation.needsUpdate=true;layer.reference=observation;
    const u=layer.material.uniforms;
    u.hasReference.value=true;u.reference.value=observation;layer.observationLoadedAt=performance.now()-2000;
    const grid={nx:9,ny:9,lo1:-2,la1:2,dx:.5,dy:.5};
    const field=new Uint16Array(9*9*4);
    for(let i=0;i<field.length;i+=4)field.set([1,.12,.40,1].map(THREE.DataUtils.toHalfFloat),i);
    layer.setShape({snapshot,grid,encoding:'rgba16f-le',height_range_m:25000,regions:[[0,0,3000,10000,150000]]},field.buffer);
    layer.convectiveLoadedAt=layer.volumeLoadedAt=performance.now()-2000;
    const wind=new Uint16Array(4*3*6*4);
    for(let i=0;i<wind.length;i+=4){wind[i]=THREE.DataUtils.toHalfFloat(36);wind[i+3]=THREE.DataUtils.toHalfFloat(1)}
    layer.setWindField({snapshot,width:4,height:3,buffer:wind.buffer,levels:[700],maxSpeed:36});
    layer.setTerrainDepth(depth,{far:camera.far,logarithmic});
    layer.updateView(camera);layer.lastMotionAt=-Infinity;layer.render(renderer,camera);
    layer.flowSeconds=4;layer.lastOpticalFrame=-Infinity;layer.render(renderer,camera);
    const ordinary=read(layer.target);
    if(ordinary[(size*48+18)*4+3]<128)throw new Error('Expected opaque test cloud');
    const before=layer.integrations;
    function verify(target){
      const actual=read(target),settings=layer.opticalFrames.get(target).settings;
      layer.drawOpticalFrame(renderer,referenceTarget,settings,false);
      const reference=read(referenceTarget);
      let maxError=0;
      for(let i=0;i<actual.length;i++)maxError=Math.max(maxError,Math.abs(actual[i]-reference[i]));
      if(maxError>1)throw new Error('Partial depth update differs from a full cloud render: '+maxError);
      return actual;
    }
    let partialPixels=0;
    for(const stage of [1,2,3,4]){
      const z=d=>logarithmic?Math.log2(d+1)/Math.log2(camera.far+1):
        camera.far/(camera.far-camera.near)*(1-camera.near/d);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const band=Math.floor(x/(size/4));
        const distance=[1000,8000,24000,40000][(band+stage-1)%4];
        data[x+y*size]=stage===3?1:z(distance);
      }
      depth.needsUpdate=true;layer.setDepthRevision(stage);
      // Keep both animation endpoints active even on slow software WebGL.
      layer.blendStartedAt=layer.lastOpticalFrame=performance.now()-65;
      if(stage===4)layer.lastOpticalFrame=-Infinity;
      layer.render(renderer,camera);
      const current=verify(layer.target);verify(layer.previousTarget);
      const sample=x=>current[(size*48+x)*4+3];
      if(stage===1){
        for(let y=0;y<size;y++)for(let x=size/4+2;x<size/2-2;x++){
          const index=(y*size+x)*4+3;
          if(current[index]>1 && current[index]<ordinary[index]-1)partialPixels++;
        }
        if(!partialPixels)throw new Error('Terrain did not intersect the interior of the test cloud');
      }
      if(stage===1 && (sample(18)!==0 || sample(84)!==ordinary[(size*48+84)*4+3]))
        throw new Error('Incorrect foreground occlusion or background preservation');
      if(stage===3 && current.some((v,i)=>Math.abs(v-ordinary[i])>1))
        throw new Error('Revealed cloud did not recover');
    }
    if(layer.integrations!==before+1 || layer.depthCorrections!==4)throw new Error('Depth restarted optical timing');
    return {logarithmic,comparedEndpoints:8,partialPixels,scheduledOpticalFrames:layer.integrations-before};
  }finally{
    layer.dispose();referenceTarget.dispose();depth.dispose();renderer.dispose();
  }
}
