import { HttpStatus } from './types/http';

export class AppError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(HttpStatus.BadRequest, code, message, details);

export const notFound = (code: string, message: string) =>
  new AppError(HttpStatus.NotFound, code, message);

export const badGateway = (code: string, message: string) =>
  new AppError(HttpStatus.BadGateway, code, message);
