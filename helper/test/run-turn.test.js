'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTurn } = require('../src/run-turn');
const { SessionMap } = require('../src/sessions');

test('a missing CLI reports the install and login commands', async () => {
  const events = [];
  await runTurn({
    provider: 'grok',
    conversationId: 'c-missing',
    userText: 'Hello',
    selection: { text: 'Passage', title: 'T', url: 'https://example.com' },
  }, {
    env: { PATH: '' },
    onEvent: (event) => events.push(event),
  });
  const error = events.find((event) => event.kind === 'error');
  assert.equal(error.code, 'not_installed');
  assert.match(error.hint, /grok login/);
  assert.match(error.hint, /x\.ai\/cli\/install\.sh/);
});

test('claude stays off unless the turn opts in', async () => {
  let lookedUp = false;
  const events = [];
  await runTurn({
    provider: 'claude',
    conversationId: 'c-claude',
    userText: 'Hello',
    claudeOptIn: false,
  }, {
    env: { PATH: '/usr/bin' },
    which() {
      lookedUp = true;
      return '/usr/bin/claude';
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(lookedUp, false);
  assert.equal(events.at(-1).code, 'opt_in');
});

test('mock provider streams a full answer end to end', async () => {
  const previous = process.env.DOUBLE_CLICK_MOCK_DELAY;
  process.env.DOUBLE_CLICK_MOCK_DELAY = '0';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-mock-'));
  const sessions = new SessionMap(path.join(dir, 'sessions.json'));
  const events = [];
  try {
    await runTurn({
      provider: 'mock',
      conversationId: 'conv-mock',
      userText: 'What is this about?',
      selection: { text: 'The fog missed the headland.', title: 'Notes', url: 'https://example.com/a' },
    }, {
      env: process.env,
      sessions,
      onEvent: (event) => events.push(event),
    });
  } finally {
    if (previous === undefined) delete process.env.DOUBLE_CLICK_MOCK_DELAY;
    else process.env.DOUBLE_CLICK_MOCK_DELAY = previous;
  }
  const deltas = events.filter((event) => event.kind === 'delta').map((event) => event.text).join('');
  const done = events.find((event) => event.kind === 'done');
  assert.equal(deltas, done.text);
  assert.match(done.text, /fog missed the headland/);
  assert.equal(events.some((event) => event.kind === 'session'), true);
  assert.equal(sessions.get('conv-mock').provider, 'mock');
  assert.equal(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8').includes('fog missed'), false);
});

test('codex is spawned read-only with secrets removed from the environment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-codex-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'env.txt');
  const argsFile = path.join(dir, 'args.txt');
  const cwdFile = path.join(dir, 'cwd.txt');
  const stdinFile = path.join(dir, 'stdin.txt');
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh
env > "${log}"
printf '%s\\n' "$@" > "${argsFile}"
pwd > "${cwdFile}"
cat > "${stdinFile}"
printf '%s\\n' '{"type":"thread.started","thread_id":"th_test"}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Noted."}}'
printf '%s\\n' '{"type":"turn.completed"}'
`);
  fs.chmodSync(path.join(bin, 'codex'), 0o755);
  const sessions = new SessionMap(path.join(dir, 'sessions.json'));
  const events = [];
  await runTurn({
    provider: 'codex',
    conversationId: 'conv-codex',
    userText: 'Explain the highlight',
    selection: { text: 'Salt on the window.', title: 'Notes', url: 'https://example.com/salt' },
  }, {
    env: {
      PATH: bin + path.delimiter + '/usr/bin' + path.delimiter + '/bin',
      HOME: dir,
      OPENAI_API_KEY: 'sk-secret',
      ANTHROPIC_API_KEY: 'ant-secret',
      DOUBLE_CLICK_TEST_LOG: log,
    },
    sessions,
    onEvent: (event) => events.push(event),
  });
  const done = events.find((event) => event.kind === 'done');
  assert.equal(done.text, 'Noted.');
  assert.equal(sessions.get('conv-codex').providerSessionId, 'th_test');
  const envDump = fs.readFileSync(log, 'utf8');
  assert.equal(envDump.includes('sk-secret'), false);
  assert.equal(envDump.includes('ant-secret'), false);
  const args = fs.readFileSync(argsFile, 'utf8');
  assert.match(args, /--sandbox/);
  assert.match(args, /read-only/);
  assert.match(args, /--skip-git-repo-check/);
  assert.equal(args.includes('--bare'), false);
  assert.equal(args.trim().endsWith('-'), true);
  const cwd = fs.readFileSync(cwdFile, 'utf8').trim();
  assert.match(cwd, /double-click-/);
  assert.equal(fs.existsSync(path.join(cwd, '.git')), false);
  assert.match(fs.readFileSync(stdinFile, 'utf8'), /Salt on the window/);
});

test('a custom provider path is used and the generic agent binary is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-override-'));
  const custom = path.join(dir, 'elsewhere', 'grok');
  const agent = path.join(dir, 'grok-bin', 'agent');
  const stamp = path.join(dir, 'ran');
  fs.mkdirSync(path.dirname(custom), { recursive: true });
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.writeFileSync(custom, `#!/bin/sh
touch "${stamp}"
printf '%s\\n' '{"type":"text","data":"from-custom"}'
printf '%s\\n' '{"type":"end","sessionId":"s-custom"}'
`, { mode: 0o755 });
  fs.writeFileSync(agent, `#!/bin/sh\ntouch "${stamp}"\n`, { mode: 0o755 });
  fs.chmodSync(custom, 0o755);
  fs.chmodSync(agent, 0o755);

  const events = [];
  await runTurn({
    provider: 'grok',
    conversationId: 'c-custom',
    userText: 'Hello',
    selection: { text: 'Passage', title: 'T', url: 'https://example.com' },
    providerPath: custom,
  }, {
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: dir },
    onEvent: (event) => events.push(event),
  });
  assert.equal(events.find((event) => event.kind === 'done').text, 'from-custom');
  assert.equal(fs.existsSync(stamp), true);
  fs.rmSync(stamp);

  const refused = [];
  await runTurn({
    provider: 'grok',
    conversationId: 'c-agent',
    userText: 'Hello',
    selection: { text: 'Passage', title: 'T', url: 'https://example.com' },
    providerPath: agent,
  }, {
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: dir },
    onEvent: (event) => refused.push(event),
  });
  assert.equal(refused.find((event) => event.kind === 'error').code, 'not_installed');
  assert.equal(fs.existsSync(stamp), false);
});
