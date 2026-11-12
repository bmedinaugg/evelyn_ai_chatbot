import type { Messages } from './types.ts';

export const nl = {
  common: {
    error: {
      generic: 'Er ging iets mis. Probeer het opnieuw.',
    },
    greeting: 'Hoi {name}!',
  },
} satisfies Messages;
