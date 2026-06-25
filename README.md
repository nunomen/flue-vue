# `@flue/vue`

Test-first workspace for a native Vue 3 adapter for Flue.

This repository intentionally starts with API design, contract tests, fixtures, and stubs. The next implementation pass should turn the `todo` contracts into active tests as each capability lands.

## Intended API

```ts
import { createFlueClient } from '@flue/sdk';
import { createFluePlugin } from '@flue/vue';

const client = createFlueClient({ baseUrl: '/api' });

app.use(createFluePlugin({ client }));
```

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';
import { useFlueAgent } from '@flue/vue';

const input = shallowRef('');
const agent = useFlueAgent({
	name: 'triage',
	id: 'ticket-8472',
});

async function submit() {
	const message = input.value.trim();
	if (!message) return;
	input.value = '';
	await agent.sendMessage(message);
}
</script>
```

## Current Status

- `src/index.ts` contains the public API shape and dormant stubs.
- `test/contracts` contains passing Vue API-shape smoke tests and exhaustive `todo` contracts.
- `docs/implementation-plan.md` is the source of truth for the build plan.

## Commands

```sh
pnpm install
pnpm test
pnpm run test:type
pnpm run check
```

## Design Influences

- VueUse: `MaybeRefOrGetter`, `toValue`, `shallowRef`, options objects, scope disposal, and SSR-safe composables.
- Pinia: installable app plugin, typed injection key, `app.provide`, and raw external instances.
- Flue React: preserve session, reducer, hydration, reconnect, optimistic send, and workflow-run semantics while exposing them through Vue-native refs.

