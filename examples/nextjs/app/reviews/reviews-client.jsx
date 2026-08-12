'use client';

/**
 * The client boundary (DEL-191).
 *
 * Required because the renderer builds DOM nodes and attaches click handlers
 * for pagination, neither of which exists on the server.
 */

import { useEffect, useRef } from 'react';

import { render } from './tp-reviews.mjs';
import './tp-reviews.css';

/**
 * @param {{ payload: any, pageSize?: number }} props
 */
export function ReviewsClient({ payload, pageSize = 10 }) {
  const ref = useRef(null);

  useEffect(() => {
    // `render`, not `mount`. The payload is already here; `mount` would fetch
    // it a second time from the browser, which is the request this recipe
    // exists to avoid.
    render(ref.current, payload ?? {}, { pageSize });
  }, [payload, pageSize]);

  // `--tp-rows` must match `pageSize`, and it is set in CSS because the
  // renderer writes no inline style — `style-src 'self'` blocks CSSOM style
  // writes, so a reservation made in JavaScript would silently do nothing.
  return <div className="tp-reviews-host" ref={ref} />;
}
