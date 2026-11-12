import { z } from 'zod';

// Field names per docs/api/freshdesk.md (Solutions checked against the official API reference).
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
  /** Requester name (optional, shown to agents). */
  name?: string;
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

/** Folder visibility 1 = "All Users" (public); see docs/api/freshdesk.md for the other values. */
export const FOLDER_VISIBILITY_ALL_USERS = 1;

export const folderSchema = z
  .object({
    id: z.number().int(),
    visibility: z.number().int(),
    parent_folder_id: z.number().int().nullable().optional(),
    category_id: z.number().int().nullable().optional(),
  })
  .transform((f) => ({
    id: f.id,
    visibility: f.visibility,
    parentFolderId: f.parent_folder_id ?? null,
    categoryId: f.category_id ?? null,
  }));
export type SolutionFolder = z.output<typeof folderSchema>;

/** visible_in_portals: portal ids the category is shown on (only on multi-portal accounts). */
export const categorySchema = z
  .object({
    id: z.number().int(),
    visible_in_portals: z.array(z.number().int()).nullable().optional(),
  })
  .transform((c) => ({ id: c.id, visibleInPortals: c.visible_in_portals ?? null }));
export type SolutionCategory = z.output<typeof categorySchema>;
