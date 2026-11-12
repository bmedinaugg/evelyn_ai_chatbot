/** Errors carry the HTTP status and endpoint path only: response bodies may contain personal data. */
export class FreshdeskError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(
    status: number,
    endpoint: string,
    message = `Freshdesk ${endpoint} failed with ${status}`,
  ) {
    super(message);
    this.name = 'FreshdeskError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class FreshdeskRateLimitError extends FreshdeskError {
  readonly retryAfterSeconds: number | undefined;

  constructor(endpoint: string, retryAfterSeconds: number | undefined) {
    super(429, endpoint, `Freshdesk ${endpoint} rate limited`);
    this.name = 'FreshdeskRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The response did not match the expected schema (status = HTTP status of the response). */
export class FreshdeskResponseError extends FreshdeskError {
  constructor(status: number, endpoint: string) {
    super(status, endpoint, `Freshdesk ${endpoint} returned an unexpected response`);
    this.name = 'FreshdeskResponseError';
  }
}
