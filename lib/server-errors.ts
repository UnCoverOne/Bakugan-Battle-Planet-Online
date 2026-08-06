export type ServerErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "CONFLICT_ERROR"
  | "RATE_LIMIT_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ServerError extends Error {
  readonly status: number;
  readonly code: ServerErrorCode;
  readonly publicMessage: string;
  readonly retryAfterSeconds?: number;

  constructor(
    name: string,
    status: number,
    code: ServerErrorCode,
    publicMessage: string,
    internalMessage = publicMessage,
    retryAfterSeconds?: number,
  ) {
    super(internalMessage);
    this.name = name;
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ValidationError extends ServerError {
  constructor(publicMessage: string, internalMessage = publicMessage) {
    super("ValidationError", 400, "VALIDATION_ERROR", publicMessage, internalMessage);
  }
}

export class AuthenticationError extends ServerError {
  constructor(publicMessage = "Sign in is required.", internalMessage = publicMessage) {
    super("AuthenticationError", 401, "AUTHENTICATION_ERROR", publicMessage, internalMessage);
  }
}

export class AuthorizationError extends ServerError {
  constructor(publicMessage = "You are not allowed to perform this action.", internalMessage = publicMessage) {
    super("AuthorizationError", 403, "AUTHORIZATION_ERROR", publicMessage, internalMessage);
  }
}

export class ConflictError extends ServerError {
  constructor(publicMessage: string, internalMessage = publicMessage) {
    super("ConflictError", 409, "CONFLICT_ERROR", publicMessage, internalMessage);
  }
}

export class RateLimitError extends ServerError {
  constructor(retryAfterSeconds: number, publicMessage = "Rate limit exceeded. Try again shortly.") {
    super("RateLimitError", 429, "RATE_LIMIT_ERROR", publicMessage, publicMessage, retryAfterSeconds);
  }
}

export class ServiceUnavailableError extends ServerError {
  constructor(publicMessage = "The service is temporarily unavailable.", internalMessage = publicMessage) {
    super("ServiceUnavailableError", 503, "SERVICE_UNAVAILABLE", publicMessage, internalMessage);
  }
}

export class UnexpectedServerError extends ServerError {
  constructor(publicMessage = "The request could not be completed.", internalMessage = publicMessage) {
    super("UnexpectedServerError", 500, "INTERNAL_ERROR", publicMessage, internalMessage);
  }
}

export type PublicErrorPayload = {
  error: string;
  code: ServerErrorCode;
  correlationId: string;
  retryAfter?: number;
};

function infrastructureFailure(error: unknown, fallbackPublicMessage: string) {
  if (!(error instanceof Error)) return null;
  if (!/(?:D1_ERROR|database (?:is )?(?:unavailable|locked)|DB binding|D1 binding|Durable Object|MATCHES binding|match coordinator|network connection|fetch failed|timed? out)/i.test(error.message)) {
    return null;
  }
  return new ServiceUnavailableError(
    fallbackPublicMessage,
    error.message,
  );
}

export function serverErrorResponse(
  error: unknown,
  correlationId: string,
  fallbackPublicMessage: string,
  context: Record<string, unknown> = {},
) {
  const typed = error instanceof ServerError
    ? error
    : infrastructureFailure(error, fallbackPublicMessage)
      ?? new UnexpectedServerError(
        fallbackPublicMessage,
        error instanceof Error ? error.message : String(error),
      );
  const detail = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { value: String(error) };
  console.error(JSON.stringify({
    event: "server_request_failed",
    correlationId,
    status: typed.status,
    code: typed.code,
    context,
    detail,
  }));
  const payload: PublicErrorPayload = {
    error: typed.publicMessage,
    code: typed.code,
    correlationId,
    ...(typed.retryAfterSeconds ? { retryAfter: typed.retryAfterSeconds } : {}),
  };
  return Response.json(payload, {
    status: typed.status,
    headers: {
      "cache-control": "no-store",
      ...(typed.retryAfterSeconds ? { "retry-after": String(typed.retryAfterSeconds) } : {}),
    },
  });
}
