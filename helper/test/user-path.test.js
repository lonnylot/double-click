'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { which, resolveCommand } = require('../src/which');
const { describeProviders } = require('../src/runtime');
const { runTurn } = require('../src/run-turn');
const {
  shellArgs,
  parseMarkedPath,
  loginShellPath,
  resolveUserPath,
  withUserPath,
  nvmBin,
  START,
  END,
} = require('../src/user-path');

const LAUNCHD = '/usr/bin:/bin:/usr/sbin:/sbin';

function writeBin(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function loginScript(file, pathValue, extra) {
  const quoted = String(pathValue).replace(/'/g, `'\\''`);
  writeBin(file, `#!/bin/sh
export PATH='${quoted}'
echo "welcome"
${extra || ''}
last=
for arg in "$@"; do last=$arg; done
eval "$last"
`);
}

test('shell probe args are login+interactive and markers survive profile noise', () => {
  const zsh = shellArgs('/bin/zsh').join(' ');
  assert.match(zsh, /^-ilc /);
  assert.match(zsh, new RegExp(START));
  assert.match(shellArgs('/bin/bash').join(' '), /^-ilc /);
  assert.match(shellArgs('/usr/local/bin/fish').join(' '), /^-l -i -c /);
  const noisy = [
    'Last login: today',
    'printf leftover',
    START,
    '/Users/ada/.grok/bin:/Users/ada/.local/bin:/usr/bin:/bin',
    END,
    'bye',
  ].join('\n');
  assert.equal(parseMarkedPath(noisy), '/Users/ada/.grok/bin:/Users/ada/.local/bin:/usr/bin:/bin');
  assert.equal(parseMarkedPath('no markers\n'), null);
});

test('launchd PATH still resolves grok, codex, and cursor-agent and never agent', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-path-'));
  const shell = path.join(home, 'login-shell');
  loginScript(shell, LAUNCHD);
  writeBin(path.join(home, '.grok', 'bin', 'grok'), '#!/bin/sh\nexit 0\n');
  writeBin(path.join(home, '.grok', 'bin', 'agent'), '#!/bin/sh\necho no\n');
  writeBin(path.join(home, '.local', 'bin', 'codex'), '#!/bin/sh\nexit 0\n');
  writeBin(path.join(home, '.local', 'bin', 'cursor-agent'), '#!/bin/sh\nexit 0\n');
  writeBin(path.join(home, '.volta', 'bin', 'volta'), '#!/bin/sh\nexit 0\n');
  fs.mkdirSync(path.join(home, '.asdf', 'shims'), { recursive: true });
  fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', 'v20.9.0', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', 'v20.11.1', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.nvm', 'alias'), { recursive: true });
  fs.writeFileSync(path.join(home, '.nvm', 'alias', 'default'), '20\n');
  fs.mkdirSync(path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'), { recursive: true });

  const env = {
    PATH: LAUNCHD,
    HOME: home,
    SHELL: shell,
    USER: 'ada',
  };
  const options = { cache: false, home, platform: 'darwin', shell, env };
  const resolved = resolveUserPath(options);
  const lookup = { ...env, PATH: resolved };
  assert.equal(which('grok', lookup), path.join(home, '.grok', 'bin', 'grok'));
  assert.equal(which('codex', lookup), path.join(home, '.local', 'bin', 'codex'));
  assert.equal(which('cursor-agent', lookup), path.join(home, '.local', 'bin', 'cursor-agent'));
  assert.equal(which('agent', lookup), null);
  assert.equal(resolveCommand('agent', lookup), null);
  assert.equal(resolveCommand('grok', lookup, path.join(home, '.grok', 'bin', 'agent')), null);
  assert.match(resolved, new RegExp(path.join(home, '.grok', 'bin').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(resolved, /\/usr\/bin/);
  assert.equal(nvmBin(home, env, fs), path.join(home, '.nvm', 'versions', 'node', 'v20.11.1', 'bin'));
  assert.match(resolved, /v20\.11\.1\/bin/);
  assert.match(resolved, /\.volta\/bin/);
  assert.match(resolved, /\.asdf\/shims/);
  assert.match(resolved, /fnm\/aliases\/default\/bin/);

  const described = describeProviders(lookup, {
    codex: path.join(home, 'missing', 'codex'),
  });
  const grok = described.find((item) => item.id === 'grok');
  const codex = described.find((item) => item.id === 'codex');
  assert.equal(grok.installed, true);
  assert.equal(grok.resolvedPath, path.join(home, '.grok', 'bin', 'grok'));
  assert.equal(codex.installed, false);
  assert.equal(codex.resolvedPath, '');
  assert.match(codex.pathNote, /not executable/);
  assert.equal(codex.detectedPath, path.join(home, '.local', 'bin', 'codex'));
  assert.equal(described.some((item) => item.resolvedPath && path.basename(item.resolvedPath) === 'agent'), false);

  const stamp = path.join(home, 'child-env');
  writeBin(path.join(home, '.local', 'bin', 'codex'), `#!/bin/sh
env > "${stamp}"
printf '%s\\n' '{"type":"thread.started","thread_id":"th_path"}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Found."}}'
printf '%s\\n' '{"type":"turn.completed"}'
`);
  const events = [];
  await runTurn({
    provider: 'codex',
    conversationId: 'c-path',
    userText: 'Hello',
    selection: { text: 'Passage', title: 'T', url: 'https://example.com' },
  }, {
    env: withUserPath(env, options),
    onEvent: (event) => events.push(event),
  });
  assert.equal(events.find((event) => event.kind === 'done').text, 'Found.');
  const childPath = fs.readFileSync(stamp, 'utf8').split('\n').find((line) => line.startsWith('PATH='));
  assert.match(childPath, /\.local\/bin/);
  assert.match(childPath, /\.grok\/bin/);
  assert.match(childPath, /\/usr\/bin/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('a login shell PATH is used even when the directory is not a well-known install dir', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-login-'));
  const custom = path.join(home, 'custom-bin');
  const shell = path.join(home, 'login-shell');
  writeBin(path.join(custom, 'copilot'), '#!/bin/sh\nexit 0\n');
  loginScript(shell, custom + ':/usr/bin:/bin');
  const env = { PATH: LAUNCHD, HOME: home, SHELL: shell };
  const resolved = resolveUserPath({
    cache: false,
    home,
    platform: 'linux',
    shell,
    env,
  });
  assert.equal(which('copilot', { PATH: resolved }), path.join(custom, 'copilot'));
  assert.match(resolved, new RegExp('^' + custom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  fs.rmSync(home, { recursive: true, force: true });
});

test('a hung or markerless login shell falls back to well-known directories', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-hang-'));
  const hung = path.join(home, 'hung-shell');
  const broken = path.join(home, 'broken-shell');
  writeBin(path.join(home, '.local', 'bin', 'codex'), '#!/bin/sh\nexit 0\n');
  writeBin(hung, '#!/bin/sh\nsleep 30\n');
  writeBin(broken, '#!/bin/sh\necho no markers\nexit 1\n');
  const started = Date.now();
  const timedOut = loginShellPath({
    shell: hung,
    env: { PATH: LAUNCHD, HOME: home, SHELL: hung },
    timeoutMs: 250,
    platform: 'linux',
  });
  assert.equal(timedOut, null);
  assert.ok(Date.now() - started < 2000);
  const resolved = resolveUserPath({
    cache: false,
    home,
    platform: 'linux',
    shell: broken,
    env: { PATH: LAUNCHD, HOME: home, SHELL: broken },
  });
  assert.equal(which('codex', { PATH: resolved }), path.join(home, '.local', 'bin', 'codex'));
  fs.rmSync(home, { recursive: true, force: true });
});

test('nvm lts alias resolves to that version bin', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-nvm-'));
  const nvm = path.join(home, '.nvm');
  fs.mkdirSync(path.join(nvm, 'versions', 'node', 'v18.20.4', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(nvm, 'versions', 'node', 'v22.1.0', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(nvm, 'alias', 'lts'), { recursive: true });
  fs.writeFileSync(path.join(nvm, 'alias', 'default'), 'lts/*\n');
  fs.writeFileSync(path.join(nvm, 'alias', 'lts', '*'), 'v18.20.4\n');
  assert.equal(nvmBin(home, { NVM_DIR: nvm }, fs), path.join(nvm, 'versions', 'node', 'v18.20.4', 'bin'));
  fs.rmSync(home, { recursive: true, force: true });
});
