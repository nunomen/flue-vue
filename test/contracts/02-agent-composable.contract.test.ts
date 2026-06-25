import type { AgentPromptImage, AgentSendResult, AttachedAgentEvent } from '@flue/sdk';
import { computed, nextTick, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useFlueAgent } from '../../src/index.ts';
import { createTestClient, pendingStream } from '../helpers/flue-test-client.ts';
import { mountSetup } from '../helpers/vue-harness.ts';

describe('useFlueAgent Vue contracts', () => {
	it('requires a client even while dormant without id', () => {
		expect(() => mountSetup(() => useFlueAgent({ name: 'triage' }))).toThrow(
			/client option or provided Flue client/,
		);
	});

	it('stays dormant without id and returns empty idle refs', () => {
		const client = createTestClient();
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', client }));

		expect(mounted.exposed.messages.value).toEqual([]);
		expect(mounted.exposed.status.value).toBe('idle');
		expect(mounted.exposed.historyReady.value).toBe(false);
		expect(mounted.exposed.error.value).toBeUndefined();
		expect(client.agents.stream).not.toHaveBeenCalled();
		mounted.unmount();
	});

	it('accepts plain values, refs, computed refs, and getters for name', async () => {
		const client = createTestClient();
		const stream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValue(stream);
		const name = shallowRef('triage');
		const mounted = mountSetup(() =>
			useFlueAgent({
				name: computed(() => name.value),
				id: 'ticket-1',
				client,
			}),
		);

		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledWith('triage', 'ticket-1', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		mounted.unmount();
	});

	it('accepts plain values, refs, computed refs, and getters for id', async () => {
		const client = createTestClient();
		const id = shallowRef('ticket-1');
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: () => id.value, client }));

		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledWith('triage', 'ticket-1', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		mounted.unmount();
	});

	it('accepts plain values, refs, computed refs, and getters for history', async () => {
		const client = createTestClient();
		const mounted = mountSetup(() =>
			useFlueAgent({
				name: 'triage',
				id: 'ticket-1',
				history: () => 'all',
				client,
			}),
		);

		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledWith('triage', 'ticket-1', {
			offset: '-1',
			tail: undefined,
			live: false,
		});
		mounted.unmount();
	});

	it('accepts plain values, refs, computed refs, and getters for live mode', async () => {
		const client = createTestClient();
		const stream = pendingStream<AttachedAgentEvent>('history-offset');
		vi.mocked(client.agents.stream).mockReturnValue(stream);
		const live = shallowRef<'sse'>('sse');
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', live, client }));

		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledWith('triage', 'ticket-1', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		mounted.unmount();
	});

	it('does not recreate a session when computed option values are unchanged', async () => {
		const client = createTestClient();
		const dependency = shallowRef(0);
		const id = computed(() => {
			void dependency.value;
			return 'ticket-1';
		});
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id, client }));

		await nextTick();
		expect(client.agents.stream).toHaveBeenCalledTimes(1);

		dependency.value++;
		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('replaces the session when id changes', async () => {
		const client = createTestClient();
		const firstStream = pendingStream<AttachedAgentEvent>();
		const secondStream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream);
		const id = shallowRef('ticket-1');
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id, client }));

		await nextTick();
		id.value = 'ticket-2';
		await nextTick();

		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		expect(client.agents.stream).toHaveBeenLastCalledWith('triage', 'ticket-2', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		mounted.unmount();
	});

	it('replaces the session when name changes', async () => {
		const client = createTestClient();
		const firstStream = pendingStream<AttachedAgentEvent>();
		const secondStream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream);
		const name = shallowRef('triage');
		const mounted = mountSetup(() => useFlueAgent({ name, id: 'ticket-1', client }));

		await nextTick();
		name.value = 'support';
		await nextTick();

		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		expect(client.agents.stream).toHaveBeenLastCalledWith('support', 'ticket-1', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		mounted.unmount();
	});

	it('replaces the session when history changes', async () => {
		const client = createTestClient();
		const firstStream = pendingStream<AttachedAgentEvent>();
		const secondStream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream);
		const history = shallowRef<100 | 'all'>(100);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', history, client }));

		await nextTick();
		history.value = 'all';
		await nextTick();

		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		expect(client.agents.stream).toHaveBeenLastCalledWith('triage', 'ticket-1', {
			offset: '-1',
			tail: undefined,
			live: false,
		});
		mounted.unmount();
	});

	it('replaces the session when live mode changes', async () => {
		const client = createTestClient();
		const firstStream = pendingStream<AttachedAgentEvent>();
		const secondStream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream);
		const live = shallowRef<boolean | 'sse'>(true);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', live, client }));

		await nextTick();
		live.value = 'sse';
		await nextTick();

		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		expect(client.agents.stream).toHaveBeenCalledTimes(2);
		mounted.unmount();
	});

	it('replaces the session when client changes', async () => {
		const first = createTestClient();
		const second = createTestClient();
		const firstStream = pendingStream<AttachedAgentEvent>();
		const secondStream = pendingStream<AttachedAgentEvent>();
		vi.mocked(first.agents.stream).mockReturnValue(firstStream);
		vi.mocked(second.agents.stream).mockReturnValue(secondStream);
		const client = shallowRef(first);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await nextTick();
		client.value = second;
		await nextTick();

		expect(firstStream.cancel).toHaveBeenCalledTimes(1);
		expect(second.agents.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('returns refs that survive destructuring', () => {
		const client = createTestClient();
		const mounted = mountSetup(() => {
			const { messages, status, historyReady, error, sendMessage } = useFlueAgent({
				name: 'triage',
				client,
			});
			return { messages, status, historyReady, error, sendMessage };
		});

		expect(mounted.exposed.messages.value).toEqual([]);
		expect(mounted.exposed.status.value).toBe('idle');
		expect(mounted.exposed.historyReady.value).toBe(false);
		mounted.unmount();
	});

	it('starts observing only after component mount', async () => {
		const client = createTestClient();
		const mounted = mountSetup(() => {
			const agent = useFlueAgent({ name: 'triage', id: 'ticket-1', client });
			expect(client.agents.stream).not.toHaveBeenCalled();
			return agent;
		});

		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it.todo('does not open streams during server-side setup');
	it.todo('disposes the observer on component unmount');
	it.todo('disposes the observer when an enclosing effectScope stops');
	it.todo('does not mutate returned message arrays in place');
	it.todo('uses shallow snapshot storage so message payloads are not deeply proxied');
	it.todo('loads default history with tail 100');
	it.todo('loads full history with history all');
	it.todo('publishes initial durable history atomically only after hydration completes');
	it.todo('retains optimistic sends made while initial history is loading');
	it.todo('continues live observation from the exact hydration offset');
	it.todo('forwards live mode sse after finite hydration');
	it.todo('keeps historyReady true across live reconnects');
	it.todo('treats initial 404 as an empty new conversation');
	it.todo('attaches from the admission offset after first send for a fresh conversation');

	it('sendMessage rejects without id', async () => {
		const client = createTestClient();
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', client }));

		await expect(mounted.exposed.sendMessage('hello')).rejects.toThrow(/agent id/);
		expect(client.agents.send).not.toHaveBeenCalled();
		mounted.unmount();
	});

	it('sendMessage adds an optimistic user message immediately', async () => {
		const client = createTestClient();
		const admission = agentAdmission();
		let resolveAdmission!: (value: AgentSendResult) => void;
		vi.mocked(client.agents.send).mockReturnValue(
			new Promise<AgentSendResult>((resolve) => {
				resolveAdmission = resolve;
			}),
		);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));
		const sendPromise = mounted.exposed.sendMessage('hello');

		expect(mounted.exposed.messages.value).toMatchObject([
			{ role: 'user', parts: [{ type: 'text', text: 'hello', state: 'done' }] },
		]);

		resolveAdmission(admission);
		await sendPromise;

		expect(mounted.exposed.status.value).toBe('streaming');
		mounted.unmount();
	});

	it('sendMessage forwards image options to client.agents.send', async () => {
		const client = createTestClient();
		vi.mocked(client.agents.send).mockResolvedValue(agentAdmission());
		const image: AgentPromptImage = {
			type: 'image',
			data: 'data:image/png;base64,abc',
			mimeType: 'image/png',
		};
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await mounted.exposed.sendMessage('hello', { images: [image] });

		expect(client.agents.send).toHaveBeenCalledWith('triage', 'ticket-1', {
			message: 'hello',
			images: [image],
		});
		expect(mounted.exposed.messages.value[0]?.parts).toContainEqual({
			type: 'file',
			mediaType: 'image/png',
			url: 'data:image/png;base64,abc',
		});
		mounted.unmount();
	});

	it('sendMessage resolves after admission, not after generation', async () => {
		const client = createTestClient();
		vi.mocked(client.agents.send).mockResolvedValue(agentAdmission());
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await expect(mounted.exposed.sendMessage('hello')).resolves.toBeUndefined();

		expect(client.agents.send).toHaveBeenCalledTimes(1);
		mounted.unmount();
	});

	it('sendMessage removes optimistic message and surfaces error when admission fails', async () => {
		const client = createTestClient();
		const error = new Error('admission failed');
		vi.mocked(client.agents.send).mockRejectedValue(error);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await expect(mounted.exposed.sendMessage('hello')).rejects.toThrow('admission failed');

		expect(mounted.exposed.messages.value).toEqual([]);
		expect(mounted.exposed.status.value).toBe('error');
		expect(mounted.exposed.error.value).toBe(error);
		mounted.unmount();
	});

	it.todo('reconciles receipt-before-echo without comparing message text');
	it.todo('reconciles echo-before-receipt by dropping the optimistic duplicate');
	it.todo('keeps optimistic user message position when durable echo arrives late');
	it.todo('keeps durable message order when a send completes during hydration');
	it.todo('preserves send failure state when hydration later completes');
	it.todo('preserves local image data URLs when durable echo redacts image bytes');
	it.todo('builds text and reasoning parts from ordered deltas');
	it.todo('correlates interleaved reasoning deltas by content index');
	it.todo('reconciles streamed assistant content to authoritative message_end content');
	it.todo('provisions an assistant message when a late stream begins at tool_start');
	it.todo('preserves late tool result through terminal reconciliation');
	it.todo('uses finalized tool input while preserving prior result');
	it.todo('drops late text deltas until terminal reconciliation supplies a message');
	it.todo('adds model and usage metadata from turn events');
	it.todo('dedupes redelivered stream events');
	it.todo('accepts restarted event indexes for distinct dispatch contexts');
	it.todo('keeps another local submission pending when one submission becomes idle');
	it.todo('reports streaming when assistant activity arrives before admission');
	it.todo('surfaces terminal submission failure before final idle boundary');
	it.todo('retries transient hydration errors with capped exponential backoff');
	it.todo('retries transient live errors from delivered checkpoint');
	it.todo('short-circuits reconnect backoff when sendMessage wakes the observer');
	it.todo('ignores stale checkpoints from disposed observers after replacement starts');
	it.todo('does not duplicate interrupted partial batches when they are redelivered');
	it.todo('does not cancel server-side work when local observation is disposed');
});

function agentAdmission(): AgentSendResult {
	return {
		streamUrl: 'https://example.com/stream',
		offset: 'offset-1',
		submissionId: 'submission-1',
	};
}
