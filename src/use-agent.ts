/*
 * Portions derived from @flue/react in withastro/flue.
 * Licensed under Apache License 2.0.
 * Modifications Copyright 2026 Nuno Mendes.
 */

import type { FlueClient, LiveMode } from '@flue/sdk';
import { computed, toValue } from 'vue';
import { emptyAgentSnapshot } from './core/agent-reducer.js';
import { AgentSession } from './core/agent-session.js';
import { useSubscribableSnapshot } from './bridge.js';
import { useFlueClientSource } from './provider.js';
import type { AgentHistory, UseFlueAgentOptions, UseFlueAgentReturn } from './types.js';

interface AgentIdentity {
	client: FlueClient;
	name: string;
	id: string;
	history: AgentHistory | undefined;
	live: LiveMode | undefined;
}

export function useFlueAgent(options: UseFlueAgentOptions): UseFlueAgentReturn {
	const clientSource = useFlueClientSource(options.client);
	let currentSession: AgentSession | undefined;

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
		createObserver: (identity: AgentIdentity) => new AgentSession(identity),
		isEqual: (left: AgentIdentity, right: AgentIdentity) =>
			left.client === right.client &&
			left.name === right.name &&
			left.id === right.id &&
			left.history === right.history &&
			left.live === right.live,
		onObserverChange(observer) {
			currentSession = observer;
		},
	});

	return {
		messages: computed(() => snapshot.value.messages),
		status: computed(() => snapshot.value.status),
		historyReady: computed(() => snapshot.value.historyReady),
		error: computed(() => snapshot.value.error),
		async sendMessage(message, sendOptions) {
			const session = currentSession;
			if (!session) throw new Error('useFlueAgent() cannot send without an agent id');
			await session.sendMessage(message, sendOptions);
		},
	};
}
