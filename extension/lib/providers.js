'use strict';

(function (root) {
  const HOST_NAME = 'com.lare.doubleclick';

  const LIST = [
    {
      id: 'codex',
      label: 'Codex',
      detail: 'ChatGPT subscription',
      installHint: 'npm install -g @openai/codex',
      loginHint: 'codex login',
    },
    {
      id: 'copilot',
      label: 'Copilot',
      detail: 'GitHub Copilot subscription',
      installHint: 'npm install -g @github/copilot',
      loginHint: 'copilot login',
    },
    {
      id: 'agy',
      label: 'Antigravity',
      detail: 'Google AI subscription',
      installHint: 'Install the Antigravity CLI so agy is on your PATH',
      loginHint: 'agy',
    },
    {
      id: 'grok',
      label: 'Grok',
      detail: 'SuperGrok or X Premium+',
      installHint: 'curl -fsSL https://x.ai/cli/install.sh | bash',
      loginHint: 'grok login',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      detail: 'Cursor subscription',
      installHint: 'curl https://cursor.com/install -fsS | bash',
      loginHint: 'cursor-agent login',
    },
    {
      id: 'claude',
      label: 'Claude Code',
      detail: 'Claude subscription, opt-in',
      optIn: true,
      installHint: 'npm install -g @anthropic-ai/claude-code',
      loginHint: 'claude auth login',
      caveat: 'Anthropic’s terms do not allow third-party products to route requests through Claude plan credentials. Double Click AI only starts the Claude Code program already installed on this computer and never reads your login files. Turn this on only if you accept that arrangement.',
    },
    {
      id: 'mock',
      label: 'Sample reply',
      detail: 'Local preview',
      demo: true,
      installHint: '',
      loginHint: '',
    },
  ];

  function byId(id) {
    return LIST.find((item) => item.id === id) || null;
  }

  root.DoubleClickProviders = {
    HOST_NAME,
    LIST,
    byId,
  };
})(globalThis);
