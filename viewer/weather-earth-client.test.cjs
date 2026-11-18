const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('iframe requests keep their routing fields and only accept matching replies', async () => {
  const origin = 'https://weather.example';
  const window = {setTimeout, clearTimeout, location:{href:origin}, addEventListener(){}, removeEventListener(){}};
  const source = fs.readFileSync(require.resolve('./weather-earth-client.js'), 'utf8');
  vm.runInNewContext(source, {window, URL});
  let sent;
  const receiver = {postMessage(message){sent = message;}};
  const client = new window.WeatherEarthClient({getAttribute:()=>origin, contentWindow:receiver,
    addEventListener(){},removeEventListener(){}});
  client.markReady();
  const request = client.send('set-raster-overlay', {target:'other', type:'cloud',requestId:'wrong',overlayType:'cloud'}, {requestId:'fixed',waitForReady:false});
  assert.equal(sent.type,'set-raster-overlay');
  assert.equal(sent.target,'weather-earth');
  assert.equal(sent.requestId,'fixed');
  await assert.rejects(client.send('ping', {}, {requestId:'fixed'}), /pending/);
  const reply = {target:'weather-earth-client',type:'response',requestId:'fixed',result:'ok'};
  client.handleMessage({source:receiver, origin:'https://other.example', data:reply});
  assert.equal(client.pending.size,1);
  client.handleMessage({source:receiver, origin, data:reply});
  assert.equal(await request,'ok');
  receiver.postMessage = () => {throw new Error('uncloneable');};
  await assert.rejects(client.send('ping'), /uncloneable/);
  assert.equal(client.pending.size,0);
  client.destroy();
});
