# `@flue/vue` (non-official)

[![CI](https://github.com/nunomen/flue-vue/actions/workflows/ci.yml/badge.svg)](https://github.com/nunomen/flue-vue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Non-official Vue 3 adapter for [Flue](https://flueframework.com/). It provides Vue-native setup, provider, agent, and workflow composables for using Flue from Vue apps while tracking the behavior of the Flue SDK and React adapter.

Related Flue packages:

- [`@flue/sdk`](https://www.npmjs.com/package/@flue/sdk) for HTTP, auth headers, and Durable Streams transport.
- [`@flue/react`](https://www.npmjs.com/package/@flue/react) as the existing React client this Vue adapter mirrors.
- [`@flue/runtime`](https://www.npmjs.com/package/@flue/runtime) for server-side Flue applications.

Contract tests and fixtures keep the adapter aligned with the Flue SDK and the existing React adapter semantics.

## Basic Usage

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

Workflow invocation and workflow-run observation are separate operations. `useFlueWorkflow()` does not have a `sendMessage()` action. If a workflow accepts message-like data, pass it as ordinary workflow input when invoking through the SDK, keep the returned `runId`, then observe that run from Vue:

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';
import { useFlueClient, useFlueWorkflow } from '@flue/vue';

const client = useFlueClient();
const messageInput = shallowRef('Summarize the current support queue.');
const runId = shallowRef<string>();

const { events, logs, status, result, error } = useFlueWorkflow({
	runId,
});

async function startWorkflow() {
	const message = messageInput.value.trim();
	if (!message) return;

	const invocation = await client.workflows.invoke('weekly-report', {
		input: { message },
	});
	runId.value = invocation.runId;
}
</script>

<template>
	<section>
		<form @submit.prevent="startWorkflow">
			<input v-model="messageInput" />
			<button :disabled="!messageInput.trim()" type="submit">Run workflow</button>
		</form>

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

The workflow input shape is whatever the workflow defines; `{ message }` is just JSON input, not an ongoing conversation. The workflow module must expose `route` for browser invocation and expose and authorize run reads with a `runs` handler before browser clients can observe `/runs/:runId`.

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
- `src/core` keeps reducer, agent-session, workflow-run, and shared message/status types framework-neutral so the Vue composables stay lifecycle/ref adapters.
- `useFlueAgent()` covers client resolution, mounted observation, history hydration, live tailing, optimistic send admission, durable echo reconciliation, streamed assistant text/reasoning/tool parts, terminal reconciliation, stable React-compatible message IDs, fresh-conversation `404` handling, fatal stream errors, transient retries, and reconnect wakeups.
- `useFlueWorkflow()` covers client resolution, mounted observation, run replay, log selection, terminal states, disconnected states, event dedupe, and transient retry from durable checkpoints with retry status snapshots.
- `test/contracts` contains active runtime and type contract coverage for the public Vue adapter behavior.
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
