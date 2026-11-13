'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionMap } = require('../src/sessions');

test('session map stores only ids and survives a reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-sessions-'));
  const file = path.join(dir, 'sessions.json');
  const map = new SessionMap(file);
  map.set('conv-1', { provider: 'codex', providerSessionId: 'th_1', prompt: 'secret passage' });
  assert.deepEqual(map.get('conv-1'), { provider: 'codex', providerSessionId: 'th_1' });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('secret'), false);
  assert.equal(raw.includes('passage'), false);
  const again = new SessionMap(file);
  assert.equal(again.get('conv-1').providerSessionId, 'th_1');
  again.delete('conv-1');
  assert.equal(again.get('conv-1'), null);
  assert.equal(new SessionMap(file).get('conv-1'), null);
});
