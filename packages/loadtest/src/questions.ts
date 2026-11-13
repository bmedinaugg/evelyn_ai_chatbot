export type Lang = 'nl' | 'en';

/**
 * Generic help-centre questions, no personal data. Each visitor picks one language per
 * conversation and asks 1–3 of these in that language (like a visitor on /nl/ or /en/ pages).
 */
export const QUESTIONS: Readonly<Record<Lang, readonly string[]>> = {
  nl: [
    'Hoe zeg ik mijn lidmaatschap op?',
    'Kan ik mijn abonnement tijdelijk pauzeren?',
    'Mag ik een vriend meenemen om te trainen?',
    'Hoe wijzig ik mijn betaalgegevens?',
    'Welke groepslessen kan ik volgen?',
    'Kan ik in alle clubs trainen?',
  ],
  en: [
    'How do I cancel my membership?',
    'Can I pause my membership for a while?',
    'Can I bring a friend to train?',
    'How do I change my payment details?',
    'Which group classes can I join?',
    'Can I train at every club?',
  ],
};
