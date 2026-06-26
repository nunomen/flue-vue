# `@nunomen/flue-vue` Implementation Plan

## Objective

Build a first-class Vue 3 client package for [Flue](https://flueframework.com/) that feels native in Vue applications while preserving the behavior already proven by [`@flue/react`](https://www.npmjs.com/package/@flue/react).

The adapter should not become a React-shaped port. Vue users should get Composition API composables, typed app-level injection, ref-friendly options, SSR-safe lifecycle behavior, and predictable readonly state.

Upstream references:

- [Flue website](https://flueframework.com/)
- [withastro/flue GitHub repository](https://github.com/withastro/flue)
- [`@flue/sdk` on npm](https://www.npmjs.com/package/@flue/sdk)
- [`@flue/react` on npm](https://www.npmjs.com/package/@flue/react)
- [`@flue/runtime` on npm](https://www.npmjs.com/package/@flue/runtime)

## Source Inspection Summary

### Flue React

The [`@flue/react`](https://www.npmjs.com/package/@flue/react) package is a thin lifecycle bridge over framework-neutral state machines:

- `FlueProvider` stores a `FlueClient` in React context.
- `useFlueAgent()` creates an `AgentSession`, starts it after React commits, disposes it on unmount, and subscribes through `useSyncExternalStore`.
- `AgentSession` owns hydration, optimistic sends, admission reconciliation, new-instance `404`, reconnect backoff, stream offsets, and live transport mode.
- `reduceAgentEvent()` owns message assembly, duplicate filtering, reasoning/tool/image parts, status transitions, and durable echo reconciliation.
- `useFlueWorkflow()` wraps `WorkflowRun`, which owns run replay, log selection, terminal state, transient retries, and durable event dedupe.

The Vue package should avoid Vue-specific implementations of these pieces. In this standalone repository, where `@flue/react` is external, that means keeping agent reducers, agent sessions, workflow runs, and shared message/status types in a local framework-neutral `src/core` module and enforcing parity with the published React package through contract tests. True shared consumption by both React and Vue requires an upstream `withastro/flue` change.

### VueUse Patterns

Observed patterns to adopt:

- Accept `MaybeRefOrGetter` inputs for values that commonly come from route params, props, or computed state.
- Normalize with `toValue()` inside watchers and actions.
- Prefer options objects over positional arguments.
- Prefer `shallowRef` for external payloads and large event/message arrays.
- Use `tryOnScopeDispose`-style cleanup, or plain `onScopeDispose` when a composable requires setup context.
- Avoid deep proxying of external instances.
- Keep composables renderless and return refs/actions rather than components-first APIs.

### Pinia Patterns

Observed patterns to adopt:

- Provide an installable plugin object through `app.use(...)`.
- Use a typed `InjectionKey`.
- Store app-scoped dependencies with `app.provide(...)`.
- Mark external class-like objects raw before providing them.
- Keep per-app state isolated; do not rely on global singleton state for SSR.

## Package Shape

```txt
src/
  core/
    agent-reducer.ts
    agent-session.ts
    workflow-run.ts
    types.ts
  index.ts
  provider.ts
  use-agent.ts
  use-workflow.ts
  bridge.ts
  types.ts

test/
  helpers/
  fixtures/
  contracts/
```

The eventual upstream version should probably add a shared core package:

```txt
packages/ui-core/
  agent-reducer.ts
  agent-session.ts
  workflow-run.ts
  types.ts

packages/react/
  provider.ts
  use-agent.ts
  use-workflow.ts

packages/vue/
  provider.ts
  use-agent.ts
  use-workflow.ts
```

This local project starts as a standalone design/test harness. Because it does not control `@flue/react`, it cannot make React consume the local core. If implemented against upstream [withastro/flue](https://github.com/withastro/flue), first extract the React session and reducer code into shared core, then implement Vue on top of that core.

## Public API

### Client Provision

```ts
const client = createFlueClient({ baseUrl: '/api' });
app.use(createFluePlugin({ client }));
```

Also support setup-local provision:

```ts
provideFlueClient(client);
```

And a renderless provider component:

```vue
<FlueProvider :client="client">
	<App />
</FlueProvider>
```

The provider component is useful in tests and component libraries. The app plugin is the primary application API.

### Quickstart App Example

The docs should include a minimal Vite Vue example with this shape:

```txt
src/
  main.ts
  App.vue
  components/
    AgentChat.vue
```

```ts
import { createFlueClient } from '@flue/sdk';
import { createFluePlugin } from '@nunomen/flue-vue';
import { createApp } from 'vue';
import App from './App.vue';

const client = createFlueClient({ baseUrl: '/api' });

createApp(App).use(createFluePlugin({ client })).mount('#app');
```

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';
import { useFlueAgent } from '@nunomen/flue-vue';

const props = defineProps<{ conversationId: string }>();

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
```

The quickstart must state that the Vue app is only the browser side. A [Flue](https://flueframework.com/) application still needs to expose matching routes, such as `/api/agents/triage/:id`, through `flue()`.

### Authentication

`@nunomen/flue-vue` should not implement a separate authentication layer. It should mirror [`@flue/react`](https://www.npmjs.com/package/@flue/react): users configure auth on the [`@flue/sdk`](https://www.npmjs.com/package/@flue/sdk) client and provide that client to Vue.

Static bearer token:

```ts
const client = createFlueClient({
	baseUrl: '/api',
	token: accessToken,
});
```

Per-request headers, useful for refreshed application auth state:

```ts
const client = createFlueClient({
	baseUrl: '/api',
	headers: () => {
		const token = authStore.token;
		return token ? { authorization: `Bearer ${token}` } : {};
	},
});
```

Adapter requirements:

- Accept a fully configured SDK client from the plugin, provider component, or per-composable override.
- Do not inspect, store, refresh, or transform auth credentials in the Vue layer.
- Re-evaluate option clients reactively so applications can replace the client after login, logout, tenant switch, or token rotation.
- Dispose and recreate active observers when the resolved client identity changes.
- Preserve SDK behavior where header factories are evaluated per HTTP request and Durable Streams reconnect.
- Document that active SSE connections keep their opening headers until reconnect; applications that need immediate token replacement should replace the client/observer or force a reconnect.

Server-side authorization belongs to the authored Flue application. For Hono routing, protect exposed routes before mounting `flue()`:

```ts
app.use('/api/agents/*', requireUser);
app.use('/api/workflows/*', requireUser);
app.route('/api', flue());
```

Workflow run reads are separately authorized. Workflows must export a `runs` handler before browser clients can observe existing runs through `/runs/:runId`.

### `useFlueClient()`

```ts
function useFlueClient(): FlueClient;
```

Returns the nearest provided client. Throws if there is no current client, matching React's explicit failure behavior.

### `useFlueAgent()`

```ts
function useFlueAgent(options: UseFlueAgentOptions): UseFlueAgentReturn;

interface UseFlueAgentOptions {
	name: MaybeRefOrGetter<string>;
	id?: MaybeRefOrGetter<string | undefined>;
	history?: MaybeRefOrGetter<number | 'all' | undefined>;
	live?: MaybeRefOrGetter<LiveMode | undefined>;
	client?: MaybeRefOrGetter<FlueClient | undefined>;
}
```

Return refs plus bound actions:

```ts
interface UseFlueAgentReturn {
	messages: Readonly<ComputedRef<UIMessage[]>>;
	status: Readonly<ComputedRef<AgentStatus>>;
	historyReady: Readonly<ComputedRef<boolean>>;
	error: Readonly<ComputedRef<Error | undefined>>;
	sendMessage(message: string, options?: SendMessageOptions): Promise<void>;
}
```

Why computed refs instead of a reactive object:

- Destructuring remains reactive, like VueUse and Pinia `storeToRefs`.
- Consumers get stable individual refs that fit templates and watchers.
- The snapshot can remain a `shallowRef` internally to avoid deep proxying message payloads.

### `useFlueWorkflow()`

`useFlueWorkflow()` only observes existing workflow runs. Workflow invocation stays on the SDK client through `client.workflows.invoke(name, { input })`; the Vue composable should not add a `sendMessage()` action. Message-like values are ordinary workflow input when the workflow schema accepts them.

```ts
function useFlueWorkflow(options: UseFlueWorkflowOptions): UseFlueWorkflowReturn;

interface UseFlueWorkflowOptions {
	runId?: MaybeRefOrGetter<string | undefined>;
	client?: MaybeRefOrGetter<FlueClient | undefined>;
}
```

Return refs:

```ts
interface UseFlueWorkflowReturn {
	events: Readonly<ComputedRef<FlueEvent[]>>;
	logs: Readonly<ComputedRef<Extract<FlueEvent, { type: 'log' }>[]>>;
	status: Readonly<ComputedRef<WorkflowStatus>>;
	result: Readonly<ComputedRef<unknown>>;
	error: Readonly<ComputedRef<unknown>>;
}
```

## Lifecycle Model

Use a small internal bridge that maps an external-store-like object to Vue:

```ts
interface SubscribableSnapshot<T> {
	subscribe(listener: () => void): () => void;
	getSnapshot(): T;
	start(): void;
	dispose(): void;
}
```

Bridge rules:

- Create a session/run only when the identity is present.
- Start only in a mounted client-side scope.
- Subscribe before or immediately after start so synchronous snapshots are not missed.
- Dispose current observer when any identity option changes.
- Dispose on component unmount or effect-scope disposal.
- Keep dormant snapshots idle and empty.
- Do not cancel server-side work when disposing local observation.

## SSR Model

During SSR:

- `useFlueAgent()` and `useFlueWorkflow()` return dormant snapshots.
- No stream opens.
- No browser-only API is touched.
- The SDK client itself is still user-owned; if created during SSR, its `baseUrl` must be absolute.

The package should avoid global singleton clients for SSR correctness. `createFluePlugin()` should provide per-app state.

## Implementation Phases

### Phase 1: Package Skeleton

- Add package metadata, pnpm config, TypeScript config, Vitest config.
- Add public API stubs with correct types.
- Add tests as a contract inventory.
- Add fixture streams and fake Flue client helpers.

Exit criteria:

- `pnpm install` succeeds.
- `pnpm test` succeeds with the currently active smoke tests.
- `pnpm run test:type` succeeds.
- Contract test names cover all required behavior.

### Phase 2: Framework-Neutral Core Strategy

In this standalone repository:

- Move Vue-owned reducer/session/workflow state into `src/core`.
- Keep `src/core` free of React and Vue imports.
- Keep `useFlueAgent()` and `useFlueWorkflow()` as Vue lifecycle/ref adapters over core classes.
- Use published `@flue/react` behavior as a contract reference, not as a private runtime dependency.
- Add parity contracts for React-observed behavior such as stable message IDs, `message_start`, `thinking_start`, `thinking_end`, image URL normalization, terminal stream failures, and retry status snapshots.

Exit criteria:

- Vue composables contain no reducer/session/workflow state-machine logic.
- `src/core` has no React or Vue dependency.
- Contract tests cover known React parity risks.

### Optional Upstream Shared Core Extraction

If contributing upstream:

- Move React's reducer/session/workflow state into `@flue/ui-core`.
- Re-export shared message and status types from core.
- Update `@flue/react` to import from core without changing public behavior.
- Move existing React reducer/session tests to core where possible.
- Keep React hook tests in React package.

Exit criteria:

- Existing React package tests still pass.
- No public React API changes.
- Core package has no React or Vue dependency.

### Phase 3: Vue Provider

- Implement `flueClientKey`.
- Implement `createFluePlugin({ client })`.
- Implement `provideFlueClient(client)`.
- Implement `useFlueClient()`.
- Implement `<FlueProvider :client="client">`.
- Mark provided clients raw.

Exit criteria:

- Plugin provides client to descendants.
- Provider component provides client to slot descendants.
- `useFlueClient()` throws outside setup/provider.
- Multiple apps can provide different clients.

### Phase 4: `useFlueAgent()`

- Resolve `client` from option override or provider.
- Accept literal refs, computed refs, getters, and plain values for options.
- Use a watcher over resolved option tuple.
- Create `AgentSession` when `id` is present.
- Subscribe to session snapshots into a `shallowRef`.
- Start after mount.
- Dispose on option replacement and scope disposal.
- Return computed refs and a stable `sendMessage` action.

Exit criteria:

- Dormant without `id`.
- Hydrates history atomically.
- Follows live events from the hydration checkpoint.
- Handles optimistic send, admission, echo reconciliation, failed admission, reconnect wake, and fresh `404`.
- Does not deep-proxy messages or SDK clients.

### Phase 5: `useFlueWorkflow()`

- Resolve `client` from option override or provider.
- Accept ref/getter `runId`.
- Create `WorkflowRun` only when `runId` is present.
- Subscribe into a `shallowRef`.
- Expose `events`, `logs`, `status`, `result`, `error`.
- Dispose on option replacement and scope disposal.

Exit criteria:

- Dormant without `runId`.
- Replays run events and follows live updates.
- Dedupes events.
- Produces terminal `completed`, `errored`, and `disconnected` states correctly.
- Retries transient errors from durable checkpoint.

### Phase 6: Docs and Examples

- Add README examples for Vue app setup, provider component setup, agent chat, and workflow run observation.
- Add a Vite Vue quickstart app shape.
- Add Nuxt plugin example.
- Document the SDK-driven authentication model.
- Document SSR constraints.
- Document why return values are refs, not plain values.
- Document message parts, statuses, and transport modes.

Exit criteria:

- Examples typecheck.
- Docs do not imply server work cancellation.
- Nuxt example uses client-only relative `baseUrl` or absolute server URL.
- Auth docs make clear that the SDK client owns headers/token/custom fetch and route middleware owns authorization.

## Exhaustive Test Suite

The initial suite should be broad before implementation. Test names should be precise enough that enabling each test later requires no rediscovery.

### Provider Tests

- plugin install provides the exact client.
- plugin marks external client raw.
- provider component provides client to descendants.
- setup-local `provideFlueClient()` works.
- option client override wins over injected client.
- missing client errors are explicit.
- multiple apps stay isolated.
- replacing the provided client after auth state changes recreates active observers.

### Agent Composable Tests

- dormant state without `id`.
- client is still required while dormant.
- accepts refs and getters for every option.
- changing `id` disposes the old session and creates a new one.
- changing `name`, `history`, `live`, or `client` replaces the session.
- unchanged computed option values do not recreate sessions.
- returns refs that survive destructuring.
- starts after mount, not during SSR setup.
- disposes on unmount and effect-scope stop.
- supports setup inside `effectScope`.
- preserves empty snapshot before history is ready.
- publishes requested history atomically.
- follows live stream from exact hydration offset.
- defaults to history tail `100`.
- supports `history: 'all'`.
- forwards `live: 'sse'`.
- treats fresh `404` as empty history.
- attaches from first admitted send offset after fresh `404`.
- optimistically appends user messages.
- sends images.
- preserves local image data URLs when durable echo redacts bytes.
- reconciles receipt-before-echo.
- reconciles echo-before-receipt.
- preserves durable transcript order when send completes during hydration.
- preserves send failure when hydration later completes.
- removes optimistic message on send failure.
- reports terminal stream failures.
- retries transient hydration errors with capped backoff.
- retries transient live errors with delivered checkpoint.
- wakes pending reconnect when `sendMessage()` succeeds.
- does not duplicate replayed partial batches.
- handles late tool starts and late terminal reconciliation.
- handles reasoning deltas by content index.
- exposes model and usage metadata.
- keeps `historyReady` true across later reconnects.
- does not cancel server work on local disposal.

### Workflow Composable Tests

- dormant state without `runId`.
- client is required while dormant.
- accepts ref/getter `runId` and client.
- changing `runId` disposes old observer.
- returns refs that survive destructuring.
- starts after mount, not during SSR setup.
- disposes on unmount and effect-scope stop.
- replays completed run.
- selects log events into `logs`.
- reports running from `run_start`.
- reports running from `run_resume`.
- reports completed result from successful `run_end`.
- reports errored state from failing `run_end`.
- reports disconnected when stream closes without `run_end`.
- treats `401`, `403`, and `404` as terminal disconnected.
- retries transient failures from concrete checkpoint.
- dedupes redelivered events.
- does not reconnect after terminal run.
- does not cancel server work on local disposal.

### Type Tests

- `UseFlueAgentOptions` accepts plain values, refs, computed refs, and getters.
- `UseFlueAgentReturn` exposes readonly computed refs.
- `sendMessage` accepts image options and returns `Promise<void>`.
- `UseFlueWorkflowOptions` accepts plain values, refs, computed refs, and getters.
- `UseFlueWorkflowReturn` exposes readonly computed refs.
- `UIMessage` remains assignable to the AI SDK v5-compatible shape when that dependency is present in downstream projects.
- SDK types are re-exported.

### Documentation Tests

- README examples typecheck.
- Vite quickstart example typechecks.
- auth examples with `token` and `headers` typecheck.
- Nuxt plugin example typechecks.
- Provider component example typechecks.
- No example requires Pinia.

## Non-Goals

- Do not add Pinia as a dependency.
- Do not build chat UI components in this package.
- Do not expose a cancellation API that implies server-side run cancellation.
- Do not keep reducer/session behavior embedded in Vue-specific modules; standalone state-machine logic belongs in framework-neutral `src/core` until an upstream shared core exists.
- Do not use global singleton clients as the main API.

## Open Questions

- Should upstream publish `@flue/ui-core`, or keep shared core files private inside the monorepo?
- Should `<FlueProvider>` be exported from day one, or kept as a test/docs convenience behind composables?
- Should the final package provide Nuxt auto-import metadata, or leave that to a later `@flue/nuxt` package?
- Should return refs be `ComputedRef` or `ShallowRef` snapshots with `toRefs` helpers? The current recommendation is individual computed refs.
