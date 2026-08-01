/**
 * A deterministic random source (TR-TEST-032).
 *
 * Used by every test that touches ordering, jitter, or sampling. `core/` may
 * not call `Math.random()` (DR-2); randomness arrives as an argument, and in a
 * test that argument must produce the same sequence on every run so that a
 * failure is reproducible from the seed alone.
 *
 * The generator is mulberry32: thirty-two bits of state, four operations, a
 * period of 2^32, and uniform output. It is not cryptographic and must never be
 * used as though it were - `node:crypto` covers that need in `core/util/hash`.
 * It is here because a reproducible sequence is worth more in a test than
 * unpredictability is.
 */

const UINT32 = 0x100000000;
const MULBERRY_INCREMENT = 0x6d2b79f5;
const MIX_A = 15;
const MIX_B = 61;
const MIX_C = 7;
const MIX_D = 14;

/**
 * @typedef {object} SeededRandom
 * @property {() => number} next          Float in [0, 1).
 * @property {(min: number, max: number) => number} int   Integer in [min, max].
 * @property {<T>(items: readonly T[]) => T[]} shuffle    A shuffled copy.
 * @property {() => void} reset           Returns the sequence to its start.
 */

/**
 * Creates a reproducible pseudo-random source.
 *
 * @param {number} [seed] Any 32-bit integer. The default is fixed so that a
 *   test which forgets to choose one is still deterministic.
 * @returns {SeededRandom}
 */
export function createSeededRandom(seed = 0x5eed) {
  let state = seed >>> 0;

  const next = () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> MIX_A), 1 | t);
    t = (t + Math.imul(t ^ (t >>> MIX_C), MIX_B | t)) ^ t;
    return ((t ^ (t >>> MIX_D)) >>> 0) / UINT32;
  };

  return {
    next,

    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new TypeError('seeded-random: int() needs integer bounds.');
      }
      if (max < min) {
        throw new RangeError(`seeded-random: max ${max} is below min ${min}.`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },

    shuffle(items) {
      // Fisher-Yates over a copy. The input is never mutated, because a helper
      // that reorders its caller's array produces test failures that appear in
      // a different test than the one that caused them.
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i];
        const b = out[j];
        if (a !== undefined && b !== undefined) {
          out[i] = b;
          out[j] = a;
        }
      }
      return out;
    },

    reset() {
      state = seed >>> 0;
    },
  };
}
