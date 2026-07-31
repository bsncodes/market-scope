/**
 * Deliberately coarse. The code tells a client which broad category of failure
 * occurred so it can branch; the message explains the specific cause. Anything
 * a client needs to act on programmatically belongs in `details`, not in an
 * ever-growing list of codes.
 */
export enum ErrorCode {
  ValidationError = 'VALIDATION_ERROR',
  NotFound = 'NOT_FOUND',
  PayloadTooLarge = 'PAYLOAD_TOO_LARGE',
  ExternalServiceError = 'EXTERNAL_SERVICE_ERROR',
  InternalError = 'INTERNAL_ERROR',
}
