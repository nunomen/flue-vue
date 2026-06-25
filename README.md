# `@flue/vue`

[![CI](https://github.com/nunomen/flue-vue/actions/workflows/ci.yml/badge.svg)](https://github.com/nunomen/flue-vue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Test-first workspace for a native Vue 3 adapter for [Flue](https://flueframework.com/), the agent and workflow framework developed in the [withastro/flue](https://github.com/withastro/flue) repository.

Related Flue packages:

- [`@flue/sdk`](https://www.npmjs.com/package/@flue/sdk) for HTTP, auth headers, and Durable Streams transport.
- [`@flue/react`](https://www.npmjs.com/package/@flue/react) as the existing React client this Vue adapter mirrors.
- [`@flue/runtime`](https://www.npmjs.com/package/@flue/runtime) for server-side Flue applications.

This repository intentionally starts with API design, contract tests, fixtures, and stubs. The next implementation pass should turn the `todo` contracts into active tests as each capability lands.

## Intended API

```ts
import { createFlueClient } from '@flue/sdk';
import { createFluePlugin } from '@flue/vue';
import { createApp } from 'vue';
import App from './App.vue';

const client = createFlueClient({ baseUrl: '/api' });

const app = createApp(App);
app.use(createFluePlugin({ client }));
app.mount('#app');
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

## Quickstart App Shape

A minimal Vite Vue app using this package would look like this:

```txt
src/
  main.ts
  App.vue
  components/
    AgentChat.vue
```

```ts
// src/main.ts
import { createFlueClient } from '@flue/sdk';
import { createFluePlugin } from '@flue/vue';
import { createApp } from 'vue';
import App from './App.vue';

const client = createFlueClient({
	baseUrl: '/api',
});

createApp(App).use(createFluePlugin({ client })).mount('#app');
```

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import AgentChat from './components/AgentChat.vue';
</script>

<template>
	<AgentChat conversation-id="ticket-8472" />
</template>
```

```vue
<!-- src/components/AgentChat.vue -->
<script setup lang="ts">
import { shallowRef } from 'vue';
import { useFlueAgent } from '@flue/vue';

const props = defineProps<{
	conversationId: string;
}>();

const input = shallowRef('');
const agent = useFlueAgent({
	name: 'triage',
	id: () => props.conversationId,
});

async function submit() {
	const message = input.value.trim();
	if (!message) return;
	input.value = '';
	await agent.sendMessage(message);
}
</script>

<template>
	<section>
		<article v-for="message in agent.messages.value" :key="message.id">
			<strong>{{ message.role }}</strong>
			<template
				v-for="part in message.parts"
				:key="`${message.id}:${part.type}:${part.type === 'text' ? part.text : ''}`"
			>
				<p v-if="part.type === 'text'">{{ part.text }}</p>
			</template>
		</article>

		<form @submit.prevent="submit">
			<input v-model="input" />
			<button :disabled="!input.trim()" type="submit">Send</button>
		</form>
	</section>
</template>
```

This is only the browser side. A real quickstart also needs a [Flue](https://flueframework.com/) application exposing the matching agent route under the same `baseUrl`, for example `/api/agents/triage/:id`.

## Provider Component

The app plugin is the normal application setup path. Component libraries and tests can use the renderless provider instead:

```vue
<script setup lang="ts">
import { createFlueClient } from '@flue/sdk';
import { FlueProvider } from '@flue/vue';
import AgentChat from './AgentChat.vue';

const client = createFlueClient({ baseUrl: '/api' });
</script>

<template>
	<FlueProvider :client="client">
		<AgentChat conversation-id="ticket-8472" />
	</FlueProvider>
</template>
```

## Workflow Observation

Workflow invocation and workflow-run observation are separate operations. Keep the returned `runId`, then observe it from Vue:

```vue
<script setup lang="ts">
import { useFlueWorkflow } from '@flue/vue';

const props = defineProps<{
	runId?: string;
}>();

const { events, logs, status, result, error } = useFlueWorkflow({
	runId: () => props.runId,
});
</script>

<template>
	<section>
		<p>{{ status }}</p>
		<pre v-if="error">{{ error }}</pre>
		<pre v-else-if="status === 'completed'">{{ result }}</pre>
		<ul>
			<li v-for="log in logs" :key="`${log.runId}:${log.eventIndex}`">
				{{ log.level }}: {{ log.message }}
			</li>
		</ul>
		<span hidden>{{ events.length }}</span>
	</section>
</template>
```

The workflow module must expose and authorize run reads with a `runs` handler before browser clients can observe `/runs/:runId`.

## Authentication Model

`@flue/vue` should follow the same authentication model as [`@flue/react`](https://www.npmjs.com/package/@flue/react): the adapter does not own auth. Authentication belongs to the [`@flue/sdk`](https://www.npmjs.com/package/@flue/sdk) client and to the server routes that expose Flue.

Client-side auth is configured when creating the SDK client:

```ts
const client = createFlueClient({
	baseUrl: '/api',
	token: accessToken,
});
```

For refreshed or reactive auth state, use a header factory so the SDK resolves headers for each request and stream reconnect:

```ts
const client = createFlueClient({
	baseUrl: '/api',
	headers: (): Record<string, string> => {
		const token = authStore.token;
		return token ? { authorization: `Bearer ${token}` } : {};
	},
});
```

Server-side authorization is handled by the Flue app routes. For example, a Flue app mounted through Hono can protect exposed agent and workflow routes:

```ts
app.use('/api/agents/*', requireUser);
app.use('/api/workflows/*', requireUser);
app.route('/api', flue());
```

Workflow run reads are separate from workflow invocation. A workflow must expose and authorize run inspection with a `runs` handler before browser clients can observe `/runs/:runId`.

One transport nuance matters for implementation: long-polling resolves headers for each request, while SSE keeps the headers used to open the current connection until it reconnects. If auth changes while an SSE stream is open, the Vue adapter should support replacing the client or observer so a new connection uses fresh credentials.

## Nuxt Setup

Use a client plugin when the SDK client uses a relative browser `baseUrl`:

```ts
// plugins/flue.client.ts
import { createFlueClient } from '@flue/sdk';
import { createFluePlugin } from '@flue/vue';

export default defineNuxtPlugin((nuxtApp) => {
	const client = createFlueClient({ baseUrl: '/api' });
	nuxtApp.vueApp.use(createFluePlugin({ client }));
});
```

If a client is created during server rendering, use an absolute URL:

```ts
const client = createFlueClient({
	baseUrl: 'https://example.com/api',
});
```

## Return Values and Lifecycle

The composables return individual computed refs instead of a single reactive object. Destructuring keeps reactivity intact:

```ts
const { messages, status, sendMessage } = useFlueAgent({
	name: 'triage',
	id: 'ticket-8472',
});
```

Agent status is one of `idle`, `connecting`, `submitted`, `streaming`, or `error`. Workflow status is one of `idle`, `connecting`, `running`, `completed`, `errored`, or `disconnected`.

Message parts currently include text, reasoning, dynamic tool calls, and file parts for images. Live mode is delegated to the SDK and can use the default long-poll behavior or `'sse'`.

During SSR, `useFlueAgent()` and `useFlueWorkflow()` return dormant snapshots and do not open streams. Stream observation starts after client mount, or immediately in a standalone client-side `effectScope`.

Disposing a Vue observer only closes the local stream read. It does not cancel server-side agent work or workflow runs.

## Current Status

- `src/index.ts` exports provider, agent, workflow, and shared SDK types.
- `useFlueAgent()` covers client resolution, mounted observation, history hydration, live tailing, optimistic send admission, streamed assistant text/reasoning/tool parts, terminal reconciliation, and fresh-conversation `404` handling.
- `useFlueWorkflow()` covers client resolution, mounted observation, run replay, log selection, terminal states, disconnected states, and event dedupe.
- `test/contracts` contains active contract coverage plus remaining todos for retry/backoff and deeper optimistic echo reconciliation.
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
- [`@flue/react`](https://www.npmjs.com/package/@flue/react): preserve session, reducer, hydration, reconnect, optimistic send, and workflow-run semantics while exposing them through Vue-native refs.
- [Flue source](https://github.com/withastro/flue): align package layout, docs, and test expectations with the upstream project.
