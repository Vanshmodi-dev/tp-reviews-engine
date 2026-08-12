/**
 * The due set (DEL-67) — which targets should run, computed from data alone.
 *
 * ## Pure, and that is a requirement (TR-APP-030)
 *
 * `tpre plan` runs only this half of the scheduler. An operator reaches for it
 * *during an incident* — "what is due right now, and why is this client
 * stale?" — and a diagnostic that has side effects is a diagnostic nobody dares
 * run when it would help most.
 *
 * So: no clock, no filesystem, no network. `now` arrives as a parameter and the
 * health series arrives as data. That is also what makes the due-set matrix
 * (tiers × last-run-times × cadence floors) testable exhaustively instead of
 * sampled.
 *
 * ## A paused client still appears
 *
 * §28.3 puts `paused` in the tier table and says it still shows in the plan
 * output. That is deliberate: a client that vanishes from the plan is
 * indistinguishable from a client that was never configured, and "why is this
 * one not updating" is the question the plan exists to answer.
 *
 * The same reasoning covers `enabled: false` and every not-due target. This
 * module returns **every** target with a stated reason, and filtering is the
 * caller's job.
 *
 * @module app/registry
 */

/** Cadence per tier, in hours (§28.3). */
export const TIER_CADENCE_HOURS = Object.freeze({
  premium: 6,
  standard: 12,
  economy: 24,
  paused: null,
});

/** Tiers in priority order: the first to run when a budget is tight. */
export const TIER_PRIORITY = Object.freeze(['premium', 'standard', 'economy', 'paused']);

const MS_PER_HOUR = 3_600_000;

/**
 * @typedef {object} Target
 * @property {string} clientSlug
 * @property {string} listingKey
 * @property {string} source
 * @property {string} accessMethod
 * @property {string} tier
 * @property {boolean} due
 * @property {string} reason        Why it is or is not due, in words.
 * @property {number | null} lastRunAt
 * @property {number | null} dueAt
 * @property {number} staleHours    How long since the last successful harvest.
 */

/**
 * Computes the due set.
 *
 * @param {object} input
 * @param {ReadonlyArray<any>} input.clients   Effective client configs.
 * @param {number} input.now                   Epoch ms. Passed, never read.
 * @param {Record<string, any>} [input.health] Last-run facts, keyed `slug/listing`.
 * @returns {Target[]}
 */
export function computeTargets({ clients, now, health = {} }) {
  /** @type {Target[]} */
  const targets = [];

  for (const client of clients ?? []) {
    for (const listing of client?.listings ?? []) {
      targets.push(describeTarget(client, listing, now, health));
    }
  }

  return targets;
}

/**
 * @param {any} client
 * @param {any} listing
 * @param {number} now
 * @param {Record<string, any>} health
 * @returns {Target}
 */
function describeTarget(client, listing, now, health) {
  const key = `${client.client_slug}/${listing.listing_key}`;
  const record = health[key] ?? {};
  const lastRunAt = typeof record.last_success_at === 'number' ? record.last_success_at : null;
  const tier = cadenceFor(client.tier) === undefined ? 'standard' : client.tier;

  const base = {
    clientSlug: client.client_slug,
    listingKey: listing.listing_key,
    source: listing.source ?? 'google',
    accessMethod: listing.access_method ?? 'dom',
    tier,
    lastRunAt,
    staleHours: lastRunAt === null ? Infinity : (now - lastRunAt) / MS_PER_HOUR,
  };

  return { ...base, ...dueness({ client, listing, tier, lastRunAt, now }) };
}

/**
 * The cadence for a tier, or `undefined` for a tier nobody declared.
 *
 * `undefined` and `null` are different answers: `null` means "this tier never
 * runs on a schedule" and `undefined` means "there is no such tier".
 *
 * @param {unknown} tier
 * @returns {number | null | undefined}
 */
function cadenceFor(tier) {
  return typeof tier === 'string' && Object.hasOwn(TIER_CADENCE_HOURS, tier)
    ? TIER_CADENCE_HOURS[/** @type {keyof typeof TIER_CADENCE_HOURS} */ (tier)]
    : undefined;
}

/**
 * Whether a target is due, and why.
 *
 * The `why` is not decoration. "Not due" and "disabled" and "paused" all mean
 * the target does not run, and they mean completely different things to the
 * person asking why a client is stale.
 *
 * @param {{ client: any, listing: any, tier: string, lastRunAt: number | null, now: number }} input
 * @returns {{ due: boolean, reason: string, dueAt: number | null }}
 */
function dueness({ client, listing, tier, lastRunAt, now }) {
  if (client.enabled === false) {
    return { due: false, reason: 'the client is disabled', dueAt: null };
  }

  if (listing.enabled === false) {
    return { due: false, reason: 'the listing is disabled', dueAt: null };
  }

  const cadenceHours = cadenceFor(tier);

  if (cadenceHours === null || cadenceHours === undefined) {
    return { due: false, reason: `tier "${tier}" never runs on a schedule`, dueAt: null };
  }

  // The floor is a floor, not a target (§28.3). A client may ask to be
  // harvested less often than its tier; it may not ask for more.
  const floorHours = Math.max(cadenceHours, client.cadence_floor_hours ?? 0);

  if (lastRunAt === null) {
    return { due: true, reason: 'never harvested successfully', dueAt: now };
  }

  const dueAt = lastRunAt + floorHours * MS_PER_HOUR;

  if (now >= dueAt) {
    return {
      due: true,
      reason: `last success was ${hours(now - lastRunAt)}h ago, cadence is ${floorHours}h`,
      dueAt,
    };
  }

  return {
    due: false,
    reason: `next due in ${hours(dueAt - now)}h`,
    dueAt,
  };
}

/**
 * @param {number} ms
 * @returns {string}
 */
function hours(ms) {
  return (ms / MS_PER_HOUR).toFixed(1);
}

/**
 * The subset that will actually run.
 *
 * @param {ReadonlyArray<Target>} targets
 * @returns {Target[]}
 */
export function dueTargets(targets) {
  return targets.filter((target) => target.due);
}

/**
 * Orders targets so a tight budget spends itself on the right ones.
 *
 * Tier first, then staleness. Staleness second rather than first because a
 * stale `economy` client is still an economy client — but within a tier, the
 * one that has gone longest without an update is the one whose site is most
 * wrong.
 *
 * Ties break on the composite key so the result is a total order: two targets
 * that compare equal on every dimension would otherwise order by whatever the
 * sort happened to do, and the plan would differ between runs.
 *
 * @param {ReadonlyArray<Target>} targets
 * @returns {Target[]}
 */
export function byPriority(targets) {
  return [...targets].sort((left, right) => {
    const tier = TIER_PRIORITY.indexOf(left.tier) - TIER_PRIORITY.indexOf(right.tier);

    if (tier !== 0) return tier;

    if (left.staleHours !== right.staleHours) return right.staleHours - left.staleHours;

    return `${left.clientSlug}/${left.listingKey}`.localeCompare(
      `${right.clientSlug}/${right.listingKey}`,
    );
  });
}
