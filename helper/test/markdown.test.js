'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require(path.join(__dirname, '..', '..', 'extension', 'lib', 'markdown.js'));
const { render } = globalThis.DoubleClickMarkdown;

test('markdown escapes html and only links http(s)', () => {
  const html = render('<script>alert(1)</script>\n\n**ok**\n\n[bad](javascript:alert(1))\n\n[docs](https://example.com/a)');
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>ok<\/strong>/);
  assert.equal(html.includes('javascript:'), true);
  assert.equal(html.includes('<a href="javascript:'), false);
  assert.match(html, /<a href="https:\/\/example\.com\/a"/);
});
