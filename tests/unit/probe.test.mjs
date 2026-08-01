import { describe, expect, it } from 'vitest';

describe('T-045 probe', () => {
  it('fails deliberately', () => {
    expect(1 + 1).toBe(3);
  });
});
