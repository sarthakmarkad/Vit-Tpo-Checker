export class TpoError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options ? { cause: options.cause } : undefined);
    this.name = "TpoError";
  }
}

/** Session headers missing/blank in configuration. Not retryable. */
export class TpoSessionMissingError extends TpoError {
  constructor(missing: string[]) {
    super(
      `TPO session unavailable: ${missing.join(", ")}. ` +
        `Run \`npm run login\` to establish a session.`,
    );
    this.name = "TpoSessionMissingError";
  }
}

/** 401/403 or an API-level auth rejection. Session likely expired. Not retryable. */
export class TpoAuthError extends TpoError {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TpoAuthError";
    this.status = status;
  }
}

/** API reachable but returned an unexpected/failed business status. Not retryable. */
export class TpoApiError extends TpoError {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "TpoApiError";
    this.code = code;
  }
}

/** Response body was not parseable/expected JSON. Not retryable. */
export class TpoMalformedResponseError extends TpoError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "TpoMalformedResponseError";
  }
}

/** Request timed out. Retryable. */
export class TpoTimeoutError extends TpoError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`TPO API request timed out after ${timeoutMs}ms`);
    this.name = "TpoTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Network-level failure (DNS, connection refused, reset). Retryable. */
export class TpoNetworkError extends TpoError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "TpoNetworkError";
  }
}
