const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
};

function decodeEntities(text: string): string {
  // Single pass, so "&amp;lt;" becomes "&lt;" and never "<".
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return safeFromCodePoint(Number.parseInt(entity.slice(2), 16), match);
    }
    if (entity.startsWith('#')) {
      return safeFromCodePoint(Number.parseInt(entity.slice(1), 10), match);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function safeFromCodePoint(codePoint: number, fallback: string): string {
  return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback;
}

/** Converts Freshdesk article HTML to plain text for storage and for the LLM. */
export function htmlToText(html: string): string {
  const withoutTags = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|tr|blockquote)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(withoutTags)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Escapes text for Freshdesk's HTML ticket description. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
