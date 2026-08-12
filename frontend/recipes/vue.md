# Recipe — Vue 3

**Priority P2**

The renderer owns its subtree; Vue owns the container. As with React, do not
reimplement the reviews as a Vue template — you would lose the security scan,
the size budget and the accessibility work in one move.

## Integrate

```vue
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { mount } from './tp-reviews.mjs';
import './tp-reviews.css';

const props = defineProps({
  src: { type: String, required: true },
  pageSize: { type: Number, default: 10 },
});

const host = ref(null);
let widget = null;

const start = () => {
  // Tear the previous one down first. Without this, a `src` change leaves the
  // old widget's nodes in place and the new one appends beside them — the
  // symptom is duplicated reviews after a route change, which looks like a
  // data bug and is not one.
  widget?.destroy();
  widget = mount(host.value, { src: props.src, pageSize: props.pageSize });
};

onMounted(start);
watch(() => [props.src, props.pageSize], start);
onBeforeUnmount(() => widget?.destroy());
</script>

<template>
  <div ref="host"></div>
</template>
```

The empty `<div>` is deliberate. Vue never renders into it and never diffs it —
`ref` gives the renderer a stable element and Vue leaves the subtree alone.

Never use `v-html` for review content. It is Vue's `innerHTML`, and it is
forbidden for the same reason (`SAFETY.md` §1).

### If you change `pageSize`, change `--tp-rows` too

The container reserves its height in CSS before the payload arrives, so the page
does not shift when reviews land. CSS cannot read a JavaScript argument, so the
two are one decision written in two places:

```css
.tp-reviews {
  --tp-rows: 10; /* same number as pageSize */
}
```

The renderer writes no inline style, deliberately — `style-src 'self'` blocks
CSSOM style writes, so a reservation made in JavaScript would silently do
nothing on exactly the sites with the strictest policies.

## Empty state

Handled inside the renderer: a missing or malformed payload renders
`No reviews to show yet.` with no error text and no layout jump. No
`<Suspense>`, no `errorCaptured` hook, nothing for Vue to do.

For your own telemetry:

```js
widget = mount(host.value, {
  src: props.src,
  onError: (error) => reportToMonitoring(error),
});
```

## CSP

`connect-src` for the payload origin:

```
default-src 'self'; connect-src 'self'
```

Or, for a separate data host you control:

```
connect-src 'self' https://data.example.com
```

No `script-src` relaxation is required — the renderer evaluates nothing.

## Network assertion

**The claim:** rendering reviews causes exactly one request, to your origin.
Zero requests reach Google or any other third party.

```js
import { mount as vueMount } from '@vue/test-utils';

it('reaches only our own origin', async () => {
  const seen = [];

  globalThis.fetch = async (url) => {
    seen.push(url);

    return { ok: true, json: async () => payload };
  };

  vueMount(Reviews, { props: { src: '/data/reviews.json' } });
  await flushPromises();

  expect(seen).toEqual(['/data/reviews.json']);
});
```

The strong form, in a real browser:

```js
const seen = [];

page.on('request', (request) => seen.push(new URL(request.url()).origin));
await page.goto('https://your-site.example/reviews');
expect(seen.filter((origin) => origin !== 'https://your-site.example')).toEqual([]);
```

Run one of these in your own suite. It is the property the entire architecture
exists to provide, and your app is where it is observable.
