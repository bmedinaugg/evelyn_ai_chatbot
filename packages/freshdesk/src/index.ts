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
export {
  type CreateTicketInput,
  FOLDER_VISIBILITY_ALL_USERS,
  type FreshdeskArticle,
  type SolutionFolder,
  type TicketField,
} from './schemas.ts';
