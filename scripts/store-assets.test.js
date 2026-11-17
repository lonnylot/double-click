'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pngSize } = require('./png');

const repo = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

function section(markdown, heading) {
  const match = markdown.match(new RegExp('(?:^|\\n)## ' + heading + '\\n+([\\s\\S]*?)(?=\\n## |$)'));
  assert.ok(match, 'missing section ' + heading);
  return match[1].trim();
}

test('store listing copy is ready to paste and does not claim a live listing', () => {
  const listing = read('store/listing.md');
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.match(listing, /LARE, LLC/);
  assert.match(listing, /lonny@lonnylot\.com/);
  assert.equal(section(listing, 'Name'), 'Double Click AI');
  const summary = section(listing, 'Summary');
  assert.equal(summary, manifest.description);
  assert.ok([...summary].length <= 132, summary.length);
  const description = section(listing, 'Description');
  assert.match(description, /one-time local helper/);
  assert.match(description, /https:\/\/github\.com\/lonnylot\/double-click#install/);
  assert.match(description, /https:\/\/dcai\.larehq\.com\/privacy/);
  assert.equal(/available on the Chrome Web Store|listed on the Chrome Web Store|now on the Chrome Web Store/i.test(description), false);
  assert.equal(section(listing, 'Category'), 'Productivity');
  assert.equal(section(listing, 'Language'), 'English');
  assert.match(section(listing, 'Single purpose'), /Highlight text on a page/);
  for (const permission of manifest.permissions) {
    assert.match(listing, new RegExp('\\b' + permission + '\\b'));
  }
  assert.equal(manifest.host_permissions, undefined);
  assert.match(listing, /host_permissions/);
  assert.match(listing, /http:\/\/\*\/\*/);
  assert.match(listing, /https:\/\/\*\/\*/);
  assert.match(section(listing, 'Remote code'), /^None\b/);
  const data = section(listing, 'Data use');
  assert.match(data, /https:\/\/dcai\.larehq\.com\/privacy/);
  assert.match(data, /highlighted passage/);
  assert.match(data, /page title/);
  assert.match(data, /page URL/);
  assert.match(data, /question/);
  assert.match(data, /stored in this browser/);
  assert.match(data, /do not include analytics/);
  assert.match(data, /does not sell personal information/);
  assert.match(data, /session id/);
  const marketing = summary + '\n' + description;
  for (const word of ['OpenAI', 'Anthropic', 'Firefox', 'Safari', 'Brave', 'Notion', 'Slack', 'Gemini', 'Perplexity']) {
    assert.equal(marketing.includes(word), false, word);
  }

  const steps = read('store/SUBMITTING.md');
  assert.match(steps, /npm run package/);
  assert.match(steps, /STORE_EXTENSION_IDS/);
  assert.match(steps, /--extension-id/);
  assert.match(steps, /chromeWebStoreUrl/);
  assert.match(steps, /site\/public\/config\.js/);
  assert.match(steps, /DC AI/);
  assert.match(steps, /dkaimfjbcdiaeialfejfhppmlmcafabc/);
  assert.match(steps, /lonny@larehq\.com/);
});

test('store images have the dashboard sizes', () => {
  const icon = pngSize(fs.readFileSync(path.join(repo, 'store', 'icon128.png')));
  assert.equal(icon.width, 128);
  assert.equal(icon.height, 128);
  const shots = {
    'store/screenshots/highlight.png': [1280, 800],
    'store/screenshots/chat.png': [1280, 800],
    'store/screenshots/history.png': [1280, 800],
    'store/screenshots/providers.png': [1280, 800],
    'store/promo-small.png': [440, 280],
    'store/promo-marquee.png': [1400, 560],
  };
  for (const [rel, [width, height]] of Object.entries(shots)) {
    const info = pngSize(fs.readFileSync(path.join(repo, rel)));
    assert.equal(info.width, width, rel);
    assert.equal(info.height, height, rel);
    assert.equal(info.colorType, 2, rel);
  }
});
