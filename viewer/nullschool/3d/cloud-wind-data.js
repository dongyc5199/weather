// The cloud height field uses standard pressure altitude. The wind stack uses
// the same vertical coordinate, independent of the user's wind-line level.
export const CLOUD_PRESSURES = [1000, 850, 700, 500, 250, 70];

export function cloudWindGrid(manifest) {
  const { nx, ny, resolution } = manifest;
  const stride = Math.max(1, Math.round(1 / resolution));
  if (!(resolution > 0) || !Number.isInteger(nx) || !Number.isInteger(ny) ||
      Math.abs(nx * resolution - 360) > 1e-5 || Math.abs((ny-1)*resolution-180) > 1e-5 ||
      nx % stride || (ny-1) % stride)
    throw new Error('Unsupported cloud wind grid');
  return { width: nx / stride, height: (ny-1) / stride + 1, stride };
}

export function packCloudWindLayer(records, manifest, level, target, half) {
  const grid = cloudWindGrid(manifest);
  const slot = CLOUD_PRESSURES.indexOf(level);
  if (slot < 0 || !Array.isArray(records) || records.length !== 2 ||
      target.length !== grid.width * grid.height * CLOUD_PRESSURES.length * 4)
    throw new Error('Invalid cloud wind layer');
  const components = [2,3].map(number => {
    const record = records.find(r => r?.header?.parameterNumber === number);
    const h = record?.header;
    if (!h || h.parameterCategory !== 2 || h.parameterUnit !== 'm.s-1' ||
        h.levelType !== 'isobaricInhPa' || h.pressureLevelHpa !== level || h.layer !== level+'hPa' ||
        h.refTime !== manifest.run_time || h.forecastTime !== manifest.forecast_hour ||
        Date.parse(h.refTime) + h.forecastTime * 3600000 !== Date.parse(manifest.valid_time) ||
        h.nx !== manifest.nx || h.ny !== manifest.ny || h.dx !== manifest.resolution ||
        h.dy !== h.dx || h.la1 !== 90 || h.lo1 !== 0 || h.scanMode !== 0 ||
        record.data?.length !== h.nx*h.ny) throw new Error('Cloud wind identity mismatch');
    return record.data;
  });
  const [u,v] = components;
  let maxSpeed = 0, valid = 0;
  for (let y=0; y<grid.height; y++) for (let x=0; x<grid.width; x++) {
    const src = (y*manifest.nx+x)*grid.stride;
    const dest = ((slot*grid.height+y)*grid.width+x)*4;
    if (!Number.isFinite(u[src]) || !Number.isFinite(v[src])) continue;
    target[dest]=half(u[src]); target[dest+1]=half(v[src]); target[dest+3]=half(1);
    maxSpeed=Math.max(maxSpeed,Math.hypot(u[src],v[src])); valid++;
  }
  return {valid,maxSpeed};
}
