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
	const key = agentEventKey(event);
	const message = event.type === 'message_end' ? messageFromEvent(event) : undefined;
	const messages = message ? upsertMessage(snapshot.messages, message, key) : snapshot.messages;

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
		event.type === 'tool'
	) {
		return { ...snapshot, messages, status: 'streaming' };
	}

	return { ...snapshot, messages };
}

function messageFromEvent(event: Extract<AttachedAgentEvent, { type: 'message_end' }>): UIMessage | undefined {
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
		return {
			id: agentEventKey(event),
			role: 'assistant',
			parts: messageContentParts(value.content),
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

function imageToMessagePart(image: { data: string; mimeType: string }): UIMessagePart {
	return {
		type: 'file',
		mediaType: image.mimeType,
		url: image.data,
	};
}

function upsertMessage(messages: UIMessage[], message: UIMessage, id: string): UIMessage[] {
	const existingIndex = messages.findIndex((item) => item.id === id);
	if (existingIndex === -1) return [...messages, message];
	const next = messages.slice();
	next[existingIndex] = message;
	return next;
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
