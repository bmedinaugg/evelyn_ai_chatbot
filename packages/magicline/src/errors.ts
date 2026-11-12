/** Errors carry the HTTP status and endpoint path only: response bodies may contain personal data. */
export class MagiclineError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(
    status: number,
    endpoint: string,
    message = `Magicline ${endpoint} failed with ${status}`,
  ) {
    super(message);
    this.name = 'MagiclineError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class MagiclineRateLimitError extends MagiclineError {
  readonly retryAfterSeconds: number | undefined;

  constructor(endpoint: string, retryAfterSeconds: number | undefined) {
    super(429, endpoint, `Magicline ${endpoint} rate limited`);
    this.name = 'MagiclineRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The response did not match the expected schema (status = HTTP status of the response). */
export class MagiclineResponseError extends MagiclineError {
  constructor(status: number, endpoint: string) {
    super(status, endpoint, `Magicline ${endpoint} returned an unexpected response`);
    this.name = 'MagiclineResponseError';
  }
}
