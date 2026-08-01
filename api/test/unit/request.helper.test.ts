import assert from 'node:assert/strict';
import { AppError } from '../../src/errors';
import { requireId } from '../../src/helpers/request';
import { ErrorCode } from '../../src/types/error';
import { HttpStatus } from '../../src/types/http';

describe('requireId', () => {
  it('accepts a positive integer string, as it arrives from a route param', () => {
    assert.equal(requireId('42', 'countryId'), 42);
  });

  it('rejects zero, negatives and fractions', () => {
    for (const raw of ['0', '-1', '1.5']) {
      assert.throws(() => requireId(raw, 'countryId'), AppError);
    }
  });

  it('rejects non-numeric and empty input', () => {
    for (const raw of ['abc', '', undefined, null, {}]) {
      assert.throws(() => requireId(raw, 'cityId'), AppError);
    }
  });

  it('names the parameter in the message so the caller knows which one', () => {
    try {
      requireId('abc', 'stateId');
      assert.fail('expected requireId to throw');
    } catch (err) {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCode.REQUEST_VALIDATION_FAILED);
      assert.equal(err.status, HttpStatus.BadRequest);
      assert.match(err.message, /stateId/);
    }
  });
});
