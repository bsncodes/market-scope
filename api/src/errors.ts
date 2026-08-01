import { ErrorCode } from './types/error';
import { HttpStatus } from './types/http';

export class AppError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// One constructor per code, so a call site names the failure it is raising and
// the status/code pairing is decided in exactly one place.
const define =
  (status: HttpStatus, code: ErrorCode) =>
  (message: string, details?: unknown) =>
    new AppError(status, code, message, details);

export const requestValidationFailed = define(
  HttpStatus.BadRequest,
  ErrorCode.REQUEST_VALIDATION_FAILED,
);

// 422: the request parsed fine, its contents are what we are rejecting.
export const resourceValidationFailed = define(
  HttpStatus.UnprocessableEntity,
  ErrorCode.RESOURCE_VALIDATION_FAILED,
);

export const malformedPayload = define(
  HttpStatus.BadRequest,
  ErrorCode.MALFORMED_PAYLOAD,
);

export const unsupportedMediaType = define(
  HttpStatus.UnsupportedMediaType,
  ErrorCode.UNSUPPORTED_MEDIA_TYPE,
);

export const payloadTooLarge = define(
  HttpStatus.PayloadTooLarge,
  ErrorCode.PAYLOAD_TOO_LARGE,
);

export const resourceNotFound = define(
  HttpStatus.NotFound,
  ErrorCode.RESOURCE_NOT_FOUND,
);

export const routeNotFound = define(
  HttpStatus.NotFound,
  ErrorCode.ROUTE_NOT_FOUND,
);

export const upstreamServiceFailed = define(
  HttpStatus.BadGateway,
  ErrorCode.UPSTREAM_SERVICE_FAILED,
);

// The upstream answered successfully, it just had nothing for this query.
export const upstreamNoResult = define(
  HttpStatus.NotFound,
  ErrorCode.UPSTREAM_NO_RESULT,
);

export const internalError = define(
  HttpStatus.InternalServerError,
  ErrorCode.INTERNAL_ERROR,
);
