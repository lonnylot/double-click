export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, href: string) => {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  });
  return html;
}

function withBreaks(text: string): string {
  return inline(text).replace(/\n/g, '<br>');
}

export function render(markdown: unknown): string {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.startsWith('```')) {
      const buf: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        buf.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      html += '<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>';
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        buf.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      html += '<blockquote>' + withBreaks(buf.join('\n')) + '</blockquote>';
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '').length;
      html += '<h' + level + '>' + inline(heading[2] ?? '') + '</h' + level + '>';
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      html += '<ul>';
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? '')) {
        html += '<li>' + inline((lines[index] ?? '').replace(/^[-*]\s+/, '')) + '</li>';
        index += 1;
      }
      html += '</ul>';
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      html += '<ol>';
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? '')) {
        html += '<li>' + inline((lines[index] ?? '').replace(/^\d+\.\s+/, '')) + '</li>';
        index += 1;
      }
      html += '</ol>';
      continue;
    }
    const buf = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^(```|>\s?|#{1,3}\s|[-*]\s|\d+\.\s)/.test(lines[index] ?? '')
    ) {
      buf.push(lines[index] ?? '');
      index += 1;
    }
    html += '<p>' + withBreaks(buf.join('\n')) + '</p>';
  }
  return html;
}
