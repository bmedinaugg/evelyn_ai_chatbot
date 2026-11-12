# Freshdesk API v2: reference notes

Official reference: https://developers.freshdesk.com/api/ (read 2026-11-11).
Sections marked **(unverified)** came from third-party wrappers, because the Solutions
section of the official page could not be read during research. Confirm them against
https://developers.freshdesk.com/api/#solutions and our live instance before relying on them.

## General
- Base URL: `https://{domain}.freshdesk.com/api/v2/...` (HTTPS only; custom CNAME does not work for the API).
- Auth: HTTP Basic, API key as username, any password (e.g. `X`), Base64-encoded.
- JSON only (multipart for attachments).
- Rate limits are per account and depend on the plan, e.g. Growth 100/min, Pro 400/min,
  Enterprise 700/min (trial 50/min). Some endpoints have lower sub-limits (ticket create/update,
  ticket list, contact list). Invalid requests count too.
- Headers: `X-RateLimit-Total`, `X-RateLimit-Remaining`, `X-RateLimit-Used-CurrentRequest`
  (newer: `X-RateLimit-Account-*`, `X-RateLimit-Sublimit-*`). Over the limit → HTTP 429 + `Retry-After` (seconds).
- Pagination: `page` (from 1), `per_page` (default 30, max 100); `link` header with `rel="next"`.

## Tickets (verified)
- Create: `POST /api/v2/tickets`
  - Requester: one of `requester_id`, `email`, `phone` (+`name`), `twitter_id`, `facebook_id`, `unique_external_id`.
  - Fields: `subject`, `description` (HTML), `tags` (≤30, each ≤32 chars), `custom_fields`, `type`,
    `group_id`, `priority` (1 Low … 4 Urgent), `status` (2 Open, 3 Pending, 4 Resolved, 5 Closed),
    `source` (1 Email, 2 Portal, 3 Phone, 7 Chat, 9 Feedback Widget, 10 Outbound Email).
  - Attachments: `multipart/form-data`, `attachments[]`; max 20 MB total per ticket.
- Add note: `POST /api/v2/tickets/{id}/notes`, with `body` (HTML), `private` (default true). Used for the transcript.
- Ticket fields: `GET /api/v2/ticket_fields` (`choices`, `label_for_customers`,
  `required_for_customers`, `displayed_to_customers`). Used to fill the general form's topic list.
- Ticket forms: `GET /api/v2/ticket-forms`, `GET /api/v2/ticket-forms/{id}` (only needed for
  the later "mirror each Freshdesk form" option).
- Contacts: `POST /api/v2/contacts` (409 on duplicate email);
  search `GET /api/v2/search/contacts?query="email:'x@y.com'"`. Creating a ticket with `email`
  creates the contact (standard behaviour; not explicitly stated in the docs).

## Solutions / knowledge base (unverified)
- List articles in folder: `GET /api/v2/solutions/folders/{folder_id}/articles`
- Translated list: `GET /api/v2/solutions/folders/{folder_id}/articles/{language_code}`
- Get article: `GET /api/v2/solutions/articles/{id}`; translation: `GET /api/v2/solutions/articles/{id}/{language_code}`
- Create/update (only for an optional future write-back): `POST /api/v2/solutions/folders/{folder_id}/articles`,
  `PUT /api/v2/solutions/articles/{id}`, `POST|PUT /api/v2/solutions/articles/{id}/{language_code}`
- `status`: 1 draft, 2 published (unpublish by setting `status: 1` is confirmed in the official docs).
- Language codes: expected `nl` and `en`; confirm in our instance (multilingual must be enabled).
- No `updated_since` filter or knowledge-base webhooks documented → daily full listing + compare `updated_at`/content hash.

## Our help portal
- Portal: `https://www.support.trainmore.com` (Freshdesk; languages `en` and `nl`).
- Article URL pattern (observed on the portal):
  `https://www.support.trainmore.com/{en|nl}/support/solutions/articles/{id}-{slug}`
  e.g. `/en/support/solutions/articles/103000345000-where-can-i-find-my-membership-number-`.
  The URL works without the slug (unverified); store the URL per language at sync time.
