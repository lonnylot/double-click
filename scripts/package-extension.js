'use strict';

const fs = require('fs');
const path = require('path');
const { createZip } = require('./zip-store');

const SHORT_NAME_LIMIT = 12;

function listExtensionFiles(extensionDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(extensionDir);
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

function storeManifest(sourceText) {
  const manifest = JSON.parse(sourceText);
  if (typeof manifest.short_name !== 'string' || [...manifest.short_name].length > SHORT_NAME_LIMIT) {
    const length = manifest.short_name ? [...String(manifest.short_name)].length : 0;
    throw new Error('short_name must be a string of at most ' + SHORT_NAME_LIMIT + ' characters (got ' + length + ')');
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error('manifest name is missing');
  }
  delete manifest.key;
  return JSON.stringify(manifest, null, 2) + '\n';
}

function packageExtension(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  if (!options.skipBuild) require('./build').build();
  const extensionDir = path.join(repoRoot, 'dist', 'extension');
  const sourceManifest = fs.readFileSync(path.join(repoRoot, 'extension', 'manifest.json'), 'utf8');
  const manifestText = storeManifest(sourceManifest);
  const parsed = JSON.parse(manifestText);
  const version = parsed.version || '0.0.0';
  const outPath = options.outPath || path.join(repoRoot, 'dist', 'double-click-ai-' + version + '.zip');
  const files = listExtensionFiles(extensionDir).map((full) => {
    const name = path.relative(extensionDir, full).split(path.sep).join('/');
    const body = name === 'manifest.json' ? manifestText : fs.readFileSync(full);
    return { name, body };
  });
  if (!files.some((file) => file.name === 'manifest.json')) {
    throw new Error('extension/manifest.json was not packaged');
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, createZip(files));
  return { outPath, fileCount: files.length, version, manifest: parsed };
}

function main() {
  const before = fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8');
  const result = packageExtension();
  const after = fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8');
  if (before !== after) throw new Error('packaging changed extension/manifest.json');
  const devManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension', 'manifest.json'), 'utf8'));
  if (!devManifest.key) throw new Error('the dev build lost its key');
  process.stdout.write('Wrote ' + result.outPath + ' (' + result.fileCount + ' files, version ' + result.version + ')\n');
  process.stdout.write('The zip manifest has no key. The dev build and extension/manifest.json still have the key.\n');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write((err.message || String(err)) + '\n');
    process.exit(1);
  }
}

module.exports = { packageExtension, storeManifest, listExtensionFiles };
