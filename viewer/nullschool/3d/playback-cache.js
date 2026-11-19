// Keep only products for the active 24-hour window and layer configuration.
// Synchronous reads never start a request; loads and image decoding happen ahead of input.
export class PlaybackCache {
  constructor(read, changed, concurrency=2) {
    this.read=read; this.changed=changed; this.concurrency=concurrency;
    this.values=new Map();this.jobs=new Map();this.failed=new Map();this.wanted=new Map();
    this.products=[];this.running=0;
  }
  configure(frames,products,center){
    const index=Math.max(0,frames.findIndex(f=>f.id===center));
    const priority=frames.map((frame,i)=>({frame,distance:Math.min(Math.abs(i-index),frames.length-Math.abs(i-index))}))
      .sort((a,b)=>a.distance-b.distance);
    const wanted=new Map();
    for(const {frame} of priority)for(const product of products)wanted.set(frame.id+'/'+product,{frame,product});
    this.products=products;this.wanted=wanted;
    for(const key of this.values.keys())if(!wanted.has(key))this.values.delete(key);
    for(const [key,since] of this.failed)if(!wanted.has(key)||Date.now()-since>30000)this.failed.delete(key);
    for(const [key,job] of this.jobs)if(!wanted.has(key)){this.jobs.delete(key);job.abort()}
    this.pump();
  }
  has(frame){return this.products.length>0 && this.products.every(p=>this.values.has(frame.id+'/'+p))}
  get(frame,product){return this.values.get(frame.id+'/'+product)}
  get preparing(){
    for(const key of this.wanted.keys())if(!this.values.has(key)&&!this.failed.has(key))return true;
    return false;
  }
  pump(){
    for(const [key,item] of this.wanted){
      if(this.running>=this.concurrency)break;
      if(this.values.has(key)||this.jobs.has(key)||this.failed.has(key))continue;
      const job=new AbortController();this.jobs.set(key,job);this.running++;
      this.read(item.frame,item.product,job.signal).then(value=>{
        if(!job.signal.aborted)this.values.set(key,value);
      }).catch(()=>{
        if(!job.signal.aborted)this.failed.set(key,Date.now());
      }).finally(()=>{
        this.running--;
        if(this.jobs.get(key)===job)this.jobs.delete(key);
        this.pump();this.changed();
      });
    }
  }
}

export async function playbackProduct(frame,product,signal){
  const r=await fetch(`/api/earth/3d/playback-v1/${frame.id}/${product}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
  if(!r.ok)throw new Error('Playback HTTP '+r.status);
  const bytes=await r.arrayBuffer();signal.throwIfAborted();
  const offset=4+new DataView(bytes).getUint32(0,true);
  if(offset%4!==0 || offset>bytes.byteLength)throw new Error('Invalid playback header');
  const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,4,offset-4)));
  if(meta.snapshot!==frame.id || meta.product!==product || meta.valid_time!==frame.valid_time || meta.run_time!==frame.run_time)
    throw new Error('Playback time mismatch');
  if(product==='observation'){
    const info=meta.observation;
    if(info.snapshot!==frame.id || info.model_valid_time!==frame.valid_time)throw new Error('Observation time mismatch');
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes,offset)],{type:'image/png'}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
    if(signal.aborted){image.close();signal.throwIfAborted()}
    return {info,image};
  }
  if(product==='volume'){
    const {shape,wind}=meta;
    if(shape.snapshot!==frame.id || wind.snapshot!==frame.id || shape.valid_time!==frame.valid_time ||
        shape.byte_length!==shape.grid.nx*shape.grid.ny*8 ||
        bytes.byteLength-offset!==shape.byte_length+wind.width*wind.height*6*8)throw new Error('Invalid playback volume');
    return {shape,field:new Uint16Array(bytes,offset,shape.byte_length/2),wind:{...wind,buffer:new Uint16Array(bytes,offset+shape.byte_length)}};
  }
  let cursor=offset;
  const records=meta.headers.map(header=>{
    if(header.refTime!==frame.run_time || header.forecastTime!==frame.forecast_hour)throw new Error('Grid time mismatch');
    const data=new Float32Array(bytes,cursor,header.nx*header.ny);
    cursor+=data.byteLength;return {header,data};
  });
  if(cursor!==bytes.byteLength)throw new Error('Invalid playback grid');
  if(product==='pressure')return {snapshot:frame.id,reference:meta.reference,pressure:records[0]};
  if(records.length!==(product==='surface'?5:6) || records.slice(0,3).some(r=>(r.header.layer||'surface')!==product))throw new Error('Invalid playback layer');
  return {wind:records.slice(0,2),temp:[records[2]],profile:{snapshot:frame.id,layer:product,source:meta.source,run_time:frame.run_time,valid_time:frame.valid_time,
    orography:records[3],surface_pressure:records[4],height:records[5]}};
}
