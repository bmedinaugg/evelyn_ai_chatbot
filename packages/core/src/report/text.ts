import { maskText } from '@trainmore/shared';

const MAX_QUESTION = 300;
const MAX_EXAMPLE = 160;

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A flagged customer question as sent to the fast model: masked, one line, at most 300 chars. */
export function prepareQuestion(text: string): string {
  const flat = flatten(maskText(text));
  return flat.length > MAX_QUESTION ? flat.slice(0, MAX_QUESTION) : flat;
}

// URLs and bare domains, so mail clients cannot turn customer text into a clickable link.
const URL_SCHEME = /\b[a-z][a-z0-9+.-]*:\/\/+/gi;
const DOMAIN = /\b((?:[a-z0-9-]+\.)+)([a-z]{2,})\b/gi;

/** Customer text in the report email: masked, links defanged, one line, at most 160 chars. */
export function exampleText(text: string): string {
  const defanged = maskText(text)
    .replace(URL_SCHEME, '')
    .replace(
      DOMAIN,
      (_match, labels: string, tld: string) => `${labels.replace(/\./g, '[.]')}${tld}`,
    );
  return cut(flatten(defanged), MAX_EXAMPLE);
}

/** Line breaks, tabs and other C0/DEL control characters. */
export function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Text that may come from the model (topic labels): no links, markup or recognisable personal data. */
export function isSafeLabel(label: string): boolean {
  return (
    label.length >= 3 &&
    label.length <= 60 &&
    // Line breaks and other control characters could fake lines in the plain-text email.
    !hasControlCharacter(label) &&
    !/[<>]/.test(label) &&
    !/:\/\//.test(label) &&
    !/\bwww\./i.test(label) &&
    !new RegExp(DOMAIN.source, 'i').test(label) &&
    maskText(label) === label
  );
}
