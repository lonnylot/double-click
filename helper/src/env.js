'use strict';

// Subscription CLIs switch to metered API billing when these are set.
// The helper deletes them from the child environment and never reads credential files.
const SECRET_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_API_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'XAI_API_KEY',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_API_KEY',
  'CURSOR_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_API_TOKEN',
  'COPILOT_GITHUB_TOKEN',
  'COPILOT_TOKEN',
];

const SECRET_PREFIXES = ['OPENAI_', 'ANTHROPIC_', 'XAI_', 'CODEX_', 'GEMINI_', 'CURSOR_', 'COPILOT_'];

function isSecretKey(key) {
  if (SECRET_ENV_KEYS.includes(key)) return true;
  if (!SECRET_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  return /(?:API_KEY|AUTH_TOKEN|API_TOKEN|_TOKEN|_KEY)$/.test(key);
}

function stripEnv(source) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (isSecretKey(key)) delete env[key];
  }
  return env;
}

module.exports = {
  SECRET_ENV_KEYS,
  isSecretKey,
  stripEnv,
};
