import { describe, expect, it } from 'vitest';

import {
  TIER_CADENCE_HOURS,
  byPriority,
  computeTargets,
  dueTargets,
} from '../../../src/app/registry.mjs';
import {
  DEFAULT_COST,
  balanceOf,
  estimateCost,
  planShards,
  seededOrder,
} from '../../../src/app/shard-planner.mjs';
import { ROBOTS_MODES, checkOrder, preflight } from '../../../src/app/preflight.mjs';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

/**
 * @param {ReadonlyArray<number>} values
 * @returns {number}
 */
const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
const client = (over = {}) => ({
  client_slug: 'acme',
  tier: 'standard',
  enabled: true,
  listings: [{ listing_key: 'main', source: 'google', access_method: 'dom' }],
  ...over,
});

/**
 * @param {number} hoursAgo
 * @returns {any}
 */
const ranHoursAgo = (hoursAgo) => ({ 'acme/main': { last_success_at: NOW - hoursAgo * HOUR } });

describe('DEL-67 — the due set, computed from data alone', () => {
  it('is pure: same inputs, same answer, and no clock of its own', () => {
    // TR-APP-030. `tpre plan` is what an operator runs DURING an incident, and
    // a diagnostic with side effects is one nobody dares run when it would
    // help most.
    const input = { clients: [client()], now: NOW, health: ranHoursAgo(2) };

    expect(JSON.stringify(computeTargets(input))).toBe(JSON.stringify(computeTargets(input)));
  });

  describe('the due-set matrix: tiers × last-run × cadence floor', () => {
    it.each([
      ['premium', 5, false],
      ['premium', 7, true],
      ['standard', 11, false],
      ['standard', 13, true],
      ['economy', 23, false],
      ['economy', 25, true],
    ])('%s harvested %ih ago is due=%s', (tier, hoursAgo, due) => {
      const [target] = computeTargets({
        clients: [client({ tier })],
        now: NOW,
        health: ranHoursAgo(/** @type {number} */ (hoursAgo)),
      });

      expect(target?.due).toBe(due);
    });

    it('treats a never-harvested target as due', () => {
      const [target] = computeTargets({ clients: [client()], now: NOW, health: {} });

      expect(target?.due).toBe(true);
      expect(target?.reason).toContain('never harvested');
      expect(target?.staleHours).toBe(Infinity);
    });

    it('honours a cadence floor that is LONGER than the tier', () => {
      // The floor is a floor, not a target: a client may ask to be harvested
      // less often than its tier, never more.
      const [target] = computeTargets({
        clients: [client({ tier: 'premium', cadence_floor_hours: 24 })],
        now: NOW,
        health: ranHoursAgo(10),
      });

      expect(target?.due).toBe(false);
    });

    it('ignores a cadence floor SHORTER than the tier', () => {
      const [target] = computeTargets({
        clients: [client({ tier: 'economy', cadence_floor_hours: 1 })],
        now: NOW,
        health: ranHoursAgo(5),
      });

      expect(target?.due).toBe(false);
    });
  });

  describe('a target that will not run still appears, with a reason', () => {
    it.each([
      [client({ enabled: false }), 'the client is disabled'],
      [client({ listings: [{ listing_key: 'main', enabled: false }] }), 'the listing is disabled'],
      [client({ tier: 'paused' }), 'never runs on a schedule'],
    ])('reports why (%#)', (configured, reason) => {
      // A client that vanishes from the plan is indistinguishable from one that
      // was never configured, and "why is this one not updating" is the exact
      // question the plan exists to answer.
      const [target] = computeTargets({ clients: [configured], now: NOW, health: {} });

      expect(target).toBeDefined();
      expect(target?.due).toBe(false);
      expect(target?.reason).toContain(reason);
    });

    it('says how long until the next run when it is simply not due yet', () => {
      const [target] = computeTargets({
        clients: [client()],
        now: NOW,
        health: ranHoursAgo(4),
      });

      expect(target?.reason).toContain('next due in');
      expect(target?.dueAt).toBe(NOW - 4 * HOUR + 12 * HOUR);
    });
  });

  it('expands every listing a client declares', () => {
    const targets = computeTargets({
      clients: [
        client({
          listings: [{ listing_key: 'a' }, { listing_key: 'b' }, { listing_key: 'c' }],
        }),
      ],
      now: NOW,
      health: {},
    });

    expect(targets.map((target) => target.listingKey)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to standard for an unrecognised tier rather than dropping the target', () => {
    const [target] = computeTargets({
      clients: [client({ tier: 'platinum' })],
      now: NOW,
      health: {},
    });

    expect(target?.tier).toBe('standard');
  });

  it('declares a cadence for every tier the plan knows about', () => {
    expect(Object.keys(TIER_CADENCE_HOURS)).toEqual(['premium', 'standard', 'economy', 'paused']);
    expect(TIER_CADENCE_HOURS.paused).toBeNull();
  });

  it('filters to the due subset on request', () => {
    const targets = computeTargets({
      clients: [client(), client({ client_slug: 'beta', enabled: false })],
      now: NOW,
      health: {},
    });

    expect(targets).toHaveLength(2);
    expect(dueTargets(targets)).toHaveLength(1);
  });
});

describe('priority ordering spends a tight budget on the right targets', () => {
  it('orders by tier, then by staleness', () => {
    const targets = [
      { clientSlug: 'a', listingKey: 'x', tier: 'economy', staleHours: 100 },
      { clientSlug: 'b', listingKey: 'x', tier: 'premium', staleHours: 7 },
      { clientSlug: 'c', listingKey: 'x', tier: 'premium', staleHours: 40 },
      { clientSlug: 'd', listingKey: 'x', tier: 'standard', staleHours: 13 },
    ];

    // A stale economy client is still an economy client — but within a tier,
    // the one longest without an update is the one whose site is most wrong.
    expect(byPriority(/** @type {any} */ (targets)).map((t) => t.clientSlug)).toEqual([
      'c',
      'b',
      'd',
      'a',
    ]);
  });

  it('is a TOTAL order, so two identical targets do not reorder between runs', () => {
    const same = [
      { clientSlug: 'b', listingKey: 'x', tier: 'premium', staleHours: 5 },
      { clientSlug: 'a', listingKey: 'x', tier: 'premium', staleHours: 5 },
    ];

    expect(byPriority(/** @type {any} */ (same)).map((t) => t.clientSlug)).toEqual(['a', 'b']);
  });
});

describe('DEL-68 — shards are balanced by COST, not by count', () => {
  /**
   * @param {number} count
   * @returns {any[]}
   */
  const targets = (count) =>
    Array.from({ length: count }, (_, index) => ({
      clientSlug: `c${String(index).padStart(2, '0')}`,
      listingKey: 'main',
    }));

  it('beats count-balancing on a mixed workload', () => {
    // The failure this exists to prevent: ten large and twenty small listings
    // split ten-per-shard produces a 3x duration spread, with the slow shard
    // hitting the job timeout while two runners sit idle.
    const mixed = targets(30);
    /** @type {Record<string, any>} */
    const health = {};

    for (const [index, target] of mixed.entries()) {
      health[`${target.clientSlug}/main`] = { last_review_count: index < 10 ? 5_000 : 20 };
    }

    const plan = planShards(mixed, 3, health);
    /** @param {any} target @returns {number} */
    const costOf = (target) => health[`${target.clientSlug}/main`].last_review_count;
    const byCount = [0, 1, 2].map((shard) =>
      sum(mixed.slice(shard * 10, shard * 10 + 10).map(costOf)),
    );

    // Count-balancing puts all ten large listings on one shard: a 3x+ spread,
    // with that shard hitting the job timeout while two runners sit idle.
    expect(Math.max(...byCount) / Math.min(...byCount)).toBeGreaterThan(3);

    // LPT's proven worst case is 4/3 of optimal, and 4/3 is what this workload
    // costs: ten indivisible units of 5,000 across three shards can only split
    // 4/3/3, so 20,000 against 15,400 is the BEST any partition achieves. The
    // 25% acceptance figure is reachable on a divisible workload — asserted
    // separately below — and demanding it here would be demanding something
    // arithmetically impossible.
    expect(plan.balance).toBeLessThanOrEqual(4 / 3);
  });

  it('lands inside 25% when the workload can actually be divided', () => {
    const even = targets(24);
    /** @type {Record<string, any>} */
    const health = {};

    for (const [index, target] of even.entries()) {
      health[`${target.clientSlug}/main`] = { last_review_count: 40 + (index % 6) * 30 };
    }

    expect(planShards(even, 4, health).balance).toBeLessThan(1.25);
  });

  it('places every target exactly once', () => {
    // Shards write disjoint paths. A target on two shards means two runners
    // writing one client directory, which is the concurrency failure EDR-035
    // avoids by disjointness rather than by locking.
    const plan = planShards(targets(17), 4);
    /** @param {any} shard @returns {string[]} */
    const slugsIn = (shard) => shard.targets.map((/** @type {any} */ t) => t.clientSlug);
    const placed = plan.shards.flatMap(slugsIn);

    expect(placed).toHaveLength(17);
    expect(new Set(placed).size).toBe(17);
  });

  it('is deterministic — an operator diffing two plans gets an empty diff', () => {
    const list = targets(12);

    expect(JSON.stringify(planShards(list, 3))).toBe(JSON.stringify(planShards(list, 3)));
  });

  it('tolerates more shards than targets', () => {
    const plan = planShards(targets(2), 5);

    expect(plan.shards).toHaveLength(5);
    expect(plan.shards.filter((shard) => shard.targets.length > 0)).toHaveLength(2);
  });

  it('never produces zero shards', () => {
    expect(planShards(targets(3), 0).shards).toHaveLength(1);
    expect(planShards(targets(3), -4).shards).toHaveLength(1);
  });

  describe('the cost model prefers measurement over modelling', () => {
    it('uses a recorded duration when there is one', () => {
      const cost = estimateCost(
        { clientSlug: 'a', listingKey: 'm' },
        { 'a/m': { last_duration_ms: 42_000, last_review_count: 10 } },
      );

      expect(cost).toBe(42_000);
    });

    it('falls back to review count, then to a default', () => {
      expect(
        estimateCost({ clientSlug: 'a', listingKey: 'm' }, { 'a/m': { last_review_count: 90 } }),
      ).toBe(90);
      expect(estimateCost({ clientSlug: 'a', listingKey: 'm' }, {})).toBe(DEFAULT_COST);
    });
  });

  describe('balance reporting', () => {
    it('reports 1 for a perfectly even split', () => {
      expect(balanceOf([{ cost: 10 }, { cost: 10 }])).toBe(1);
    });

    it('reports 1 rather than NaN when there is no work at all', () => {
      expect(balanceOf([{ cost: 0 }, { cost: 0 }])).toBe(1);
    });

    it('reports Infinity for an idle shard, which is true and worth seeing', () => {
      expect(balanceOf([{ cost: 10 }, { cost: 0 }])).toBe(Infinity);
    });
  });
});

describe('SCHED-02 / TR-APP-003 — no client is permanently first', () => {
  const list = Array.from({ length: 8 }, (_, index) => ({
    clientSlug: `c${index}`,
    listingKey: 'main',
  }));

  it('produces a different order for a different run id', () => {
    // Being first means meeting the source with a full rate budget and a cold
    // cache — a systematic advantage, and on the failure side, the target that
    // absorbs whatever is wrong that morning.
    const a = seededOrder(list, 'run-A').map((t) => t.clientSlug);
    const b = seededOrder(list, 'run-B').map((t) => t.clientSlug);

    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('is reproducible from the run id alone', () => {
    // A plain shuffle would make "it only happens sometimes" the whole bug
    // report.
    expect(seededOrder(list, 'run-A')).toEqual(seededOrder(list, 'run-A'));
  });

  it('does not leave the first target first across many run ids', () => {
    const firsts = new Set(
      Array.from({ length: 25 }, (_, index) => seededOrder(list, `run-${index}`)[0]?.clientSlug),
    );

    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('DEL-69 — the seven preflight checks, in order', () => {
  // SAD §15.6's five fields. This fixture previously read
  // `{ authorized_by, authorized_at, evidence }` — a shape the specification
  // never defined and that V-3 did not recognise, so these tests passed while
  // asserting a control that no real config could satisfy.
  const AUTHORISED = {
    authorized_by: 'ops',
    authorization_date: '2026-01-01',
    relationship: 'owner',
    evidence_ref: 'compliance/authorizations/ops.md',
    scope_ack: true,
  };

  /**
   * `config` and `policy` merge rather than replace.
   *
   * An earlier version spread `over` wholesale, so a test overriding
   * `robots_mode` silently dropped the authorisation record — and every robots
   * case failed at check 4 instead, testing nothing it claimed to.
   *
   * @param {Record<string, any>} [over]
   * @returns {any}
   */
  const input = (over = {}) => ({
    target: { source: 'google', accessMethod: 'dom' },
    robots: { allowed: true },
    budget: { allowed: true },
    breaker: { open: false },
    recordedAt: '2026-08-10T00:00:00.000Z',
    ...over,
    config: { enabled: true, robots_mode: 'warn', authorization: AUTHORISED, ...over['config'] },
    policy: { global_enabled: true, sources: { google: true }, ...over['policy'] },
  });

  it('allows a target where everything passes', () => {
    const verdict = preflight(input());

    expect(verdict.allow).toBe(true);
    expect(verdict.code).toBeNull();
    expect(verdict.reasons).toHaveLength(7);
  });

  it('records the verdict on ALLOW as well as on deny (TR-APP-010)', () => {
    // An audit trail that records only denials cannot answer "was this client
    // authorised on the day we harvested it", which is the only question
    // anyone ever asks of it.
    const verdict = preflight(input());

    expect(verdict.recordedAt).toBe('2026-08-10T00:00:00.000Z');
    expect(verdict.reasons.every((reason) => reason.passed)).toBe(true);
    expect(verdict.reasons.map((reason) => reason.check)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('evaluates in the documented order', () => {
    expect(checkOrder().map((check) => check.name)).toEqual([
      'global-kill-switch',
      'source-enabled',
      'client-enabled',
      'authorisation-record',
      'robots-directive',
      'rate-budget',
      'circuit-breaker',
    ]);
  });

  it.each([
    [1, { policy: { global_enabled: false } }, 'ERR-POLICY-KILLSWITCH'],
    [2, { policy: { global_enabled: true, sources: { google: false } } }, 'ERR-POLICY-KILLSWITCH'],
    [3, { config: { enabled: false } }, 'ERR-POLICY-KILLSWITCH'],
    [4, { config: { enabled: true, authorization: {} } }, 'ERR-POLICY-UNAUTHORIZED'],
    [5, { robots: { allowed: false } }, 'ERR-POLICY-ROBOTS'],
    [6, { budget: { allowed: false, reason: 'hourly spent' } }, 'ERR-POLICY-BUDGET'],
    [7, { breaker: { open: true, until: '10:00' } }, 'ERR-POLICY-BREAKER-OPEN'],
  ])('check %i denies with %s', (number, over, code) => {
    const verdict = preflight(input(over));

    expect(verdict.allow).toBe(false);
    expect(verdict.code).toBe(code);
    // Fail fast: it stops at the failing check rather than reporting on a
    // target that is not going to run.
    expect(verdict.reasons).toHaveLength(/** @type {number} */ (number));
    expect(verdict.reasons.at(-1)?.passed).toBe(false);
  });

  describe('check 4 is for dom access only (TR-APP-012)', () => {
    it('skips the authorisation record for an official API', () => {
      // Demanding one would be incorrect and would obstruct the migration path
      // ADR-023 exists to keep open.
      const verdict = preflight(
        input({
          target: { source: 'google', accessMethod: 'places-api' },
          config: { enabled: true, robots_mode: 'warn', authorization: {} },
        }),
      );

      expect(verdict.allow).toBe(true);
      expect(verdict.reasons[3]?.detail).toContain('skipped');
    });

    it('names every missing field rather than only the first', () => {
      const verdict = preflight(
        input({ config: { enabled: true, authorization: { authorized_by: 'ops' } } }),
      );

      expect(verdict.reasons.at(-1)?.detail).toContain('authorization_date');
      expect(verdict.reasons.at(-1)?.detail).toContain('evidence_ref');
      expect(verdict.reasons.at(-1)?.detail).toContain('relationship');
      expect(verdict.reasons.at(-1)?.detail).toContain('scope_ack');
    });
  });

  describe('check 5: an unfetchable robots directive is `unknown` (TR-APP-011)', () => {
    it('DENIES under mode block', () => {
      const verdict = preflight(
        input({ robots: { allowed: null }, config: { enabled: true, robots_mode: 'block' } }),
      );

      expect(verdict.allow).toBe(false);
      expect(verdict.code).toBe('ERR-POLICY-ROBOTS');
    });

    it.each(['warn', 'ignore'])('proceeds under mode %s, with the note recorded', (mode) => {
      // It MUST NOT silently pass. Proceeding is allowed; proceeding without a
      // record is not — the note is what makes the decision auditable later.
      const verdict = preflight(
        input({
          robots: { allowed: null, detail: 'timeout after 3s' },
          config: { enabled: true, robots_mode: mode },
        }),
      );

      expect(verdict.allow).toBe(true);
      expect(verdict.reasons[4]?.detail).toContain('could not be determined');
      expect(verdict.reasons[4]?.detail).toContain('timeout after 3s');
    });

    it('proceeds past an explicit disallow only under ignore', () => {
      expect(
        preflight(
          input({ robots: { allowed: false }, config: { enabled: true, robots_mode: 'ignore' } }),
        ).allow,
      ).toBe(true);
      expect(
        preflight(
          input({ robots: { allowed: false }, config: { enabled: true, robots_mode: 'warn' } }),
        ).allow,
      ).toBe(false);
    });

    it('defaults to warn when the mode is missing or unrecognised', () => {
      const verdict = preflight(
        input({ robots: { allowed: false }, config: { enabled: true, robots_mode: 'whatever' } }),
      );

      expect(verdict.allow).toBe(false);
      expect(ROBOTS_MODES).toEqual(['block', 'warn', 'ignore']);
    });
  });
});
