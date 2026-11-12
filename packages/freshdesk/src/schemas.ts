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
};
