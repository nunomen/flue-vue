import type {
	AgentPromptImage,
	AgentSendResult,
	AttachedAgentEvent,
	LlmAssistantMessage,
	LlmToolCall,
	LlmUserMessage,
} from '@flue/sdk';
import { flushPromises, renderToString } from '@vue/test-utils';
import { computed, defineComponent, effectScope, h, isProxy, nextTick, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useFlueAgent } from '../../src/index.ts';
import { createTestClient, finiteStream, pendingStream, throwingStream } from '../helpers/flue-test-client.ts';
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

	it('does not open streams during server-side setup', async () => {
		const client = createTestClient();
		const Probe = defineComponent({
			setup() {
				useFlueAgent({ name: 'triage', id: 'ticket-1', client });
				return () => h('div');
			},
		});

		await renderToString(Probe);

		expect(client.agents.stream).not.toHaveBeenCalled();
	});

	it('disposes the observer on component unmount', async () => {
		const client = createTestClient();
		const stream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValue(stream);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await nextTick();
		mounted.unmount();

		expect(stream.cancel).toHaveBeenCalledTimes(1);
	});

	it('disposes the observer when an enclosing effectScope stops', async () => {
		const client = createTestClient();
		const stream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValue(stream);
		const scope = effectScope();

		scope.run(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));
		await nextTick();
		scope.stop();

		expect(stream.cancel).toHaveBeenCalledTimes(1);
	});
	it('does not mutate returned message arrays in place', async () => {
		const client = createTestClient();
		const history = [messageEndEvent(0, 'user', 'hello')];
		vi.mocked(client.agents.stream).mockReturnValueOnce(finiteStream<AttachedAgentEvent>(history));
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));
		const initialMessages = mounted.exposed.messages.value;

		await flushPromises();

		expect(mounted.exposed.messages.value).not.toBe(initialMessages);
		expect(initialMessages).toEqual([]);
		mounted.unmount();
	});

	it('uses shallow snapshot storage so message payloads are not deeply proxied', async () => {
		const client = createTestClient();
		vi.mocked(client.agents.stream).mockReturnValueOnce(
			finiteStream<AttachedAgentEvent>([messageEndEvent(0, 'user', 'hello')]),
		);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();

		expect(isProxy(mounted.exposed.messages.value)).toBe(false);
		expect(isProxy(mounted.exposed.messages.value[0])).toBe(false);
		mounted.unmount();
	});

	it('loads default history with tail 100', async () => {
		const client = createTestClient();
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledWith('triage', 'ticket-1', {
			offset: '-1',
			tail: 100,
			live: false,
		});
		mounted.unmount();
	});

	it('loads full history with history all', async () => {
		const client = createTestClient();
		const mounted = mountSetup(() =>
			useFlueAgent({ name: 'triage', id: 'ticket-1', history: 'all', client }),
		);

		await nextTick();

		expect(client.agents.stream).toHaveBeenCalledWith('triage', 'ticket-1', {
			offset: '-1',
			tail: undefined,
			live: false,
		});
		mounted.unmount();
	});

	it('publishes initial durable history atomically only after hydration completes', async () => {
		const client = createTestClient();
		const stream = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream).mockReturnValue(stream);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await nextTick();
		stream.push(messageEndEvent(0, 'user', 'hello'));
		await flushPromises();

		expect(mounted.exposed.messages.value).toEqual([]);
		expect(mounted.exposed.historyReady.value).toBe(false);
		mounted.unmount();
	});
	it.todo('retains optimistic sends made while initial history is loading');
	it('continues live observation from the exact hydration offset', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();

		expect(client.agents.stream).toHaveBeenLastCalledWith('triage', 'ticket-1', {
			offset: 'history-offset',
			live: true,
		});
		mounted.unmount();
	});

	it('forwards live mode sse after finite hydration', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() =>
			useFlueAgent({ name: 'triage', id: 'ticket-1', live: 'sse', client }),
		);

		await flushPromises();

		expect(client.agents.stream).toHaveBeenLastCalledWith('triage', 'ticket-1', {
			offset: 'history-offset',
			live: 'sse',
		});
		mounted.unmount();
	});
	it.todo('keeps historyReady true across live reconnects');
	it('treats initial 404 as an empty new conversation', async () => {
		const client = createTestClient();
		vi.mocked(client.agents.stream).mockReturnValue(throwingStream<AttachedAgentEvent>({ status: 404 }));
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();

		expect(mounted.exposed.messages.value).toEqual([]);
		expect(mounted.exposed.status.value).toBe('idle');
		expect(mounted.exposed.historyReady.value).toBe(true);
		expect(mounted.exposed.error.value).toBeUndefined();
		mounted.unmount();
	});
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
	it('builds text and reasoning parts from ordered deltas', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(textDeltaEvent(0, 'Hel'));
		live.push(textDeltaEvent(1, 'lo'));
		live.push(thinkingDeltaEvent(2, 'because'));
		await flushPromises();

		expect(mounted.exposed.messages.value).toMatchObject([
			{
				role: 'assistant',
				parts: [
					{ type: 'text', text: 'Hello', state: 'streaming' },
					{ type: 'reasoning', text: 'because', state: 'streaming' },
				],
			},
		]);
		mounted.unmount();
	});

	it('correlates interleaved reasoning deltas by content index', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(thinkingDeltaEvent(0, 'a', 0));
		live.push(thinkingDeltaEvent(1, 'x', 1));
		live.push(thinkingDeltaEvent(2, 'b', 0));
		live.push(thinkingDeltaEvent(3, 'y', 1));
		await flushPromises();

		expect(mounted.exposed.messages.value[0]?.parts).toMatchObject([
			{ type: 'reasoning', text: 'ab', state: 'streaming' },
			{ type: 'reasoning', text: 'xy', state: 'streaming' },
		]);
		mounted.unmount();
	});

	it('reconciles streamed assistant content to authoritative message_end content', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(textDeltaEvent(0, 'draft'));
		live.push(messageEndEvent(1, 'assistant', [{ type: 'text', text: 'final' }]));
		await flushPromises();

		expect(mounted.exposed.messages.value[0]?.parts).toEqual([
			{ type: 'text', text: 'final', state: 'done' },
		]);
		mounted.unmount();
	});

	it('provisions an assistant message when a late stream begins at tool_start', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(toolStartEvent(0, { query: 'vue' }));
		await flushPromises();

		expect(mounted.exposed.messages.value).toMatchObject([
			{
				role: 'assistant',
				parts: [
					{
						type: 'dynamic-tool',
						state: 'input-available',
						toolName: 'search',
						toolCallId: 'tool-1',
						input: { query: 'vue' },
					},
				],
			},
		]);
		mounted.unmount();
	});

	it('preserves late tool result through terminal reconciliation', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(toolStartEvent(0, { query: 'vue' }));
		live.push(toolResultEvent(1, { hits: 3 }));
		live.push(messageEndEvent(2, 'assistant', [toolCallContent({ query: 'vue' })]));
		await flushPromises();

		expect(mounted.exposed.messages.value[0]?.parts).toEqual([
			{
				type: 'dynamic-tool',
				state: 'output-available',
				toolName: 'search',
				toolCallId: 'tool-1',
				input: { query: 'vue' },
				output: { hits: 3 },
			},
		]);
		mounted.unmount();
	});

	it('uses finalized tool input while preserving prior result', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(toolStartEvent(0, { q: 'vue' }));
		live.push(toolResultEvent(1, { hits: 3 }));
		live.push(messageEndEvent(2, 'assistant', [toolCallContent({ query: 'vue' })]));
		await flushPromises();

		expect(mounted.exposed.messages.value[0]?.parts[0]).toMatchObject({
			type: 'dynamic-tool',
			state: 'output-available',
			input: { query: 'vue' },
			output: { hits: 3 },
		});
		mounted.unmount();
	});
	it.todo('drops late text deltas until terminal reconciliation supplies a message');
	it('adds model and usage metadata from turn events', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(turnEvent(0));
		await flushPromises();

		expect(mounted.exposed.messages.value[0]?.metadata).toMatchObject({
			model: { provider: 'openai', id: 'gpt-5-mini' },
			usage: { input: 10, output: 5, totalTokens: 15 },
		});
		mounted.unmount();
	});

	it('dedupes redelivered stream events', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		const event = textDeltaEvent(0, 'hello');
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(event);
		live.push(event);
		await flushPromises();

		expect(mounted.exposed.messages.value[0]?.parts).toEqual([
			{ type: 'text', text: 'hello', state: 'streaming' },
		]);
		mounted.unmount();
	});

	it('accepts restarted event indexes for distinct dispatch contexts', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(textDeltaEvent(0, 'first', { dispatchId: 'dispatch-1' }));
		live.push(textDeltaEvent(0, 'second', { dispatchId: 'dispatch-2' }));
		await flushPromises();

		expect(mounted.exposed.messages.value).toHaveLength(2);
		expect(mounted.exposed.messages.value.map((message) => message.parts[0])).toMatchObject([
			{ type: 'text', text: 'first' },
			{ type: 'text', text: 'second' },
		]);
		mounted.unmount();
	});
	it.todo('keeps another local submission pending when one submission becomes idle');
	it('reports streaming when assistant activity arrives before admission', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(textDeltaEvent(0, 'hello'));
		await flushPromises();

		expect(mounted.exposed.status.value).toBe('streaming');
		mounted.unmount();
	});

	it('surfaces terminal submission failure before final idle boundary', async () => {
		const client = createTestClient();
		const live = pendingStream<AttachedAgentEvent>();
		vi.mocked(client.agents.stream)
			.mockReturnValueOnce(finiteStream<AttachedAgentEvent>([], 'history-offset'))
			.mockReturnValueOnce(live);
		const mounted = mountSetup(() => useFlueAgent({ name: 'triage', id: 'ticket-1', client }));

		await flushPromises();
		live.push(submissionFailedEvent(0));
		await flushPromises();

		expect(mounted.exposed.status.value).toBe('error');
		expect(mounted.exposed.error.value?.message).toBe('failed');
		mounted.unmount();
	});
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

function messageEndEvent(
	eventIndex: number,
	role: 'user',
	content: LlmUserMessage['content'],
): Extract<AttachedAgentEvent, { type: 'message_end' }>;
function messageEndEvent(
	eventIndex: number,
	role: 'assistant',
	content: LlmAssistantMessage['content'],
): Extract<AttachedAgentEvent, { type: 'message_end' }>;
function messageEndEvent(
	eventIndex: number,
	role: 'user' | 'assistant',
	content: LlmUserMessage['content'] | LlmAssistantMessage['content'],
): Extract<AttachedAgentEvent, { type: 'message_end' }> {
	const message =
		role === 'user'
			? ({ role, content: content as LlmUserMessage['content'] } satisfies LlmUserMessage)
			: ({ role, content: content as LlmAssistantMessage['content'] } satisfies LlmAssistantMessage);

	return {
		...agentEventBase(eventIndex),
		type: 'message_end',
		turnId: 'turn-1',
		message,
	};
}

function textDeltaEvent(
	eventIndex: number,
	text: string,
	overrides: Partial<AttachedAgentEvent> = {},
): Extract<AttachedAgentEvent, { type: 'text_delta' }> {
	return {
		...agentEventBase(eventIndex),
		...overrides,
		type: 'text_delta',
		text,
	};
}

function thinkingDeltaEvent(
	eventIndex: number,
	delta: string,
	contentIndex?: number,
): Extract<AttachedAgentEvent, { type: 'thinking_delta' }> {
	return {
		...agentEventBase(eventIndex),
		type: 'thinking_delta',
		delta,
		contentIndex,
	};
}

function toolStartEvent(
	eventIndex: number,
	args: unknown,
): Extract<AttachedAgentEvent, { type: 'tool_start' }> {
	return {
		...agentEventBase(eventIndex),
		type: 'tool_start',
		toolName: 'search',
		toolCallId: 'tool-1',
		args,
	};
}

function toolResultEvent(
	eventIndex: number,
	result: unknown,
	isError = false,
): Extract<AttachedAgentEvent, { type: 'tool' }> {
	return {
		...agentEventBase(eventIndex),
		type: 'tool',
		toolName: 'search',
		toolCallId: 'tool-1',
		isError,
		result,
		durationMs: 10,
	};
}

function turnEvent(eventIndex: number): Extract<AttachedAgentEvent, { type: 'turn' }> {
	return {
		...agentEventBase(eventIndex),
		type: 'turn',
		turnId: 'turn-1',
		purpose: 'agent',
		durationMs: 25,
		request: {
			providerId: 'openai',
			providerName: 'OpenAI',
			requestedModel: 'gpt-5-mini',
			api: 'responses',
		},
		response: {
			responseModel: 'gpt-5-mini',
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				cost: {
					input: 1,
					output: 2,
					cacheRead: 0,
					cacheWrite: 0,
					total: 3,
				},
			},
		},
		isError: false,
	};
}

function submissionFailedEvent(
	eventIndex: number,
): Extract<AttachedAgentEvent, { type: 'submission_settled' }> {
	return {
		...agentEventBase(eventIndex),
		type: 'submission_settled',
		submissionId: 'submission-1',
		outcome: 'failed',
		error: {
			message: 'failed',
		},
	};
}

function toolCallContent(argumentsValue: Record<string, unknown>): LlmToolCall {
	return {
		type: 'toolCall',
		id: 'tool-1',
		name: 'search',
		arguments: argumentsValue,
	};
}

function agentEventBase(eventIndex: number): Omit<AttachedAgentEvent, 'type'> {
	return {
		v: 3,
		eventIndex,
		timestamp: `2026-06-25T00:00:${String(eventIndex).padStart(2, '0')}.000Z`,
		instanceId: 'ticket-1',
		dispatchId: 'dispatch-1',
		submissionId: 'submission-1',
		agentName: 'triage',
		conversationId: 'ticket-1',
	};
}
