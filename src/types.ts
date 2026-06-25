import type {
	AgentPromptImage,
	AttachedAgentEvent,
	FlueClient,
	FlueEvent,
	LiveMode,
	PromptUsage,
} from '@flue/sdk';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';

export type { AgentPromptImage, AttachedAgentEvent, FlueEvent, PromptUsage } from '@flue/sdk';

export type UIMessagePart =
	| { type: 'text'; text: string; state?: 'streaming' | 'done' }
	| { type: 'reasoning'; text: string; state?: 'streaming' | 'done' }
	| ({ type: 'dynamic-tool'; toolName: string; toolCallId: string } & (
			| { state: 'input-available'; input: unknown; output?: never; errorText?: never }
			| { state: 'output-available'; input: unknown; output: unknown; errorText?: never }
			| { state: 'output-error'; input: unknown; output?: never; errorText: string }
	  ))
	| { type: 'file'; mediaType: string; url: string };

export interface UIMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	metadata?: {
		usage?: PromptUsage;
		model?: { provider: string; id: string };
		[key: string]: unknown;
	};
	parts: UIMessagePart[];
}

export type AgentStatus = 'idle' | 'connecting' | 'submitted' | 'streaming' | 'error';
export type WorkflowStatus =
	| 'idle'
	| 'connecting'
	| 'running'
	| 'completed'
	| 'errored'
	| 'disconnected';

export interface SendMessageOptions {
	images?: AgentPromptImage[];
}

export type AgentHistory = number | 'all';

export interface AgentSnapshot {
	messages: UIMessage[];
	status: AgentStatus;
	historyReady: boolean;
	error: Error | undefined;
}

export interface WorkflowSnapshot {
	events: FlueEvent[];
	logs: Extract<FlueEvent, { type: 'log' }>[];
	status: WorkflowStatus;
	result: unknown;
	error: unknown;
}

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

export interface CreateFluePluginOptions {
	client: FlueClient;
}

