import type { FaqSearchHit } from '@trainmore/db';

export const cancelNl: FaqSearchHit = {
  articleId: 900101,
  lang: 'nl',
  title: 'Hoe zeg ik mijn lidmaatschap op?',
  body: 'Je kunt je lidmaatschap opzeggen via de app.',
  url: 'https://portal.example/nl/support/solutions/articles/900101',
  rank: 0.5,
};

export const lockersNl: FaqSearchHit = {
  articleId: 900107,
  lang: 'nl',
  title: 'Hoe werken de kluisjes?',
  body: 'Neem je eigen hangslot mee.',
  url: 'https://portal.example/nl/support/solutions/articles/900107',
  rank: 0.3,
};
