/**
 * The example's own integration code (DEL-191).
 *
 * ## Why this is a file and not an inline `<script type="module">`
 *
 * An inline script is blocked by `script-src 'self'` — it needs
 * `'unsafe-inline'`, a hash, or a nonce. The first of those weakens the policy
 * for the whole page in order to render reviews, which is a bad trade to ask a
 * client to make; the other two have to be regenerated whenever this code
 * changes.
 *
 * An external module needs none of that, and the example demonstrates the
 * arrangement a client should actually deploy rather than the one that is
 * shortest to paste into a README.
 */

import { mount } from './tp-reviews.mjs';

const widget = mount(document.querySelector('#reviews'), {
  // `pageSize` and `--tp-rows` in example.css are the same number. If they
  // disagree, the reserved box is the wrong height and the page shifts.
  pageSize: 3,
  src: './reviews.json',
  // Surfaced for the test harness. A real site would forward this to its own
  // monitoring; what it must never do is put it on the page.
  onError: (error) => {
    globalThis.__tpReviewsError = String(error);
  },
});

widget.ready.then(() => {
  globalThis.__tpReviewsReady = true;
});
