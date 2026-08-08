import { describe, expect, it } from 'vitest';

import { FORBIDDEN_PAYLOAD_FIELDS } from '../../../src/core/model/payload.mjs';
import { suppressReview } from '../../../src/core/model/ledger.mjs';
import {
  checkPayloadSafety,
  projectPayload,
  projectReview,
  selectPublishable,
} from '../../../src/core/project/payload.mjs';
import { projectArtifacts } from '../../../src/core/project/index.mjs';
import { seedLedger, instantAt } from '../../helpers/reconcile-generators.mjs';
import { identity, recordOf } from '../../helpers/reconcile-input.mjs';
import {
  GENERATED_AT,
  config,
  ledgerOf,
  meta,
  projectInput,
  review,
} from '../../helpers/project-input.mjs';

describe('what reaches a payload, and what must never', () => {
  it('publishes no internal ledger field', () => {
    // `author_key` is the one that matters most: a pseudonymous identifier
    // derived from author details, published on a static site, becomes a
    // permanent cross-site tracking identifier for a person who never agreed
    // to that.
    const payload = projectPayload(projectInput());

    for (const published of payload.reviews) {
      for (const forbidden of FORBIDDEN_PAYLOAD_FIELDS) {
        expect(Object.hasOwn(published, forbidden), forbidden).toBe(false);
      }
    }

    expect(checkPayloadSafety(payload)).toEqual([]);
  });

  it('builds the projection by naming fields, not by deleting internal ones', () => {
    // A field added to the ledger later must be added here deliberately to
    // appear in a payload. The delete-list approach leaks by omission.
    const projected = projectReview(recordOf(ledgerOf([review(1)]), identity(1)));

    expect(Object.keys(projected).sort()).toEqual(
      [
        'author_avatar_url',
        'author_initials',
        'author_is_local_guide',
        'author_name',
        'author_profile_url',
        'date',
        'date_confidence',
        'date_precision',
        'first_seen_at',
        'id',
        'language',
        'likes',
        'owner_reply',
        'photo_count',
        'rating',
        'revision',
        'source',
        'source_url',
        'text',
        'text_truncated',
        'verified',
      ].sort(),
    );
  });

  it('reports a leak rather than publishing it', () => {
    const payload = { reviews: [{ id: 'x', author_key: 'leaked' }] };

    expect(checkPayloadSafety(payload)).toEqual(['reviews[0] leaks author_key']);
  });

  it('tolerates a payload with no reviews array', () => {
    expect(checkPayloadSafety({})).toEqual([]);
  });

  it('excludes tombstoned and suppressed records (PT-04)', () => {
    const seeded = seedLedger(
      [
        { label: 1, state: 'active' },
        { label: 2, state: 'tombstoned' },
        { label: 3, state: 'suppressed' },
      ],
      instantAt(0),
    );

    const ids = selectPublishable(seeded).map((record) => record.review.identity_hash);

    expect(ids).toEqual([identity(1)]);
  });

  it('excludes a record suppressed after it was published', () => {
    const seeded = ledgerOf([review(1), review(2)]);
    const suppressed = suppressReview(seeded, identity(1), instantAt(1)).ledger;

    expect(selectPublishable(suppressed)).toHaveLength(1);
  });
});

describe('the envelope', () => {
  const payload = projectPayload(projectInput());

  it('carries the schema version and artifact kind', () => {
    expect(payload.schema_version).toBe(1);
    expect(payload.artifact).toBe('reviews');
  });

  it('carries generated_at from the caller, never from a clock', () => {
    expect(payload.generated_at).toBe(GENERATED_AT);
    expect(String(projectPayload)).not.toContain('Date.now');
  });

  it('carries the listing block from config, not from the ledger', () => {
    expect(payload.listing.source).toBe('google');
    expect(payload.listing.key).toBe('main');
    expect(payload.listing.address_hint).toBe('Bristol');
  });

  it('falls back to the ledger identity when config omits names', () => {
    const bare = projectPayload(projectInput({ config: { display: {}, publish: {} } }));

    expect(bare.client.display_name).toBe('acme-dental');
    expect(bare.listing.display_name).toBe('main');
    expect(bare.listing.source).toBeNull();
  });
});

describe('provenance (T-117, INV-06)', () => {
  const payload = projectPayload(projectInput());

  it('identifies the exact code, pack and run that produced the payload', () => {
    expect(payload.provenance.engine_version).toBe('1.0.0');
    expect(payload.provenance.selector_pack_version).toBe('2026.03.1');
    expect(payload.provenance.run_id).toBe('run-0001');
    expect(payload.provenance.adapter).toBe('google:dom');
  });

  it('declares adapter capabilities, which is what explains a null', () => {
    // "This adapter cannot see owner replies" is a different fact from "this
    // review has no owner reply", and a consumer cannot tell them apart
    // without this list.
    expect(payload.provenance.adapter_capabilities).toEqual(['owner_reply', 'likes']);
  });

  it('defaults capabilities to an empty list rather than omitting them', () => {
    const bare = projectPayload(projectInput({ meta: meta({ adapter_capabilities: undefined }) }));

    expect(bare.provenance.adapter_capabilities).toEqual([]);
  });

  it('carries the identity algorithm version from the ledger', () => {
    expect(payload.provenance.identity_algo_version).toBe(1);
  });

  it('leaves content_hash null until the artifact is sealed', () => {
    // Present rather than absent so the shape does not change between
    // construction and sealing, which would make the schema describe two
    // different objects.
    expect(payload.provenance.content_hash).toBeNull();
    expect(projectArtifacts(projectInput()).reviews.payload.provenance.content_hash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });
});

describe('notices explain reduced completeness, and are never an error channel', () => {
  it('reports a partial harvest', () => {
    const payload = projectPayload(
      projectInput({ meta: meta({ harvest_completeness: 'partial' }) }),
    );

    expect(payload.notices).toContain('harvest_partial');
  });

  it('reports a capped harvest', () => {
    const payload = projectPayload(
      projectInput({ meta: meta({ harvest_completeness: 'full_capped' }) }),
    );

    expect(payload.notices).toContain('harvest_capped');
  });

  it('reports awaiting-first-full-harvest when none has ever completed', () => {
    const payload = projectPayload(projectInput());

    // `ledgerOf` seeds via insertReview without recording a full harvest.
    expect(payload.notices).toContain('awaiting_first_full_harvest');
  });

  it('is null rather than empty when there is nothing to say', () => {
    // An empty array reads as "there were notices"; null reads as "there were
    // none", and a consumer rendering `notices.length` should see neither a
    // crash nor a phantom banner.
    const ledger = { ...ledgerOf([review(1)]), last_full_harvest_at: '2026-02-01T00:00:00.000Z' };
    const payload = projectPayload(projectInput({ ledger }));

    expect(payload.notices).toBeNull();
  });
});

describe('owner replies', () => {
  it('projects text and date, and nothing else', () => {
    const ledger = ledgerOf([
      review(1, {
        owner_reply: {
          text: 'Thank you!',
          date_estimated: '2026-02-02T00:00:00.000Z',
          internal: 'x',
        },
      }),
    ]);
    const payload = projectPayload(projectInput({ ledger }));

    expect(payload.reviews[0].owner_reply).toEqual({
      text: 'Thank you!',
      date: '2026-02-02T00:00:00.000Z',
    });
  });

  it('is null when there is no reply', () => {
    expect(projectPayload(projectInput()).reviews[0].owner_reply).toBeNull();
  });

  it('tolerates a reply with missing fields', () => {
    const ledger = ledgerOf([review(1, { owner_reply: {} })]);
    const payload = projectPayload(projectInput({ ledger }));

    expect(payload.reviews[0].owner_reply).toEqual({ text: null, date: null });
  });
});

describe('missing author block', () => {
  it('projects nulls rather than throwing', () => {
    const ledger = ledgerOf([review(1, { author: undefined })]);
    const payload = projectPayload(projectInput({ ledger }));

    expect(payload.reviews[0].author_name).toBeNull();
    expect(payload.reviews[0].author_initials).toBeNull();
  });
});

describe('config is honoured', () => {
  it('uses the advertised figures from config, never from the ledger', () => {
    const payload = projectPayload(
      projectInput({
        config: config({
          listing: { ...config().listing, advertised_total: 500, advertised_rating: 2.1 },
        }),
      }),
    );

    expect(payload.stats.advertised_total).toBe(500);
    expect(payload.stats.advertised_rating).toBe(2.1);
    expect(payload.stats.total_count).toBe(3);
  });
});
