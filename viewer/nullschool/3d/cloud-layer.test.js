import test from "node:test";
import assert from "node:assert/strict";
import { THREE } from "./vendor.js";
import { CloudLayer } from "./cloud-layer.js";
import { pressureAltitude } from "./cloud-data.js";

function profile(snapshot = "forecast-a") {
  const header = {
    nx: 4,
    ny: 3,
    dx: 90,
    dy: 90,
    la1: 90,
    lo1: 0,
    refTime: "2026-11-11T00:00Z",
    forecastTime: 3,
  };
  const field = (value) => ({
    header: { ...header },
    data: Array(12).fill(value),
  });
  return {
    snapshot,
    bands: ["low", "middle", "high"].map((name) => ({
      name,
      cover: field(80),
      bottom: field(90000),
      top: field(70000),
    })),
  };
}

test("GPU cloud boundaries preserve pressure altitude without display scaling", () => {
  const layer = new CloudLayer();
  layer.setData(profile());
  for (const texture of layer.textures) {
    const encoded = texture.image.data;
    const bottom = THREE.DataUtils.fromHalfFloat(encoded[1]) * 25000;
    const top = THREE.DataUtils.fromHalfFloat(encoded[2]) * 25000;
    assert.ok(Math.abs(bottom - pressureAltitude(90000)) < 2);
    assert.ok(Math.abs(top - pressureAltitude(70000)) < 3);
    assert.equal(texture.type, THREE.HalfFloatType);
  }
  assert.equal(layer.setHeightScale, undefined);
  layer.dispose();
});

test("A failed cloud update keeps the last valid GPU dataset and disposes replaced textures", () => {
  const layer = new CloudLayer();
  layer.setData(profile());
  layer.enabled = true;
  const textures = [...layer.textures];
  let disposed = 0;
  textures.forEach((texture) =>
    texture.addEventListener("dispose", () => disposed++),
  );
  const invalid = profile("forecast-b");
  invalid.bands[1].top.header.forecastTime = 6;
  assert.throws(() => layer.setData(invalid), /identity/);
  assert.equal(layer.snapshot, "forecast-a");
  assert.equal(layer.enabled, true);
  assert.deepEqual(layer.textures, textures);
  assert.equal(disposed, 0);
  layer.setData(profile("forecast-c"));
  assert.equal(disposed, 3);
  layer.dispose();
});

test("Satellite imagery can display alone; depth and cloud-height buffers are only required nearby", async (t) => {
  const observation = new THREE.DataTexture(
    new Uint8Array([180, 0, 0, 255]),
    1,
    1,
  );
  t.mock.method(
    THREE.TextureLoader.prototype,
    "loadAsync",
    async () => observation,
  );
  const layer = new CloudLayer();
  await layer.setObservation({
    snapshot: "forecast-a",
    texture_url: "/observation.png",
    observation_time: "2026-11-11T00:00Z",
    source: "test observation",
  });
  layer.enabled = true;
  assert.equal(layer.enabled, true);
  assert.equal(layer.textures.length, 0);
  assert.equal(layer.getState().volumeDataReady, false);
  const camera = new THREE.PerspectiveCamera(42, 1.5, 100, 1e9);
  camera.position.set(6378137 + 500000, 0, 0);
  layer.updateView(camera);
  assert.equal(layer.requiresTerrainDepth, false);
  layer.setData(profile());
  assert.equal(layer.reference, observation);
  assert.equal(layer.requiresTerrainDepth, false); // Preloaded height data never forces regional 3D.
  camera.position.set(6378137 + 20000, 0, 0);
  camera.lookAt(0,0,0);
  layer.updateView(camera);
  assert.equal(layer.requiresTerrainDepth, false); // Averaged bands alone are not rendered volumes.
  layer.setConvection({snapshot:"forecast-a",column:profile().bands[0],cores:[{lon:0,lat:0,bottom:1000,top:12000,radius:4000,anvil_radius:14000,cover:.8}]});
  layer.updateView(camera);
  assert.equal(layer.requiresTerrainDepth, true);
  layer.dispose();
});

test("Convective height diagnostics survive a same-snapshot band refresh", () => {
  const layer = new CloudLayer();
  layer.setData(profile());
  const column = profile().bands[0];
  column.top.data[7] = 50000;
  layer.setConvection({ snapshot: "forecast-a", column });
  const texture = layer.convectiveTexture;
  const point = layer.sampleConvection(-90, 0);
  assert.ok(Math.abs(point.top - pressureAltitude(50000)) < 5);
  assert.ok(point.top > point.bottom);
  layer.setData(profile());
  assert.equal(layer.convectiveTexture, texture);
  assert.equal(layer.getState().convectiveDataReady, true);
  assert.throws(
    () => layer.setConvection({ snapshot: "forecast-b", column }),
    /snapshot/,
  );
  assert.equal(layer.convectiveTexture, texture);
  layer.dispose();
});

test("Only nearby valid compact cores enter the GPU budget and survive refresh", () => {
  const layer = new CloudLayer();
  layer.setData(profile());
  const core = {lon:0,lat:0,bottom:1000,top:12000,radius:4000,anvil_radius:14000,cover:.8};
  layer.setConvection({snapshot:"forecast-a",column:profile().bands[0],cores:[core,{...core,lon:180},{...core,top:0}]});
  const camera=new THREE.PerspectiveCamera();
  camera.position.set(6378137+20000,0,0);camera.lookAt(0,0,0);
  layer.updateView(camera);
  assert.equal(layer.getState().inferredCores,2);
  assert.equal(layer.getState().nearbyCores,1);
  assert.equal(layer.material.uniforms.coreBounds.value[0].y,12000);
  layer.setData(profile());
  layer.updateView(camera);
  assert.equal(layer.getState().nearbyCores,1);
  layer.clear();
  assert.equal(layer.getState().nearbyCores,0);
  layer.dispose();
});

test("Compact bounds cannot manufacture cloud geometry without a geographic height field",()=>{
 const layer=new CloudLayer();layer.snapshot='forecast-a';
 layer.setConvection({snapshot:'forecast-a',cores:[{lon:0,lat:0,bottom:1000,top:12000,radius:4000,anvil_radius:14000,cover:.8}],point_url:'/point'});
 const camera=new THREE.PerspectiveCamera();camera.position.set(6378137+20000,0,0);camera.lookAt(0,0,0);layer.updateView(camera);
 assert.equal(layer.getState().volumeDataReady,false);
 assert.equal(layer.getState().nearbyCores,1);
 assert.equal(layer.convectiveTexture,null);assert.equal(layer.textures.length,0);
 assert.equal(layer.pointUrl,'/point');
 layer.setData(profile());assert.equal(layer.pointUrl,'/point');assert.equal(layer.getState().inferredCores,1);
 layer.dispose();
});

test("Cloud renders without terrain input ignore tile revisions",()=>{
 const layer=new CloudLayer();layer.snapshot='forecast-a';layer.enabled=true;
 layer.setConvection({snapshot:'forecast-a',column:profile().bands[0],cores:[{lon:0,lat:0,bottom:1000,top:12000,radius:4000,anvil_radius:14000,cover:.8}]});
 layer.convectiveLoadedAt=layer.volumeLoadedAt=performance.now()-2000;
 const camera=new THREE.PerspectiveCamera(42,1,100,1e9);camera.position.set(6378137+20000,0,0);camera.lookAt(0,0,0);
 layer.lastPosition.copy(camera.position);layer.lastQuaternion.copy(camera.quaternion);
 const renderer={autoClear:true,getRenderTarget:()=>null,getDrawingBufferSize:size=>size.set(800,800),setRenderTarget:()=>{},render:()=>{}};
 layer.render(renderer,camera);const first=layer.integrations;
 layer.render(renderer,camera);layer.render(renderer,camera);
 assert.equal(layer.integrations,first);
 layer.setDepthRevision('new-ground');layer.render(renderer,camera);
 assert.equal(layer.integrations,first);
 assert.equal(layer.depthCorrections,0);
 layer.lastMotionAt=-Infinity;layer.updateView(camera);assert.equal(layer.moving,false);
 camera.aspect=1.2;camera.updateProjectionMatrix();layer.updateView(camera);assert.equal(layer.moving,true);
 camera.position.y+=100;camera.lookAt(0,0,0);layer.render(renderer,camera);
 assert.equal(layer.getState().moving,true);assert.equal(layer.target.width,448);
 layer.dispose();
});
test("An offscreen core does not force near-view depth capture",()=>{
 const layer=new CloudLayer();layer.snapshot='forecast-a';layer.enabled=true;
 layer.setConvection({snapshot:'forecast-a',cores:[{lon:0,lat:0,bottom:1000,top:12000,radius:1000,anvil_radius:2000,cover:.8}]});
 const camera=new THREE.PerspectiveCamera(42,1,100,1e9);camera.position.set(6378137+20000,0,0);camera.lookAt(6378137+50000,0,0);
 layer.updateView(camera);assert.equal(layer.getState().nearbyCores,0);assert.equal(layer.requiresTerrainDepth,false);
 layer.dispose();
});

test("Geographic half-float fields keep their shape and heights independently of acceleration bounds",()=>{
 const layer=new CloudLayer();layer.snapshot='forecast-a';
 const grid={nx:4,ny:3,lo1:0,la1:90,dx:90,dy:90};
 const pixels=new Uint16Array(4*3*4);
 for(const index of [4,8,9])for(const [channel,value]of[.8,.08,.48,1].entries())pixels[index*4+channel]=THREE.DataUtils.toHalfFloat(value);
 const shape={snapshot:'forecast-a',encoding:'rgba16f-le',height_range_m:25000,grid,regions:[[0,0,1000,12000,100000]],point_url:'/point'};
 layer.setShape(shape,pixels.buffer);
 assert.equal(layer.material.uniforms.hasColumnField.value,true);
 assert.deepEqual(Array.from(layer.convectiveTexture.image.data),Array.from(pixels));
 const texture=layer.convectiveTexture;
 assert.throws(()=>layer.setShape({...shape,snapshot:'other'},pixels.buffer),/snapshot/);
 assert.throws(()=>layer.setShape(shape,new ArrayBuffer(4)),/Invalid/);
 assert.equal(layer.convectiveTexture,texture);
 layer.setShape({...shape,regions:[[0,0,1000,12000,200000]]},pixels.buffer);
 assert.deepEqual(Array.from(layer.convectiveTexture.image.data),Array.from(pixels));
 layer.dispose();
});

test("A dense region list merges overflow instead of clipping cloud geometry at its budget",()=>{
 const layer=new CloudLayer();layer.snapshot='forecast-a';
 const grid={nx:4,ny:3,lo1:0,la1:90,dx:90,dy:90};
 const field=new Uint16Array(48);for(let i=0;i<12;i++)[.8,.04,.6,1].forEach((v,c)=>field[i*4+c]=THREE.DataUtils.toHalfFloat(v));
 const regions=Array.from({length:40},(_,i)=>[i*.001,0,1000,12000+i,20000]);
 layer.setShape({snapshot:'forecast-a',encoding:'rgba16f-le',height_range_m:25000,grid,regions},field.buffer);
 const camera=new THREE.PerspectiveCamera(42,1,100,1e9);camera.position.set(6378137+20000,0,0);camera.lookAt(0,0,0);
 layer.updateView(camera);
 assert.equal(layer.getState().candidateRegions,40);assert.equal(layer.getState().nearbyRegions,32);
 assert.ok(layer.material.uniforms.coreBounds.value[31].y>=12039);
 layer.dispose();
});

test("Regional culling remains conservative at the date line and poles, and skips orbital views", () => {
  const layer = new CloudLayer();
  layer.snapshot = "forecast-a";
  layer.enabled = true;
  const radius = 6378137, radians = Math.PI / 180;
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 1e9);
  for (const lat of [0, 89.9, -89.9]) {
    layer.setConvection({snapshot:"forecast-a", cores:[
      {lon:-179.99, lat, bottom:1000, top:12000, radius:4000, anvil_radius:14000, cover:.8},
    ]});
    const lon = 179.99 * radians, angle = lat * radians;
    const direction = new THREE.Vector3(Math.cos(lon)*Math.cos(angle), Math.sin(lon)*Math.cos(angle), Math.sin(angle));
    camera.position.copy(direction).multiplyScalar(radius + 20000);
    camera.lookAt(0,0,0);
    layer.updateView(camera);
    assert.equal(layer.getState().candidateRegions,1);
    camera.position.copy(direction).multiplyScalar(radius + 500000);
    camera.lookAt(0,0,0);
    layer.updateView(camera);
    assert.equal(layer.getState().candidateRegions,0);
  }
  layer.dispose();
});

test("Terrain revisions correct both wind keyframes without resetting the blend clock",t=>{
  let clock=5000;
  t.mock.method(performance,'now',()=>clock);
  const layer=new CloudLayer();layer.snapshot='forecast-a';layer.enabled=true;
  layer.setConvection({snapshot:'forecast-a',column:profile().bands[0],cores:[
    {lon:0,lat:0,bottom:1000,top:12000,radius:4000,anvil_radius:14000,cover:.8}]});
  const field={snapshot:'forecast-a',width:4,height:3,buffer:new ArrayBuffer(4*3*6*8),levels:[700],maxSpeed:12};
  assert.equal(layer.setWindField({...field,snapshot:'forecast-b'}),false);
  assert.equal(layer.setWindField(field),true);
  const camera=new THREE.PerspectiveCamera(42,1,100,1e9);
  camera.position.set(6378137+20000,0,0);camera.up.set(0,0,1);camera.lookAt(0,0,0);
  const renderer={autoClear:true,getRenderTarget:()=>null,getDrawingBufferSize:s=>s.set(400,400),setRenderTarget(){},render(){}};
  const depth=new THREE.Texture();
  layer.setTerrainDepth(depth,{far:camera.far,logarithmic:true});
  layer.render(renderer,camera);clock+=1000;layer.render(renderer,camera);
  const original=layer.target;
  clock+=160;layer.render(renderer,camera);
  assert.notEqual(layer.target,original);
  assert.equal(layer.compositeMaterial.uniforms.fraction.value,0);
  const integrations=layer.integrations;
  clock+=75;layer.render(renderer,camera);
  assert.equal(layer.integrations,integrations);
  assert.equal(layer.compositeMaterial.uniforms.fraction.value,.5);
  const started=layer.blendStartedAt, optical=layer.lastOpticalFrame;
  layer.setDepthRevision('changed');layer.render(renderer,camera);
  assert.equal(layer.compositeMaterial.uniforms.fraction.value,.5);
  assert.equal(layer.integrations,integrations);assert.equal(layer.depthCorrections,1);
  assert.equal(layer.blendStartedAt,started);assert.equal(layer.lastOpticalFrame,optical);
  clock+=75;layer.setDepthRevision('next');layer.render(renderer,camera);
  assert.equal(layer.integrations,integrations+1);assert.equal(layer.depthCorrections,2);
  assert.equal(layer.compositeMaterial.uniforms.fraction.value,0);
  camera.position.x+=500000;camera.lookAt(0,0,0);layer.render(renderer,camera);
  assert.equal(layer.getState().advectingDetail,false);
  const orbital=layer.integrations;const corrections=layer.depthCorrections;
  layer.setTerrainDepth(new THREE.Texture(),{far:camera.far,logarithmic:true});
  layer.setDepthRevision('orbital-terrain');layer.render(renderer,camera);
  assert.equal(layer.integrations,orbital);assert.equal(layer.depthCorrections,corrections);
  layer.clear();assert.equal(layer.windSnapshot,null);
  assert.equal(layer.material.uniforms.hasWind.value,false);layer.dispose();
});

test("A missing display mask falls back to the same observation's scientific PNG",async t=>{
  const layer=new CloudLayer(),urls=[];
  const texture=new THREE.DataTexture(new Uint8Array([180,121,53,255]),1,1);
  t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async url=>{
    urls.push(url);
    if(url.endsWith('.webp'))throw new Error('Display mask unavailable');
    return texture;
  });
  const info={snapshot:'a',observation_time:'2026-11-18T14:00:00Z',
    texture_url:'/a/mask.png',render_texture_url:'/a/cloud-ra-v1.webp'};
  assert.equal(await layer.setObservation(info),true);
  assert.deepEqual(urls,[info.render_texture_url,info.texture_url]);
  assert.equal(layer.reference,texture);layer.dispose();
});
