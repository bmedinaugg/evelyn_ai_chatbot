# Cloudflare Turnstile: server-side validation notes

Verified 2026-11-11 from the official docs:
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/troubleshooting/testing/

## Siteverify
- `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Body: `application/x-www-form-urlencoded` or JSON.
  - `secret` (required): widget secret key
  - `response` (required): token from the client widget
  - `remoteip` (optional): visitor IP
  - `idempotency_key` (optional): UUID for safe retries
- Response (JSON): `success` (boolean), `challenge_ts`, `hostname`, `error-codes` (on failure), `action`, `cdata`.
- Error codes: `missing-input-secret`, `invalid-input-secret`, `missing-input-response`,
  `invalid-input-response`, `bad-request`, `timeout-or-duplicate`, `internal-error`.

## Tokens
- Max 2048 characters; valid for 300 seconds; single use (duplicate checks are eventually consistent).
- No timeout is prescribed; the official examples use 10 seconds. Show users generic errors only.

## Test keys (never in production)
| Sitekey | Behaviour |
|---|---|
| `1x00000000000000000000AA` | always passes (visible) |
| `2x00000000000000000000AB` | always fails (visible) |
| `1x00000000000000000000BB` | always passes (invisible) |
| `2x00000000000000000000BB` | always fails (invisible) |
| `3x00000000000000000000FF` | forces an interactive challenge |

| Secret key | Behaviour |
|---|---|
| `1x0000000000000000000000000000000AA` | always passes |
| `2x0000000000000000000000000000000AA` | always fails |
| `3x0000000000000000000000000000000AA` | returns `timeout-or-duplicate` |

Test sitekeys produce the dummy token `XXXX.DUMMY.TOKEN.XXXX`, which only test secrets accept.
