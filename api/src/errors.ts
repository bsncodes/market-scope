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

export const badRequest = (message: string, details?: unknown) =>
  new AppError(
    HttpStatus.BadRequest,
    ErrorCode.ValidationError,
    message,
    details,
  );

export const notFound = (message: string) =>
  new AppError(HttpStatus.NotFound, ErrorCode.NotFound, message);

export const badGateway = (message: string) =>
  new AppError(HttpStatus.BadGateway, ErrorCode.ExternalServiceError, message);
