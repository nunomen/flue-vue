import type { FlueClient } from '@flue/sdk';
import { computed, toValue } from 'vue';
import { emptyWorkflowSnapshot, WorkflowRun } from './core/workflow-run.ts';
import { useSubscribableSnapshot } from './bridge.ts';
import { useFlueClientSource } from './provider.ts';
import type { UseFlueWorkflowOptions, UseFlueWorkflowReturn } from './types.ts';

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
		createObserver: (identity: WorkflowIdentity) => new WorkflowRun(identity),
		isEqual: (left: WorkflowIdentity, right: WorkflowIdentity) =>
			left.client === right.client && left.runId === right.runId,
	});

	return {
		events: computed(() => snapshot.value.events),
		logs: computed(() => snapshot.value.logs),
		status: computed(() => snapshot.value.status),
		result: computed(() => snapshot.value.result),
		error: computed(() => snapshot.value.error),
	};
}
