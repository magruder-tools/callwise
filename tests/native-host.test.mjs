import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { NativeHost } from '../desktop/native-host.mjs';
function fake() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}; child.stderr = new EventEmitter(); child.exitCode = null;
  child.stdin = { writableLength: 0, write: line => { child.last = JSON.parse(line); }, destroy() {} };
  child.kill = signal => { child.killed = signal; child.exitCode = 0; };
  const host = new NativeHost({ binary: '/fixed/helper', mode: 'speech', spawnProcess: (_binary, args, options) => { child.args = args; child.options = options; return child; } });
  return { child, host };
}
test('native protocol correlates split frames, uses fixed arguments and discards arbitrary stderr', async () => { const { child, host } = fake(), messages = []; host.on('message', m => messages.push(m)); const result = host.request('start', { language: 'en-US' }); const line = JSON.stringify({ type: 'result', id: child.last.id, value: { ready: true } }) + '\n'; child.stdout.emit('data', line.slice(0, 20)); child.stderr.emit('data', 'SECRET raw transcript'); child.stdout.emit('data', line.slice(20)); assert.deepEqual(await result, { ready: true }); assert.deepEqual(messages, []); assert.deepEqual(child.args, ['speech']); assert.equal(child.options.shell, false); host.close(); });
test('invalid native JSON fails pending work and terminates the process', async () => { const { child, host } = fake(), promise = host.request('start'); child.stdout.emit('data', 'not json\n'); await assert.rejects(promise, /invalid response/); assert.equal(child.killed, 'SIGTERM'); });
test('aborted native work cannot accept a late response', async () => { const { child, host } = fake(), signal = new AbortController(), promise = host.request('start', {}, { signal: signal.signal }); const id = child.last.id; signal.abort(); await assert.rejects(promise, /cancelled/); child.stdout.emit('data', JSON.stringify({ type: 'result', id, value: {} }) + '\n'); assert.equal(host.pending.size, 0); assert.equal(host.closed, true); });
