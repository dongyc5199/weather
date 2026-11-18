import assert from 'node:assert/strict';
import test from 'node:test';
import { THREE } from './vendor.js';
import { CLOUD_PRESSURES, cloudWindGrid, packCloudWindLayer } from './cloud-wind-data.js';

const manifest={nx:4,ny:3,resolution:90,forecast_hour:6,
  run_time:'2026-11-18T06:00:00Z',valid_time:'2026-11-18T12:00:00Z'};
const records=()=>[3,2].map(number=>({
  header:{parameterCategory:2,parameterNumber:number,parameterUnit:'m.s-1',pressureLevelHpa:700,
    layer:'700hPa',levelType:'isobaricInhPa',refTime:manifest.run_time,forecastTime:6,
    nx:4,ny:3,dx:90,dy:90,la1:90,lo1:0,scanMode:0},
  data:Array(12).fill(number===2?-12.5:3)
}));
const buffer=()=>new Uint16Array(4*3*4*CLOUD_PRESSURES.length);
test('Cloud wind packing preserves component identity, signed velocities, calm and missing data',()=>{
  const input=records(),target=buffer();
  input[0].data[1]=null; input.forEach(r=>r.data[2]=0);
  const info=packCloudWindLayer(input,manifest,700,target,THREE.DataUtils.toHalfFloat);
  const at=i=>Array.from(target.slice(i,i+4),v=>THREE.DataUtils.fromHalfFloat(v));
  const offset=CLOUD_PRESSURES.indexOf(700)*12*4;
  assert.deepEqual(at(offset),[-12.5,3,0,1]);
  assert.deepEqual(at(offset+4),[0,0,0,0]);assert.deepEqual(at(offset+8),[0,0,0,1]);
  assert.deepEqual(at(0),[0,0,0,0]);assert.equal(info.valid,11);
});
test('Cloud wind rejects mismatched time, component, pressure and grid before writing a layer',()=>{
  for(const change of [{forecastTime:0},{refTime:'2026-11-18T00:00:00Z'},{pressureLevelHpa:850},
                       {parameterNumber:2},{dx:1},{la1:89},{parameterUnit:'kt'}]){
    const input=records(),target=buffer();Object.assign(input[0].header,change);
    assert.throws(()=>packCloudWindLayer(input,manifest,700,target,THREE.DataUtils.toHalfFloat),/mismatch/);
    assert.ok(target.every(v=>v===0));
  }
  assert.deepEqual(cloudWindGrid({resolution:.5,nx:720,ny:361}),{width:360,height:181,stride:2});
});
