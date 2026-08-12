/**
 * Cost-balanced shard planning (DEL-68).
 *
 * ## Balance by cost, never by count (TR-CFG-004)
 *
 * Splitting thirty targets into three shards of ten is the obvious
 * implementation and it is wrong in a way that only shows up in production. A
 * 5,000-review listing takes minutes; a 12-review listing takes seconds. Ten of
 * each is not a third of the work, and the observed result is a **3× spread**
 * between the fastest and slowest shard — with the slowest one running into the
 * job timeout while two runners sit idle.
 *
 * So the planner packs by estimated cost, longest first.
 *
 * ## Longest-processing-time-first, and why it is enough
 *
 * Optimal partitioning is NP-hard. LPT — sort by cost descending, repeatedly
 * place the next target on the least-loaded shard — is a four-line greedy with
 * a proven worst case of 4/3 of optimal, which is comfortably inside the 25%
 * balance the acceptance criteria ask for.
 *
 * Anything cleverer would be a scheduling research project attached to a
 * review-harvesting engine.
 *
 * ## Pure, and deterministic
 *
 * Same inputs, same plan, every time (TR-APP-030). An operator diffing two
 * `tpre plan` runs must get an empty diff, or the command cannot be used to
 * answer "did the plan change or did the source change".
 *
 * @module app/shard-planner
 */

/** Cost of a target with no history, in arbitrary units matched to reviews. */
export const DEFAULT_COST = 200;

/** Floor, so a target with a recorded cost of zero still occupies a slot. */
const MIN_COST = 1;

/**
 * @typedef {object} ShardPlan
 * @property {Array<{ index: number, targets: any[], cost: number }>} shards
 * @property {number} balance   max/min shard cost. 1.0 is perfect.
 * @property {number} totalCost
 */

/**
 * Estimates one target's cost.
 *
 * Review count is the dominant term because pagination is roughly 65% of
 * harvest time and scales with it. The health series supplies the last observed
 * duration when there is one — a measured number beats a modelled one, and a
 * target that has been slow is the best predictor of a target that will be.
 *
 * @param {any} target
 * @param {Record<string, any>} [health]
 * @returns {number}
 */
export function estimateCost(target, health = {}) {
  const record = health[`${target.clientSlug}/${target.listingKey}`] ?? {};

  if (typeof record.last_duration_ms === 'number' && record.last_duration_ms > 0) {
    return Math.max(MIN_COST, record.last_duration_ms);
  }

  if (typeof record.last_review_count === 'number' && record.last_review_count > 0) {
    return Math.max(MIN_COST, record.last_review_count);
  }

  return DEFAULT_COST;
}

/**
 * Partitions targets across shards, balanced by cost.
 *
 * @param {ReadonlyArray<any>} targets
 * @param {number} shardCount
 * @param {Record<string, any>} [health]
 * @returns {ShardPlan}
 */
export function planShards(targets, shardCount, health = {}) {
  const count = Math.max(1, Math.floor(shardCount));
  const shards = Array.from({ length: count }, (_, index) => ({
    index,
    /** @type {any[]} */ targets: [],
    cost: 0,
  }));

  // Descending cost, with the composite key breaking ties. Without the tiebreak
  // two equal-cost targets could land on different shards between runs, and the
  // plan would stop being diffable.
  const ordered = [...targets]
    .map((target) => ({ target, cost: estimateCost(target, health) }))
    .sort((left, right) => {
      if (left.cost !== right.cost) return right.cost - left.cost;

      return keyOf(left.target).localeCompare(keyOf(right.target));
    });

  for (const { target, cost } of ordered) {
    const shard = leastLoaded(shards);

    shard.targets.push(target);
    shard.cost += cost;
  }

  return { shards, balance: balanceOf(shards), totalCost: totalOf(shards) };
}

/**
 * @param {any} target
 * @returns {string}
 */
function keyOf(target) {
  return `${target.clientSlug}/${target.listingKey}`;
}

/**
 * @param {Array<{ index: number, cost: number }>} shards
 * @returns {any}
 */
function leastLoaded(shards) {
  let chosen = shards[0];

  for (const shard of shards) {
    // Strictly less-than, so equal-cost shards keep the lowest index and the
    // assignment stays deterministic.
    if (shard.cost < /** @type {any} */ (chosen).cost) chosen = shard;
  }

  return chosen;
}

/**
 * Max/min shard cost.
 *
 * Reported rather than merely asserted: a balance that drifts from 1.05 to 2.4
 * as the client mix changes is a scheduling problem showing up months before it
 * becomes a timeout, and only a recorded number makes that visible.
 *
 * @param {ReadonlyArray<{ cost: number }>} shards
 * @returns {number}
 */
export function balanceOf(shards) {
  const costs = shards.map((shard) => shard.cost);
  const max = Math.max(...costs);
  const min = Math.min(...costs);

  // An empty shard makes the ratio infinite, which is true but useless. More
  // shards than targets is a configuration choice, not an imbalance.
  if (min === 0) return max === 0 ? 1 : Infinity;

  return max / min;
}

/**
 * @param {ReadonlyArray<{ cost: number }>} shards
 * @returns {number}
 */
function totalOf(shards) {
  return shards.reduce((sum, shard) => sum + shard.cost, 0);
}

/**
 * A deterministic permutation seeded by the run (TR-APP-003, SCHED-02).
 *
 * No client may be permanently first. Being first means being the target that
 * meets a source's rate limiter with a full budget and a cold cache — a
 * systematic advantage, and on the failure side, the target that absorbs
 * whatever is wrong that morning.
 *
 * Seeded by `runId + slug` rather than randomised so that an ordering bug is
 * reproducible from the run id alone. A plain shuffle would make "it only
 * happens sometimes" the whole bug report.
 *
 * @param {ReadonlyArray<any>} targets
 * @param {string} runId
 * @returns {any[]}
 */
export function seededOrder(targets, runId) {
  return [...targets]
    .map((target) => ({ target, rank: hash32(`${runId}:${keyOf(target)}`) }))
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;

      return keyOf(left.target).localeCompare(keyOf(right.target));
    })
    .map(({ target }) => target);
}

/** FNV-1a offset basis and prime. */
const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;

/**
 * FNV-1a. Not a security hash and not used as one — it decides an order.
 *
 * @param {string} text
 * @returns {number}
 */
function hash32(text) {
  let hash = FNV_OFFSET;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}
