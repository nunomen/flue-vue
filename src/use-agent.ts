import type { AttachedAgentEvent, FlueClient, FlueEventStream } from '@flue/sdk';
import { computed, toValue } from 'vue';
import type { SubscribableSnapshot } from './bridge.ts';
import { useSubscribableSnapshot } from './bridge.ts';
import { useFlueClientSource } from './provider.ts';
import type {
	AgentHistory,
	AgentSnapshot,
	SendMessageOptions,
	UIMessage,
	UIMessagePart,
	UseFlueAgentOptions,
	UseFlueAgentReturn,
} from './types.ts';

export const emptyAgentSnapshot: AgentSnapshot = {
	messages: [],
	status: 'idle',
	historyReady: false,
	error: undefined,
};

interface AgentIdentity {
	client: FlueClient;
	name: string;
	id: string;
	history: AgentHistory | undefined;
	live: boolean | 'sse' | 'long-poll' | undefined;
}

interface AgentObserver extends SubscribableSnapshot<AgentSnapshot> {
	sendMessage(message: string, options?: SendMessageOptions): Promise<void>;
}

export function useFlueAgent(options: UseFlueAgentOptions): UseFlueAgentReturn {
	const clientSource = useFlueClientSource(options.client);
	let currentObserver: AgentObserver | undefined;

	const snapshot = useSubscribableSnapshot({
		emptySnapshot: emptyAgentSnapshot,
		getIdentity() {
			const client = clientSource.value;
			const name = toValue(options.name);
			const id = toValue(options.id);
			const history = toValue(options.history);
			const live = toValue(options.live);
			return id ? { client, name, id, history, live } : undefined;
		},
		createObserver: (identity) => new AgentSessionObserver(identity),
		isEqual: (left, right) =>
			left.client === right.client &&
			left.name === right.name &&
			left.id === right.id &&
			left.history === right.history &&
			left.live === right.live,
		onObserverChange(observer) {
			currentObserver = observer;
		},
	});

	return {
		messages: computed(() => snapshot.value.messages),
		status: computed(() => snapshot.value.status),
		historyReady: computed(() => snapshot.value.historyReady),
		error: computed(() => snapshot.value.error),
		async sendMessage(message, sendOptions) {
			const observer = currentObserver;
			if (!observer) throw new Error('useFlueAgent() cannot send without an agent id');
			await observer.sendMessage(message, sendOptions);
		},
	};
}

class AgentSessionObserver implements AgentObserver {
	#listeners = new Set<() => void>();
	#snapshot: AgentSnapshot = {
		...emptyAgentSnapshot,
		status: 'connecting',
	};
	#stream: FlueEventStream<AttachedAgentEvent> | undefined;
	#started = false;
	#disposed = false;
	#localMessageIndex = 0;
	#seenEvents = new Set<string>();

	constructor(readonly identity: AgentIdentity) {}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	getSnapshot(): AgentSnapshot {
		return this.#snapshot;
	}

	start(): void {
		if (this.#started) return;
		this.#started = true;
		void this.#hydrateThenObserve();
	}

	dispose(): void {
		this.#disposed = true;
		this.#stream?.cancel();
		this.#listeners.clear();
	}

	async sendMessage(message: string, options: SendMessageOptions = {}): Promise<void> {
		const optimisticId = `local:${++this.#localMessageIndex}`;
		const optimisticMessage: UIMessage = {
			id: optimisticId,
			role: 'user',
			parts: [
				{ type: 'text', text: message, state: 'done' },
				...(options.images?.map(imageToMessagePart) ?? []),
			],
		};

		this.#publish({
			...this.#snapshot,
			messages: [...this.#snapshot.messages, optimisticMessage],
			status: 'submitted',
			error: undefined,
		});

		try {
			await this.identity.client.agents.send(this.identity.name, this.identity.id, {
				message,
				images: options.images,
			});
			if (this.#disposed) return;
			this.#publish({
				...this.#snapshot,
				status: 'streaming',
			});
		} catch (error) {
			if (this.#disposed) return;
			this.#publish({
				...this.#snapshot,
				messages: this.#snapshot.messages.filter((item) => item.id !== optimisticId),
				status: 'error',
				error: normalizeError(error),
			});
			throw error;
		}
	}

	async #hydrateThenObserve() {
		try {
			const historyEvents = await this.#consumeHistory();
			if (this.#disposed) return;

			const hydrated = historyEvents.reduce(reduceAgentEvent, emptyAgentSnapshot);
			this.#publish({
				...hydrated,
				historyReady: true,
				status: hydrated.status === 'error' ? 'error' : 'idle',
			});

			await this.#observeLive(this.#stream?.offset ?? 'now');
		} catch (error) {
			if (this.#disposed) return;

			if (isStatusError(error, 404)) {
				this.#publish({
					...emptyAgentSnapshot,
					historyReady: true,
					status: 'idle',
				});
				return;
			}

			this.#publish({
				...this.#snapshot,
				status: 'error',
				error: normalizeError(error),
			});
		}
	}

	async #consumeHistory(): Promise<AttachedAgentEvent[]> {
		const events: AttachedAgentEvent[] = [];
		const history = this.identity.history ?? 100;
		this.#stream = this.identity.client.agents.stream(this.identity.name, this.identity.id, {
			offset: '-1',
			tail: history === 'all' ? undefined : history,
			live: false,
		});

		for await (const event of this.#stream) {
			if (this.#disposed) return events;
			events.push(event);
		}

		return events;
	}

	async #observeLive(offset: string) {
		if (this.#disposed) return;

		this.#stream = this.identity.client.agents.stream(this.identity.name, this.identity.id, {
			offset,
			live: this.identity.live ?? true,
		});

		for await (const event of this.#stream) {
			if (this.#disposed) return;
			this.#applyLiveEvent(event);
		}
	}

	#applyLiveEvent(event: AttachedAgentEvent) {
		const key = agentEventKey(event);
		if (this.#seenEvents.has(key)) return;
		this.#seenEvents.add(key);
		this.#publish(reduceAgentEvent(this.#snapshot, event));
	}

	#publish(snapshot: AgentSnapshot) {
		this.#snapshot = snapshot;
		for (const listener of this.#listeners) listener();
	}
}

function reduceAgentEvent(snapshot: AgentSnapshot, event: AttachedAgentEvent): AgentSnapshot {
	let messages = snapshot.messages;

	if (event.type === 'message_end') {
		const message = messageFromEvent(event, snapshot.messages);
		messages = message ? upsertMessage(snapshot.messages, message) : snapshot.messages;
	} else if (event.type === 'text_delta') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: appendTextDelta(message.parts, event.text),
		}));
	} else if (event.type === 'thinking_delta') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: appendReasoningDelta(message.parts, event.delta, event.contentIndex ?? 0),
		}));
	} else if (event.type === 'tool_start') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: upsertToolStart(message.parts, event),
		}));
	} else if (event.type === 'tool') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: upsertToolResult(message.parts, event),
		}));
	} else if (event.type === 'turn') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			metadata: metadataFromTurn(event, message.metadata),
		}));
	}

	if (event.type === 'idle') {
		return { ...snapshot, messages, status: 'idle' };
	}

	if (event.type === 'submission_settled' && event.outcome === 'failed') {
		return { ...snapshot, messages, status: 'error', error: normalizeError(event.error) };
	}

	if (
		event.type === 'text_delta' ||
		event.type === 'thinking_delta' ||
		event.type === 'tool_start' ||
		event.type === 'tool' ||
		event.type === 'turn'
	) {
		return { ...snapshot, messages, status: 'streaming' };
	}

	return { ...snapshot, messages };
}

function messageFromEvent(
	event: Extract<AttachedAgentEvent, { type: 'message_end' }>,
	existingMessages: UIMessage[],
): UIMessage | undefined {
	const value = event.message;
	if (!isRecord(value) || !('role' in value)) return undefined;

	if (value.role === 'user') {
		return {
			id: agentEventKey(event),
			role: 'user',
			parts: messageContentParts(value.content),
		};
	}

	if (value.role === 'assistant') {
		const existing = existingMessages.find((item) => item.id === assistantMessageId(event));
		return {
			id: assistantMessageId(event),
			role: 'assistant',
			metadata: existing?.metadata,
			parts: mergeAuthoritativeParts(existing?.parts ?? [], messageContentParts(value.content)),
		};
	}

	return undefined;
}

function messageContentParts(content: unknown): UIMessagePart[] {
	if (typeof content === 'string') return [{ type: 'text', text: content, state: 'done' }];
	if (!Array.isArray(content)) return [];

	return content.flatMap((part): UIMessagePart[] => {
		if (!isRecord(part)) return [];
		if (part.type === 'text' && typeof part.text === 'string') {
			return [{ type: 'text', text: part.text, state: 'done' }];
		}
		if (part.type === 'thinking' && typeof part.thinking === 'string') {
			return [{ type: 'reasoning', text: part.thinking, state: 'done' }];
		}
		if (part.type === 'image' && typeof part.mimeType === 'string' && typeof part.data === 'string') {
			return [{ type: 'file', mediaType: part.mimeType, url: part.data }];
		}
		if (
			part.type === 'toolCall' &&
			typeof part.name === 'string' &&
			typeof part.id === 'string'
		) {
			return [
				{
					type: 'dynamic-tool',
					state: 'input-available',
					toolName: part.name,
					toolCallId: part.id,
					input: isRecord(part.arguments) ? part.arguments : {},
				},
			];
		}
		return [];
	});
}

function appendTextDelta(parts: UIMessagePart[], delta: string): UIMessagePart[] {
	const next = parts.slice();
	const index = findLastPartIndex(next, (part): part is Extract<UIMessagePart, { type: 'text' }> =>
		part.type === 'text' && part.state === 'streaming',
	);
	if (index === -1) return [...next, { type: 'text', text: delta, state: 'streaming' }];
	const part = next[index];
	if (part?.type !== 'text') return next;
	next[index] = { ...part, text: `${part.text}${delta}`, state: 'streaming' };
	return next;
}

function appendReasoningDelta(parts: UIMessagePart[], delta: string, contentIndex: number): UIMessagePart[] {
	const next = parts.slice();
	const index = findReasoningPartIndex(next, contentIndex);
	if (index === -1) return [...next, { type: 'reasoning', text: delta, state: 'streaming' }];
	const part = next[index];
	if (part?.type !== 'reasoning') return next;
	next[index] = { ...part, text: `${part.text}${delta}`, state: 'streaming' };
	return next;
}

function upsertToolStart(
	parts: UIMessagePart[],
	event: Extract<AttachedAgentEvent, { type: 'tool_start' }>,
): UIMessagePart[] {
	const next = parts.slice();
	const index = next.findIndex((part) => part.type === 'dynamic-tool' && part.toolCallId === event.toolCallId);
	const input = event.args ?? {};
	if (index === -1) {
		return [
			...next,
			{
				type: 'dynamic-tool',
				state: 'input-available',
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				input,
			},
		];
	}

	const part = next[index];
	if (part?.type !== 'dynamic-tool') return next;
	if (part.state === 'input-available') {
		next[index] = { ...part, toolName: event.toolName, input };
	} else {
		next[index] = { ...part, toolName: event.toolName, input };
	}
	return next;
}

function upsertToolResult(
	parts: UIMessagePart[],
	event: Extract<AttachedAgentEvent, { type: 'tool' }>,
): UIMessagePart[] {
	const next = parts.slice();
	const index = next.findIndex((part) => part.type === 'dynamic-tool' && part.toolCallId === event.toolCallId);
	const existing = index === -1 ? undefined : next[index];
	const input = existing?.type === 'dynamic-tool' ? existing.input : {};
	const part: UIMessagePart = event.isError
		? {
				type: 'dynamic-tool',
				state: 'output-error',
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				input,
				errorText: String(event.result ?? 'Tool call failed'),
			}
		: {
				type: 'dynamic-tool',
				state: 'output-available',
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				input,
				output: event.result,
			};

	if (index === -1) return [...next, part];
	next[index] = part;
	return next;
}

function mergeAuthoritativeParts(existingParts: UIMessagePart[], authoritativeParts: UIMessagePart[]): UIMessagePart[] {
	return authoritativeParts.map((part) => {
		if (part.type !== 'dynamic-tool') return part;

		const existing = existingParts.find(
			(existingPart) =>
				existingPart.type === 'dynamic-tool' && existingPart.toolCallId === part.toolCallId,
		);
		if (!existing || existing.type !== 'dynamic-tool') return part;
		if (existing.state === 'output-available') {
			return {
				...existing,
				toolName: part.toolName,
				input: part.input,
			};
		}
		if (existing.state === 'output-error') {
			return {
				...existing,
				toolName: part.toolName,
				input: part.input,
			};
		}
		return part;
	});
}

function metadataFromTurn(
	event: Extract<AttachedAgentEvent, { type: 'turn' }>,
	existing: UIMessage['metadata'],
): UIMessage['metadata'] {
	return {
		...existing,
		usage: event.response.usage ?? existing?.usage,
		model: {
			provider: event.request.providerId,
			id: event.response.responseModel ?? event.request.requestedModel,
		},
	};
}

function upsertAssistantMessage(
	messages: UIMessage[],
	event: AttachedAgentEvent,
	update: (message: UIMessage) => UIMessage,
): UIMessage[] {
	const id = assistantMessageId(event);
	const existing = messages.find((message) => message.id === id);
	const message = update(existing ?? { id, role: 'assistant', parts: [] });
	return upsertMessage(messages, message);
}

function findLastPartIndex<TPart extends UIMessagePart>(
	parts: UIMessagePart[],
	predicate: (part: UIMessagePart) => part is TPart,
): number {
	for (let index = parts.length - 1; index >= 0; index--) {
		const part = parts[index];
		if (part && predicate(part)) return index;
	}
	return -1;
}

function findReasoningPartIndex(parts: UIMessagePart[], contentIndex: number): number {
	let seen = 0;
	for (let index = 0; index < parts.length; index++) {
		if (parts[index]?.type !== 'reasoning') continue;
		if (seen === contentIndex) return index;
		seen++;
	}
	return -1;
}

function imageToMessagePart(image: { data: string; mimeType: string }): UIMessagePart {
	return {
		type: 'file',
		mediaType: image.mimeType,
		url: image.data,
	};
}

function upsertMessage(messages: UIMessage[], message: UIMessage): UIMessage[] {
	const existingIndex = messages.findIndex((item) => item.id === message.id);
	if (existingIndex === -1) return [...messages, message];
	const next = messages.slice();
	next[existingIndex] = message;
	return next;
}

function assistantMessageId(event: AttachedAgentEvent): string {
	return [
		event.instanceId,
		event.dispatchId ?? '',
		event.submissionId ?? '',
		'assistant',
	].join(':');
}

function agentEventKey(event: AttachedAgentEvent): string {
	return [
		event.instanceId,
		event.dispatchId ?? '',
		event.submissionId ?? '',
		event.eventIndex,
		event.type,
		event.timestamp,
	].join(':');
}

function normalizeError(error: unknown): Error {
	if (error instanceof Error) return error;
	if (isRecord(error) && typeof error.message === 'string') return new Error(error.message);
	return new Error(String(error));
}

function isStatusError(error: unknown, status: number): boolean {
	return isRecord(error) && error.status === status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
