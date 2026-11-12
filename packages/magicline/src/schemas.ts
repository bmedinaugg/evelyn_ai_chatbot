import { z } from 'zod';

export const customerStatusSchema = z.enum(['MEMBER', 'PROSPECT', 'FORMER_MEMBER']);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

/** Only the fields we need for routing; everything else in the Customer object is dropped. */
export const customerLookupSchema = z
  .object({
    id: z.number().int(),
    studioId: z.number().int(),
    status: customerStatusSchema,
    customerNumber: z.string().nullish(),
  })
  .transform(({ id, studioId, status, customerNumber }) => ({
    customerId: id,
    studioId,
    status,
    customerNumber: customerNumber ?? null,
  }));

export type CustomerLookup = z.output<typeof customerLookupSchema>;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Only what the chatbot needs from StudioInformation (id and display name). */
export const studioInformationSchema = z
  .object({ studioId: z.number().int(), name: z.string() })
  .transform(({ studioId, name }) => ({ studioId, name }));
export type StudioInformation = z.output<typeof studioInformationSchema>;
