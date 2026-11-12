# Magicline Open API: reference notes

Source of truth: `docs/api/magicline-openapi.json` (official spec, `info.version` 1.31.0,
downloaded 2026-11-11 from
`https://redocly.sportalliance.com/_spec/apis/magicline/openapi/openapi.json`).
Human docs: https://developer.sportalliance.com/apis/magicline/openapi/general-information

Everything below was checked against the spec file unless marked **(docs site only)**
or **(unverified)**. When in doubt, the spec file wins.

## General
- Base URL: `https://<tenant_name>.open-api.magicline.com/v1` (docs site only). The spec lists
  the demo tenant `https://open-api-demo.open-api.magicline.com`.
- Auth: header `X-API-KEY` (spec `securitySchemes.ApiKeyAuth`). Keys are issued when a studio
  activates the integration (docs site only).
- Every endpoint requires a permission scope, stated in its description, e.g. `CUSTOMER_READ`.
- Rate limit: 1000 requests/min per endpoint per API key; HTTP 429 when exceeded; headers
  `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` (docs site only).
- Pagination: "sliced" results with `offset` + `sliceSize`, response carries `hasNext`.
- Money: `{ amount: number, currency: "EUR" }`.
- Webhooks: a separate Webhooks API exists (docs site only, event list not verified):
  https://developer.sportalliance.com/apis/magicline/webhooks/event-types
- Mock server: `https://redocly.sportalliance.com/_mock/apis/magicline/openapi/openapi/` (docs site only).

## Customer lookup
| Method | Path | Scope | Notes |
|---|---|---|---|
| POST | `/v1/cross-studio/customers/search` | `CUSTOMER_READ` | "Returns customers from **all studios with activated partner integration**". Body `CustomerSearchRequest`: `email`, `firstName`, `lastName`, `dateOfBirth`, `phoneNumber`, `thirdPartyId`, `cardNumberFormat`. Returns `Customer[]` (max 100). |
| POST | `/v1/customers/search` | `CUSTOMER_READ` | Same body; only searches **the key's own studio**. |
| GET | `/v1/cross-studio/customers/{customerId}` | `CUSTOMER_READ` | Customer by id, across studios. |
| GET | `/v1/customers/{customerId}` | `CUSTOMER_READ` | Customer by id (own studio). |

`Customer` includes: `id`, `customerNumber`, `status` (`MEMBER` \| `PROSPECT` \| `FORMER_MEMBER`),
**`studioId`**, `email`, names, address, phones, `idlePeriods`, `accessRefusal`,
`accessRestrictions`, `preferredLanguage`, `createdDateTime`.
→ Contains lots of personal data; must stay server-side and be reduced to an allowlist.

**(unverified)** Whether email matching is exact or case-insensitive, and which key/tenant is
needed to call the cross-studio endpoints. To confirm with Magicline.

## Read endpoints used by the bot (capability catalogue)
| Capability | Method + path | Scope |
|---|---|---|
| Contracts | GET `/v1/customers/{customerId}/contracts?status=ACTIVE\|INACTIVE` | `CUSTOMER_CONTRACT_READ` or `CUSTOMER_READ` |
| Contract (self-service view: cancellation dates/status) | GET `/v1/memberships/{customerId}/self-service/contract-data` | `MEMBERSHIP_SELF_SERVICE_READ` |
| Idle (freeze) periods | GET `/v1/memberships/{contractId}/self-service/idle-periods` | `MEMBERSHIP_SELF_SERVICE_IDLE_PERIOD_READ` |
| Account balance | GET `/v1/customers/{customerId}/account/balances` | `CUSTOMER_ACCOUNT_READ` |
| Past transactions | GET `/v1/customers/{customerId}/account/transactions` (sliced) | `CUSTOMER_ACCOUNT_READ` |
| Upcoming transactions (next year) | GET `/v1/customers/{customerId}/account/transactions/upcoming` (sliced) | `CUSTOMER_ACCOUNT_READ` |
| Dunning (payment reminders) | GET `/v1/customers/{customerId}/account/dunning` | `CUSTOMER_DUNNING_READ` |
| Payment method | GET `/v1/customers/{customerId}/account/payment-details` | `PAYMENT_READ` |
| Check-ins | GET `/v1/customers/{customerId}/activities/checkins?fromDate&toDate` (default: one month) | `CHECKIN_READ` |
| Check-ins (cross-studio) | GET `/v1/cross-studio/customers/{customerId}/activities/checkins` | `CHECKIN_READ` |
| Class bookings | GET `/v1/classes/booking?customerId=` | `CLASSES_READ` |
| Class bookings (cross-studio) | GET `/v1/cross-studio/customers/{customerId}/class-bookings?studioId&slotWindowStartDate&daysAhead` | `CLASSES_READ` |
| Appointment bookings | GET `/v1/appointments/booking?customerId=` | `APPOINTMENTS_READ` |
| Appointment bookings (cross-studio) | GET `/v1/cross-studio/customers/{customerId}/appointment-bookings` | `APPOINTMENTS_READ` |
| Benefits | GET `/v1/customers/{customerId}/benefits` | `CUSTOMER_BENEFIT_READ` or `CUSTOMER_READ` |
| Documents | GET `/v1/customers/{customerId}/documents` | `CUSTOMER_DOCUMENT_READ` |
| Studio info | GET `/v1/studios/information` | `STUDIO_READ` |
| Studio busyness | GET `/v1/studios/utilization` | (see spec) |
| Membership offers (prospects) | GET `/v1/memberships/membership-offers` | (see spec) |

Key fields:
- `Contract`: `startDate`, `endDate`, `rateName`, `contractStatus` (`ACTIVE`\|`INACTIVE`),
  `cancellationPeriod` (`{periodValue, periodUnit: DAY|WEEK|MONTH|YEAR}`), `cancelled`,
  `cancellationDate`, `lastPossibleCancellationDate`, `term`, `extensionTerm`, `price`,
  `priceDetails`, `trialPeriodStartDate/EndDate`.
- `MembershipSelfServiceContractData`: `cancelationStatus` (`CANCELED`\|`PENDING_VERIFICATION`\|
  `PENDING_WITHDRAWAL_VERIFICATION`), `availableCancelationDates`, `withdrawalPossible`,
  `lastPossibleWithdrawalDate`, `cancelationStrategy` (`TERM`\|`RECEIPT_DATE`).
- `CustomerAccountBalance`: `accountBalance`, `consumptionCredit`, `dunningLevel`,
  `inDebtCollection`, `inDebtCollectionSince`, `lastAccountBalanceUpdated`.
- `CustomerDunning`: `dunned`, `accessRestricted`, `dunningLevel`, `amount`, `fee`,
  `inDebtCollection`, `collectionStop`, `debtClaims[]`.
- `CustomerPaymentDetails`: `defaultPaymentMethod` (`UNDEFINED`\|`CASH`\|`DIRECT_DEBIT`\|
  `BANK_TRANSFER`\|`CREDIT_CARD`\|`TWINT`), `paymentInstruments[]` (mask before use).

## Write endpoints (exist, NOT used: bot is read-only)
Contract cancellation / withdrawal, idle-period create/update/withdraw, contact/address/master/
payment data amendments, class and appointment book/cancel (`DELETE /v1/classes/booking/{bookingId}`),
membership switch, due-date change, communication preferences, payments.
Kept as candidate future capabilities (milestone M7).

## Known limitations (for the portal "limitations" page)
- No dedicated invoice endpoint; transactions/booking entries only. `documents` may contain
  invoices (unverified).
- Customer search returns at most 100 results; matching semantics unverified.
- Check-in history defaults to one month; ask for explicit date ranges.
- No webhook signature details verified yet.
