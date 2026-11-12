import { z } from 'zod';

export const customerStatusSchema = z.enum(['MEMBER', 'PROSPECT', 'FORMER_MEMBER']);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

/** Only the fields we need for routing; everything else in the Customer object is dropped. */
export const customerLookupSchema = z
  .object({
    id: z.number().int(),
    studioId: z.number().int(),
    status: customerStatusSchema,
  })
  .transform(({ id, studioId, status }) => ({ customerId: id, studioId, status }));

export type CustomerLookup = z.output<typeof customerLookupSchema>;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
