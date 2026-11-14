'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { HOST_NAME, EXPECTED_EXTENSION_ID } = require('../../helper/src/constants');
const { extensionIdFromKey } = require('../../helper/install');

const root = path.resolve(__dirname, '..', '..');
const site = path.join(root, 'site');
const pub = path.join(site, 'public');

const KNOWN_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtpXCR/seO7KyqSPca07/8j7/Mmf0RP+TBIWCFHI/nXSXftw2ltsqevRaEsHviygE9edReN7QgVOOz/A8bQwDFErd+VSYPfkn9WiAsYi4gcD5MDl4GLkCz7nm5rluzxGvVuAzd15fVYZQJlaT3EuEflgG4V3u4sca9nmhmqe/vUtZI3Dmh7kavzRJJN6u0s9vLK/89+LW66sqCqKAHE6ileectdS5/3uGtg1K97KEteQVSq7jjnrcGd4lMKJ+y9EUrJEYFuugde5pYzF4uGK3Qt0NiF8yLLhJ08PrkZO6gH1dl/f6t4kpABPNNug9BFfOKSjx8CVzWyQPqiD2Eo+scQIDAQAB';

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('the product name is user-facing and the host id and extension key stay put', () => {
  assert.equal(HOST_NAME, 'com.lare.doubleclick');
  assert.equal(EXPECTED_EXTENSION_ID, 'dkaimfjbcdiaeialfejfhppmlmcafabc');
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.name, 'Double Click AI');
  assert.equal(manifest.short_name, 'DC AI');
  assert.ok([...manifest.short_name].length <= 12);
  assert.equal(manifest.key, KNOWN_KEY);
  assert.equal(extensionIdFromKey(manifest.key), EXPECTED_EXTENSION_ID);
  assert.ok(manifest.description.length <= 132);
  assert.match(manifest.description, /LARE, LLC/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, 'double-click-ai');
  assert.match(pkg.description, /Double Click AI/);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.name, 'double-click-ai');
  assert.equal(lock.packages[''].name, 'double-click-ai');

  const surfaces = [
    'extension/manifest.json',
    'extension/history.html',
    'extension/content/content.js',
    'extension/background.js',
    'extension/history.js',
    'extension/lib/providers.js',
    'helper/install.js',
    'helper/host.js',
    'helper/src/providers/claude.js',
    'README.md',
    'package.json',
  ];
  for (const file of surfaces) {
    const text = read(file);
    assert.equal(text.match(/Double Click(?! AI)/g), null, file);
  }
  assert.match(read('helper/install.js'), /Double Click AI helper registered/);
  assert.match(read('extension/content/content.js'), /double-click-root/);
  assert.match(read('extension/background.js'), /port\.name !== 'double-click'/);
  assert.match(read('helper/src/constants.js'), /com\.lare\.doubleclick/);
});

test('the landing site keeps the approved copy and does not claim a store listing', () => {
  const index = read('site/public/index.html');
  assert.equal(index.includes('Listed on the Chrome Web Store'), false);
  assert.equal(index.includes('listed on the Chrome Web Store'), false);
  assert.match(index, /Highlight a passage and ask about it in place/);
  assert.match(index, /A LARE, LLC product/);
  assert.match(index, /href="https:\/\/github\.com\/lonnylot\/double-click"/);
  assert.match(index, /data-chrome-cta href="https:\/\/github\.com\/lonnylot\/double-click#install"/);
  const config = read('site/public/config.js');
  assert.match(config, /TODO:/);
  assert.match(config, /chromeWebStoreUrl: 'https:\/\/github\.com\/lonnylot\/double-click#install'/);
  assert.match(index, /property="og:image"/);
  assert.match(index, /twitter:card/);
  assert.match(index, /Skip to content/);
  assert.match(index, /aria-controls="site-nav"/);
});

test('privacy, 404, robots, sitemap, and the worker config are in place', () => {
  const privacy = read('site/public/privacy.html');
  assert.match(privacy, /LARE, LLC/);
  assert.match(privacy, /State of Florida/);
  assert.match(privacy, /highlighted passage/);
  assert.match(privacy, /page title/);
  assert.match(privacy, /page URL/);
  assert.match(privacy, /question you type/);
  assert.match(privacy, /stored in this browser/);
  assert.match(privacy, /do not include analytics/);
  assert.match(privacy, /does not sell personal information/);
  const missing = read('site/public/404.html');
  assert.match(missing, /That page is not here/);
  assert.match(missing, /noindex/);
  assert.match(read('site/public/robots.txt'), /Sitemap: https:\/\/dcai\.larehq\.com\/sitemap\.xml/);
  assert.match(read('site/public/sitemap.xml'), /https:\/\/dcai\.larehq\.com\/privacy/);
  const wrangler = read('site/wrangler.jsonc');
  assert.match(wrangler, /"name": "dcai-site"/);
  assert.match(wrangler, /"directory": "\.\/public"/);
  assert.match(wrangler, /"not_found_handling": "404-page"/);
  assert.match(wrangler, /"routes": \[\s*\{ "pattern": "dcai\.larehq\.com", "custom_domain": true \}\s*\]/);
  const routeLines = wrangler.split('\n').filter((line) => line.includes('"routes"') || line.includes('dcai.larehq.com'));
  assert.ok(routeLines.some((line) => line.includes('"custom_domain": true') && !line.trim().startsWith('//')));
  for (const file of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'og.png']) {
    assert.ok(fs.statSync(path.join(pub, file)).size > 32, file);
  }
  const og = fs.readFileSync(path.join(pub, 'og.png'));
  assert.equal(og.readUInt32BE(16), 1200);
  assert.equal(og.readUInt32BE(20), 630);
  assert.match(read('site/public/favicon.svg'), /<circle/);
  assert.ok(fs.existsSync(path.join(pub, 'fonts', 'newsreader-latin.woff2')));
  assert.ok(fs.existsSync(path.join(pub, 'fonts', 'Newsreader-OFL.txt')));
});
