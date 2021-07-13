import { checkFetcher } from '../checkFetcher';
import { voidFetchDuringEachTest } from './helpers';

describe('checkFetcher', () => {
  voidFetchDuringEachTest();

  it('throws if no fetch is present', () => {
    expect(() => checkFetcher(undefined)).toThrow(
      /has not been found globally/,
    );
  });

  it('does not throws if no fetch is present but a fetch is passed', () => {
    expect(() => checkFetcher((() => {}) as any)).not.toThrow();
  });
});
