export enum HttpStatus {
  Ok = 200,
  Created = 201,
  Accepted = 202,
  BadRequest = 400,
  NotFound = 404,
  PayloadTooLarge = 413,
  UnprocessableEntity = 422,
  TooManyRequests = 429,
  InternalServerError = 500,
  BadGateway = 502,
  GatewayTimeout = 504,
}
