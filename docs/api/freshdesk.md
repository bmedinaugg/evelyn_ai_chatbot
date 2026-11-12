# Freshdesk API v2: reference notes

Official reference: https://developers.freshdesk.com/api/ (read 2026-11-11).
Sections marked **(unverified)** are not confirmed by the official reference. The Solutions
section was checked against the official page on 2026-11-12; our live instance (language codes,
Flexible Hierarchy, multiple portals) still needs a check once credentials exist.

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
  - **(unverified)** Whether `POST /tickets` rejects a `type` that is not one of the `ticket_type`
    choices (expected: 400 validation error). The API only sends synced values as `type`.
- Ticket forms: `GET /api/v2/ticket-forms`, `GET /api/v2/ticket-forms/{id}` (only needed for
  the later "mirror each Freshdesk form" option).
- Contacts: `POST /api/v2/contacts` (409 on duplicate email);
  search `GET /api/v2/search/contacts?query="email:'x@y.com'"`. Creating a ticket with `email`
  creates the contact (standard behaviour; not explicitly stated in the docs).

## Solutions / knowledge base (checked against the official reference 2026-11-12)
- View folder: `GET /api/v2/solutions/folders/{id}` → `id`, `name`, `visibility`, `category_id`,
  `parent_folder_id`, `company_ids`, `contact_segment_ids`, `company_segment_ids`, …
  (`parent_folder_id`, `sub_folders_count`, `hierarchy` only with the "Flexible Hierarchy" feature).
- Folder `visibility`: 1 All Users, 2 Logged In Users, 3 Agents, 4 Selected Companies, 5 Bots,
  6 Selected Contact Segments, 7 Selected Company Segments. **The chatbot only syncs folders with
  visibility 1 whose parent folders are also 1** (public help-portal content only).
- View category: `GET /api/v2/solutions/categories/{id}` → `visible_in_portals` (portal ids; only on
  accounts with multiple portals). List: `GET /api/v2/solutions/categories`,
  `GET /api/v2/solutions/categories/{id}/folders`.
- **Our account is multi-brand** (checked live 2026-11-12): one Freshdesk account `urbangymgroup`
  serves the portals TrainMore (`103000108492`, www.support.trainmore.com), TrainMore UK, TrainMore IE,
  Clubsportive, Gymbox and an internal default portal. Several non-TrainMore folders are "All Users",
  so the sync also requires the folder's category to list `FRESHDESK_PORTAL_ID`. Live result: 10 of
  50 folders qualify, all with `nl` and `en` translations. (Portal ids were read once via
  `GET /api/v2/portals`, which is not in the official reference; the code does not use it.)
- Ticket fields: `ticket_type` is shared by all brands (Club, Corporate Fitness, Membership,
  Payments, Personal Training, Migrated from Zendesk). TrainMore's own contact forms use
  `cf_trainmore_uk_general_contact_form` / `cf_trainmore_ie_general_contact_form` ("What do you need
  support with?": Offering, Club, Payments, TrainMore App, Membership). **(open)** which field the
  NL portal's form uses.
- Languages (`GET /api/v2/settings/helpdesk`): primary `en`, supported `nl`.
- Articles have no visibility of their own; they follow their folder.
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
  Verified 2026-11-11: `/{en|nl}/support/solutions/articles/{id}` without a slug returns 200, so
  the sync builds both URLs from the article id.
