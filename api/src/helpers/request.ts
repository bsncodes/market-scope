import { badRequest } from '../errors';

export function requireId(raw: unknown, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(`${name} must be a positive integer.`);
  }
  return value;
}
