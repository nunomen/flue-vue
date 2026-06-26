/*
 * Portions derived from @flue/react in withastro/flue.
 * Licensed under Apache License 2.0.
 * Modifications Copyright 2026 Nuno Mendes.
 */

import type {
	AgentPromptImage,
	AttachedAgentEvent,
	FlueClient,
	FlueEvent,
	LiveMode,
	PromptUsage,
} from '@flue/sdk';

export type { AgentPromptImage, AttachedAgentEvent, FlueClient, FlueEvent, LiveMode, PromptUsage };

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

export interface SubscribableSnapshot<TSnapshot> {
	subscribe(listener: () => void): () => void;
	getSnapshot(): TSnapshot;
	start(): void;
	dispose(): void;
}

export interface CreateFluePluginOptions {
	client: FlueClient;
}
