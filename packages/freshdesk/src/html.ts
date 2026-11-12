// Latin-1 letters and symbols plus common punctuation (generated from the HTML5 entity list).
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  AElig: '\u{c6}',
  Aacute: '\u{c1}',
  Acirc: '\u{c2}',
  Agrave: '\u{c0}',
  Aring: '\u{c5}',
  Atilde: '\u{c3}',
  Auml: '\u{c4}',
  Ccedil: '\u{c7}',
  ETH: '\u{d0}',
  Eacute: '\u{c9}',
  Ecirc: '\u{ca}',
  Egrave: '\u{c8}',
  Euml: '\u{cb}',
  Iacute: '\u{cd}',
  Icirc: '\u{ce}',
  Igrave: '\u{cc}',
  Iuml: '\u{cf}',
  Ntilde: '\u{d1}',
  OElig: '\u{152}',
  Oacute: '\u{d3}',
  Ocirc: '\u{d4}',
  Ograve: '\u{d2}',
  Oslash: '\u{d8}',
  Otilde: '\u{d5}',
  Ouml: '\u{d6}',
  Scaron: '\u{160}',
  THORN: '\u{de}',
  Uacute: '\u{da}',
  Ucirc: '\u{db}',
  Ugrave: '\u{d9}',
  Uuml: '\u{dc}',
  Yacute: '\u{dd}',
  Yuml: '\u{178}',
  aacute: '\u{e1}',
  acirc: '\u{e2}',
  acute: '\u{b4}',
  aelig: '\u{e6}',
  agrave: '\u{e0}',
  amp: '\u{26}',
  apos: '\u{27}',
  aring: '\u{e5}',
  atilde: '\u{e3}',
  auml: '\u{e4}',
  bdquo: '\u{201e}',
  brvbar: '\u{a6}',
  bull: '\u{2022}',
  ccedil: '\u{e7}',
  cedil: '\u{b8}',
  cent: '\u{a2}',
  copy: '\u{a9}',
  curren: '\u{a4}',
  dagger: '\u{2020}',
  deg: '\u{b0}',
  divide: '\u{f7}',
  eacute: '\u{e9}',
  ecirc: '\u{ea}',
  egrave: '\u{e8}',
  eth: '\u{f0}',
  euml: '\u{eb}',
  euro: '\u{20ac}',
  frac12: '\u{bd}',
  frac14: '\u{bc}',
  frac34: '\u{be}',
  gt: '\u{3e}',
  hellip: '\u{2026}',
  iacute: '\u{ed}',
  icirc: '\u{ee}',
  iexcl: '\u{a1}',
  igrave: '\u{ec}',
  iquest: '\u{bf}',
  iuml: '\u{ef}',
  laquo: '\u{ab}',
  ldquo: '\u{201c}',
  lsaquo: '\u{2039}',
  lsquo: '\u{2018}',
  lt: '\u{3c}',
  macr: '\u{af}',
  mdash: '\u{2014}',
  micro: '\u{b5}',
  middot: '\u{b7}',
  nbsp: '\u{a0}',
  ndash: '\u{2013}',
  not: '\u{ac}',
  ntilde: '\u{f1}',
  oacute: '\u{f3}',
  ocirc: '\u{f4}',
  oelig: '\u{153}',
  ograve: '\u{f2}',
  ordf: '\u{aa}',
  ordm: '\u{ba}',
  oslash: '\u{f8}',
  otilde: '\u{f5}',
  ouml: '\u{f6}',
  para: '\u{b6}',
  permil: '\u{2030}',
  plusmn: '\u{b1}',
  pound: '\u{a3}',
  quot: '\u{22}',
  raquo: '\u{bb}',
  rdquo: '\u{201d}',
  reg: '\u{ae}',
  rsaquo: '\u{203a}',
  rsquo: '\u{2019}',
  sbquo: '\u{201a}',
  scaron: '\u{161}',
  sect: '\u{a7}',
  shy: '\u{ad}',
  sup1: '\u{b9}',
  sup2: '\u{b2}',
  sup3: '\u{b3}',
  szlig: '\u{df}',
  thorn: '\u{fe}',
  times: '\u{d7}',
  trade: '\u{2122}',
  uacute: '\u{fa}',
  ucirc: '\u{fb}',
  ugrave: '\u{f9}',
  uml: '\u{a8}',
  uuml: '\u{fc}',
  yacute: '\u{fd}',
  yen: '\u{a5}',
  yuml: '\u{ff}',
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
    // Entity names are case-sensitive (&Eacute; is not &eacute;).
    return NAMED_ENTITIES[entity] ?? match;
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
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, '')
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
