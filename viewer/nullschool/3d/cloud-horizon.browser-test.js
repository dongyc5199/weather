/** Real WebGL regression: synthetic white imagery, never an observed weather reconstruction.
 * Run checkCloudHorizon() in a browser served from this directory.
 * A double-precision CPU ellipsoid intersection classifies sky independently of the shader.
 */
export async function checkCloudHorizon() {
  const {THREE}=await import('./vendor.js');const {CloudLayer}=await import('./cloud-layer.js');
  const a=6378137,b=6356752.314245,size=96;
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(size,size);renderer.setPixelRatio(1);
  const camera=new THREE.PerspectiveCamera(38,1,100,1e9);camera.position.set(a+120000,0,0);camera.up.set(1,0,0);
  const tangent=new THREE.Vector3(-Math.sqrt(1-(a/(a+120000))**2),a/(a+120000),0);
  camera.lookAt(camera.position.clone().addScaledVector(tangent,100000));camera.updateMatrixWorld();
  const layer=new CloudLayer();layer.snapshot='gpu-case';layer.enabled=true;
  const reference=new THREE.DataTexture(new Uint8Array([255,128,255,255]),1,1);reference.needsUpdate=true;
  layer.reference=reference;layer.observationLoadedAt=performance.now()-1000;
  layer.material.uniforms.reference.value=reference;layer.material.uniforms.hasReference.value=true;
  layer.render(renderer,camera);
  const pixels=new Uint8Array(layer.target.width*layer.target.height*4);renderer.readRenderTargetPixels(layer.target,0,0,layer.target.width,layer.target.height,pixels);
  let skyPixels=0,falseSkyPixels=0,groundCloudPixels=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const view=new THREE.Vector3((x+.5)/size*2-1,(y+.5)/size*2-1,1).unproject(camera).sub(camera.position).normalize();
   const origin=camera.position.clone().divide(new THREE.Vector3(a,a,b));
   const direction=view.divide(new THREE.Vector3(a,a,b)).normalize();
   const B=origin.dot(direction),C=origin.lengthSq()-1,D=B*B-C;
   const hit=D>=0&&-B-Math.sqrt(D)>0;
   const alpha=pixels[(y*size+x)*4+3];
   if(!hit){skyPixels++;if(alpha>2)falseSkyPixels++;}else if(alpha>2)groundCloudPixels++;
  }
  function attachColumn(layer,lon,bottom,top) {
    const grid={nx:64,ny:64,lo1:lon-.32,la1:.32,dx:.01,dy:.01};
    const data=new Uint16Array(64*64*4);
    for(let y=24;y<=40;y++)for(let x=24;x<=40;x++){
      const index=(y*64+x)*4;
      [.8,bottom/25000,top/25000,1].forEach((v,c)=>data[index+c]=THREE.DataUtils.toHalfFloat(v));
    }
    layer.setShape({snapshot:'gpu-case',encoding:'rgba16f-le',height_range_m:25000,grid,regions:[[lon,0,bottom,top,24000]]},data.buffer);
  }
  const volume=new CloudLayer();volume.snapshot='gpu-case';volume.enabled=true;
  volume.reference=reference.clone();volume.reference.needsUpdate=true;volume.observationLoadedAt=performance.now()-1000;
  volume.material.uniforms.reference.value=volume.reference;volume.material.uniforms.hasReference.value=true;
  attachColumn(volume,.24,1000,12000);
  volume.convectiveLoadedAt=volume.volumeLoadedAt=performance.now()-1000;
  camera.position.set(a+6000,0,0);camera.up.set(1,0,0);camera.lookAt(a+6000,30000,0);camera.updateMatrixWorld();
  volume.render(renderer,camera);
  const w=volume.target.width,h=volume.target.height;const p=new Uint8Array(w*h*4);renderer.readRenderTargetPixels(volume.target,0,0,w,h,p);
  const centerAlpha=p[(Math.floor(h/2)*w+Math.floor(w/2))*4+3];
  camera.near=1;camera.far=1e9;camera.updateProjectionMatrix();volume.render(renderer,camera);
  const highRatio=new Uint8Array(w*h*4);renderer.readRenderTargetPixels(volume.target,0,0,w,h,highRatio);
  const highRatioVolumeAlpha=highRatio[(Math.floor(h/2)*w+Math.floor(w/2))*4+3];
  // A downward view below a known 8 km cloud base must not paint white on the sea.
  attachColumn(volume,0,8000,12000);
  volume.convectiveLoadedAt=volume.volumeLoadedAt=performance.now()-1000;
  camera.up.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld();volume.render(renderer,camera);
  const sea=new Uint8Array(volume.target.width*volume.target.height*4);renderer.readRenderTargetPixels(volume.target,0,0,volume.target.width,volume.target.height,sea);
  let seaCloudPixels=0;for(let i=3;i<sea.length;i+=4)if(sea[i]>2)seaCloudPixels++;
  const unavailable=new CloudLayer();unavailable.snapshot='gpu-case';unavailable.enabled=true;
  unavailable.reference=reference.clone();unavailable.reference.needsUpdate=true;unavailable.observationLoadedAt=performance.now()-1000;
  unavailable.material.uniforms.reference.value=unavailable.reference;unavailable.material.uniforms.hasReference.value=true;
  unavailable.render(renderer,camera);
  const missingHeightsPaintedSea=unavailable.target!==null;
  unavailable.dispose();
  // A confident model column must not amplify an almost-clear observation into a white cap.
  volume.reference.dispose();
  volume.reference=new THREE.DataTexture(new Uint8Array([3,128,255,255]),1,1);volume.reference.needsUpdate=true;
  volume.material.uniforms.reference.value=volume.reference;volume.observationLoadedAt=performance.now()-1000;
  attachColumn(volume,0,1000,12000);volume.convectiveLoadedAt=volume.volumeLoadedAt=performance.now()-1000;
  camera.position.set(a+18000,0,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();volume.render(renderer,camera);
  const clear=new Uint8Array(volume.target.width*volume.target.height*4);renderer.readRenderTargetPixels(volume.target,0,0,volume.target.width,volume.target.height,clear);
  let clearPixels=0;for(let i=3;i<clear.length;i+=4)if(clear[i]>2)clearPixels++;
  const out={skyPixels,falseSkyPixels,groundCloudPixels,centerVolumeAlpha:centerAlpha,highRatioVolumeAlpha,seaCloudPixels,missingHeightsPaintedSea,clearPixels,volumeBlend:volume.material.uniforms.volumeBlend.value};
  layer.dispose();volume.dispose();renderer.dispose();renderer.forceContextLoss();
  if (out.falseSkyPixels !== 0 || out.groundCloudPixels === 0 || out.centerVolumeAlpha < 200 || out.highRatioVolumeAlpha < 200 || out.seaCloudPixels !== 0 || out.missingHeightsPaintedSea || out.clearPixels!==0)
    throw new Error('Cloud horizon GPU regression: ' + JSON.stringify(out));
  return out;
}
