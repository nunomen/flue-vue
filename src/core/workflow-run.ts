/*
 * Portions derived from @flue/react in withastro/flue.
 * Licensed under Apache License 2.0.
 * Modifications Copyright 2026 Nuno Mendes.
 */

import type { FlueClient, FlueEvent, FlueEventStream } from '@flue/sdk';
import type { SubscribableSnapshot, WorkflowSnapshot } from './types.js';

export const emptyWorkflowSnapshot: WorkflowSnapshot = {
	events: [],
	logs: [],
	status: 'idle',
	result: null,
	error: undefined,
};

export interface WorkflowRunIdentity {
	client: FlueClient;
	runId: string;
}

export class WorkflowRun implements SubscribableSnapshot<WorkflowSnapshot> {
	#listeners = new Set<() => void>();
	#snapshot: WorkflowSnapshot = {
		...emptyWorkflowSnapshot,
		status: 'connecting',
	};
	#stream: FlueEventStream<FlueEvent> | undefined;
	#started = false;
	#disposed = false;
	#seenEvents = new Set<string>();
	#terminal = false;
	#nextOffset = '-1';

	constructor(readonly identity: WorkflowRunIdentity) {}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	getSnapshot(): WorkflowSnapshot {
		return this.#snapshot;
	}

	start(): void {
		if (this.#started) return;
		this.#started = true;
		void this.#observe();
	}

	dispose(): void {
		this.#disposed = true;
		this.#stream?.cancel();
		this.#listeners.clear();
	}

	async #observe() {
		let retryAttempt = 0;

		while (!this.#disposed && !this.#terminal) {
			try {
				this.#stream = this.identity.client.runs.stream(this.identity.runId, {
					offset: this.#nextOffset,
					live: true,
				});

				for await (const event of this.#stream) {
					if (this.#disposed) return;
					this.#applyEvent(event);
					this.#nextOffset = this.#stream.offset;
					retryAttempt = 0;
					if (this.#terminal) return;
				}

				if (!this.#disposed && !this.#terminal) {
					this.#publish({
						...this.#snapshot,
						status: 'disconnected',
					});
				}
				return;
			} catch (error) {
				if (this.#disposed) return;
				this.#nextOffset = this.#stream?.offset ?? this.#nextOffset;
				if (isTerminalStatusError(error)) {
					this.#publish({
						...this.#snapshot,
						status: 'disconnected',
						error,
					});
					return;
				}

				this.#publish({
					...this.#snapshot,
					status: 'connecting',
					error,
				});
				await waitForRetry(retryAttempt++);
			}
		}
	}

	#applyEvent(event: FlueEvent) {
		const key = workflowEventKey(event);
		if (this.#seenEvents.has(key)) return;
		this.#seenEvents.add(key);

		const events = [...this.#snapshot.events, event];
		const logs = event.type === 'log' ? [...this.#snapshot.logs, event] : this.#snapshot.logs;
		let status = this.#snapshot.status;
		let result = this.#snapshot.result;
		let error = this.#snapshot.error;

		if (event.type === 'run_start' || event.type === 'run_resume') {
			status = 'running';
			error = undefined;
		} else if (event.type === 'run_end') {
			this.#terminal = true;
			status = event.isError ? 'errored' : 'completed';
			result = event.result ?? null;
			error = event.isError ? event.error : undefined;
		}

		this.#publish({ events, logs, status, result, error });
	}

	#publish(snapshot: WorkflowSnapshot) {
		this.#snapshot = snapshot;
		for (const listener of this.#listeners) listener();
	}
}

function isTerminalStatusError(error: unknown): boolean {
	return isRecord(error) && (error.status === 401 || error.status === 403 || error.status === 404);
}

function waitForRetry(attempt: number): Promise<void> {
	const delay = Math.min(2 ** attempt, 50);
	return new Promise((resolve) => setTimeout(resolve, delay));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function workflowEventKey(event: FlueEvent): string {
	return [
		event.runId ?? '',
		event.dispatchId ?? '',
		event.submissionId ?? '',
		event.eventIndex,
		event.type,
		event.timestamp,
	].join(':');
}
