import { en } from './en.ts';
import { nl } from './nl.ts';
import type { Lang, MessageKey, Messages } from './types.ts';

export type { Lang, MessageKey, Messages } from './types.ts';

const catalogs: Record<Lang, Messages> = { nl, en };

export function isLang(value: unknown): value is Lang {
  return value === 'nl' || value === 'en';
}

export function t(
  lang: Lang,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  let node: unknown = catalogs[lang];
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') {
    throw new Error(`Missing message "${key}" for "${lang}"`);
  }
  return node.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing parameter "${name}" for message "${key}"`);
    }
    return String(value);
  });
}
