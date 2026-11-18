/** Synthetic L-shaped observed cloud: retain its notch and long arm through a zoom sweep. */
export async function checkCloudFootprint() {
  const {THREE,WGS84_ELLIPSOID}=await import('./vendor.js');
  const {CloudLayer}=await import('./cloud-layer.js');
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(192,192);renderer.setPixelRatio(1);
  const layer=new CloudLayer();layer.snapshot='shape-test';layer.enabled=true;
  const rgba=new Uint8Array(4096*2048*4);
  for(let y=1021;y<=1027;y++)for(let x=2046;x<=2052;x++)if(x<=2047 || y>=1026){
    const i=(y*4096+x)*4;rgba.set([255,128,255,255],i);
  }
  const reference=new THREE.DataTexture(rgba,4096,2048);reference.needsUpdate=true;reference.wrapS=THREE.RepeatWrapping;
  reference.minFilter=reference.magFilter=THREE.LinearFilter;
  layer.reference=reference;layer.observationLoadedAt=performance.now()-2000;
  layer.material.uniforms.reference.value=reference;layer.material.uniforms.hasReference.value=true;
  const grid={nx:81,ny:81,lo1:-2,la1:2,dx:.05,dy:.05};
  const field=new Uint16Array(81*81*4);
  for(let i=0;i<81*81;i++)[.8,.04,.48,1].forEach((v,c)=>field[i*4+c]=THREE.DataUtils.toHalfFloat(v));
  const profile={snapshot:'shape-test',encoding:'rgba16f-le',height_range_m:25000,grid,regions:[[0,0,1000,12000,250000]]};
  layer.setShape(profile,field.buffer);layer.convectiveLoadedAt=layer.volumeLoadedAt=performance.now()-2000;
  const camera=new THREE.PerspectiveCamera(140,1,100,1e9);camera.up.set(0,0,1);
  function pixel(lon,lat,pixels) {
    const p=WGS84_ELLIPSOID.getCartographicToPosition(lat*Math.PI/180,lon*Math.PI/180,12000,new THREE.Vector3()).project(camera);
    const x=Math.floor((p.x*.5+.5)*layer.target.width),y=Math.floor((p.y*.5+.5)*layer.target.height);
    if(x<0||y<0||x>=layer.target.width||y>=layer.target.height)throw new Error('Footprint probe left the viewport');
    return pixels[(y*layer.target.width+x)*4+3];
  }
  // Probe inside the long arm; edge pixels legitimately have fractional coverage.
  const rows=[];
  for(const altitude of [24000,45000,60000,80000]){
    camera.position.set(6378137+altitude,0,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();layer.render(renderer,camera);
    const pixels=new Uint8Array(layer.target.width*layer.target.height*4);
    renderer.readRenderTargetPixels(layer.target,0,0,layer.target.width,layer.target.height,pixels);
    rows.push({altitude,longArm:pixel(-.09,.17,pixels),notch:pixel(.22,.04,pixels)});
  }
  camera.position.set(6378137+24000,0,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();layer.render(renderer,camera);
  const before=new Uint8Array(layer.target.width*layer.target.height*4);renderer.readRenderTargetPixels(layer.target,0,0,layer.target.width,layer.target.height,before);
  layer.setShape({...profile,regions:[[0,0,1000,12000,400000]]},field.buffer);
  layer.convectiveLoadedAt=layer.volumeLoadedAt=performance.now()-2000;layer.render(renderer,camera);
  const after=new Uint8Array(layer.target.width*layer.target.height*4);renderer.readRenderTargetPixels(layer.target,0,0,layer.target.width,layer.target.height,after);
  let changed=0;for(let i=3;i<before.length;i+=4)if(before[i]!==after[i])changed++;
  layer.dispose();renderer.dispose();renderer.forceContextLoss();
  if(rows.some(row=>row.longArm<190 || row.notch>2) || changed!==0)throw new Error('Cloud footprint regression: '+JSON.stringify({rows,changed}));
  return {rows,pixelsChangedByBounds:changed};
}
