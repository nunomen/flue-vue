import type { AttachedAgentEvent, FlueEvent } from '@flue/sdk';
import { mount } from '@vue/test-utils';
import {
	computed,
	defineComponent,
	h,
	inject,
	isProxy,
	nextTick,
	reactive,
	shallowRef,
	watchEffect,
} from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
	createFluePlugin,
	FlueProvider,
	flueClientKey,
	provideFlueClient,
	useFlueAgent,
	useFlueClient,
	useFlueWorkflow,
} from '../../src/index.ts';
import { createTestClient, pendingStream } from '../helpers/flue-test-client.ts';
import { mountSetup } from '../helpers/vue-harness.ts';

describe('client provision contracts', () => {
	it('createFluePlugin provides the exact client instance through a typed injection key', () => {
		const client = createTestClient();
		const mounted = mountSetup(
			() => ({
				client: useFlueClient(),
				source: inject(flueClientKey),
			}),
			{ plugins: [createFluePlugin({ client })] },
		);

		expect(mounted.exposed.client).toBe(client);
		expect(mounted.exposed.source?.value).toBe(client);
		mounted.unmount();
	});

	it('createFluePlugin marks the client raw so Vue does not proxy SDK methods or stream objects', () => {
		const client = reactive(createTestClient());
		const mounted = mountSetup(() => useFlueClient(), {
			plugins: [createFluePlugin({ client })],
		});

		expect(isProxy(client)).toBe(true);
		expect(isProxy(mounted.exposed)).toBe(false);
		expect(mounted.exposed.agents.stream).toBe(client.agents.stream);
		mounted.unmount();
	});

	it('createFluePlugin isolates clients across two Vue app instances', () => {
		const first = createTestClient();
		const second = createTestClient();
		const firstMounted = mountSetup(() => useFlueClient(), {
			plugins: [createFluePlugin({ client: first })],
		});
		const secondMounted = mountSetup(() => useFlueClient(), {
			plugins: [createFluePlugin({ client: second })],
		});

		expect(firstMounted.exposed).toBe(first);
		expect(secondMounted.exposed).toBe(second);
		firstMounted.unmount();
		secondMounted.unmount();
	});

	it('provideFlueClient provides a setup-local client without installing the app plugin', () => {
		const client = createTestClient();
		let resolved: unknown;
		const Child = defineComponent({
			setup() {
				resolved = useFlueClient();
				return () => h('div');
			},
		});
		const Parent = defineComponent({
			setup() {
				provideFlueClient(client);
				return () => h(Child);
			},
		});

		const wrapper = mount(Parent);

		expect(resolved).toBe(client);
		wrapper.unmount();
	});

	it('FlueProvider provides the client to default slot descendants', () => {
		const client = createTestClient();
		let resolved: unknown;
		const Child = defineComponent({
			setup() {
				resolved = useFlueClient();
				return () => h('div');
			},
		});

		const wrapper = mount(FlueProvider, {
			props: { client },
			slots: { default: () => h(Child) },
		});

		expect(resolved).toBe(client);
		wrapper.unmount();
	});

	it('FlueProvider updates descendants when its client prop identity changes', async () => {
		const first = createTestClient();
		const second = createTestClient();
		let resolved: unknown;
		const Child = defineComponent({
			setup() {
				const source = inject(flueClientKey);
				watchEffect(() => {
					resolved = source?.value;
				});
				return () => h('div');
			},
		});

		const wrapper = mount(FlueProvider, {
			props: { client: first },
			slots: { default: () => h(Child) },
		});

		expect(resolved).toBe(first);
		await wrapper.setProps({ client: second });
		expect(resolved).toBe(second);
		wrapper.unmount();
	});

	it('useFlueClient throws a clear error when no client is provided', () => {
		expect(() => mountSetup(() => useFlueClient())).toThrow(/client option or provided Flue client/);
	});

	it('composables throw the same clear error when neither provider nor client option exists', () => {
		expect(() => mountSetup(() => useFlueAgent({ name: 'triage' }))).toThrow(
			/client option or provided Flue client/,
		);
		expect(() => mountSetup(() => useFlueWorkflow())).toThrow(/client option or provided Flue client/);
	});

	it('client option override wins over injected app client', async () => {
		const injected = createTestClient();
		const override = createTestClient();
		const stream = pendingStream<AttachedAgentEvent>();
		vi.mocked(override.agents.stream).mockReturnValue(stream);
		const mounted = mountSetup(
			() => useFlueAgent({ name: 'triage', id: 'ticket-1', client: override }),
			{ plugins: [createFluePlugin({ client: injected })] },
		);

		await nextTick();

		expect(override.agents.stream).toHaveBeenCalledWith('triage', 'ticket-1', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		expect(injected.agents.stream).not.toHaveBeenCalled();
		mounted.unmount();
	});

	it('client option accepts refs and getters', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const clientRef = computed(() => client);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: () => 'run-1', client: clientRef }));

		await nextTick();

		expect(client.runs.stream).toHaveBeenCalledWith('run-1', {
			offset: '-1',
			live: true,
		});
		mounted.unmount();
	});

	it('client option replacement recreates active observers', async () => {
		const first = createTestClient();
		const second = createTestClient();
		const firstStream = pendingStream<FlueEvent>();
		const secondStream = pendingStream<FlueEvent>();
		vi.mocked(first.runs.stream).mockReturnValue(firstStream);
		vi.mocked(second.runs.stream).mockReturnValue(secondStream);
		const clientRef = shallowRef(first);
		const mounted = mountSetup(() =>
			useFlueWorkflow({
				runId: 'run-1',
				client: clientRef,
			}),
		);

		await nextTick();
		expect(first.runs.stream).toHaveBeenCalledTimes(1);

		clientRef.value = second;
		await nextTick();

		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		expect(second.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('provided client replacement after auth changes recreates active observers', async () => {
		const first = createTestClient();
		const second = createTestClient();
		const firstStream = pendingStream<FlueEvent>();
		const secondStream = pendingStream<FlueEvent>();
		vi.mocked(first.runs.stream).mockReturnValue(firstStream);
		vi.mocked(second.runs.stream).mockReturnValue(secondStream);
		const Child = defineComponent({
			setup() {
				useFlueWorkflow({ runId: 'run-1' });
				return () => h('div');
			},
		});

		const wrapper = mount(FlueProvider, {
			props: { client: first },
			slots: { default: () => h(Child) },
		});

		await nextTick();
		expect(first.runs.stream).toHaveBeenCalledTimes(1);

		await wrapper.setProps({ client: second });
		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		await nextTick();
		expect(second.runs.stream).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});
});
