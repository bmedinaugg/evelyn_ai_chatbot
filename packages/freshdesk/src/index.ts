export {
  createFreshdeskClient,
  type FreshdeskClient,
  type FreshdeskClientOptions,
} from './client.ts';
export {
  FreshdeskError,
  FreshdeskPaginationError,
  FreshdeskRateLimitError,
  FreshdeskResponseError,
} from './errors.ts';
export { escapeHtml, htmlToText } from './html.ts';
export type { CreateTicketInput, FreshdeskArticle, TicketField } from './schemas.ts';
