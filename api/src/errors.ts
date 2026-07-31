export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const notFound = (code: string, message: string) =>
  new AppError(404, code, message);

export const badGateway = (code: string, message: string) =>
  new AppError(502, code, message);
