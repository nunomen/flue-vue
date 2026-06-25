import type { FlueEvent } from '@flue/sdk';
import { flushPromises, renderToString } from '@vue/test-utils';
import { computed, defineComponent, effectScope, h, isProxy, nextTick, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useFlueWorkflow } from '../../src/index.ts';
import {
	createTestClient,
	failingStream,
	finiteStream,
	pendingStream,
	throwingStream,
} from '../helpers/flue-test-client.ts';
import { mountSetup } from '../helpers/vue-harness.ts';

describe('useFlueWorkflow Vue contracts', () => {
	it('requires a client even while dormant without runId', () => {
		expect(() => mountSetup(() => useFlueWorkflow())).toThrow(/client option or provided Flue client/);
	});

	it('stays dormant without runId and returns empty idle refs', () => {
		const client = createTestClient();
		const mounted = mountSetup(() => useFlueWorkflow({ client }));

		expect(mounted.exposed.events.value).toEqual([]);
		expect(mounted.exposed.logs.value).toEqual([]);
		expect(mounted.exposed.status.value).toBe('idle');
		expect(mounted.exposed.result.value).toBeNull();
		expect(mounted.exposed.error.value).toBeUndefined();
		expect(client.runs.stream).not.toHaveBeenCalled();
		mounted.unmount();
	});

	it('accepts plain values, refs, computed refs, and getters for runId', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const runId = shallowRef('run-1');
		const mounted = mountSetup(() =>
			useFlueWorkflow({
				runId: computed(() => runId.value),
				client,
			}),
		);

		await nextTick();

		expect(client.runs.stream).toHaveBeenCalledWith('run-1', {
			offset: '-1',
			live: true,
		});
		mounted.unmount();
	});

	it('accepts plain values, refs, computed refs, and getters for client', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const mounted = mountSetup(() =>
			useFlueWorkflow({
				runId: () => 'run-1',
				client: computed(() => client),
			}),
		);

		await nextTick();

		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('does not recreate a run observer when computed option values are unchanged', async () => {
		const client = createTestClient();
		const dependency = shallowRef(0);
		const runId = computed(() => {
			void dependency.value;
			return 'run-1';
		});
		const mounted = mountSetup(() => useFlueWorkflow({ runId, client }));

		await nextTick();
		expect(client.runs.stream).toHaveBeenCalledTimes(1);

		dependency.value++;
		await nextTick();

		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('replaces the observer when runId changes', async () => {
		const client = createTestClient();
		const firstStream = pendingStream<FlueEvent>();
		const secondStream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream);
		const runId = shallowRef('run-1');
		const mounted = mountSetup(() => useFlueWorkflow({ runId, client }));

		await nextTick();
		runId.value = 'run-2';
		await nextTick();

		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		expect(client.runs.stream).toHaveBeenLastCalledWith('run-2', {
			offset: '-1',
			live: true,
		});
		mounted.unmount();
	});

	it('replaces the observer when client changes', async () => {
		const first = createTestClient();
		const second = createTestClient();
		const firstStream = pendingStream<FlueEvent>();
		const secondStream = pendingStream<FlueEvent>();
		vi.mocked(first.runs.stream).mockReturnValue(firstStream);
		vi.mocked(second.runs.stream).mockReturnValue(secondStream);
		const client = shallowRef(first);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await nextTick();
		client.value = second;
		await nextTick();

		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		expect(second.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('returns refs that survive destructuring', () => {
		const client = createTestClient();
		const mounted = mountSetup(() => {
			const { events, logs, status, result, error } = useFlueWorkflow({ client });
			return { events, logs, status, result, error };
		});

		expect(mounted.exposed.events.value).toEqual([]);
		expect(mounted.exposed.logs.value).toEqual([]);
		expect(mounted.exposed.status.value).toBe('idle');
		mounted.unmount();
	});

	it('starts observing only after component mount', async () => {
		const client = createTestClient();
		const mounted = mountSetup(() => {
			const workflow = useFlueWorkflow({ runId: 'run-1', client });
			expect(client.runs.stream).not.toHaveBeenCalled();
			return workflow;
		});

		await nextTick();

		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('does not open streams during server-side setup', async () => {
		const client = createTestClient();
		const Probe = defineComponent({
			setup() {
				useFlueWorkflow({ runId: 'run-1', client });
				return () => h('div');
			},
		});

		await renderToString(Probe);

		expect(client.runs.stream).not.toHaveBeenCalled();
	});

	it('disposes the observer on component unmount', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await nextTick();
		mounted.unmount();

		expect(stream.cancel).toHaveBeenCalledTimes(1);
	});

	it('disposes the observer when an enclosing effectScope stops', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const scope = effectScope();

		scope.run(() => useFlueWorkflow({ runId: 'run-1', client }));
		await nextTick();
		scope.stop();

		expect(stream.cancel).toHaveBeenCalledTimes(1);
	});
	it('uses shallow snapshot storage so workflow events are not deeply proxied', async () => {
		const client = createTestClient();
		const event = runStartEvent(0);
		vi.mocked(client.runs.stream).mockReturnValue(finiteStream<FlueEvent>([event]));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(isProxy(mounted.exposed.events.value)).toBe(false);
		expect(isProxy(mounted.exposed.events.value[0])).toBe(false);
		mounted.unmount();
	});

	it('replays completed workflow run history', async () => {
		const client = createTestClient();
		vi.mocked(client.runs.stream).mockReturnValue(
			finiteStream<FlueEvent>([
				runStartEvent(0),
				runEndEvent(1, { summary: 'done' }),
			]),
		);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.events.value).toHaveLength(2);
		expect(mounted.exposed.status.value).toBe('completed');
		expect(mounted.exposed.result.value).toEqual({ summary: 'done' });
		mounted.unmount();
	});

	it('selects log events into logs while preserving all events', async () => {
		const client = createTestClient();
		const log = logEvent(1, 'hello');
		vi.mocked(client.runs.stream).mockReturnValue(
			finiteStream<FlueEvent>([
				runStartEvent(0),
				log,
				runEndEvent(2, null),
			]),
		);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.events.value).toHaveLength(3);
		expect(mounted.exposed.logs.value).toEqual([log]);
		mounted.unmount();
	});

	it('reports running after run_start', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await nextTick();
		stream.push(runStartEvent(0));
		await flushPromises();

		expect(mounted.exposed.status.value).toBe('running');
		mounted.unmount();
	});

	it('reports running after run_resume', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await nextTick();
		stream.push(runResumeEvent(0));
		await flushPromises();

		expect(mounted.exposed.status.value).toBe('running');
		mounted.unmount();
	});

	it('reports completed and exposes result from successful run_end', async () => {
		const client = createTestClient();
		vi.mocked(client.runs.stream).mockReturnValue(finiteStream<FlueEvent>([runEndEvent(0, 42)]));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('completed');
		expect(mounted.exposed.result.value).toBe(42);
		expect(mounted.exposed.error.value).toBeUndefined();
		mounted.unmount();
	});

	it('reports errored and exposes error from failing run_end', async () => {
		const client = createTestClient();
		vi.mocked(client.runs.stream).mockReturnValue(
			finiteStream<FlueEvent>([runEndEvent(0, undefined, true, { message: 'failed' })]),
		);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('errored');
		expect(mounted.exposed.error.value).toEqual({ message: 'failed' });
		mounted.unmount();
	});

	it('reports disconnected when the stream closes without run_end', async () => {
		const client = createTestClient();
		vi.mocked(client.runs.stream).mockReturnValue(finiteStream<FlueEvent>([runStartEvent(0)]));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('disconnected');
		mounted.unmount();
	});

	it('treats 401 as terminal disconnected', async () => {
		const client = createTestClient();
		const error = { status: 401 };
		vi.mocked(client.runs.stream).mockReturnValue(throwingStream<FlueEvent>(error));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('disconnected');
		expect(mounted.exposed.error.value).toBe(error);
		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('treats 403 as terminal disconnected', async () => {
		const client = createTestClient();
		const error = { status: 403 };
		vi.mocked(client.runs.stream).mockReturnValue(throwingStream<FlueEvent>(error));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('disconnected');
		expect(mounted.exposed.error.value).toBe(error);
		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('treats 404 as terminal disconnected', async () => {
		const client = createTestClient();
		const error = { status: 404 };
		vi.mocked(client.runs.stream).mockReturnValue(throwingStream<FlueEvent>(error));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('disconnected');
		expect(mounted.exposed.error.value).toBe(error);
		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('retries transient failures from the concrete durable checkpoint', async () => {
		vi.useFakeTimers();
		try {
			const client = createTestClient();
			vi.mocked(client.runs.stream)
				.mockReturnValueOnce(failingStream<FlueEvent>([runStartEvent(0)], new Error('offline'), 'checkpoint-1'))
				.mockReturnValueOnce(finiteStream<FlueEvent>([runEndEvent(1, 'done')], 'checkpoint-2'));
			const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

			await flushPromises();
			await vi.advanceTimersByTimeAsync(1);
			await flushPromises();

			expect(client.runs.stream).toHaveBeenNthCalledWith(2, 'run-1', {
				offset: 'checkpoint-1',
				live: true,
			});
			expect(mounted.exposed.status.value).toBe('completed');
			expect(mounted.exposed.events.value).toEqual([runStartEvent(0), runEndEvent(1, 'done')]);
			mounted.unmount();
		} finally {
			vi.useRealTimers();
		}
	});
	it('dedupes redelivered workflow events', async () => {
		const client = createTestClient();
		const event = runStartEvent(0);
		vi.mocked(client.runs.stream).mockReturnValue(finiteStream<FlueEvent>([event, event]));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.events.value).toEqual([event]);
		mounted.unmount();
	});

	it('does not reconnect after completed terminal state', async () => {
		const client = createTestClient();
		vi.mocked(client.runs.stream).mockReturnValue(finiteStream<FlueEvent>([runEndEvent(0, 'done')]));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('completed');
		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('does not reconnect after errored terminal state', async () => {
		const client = createTestClient();
		vi.mocked(client.runs.stream).mockReturnValue(
			finiteStream<FlueEvent>([runEndEvent(0, undefined, true, 'failed')]),
		);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('errored');
		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('does not reconnect after clean closure without run_end', async () => {
		const client = createTestClient();
		vi.mocked(client.runs.stream).mockReturnValue(finiteStream<FlueEvent>([runStartEvent(0)]));
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await flushPromises();

		expect(mounted.exposed.status.value).toBe('disconnected');
		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});
	it('ignores stale checkpoints from disposed observers after replacement starts', async () => {
		vi.useFakeTimers();
		try {
			const client = createTestClient();
			const secondStream = pendingStream<FlueEvent>();
			vi.mocked(client.runs.stream)
				.mockReturnValueOnce(failingStream<FlueEvent>([runStartEvent(0)], new Error('offline'), 'old-checkpoint'))
				.mockReturnValueOnce(secondStream);
			const runId = shallowRef('run-1');
			const mounted = mountSetup(() => useFlueWorkflow({ runId, client }));

			await flushPromises();
			runId.value = 'run-2';
			await nextTick();
			await vi.advanceTimersByTimeAsync(1);
			await flushPromises();

			expect(client.runs.stream).toHaveBeenCalledTimes(2);
			expect(client.runs.stream).toHaveBeenLastCalledWith('run-2', {
				offset: '-1',
				live: true,
			});
			mounted.unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not cancel server-side work when local observation is disposed', async () => {
		const client = createTestClient();
		const stream = pendingStream<FlueEvent>();
		vi.mocked(client.runs.stream).mockReturnValue(stream);
		const mounted = mountSetup(() => useFlueWorkflow({ runId: 'run-1', client }));

		await nextTick();
		mounted.unmount();

		expect(stream.cancel).toHaveBeenCalledTimes(1);
		expect(client.workflows.run).not.toHaveBeenCalled();
		expect(client.workflows.invoke).not.toHaveBeenCalled();
		expect(client.runs.get).not.toHaveBeenCalled();
		expect(client.runs.events).not.toHaveBeenCalled();
	});
});

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

function runResumeEvent(eventIndex: number): FlueEvent {
	return {
		type: 'run_resume',
		v: 3,
		eventIndex,
		timestamp: `2026-06-25T00:00:0${eventIndex}.000Z`,
		runId: 'run-1',
		workflowName: 'summarize',
		startedAt: '2026-06-25T00:00:00.000Z',
	};
}

function logEvent(eventIndex: number, message: string): Extract<FlueEvent, { type: 'log' }> {
	return {
		type: 'log',
		v: 3,
		eventIndex,
		timestamp: `2026-06-25T00:00:0${eventIndex}.000Z`,
		runId: 'run-1',
		level: 'info',
		message,
	};
}

function runEndEvent(
	eventIndex: number,
	result: unknown,
	isError = false,
	error?: unknown,
): Extract<FlueEvent, { type: 'run_end' }> {
	return {
		type: 'run_end',
		v: 3,
		eventIndex,
		timestamp: `2026-06-25T00:00:0${eventIndex}.000Z`,
		runId: 'run-1',
		result,
		isError,
		error,
		durationMs: 10,
	};
}
