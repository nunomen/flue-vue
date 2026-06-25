import { createFlueClient, type AttachedAgentEvent, type FlueEvent } from '@flue/sdk';
import { flushPromises, mount, renderToString } from '@vue/test-utils';
import type { ShallowRef } from 'vue';
import { defineComponent, effectScope, h, nextTick, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useSubscribableSnapshot, type SubscribableSnapshot } from '../../src/bridge.ts';
import { createFluePlugin, useFlueAgent, useFlueClient, useFlueWorkflow } from '../../src/index.ts';
import { createTestClient, pendingStream } from '../helpers/flue-test-client.ts';
import { mountSetup } from '../helpers/vue-harness.ts';

describe('Vue lifecycle and SSR contracts', () => {
	it('agent composable can be created inside an effectScope and cleaned up with stop', async () => {
		const client = createTestClient();
		const stream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValue(stream);
		const scope = effectScope();

		scope.run(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));
		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledTimes(1);

		scope.stop();

		expect(stream.cancel).toHaveBeenCalledTimes(1);
	});

	it('workflow composable can be created inside an effectScope and cleaned up with stop', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const scope = effectScope();

		scope.run(() => useFlueWorkflow({ runId: 'run-1', client }));
		await nextTick();

		expect(client.runs.stream).toHaveBeenCalledTimes(1);

		scope.stop();

		expect(stream.cancel).toHaveBeenCalledTimes(1);
	});

	it('agent composable does not call client.agents.stream during SSR render', async () => {
		const client = createTestClient();
		const Probe = defineComponent({
			name: 'AgentSsrProbe',
			setup() {
				useFlueAgent({ name: 'triage', id: 'ticket-1', client });
				return () => h('div', 'agent');
			},
		});

		await renderToString(Probe);

		expect(client.agents.stream).not.toHaveBeenCalled();
	});

	it('workflow composable does not call client.runs.stream during SSR render', async () => {
		const client = createTestClient();
		const Probe = defineComponent({
			name: 'WorkflowSsrProbe',
			setup() {
				useFlueWorkflow({ runId: 'run-1', client });
				return () => h('div', 'workflow');
			},
		});

		await renderToString(Probe);

		expect(client.runs.stream).not.toHaveBeenCalled();
	});

	it('agent composable opens stream after hydration/mount on client', async () => {
		const client = createTestClient();
		const mounted = mountSetup(() => {
			useFlueAgent({ name: 'triage', id: 'ticket-1', client });
			expect(client.agents.stream).not.toHaveBeenCalled();
		});

		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('workflow composable opens stream after hydration/mount on client', async () => {
		const client = createTestClient();
		const mounted = mountSetup(() => {
			useFlueWorkflow({ runId: 'run-1', client });
			expect(client.runs.stream).not.toHaveBeenCalled();
		});

		await nextTick();

		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('relative baseUrl behavior remains delegated to user-created SDK client', () => {
		const client = createFlueClient({ baseUrl: '/api' });
		const mounted = mountSetup(() => useFlueClient(), {
			plugins: [createFluePlugin({ client })],
		});

		expect(mounted.exposed).toBe(client);
		mounted.unmount();
	});

	it('multiple concurrent component instances observe independently', async () => {
		const client = createTestClient();
		const firstStream = pendingStream<AttachedAgentEvent>();
		const secondStream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream);
		const Child = defineComponent({
			name: 'AgentChild',
			props: {
				id: {
					type: String,
					required: true,
				},
			},
			setup(props) {
				useFlueAgent({ name: 'triage', id: () => props.id, client });
				return () => h('div');
			},
		});

		const wrapper = mount(
			defineComponent({
				setup() {
					return () => h('section', [h(Child, { id: 'ticket-1' }), h(Child, { id: 'ticket-2' })]);
				},
			}),
		);

		await nextTick();

		expect(client.agents.stream).toHaveBeenNthCalledWith(1, 'triage', 'ticket-1', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		expect(client.agents.stream).toHaveBeenNthCalledWith(2, 'triage', 'ticket-2', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		wrapper.unmount();
	});

	it('shared app client does not imply shared conversation state', async () => {
		const client = createTestClient();
		const firstStream = pendingStream<FlueEvent>();
		const secondStream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream);
		const workflows: ReturnType<typeof useFlueWorkflow>[] = [];
		const Child = defineComponent({
			name: 'WorkflowChild',
			setup() {
				workflows.push(useFlueWorkflow({ runId: 'run-1' }));
				return () => h('div');
			},
		});

		const wrapper = mount(
			defineComponent({
				setup() {
					return () => h('section', [h(Child), h(Child)]);
				},
			}),
			{
				global: {
					plugins: [createFluePlugin({ client })],
				},
			},
		);

		await nextTick();
		firstStream.push(runStartEvent(0));
		await flushPromises();

		expect(workflows[0]?.status.value).toBe('running');
		expect(workflows[1]?.status.value).toBe('connecting');
		wrapper.unmount();
	});

	it('scope disposal before first async stream event does not publish stale snapshots', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await nextTick();
		mounted.unmount();
		stream.push(runStartEvent(0));
		await flushPromises();

		expect(mounted.exposed.status.value).toBe('connecting');
	});

	it('external observer callbacks from replaced observers cannot publish stale snapshots', async () => {
		const identity = shallowRef('first');
		let snapshot!: ShallowRef<ManualSnapshot>;
		const observers: ManualObserver[] = [];
		const scope = effectScope();

		scope.run(() => {
			snapshot = useSubscribableSnapshot({
				emptySnapshot: { label: 'empty' },
				getIdentity: () => identity.value,
				createObserver: (value) => {
					const observer = new ManualObserver(value);
					observers.push(observer);
					return observer;
				},
				isEqual: (left, right) => left === right,
			});
		});

		expect(snapshot.value).toEqual({ label: 'first:initial' });
		expect(observers[0]?.start).toHaveBeenCalledTimes(1);

		identity.value = 'second';
		await nextTick();

		expect(snapshot.value).toEqual({ label: 'second:initial' });
		observers[0]?.emit({ label: 'first:late' });

		expect(snapshot.value).toEqual({ label: 'second:initial' });

		scope.stop();
		observers[1]?.emit({ label: 'second:late' });

		expect(snapshot.value).toEqual({ label: 'second:initial' });
	});
});

interface ManualSnapshot {
	label: string;
}

class ManualObserver implements SubscribableSnapshot<ManualSnapshot> {
	#listeners = new Set<() => void>();
	#snapshot: ManualSnapshot;
	start = vi.fn();
	dispose = vi.fn(() => this.#listeners.clear());

	constructor(label: string) {
		this.#snapshot = { label: `${label}:initial` };
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	getSnapshot(): ManualSnapshot {
		return this.#snapshot;
	}

	emit(snapshot: ManualSnapshot): void {
		this.#snapshot = snapshot;
		for (const listener of this.#listeners) listener();
	}
}

function runStartEvent(eventIndex: number): FlueEvent {
	return {
		type: 'run_start',
		v: 3,
		eventIndex,
		timestamp: `2026-06-25T00:00:0${eventIndex}.000Z`,
		runId: 'run-1',
		workflowName: 'summarize',
		startedAt: '2026-06-25T00:00:00.000Z',
		input: {},
	};
}
