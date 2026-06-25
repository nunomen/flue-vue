import { IMAGE_DATA_OMITTED, type AttachedAgentEvent, type FlueClient, type FlueEventStream } from '@flue/sdk';
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
	#pendingSubmissions = new Set<string>();
	#nextLiveOffset: string | undefined;
	#liveStarted = false;
	#retryWake: (() => void) | undefined;
	#localSendError: Error | undefined;

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
		this.#retryWake?.();
		this.#retryWake = undefined;
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
		this.#localSendError = undefined;

		try {
			const admission = await this.identity.client.agents.send(this.identity.name, this.identity.id, {
				message,
				images: options.images,
			});
			if (this.#disposed) return;
			this.#pendingSubmissions.add(admission.submissionId);
			this.#publish({
				...this.#snapshot,
				messages: this.#snapshot.messages.map((item) =>
					item.id === optimisticId ? { ...item, id: optimisticMessageId(admission.submissionId) } : item,
				),
				status: 'streaming',
			});
			if (!this.#liveStarted && this.#snapshot.historyReady) {
				this.#nextLiveOffset = admission.offset;
				void this.#observeLive(admission.offset);
			} else if (!this.#liveStarted) {
				this.#nextLiveOffset = admission.offset;
			}
			this.#wakeRetry();
		} catch (error) {
			if (this.#disposed) return;
			this.#publish({
				...this.#snapshot,
				messages: this.#snapshot.messages.filter((item) => item.id !== optimisticId),
				status: 'error',
				error: normalizeError(error),
			});
			this.#localSendError = normalizeError(error);
			throw error;
		}
	}

	async #hydrateThenObserve() {
		try {
			const { events: historyEvents, offset } = await this.#consumeHistory();
			if (this.#disposed) return;

			const localSnapshot = this.#snapshot;
			const hydrated = historyEvents.reduce(reduceAgentEvent, emptyAgentSnapshot);
			this.#publish({
				...hydrated,
				messages: mergeHydratedAndLocalMessages(hydrated.messages, localSnapshot.messages),
				historyReady: true,
				status: this.#localSendError ? 'error' : hydrated.status === 'error' ? 'error' : 'idle',
				error: this.#localSendError ?? hydrated.error,
			});

			await this.#observeLive(this.#nextLiveOffset ?? offset);
		} catch (error) {
			if (this.#disposed) return;

			if (isStatusError(error, 404)) {
				this.#publish({
					...emptyAgentSnapshot,
					messages: this.#snapshot.messages,
					historyReady: true,
					status: this.#localSendError ? 'error' : 'idle',
					error: this.#localSendError,
				});
				return;
			}

			await this.#retryHydration(error);
		}
	}

	async #retryHydration(error: unknown) {
		let retryAttempt = 0;

		while (!this.#disposed) {
			this.#publish({
				...this.#snapshot,
				status: 'error',
				error: normalizeError(error),
			});
			await this.#waitForRetry(retryAttempt++);
			if (this.#disposed) return;

			try {
				const { events: historyEvents, offset } = await this.#consumeHistory();
				if (this.#disposed) return;

				const localSnapshot = this.#snapshot;
				const hydrated = historyEvents.reduce(reduceAgentEvent, emptyAgentSnapshot);
				this.#publish({
					...hydrated,
					messages: mergeHydratedAndLocalMessages(hydrated.messages, localSnapshot.messages),
					historyReady: true,
					status: this.#localSendError ? 'error' : 'idle',
					error: this.#localSendError,
				});

				await this.#observeLive(this.#nextLiveOffset ?? offset);
				return;
			} catch (nextError) {
				if (this.#disposed) return;
				if (isStatusError(nextError, 404)) {
					this.#publish({
						...emptyAgentSnapshot,
						messages: this.#snapshot.messages,
						historyReady: true,
						status: this.#localSendError ? 'error' : 'idle',
						error: this.#localSendError,
					});
					return;
				}
				error = nextError;
			}
		}
	}

	async #consumeHistory(): Promise<{ events: AttachedAgentEvent[]; offset: string }> {
		const events: AttachedAgentEvent[] = [];
		const history = this.identity.history ?? 100;
		const stream = this.identity.client.agents.stream(this.identity.name, this.identity.id, {
			offset: '-1',
			tail: history === 'all' ? undefined : history,
			live: false,
		});
		this.#stream = stream;

		for await (const event of stream) {
			if (this.#disposed) return { events, offset: stream.offset };
			events.push(event);
		}

		return { events, offset: stream.offset };
	}

	async #observeLive(offset: string) {
		if (this.#disposed) return;
		this.#liveStarted = true;
		this.#nextLiveOffset = offset;
		let retryAttempt = 0;

		while (!this.#disposed) {
			try {
				this.#stream = this.identity.client.agents.stream(this.identity.name, this.identity.id, {
					offset: this.#nextLiveOffset,
					live: this.identity.live ?? true,
				});

				for await (const event of this.#stream) {
					if (this.#disposed) return;
					this.#applyLiveEvent(event);
					this.#nextLiveOffset = this.#stream.offset;
					retryAttempt = 0;
				}

				return;
			} catch {
				if (this.#disposed) return;
				this.#nextLiveOffset = this.#stream?.offset ?? this.#nextLiveOffset;
				await this.#waitForRetry(retryAttempt++);
			}
		}
	}

	#applyLiveEvent(event: AttachedAgentEvent) {
		const key = agentEventKey(event);
		if (this.#seenEvents.has(key)) return;
		this.#seenEvents.add(key);
		if (event.submissionId && (event.type === 'idle' || event.type === 'submission_settled')) {
			this.#pendingSubmissions.delete(event.submissionId);
		}
		this.#publish(adjustPendingStatus(reduceAgentEvent(this.#snapshot, event), this.#pendingSubmissions));
	}

	#publish(snapshot: AgentSnapshot) {
		this.#snapshot = snapshot;
		for (const listener of this.#listeners) listener();
	}

	#wakeRetry() {
		this.#retryWake?.();
		this.#retryWake = undefined;
	}

	#waitForRetry(attempt: number): Promise<void> {
		const delay = Math.min(2 ** attempt, 50);
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				if (this.#retryWake === wake) this.#retryWake = undefined;
				resolve();
			}, delay);
			const wake = () => {
				clearTimeout(timeout);
				if (this.#retryWake === wake) this.#retryWake = undefined;
				resolve();
			};
			this.#retryWake = wake;
		});
	}
}

function reduceAgentEvent(snapshot: AgentSnapshot, event: AttachedAgentEvent): AgentSnapshot {
	let messages = snapshot.messages;

	if (event.type === 'message_end') {
		const message = messageFromEvent(event, snapshot.messages);
		messages = message
			? message.role === 'user'
				? reconcileUserMessage(snapshot.messages, event, message)
				: upsertMessage(snapshot.messages, message)
			: snapshot.messages;
	} else if (event.type === 'text_delta') {
		messages = canPlaceAssistantDelta(event)
			? upsertAssistantMessage(snapshot.messages, event, (message) => ({
					...message,
					parts: appendTextDelta(message.parts, event.text),
				}))
			: snapshot.messages;
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

function reconcileUserMessage(
	messages: UIMessage[],
	event: AttachedAgentEvent,
	durableMessage: UIMessage,
): UIMessage[] {
	if (!event.submissionId) return upsertMessage(messages, durableMessage);

	const submissionId = event.submissionId;
	const localIndex = messages.findIndex((message) => message.id === optimisticMessageId(submissionId));
	if (localIndex === -1) return upsertMessage(messages, durableMessage);

	const localMessage = messages[localIndex];
	const next = messages.slice();
	next[localIndex] = mergeDurableUserMessage(localMessage, durableMessage);
	return next;
}

function mergeDurableUserMessage(localMessage: UIMessage | undefined, durableMessage: UIMessage): UIMessage {
	if (!localMessage) return durableMessage;

	return {
		...durableMessage,
		parts: durableMessage.parts.map((part, index) => {
			if (part.type !== 'file' || part.url !== IMAGE_DATA_OMITTED) return part;
			const localPart = localMessage.parts[index];
			if (localPart?.type !== 'file') return part;
			return {
				...part,
				url: localPart.url,
			};
		}),
	};
}

function mergeHydratedAndLocalMessages(hydratedMessages: UIMessage[], localMessages: UIMessage[]): UIMessage[] {
	const next = hydratedMessages.slice();
	for (const localMessage of localMessages) {
		if (!isOptimisticMessage(localMessage)) continue;
		if (hasDurableSubmission(next, localMessage.id)) continue;
		next.push(localMessage);
	}
	return next;
}

function hasDurableSubmission(messages: UIMessage[], optimisticId: string): boolean {
	const submissionId = optimisticId.slice('local:'.length);
	return messages.some((message) => message.id.includes(`:${submissionId}:`));
}

function isOptimisticMessage(message: UIMessage): boolean {
	return message.id.startsWith('local:');
}

function canPlaceAssistantDelta(event: AttachedAgentEvent): boolean {
	return Boolean(event.submissionId || event.dispatchId || event.turnId);
}

function adjustPendingStatus(snapshot: AgentSnapshot, pendingSubmissions: Set<string>): AgentSnapshot {
	if (snapshot.status !== 'idle' || pendingSubmissions.size === 0) return snapshot;
	return {
		...snapshot,
		status: 'streaming',
	};
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

function optimisticMessageId(submissionId: string): string {
	return `local:${submissionId}`;
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
