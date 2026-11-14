import type { TurnInput } from '../../shared/protocol';

export function buildPrompt(turn: TurnInput): string {
  const userText = String(turn.userText || '').trim();
  const hasSession = Boolean(turn.providerSessionId);
  if (hasSession) return userText;

  const selection = turn.selection || {};
  const lines = [
    'You are answering a question about a passage the user highlighted on a web page.',
    'Answer from the passage and the conversation. Do not browse, edit files, or run commands.',
    '',
    'Page title: ' + (selection.title || 'Untitled'),
    'URL: ' + (selection.url || ''),
    '',
    'Highlighted passage:',
    '"""',
    selection.text || '',
    '"""',
  ];

  const prior = Array.isArray(turn.priorMessages) ? turn.priorMessages : [];
  if (prior.length) {
    lines.push('', 'Conversation so far:');
    for (const message of prior) {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      lines.push(role + ': ' + (message.content || ''));
    }
  }

  lines.push('', 'User question:', userText);
  return lines.join('\n');
}
