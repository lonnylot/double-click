'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stripEnv, SECRET_ENV_KEYS } = require('../src/env');

test('stripEnv removes subscription-breaking keys and keeps the rest', () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/Users/ada',
    OPENAI_API_KEY: 'sk-live',
    ANTHROPIC_API_KEY: 'ant',
    ANTHROPIC_AUTH_TOKEN: 'tok',
    XAI_API_KEY: 'xai',
    CODEX_API_KEY: 'codex',
    GEMINI_API_KEY: 'gem',
    CURSOR_API_KEY: 'cur',
    GH_TOKEN: 'gh',
    GITHUB_TOKEN: 'hub',
    COPILOT_GITHUB_TOKEN: 'cop',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
    OPENAI_ORG_API_KEY: 'org',
    TERM: 'xterm',
  };
  const stripped = stripEnv(source);
  for (const key of SECRET_ENV_KEYS) assert.equal(stripped[key], undefined);
  assert.equal(stripped.OPENAI_ORG_API_KEY, undefined);
  assert.equal(stripped.PATH, '/usr/bin');
  assert.equal(stripped.HOME, '/Users/ada');
  assert.equal(stripped.TERM, 'xterm');
  assert.equal(source.OPENAI_API_KEY, 'sk-live');
});
