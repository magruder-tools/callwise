import test from 'node:test';
import assert from 'node:assert/strict';
import { installDisplayCapture } from '../desktop/display-capture.mjs';
import { describeAudioCapture } from '../ui/capture.mjs';
function harness(getSources, canCapture = () => true) {
  let handler, options;
  installDisplayCapture({setDisplayMediaRequestHandler(h,o){handler=h;options=o;}}, {getSources}, canCapture);
  return { options, request: async () => { let result; await handler({frame:{}}, value=>{result=value;}); return result; } };
}
test('audio capture grants video plus nonmuting loopback through its handler', async () => {
  const screen = {id:'screen:1',name:'Screen'};
  const h=harness(async()=>[screen]);
  assert.equal(h.options.useSystemPicker,false);
  assert.deepEqual(await h.request(), {video:screen,audio:'loopback'});
});
test('a capture request cannot outlive its authorized session', async () => {
  let active=true;
  const h=harness(async()=>{active=false;return [{id:'screen:1'}];},()=>active);
  assert.deepEqual(await h.request(),{});
});
test('failed or denied display capture grants no stream', async () => {
  assert.deepEqual(await harness(async()=>{throw Error('denied');}).request(),{});
  let called=false;
  assert.deepEqual(await harness(async()=>{called=true;return [];},()=>false).request(),{});
  assert.equal(called,false);
});
test('connected transcription sockets are not reported as captured audio', () => {
  assert.equal(describeAudioCapture({mic:'connected',system:'connected'}),'Mic: starting · Computer: starting');
  assert.equal(describeAudioCapture({mic:'receiving',system:'listening'}),'Mic: receiving · Computer: listening');
  assert.equal(describeAudioCapture({mic:'listening',system:'No signal yet — verify audio'}),'Mic: listening · Computer: no signal yet');
});
