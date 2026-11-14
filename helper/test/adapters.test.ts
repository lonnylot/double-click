'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ADAPTERS, getAdapter } = require('../src/providers');
const { feed, textOf } = require('./support.ts');

const turn = {
  conversationId: '11111111-1111-4111-8111-111111111111',
  userText: 'What does this mean?',
  selection: { text: 'The fog missed the headland.', title: 'Notes', url: 'https://example.com/notes' },
  priorMessages: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Reply' }],
};

test('adapters refuse generic agent and unsafe flags', () => {
  const banned = ['--bare', '--dangerously-skip-permissions', '--yolo', '--force', '--allow-all', '--always-approve'];
  for (const adapter of ADAPTERS) {
    const spec = adapter.buildTurn({ ...turn, providerSessionId: null }, '/tmp/double-click-empty');
    const command = spec.command || '';
    assert.notEqual(command, 'agent');
    assert.ok(!command.endsWith('/agent'));
    const args = spec.args || [];
    for (const flag of banned) assert.ok(!args.includes(flag), adapter.id + ' passed ' + flag);
    if (adapter.id === 'cursor') assert.equal(command, 'cursor-agent');
    if (adapter.id === 'grok') assert.equal(command, 'grok');
    if (adapter.id === 'claude') assert.equal(command, 'claude');
  }
});

test('codex stays read-only and resumes with the saved thread', () => {
  const codex = getAdapter('codex');
  const first = codex.buildTurn(turn, '/tmp/empty');
  assert.deepEqual(first.args.slice(0, 8), [
    'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-C',
  ]);
  assert.equal(first.args.at(-1), '-');
  assert.match(first.stdin, /The fog missed the headland/);
  assert.match(first.stdin, /Earlier/);
  assert.equal(first.stdin.includes('What does this mean?'), true);

  const next = codex.buildTurn({ ...turn, providerSessionId: 'th_123' }, '/tmp/empty');
  assert.ok(next.args.includes('resume'));
  assert.ok(next.args.includes('th_123'));
  assert.equal(next.stdin, null);
  assert.equal(next.args.at(-1), 'What does this mean?');
  assert.ok(!next.args.join(' ').includes('The fog missed'));
});

test('codex fixture keeps the agent message and drops tool noise', () => {
  const { events } = feed(getAdapter('codex'), 'codex.jsonl');
  const { text, done } = textOf(events);
  assert.equal(text, 'Repo contains docs, sdk, and examples directories.');
  assert.equal(done, text);
  assert.equal(events.find((event) => event.kind === 'session').providerSessionId, '0199a213-81c0-7800-8aa1-bbab2a035a53');
  assert.equal(JSON.stringify(events).includes('bash -lc'), false);
});

test('grok fixture appends text deltas and ignores thoughts', () => {
  const spec = getAdapter('grok').buildTurn(turn, '/tmp/empty');
  assert.ok(spec.args.includes('streaming-json'));
  assert.ok(spec.args.includes('--no-auto-update'));
  assert.equal(spec.preassignedSessionId.length > 10, true);
  const resumed = getAdapter('grok').buildTurn({ ...turn, providerSessionId: 'sess-keep' }, '/tmp/empty');
  assert.equal(resumed.preassignedSessionId, 'sess-keep');
  assert.equal(resumed.args.at(-1), 'What does this mean?');

  const { events } = feed(getAdapter('grok'), 'grok.jsonl');
  const { text, done } = textOf(events);
  assert.equal(text, "Here's a summary");
  assert.equal(done, text);
  assert.equal(events.find((event) => event.kind === 'session').providerSessionId, 'abc123');
  assert.equal(JSON.stringify(events).includes('Analyzing'), false);
});

test('claude streams text deltas and never receives --bare', () => {
  const claude = getAdapter('claude');
  const spec = claude.buildTurn({ ...turn, providerSessionId: 'sess_9' }, '/tmp/empty');
  assert.ok(spec.args.includes('--resume'));
  assert.ok(spec.args.includes('--tools'));
  assert.ok(spec.args.includes('--permission-mode'));
  assert.equal(spec.args.includes('--bare'), false);
  const { events } = feed(claude, 'claude.jsonl');
  const { text, done } = textOf(events);
  assert.equal(text, 'Hello there');
  assert.equal(done, 'Hello there');
  assert.equal(events.find((event) => event.kind === 'session').providerSessionId, 'sess_123');
});

test('copilot parses message deltas and does not pass --silent', () => {
  const spec = getAdapter('copilot').buildTurn(turn, '/tmp/empty');
  assert.equal(spec.command, 'copilot');
  assert.equal(spec.args.includes('-s'), false);
  assert.equal(spec.args.includes('-p'), false);
  assert.match(spec.stdin, /The fog missed the headland/);
  assert.ok(spec.args.some((arg) => arg.startsWith('--excluded-tools=')));
  assert.ok(spec.args.some((arg) => arg.startsWith('--deny-tool=')));
  const { events } = feed(getAdapter('copilot'), 'copilot.jsonl');
  const { text, done } = textOf(events);
  assert.equal(text, 'Hello there');
  assert.equal(done, text);
  assert.equal(events.find((event) => event.kind === 'session').providerSessionId, '6b1b1c1a-1111-4111-8111-111111111111');
});

test('cursor ask mode skips duplicate flushes', () => {
  const spec = getAdapter('cursor').buildTurn({ ...turn, providerSessionId: 'chat_1' }, '/tmp/empty');
  assert.equal(spec.command, 'cursor-agent');
  assert.ok(spec.args.includes('ask'));
  assert.ok(spec.args.includes('--stream-partial-output'));
  assert.ok(spec.args.includes('--resume'));
  assert.match(spec.stdin, /What does this mean\?$/);
  const { events } = feed(getAdapter('cursor'), 'cursor.jsonl');
  const { text, done } = textOf(events);
  assert.equal(text, 'Hello world');
  assert.equal(done, 'Hello world');
  assert.equal(events.find((event) => event.kind === 'session').providerSessionId, 'c6b62c6f-7ead-4fd6-9922-e952131177ff');
});

test('agy appends text deltas and surfaces auth failures', () => {
  const spec = getAdapter('agy').buildTurn({ ...turn, providerSessionId: 'conv_1' }, '/tmp/empty');
  assert.equal(spec.command, 'agy');
  assert.ok(spec.args.includes('--sandbox'));
  assert.ok(spec.args.includes('--conversation'));
  assert.equal(spec.args.includes('--dangerously-skip-permissions'), false);
  const { events } = feed(getAdapter('agy'), 'agy.jsonl');
  const { text, done } = textOf(events);
  assert.equal(text, 'Git rebase rewrites history.\n');
  assert.equal(done, text);
  assert.equal(events.find((event) => event.kind === 'session').providerSessionId, 'c3b66b04-872b-4fbe-a3a4-058a026ef20a');

  const failed = getAdapter('agy').parseLine(JSON.stringify({
    event: 'result',
    result: { status: 'ERROR', error: 'authentication required', response: '' },
  }), { text: '', sessionId: null, sawText: false, sawDelta: false, done: false });
  assert.equal(failed[0].kind, 'error');
  assert.match(failed[0].message, /authentication required/);
});

