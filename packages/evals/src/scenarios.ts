import type { ScenarioContent } from '@trainmore/db';

/** Synthetic approved answers for evals (created before a run, archived after). Not real policy. */
export const EVAL_SCENARIOS = {
  pets: {
    triggersNl: ['Mag ik mijn hond meenemen naar de club?', 'Zijn huisdieren toegestaan?'],
    triggersEn: ['Can I bring my dog to the club?', 'Are pets allowed?'],
    answerNl:
      'Huisdieren zijn helaas niet toegestaan in onze clubs, met uitzondering van hulphonden.',
    answerEn: 'Unfortunately pets are not allowed in our clubs, except for assistance dogs.',
    statuses: [],
    articleId: null,
  },
  transfer: {
    triggersNl: ['Kan ik mijn lidmaatschap overzetten naar iemand anders?'],
    triggersEn: ['Can I transfer my membership to someone else?'],
    answerNl:
      'Je kunt je lidmaatschap eenmalig gratis overzetten; vraag dit aan via het contactformulier.',
    answerEn:
      'You can transfer your membership once for free; request it through the contact form.',
    statuses: ['MEMBER'],
    articleId: null,
  },
} satisfies Record<string, ScenarioContent>;
