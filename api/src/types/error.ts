export enum ErrorCode {
  // The request itself is wrong: a bad path/query parameter, or a required
  // part of the request missing.
  REQUEST_VALIDATION_FAILED = 'REQUEST_VALIDATION_FAILED',
  // The request is well formed but its contents cannot be accepted — invalid
  // CSV rows, a missing column, no data.
  RESOURCE_VALIDATION_FAILED = 'RESOURCE_VALIDATION_FAILED',
  // The body could not be parsed at all, so its contents were never inspected.
  MALFORMED_PAYLOAD = 'MALFORMED_PAYLOAD',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',

  // A referenced entity does not exist, as opposed to the endpoint itself.
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND',

  // A third-party service failed, versus answering successfully with nothing
  // usable. The first is retryable, the second is not.
  UPSTREAM_SERVICE_FAILED = 'UPSTREAM_SERVICE_FAILED',
  UPSTREAM_NO_RESULT = 'UPSTREAM_NO_RESULT',

  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
