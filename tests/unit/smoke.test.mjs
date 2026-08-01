import { describe, expect, it } from 'vitest';

/**
 * The trivial test (IMPL PLAN 21.4, DEL-35).
 *
 * One test asserting one true thing, existing solely so that `ci.yml` can be
 * proven end to end on a no-op pull request - which is milestone MS-0's demo.
 *
 * It is deleted in PH-01 when real tests arrive, and its deletion is the first
 * real exercise of the review process.
 */
describe('toolchain smoke', () => {
  it('runs a test', () => {
    expect(true).toBe(true);
  });
});
