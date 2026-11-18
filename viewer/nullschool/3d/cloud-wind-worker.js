import { THREE } from './vendor.js';
import { CLOUD_PRESSURES, cloudWindGrid, packCloudWindLayer } from './cloud-wind-data.js';

self.onmessage = async ({data: manifest}) => {
  try {
    const {width,height}=cloudWindGrid(manifest);
    const pixels=new Uint16Array(width*height*4*CLOUD_PRESSURES.length);
    const levels=[];
    let maxSpeed=0;
    // One source JSON in memory at a time. Missing pressure levels keep their
    // zero validity mask; never substitute another level or forecast cycle.
    for (const pressure of CLOUD_PRESSURES) {
      const layer=pressure+'hPa', path=manifest.layers?.[layer]?.files?.wind;
      if (!path) continue;
      if (path !== 'data/live/'+manifest.id+'/'+layer+'/wind.json') throw new Error('Unexpected wind source');
      const response=await fetch(new URL('../'+path,import.meta.url),{signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error('Wind HTTP '+response.status);
      const result=packCloudWindLayer(await response.json(),manifest,pressure,pixels,THREE.DataUtils.toHalfFloat);
      if (result.valid) levels.push(pressure);
      maxSpeed=Math.max(maxSpeed,result.maxSpeed);
    }
    self.postMessage({snapshot:manifest.id,width,height,levels,maxSpeed,buffer:pixels.buffer},[pixels.buffer]);
  } catch(error) {
    self.postMessage({error:error.message});
  }
};
