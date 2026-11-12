import { z } from 'zod';

// Field names per docs/api/freshdesk.md (Solutions section unverified until checked live).
export const articleSchema = z
  .object({
    id: z.number().int(),
    folder_id: z.number().int(),
    title: z.string(),
    description: z.string(),
    status: z.number().int(),
    updated_at: z.string(),
  })
  .transform((a) => ({
    id: a.id,
    folderId: a.folder_id,
    title: a.title,
    descriptionHtml: a.description,
    status: a.status,
    updatedAt: a.updated_at,
  }));

export type FreshdeskArticle = z.output<typeof articleSchema>;

export const createdTicketSchema = z
  .object({ id: z.number().int() })
  .transform(({ id }) => ({ id }));

export type CreateTicketInput = {
  email: string;
  subject: string;
  descriptionText: string;
  tags: string[];
  phone?: string;
  /** Ticket type (one of the ticket_type field's choices). */
  type?: string;
};

/** Ticket field with its choices when they are a plain list (dropdowns such as ticket_type). */
export const ticketFieldSchema = z
  .object({ name: z.string(), choices: z.unknown().optional() })
  .transform(({ name, choices }) => ({
    name,
    choices:
      Array.isArray(choices) && choices.every((c) => typeof c === 'string')
        ? (choices as string[])
        : [],
  }));
export type TicketField = z.output<typeof ticketFieldSchema>;

export const noteSchema = z.object({ id: z.number().int() }).transform(({ id }) => ({ id }));
