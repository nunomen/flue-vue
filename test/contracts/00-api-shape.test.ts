import { describe, expect, it } from 'vitest';
import { computed, defineComponent, h, nextTick, shallowRef } from 'vue';
import { createFluePlugin, FlueProvider, useFlueAgent, useFlueClient, useFlueWorkflow } from '../../src/index.ts';
import { createTestClient } from '../helpers/flue-test-client.ts';
import { mountSetup } from '../helpers/vue-harness.ts';
import { mount } from '@vue/test-utils';

describe('Vue API shape smoke tests', () => {
	it('plugin install provides a client through useFlueClient()', () => {
		const client = createTestClient();
		const mounted = mountSetup(() => useFlueClient(), {
			plugins: [createFluePlugin({ client })],
		});

		expect(mounted.exposed).toBe(client);
		mounted.unmount();
	});

	it('FlueProvider provides a client to slot descendants', () => {
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

	it('useFlueAgent returns destructurable refs for dormant identity', () => {
		const client = createTestClient();
		const mounted = mountSetup(
			() => {
				const id = shallowRef<string>();
				return useFlueAgent({ name: 'triage', id, client });
			},
			{ plugins: [createFluePlugin({ client })] },
		);

		const { messages, status, historyReady, error } = mounted.exposed;
		expect(messages.value).toEqual([]);
		expect(status.value).toBe('idle');
		expect(historyReady.value).toBe(false);
		expect(error.value).toBeUndefined();
		mounted.unmount();
	});

	it('useFlueWorkflow returns destructurable refs for dormant run id', () => {
		const client = createTestClient();
		const mounted = mountSetup(() => useFlueWorkflow({ client }));

		const { events, logs, status, result, error } = mounted.exposed;
		expect(events.value).toEqual([]);
		expect(logs.value).toEqual([]);
		expect(status.value).toBe('idle');
		expect(result.value).toBeNull();
		expect(error.value).toBeUndefined();
		mounted.unmount();
	});

	it('accepts computed option values without losing current values', async () => {
		const client = createTestClient();
		const ticketId = shallowRef('ticket-8472');
		const mounted = mountSetup(() =>
			useFlueAgent({
				name: computed(() => 'triage'),
				id: computed(() => ticketId.value),
				history: computed(() => 100),
				live: computed(() => true),
				client,
			}),
		);

		expect(mounted.exposed.status.value).toBe('idle');
		ticketId.value = 'ticket-8473';
		await nextTick();
		expect(mounted.exposed.status.value).toBe('idle');
		mounted.unmount();
	});
});

