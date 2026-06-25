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
} from './core/types.ts';
export type {
	AgentHistory,
	AgentSnapshot,
	AgentStatus,
	AgentPromptImage,
	AttachedAgentEvent,
	CreateFluePluginOptions,
	FlueEvent,
	PromptUsage,
	SendMessageOptions,
	UIMessage,
	UIMessagePart,
	WorkflowSnapshot,
	WorkflowStatus,
} from './core/types.ts';

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
