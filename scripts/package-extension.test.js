'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { packageExtension } = require('./package-extension');
const { readZip } = require('./zip-store');

const repo = path.resolve(__dirname, '..');
const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtpXCR/seO7KyqSPca07/8j7/Mmf0RP+TBIWCFHI/nXSXftw2ltsqevRaEsHviygE9edReN7QgVOOz/A8bQwDFErd+VSYPfkn9WiAsYi4gcD5MDl4GLkCz7nm5rluzxGvVuAzd15fVYZQJlaT3EuEflgG4V3u4sca9nmhmqe/vUtZI3Dmh7kavzRJJN6u0s9vLK/89+LW66sqCqKAHE6ileectdS5/3uGtg1K97KEteQVSq7jjnrcGd4lMKJ+y9EUrJEYFuugde5pYzF4uGK3Qt0NiF8yLLhJ08PrkZO6gH1dl/f6t4kpABPNNug9BFfOKSjx8CVzWyQPqiD2Eo+scQIDAQAB';

test('the store zip is extension files only and its manifest has no key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-zip-'));
  const outPath = path.join(dir, 'store.zip');
  const sourcePath = path.join(repo, 'extension', 'manifest.json');
  const sourceBefore = fs.readFileSync(sourcePath, 'utf8');
  const result = packageExtension({ repoRoot: repo, outPath });
  const sourceAfter = fs.readFileSync(sourcePath, 'utf8');
  assert.equal(sourceAfter, sourceBefore);
  const source = JSON.parse(sourceBefore);
  assert.equal(source.key, KEY);
  assert.equal(source.short_name, 'DC AI');
  assert.ok([...source.short_name].length <= 12);

  const packed = readZip(fs.readFileSync(outPath));
  const names = packed.map((file) => file.name).sort();
  assert.ok(names.includes('manifest.json'));
  assert.ok(names.includes('background.js'));
  assert.ok(names.includes('icons/icon128.png'));
  assert.equal(names.some((name) => name.startsWith('helper/') || name.startsWith('store/') || name.includes('..')), false);
  assert.equal(result.fileCount, names.length);

  const manifestEntry = packed.find((file) => file.name === 'manifest.json');
  const manifest = JSON.parse(manifestEntry.body.toString('utf8'));
  assert.equal(Object.hasOwn(manifest, 'key'), false);
  assert.equal(manifestEntry.body.includes(KEY), false);
  assert.equal(fs.readFileSync(outPath).includes(KEY), false);
  const expected = JSON.parse(sourceBefore);
  delete expected.key;
  assert.deepEqual(manifest, expected);
  assert.equal(manifest.name, 'Double Click AI');
  fs.rmSync(dir, { recursive: true, force: true });
});
