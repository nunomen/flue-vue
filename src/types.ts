/*
 * Portions derived from @flue/react in withastro/flue.
 * Licensed under Apache License 2.0.
 * Modifications Copyright 2026 Nuno Mendes.
 */

import type { FlueClient, LiveMode } from '@flue/sdk';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import type {
	AgentHistory,
	AgentSnapshot,
	AgentStatus,
	FlueEvent,
	SendMessageOptions,
	UIMessage,
	WorkflowSnapshot,
	WorkflowStatus,
} from './core/types.js';
export type {
	AgentHistory,
	AgentDataEvent,
	AgentStreamEvent,
	AgentSnapshot,
	AgentStatus,
	AgentPromptImage,
	AttachedAgentEvent,
	CreateFluePluginOptions,
	FlueEvent,
	FlueProviderProps,
	PromptUsage,
	SendMessageOptions,
	UIMessage,
	UIMessagePart,
	WorkflowSnapshot,
	WorkflowStatus,
} from './core/types.js';

export interface UseFlueAgentOptions {
	name: MaybeRefOrGetter<string>;
	id?: MaybeRefOrGetter<string | undefined>;
	history?: MaybeRefOrGetter<AgentHistory | undefined>;
	live?: MaybeRefOrGetter<LiveMode | undefined>;
	client?: MaybeRefOrGetter<FlueClient | undefined>;
}

export interface UseFlueAgentReturn {
	messages: Readonly<ComputedRef<UIMessage[]>>;
	status: Readonly<ComputedRef<AgentStatus>>;
	historyReady: Readonly<ComputedRef<boolean>>;
	error: Readonly<ComputedRef<Error | undefined>>;
	sendMessage(message: string, options?: SendMessageOptions): Promise<void>;
}

export type UseFlueAgentResult = UseFlueAgentReturn;

export interface UseFlueWorkflowOptions {
	runId?: MaybeRefOrGetter<string | undefined>;
	client?: MaybeRefOrGetter<FlueClient | undefined>;
}

export interface UseFlueWorkflowReturn {
	events: Readonly<ComputedRef<FlueEvent[]>>;
	logs: Readonly<ComputedRef<Extract<FlueEvent, { type: 'log' }>[]>>;
	status: Readonly<ComputedRef<WorkflowStatus>>;
	result: Readonly<ComputedRef<unknown>>;
	error: Readonly<ComputedRef<unknown>>;
}

export type UseFlueWorkflowResult = UseFlueWorkflowReturn;
