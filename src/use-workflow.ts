import type { FlueClient, FlueEvent, FlueEventStream } from '@flue/sdk';
import { computed, toValue } from 'vue';
import type { SubscribableSnapshot } from './bridge.ts';
import { useSubscribableSnapshot } from './bridge.ts';
import { useFlueClientSource } from './provider.ts';
import type { UseFlueWorkflowOptions, UseFlueWorkflowReturn, WorkflowSnapshot } from './types.ts';

export const emptyWorkflowSnapshot: WorkflowSnapshot = {
	events: [],
	logs: [],
	status: 'idle',
	result: null,
	error: undefined,
};

interface WorkflowIdentity {
	client: FlueClient;
	runId: string;
}

export function useFlueWorkflow(options: UseFlueWorkflowOptions = {}): UseFlueWorkflowReturn {
	const clientSource = useFlueClientSource(options.client);

	const snapshot = useSubscribableSnapshot({
		emptySnapshot: emptyWorkflowSnapshot,
		getIdentity() {
			const client = clientSource.value;
			const runId = toValue(options.runId);
			return runId ? { client, runId } : undefined;
		},
		createObserver: (identity) => new WorkflowRunObserver(identity),
		isEqual: (left, right) => left.client === right.client && left.runId === right.runId,
	});

	return {
		events: computed(() => snapshot.value.events),
		logs: computed(() => snapshot.value.logs),
		status: computed(() => snapshot.value.status),
		result: computed(() => snapshot.value.result),
		error: computed(() => snapshot.value.error),
	};
}

class WorkflowRunObserver implements SubscribableSnapshot<WorkflowSnapshot> {
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

	constructor(readonly identity: WorkflowIdentity) {}

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
		try {
			this.#stream = this.identity.client.runs.stream(this.identity.runId, {
				offset: '-1',
				live: true,
			});

			for await (const event of this.#stream) {
				if (this.#disposed) return;
				this.#applyEvent(event);
				if (this.#terminal) return;
			}

			if (!this.#disposed && !this.#terminal) {
				this.#publish({
					...this.#snapshot,
					status: 'disconnected',
				});
			}
		} catch (error) {
			if (this.#disposed) return;
			this.#publish({
				...this.#snapshot,
				status: 'disconnected',
				error,
			});
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

