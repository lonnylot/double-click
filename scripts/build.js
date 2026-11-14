'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');

function tsc(project) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('tsc failed for ' + project);
  }
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyJsTree(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const rel = path.relative(fromDir, full);
        copyFile(full, path.join(toDir, rel));
      }
    }
  };
  walk(fromDir);
}

function copyStaticExtension() {
  const out = path.join(repoRoot, 'dist', 'extension');
  fs.mkdirSync(out, { recursive: true });
  for (const name of ['manifest.json', 'history.html', 'history.css']) {
    copyFile(path.join(repoRoot, 'extension', name), path.join(out, name));
  }
  const icons = path.join(repoRoot, 'extension', 'icons');
  for (const name of fs.readdirSync(icons)) {
    copyFile(path.join(icons, name), path.join(out, 'icons', name));
  }
}

function bundleExtension() {
  esbuild.buildSync({
    absWorkingDir: repoRoot,
    entryPoints: {
      background: 'extension/src/background.ts',
      'content/content': 'extension/src/content/content.ts',
      history: 'extension/src/history.ts',
    },
    bundle: true,
    outdir: path.join(repoRoot, 'dist', 'extension'),
    format: 'iife',
    platform: 'browser',
    target: ['chrome116'],
    legalComments: 'none',
    banner: { js: '"use strict";' },
    logLevel: 'warning',
  });
  copyStaticExtension();
}

function mirrorReadableSources() {
  copyJsTree(path.join(repoRoot, 'dist', 'helper'), path.join(repoRoot, 'helper'));
  copyJsTree(path.join(repoRoot, 'dist', 'shared'), path.join(repoRoot, 'shared'));
  const emitted = path.join(repoRoot, 'dist', 'extension-tsc', 'extension', 'src');
  copyFile(path.join(emitted, 'background.js'), path.join(repoRoot, 'extension', 'background.js'));
  copyFile(path.join(emitted, 'content', 'content.js'), path.join(repoRoot, 'extension', 'content', 'content.js'));
  copyFile(path.join(emitted, 'history.js'), path.join(repoRoot, 'extension', 'history.js'));
  copyFile(path.join(emitted, 'lib', 'providers.js'), path.join(repoRoot, 'extension', 'lib', 'providers.js'));
  copyFile(path.join(emitted, 'lib', 'markdown.js'), path.join(repoRoot, 'extension', 'lib', 'markdown.js'));

  const background = fs.readFileSync(path.join(repoRoot, 'extension', 'background.js'), 'utf8');
  if (!background.includes("port.name !== 'double-click'")) {
    throw new Error("compiled extension/background.js lost the port.name !== 'double-click' check");
  }
  const constants = fs.readFileSync(path.join(repoRoot, 'helper', 'src', 'constants.js'), 'utf8');
  if (!constants.includes('com.lare.doubleclick')) {
    throw new Error('compiled helper/src/constants.js lost the host name');
  }
  const devManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'extension', 'manifest.json'), 'utf8'));
  if (!devManifest.key) throw new Error('the dev build manifest is missing its key');
}

function build() {
  fs.rmSync(path.join(repoRoot, 'dist'), { recursive: true, force: true });
  tsc('tsconfig.helper.json');
  tsc('tsconfig.extension.emit.json');
  bundleExtension();
  mirrorReadableSources();
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    process.exit(1);
  }
}

module.exports = { build, bundleExtension };
