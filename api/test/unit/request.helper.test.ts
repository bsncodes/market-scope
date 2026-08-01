import { expect } from 'chai';
import { AppError } from '../../src/errors';
import { requireId } from '../../src/helpers/request';
import { ErrorCode } from '../../src/types/error';
import { HttpStatus } from '../../src/types/http';

describe('requireId', () => {
  it('accepts a positive integer string, as it arrives from a route param', () => {
    expect(requireId('42', 'countryId')).to.equal(42);
  });

  it('rejects zero, negatives and fractions', () => {
    for (const raw of ['0', '-1', '1.5']) {
      expect(() => requireId(raw, 'countryId')).to.throw(AppError);
    }
  });

  it('rejects non-numeric and empty input', () => {
    for (const raw of ['abc', '', undefined, null, {}]) {
      expect(() => requireId(raw, 'cityId')).to.throw(AppError);
    }
  });

  it('names the parameter in the message so the caller knows which one', () => {
    try {
      requireId('abc', 'stateId');
      expect.fail('expected requireId to throw');
    } catch (err) {
      if (!(err instanceof AppError)) {
        throw new Error(`expected an AppError, got ${String(err)}`);
      }
      expect(err.code).to.equal(ErrorCode.REQUEST_VALIDATION_FAILED);
      expect(err.status).to.equal(HttpStatus.BadRequest);
      expect(err.message).to.match(/stateId/);
    }
  });
});
