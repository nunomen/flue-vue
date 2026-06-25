import { createFlueClient, type FlueClient, type FlueEvent } from '@flue/sdk';
import { expectTypeOf, test } from 'vitest';
import type { ComputedRef, Plugin } from 'vue';
import { createApp, defineComponent, h, shallowRef } from 'vue';
import {
	createFluePlugin,
	FlueProvider,
	type UIMessage,
	useFlueClient,
	useFlueAgent,
	useFlueWorkflow,
} from '../../src/index.ts';

declare const App: ReturnType<typeof defineComponent>;
declare const accessToken: string;
declare const authStore: { token?: string };

test('README app plugin example typechecks', () => {
	const client = createFlueClient({ baseUrl: '/api' });
	const app = createApp(App);

	app.use(createFluePlugin({ client }));

	expectTypeOf(client).toMatchTypeOf<FlueClient>();
	expectTypeOf(createFluePlugin({ client })).toMatchTypeOf<Plugin>();
});

test('README Vite quickstart app shape typechecks', () => {
	const client = createFlueClient({ baseUrl: '/api' });
	const app = createApp(App);

	app.use(createFluePlugin({ client })).mount('#app');

	expectTypeOf(client).toMatchTypeOf<FlueClient>();
});

test('README FlueProvider component example typechecks', () => {
	const ProviderExample = defineComponent({
		setup() {
			const client = createFlueClient({ baseUrl: '/api' });
			return () => h(FlueProvider, { client }, () => h('div'));
		},
	});

	expectTypeOf(ProviderExample).toMatchTypeOf<ReturnType<typeof defineComponent>>();
});

test('README agent chat example typechecks in script setup shape', () => {
	const props = { conversationId: 'ticket-8472' };
	const input = shallowRef('');
	const agent = useFlueAgent({
		name: 'triage',
		id: () => props.conversationId,
		client: createFlueClient({ baseUrl: '/api' }),
	});
	const { messages, status, sendMessage } = agent;

	async function submit() {
		const message = input.value.trim();
		if (!message) return;
		input.value = '';
		await sendMessage(message);
	}

	expectTypeOf(messages).toMatchTypeOf<ComputedRef<UIMessage[]>>();
	expectTypeOf(status.value).toMatchTypeOf<'idle' | 'connecting' | 'submitted' | 'streaming' | 'error'>();
	expectTypeOf(submit).returns.toEqualTypeOf<Promise<void>>();
});

test('README workflow invocation and observation example typechecks in script setup shape', () => {
	const client = useFlueClient();
	const messageInput = shallowRef('Summarize the current support queue.');
	const runId = shallowRef<string>();
	const { events, logs, status, result, error } = useFlueWorkflow({
		runId,
		client,
	});

	async function startWorkflow() {
		const message = messageInput.value.trim();
		if (!message) return;

		const invocation = await client.workflows.invoke('weekly-report', {
			input: { message },
		});
		runId.value = invocation.runId;
	}

	expectTypeOf(events).toMatchTypeOf<ComputedRef<FlueEvent[]>>();
	expectTypeOf(logs.value).toMatchTypeOf<Extract<FlueEvent, { type: 'log' }>[]>();
	expectTypeOf(status.value).toMatchTypeOf<
		'idle' | 'connecting' | 'running' | 'completed' | 'errored' | 'disconnected'
	>();
	expectTypeOf(result.value).toEqualTypeOf<unknown>();
	expectTypeOf(error.value).toEqualTypeOf<unknown>();
	expectTypeOf(startWorkflow).returns.toEqualTypeOf<Promise<void>>();
});

test('README token auth example typechecks', () => {
	const client = createFlueClient({
		baseUrl: '/api',
		token: accessToken,
	});

	expectTypeOf(client).toMatchTypeOf<FlueClient>();
});

test('README header factory auth example typechecks', () => {
	const client = createFlueClient({
		baseUrl: '/api',
		headers: (): Record<string, string> => {
			const token = authStore.token;
			return token ? { authorization: `Bearer ${token}` } : {};
		},
	});

	expectTypeOf(client).toMatchTypeOf<FlueClient>();
});

test('Nuxt client plugin example typechecks', () => {
	defineNuxtPlugin((nuxtApp) => {
		const client = createFlueClient({ baseUrl: '/api' });
		nuxtApp.vueApp.use(createFluePlugin({ client }));
	});
});

test('Nuxt server-safe absolute baseUrl example typechecks', () => {
	const client = createFlueClient({
		baseUrl: 'https://example.com/api',
	});

	expectTypeOf(client).toMatchTypeOf<FlueClient>();
});

test('examples demonstrate destructuring returned refs safely', () => {
	const { messages, historyReady, sendMessage } = useFlueAgent({
		name: 'triage',
		id: 'ticket-8472',
		client: createFlueClient({ baseUrl: '/api' }),
	});

	expectTypeOf(messages).toMatchTypeOf<ComputedRef<UIMessage[]>>();
	expectTypeOf(historyReady).toMatchTypeOf<ComputedRef<boolean>>();
	expectTypeOf(sendMessage).returns.resolves.toEqualTypeOf<void>();
});

declare function defineNuxtPlugin(
	plugin: (nuxtApp: { vueApp: { use(plugin: Plugin): void } }) => void,
): void;
