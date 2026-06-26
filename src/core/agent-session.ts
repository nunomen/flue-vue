/*
 * Portions derived from @flue/react in withastro/flue.
 * Licensed under Apache License 2.0.
 * Modifications Copyright 2026 Nuno Mendes.
 */

import type { AttachedAgentEvent, FlueClient, FlueEventStream, LiveMode } from '@flue/sdk';
import {
	adjustPendingStatus,
	agentEventKey,
	emptyAgentSnapshot,
	imageToMessagePart,
	isStatusError,
	isTerminalStreamError,
	mergeHydratedAndLocalMessages,
	normalizeError,
	optimisticMessageId,
	reduceAgentEvent,
} from './agent-reducer.js';
import type {
	AgentHistory,
	AgentSnapshot,
	SendMessageOptions,
	SubscribableSnapshot,
	UIMessage,
} from './types.js';

export interface AgentSessionIdentity {
	client: FlueClient;
	name: string;
	id: string;
	history?: AgentHistory;
	live?: LiveMode;
}

export class AgentSession implements SubscribableSnapshot<AgentSnapshot> {
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

	constructor(readonly identity: AgentSessionIdentity) {}

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
				error: undefined,
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
			const normalized = normalizeError(error);
			this.#publish({
				...this.#snapshot,
				messages: this.#snapshot.messages.filter((item) => item.id !== optimisticId),
				status: 'error',
				error: normalized,
			});
			this.#localSendError = normalized;
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

			if (isTerminalStreamError(error)) {
				this.#publishTerminalError(error);
				return;
			}

			await this.#retryHydration(error);
		}
	}

	async #retryHydration(error: unknown) {
		let retryAttempt = 0;

		while (!this.#disposed) {
			this.#publishConnecting(error);
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
				if (isTerminalStreamError(nextError)) {
					this.#publishTerminalError(nextError);
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

				if (this.#disposed) return;
				this.#nextLiveOffset = this.#stream.offset;
				await this.#retryLive(new Error('Agent event stream ended unexpectedly'), retryAttempt++);
			} catch (error) {
				if (this.#disposed) return;
				this.#nextLiveOffset = this.#stream?.offset ?? this.#nextLiveOffset;
				if (isTerminalStreamError(error)) {
					this.#publishTerminalError(error);
					return;
				}
				await this.#retryLive(error, retryAttempt++);
			}
		}
	}

	async #retryLive(error: unknown, attempt: number): Promise<void> {
		this.#publishConnecting(error);
		await this.#waitForRetry(attempt);
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

	#publishConnecting(error: unknown) {
		if (this.#localSendError) return;
		this.#publish({
			...this.#snapshot,
			status: 'connecting',
			error: normalizeError(error),
		});
	}

	#publishTerminalError(error: unknown) {
		this.#publish({
			...this.#snapshot,
			status: 'error',
			error: normalizeError(error),
		});
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
