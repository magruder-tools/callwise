import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPreferences, savePreferences } from '../core/preferences.mjs';
import { CallController } from '../core/controller.mjs';
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: s => Buffer.from('encrypted:' + Buffer.from(s).toString('base64')),
  decryptString: b => {
    if (!b.toString().startsWith('encrypted:')) throw new Error('invalid');
    return Buffer.from(b.toString().slice(10), 'base64').toString();
  },
};
test('defaults survive restart and new calls without retaining call content or consent', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'callwise-prefs-'));
  const file = path.join(dir, 'preferences.bin');
  const make = () => new CallController({preferences:readPreferences(file, storage),
    onPreferences:p => savePreferences(file, storage, p)});
  let c = make();
  try {
    c.contextApps = [{id:'app_one', ready:true}];
    await c.command('configure', {profile:'My working style', quiet:true, mode:'sales',
      goal:'My default goal', project:'My client', contextBackend:'codex',
      contextApps:['app_one'], contextConsent:true, autoSearch:true,
      preferredSource:'manual', preferredBackend:'codex', compact:true,
      consent:true, transcript:'PRIVATE TRANSCRIPT', openaiKey:'NEVER_SAVE_THIS'});
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.doesNotMatch(readFileSync(file).toString(), /My working style/);
    const saved = readPreferences(file, storage);
    for (const key of ['consent','transcript','openaiKey']) assert.equal(saved[key], undefined);
    c.close(); c = make();
    assert.equal(c.snapshot().status, 'idle');
    assert.equal(c.snapshot().settings.profile, 'My working style');
    assert.equal(c.snapshot().preferences.preferredSource, 'manual');
    assert.deepEqual(c.snapshot().settings.contextApps, ['app_one']);
    assert.equal(c.snapshot().settings.contextConsent, true);
    await assert.rejects(c.command('start', {source:'manual'}), /Confirm/);
    await c.command('start', {source:'demo'});
    await c.command('pause');
    await c.command('new');
    assert.equal(c.snapshot().settings.goal, 'My default goal');
    assert.equal(c.snapshot().settings.project, 'My client');
    assert.equal(c.snapshot().settings.quiet, true);
    assert.equal(c.snapshot().transcript.length, 0);
    assert.equal(c.snapshot().capture.mic, 'off');
    assert.equal(c.snapshot().preferences.compact, true);
  } finally { c.close(); rmSync(dir, {recursive:true, force:true}); }
});
test('failed persistence leaves current settings unchanged', async () => {
  const c = new CallController({onPreferences:() => {throw new Error('Disk unavailable');}});
  try {
    await assert.rejects(c.command('configure', {quiet:true}), /Disk unavailable/);
    assert.equal(c.engine.settings.quiet, false);
    assert.equal(c.preferences.quiet, undefined);
  } finally { c.close(); }
});
test('unavailable apps and malformed defaults cannot become saved permissions', async () => {
  let writes = 0;
  const c = new CallController({onPreferences:() => writes++});
  try {
    await assert.rejects(c.command('configure', {contextApps:['unknown'], contextConsent:true}), /marked ready/);
    await assert.rejects(c.command('configure', {preferredSource:'invalid'}), /supported/);
    assert.equal(writes, 0);
    assert.equal(c.engine.settings.contextConsent, false);
  } finally { c.close(); }
});
test('unreadable preferences are preserved and encryption is mandatory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'callwise-prefs-'));
  const file = path.join(dir, 'preferences.bin');
  try {
    writeFileSync(file, 'damaged');
    assert.throws(() => savePreferences(file, storage, {quiet:true}), /not be unlocked/);
    assert.equal(readFileSync(file, 'utf8'), 'damaged');
    assert.throws(() => savePreferences(file, {isEncryptionAvailable:() => false}, {}), /keychain/);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
