import { requestValidationFailed } from '../errors';

export function requireId(raw: unknown, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw requestValidationFailed(`${name} must be a positive integer.`);
  }
  return value;
}
