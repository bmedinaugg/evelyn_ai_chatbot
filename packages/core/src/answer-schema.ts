import { z } from 'zod';

/** The structured answer Claude must return (enforced with structured outputs). */
export const answerSchema = z.object({
  language: z.enum(['nl', 'en']),
  intent: z.enum(['faq', 'greeting', 'sales_lead', 'account_question', 'wants_human', 'off_topic']),
  answer: z.string(),
  citedArticleIds: z.array(z.number().int()),
  confidence: z.enum(['high', 'medium', 'low']),
  needsHuman: z.boolean(),
  /** Id of an approved answer from <approved_answers> that fully answers the question, else null. */
  approvedAnswerId: z.number().int().nullable(),
});

export type Answer = z.infer<typeof answerSchema>;
