import type { en } from './en.ts';

export type Lang = 'nl' | 'en';

/** English is the reference shape; other languages must match it exactly (checked with `satisfies`). */
export type Messages = typeof en;

type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
}[keyof T & string];

export type MessageKey = DotPaths<Messages>;
